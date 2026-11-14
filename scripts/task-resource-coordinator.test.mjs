import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinatorSession } from './task-resource-coordinator.mjs';
import { initialSchedulerState, RESOURCE_POLICY } from './task-resource-scheduler.mjs';
const memory = (initial) => {
  let state = structuredClone(initial);
  return {
    read: () => structuredClone(state),
    write: (v) => {
      state = structuredClone(v);
    },
  };
};
const descriptor = {
  task: '921-test',
  stage: 'light',
  worktree: '/fixture',
  fingerprint: 'fixture',
  commandDigest: 'cmd',
  restartable: false,
  externalResources: true,
  resources: ['fixture'],
  kind: 'node',
};
function setup(initial = initialSchedulerState(), overrides = {}) {
  let clock = 0,
    closed = 0,
    notices = 0;
  const options = {
    store: memory(initial),
    journal: memory({}),
    notificationStore: memory({}),
    policy: { ...RESOURCE_POLICY, recoveryMs: 1000 },
    thresholds: {
      sampleMaxAgeMs: 15000,
      trendMaxGapMs: 30000,
      macReserveBytes: 100,
      dockerMemoryPsi: 5,
      dockerIoPsi: 10,
      swapGrowthBytes: 64,
    },
    resolveBudget: () => ({ macPeakBytes: 1, dockerPeakBytes: 0, evidence: 'fixture-only' }),
    validateEvidence: () => true,
    resolveTask: (id) => ({ stableId: id, label: id }),
    now: () => clock,
    collect: async () => ({
      at: clock,
      errors: [],
      macMemory: { availableEstimateBytes: 20 * 1024 ** 3 },
      cpuBusyPercent: 5,
      swapUsedBytes: 0,
      diskAvailableBytes: 30 * 1024 ** 3,
      dockerMemory: { availableBytes: 8 * 1024 ** 3 },
      dockerMemoryPressure10: 0,
      dockerIoPressure10: 0,
    }),
    sleep: async () => {
      clock += 1000;
      await new Promise((r) => setImmediate(r));
    },
    mac: async (n) => {
      notices++;
      return { status: 'submitted', eventId: n.eventId };
    },
    closeOwnedStores: () => {
      closed++;
    },
    ...overrides,
  };
  return {
    options,
    get closed() {
      return closed;
    },
    get notices() {
      return notices;
    },
  };
}
const call = (s, id, method, ...args) => s.dispatch({ id, method, args });
test('explicit lifecycle connects queue and sampling, admission alone never notifies', async () => {
  const f = setup(),
    s = createCoordinatorSession(f.options);
  const ticket = await call(s, 'enqueue', 'enqueue', descriptor);
  await s.start();
  for (let n = 0; n < 30 && s.status().jobs[0].status !== 'starting'; n++) await new Promise((r) => setImmediate(r));
  assert.equal(s.status().jobs[0].status, 'starting');
  assert.equal(s.status().jobs[0].id, ticket.id);
  assert.equal(f.notices, 0);
  const status = await s.stop();
  assert.equal(status.jobs[0].status, 'waiting-client');
  assert.equal(status.canClose, true);
  await assert.rejects(() => call(s, 'late', 'enqueue', descriptor), /draining/);
  await s.close();
  assert.equal(f.closed, 1);
});
test('unknown budget and missing explicit policy cannot admit', async () => {
  const f = setup(undefined, { resolveBudget: () => null }),
    s = createCoordinatorSession(f.options);
  await assert.rejects(() => call(s, 'unknown', 'enqueue', descriptor), /budget unavailable/);
  assert.equal(s.status().jobs.length, 0);
  await s.close();
  assert.throws(() => createCoordinatorSession({ ...setup().options, policy: undefined }), /Explicit policy/);
});
test('old active jobs are never adopted; queued budgets must be reverified', () => {
  const state = initialSchedulerState();
  state.jobs = [{ ...descriptor, id: 'old', status: 'running' }];
  assert.throws(() => createCoordinatorSession(setup(state).options), /Unreconciled/);
  state.jobs[0].status = 'queued';
  assert.throws(
    () => createCoordinatorSession(setup(state, { resolveBudget: () => null }).options),
    /budget unavailable/,
  );
});
test('sampling error drains and preserves fault without retry loop', async () => {
  const f = setup(undefined, {
      collect: async () => {
        throw Error('sample-offline');
      },
    }),
    s = createCoordinatorSession(f.options);
  await s.start();
  for (let n = 0; n < 20 && !s.status().fault; n++) await new Promise((r) => setImmediate(r));
  assert.equal(s.status().fault, 'sample-offline');
  assert.equal(s.status().phase, 'draining');
  await s.close();
  assert.equal(f.closed, 1);
});
test('only proven historical start sends once; same outbox replay does not repeat', async () => {
  const state = initialSchedulerState();
  state.jobs = [{ ...descriptor, id: 'done', status: 'done' }];
  state.events = [
    {
      id: 1,
      job: 'done',
      task: descriptor.task,
      stage: 'light',
      from: 'starting',
      to: 'running',
      at: 0,
      reason: 'fixture-start',
      executionStarted: true,
      runToken: 'fixture-run',
    },
    {
      id: 2,
      job: 'done',
      task: descriptor.task,
      stage: 'light',
      from: 'running',
      to: 'done',
      at: 1,
      reason: 'fixture-done',
    },
  ];
  state.revision = 2;
  const f = setup(state);
  const first = createCoordinatorSession(f.options);
  await first.start();
  for (let n = 0; n < 20 && !f.notices; n++) await new Promise((r) => setImmediate(r));
  await first.close();
  assert.equal(f.notices, 1);
  const second = createCoordinatorSession(f.options);
  await second.start();
  await new Promise((r) => setImmediate(r));
  await second.close();
  assert.equal(f.notices, 1);
});
test('stop never releases active ownership; original completion RPC remains available', async () => {
  const f = setup(),
    s = createCoordinatorSession(f.options),
    ticket = await call(s, 'create', 'enqueue', descriptor);
  await s.start();
  for (let n = 0; n < 30 && s.status().jobs[0].status !== 'starting'; n++) await new Promise((r) => setImmediate(r));
  const j = s.status().jobs[0];
  await call(s, 'claim', 'assertAdmission', ticket, { id: j.id, token: j.admissionToken }, descriptor);
  await s.stop();
  await assert.rejects(() => s.close(), /Original active work/);
  assert.equal(f.closed, 0);
  assert.equal(f.notices, 0);
  await call(s, 'finished', 'complete', ticket, { exitCode: 0, evidence: 'fixture' });
  await s.close();
  assert.equal(f.closed, 1);
});
