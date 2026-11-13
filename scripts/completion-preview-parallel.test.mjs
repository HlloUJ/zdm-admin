import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCompletionPreviewControl } from './completion-preview.mjs';
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'parallel-handoff-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const launcher = path.join(directory, 'scripts/dev-task.mjs');
  mkdirSync(path.dirname(launcher));
  writeFileSync(launcher, "import { x } from './task-data-environment.mjs';");
  const plan = {
    anchor: '/repo/main',
    task: '/repo/a',
    preview: '/repo/preview-current',
    common: '/repo/.git',
    main: 'a'.repeat(40),
    taskRegistryVersion: 2,
  };
  const foreign = { id: 'b', owner: 'chat-b', branch: 'codex/b', worktree: '/repo/b', stage: 'developing' };
  const state = {
    type: 'zdm-task-preview-service',
    worktree: foreign.worktree,
    phase: 'running',
    taskSelectionProtocol: 2,
    servicePid: 1,
    childPid: 2,
    selectionRevision: 3,
  };
  const events = [];
  const options = {
    paths: { configFile: path.join(directory, 'legacy/config.json') },
    execute: (root, command, args) => {
      if (command === 'git') return plan.common;
      assert.deepEqual(args, [launcher, '--check', '--worktree', foreign.worktree]);
      events.push('check-data:b');
      return '';
    },
    readStatus: async () => ({ ...state }),
    registry: () => ({ commonDir: plan.common, resolve: () => foreign }),
    readInstalled: () => ({ nodePath: process.execPath, launcherPath: launcher }),
    inspect: async (expected) => {
      events.push(expected);
      return {
        metadata: {
          workspaceRoot: foreign.worktree,
          branch: foreign.branch,
          mode: 'full',
          apiTarget: 'http://127.0.0.1:8082',
        },
        errors: [],
      };
    },
    request: () => assert.fail('A handoff must not send a switch or stop for B'),
  };
  return { plan, foreign, state, events, options };
}
test('A delivery preserves selected unfinished B and checks its actual API/data without switching it', async (t) => {
  const f = fixture(t),
    control = createCompletionPreviewControl(f.options);
  const result = await control.ensure(f.plan);
  assert.equal(result.preservedTask, 'b');
  assert.equal(result.reused, true);
  assert.equal(f.state.worktree, '/repo/b');
  assert.equal(f.events[0].expectedWorkspaceRoot, '/repo/b');
  assert.ok(f.events.includes('check-data:b'));
  await control.check(f.plan);
});
test('unknown, closed or unhealthy foreign preview cannot authorize A cleanup or a takeover', async (t) => {
  for (const condition of ['unknown', 'closed', 'unhealthy']) {
    const f = fixture(t);
    if (condition === 'unknown')
      f.options.registry = () => ({
        commonDir: f.plan.common,
        resolve: () => {
          throw Error('unregistered');
        },
      });
    if (condition === 'closed') f.foreign.stage = 'closed';
    if (condition === 'unhealthy') f.options.inspect = async () => ({ metadata: {}, errors: ['API not UP'] });
    await assert.rejects(createCompletionPreviewControl(f.options).ensure(f.plan));
    assert.equal(f.state.worktree, '/repo/b');
  }
});
test('a preview switch during A handoff invalidates the old proof and preserves the new owner', async (t) => {
  const f = fixture(t),
    inspect = f.options.inspect;
  f.options.inspect = async (expected) => {
    const result = await inspect(expected);
    f.state.selectionRevision++;
    return result;
  };
  await assert.rejects(createCompletionPreviewControl(f.options).check(f.plan), /owner changed/);
  assert.equal(f.state.worktree, '/repo/b');
});
test('formal handoff stops nonce-bound task previews before using the installed legacy backend launcher', async (t) => {
  const f = fixture(t);
  const task = {
    id: 'a',
    owner: 'chat-a',
    worktree: f.plan.task,
    branch: 'codex/a',
    repository: { commonDir: f.plan.common },
    frozen: { accepted: 'original' },
  };
  const lease = { resource: 'temporary-port-5177', task: 'a', token: 'runtime-a', pid: 42 };
  f.options.registry = () => ({ resolve: () => task });
  f.options.references = async () => ({
    backendPorts: [8081],
    owned: [{ port: 5177, metadata: { branch: task.branch, runtimeId: lease.token } }],
  });
  f.options.readLease = (common, resource) => {
    assert.equal(common, f.plan.common);
    assert.equal(resource, lease.resource);
    return lease;
  };
  let stopped = false;
  f.options.stopIndependent = async (actual, actualLease) => {
    assert.equal(actual, task);
    assert.deepEqual(actualLease, { ...lease, port: 5177 });
    stopped = true;
  };
  f.options.execute = (root, command, args) => {
    if (command === 'git') return f.plan.common;
    assert.equal(stopped, true, 'Old launcher cannot stop nonce-bound frontend');
    assert.deepEqual(args.slice(1), ['--worktree', task.worktree, '--stop', '--port', '5177']);
  };
  await createCompletionPreviewControl(f.options).prepareHandoff(f.plan, f.state);
  stopped = false;
  f.options.readLease = () => ({ ...lease, token: 'new-runtime' });
  await assert.rejects(createCompletionPreviewControl(f.options).prepareHandoff(f.plan, f.state), /lease changed/);
  assert.equal(stopped, false);
});
