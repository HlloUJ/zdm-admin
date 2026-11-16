import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createProgressOutbox,
  authenticatedBoardAdapter,
  recoverTerminalInvalidWithSupersession,
  flushProgress,
} from './task-progress-outbox.mjs';
function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'invalid-supersession-'))),
    directory = path.join(base, '.git', 'task-progress', 'fixture');
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const box = createProgressOutbox(directory),
    payload = {
      observed_at: '2026-11-16T12:00:00.000Z',
      event: 'started',
      action: { id: 'real-prepare', label: '正式交付' },
      stage_fact: {
        kind: 'begin_delivery',
        conditions: { delivery_authorized: true, delivery_registered: true },
        references: { instruction: 'real-user-authorization', delivery_registration: 'real-queue-registration' },
      },
    };
  const entry = box.enqueue('fixture', 'bad-begin', payload);
  box.prepare(entry.receipt_id, 1);
  box.fail(entry.receipt_id, 'invalid_receipt');
  const original = box.read().pending[0];
  const snapshot = {
    id: 'fixture',
    created_at: '2026-11-16T10:00:00.000Z',
    updated_at: '2026-11-16T11:00:00.000Z',
    status: 'active',
    current_work: '',
    next_step: '',
    revision: 1,
  };
  const current = {
    ...snapshot,
    revision: 2,
    status: 'action',
    card_stage: 'active',
    updated_at: '2026-11-16T13:00:00.000Z',
  };
  const events = [snapshot, current].map((snapshot) => ({ task_id: 'fixture', snapshot: JSON.stringify(snapshot) }));
  const file = path.join(base, 'client-invalid-observation.json'),
    client = {
      task: 'fixture',
      observedAt: '2026-11-16T12:01:00.000Z',
      entry: original,
      sourceFile: '.git/task-progress/fixture/outbox.json',
      sourceKind: 'recorded-client-terminal-invalid',
      originalProviderResponse: 'not-retained',
    };
  const saveClient = () => writeFileSync(file, JSON.stringify(client));
  saveClient();
  const repair = {
    task: 'fixture',
    owner: 'owner',
    candidate: 'a'.repeat(40),
    evidenceDigest: 'b'.repeat(64),
    verified: true,
    assessment: {
      task: 'fixture',
      owner: 'owner',
      head: 'a'.repeat(40),
      noKnownDefects: true,
      observedAt: new Date().toISOString(),
    },
  };
  let writes = 0;
  const adapter = authenticatedBoardAdapter(async (operation, args) => {
    if (operation === 'task_history') return events;
    if (operation === 'apply_task_progress_receipt') {
      writes++;
      return {};
    }
    return { task: current, receipt_id: args.receipt_id, outcome: 'not_found', receipt: null };
  });
  return {
    base,
    directory,
    box,
    entry: original,
    payload,
    current,
    events,
    client,
    saveClient,
    repair,
    adapter,
    file,
    writes: () => writes,
    recover: (options) =>
      recoverTerminalInvalidWithSupersession(box, adapter, entry.receipt_id, {
        clientEvidenceFile: file,
        evidenceBase: base,
        readRepairSource: async () => repair,
        ...options,
      }),
  };
}
test('specific invalid missing-review fact is archived with original bytes and honest client evidence; never stale/ack/write', async (t) => {
  const f = fixture(t),
    bytes = readFileSync(path.join(f.directory, 'outbox.json')),
    result = await f.recover();
  assert.equal(result.state, 'terminal-invalid-with-supersession');
  const audit = JSON.parse(readFileSync(result.audit));
  assert.deepEqual(audit.entry, f.entry);
  assert.deepEqual(Buffer.from(audit.originalOutbox.bytes, 'base64'), bytes);
  assert.equal(audit.entry.failure.code, 'invalid_receipt');
  assert.equal(audit.rejection, undefined);
  assert.equal(audit.clientEvidence.report.originalProviderResponse, 'not-retained');
  assert.equal(f.box.read().pending.length, 0);
  assert.equal(f.box.read().acknowledged.length, 0);
  assert.equal(f.writes(), 0);
  assert.deepEqual(await f.recover(), result);
  const same = f.box.enqueue('fixture', 'bad-begin', f.payload);
  assert.equal(same.state, result.state);
  assert.equal(same.receipt.observed_at, f.entry.receipt.observed_at);
  assert.throws(
    () => f.box.enqueue('fixture', 'bad-begin', { ...f.payload, observed_at: '2026-11-16T14:00:00.000Z' }),
    /changed facts/,
  );
});
test('audit-first interruption resumes exact immutable invalid history and retains later unsubmitted tail', async (t) => {
  const f = fixture(t);
  f.box.enqueue('fixture', 'later', { event: 'completed', observed_at: '2026-11-16T12:00:01.000Z' });
  let before;
  await assert.rejects(
    f.recover({
      afterAudit: (file) => {
        before = readFileSync(file);
        throw Error('interrupted');
      },
    }),
    /interrupted/,
  );
  assert.equal(f.box.read().pending.length, 2);
  const result = await f.recover();
  assert.deepEqual(readFileSync(result.audit), before);
  assert.equal(f.box.read().pending.length, 1);
  assert.equal(f.box.read().pending[0].receipt.sequence, 2);
  assert.equal(f.writes(), 0);
});
test('permission/conflict/network, incomplete/applied history, absent barrier, wrong packet and unverified repair stay blocking', async (t) => {
  for (const mutate of [
    (f) => {
      f.box.fail(f.entry.receipt_id, 'revision_conflict');
    },
    (f) => f.events.pop(),
    (f) => {
      const row = JSON.parse(f.events[0].snapshot);
      row.progress_receipt = { receipt: f.entry.receipt };
      f.events[0].snapshot = JSON.stringify(row);
    },
    (f) => {
      f.current.updated_at = '2026-11-16T11:00:00.000Z';
      f.events[1].snapshot = JSON.stringify(f.current);
    },
    (f) => {
      f.client.entry = { ...f.entry, revision: 9 };
      f.saveClient();
    },
    (f) => (f.repair.verified = false),
    (f) => (f.repair.assessment.noKnownDefects = false),
  ]) {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(f.recover());
    assert.equal(f.box.read().pending.length, 1);
    assert.equal(f.box.read().acknowledged.length, 0);
    assert.equal(f.writes(), 0);
  }
  for (const code of ['forbidden', 'transport_unavailable', 'receipt_conflict']) {
    const f = fixture(t);
    f.box.fail(f.entry.receipt_id, code);
    await assert.rejects(f.recover());
    assert.equal(f.box.read().pending.length, 1);
  }
});
test('ordinary flush never treats invalid as stale or automatically supersedes it', async (t) => {
  const f = fixture(t);
  const result = await flushProgress(f.box, f.adapter);
  assert.equal(result[0].status, 'needs-review');
  assert.equal(result[0].reason, 'invalid_receipt');
  assert.equal(f.box.read().pending.length, 1);
  assert.equal(f.writes(), 0);
});
