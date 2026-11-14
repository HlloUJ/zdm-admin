import test from 'node:test';
import assert from 'node:assert/strict';
import { runSchedulerSession } from './task-resource-session.mjs';
import { submitMacNotification } from './task-resource-notifications.mjs';
test('slow notification cannot prevent independent scheduler ticks', async () => {
  const stop = new AbortController();
  let ticks = 0,
    release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await runSchedulerSession({
    signal: stop.signal,
    broker: {
      tick() {
        ticks++;
        if (ticks === 3) {
          stop.abort();
          release();
        }
      },
      snapshot: () => ({ jobs: [], events: [] }),
    },
    outbox: { pump: () => held, enqueue() {} },
    resolveTask() {},
    sample: async () => ({}),
    sleep: async () => {
      await new Promise((r) => setImmediate(r));
    },
  });
  assert.equal(ticks, 3);
});
test('notification storage failure is reported while scheduling continues', async () => {
  const stop = new AbortController();
  let ticks = 0;
  const health = [];
  await runSchedulerSession({
    signal: stop.signal,
    broker: {
      tick() {
        if (++ticks === 2) stop.abort();
      },
      snapshot() {
        throw Error('notification export unavailable');
      },
    },
    outbox: {},
    resolveTask() {},
    sample: async () => ({}),
    onNotificationHealth: (v) => health.push(v),
    sleep: async () => {
      await new Promise((r) => setImmediate(r));
    },
  });
  assert.equal(ticks, 2);
  assert.ok(health.some((v) => v.status === 'pending-error'));
});
test('async native submission does not claim accepted before command completes', async () => {
  let release,
    settled = false;
  const pending = submitMacNotification(
    { eventId: 'isolated', title: 'test', body: 'test' },
    {
      execute: () =>
        new Promise((r) => {
          release = r;
        }),
    },
  ).then((v) => {
    settled = true;
    return v;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  assert.equal((await pending).status, 'submitted');
});

test('queued stage waits through pressure and starts automatically only after stable recovery', async () => {
  const { createAdmissionBroker } = await import('./task-resource-broker.mjs');
  const { initialSchedulerState } = await import('./task-resource-scheduler.mjs');
  const { createScheduledVerification } = await import('./task-resource-verification.mjs');
  const { createNotificationOutbox } = await import('./task-resource-notifications.mjs');
  const stop = new AbortController();
  const G = 1024 ** 3;
  let state = initialSchedulerState(),
    notices = {},
    clock = 0,
    ticks = 0,
    starts = 0,
    notifications = 0;
  const store = {
    read: () => structuredClone(state),
    write: (s) => {
      state = structuredClone(s);
    },
  };
  const broker = createAdmissionBroker({
    store,
    now: () => clock,
    budget: () => ({ macPeakBytes: G, dockerPeakBytes: 0 }),
    validateEvidence: (r) => r.evidence === 'fixture',
    inspectSpawn: (pid) => ({ pid, pgid: pid, startTime: 'mock-only' }),
  });
  const run = createScheduledVerification({
    taskId: 'isolated',
    broker,
    inspect: () => ({ fingerprint: 'fixture' }),
    run: async (task, options) => {
      starts++;
      assert.ok(clock >= 80000);
      options.onSpawn({ pid: 4321, runToken: 'fixture-attempt', fingerprint: 'fixture' });
      return { exitCode: 0, evidence: 'fixture' };
    },
  });
  const outbox = createNotificationOutbox({
    store: {
      read: () => structuredClone(notices),
      write: (s) => {
        notices = structuredClone(s);
      },
    },
    mac: async (n) => {
      notifications++;
      stop.abort();
      return { status: 'submitted', eventId: n.eventId };
    },
  });
  const execution = run({ root: '/isolated', name: 'gate', command: 'not-executed', args: [] });
  await new Promise((r) => setImmediate(r));
  await runSchedulerSession({
    broker,
    outbox,
    resolveTask: () => ({ stableId: 'isolated', label: '921 test' }),
    signal: stop.signal,
    sample: async () => {
      assert.ok(++ticks < 20, 'fixture did not resume');
      clock = (ticks - 1) * 10000;
      if (clock < 80000) assert.equal(starts, 0);
      return {
        at: clock,
        macAvailableBytes: 10 * G,
        dockerAvailableBytes: 6 * G,
        diskAvailableBytes: 20 * G,
        cpuBusyPercent: clock < 20000 ? 95 : 10,
        memoryPressure: false,
        swapGrowing: false,
        ioCongested: false,
      };
    },
    sleep: async () => {
      await new Promise((r) => setImmediate(r));
    },
  });
  assert.equal((await execution).exitCode, 0);
  assert.equal(starts, 1);
  assert.equal(notifications, 1);
  assert.equal(state.jobs[0].status, 'done');
});
