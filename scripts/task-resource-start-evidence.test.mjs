import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStartedRunner } from './task-resource-start-evidence.mjs';
import { createNotificationOutbox } from './task-resource-notifications.mjs';
const spec = {
  id: 'owned-job',
  task: 'stable-task',
  stage: 'small-check',
  worktree: '/tmp',
  command: '/node',
  args: [],
  fingerprint: 'sha',
  env: {},
  restartable: true,
  externalResources: false,
};
function setup() {
  let data = { version: 1 },
    notices = { version: 1 },
    sends = 0,
    launches = 0;
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const store = {
    read: () => structuredClone(data),
    write: (s) => {
      data = structuredClone(s);
    },
  };
  const outbox = createNotificationOutbox({
    store: {
      read: () => structuredClone(notices),
      write: (s) => {
        notices = structuredClone(s);
      },
    },
    mac: async (n) => {
      sends++;
      return { eventId: n.eventId, status: 'submitted' };
    },
  });
  const options = {
    store,
    outbox,
    resolveTask: () => ({ stableId: 'stable-task', label: '921' }),
    runnerOptions: {
      fingerprint: async () => 'sha',
      appendLog() {},
      inspect: () => ({ pid: 4321, pgid: 4321, startTime: 'born' }),
      groupEmpty: () => true,
      launch() {
        launches++;
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
    },
  };
  return { options, child, outbox, runner: createStartedRunner(options), sends: () => sends, launches: () => launches };
}
const end = (s) => {
  s.child.emit('exit', 0);
  s.child.emit('close', 0, null);
};
test('only verified spawn produces durable proof and one Mac start notification', async () => {
  const s = setup();
  assert.equal(s.runner.exportStarts().added, 0);
  const h = await s.runner.start(spec);
  assert.equal(h.notificationExport.added, 1);
  assert.equal(s.runner.snapshot().startEvents[0].executionStarted, true);
  await s.outbox.pump();
  end(s);
  await h.completion;
  const restored = createStartedRunner(s.options);
  restored.exportStarts();
  await s.outbox.pump();
  assert.equal(s.sends(), 1);
});
test('restarted coordinator never adopts old active PID or spawns same unresolved job', async () => {
  const s = setup();
  const h = await s.runner.start(spec);
  const restored = createStartedRunner(s.options);
  await assert.rejects(restored.start(spec), /Unreconciled/);
  assert.equal(s.launches(), 1);
  end(s);
  await h.completion;
});
test('unknown process identity produces no start notification', async () => {
  const s = setup();
  s.options.runnerOptions.inspect = () => null;
  const runner = createStartedRunner(s.options);
  await assert.rejects(runner.start(spec), /identity not proved/);
  assert.equal(runner.exportStarts().added, 0);
  end(s);
});
test('notification storage failure cannot undo a verified spawn', async () => {
  const s = setup();
  const runner = createStartedRunner({
    ...s.options,
    outbox: {
      enqueue() {
        throw Error('outbox full');
      },
    },
  });
  const h = await runner.start(spec);
  assert.match(h.notificationExport.pendingError, /full/);
  assert.equal(runner.snapshot().startEvents.length, 1);
  end(s);
  await h.completion;
});
test('a completed job starting again gets a different run token and one new notice', async () => {
  const s = setup();
  const h = await s.runner.start(spec);
  end(s);
  await h.completion;
  // A new controller is needed; never repurpose an old process handle.
  const restored = createStartedRunner(s.options);
  const next = await restored.start(spec);
  assert.notEqual(h.identity.runToken, next.identity.runToken);
  assert.equal(next.notificationExport.added, 1);
  end(s);
  await next.completion;
});

test('launch intent persistence failure prevents process creation', async () => {
  const s = setup();
  const runner = createStartedRunner({
    ...s.options,
    store: {
      read: () => ({ version: 1 }),
      write() {
        throw Error('disk full');
      },
    },
  });
  await assert.rejects(runner.start(spec), /disk full/);
  assert.equal(s.launches(), 0);
});
test('spawn proof write failure emits no unpersisted start event', async () => {
  const s = setup();
  let state = { version: 1 },
    writes = 0;
  const runner = createStartedRunner({
    ...s.options,
    store: {
      read: () => structuredClone(state),
      write(next) {
        if (++writes === 2) throw Error('proof storage failed');
        state = structuredClone(next);
      },
    },
  });
  await assert.rejects(runner.start(spec), /proof storage failed/);
  assert.equal(runner.exportStarts().added, 0);
  assert.equal(s.launches(), 1);
  end(s);
});
