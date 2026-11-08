import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { PreviewSupervisor, resumeServiceSelection, frozenRestoreArgs } from './task-preview-service.mjs';
import { previewOwner } from './preview-transition.mjs';

function fixture(t, { completionOwner = true, completionTask = 'fixture-a', targetFailure = false } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'frozen-preview-contract-'))),
    root = path.join(base, 'main');
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'scripts/dev-task.mjs'), '// fixture launcher path only\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const id of ['a', 'b']) git('worktree', 'add', '-b', 'codex/' + id, path.join(base, id));
  const registry = createTaskRegistry(root),
    a = registry.register({ id: 'a', worktree: path.join(base, 'a'), owner: 'fixture-a' });
  const b = registry.register({ id: 'b', worktree: path.join(base, 'b'), owner: 'fixture-b' });
  const head = git('rev-parse', 'HEAD');
  registry.revise(a.id, a.revision, (task) => {
    task.stage = 'frozen';
    task.frozen = { accepted: head, tree: git('rev-parse', 'HEAD^{tree}'), businessDigest: 'a'.repeat(64) };
  });
  const frozen = registry.resolve({ id: a.id }),
    leases = createResourceLeases(registry.commonDir);
  const completion = completionOwner ? leases.acquire('task-delivery-a', completionTask) : null;
  let pid = 20;
  const events = [],
    launches = [],
    gateway = {
      mode: 'task',
      status() {
        return { mode: this.mode, upstream: 'http://127.0.0.1:5176', listening: true };
      },
      useIntegration() {
        this.mode = 'preview-unavailable';
      },
      useTask() {
        this.mode = 'task';
      },
    };
  const config = {
    launcherPath: path.join(root, 'scripts/dev-task.mjs'),
    nodePath: process.execPath,
    selectedWorktree: a.worktree,
    taskArgs: ['--mode', 'full'],
    taskRegistryProtocol: 2,
  };
  const supervisor = new PreviewSupervisor({}, config, gateway, {
    createTaskRegistry,
    createResourceLeases,
    frozenRestoreArgs,
    assertPreviewConsumersReleased: async () => {},
    preparePreviewTarget: () => ({}),
    validatePreparedTarget: () => {},
    resolveTaskWorktree: (worktree) => ({ root: worktree, branch: 'codex/' + path.basename(worktree) }),
    writeConfig: () => events.push('save'),
    ensureDockerReady: async () => {},
    stopChild: async (child) => {
      if (child) child.exitCode = 0;
    },
    stopRetainedBackend: async (_config, worktree) => events.push('stop:' + path.basename(worktree)),
    spawn: (_command, args) => {
      launches.push([...args]);
      events.push('launch:' + path.basename(args[args.indexOf('--worktree') + 1]));
      return Object.assign(new EventEmitter(), { pid: ++pid, exitCode: null });
    },
    waitForPreview: async (worktree) => {
      if (targetFailure && worktree === b.worktree) throw Error('target unhealthy');
      return { branch: 'codex/' + path.basename(worktree) };
    },
    checkSelectedPreview: async () => {},
    log: () => {},
    error: () => {},
  });
  t.after(() => supervisor.clearRestart());
  function running() {
    supervisor.child = Object.assign(new EventEmitter(), { pid, exitCode: null });
    supervisor.currentWorktree = a.worktree;
    supervisor.currentTaskArgs = ['--mode', 'full'];
    supervisor.phase = 'running';
    return supervisor.child;
  }
  return { root, a, b, registry, frozen, leases, completion, head, supervisor, launches, events, running };
}

test('daemon restart acquires the original frozen task preview lease and retains exact live completion ownership', async (t) => {
  const f = fixture(t);
  f.supervisor.child = null;
  f.supervisor.phase = 'starting';
  const result = await resumeServiceSelection(f.supervisor);
  assert.equal(result.phase, 'running');
  assert.equal(result.worktree, f.a.worktree);
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.launches[0].slice(-4), ['--mode', 'full', '--validation-candidate', f.head]);
  assert.equal(f.leases.inspect('preview-5175'), null);
  assert.equal(f.leases.inspect('task-delivery-a').token, f.completion.token);
  assert.deepEqual(f.registry.resolve({ id: 'a' }).frozen, f.frozen.frozen);
});
test('target startup failure restores frozen A with its source lease, never borrowing B completion identity', async (t) => {
  const f = fixture(t, { targetFailure: true });
  f.running();
  await assert.rejects(
    f.supervisor.selectTask({
      task: 'b',
      owner: f.b.owner,
      worktree: f.b.worktree,
      expected: previewOwner(f.supervisor.status()),
    }),
    /previous preview was restored/,
  );
  assert.equal(f.supervisor.status().worktree, f.a.worktree);
  assert.equal(f.supervisor.status().phase, 'running');
  assert.ok(f.supervisor.child);
  assert.deepEqual(f.events, ['stop:a', 'save', 'launch:b', 'stop:b', 'save', 'launch:a']);
  assert.deepEqual(f.launches.at(-1).slice(-4), ['--mode', 'full', '--validation-candidate', f.head]);
  assert.equal(f.leases.inspect('preview-5175'), null);
  assert.equal(f.leases.inspect('task-delivery-b'), null);
  assert.deepEqual(f.registry.resolve({ id: 'a' }).frozen, f.frozen.frozen);
});
for (const state of ['missing-owner', 'changed-source', 'wrong-owner'])
  test(`an unrestorable frozen source is retained before stopping it: ${state}`, async (t) => {
    const f = fixture(t, {
      completionOwner: state !== 'missing-owner',
      completionTask: state === 'wrong-owner' ? 'fixture-b' : 'fixture-a',
    });
    if (state === 'changed-source') writeFileSync(path.join(f.a.worktree, 'new-source'), 'uncheckpointed');
    const child = f.running();
    await assert.rejects(
      f.supervisor.selectTask({
        task: 'b',
        owner: f.b.owner,
        worktree: f.b.worktree,
        expected: previewOwner(f.supervisor.status()),
      }),
      /冻结候选恢复归属或源码变化/,
    );
    assert.equal(f.supervisor.child, child);
    assert.deepEqual(f.events, []);
    assert.equal(f.supervisor.status().phase, 'running');
    assert.equal(f.supervisor.status().worktree, f.a.worktree);
  });
test('restart cannot take over another active preview transaction or release its lease', async (t) => {
  const f = fixture(t),
    foreign = f.leases.acquire('preview-5175', 'b');
  try {
    await assert.rejects(resumeServiceSelection(f.supervisor), /Resource is owned or interrupted/);
    assert.equal(f.leases.inspect('preview-5175').token, foreign.token);
    assert.deepEqual(f.launches, []);
  } finally {
    f.leases.release(foreign);
  }
});
