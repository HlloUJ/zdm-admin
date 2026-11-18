import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProgressOutbox,
  authenticatedBoardAdapter,
  recoverStaleReceipt,
  supersedeUnsubmittedReceipt,
  recoverRecordedClientStale,
} from './task-progress-outbox.mjs';
function fixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'superseded-progress-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const box = createProgressOutbox(directory),
    entry = box.enqueue('fixture', 'old', { observed_at: '2026-11-15T12:00:00.000Z', event: 'started' });
  const snapshots = [1, 2, 3].map((revision) => ({
    id: 'fixture',
    revision,
    status: revision === 3 ? 'done' : 'active',
    created_at: '2026-11-15T00:00:00.000Z',
    updated_at: revision === 3 ? '2026-11-16T12:00:00.000Z' : '2026-11-15T01:00:00.000Z',
    current_work: '正式完成',
    next_step: '',
  }));
  const events = snapshots.map((snapshot) => ({ task_id: 'fixture', snapshot: JSON.stringify(snapshot) }));
  const current = structuredClone(snapshots.at(-1));
  const rejection = {
    source: 'real-owner-operation',
    operation: 'apply_task_progress_receipt',
    args: { id: 'fixture', revision: 1, receipt: entry.receipt },
    result: { code: 'stale_receipt', error: 'Stale observation' },
  };
  const adapter = authenticatedBoardAdapter(
    async (operation, args) =>
      operation === 'task_history'
        ? events
        : { receipt_id: args.receipt_id, outcome: 'not_found', receipt: null, task: current },
    { readRejectedOperation: async () => rejection },
  );
  const closed = async () => ({
    batch: 'fixture',
    formalDeliveryComplete: true,
    main: 'a'.repeat(40),
    sourceReceiptDigest: 'b'.repeat(64),
    closedAt: '2026-11-16T11:00:00.000Z',
    observed_at: new Date().toISOString(),
  });
  return { directory, box, entry, events, current, rejection, adapter, closed };
}
test('real417 error without retryable is terminal only with complete same-revision authenticated history', async (t) => {
  const f = fixture(t);
  f.box.prepare(f.entry.receipt_id, 1);
  f.box.fail(f.entry.receipt_id, 'stale_receipt');
  const result = await recoverStaleReceipt(f.box, f.adapter, f.entry.receipt_id, { rejectionRef: f.rejection.source });
  assert.equal(result.state, 'rejected-not-delivered');
  const audit = JSON.parse(readFileSync(result.audit));
  assert.equal(audit.rejection.result.retryable, undefined);
  assert.equal(audit.historyEvidence.events.length, 3);
  assert.equal(f.box.read().acknowledged.length, 0);
});
test('unsubmitted facts superseded by formal closed source are distinguished from server rejection', async (t) => {
  const f = fixture(t),
    before = readFileSync(path.join(f.directory, 'outbox.json'));
  const result = await supersedeUnsubmittedReceipt(f.box, f.adapter, f.entry.receipt_id, {
    readClosedSource: f.closed,
  });
  assert.equal(result.state, 'superseded-without-submission');
  const audit = JSON.parse(readFileSync(result.audit));
  assert.equal(audit.rejection, undefined);
  assert.equal(audit.entry.failure, undefined);
  assert.deepEqual(Buffer.from(audit.originalOutbox.bytes, 'base64'), before);
  assert.equal(f.box.read().acknowledged.length, 0);
});
test('history gaps, wrong identity, changes during read, applied receipt and nonclosed sources cannot retire unknown facts', async (t) => {
  for (const mutate of [
    (f) => f.events.pop(),
    (f) => (f.events[0].task_id = 'other'),
    (f) => {
      const s = JSON.parse(f.events[1].snapshot);
      s.progress_receipt = { receipt: f.entry.receipt };
      f.events[1].snapshot = JSON.stringify(s);
    },
    (f) => (f.current.revision = 4),
    (f) => (f.current.status = 'active'),
    (f) => f.box.prepare(f.entry.receipt_id, 1),
    (f) => f.box.fail(f.entry.receipt_id, 'transport_unavailable'),
  ]) {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(
      supersedeUnsubmittedReceipt(f.box, f.adapter, f.entry.receipt_id, { readClosedSource: f.closed }),
    );
    assert.equal(f.box.read().pending.length, 1);
  }
});
test('legacy retained client code plus host pending record records honest lower evidence strength', async (t) => {
  const f = fixture(t);
  f.box.prepare(f.entry.receipt_id, 1);
  f.box.fail(f.entry.receipt_id, 'stale_receipt');
  const file = path.join(f.directory, 'host-record.json');
  writeFileSync(
    file,
    JSON.stringify({
      task: 'fixture',
      status: 'needs-attention',
      runId: 'original-cycle',
      checkedAt: '2026-11-16T10:00:00.000Z',
      outboxes: [{ directory: f.directory, receipts: [{ receipt_id: f.entry.receipt_id, status: 'pending' }] }],
    }),
  );
  const result = await recoverRecordedClientStale(f.box, f.adapter, f.entry.receipt_id, { clientEvidenceFile: file });
  assert.equal(result.state, 'client-reported-stale-not-delivered');
  const audit = JSON.parse(readFileSync(result.audit));
  assert.equal(audit.clientEvidence.originalProviderResponse, 'not-retained');
  assert.equal(audit.rejection, undefined);
  assert.equal(f.box.read().acknowledged.length, 0);
});
