import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createProgressOutbox,
  authenticatedBoardAdapter,
  flushProgress,
  recoverStaleReceipt,
} from './task-progress-outbox.mjs';
function fixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'stale-receipt-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const box = createProgressOutbox(directory);
  const first = box.enqueue('fixture', 'old', { observed_at: '2026-11-15T12:00:00.000Z', event: 'started' });
  box.prepare(first.receipt_id, 3);
  box.fail(first.receipt_id, 'stale_receipt');
  const entry = box.read().pending[0];
  const seen = {
    task: { id: 'fixture', revision: 8 },
    receipt_id: entry.receipt_id,
    outcome: 'not_found',
    receipt: null,
  };
  const rejection = {
    source: 'original-owner-tool-call',
    operation: 'apply_task_progress_receipt',
    args: { id: 'fixture', revision: 3, receipt: entry.receipt },
    result: { error: 'too old', code: 'stale_receipt', retryable: false },
  };
  const adapter = authenticatedBoardAdapter(async () => seen, {
    readRejectedOperation: async (ref) => {
      assert.equal(ref, rejection.source);
      return rejection;
    },
  });
  return { box, entry, seen, rejection, adapter, directory };
}
test('authenticated exact stale is retained as rejected-not-delivered and fresh facts keep monotonic sequence', async (t) => {
  const f = fixture(t),
    raw = readFileSync(path.join(f.directory, 'outbox.json'));
  const result = await recoverStaleReceipt(f.box, f.adapter, f.entry.receipt_id, { rejectionRef: f.rejection.source });
  assert.equal(result.state, 'rejected-not-delivered');
  const audit = JSON.parse(readFileSync(result.audit));
  assert.deepEqual(Buffer.from(audit.originalOutbox.bytes, 'base64'), raw);
  assert.deepEqual(audit.entry, f.entry);
  assert.deepEqual(audit.rejection, f.rejection);
  assert.equal(f.box.read().pending.length, 0);
  assert.equal(f.box.read().acknowledged.length, 0);
  assert.equal(
    f.box.enqueue('fixture', 'fresh', { event: 'completed', observed_at: '2026-11-16T12:00:00.000Z' }).receipt.sequence,
    2,
  );
  assert.deepEqual(await recoverStaleReceipt(f.box, f.adapter, f.entry.receipt_id), result);
  assert.throws(() => f.box.enqueue('fixture', 'old', { event: 'completed' }), /changed facts/);
});
test('audit-before-removal survives interruption without losing bytes or writing server', async (t) => {
  const f = fixture(t);
  let audit;
  await assert.rejects(
    recoverStaleReceipt(f.box, f.adapter, f.entry.receipt_id, {
      rejectionRef: f.rejection.source,
      afterAudit: (file) => {
        audit = readFileSync(file);
        throw Error('interrupted');
      },
    }),
    /interrupted/,
  );
  assert.equal(f.box.read().pending.length, 1);
  const result = await recoverStaleReceipt(f.box, f.adapter, f.entry.receipt_id, { rejectionRef: f.rejection.source });
  assert.deepEqual(readFileSync(result.audit), audit);
  assert.equal(f.box.read().pending.length, 0);
});
test('bare code, permission/conflict, wrong identity, revision rollback and uncertain application remain blocking', async (t) => {
  for (const mutate of [
    (f) => delete f.rejection.result.retryable,
    (f) => (f.rejection.result.code = 'revision_conflict'),
    (f) => (f.rejection.args.revision = 8),
    (f) => (f.seen.task.id = 'another'),
    (f) => (f.seen.task.revision = 2),
    (f) => (f.seen.outcome = 'applied'),
    (f) => (f.rejection.args.receipt.observed_at = 'fresh'),
  ]) {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(
      recoverStaleReceipt(f.box, f.adapter, f.entry.receipt_id, { rejectionRef: f.rejection.source }),
    );
    assert.equal(f.box.read().pending.length, 1);
    assert.equal(f.box.read().acknowledged.length, 0);
  }
  const f = fixture(t);
  await assert.rejects(
    recoverStaleReceipt(
      f.box,
      authenticatedBoardAdapter(async () => f.seen),
      f.entry.receipt_id,
    ),
    /unavailable/,
  );
  assert.throws(
    () => f.box.quarantineStale(f.entry.receipt_id, { rejection: f.rejection, readback: f.seen }),
    /Authenticated/,
  );
});
test('new authenticated terminal stale exits active queue, unknown errors still block and never fake acknowledgement', async (t) => {
  const f = fixture(t);
  const fresh = createProgressOutbox(path.join(f.directory, 'new'));
  const e = fresh.enqueue('fixture', 'one', { event: 'started' });
  let calls = 0;
  const adapter = authenticatedBoardAdapter(async (operation, args) => {
    if (operation === 'get_task_progress_receipt')
      return { task: { id: 'fixture', revision: 3 }, receipt_id: args.receipt_id, outcome: 'not_found', receipt: null };
    calls++;
    const error = Error('rejected');
    error.code = 'stale_receipt';
    error.boardResponse = { error: 'stale', code: 'stale_receipt', retryable: false };
    throw error;
  });
  const result = await flushProgress(fresh, adapter);
  assert.equal(result[0].status, 'rejected-not-delivered');
  assert.equal(calls, 1);
  assert.equal(fresh.read().acknowledged.length, 0);
  assert.equal(fresh.read().rejected[0].receipt_id, e.receipt_id);
  const unknown = createProgressOutbox(path.join(f.directory, 'unknown'));
  unknown.enqueue('fixture', 'one', { event: 'started' });
  await flushProgress(
    unknown,
    authenticatedBoardAdapter(async (operation, args) => {
      if (operation === 'get_task_progress_receipt')
        return {
          task: { id: 'fixture', revision: 3 },
          receipt_id: args.receipt_id,
          outcome: 'not_found',
          receipt: null,
        };
      const error = Error('unknown');
      error.code = 'stale_receipt';
      throw error;
    }),
  );
  assert.equal(unknown.read().pending.length, 1);
});
test('fresh completed source may confirm accurate board without writing or acknowledging old facts', async (t) => {
  const f = fixture(t);
  const { confirmCurrentBoardProjection } = await import('./task-progress-outbox.mjs');
  const expected = { board_column: 'done', status: 'done', current_work: '正式关闭', next_step: '' };
  Object.assign(f.seen.task, expected);
  const before = readFileSync(path.join(f.directory, 'outbox.json'));
  const result = await confirmCurrentBoardProjection(
    {
      directory: f.directory,
      task: 'fixture',
      receiptId: f.entry.receipt_id,
      observeCurrent: async () => ({
        task: 'fixture',
        observed_at: new Date().toISOString(),
        evidence_refs: ['formal-closeout:fixture'],
        expected,
      }),
    },
    f.adapter,
  );
  assert.equal(result.status, 'current-state-confirmed-no-write');
  assert.equal(result.historicalReceiptDelivered, false);
  assert.deepEqual(readFileSync(path.join(f.directory, 'outbox.json')), before);
});
