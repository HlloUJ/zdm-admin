import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOwnedRunner, inspectProcess, processGroupEmpty } from './task-resource-runner.mjs';
const spec = {
  id: 'only-owned',
  worktree: '/isolated/task',
  fingerprint: 'sha',
  command: '/node',
  args: ['worker'],
  env: {},
  restartable: true,
  externalResources: false,
};
function setup(overrides = {}) {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const events = [],
    signals = [];
  const options = {
    appendLog: () => {},
    fingerprint: async () => 'sha',
    saveIntent: async (v) => events.push(['intent', v]),
    saveIdentity: async (v) => events.push(['identity', v]),
    launch: () => {
      events.push(['launch']);
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    inspect: () => ({ pid: 4321, pgid: 4321, startTime: 'born-now' }),
    groupEmpty: () => true,
    signal: (pid) => signals.push(pid),
    ...overrides,
  };
  return { runner: createOwnedRunner(options), child, events, signals };
}
test('persist launch intent before spawn and exact identity after; no shell', async () => {
  const s = setup();
  const h = await s.runner.start(spec);
  assert.deepEqual(
    s.events.map((x) => x[0]),
    ['intent', 'launch', 'identity'],
  );
  assert.ok(h.identity.runToken);
  s.child.emit('exit', 0);
  s.child.emit('close', 0, null);
  const done = await h.completion;
  assert.equal(done.processesEnded, true);
  s.runner.release(spec.id);
});
test('TERM only own running process group with matching run token and birth identity', async () => {
  const s = setup();
  const h = await s.runner.start(spec);
  s.runner.stop(spec.id, h.identity.runToken);
  assert.deepEqual(s.signals, [4321]);
  assert.throws(() => s.runner.stop(spec.id, 'wrong'));
  assert.throws(() => s.runner.stop('user-chrome', h.identity.runToken));
});
test('refuse legacy gates/external containers even if PID owned', async () => {
  for (const change of [{ restartable: false }, { externalResources: true }]) {
    const s = setup();
    const h = await s.runner.start({ ...spec, ...change });
    assert.throws(() => s.runner.stop(spec.id, h.identity.runToken));
    assert.deepEqual(s.signals, []);
  }
});
test('do not signal PID reuse or exited leader', async () => {
  let identity = { pid: 4321, pgid: 4321, startTime: 'born-now' };
  const s = setup({ inspect: () => identity });
  const h = await s.runner.start(spec);
  identity = { ...identity, startTime: 'other-process' };
  assert.throws(() => s.runner.stop(spec.id, h.identity.runToken));
  identity = { ...identity, startTime: 'born-now' };
  s.child.emit('exit', 0);
  assert.throws(() => s.runner.stop(spec.id, h.identity.runToken));
  assert.deepEqual(s.signals, []);
});
test('source change blocks before any launch', async () => {
  const s = setup({ fingerprint: async () => 'changed' });
  await assert.rejects(s.runner.start(spec));
  assert.deepEqual(s.events, []);
});
test('intent persistence failure prevents spawn; identity persistence failure retains live controller', async () => {
  const first = setup({
    saveIntent: async () => {
      throw Error('disk');
    },
  });
  await assert.rejects(first.runner.start(spec));
  assert.deepEqual(first.events, []);
  const second = setup({
    saveIdentity: async () => {
      throw Error('disk');
    },
  });
  await assert.rejects(second.runner.start(spec));
  assert.ok(second.runner.describe(spec.id).identity);
});
test('missing process inspection blocks stop, never guesses by process name', async () => {
  const s = setup({ inspect: () => null });
  await assert.rejects(s.runner.start(spec));
  assert.throws(() => s.runner.stop(spec.id, s.runner.describe(spec.id).runToken));
  assert.deepEqual(s.signals, []);
});
test('remaining children prevent release and success termination proof', async () => {
  const s = setup({ groupEmpty: () => false });
  const h = await s.runner.start(spec);
  s.child.emit('exit', 0);
  s.child.emit('close', 0, null);
  assert.equal((await h.completion).processesEnded, false);
  assert.throws(() => s.runner.release(spec.id));
});
test('new controller never adopts stored PIDs', () => {
  const s = setup();
  assert.throws(() => s.runner.stop(spec.id, 'old-run'));
  assert.deepEqual(s.signals, []);
});
test('process parser treats permission error as unknown not ended', () => {
  assert.deepEqual(
    inspectProcess(42, () => '42 42 Fri Nov 13 17:00:00 2026'),
    { pid: 42, pgid: 42, startTime: 'Fri Nov 13 17:00:00 2026' },
  );
  assert.throws(() =>
    inspectProcess(42, () => {
      const e = Error('denied');
      e.status = 1;
      e.stderr = 'denied';
      throw e;
    }),
  );
  assert.equal(
    processGroupEmpty(42, () => '1\n43\n'),
    true,
  );
  assert.equal(
    processGroupEmpty(42, () => '42\n43\n'),
    false,
  );
});
test('concurrent same-job launches rejected before second spawn', async () => {
  let release;
  const wait = new Promise((r) => (release = r));
  const s = setup({
    fingerprint: async () => {
      await wait;
      return 'sha';
    },
  });
  const first = s.runner.start(spec);
  await assert.rejects(s.runner.start(spec));
  release();
  await first;
  assert.equal(s.events.filter((e) => e[0] === 'launch').length, 1);
});
test('repeated stop cannot issue repeated signals', async () => {
  const s = setup();
  const h = await s.runner.start(spec);
  s.runner.stop(spec.id, h.identity.runToken);
  assert.throws(() => s.runner.stop(spec.id, h.identity.runToken));
  assert.equal(s.signals.length, 1);
});
test('lost logs cannot become a successful run', async () => {
  const s = setup({
    appendLog: () => {
      throw Error('log disk full');
    },
  });
  const h = await s.runner.start(spec);
  s.child.stdout.emit('data', Buffer.from('evidence'));
  s.child.emit('exit', 0);
  s.child.emit('close', 0, null);
  const result = await h.completion;
  assert.equal(result.commandExitCode, 0);
  assert.equal(result.code, 1);
  assert.equal(result.logError, 'log disk full');
});
