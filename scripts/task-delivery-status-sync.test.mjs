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

test('new authorized pending-native intake is queued behind an older global fence; a later explicit pause still projects paused', (t) => {
  const root = fixture(t),
    ticket = {
      task: 'fixture-task',
      lane: 'development',
      status: 'queued',
      awaitingNativeWorker: true,
      admission: null,
      request: { sequence: 11, authorId: 'same-user' },
    };
  const initial = {
    revision: 1,
    paused: true,
    events: [{ action: 'pause-all', request: { sequence: 10, authorId: 'same-user' } }],
    tickets: [ticket],
  };
  captureQueueProgress(root, initial, null);
  const box = createProgressOutbox(path.join(root, 'task-progress/fixture-task'));
  assert.equal(box.read().pending[0].receipt.event, 'queued');
  assert.equal(box.read().pending[0].receipt.next.label, '等待执行');
  captureQueueProgress(
    root,
    {
      ...initial,
      revision: 2,
      events: [...initial.events, { action: 'pause-all', request: { sequence: 12, authorId: 'same-user' } }],
    },
    initial,
  );
  assert.deepEqual(
    box.read().pending.map((entry) => entry.receipt.event),
    ['queued', 'paused'],
  );
  assert.equal(box.read().pending[1].receipt.next.label, '等待恢复指令');
});
for (const scenario of [
  'old-request',
  'foreign-user',
  'bound-worker',
  'unreserved-bound',
  'missing-binding-event',
  'foreign-binding-event',
  'occupied-admission',
  'unknown-fence',
])
  test('new intake projection keeps the real pause for ' + scenario, (t) => {
    const root = fixture(t),
      ticket = {
        task: 'fixture-task',
        lane: 'development',
        status: 'queued',
        awaitingNativeWorker: true,
        admission: null,
        request: { sequence: 11, authorId: 'same-user' },
      };
    const state = {
      revision: 1,
      paused: true,
      events: [{ action: 'initialize', request: { sequence: 10, authorId: 'same-user' } }],
      tickets: [ticket],
    };
    if (scenario === 'old-request') ticket.request.sequence = 9;
    if (scenario === 'foreign-user') ticket.request.authorId = 'other-user';
    if (scenario === 'bound-worker') ticket.awaitingNativeWorker = false;
    if (['unreserved-bound', 'missing-binding-event', 'foreign-binding-event'].includes(scenario)) {
      delete ticket.awaitingNativeWorker;
      ticket.owner = 'actual-worker';
      ticket.nativeCoordinatorOwner = 'actual-coordinator';
      if (scenario !== 'unreserved-bound') ticket.nativeLaunchReserved = true;
      if (scenario !== 'missing-binding-event')
        state.events.push({
          action: 'bind-native-worker',
          task: ticket.task,
          coordinatorOwner: ticket.nativeCoordinatorOwner,
          workerOwner: scenario === 'foreign-binding-event' ? 'other-worker' : ticket.owner,
        });
    }
    if (scenario === 'occupied-admission') ticket.admission = 'existing-admission';
    if (scenario === 'unknown-fence') state.events = [];
    captureQueueProgress(root, state, null);
    assert.equal(
      createProgressOutbox(path.join(root, 'task-progress/fixture-task')).read().pending[0].receipt.event,
      'paused',
    );
  });
test('releasing capacity stays distinct from a later genuine pause', (t) => {
  const root = fixture(t);
  const before = {
    revision: 1,
    paused: true,
    events: [],
    tickets: [{ task: 'fixture-task', lane: 'development', status: 'blocked' }],
  };
  const released = {
    ...before,
    revision: 2,
    tickets: [{ ...before.tickets[0], status: 'parked', capacityRelease: { pauseSequence: 2 } }],
  };
  captureQueueProgress(root, released, before);
  const box = createProgressOutbox(path.join(root, 'task-progress', 'fixture-task'));
  assert.deepEqual(box.read().pending, []);
  const paused = {
    ...released,
    revision: 3,
    events: [{ action: 'pause-all', request: { sequence: 3, messageId: 'new-user-pause' } }],
  };
  captureQueueProgress(root, paused, released);
  captureQueueProgress(root, { ...paused, revision: 4 }, paused);
  assert.deepEqual(
    box.read().pending.map((entry) => entry.receipt.event),
    ['paused'],
  );
});

test('enrolling a verified delivery phase leaves the review card alone until an actual newer pause', (t) => {
  const root = fixture(t);
  const fence = { messageId: 'prior-fence', sequence: 10, authorId: 'same-user' };
  const delegation = { messageId: 'delivery-delegation', sequence: 20, authorId: 'same-user' };
  const ticket = {
    task: 'fixture-task',
    owner: 'original-worker',
    lane: 'delivery',
    status: 'queued',
    admission: null,
    order: 1,
    request: { messageId: 'original-development', sequence: 1, authorId: 'same-user' },
    phaseOrigin: {
      phaseId: 'delivery-phase',
      authorityId: 'delegated-delivery',
      developmentEvidenceDigest: 'verified',
    },
  };
  const enrollment = {
    action: 'delivery-phase-enrolled',
    task: ticket.task,
    owner: ticket.owner,
    phaseId: ticket.phaseOrigin.phaseId,
    authorityId: ticket.phaseOrigin.authorityId,
    order: ticket.order,
    developmentEvidenceDigest: ticket.phaseOrigin.developmentEvidenceDigest,
    request: delegation,
  };
  const before = {
    revision: 1,
    paused: true,
    events: [{ action: 'initialize', request: fence }],
    tickets: [],
    dynamicAuthorities: [{ id: enrollment.authorityId, request: delegation }],
  };
  const enrolled = { ...before, revision: 2, events: [...before.events, enrollment], tickets: [ticket] };
  const box = createProgressOutbox(path.join(root, 'task-progress', ticket.task));
  captureQueueProgress(root, enrolled, before);
  assert.deepEqual(box.read().pending, []);
  const unchanged = { ...enrolled, revision: 3 };
  captureQueueProgress(root, unchanged, enrolled);
  assert.deepEqual(box.read().pending, []);
  const paused = {
    ...unchanged,
    revision: 4,
    events: [...enrolled.events, { action: 'pause-all', request: { ...fence, messageId: 'new-pause', sequence: 21 } }],
  };
  captureQueueProgress(root, paused, unchanged);
  captureQueueProgress(root, { ...paused, revision: 5 }, paused);
  assert.deepEqual(
    box.read().pending.map((entry) => [entry.receipt.event, entry.receipt.next.label]),
    [['paused', '等待恢复指令']],
  );
  for (const event of [null, { ...enrollment, owner: 'wrong-worker' }, { ...enrollment, request: fence }]) {
    const isolated = fixture(t);
    captureQueueProgress(isolated, { ...enrolled, events: [...before.events, ...(event ? [event] : [])] }, before);
    assert.equal(
      createProgressOutbox(path.join(isolated, 'task-progress', ticket.task)).read().pending[0].receipt.event,
      'paused',
    );
  }
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
test('structured CI observations keep task/run/head/attempt identity, deduplicate jobs and cannot imply whole delivery', async (t) => {
  const { captureCiProgress } = await import('./task-delivery-status-sync.mjs');
  const common = fixture(t),
    head = 'a'.repeat(40);
  const fact = {
    runId: '42',
    headSha: head,
    attempt: 1,
    status: 'in_progress',
    conclusion: null,
    jobs: [
      { name: 'Frontend static', status: 'completed', conclusion: 'success', active: [] },
      { name: 'E2E 1/2', status: 'in_progress', conclusion: null, active: ['Run tests'] },
    ],
    terminalVerified: false,
    observedAt: '2026-11-16T12:00:00.000Z',
  };
  const first = captureCiProgress(common, 'fixture-task', fact);
  const repeated = captureCiProgress(common, 'fixture-task', { ...fact, observedAt: '2026-11-16T12:01:00.000Z' });
  assert.equal(first.receipt_id, repeated.receipt_id);
  assert.equal(first.receipt.event, 'started');
  assert.equal(first.receipt.stage_fact, undefined);
  assert.match(first.receipt.action.label, /E2E 1\/2:in_progress/);
  const final = captureCiProgress(common, 'fixture-task', {
    ...fact,
    status: 'completed',
    conclusion: 'success',
    terminalVerified: true,
  });
  assert.equal(final.receipt.event, 'completed');
  assert.equal(final.receipt.stage_fact, undefined);
  assert.throws(() => captureCiProgress(common, 'fixture-task', { ...fact, attempt: 2 }));
  assert.throws(() => captureCiProgress(common, 'fixture-task', { ...fact, terminalVerified: true }));
  assert.equal(createProgressOutbox(path.join(common, 'task-progress', 'fixture-task')).read().pending.length, 2);
});
test('many Chinese CI jobs and long steps fit actual417 wire label bound while complete source proof stays intact', async (t) => {
  const { captureCiProgress } = await import('./task-delivery-status-sync.mjs');
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const bytes = readFileSync(
    new URL('./delivery-repairs/test-support/task-progress-receipt-417-v35.js.txt', import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(new URL('./delivery-repairs/test-support/task-progress-receipt-417-v35-source.json', import.meta.url)),
  );
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  const { progressReceipt } = await import('data:text/javascript;base64,' + bytes.toString('base64'));
  const common = fixture(t),
    jobs = Array.from({ length: 9 }, (_, i) => ({
      name: '前端与后端检查' + i,
      status: 'in_progress',
      conclusion: null,
      active: ['执行中文步骤与真实用例验证'.repeat(40) + '🧪'],
    }));
  const fact = {
    runId: '42',
    headSha: 'a'.repeat(40),
    attempt: 1,
    status: 'in_progress',
    conclusion: null,
    jobs,
    terminalVerified: false,
    observedAt: new Date().toISOString(),
  };
  const result = captureCiProgress(common, 'fixture-task', fact);
  assert.ok(result.receipt.action.label.length <= 500);
  assert.match(result.receipt.action.label, /完整进展见CI记录/);
  assert.doesNotThrow(() => progressReceipt(result.receipt));
  assert.deepEqual(JSON.parse(readFileSync(result.receipt.evidence_refs[0])).jobs, jobs);
  assert.equal(captureCiProgress(common, 'fixture-task', fact).receipt_id, result.receipt_id);
});
