import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionBroker } from './task-resource-broker.mjs';
import { initialSchedulerState } from './task-resource-scheduler.mjs';
import { createScheduledVerification } from './task-resource-verification.mjs';
const G = 1024 ** 3;
const descriptor = {
  task: '921',
  stage: 'gate',
  worktree: '/own',
  fingerprint: 'hash',
  commandDigest: 'cmd',
  restartable: false,
  externalResources: true,
  resources: ['own-root'],
  kind: 'backend',
};
const sample = (at) => ({
  at,
  macAvailableBytes: 10 * G,
  dockerAvailableBytes: 6 * G,
  diskAvailableBytes: 20 * G,
  cpuBusyPercent: 10,
  memoryPressure: false,
  swapGrowing: false,
  ioCongested: false,
});
function setup(initial = initialSchedulerState(), extraOptions = {}) {
  let saved = structuredClone(initial),
    clock = 0,
    fail = false;
  const store = {
    read: () => structuredClone(saved),
    write: (s) => {
      if (fail) throw Error('disk full');
      saved = structuredClone(s);
    },
  };
  const options = {
    store,
    budget: () => ({ macPeakBytes: G, dockerPeakBytes: G }),
    validateEvidence: (r) => r.evidence === 'valid',
    now: () => clock,
    ...extraOptions,
  };
  const broker = createAdmissionBroker(options);
  return {
    broker,
    options,
    get saved() {
      return saved;
    },
    set time(t) {
      clock = t;
    },
    set fail(value) {
      fail = value;
    },
  };
}
async function admit(s, d = descriptor) {
  const ticket = await s.broker.enqueue(d);
  const wait = s.broker.waitAdmission(ticket);
  s.broker.tick(sample(0));
  s.time = 60000;
  s.broker.tick(sample(60000));
  const admission = await wait;
  await s.broker.assertAdmission(ticket, admission, d);
  return ticket;
}
test('durable admission, completion and notification outbox', async () => {
  const s = setup();
  const ticket = await admit(s);
  assert.equal(s.saved.jobs[0].status, 'running');
  await s.broker.complete(ticket, { exitCode: 0, evidence: 'valid' });
  assert.equal(s.saved.jobs[0].status, 'done');
  const events = s.broker.pendingNotifications();
  assert.ok(events.length >= 3);
  assert.throws(() => s.broker.acknowledge(events[0].id, {}));
  s.broker.acknowledge(events[0].id, { destination: 'verified-room', messageId: 'delivered-message' });
  assert.equal(s.broker.pendingNotifications().length, events.length - 1);
});
test('store failure never resolves admission or launches gate', async () => {
  const s = setup();
  const ticket = await s.broker.enqueue(descriptor);
  const wait = s.broker.waitAdmission(ticket);
  const rejected = assert.rejects(wait, /disk full/);
  s.fail = true;
  assert.throws(() => s.broker.tick(sample(0)), /disk full/);
  await rejected;
  assert.throws(() => s.broker.snapshot(), /disk full/);
});
test('restart cannot free unresolved running reservations', async () => {
  const s = setup();
  await admit(s);
  assert.throws(() => createAdmissionBroker(s.options), /Unreconciled/);
});
test('orphaned queued caller is blocked rather than blindly replayed', async () => {
  const s = setup();
  await s.broker.enqueue(descriptor);
  const restarted = createAdmissionBroker(s.options);
  restarted.tick(sample(0));
  assert.equal(restarted.snapshot().jobs[0].status, 'blocked');
});
test('owned queued caller can receive admission before await starts', async () => {
  const s = setup();
  const t = await s.broker.enqueue(descriptor);
  s.broker.tick(sample(0));
  s.time = 60000;
  s.broker.tick(sample(60000));
  const a = await s.broker.waitAdmission(t);
  await s.broker.assertAdmission(t, a, descriptor);
  assert.equal(s.saved.jobs[0].status, 'running');
});
test('same worktree mutex prevents parallel verifier artifact writers', async () => {
  const s = setup();
  await admit(s);
  const t = await s.broker.enqueue(descriptor);
  s.time = 61000;
  assert.equal(s.broker.tick(sample(61000)).length, 0);
  await s.broker.block(t, 'cancel before start');
});
test('legacy running gate not signaled under critical memory', async () => {
  const s = setup();
  await admit(s);
  s.time = 61000;
  assert.deepEqual(s.broker.tick({ ...sample(61000), dockerAvailableBytes: 100 }), []);
  assert.equal(s.saved.jobs[0].status, 'running');
});
test('unknown runner exception reserves capacity by blocking coordinator', async () => {
  const s = setup();
  const t = await admit(s);
  await s.broker.block(t, 'runner disconnected');
  assert.equal(s.saved.jobs[0].runtimeUncertain, true);
  assert.throws(() => s.broker.tick(sample(60000)), /termination/);
  assert.throws(() => createAdmissionBroker(s.options), /Unreconciled/);
});
test('completed failed gate blocks without retaining unknown live state', async () => {
  const s = setup();
  const t = await admit(s);
  await s.broker.block(t, 'test failure', { stageEnded: true });
  assert.equal(s.saved.jobs[0].runtimeUncertain, undefined);
  assert.doesNotThrow(() => s.broker.tick(sample(60000)));
});
test('bad admission token and false evidence never become success', async () => {
  const s = setup();
  const t = await s.broker.enqueue(descriptor);
  s.broker.tick(sample(0));
  s.time = 60000;
  s.broker.tick(sample(60000));
  await assert.rejects(s.broker.assertAdmission(t, { id: t.id, token: 'wrong' }, descriptor));
  const a = await s.broker.waitAdmission(t);
  await s.broker.assertAdmission(t, a, descriptor);
  await assert.rejects(s.broker.complete(t, { exitCode: 0, evidence: 'invalid' }));
  assert.equal(s.saved.jobs[0].status, 'running');
});
test('original verification adapter works through real broker without running heavy commands', async () => {
  const s = setup();
  let ran = false;
  const execute = createScheduledVerification({
    taskId: '921',
    broker: s.broker,
    inspect: () => ({ fingerprint: 'hash' }),
    run: async () => {
      ran = true;
      return { exitCode: 0, evidence: 'valid' };
    },
  });
  const pending = execute({
    root: '/own',
    name: 'gate',
    command: 'npm',
    args: ['run', 'backend:test'],
    kind: 'backend',
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(ran, false);
  s.broker.tick(sample(0));
  s.time = 60000;
  s.broker.tick(sample(60000));
  assert.equal((await pending).exitCode, 0);
  assert.equal(ran, true);
  assert.equal(s.saved.jobs[0].status, 'done');
});
test('broker persists through actual private state store, retaining delivered receipt', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { openSchedulerStore } = await import('./task-resource-scheduler-store.mjs');
  const dir = mkdtempSync(process.cwd() + '/.task-runtime/broker-test-');
  let store;
  try {
    store = openSchedulerStore(dir);
    let time = 0;
    const broker = createAdmissionBroker({
      store,
      budget: () => ({ macPeakBytes: G, dockerPeakBytes: G }),
      validateEvidence: (r) => r.evidence === 'valid',
      now: () => time,
    });
    const t = await broker.enqueue(descriptor);
    broker.tick(sample(0));
    time = 60000;
    broker.tick(sample(time));
    const a = await broker.waitAdmission(t);
    await broker.assertAdmission(t, a, descriptor);
    await broker.complete(t, { exitCode: 0, evidence: 'valid' });
    const e = broker.pendingNotifications()[0];
    broker.acknowledge(e.id, { destination: 'room', messageId: 'receipt' });
    store.close();
    store = openSchedulerStore(dir);
    const recovered = createAdmissionBroker({
      store,
      budget: () => ({ macPeakBytes: G, dockerPeakBytes: G }),
      validateEvidence: () => true,
    });
    assert.equal(recovered.snapshot().jobs[0].status, 'done');
    assert.equal(recovered.snapshot().events[0].receipt.messageId, 'receipt');
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spawn proof links an admitted stage once without changing lock/preemption policy', async () => {
  const s = setup(initialSchedulerState(), { inspectSpawn: () => ({ pid: 1234, pgid: 99, startTime: 'birth' }) });
  const ticket = await admit(s);
  const proof = { pid: 1234, runToken: 'attempt-one', fingerprint: 'hash' };
  assert.equal((await s.broker.recordSpawn(ticket, proof)).duplicate, false);
  assert.equal((await s.broker.recordSpawn(ticket, proof)).duplicate, true);
  assert.equal(s.saved.events.filter((e) => e.executionStarted).length, 1);
  assert.equal(s.saved.jobs[0].spawnProof.pgid, 99);
  assert.equal(s.saved.jobs[0].restartable, false);
  await assert.rejects(s.broker.recordSpawn(ticket, { ...proof, runToken: 'new-attempt' }), /Second execution/);
});
test('missing actual PID identity never manufactures a start event', async () => {
  const s = setup(initialSchedulerState(), { inspectSpawn: () => null });
  const ticket = await admit(s);
  await assert.rejects(
    s.broker.recordSpawn(ticket, { pid: 1234, runToken: 'attempt', fingerprint: 'hash' }),
    /identity unavailable/,
  );
  assert.equal(s.saved.events.filter((e) => e.executionStarted).length, 0);
});
