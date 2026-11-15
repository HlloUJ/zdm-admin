import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProgressOutbox, flushProgress } from './task-progress-outbox.mjs';
import { recordToolProgress, bestEffortProgress, captureQueueProgress } from './task-delivery-status-sync.mjs';
import { openCompletion, completionStage, saveCompletion } from './completion-session.mjs';
const payload = {
  observed_at: '2026-11-15T12:00:00.000Z',
  action: { id: 'verify-1', label: '验证' },
  event: 'started',
  evidence_refs: ['tool:verify-1'],
  next: { kind: 'action', label: '读取验证结果' },
};
function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'progress-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('durable identity, monotonic sequence, payload immutability and bounded pending', (t) => {
  const root = fixture(t),
    box = createProgressOutbox(root, { capacity: 1 });
  const first = box.enqueue('fixture-task', 'one', payload);
  assert.equal(first.receipt.sequence, 1);
  assert.deepEqual(createProgressOutbox(root).read().pending[0], first);
  assert.equal(box.enqueue('fixture-task', 'one', payload).receipt_id, first.receipt_id);
  assert.throws(() => box.enqueue('fixture-task', 'one', { ...payload, event: 'completed' }), /changed facts/);
  assert.throws(() => box.enqueue('fixture-task', 'two', payload), /full/);
  box.acknowledge(first.receipt_id, {
    receipt_id: first.receipt_id,
    task_id: 'fixture-task',
    status: 'applied',
    revision: 2,
    applied_revision: 2,
    receipt: first.receipt,
  });
  assert.equal(box.enqueue('fixture-task', 'two', payload).receipt.sequence, 2);
});
test('uncertain write is read back and never resent; revision frozen', async (t) => {
  const box = createProgressOutbox(fixture(t));
  const entry = box.enqueue('fixture-task', 'one', payload);
  let applied = null,
    writes = 0;
  const adapter = {
    read: async () => applied ?? { status: 'not_found', revision: 3 },
    apply: async (request) => {
      writes++;
      assert.equal(request.revision, 3);
      applied = {
        receipt_id: entry.receipt_id,
        task_id: 'fixture-task',
        status: 'applied',
        revision: 4,
        applied_revision: 4,
        receipt: entry.receipt,
      };
      throw Error('lost');
    },
  };
  await flushProgress(box, adapter);
  assert.equal(writes, 1);
  assert.equal(box.read().pending.length, 0);
  await flushProgress(box, adapter);
  assert.equal(writes, 1);
});
test('unavailable read does not write; recovery reads before replay with old revision', async (t) => {
  const box = createProgressOutbox(fixture(t));
  box.enqueue('fixture-task', 'one', payload);
  let writes = 0;
  await flushProgress(box, {
    read: async () => {
      throw Error('offline');
    },
    apply: async () => writes++,
  });
  assert.equal(writes, 0);
  await flushProgress(box, { read: async () => ({ status: 'not_found', revision: 2 }), apply: async () => writes++ });
  await flushProgress(box, {
    read: async () => ({ status: 'not_found', revision: 9 }),
    apply: async (req) => {
      writes++;
      assert.equal(req.revision, 2);
    },
  });
  assert.equal(writes, 1); // later revision requires review, never rebase stale event
  assert.equal(box.read().pending.length, 1);
});
test('wrong task readback and stale receipt cannot confirm unrelated work', async (t) => {
  const box = createProgressOutbox(fixture(t));
  const e = box.enqueue('fixture-task', 'one', payload);
  assert.throws(() =>
    box.acknowledge(e.receipt_id, { receipt_id: e.receipt_id, task_id: 'other-task', status: 'applied', revision: 2 }),
  );
  assert.equal(box.read().pending.length, 1);
});
test('receipt is factual, no board decision allowed; storage failure is nonfatal', (t) => {
  const root = fixture(t);
  assert.throws(() => recordToolProgress(root, 'fixture-task', 'one', { ...payload, status: 'done' }));
  const blocked = path.join(root, 'blocked');
  writeFileSync(blocked, 'file');
  let warning = '';
  assert.equal(
    bestEffortProgress(blocked, 'fixture-task', 'one', payload, (msg) => (warning = msg)),
    null,
  );
  assert.match(warning, /unsynchronized/);
});
test('actual completion save generates start and end without explicit helper call', async (t) => {
  const root = fixture(t),
    dir = path.join(root, 'task-delivery', 'fixture-task');
  const state = openCompletion(dir, 'fixture-task');
  await completionStage(state, 'ci', 'candidate', async () => ({ passed: true }), {
    save: (s) => saveCompletion(dir, s),
  });
  const records = createProgressOutbox(path.join(root, 'task-progress', 'fixture-task')).read().pending;
  assert.deepEqual(
    records.map((e) => e.receipt.event),
    ['started', 'completed'],
  );
  assert.ok(records.every((e) => !('status' in e.receipt) && e.receipt.next.kind === 'wait'));
  saveCompletion(dir, state);
  assert.equal(createProgressOutbox(path.join(root, 'task-progress', 'fixture-task')).read().pending.length, 2);
});
test('real failed stage preserves failure and emits blocked, not completed', async (t) => {
  const root = fixture(t),
    dir = path.join(root, 'task-delivery', 'fixture-task'),
    state = openCompletion(dir, 'fixture-task');
  await assert.rejects(
    completionStage(
      state,
      'ci',
      'candidate',
      async () => {
        throw Error('actual-failure');
      },
      { save: (s) => saveCompletion(dir, s) },
    ),
    /actual-failure/,
  );
  assert.deepEqual(
    createProgressOutbox(path.join(root, 'task-progress', 'fixture-task'))
      .read()
      .pending.map((e) => e.receipt.event),
    ['started', 'blocked'],
  );
});
test('queue admission is never represented as actual started', (t) => {
  const root = fixture(t),
    ticket = { task: 'fixture-task', lane: 'development', status: 'queued' };
  captureQueueProgress(root, { revision: 1, paused: false, tickets: [ticket] }, null);
  captureQueueProgress(
    root,
    { revision: 2, paused: false, tickets: [{ ...ticket, status: 'running' }] },
    { revision: 1, paused: false, tickets: [ticket] },
  );
  assert.deepEqual(
    createProgressOutbox(path.join(root, 'task-progress', 'fixture-task'))
      .read()
      .pending.map((e) => e.receipt.event),
    ['queued'],
  );
});

test('global pause never generates paused progress for terminal tickets', (t) => {
  const root = fixture(t);
  for (const status of ['completed', 'cancelled']) {
    captureQueueProgress(
      root,
      { revision: 2, paused: true, tickets: [{ task: 'fixture-task', lane: 'development', status }] },
      { revision: 1, paused: false, tickets: [{ task: 'fixture-task', lane: 'development', status }] },
    );
  }
  assert.equal(createProgressOutbox(path.join(root, 'task-progress', 'fixture-task')).read().pending.length, 0);
});
