import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PreviewSupervisor, resumeServiceSelection, assertPreviewConsumersReleased } from './task-preview-service.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { previewOwner } from './preview-transition.mjs';
function fixture(t, { targetFailure = false, stopFailure = false } = {}) {
  const common = mkdtempSync(path.join(tmpdir(), 'preview-selection-'));
  t.after(() => rmSync(common, { recursive: true, force: true }));
  const tasks = ['a', 'b'].map((id) => ({
    id,
    owner: 'chat-' + id,
    worktree: '/repo/' + id,
    branch: 'codex/' + id,
    stage: 'developing',
  }));
  const events = [];
  let pid = 20;
  const gateway = {
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
  const leases = createResourceLeases(common);
  const config = {
    launcherPath: '/launcher/scripts/dev-task.mjs',
    nodePath: process.execPath,
    selectedWorktree: tasks[0].worktree,
    taskArgs: ['--mode', 'full'],
    taskRegistryProtocol: 2,
  };
  const supervisor = new PreviewSupervisor({}, config, gateway, {
    createTaskRegistry: () => ({
      commonDir: common,
      resolve: ({ id, worktree }) => {
        const record = tasks.find((x) => (id ? x.id === id : x.worktree === worktree));
        assert.ok(record);
        return record;
      },
      list: () => tasks,
    }),
    createResourceLeases: () => leases,
    resolveRetainedPreview: () => '/repo/preview-current',
    prepareRetainedTarget: () => ({}),
    frozenRestoreArgs: (_config, _root, args) => args,
    assertPreviewConsumersReleased: async () => {},
    proveTaskDeliveryFreeze: () => {},
    proveRetainedAdvance: () => events.push('prove-retained-advance'),
    preparePreviewTarget: () => {
      events.push('prepare');
      assert.equal(leases.inspect('preview-5175').task, 'b');
      return {};
    },
    validatePreparedTarget: () => events.push('validate'),
    resolveTaskWorktree: (root) => ({ root, branch: 'codex/' + path.basename(root) }),
    writeConfig: () => events.push('save'),
    ensureDockerReady: async () => {},
    stopChild: async (child) => {
      if (child) child.exitCode = 0;
    },
    stopRetainedBackend: async (config, root) => {
      events.push('backend-stop:' + root);
      if (stopFailure) throw Error('backend stop failure');
    },
    spawn: () => Object.assign(new EventEmitter(), { pid: ++pid, exitCode: null }),
    waitForPreview: async (root) => {
      events.push('ready:' + root);
      if (targetFailure && root === '/repo/b') throw Error('target unhealthy');
      return { branch: 'codex/' + path.basename(root) };
    },
    checkSelectedPreview: async () => {},
    log: () => {},
    error: () => {},
  });
  supervisor.child = Object.assign(new EventEmitter(), { pid, exitCode: null });
  supervisor.currentWorktree = tasks[0].worktree;
  supervisor.currentTaskArgs = ['--mode', 'full'];
  supervisor.phase = 'running';
  t.after(() => supervisor.clearRestart());
  const request = { task: 'b', owner: 'chat-b', worktree: '/repo/b', expected: previewOwner(supervisor.status()) };
  return { supervisor, request, events, leases, tasks };
}
test('supervisor selects one registered task under preview lease without requiring other tasks to finish', async (t) => {
  const f = fixture(t);
  const result = await f.supervisor.selectTask(f.request);
  assert.equal(result.status.worktree, '/repo/b');
  assert.equal(result.status.phase, 'running');
  assert.equal(f.leases.inspect('preview-5175'), null);
  assert.equal(f.events.filter((x) => x === 'backend-stop:/repo/a').length, 1);
  await assert.rejects(f.supervisor.selectTask(f.request), /owner changed/);
});
test('frozen task source can be quiesced before main composition without stopping another selected task', async (t) => {
  const f = fixture(t),
    task = f.tasks[0],
    main = 'a'.repeat(40),
    candidate = 'b'.repeat(40);
  task.stage = 'frozen';
  task.frozen = { accepted: 'c'.repeat(40) };
  task.recordedHead = candidate;
  f.supervisor.config.selectedWorktree = '/repo/b';
  f.supervisor.currentWorktree = '/repo/b';
  const before = previewOwner(f.supervisor.status());
  const request = { task: 'a', owner: 'chat-a', worktree: '/repo/a', main, candidate, expected: before };
  await assert.rejects(f.supervisor.selectTask({ ...request, candidate: 'd'.repeat(40) }, true, true), /准确冻结候选/);
  assert.equal(f.events.length, 0);
  await f.supervisor.selectTask(request, true, true);
  assert.deepEqual(previewOwner(f.supervisor.status()), before);
  assert.deepEqual(f.events, ['backend-stop:/repo/a']);
});
test('selected frozen A hands the preview to published retained data before changing A source', async (t) => {
  const f = fixture(t),
    task = f.tasks[0],
    candidate = 'b'.repeat(40);
  task.stage = 'frozen';
  task.frozen = { accepted: 'c'.repeat(40) };
  task.recordedHead = candidate;
  const result = await f.supervisor.selectTask(
    {
      task: 'a',
      owner: 'chat-a',
      worktree: '/repo/a',
      candidate,
      main: 'a'.repeat(40),
      expected: previewOwner(f.supervisor.status()),
    },
    true,
    true,
  );
  assert.equal(result.status.worktree, '/repo/preview-current');
  assert.ok(f.events.indexOf('backend-stop:/repo/a') < f.events.indexOf('ready:/repo/preview-current'));
  assert.ok(!f.events.includes('ready:/repo/a'));
});
test('wrong owner and stale queued request cannot stop the selected task', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.supervisor.selectTask({ ...f.request, owner: 'wrong-chat' }), /身份不匹配/);
  assert.equal(f.events.length, 0);
  const results = await Promise.allSettled([f.supervisor.selectTask(f.request), f.supervisor.selectTask(f.request)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(f.events.filter((x) => x === 'backend-stop:/repo/a').length, 1);
});
test('supervisor restores and health-checks old selected task when the target fails', async (t) => {
  const f = fixture(t, { targetFailure: true });
  await assert.rejects(f.supervisor.selectTask(f.request), /previous preview was restored/);
  assert.equal(f.supervisor.status().worktree, '/repo/a');
  assert.equal(f.supervisor.status().phase, 'running');
  assert.ok(f.events.includes('ready:/repo/a'));
  assert.equal(f.leases.inspect('preview-5175'), null);
});
test('failed backend stop retains previous task ownership and never starts target', async (t) => {
  const f = fixture(t, { stopFailure: true });
  await assert.rejects(f.supervisor.selectTask(f.request), /backend stop failure/);
  assert.equal(f.supervisor.status().worktree, '/repo/a');
  assert.equal(f.supervisor.status().phase, 'error');
  assert.ok(!f.events.includes('ready:/repo/b'));
});
test('activated multi-task service rejects legacy unscoped switch before any mutation', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.supervisor.switch('/repo/b'), /准确身份切换/);
  assert.equal(f.events.length, 0);
});
test('retained handoff requires main proof and cannot stop another selected task', async (t) => {
  const f = fixture(t),
    main = 'a'.repeat(40);
  await assert.rejects(f.supervisor.selectTask({ ...f.request, main }, true), /准确 main 验收/);
  f.tasks[1].stage = 'main-verified';
  f.tasks[1].main = { local: main };
  await assert.rejects(f.supervisor.selectTask({ ...f.request, main }, true), /另一个任务/);
  assert.equal(f.events.length, 0);
});
test('finished selected task hands off to retained preview using the same protected transaction', async (t) => {
  const f = fixture(t),
    main = 'a'.repeat(40);
  f.tasks[0].stage = 'main-verified';
  f.tasks[0].main = { local: main };
  const request = { ...f.request, task: 'a', owner: 'chat-a', worktree: '/repo/a', main };
  const result = await f.supervisor.selectTask(request, true);
  assert.equal(result.status.worktree, '/repo/preview-current');
  assert.equal(result.status.phase, 'running');
  assert.equal(f.leases.inspect('preview-5175'), null);
});
test('retained source advances only after stopping its old runtime and keeps a durable hold across restart', async (t) => {
  const f = fixture(t),
    main = 'a'.repeat(40);
  f.tasks[0].stage = 'main-verified';
  f.tasks[0].main = { local: main };
  f.supervisor.config.selectedWorktree = '/repo/preview-current';
  f.supervisor.currentWorktree = '/repo/preview-current';
  const request = {
    task: 'a',
    owner: 'chat-a',
    worktree: '/repo/a',
    main,
    expected: previewOwner(f.supervisor.status()),
  };
  const paused = await f.supervisor.pauseRetained(request);
  assert.equal(paused.childPid, null);
  assert.equal(paused.phase, 'preview-unavailable');
  assert.equal(paused.handoffHold.task, 'a');
  await assert.rejects(f.supervisor.launchSelected(), /交接尚未完成/);
  await assert.rejects(
    f.supervisor.selectTask({ ...f.request, expected: previewOwner(f.supervisor.status()) }),
    /交接尚未完成/,
  );
  const retained = await f.supervisor.selectTask({ ...request, expected: previewOwner(f.supervisor.status()) }, true);
  assert.equal(retained.status.phase, 'running');
  assert.equal(retained.status.handoffHold, null);
  assert.ok(f.events.indexOf('backend-stop:/repo/preview-current') < f.events.indexOf('ready:/repo/preview-current'));
});

test('service restart resumes a registered selection through its serialized launch instead of forbidden legacy switch', async (t) => {
  const f = fixture(t);
  f.supervisor.child = null;
  f.supervisor.phase = 'starting';
  const result = await resumeServiceSelection(f.supervisor);
  assert.equal(result.phase, 'running');
  assert.equal(result.worktree, '/repo/a');
  assert.ok(f.events.includes('ready:/repo/a'));
  const legacy = [];
  await resumeServiceSelection({
    config: { selectedWorktree: '/legacy/a', taskArgs: ['--mode', 'full'] },
    switch: async (...args) => legacy.push(args),
  });
  assert.deepEqual(legacy, [['/legacy/a', ['--mode', 'full']]]);
});
test('live temporary consumers block before selected child or backend is stopped, including retained advance', async (t) => {
  const f = fixture(t);
  f.supervisor.dependencies.assertPreviewConsumersReleased = () => {
    throw Error('consumer still active');
  };
  await assert.rejects(f.supervisor.selectTask(f.request), /consumer still active/);
  assert.equal(f.supervisor.child.exitCode, null);
  assert.ok(!f.events.some((event) => event.startsWith('backend-stop:')));
  f.tasks[0].stage = 'main-verified';
  f.tasks[0].main = { local: 'a'.repeat(40) };
  f.supervisor.config.selectedWorktree = '/repo/preview-current';
  f.supervisor.currentWorktree = '/repo/preview-current';
  await assert.rejects(
    f.supervisor.pauseRetained({
      task: 'a',
      owner: 'chat-a',
      worktree: '/repo/a',
      main: 'a'.repeat(40),
      expected: previewOwner(f.supervisor.status()),
    }),
    /consumer still active/,
  );
  assert.equal(f.supervisor.child.exitCode, null);
  assert.equal(f.supervisor.config.handoffHold, undefined);
});
test('consumer guard detects own temporary preview and foreign frontend sharing the selected API', async () => {
  for (const workspaceRoot of ['/repo/a', '/repo/foreign']) {
    await assert.rejects(
      assertPreviewConsumersReleased('/repo/a', async (url) => {
        const port = Number(new URL(url).port);
        if (port === 5176) return { workspaceRoot: '/repo/a', apiTarget: 'http://127.0.0.1:8081' };
        if (port === 5199) return { workspaceRoot, apiTarget: 'http://127.0.0.1:8081' };
        return null;
      }),
      /仍在引用/,
    );
  }
  await assertPreviewConsumersReleased('/repo/a', async (url) =>
    Number(new URL(url).port) === 5188 ? { workspaceRoot: '/repo/b', apiTarget: 'http://127.0.0.1:8082' } : null,
  );
});
