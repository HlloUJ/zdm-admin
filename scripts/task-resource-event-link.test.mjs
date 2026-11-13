import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulerNotices, exportSchedulerNotices, tickWithNotificationExport } from './task-resource-event-link.mjs';
import { createNotificationOutbox } from './task-resource-notifications.mjs';
const snapshot = {
  jobs: [
    { id: 'a', status: 'done' },
    { id: 'b', status: 'running' },
  ],
  events: [
    { id: 1, job: 'a', task: 'task-a', stage: 'tests', from: 'queued', to: 'starting', reason: 'ready', at: 1 },
    {
      id: 2,
      job: 'a',
      task: 'task-a',
      stage: 'tests',
      from: 'starting',
      to: 'running',
      reason: 'started',
      executionStarted: true,
      runToken: 'run-a',
      at: 2,
    },
    { id: 3, job: 'b', task: 'task-b', stage: 'tests', from: 'queued', to: 'starting', reason: 'ready', at: 3 },
    {
      id: 4,
      job: 'b',
      task: 'task-b',
      stage: 'tests',
      from: 'starting',
      to: 'running',
      reason: 'started',
      executionStarted: true,
      runToken: 'run-b',
      at: 4,
    },
    { id: 5, job: 'a', task: 'task-a', stage: 'tests', from: 'running', to: 'done', reason: 'passed', at: 5 },
  ],
};
const resolveTask = (id) => ({ stableId: 'stable-' + id, label: id === 'task-a' ? '921' : '756' });
test('only actual starts produce notices with stable identity', () => {
  const ns = schedulerNotices(snapshot, resolveTask);
  assert.deepEqual(
    ns.map((n) => [n.parallelBefore, n.parallelAfter]),
    [
      [1, 1],
      [2, 2],
    ],
  );
  assert.equal(ns[0].taskStableId, 'stable-task-a');
  assert.match(ns[0].body, /任务 921 开始执行/);
});
test('source reconstruction and IDs remain stable across exports', () => {
  const first = schedulerNotices(snapshot, resolveTask);
  assert.deepEqual(schedulerNotices(structuredClone(snapshot), resolveTask), first);
  assert.equal(snapshot.jobs[0].status, 'done');
});
test('missing stable mapping blocks notification export, not safe admission', () => {
  let ticks = 0;
  const result = tickWithNotificationExport({
    broker: {
      tick() {
        ticks++;
        return ['admitted'];
      },
      snapshot: () => snapshot,
    },
    outbox: { enqueue() {} },
    resolveTask: () => null,
    sample: {},
  });
  assert.equal(ticks, 1);
  assert.deepEqual(result.actions, ['admitted']);
  assert.equal(result.notificationHealth, 'pending-error');
});
test('outbox storage failure leaves source events intact for later export', () => {
  const result = tickWithNotificationExport({
    broker: { tick: () => [], snapshot: () => snapshot },
    outbox: {
      enqueue() {
        throw Error('full');
      },
    },
    resolveTask,
    sample: {},
  });
  assert.equal(result.notificationHealth, 'pending-error');
  assert.equal(snapshot.events.length, 5);
});
test('restart repeats no already submitted notice; dashboard is disabled', async () => {
  let state = { notices: {} },
    macCalls = 0;
  const options = {
    store: { read: () => structuredClone(state), write: (s) => (state = structuredClone(s)) },
    mac: async (n) => {
      macCalls++;
      return { eventId: n.eventId, status: 'submitted' };
    },
  };
  let outbox = createNotificationOutbox(options);
  const broker = { snapshot: () => snapshot };
  assert.equal(exportSchedulerNotices({ broker, outbox, resolveTask }).added, 2);
  await outbox.pump();
  outbox = createNotificationOutbox(options);
  assert.equal(exportSchedulerNotices({ broker, outbox, resolveTask }).added, 0);
  await outbox.pump();
  assert.equal(macCalls, 2);
  assert.equal(Object.values(outbox.snapshot())[0].board.status, 'disabled');
});

test('admitted running without spawn proof does not claim work started', () => {
  const s = structuredClone(snapshot);
  for (const e of s.events) delete e.executionStarted;
  assert.deepEqual(schedulerNotices(s, resolveTask), []);
});
