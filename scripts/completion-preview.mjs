import { hasFixedPreview, createFixedCompletionPreviewControl } from './completion-fixed-preview.mjs';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { servicePaths, readServiceStatus, requestJson } from './task-preview-service.mjs';
import { inspectManagedPreview } from './dev-task.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { assertPreviewOwner, previewOwner } from './preview-transition.mjs';
import { assertDevelopmentApi } from './preview-policy.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { stopLeasedTaskFrontend } from './task-preview-independent.mjs';

// Use the installed compatible service; never install, replace its launcher or choose integration API.
export function createCompletionPreviewControl({
  execute,
  paths = servicePaths(),
  readStatus = () => readServiceStatus(paths),
  inspect = inspectManagedPreview,
  registry = createTaskRegistry,
  references = taskRuntimeReferences,
  stopIndependent = stopLeasedTaskFrontend,
  readLease = (common, resource) => createResourceLeases(common).inspect(resource),
  request = requestJson,
  readInstalled = () => {
    assert.ok(
      lstatSync(paths.configFile).isFile() && !lstatSync(paths.configFile).isSymbolicLink(),
      'Unsafe installed preview configuration',
    );
    return JSON.parse(readFileSync(paths.configFile, 'utf8'));
  },
} = {}) {
  const directory = paths.runtimeDirectory ?? (paths.configFile ? path.dirname(paths.configFile) : null);
  const fixedConfig = directory ? path.join(path.dirname(directory), 'fixed-frontend', 'config.json') : null;
  if (hasFixedPreview(fixedConfig))
    return createFixedCompletionPreviewControl({ configFile: fixedConfig, execute, inspect, references, registry });
  async function assertOwner(plan) {
    const status = await readStatus();
    assert.equal(status?.type, 'zdm-task-preview-service', 'Preview ownership is unknown');
    assert.ok(
      ['running', 'offline', 'preview-unavailable', 'integration-fallback', 'error', 'starting', 'retrying'].includes(
        status.phase,
      ),
      'Preview service phase is unknown',
    );
    assert.ok(
      status.worktree === null || (typeof status.worktree === 'string' && path.isAbsolute(status.worktree)),
      'Preview ownership is unknown',
    );
    assert.ok(
      status.phase !== 'offline' || (status.selectionKnown === true && status.installed === true),
      'Offline preview ownership or installation is unknown',
    );
    if (status.worktree !== null) {
      const owned = [plan.task, plan.preview].some(
        (root) => root && path.resolve(root) === path.resolve(status.worktree),
      );
      if (!owned && plan.taskRegistryVersion === 2) {
        const tasks = registry(plan.anchor ?? plan.task);
        assert.equal(tasks.commonDir, plan.common, 'Preview registry belongs to another repository');
        const foreign = tasks.resolve({ worktree: status.worktree });
        assert.notEqual(foreign.stage, 'closed', 'Selected task is already closed');
        assert.equal(status.phase, 'running', 'Another selected task is not healthy; preserve it');
        return { ...status, preservedTask: { id: foreign.id, branch: foreign.branch, worktree: foreign.worktree } };
      }
      assert.ok(owned, 'Preview belongs to another task; do not stop or switch it');
    } else assert.ok(status.childPid === null, 'Unowned preview child remains');
    return status;
  }
  async function retainedReady(plan) {
    const status = await assertOwner(plan);
    if (
      status.phase === 'offline' ||
      status.worktree === null ||
      path.resolve(status.worktree) !== path.resolve(plan.preview)
    )
      return false;
    const result = await inspect({
      expectedWorkspaceRoot: plan.preview,
      expectedBranch: 'codex/preview-current',
      expectedMode: 'full',
    });
    if (!result.metadata || result.errors.length) return false;
    return /^http:\/\/127\.0\.0\.1:(?:808[1-9]|809\d)$/.test(result.metadata.apiTarget);
  }
  function installedLauncher(plan) {
    const installed = readInstalled();
    for (const key of ['nodePath', 'launcherPath'])
      assert.ok(
        typeof installed[key] === 'string' && path.isAbsolute(installed[key]) && existsSync(installed[key]),
        'Installed compatible preview launcher is unavailable',
      );
    assert.ok(
      readFileSync(installed.launcherPath, 'utf8').includes("from './task-data-environment.mjs'"),
      'Installed launcher cannot prove persistent isolated data; do not reinstall or downgrade',
    );
    const launcherRoot = path.dirname(path.dirname(installed.launcherPath));
    const common = execute(launcherRoot, 'git', ['rev-parse', '--git-common-dir']);
    assert.equal(
      path.resolve(launcherRoot, common),
      path.resolve(plan.common),
      'Installed launcher belongs to another repository',
    );
    return installed;
  }
  function checkInstalled(plan, worktree = plan.preview) {
    const installed = installedLauncher(plan);
    // The installed data-aware launcher proves actual registered backend/data bindings.
    execute(worktree, installed.nodePath, [installed.launcherPath, '--check', '--worktree', worktree]);
  }
  async function checkPreserved(plan, owner) {
    const expected = previewOwner(owner),
      task = owner.preservedTask;
    const result = await inspect({
      expectedWorkspaceRoot: task.worktree,
      expectedBranch: task.branch,
      expectedMode: 'full',
    });
    assert.ok(
      result.metadata && result.errors.length === 0,
      'Another selected task lost its preview identity or API health',
    );
    assertDevelopmentApi(result.metadata.apiTarget);
    checkInstalled(plan, task.worktree);
    const after = await assertOwner(plan);
    assert.equal(after.preservedTask?.id, task.id, 'Selected task changed during handoff checks');
    assertPreviewOwner(expected, after);
    return { ready: true, reused: true, worktree: task.worktree, preservedTask: task.id };
  }
  async function check(plan) {
    const owner = await assertOwner(plan);
    if (owner.preservedTask) return checkPreserved(plan, owner);
    assert.ok(await retainedReady(plan), 'Retained preview identity, full mode or API health is unavailable');
    checkInstalled(plan);
    assert.ok(await retainedReady(plan), 'Retained preview changed during its data binding check');
    return { ready: true };
  }
  async function ensure(plan) {
    const owner = await assertOwner(plan);
    if (owner.preservedTask) return checkPreserved(plan, owner);
    assert.ok(
      !owner.worktree || path.resolve(owner.worktree) !== path.resolve(plan.task),
      'Old task is still selected; complete its owned handoff before switching',
    );
    const reused = await retainedReady(plan);
    if (!reused) {
      // Fail before starting anything if the installed isolated launcher cannot be proven.
      installedLauncher(plan);
      if (plan.taskRegistryVersion === 2) {
        assert.equal(owner.taskSelectionProtocol, 2, 'Reviewed multi-task runtime must be installed before handoff');
        const task = registry(plan.anchor).resolve({ worktree: plan.task });
        await request({
          paths,
          method: 'POST',
          requestPath: '/retain-task',
          timeoutMs: 300_000,
          payload: {
            task: task.id,
            owner: task.owner,
            worktree: task.worktree,
            main: plan.main,
            expected: previewOwner(owner),
          },
        });
        await check(plan);
        return { reused: false, worktree: plan.preview, mode: 'full' };
      }
      execute(plan.anchor, process.execPath, [
        path.join(plan.anchor, 'scripts/task-preview-service.mjs'),
        'switch',
        '--worktree',
        plan.preview,
        '--mode',
        'full',
      ]);
    }
    await check(plan);
    return { reused, worktree: plan.preview, mode: 'full' };
  }
  async function prepareHandoff(plan, owner) {
    if (plan.taskRegistryVersion === 2) await quiesceTemporary(plan);
    if (plan.taskRegistryVersion !== 2 || !plan.previewNeedsAdvance || owner.worktree !== plan.preview)
      return { paused: false };
    assert.equal(owner.taskSelectionProtocol, 2, 'Reviewed runtime must support protected retained advance');
    const task = registry(plan.anchor).resolve({ worktree: plan.task });
    await request({
      paths,
      method: 'POST',
      requestPath: '/pause-retained',
      timeoutMs: 300_000,
      payload: {
        task: task.id,
        owner: task.owner,
        worktree: task.worktree,
        main: plan.main,
        expected: previewOwner(owner),
      },
    });
    return { paused: true };
  }
  async function quiesceTemporary(plan) {
    const task = registry(plan.anchor).resolve({ worktree: plan.task });
    const snapshot = await references(task),
      installed = installedLauncher(plan);
    for (const frontend of snapshot.owned.filter((item) => item.port >= 5177)) {
      assert.equal(frontend.metadata.branch, task.branch, 'Temporary preview branch changed');
      if (frontend.metadata.runtimeId) {
        const lease = readLease(plan.common, 'temporary-port-' + frontend.port);
        assert.ok(
          lease && lease.task === task.id && lease.token === frontend.metadata.runtimeId,
          'Independent preview lease changed; preserve source and runtime',
        );
        await stopIndependent(task, { ...lease, port: frontend.port });
      }
      execute(task.worktree, installed.nodePath, [
        installed.launcherPath,
        '--worktree',
        task.worktree,
        '--stop',
        '--port',
        String(frontend.port),
      ]);
    }
    return snapshot;
  }
  async function prepareComposition(plan) {
    const owner = await assertOwner(plan);
    const snapshot = await quiesceTemporary(plan);
    if (snapshot.owned.length === 0 && snapshot.backendPorts.length === 0) {
      if (owner.preservedTask) await checkPreserved(plan, owner);
      return { quiesced: true, runtimeAbsent: true, preservedTask: owner.preservedTask?.id ?? null };
    }
    assert.equal(owner.taskSelectionProtocol, 2, 'Install the reviewed task runtime before composing a live task');
    installedLauncher(plan);
    const task = registry(plan.anchor).resolve({ worktree: plan.task });
    const response = await request({
      paths,
      method: 'POST',
      requestPath: '/prepare-task-delivery',
      timeoutMs: 300_000,
      payload: {
        task: task.id,
        owner: task.owner,
        worktree: task.worktree,
        candidate: task.recordedHead,
        main: plan.main,
        expected: previewOwner(owner),
      },
    });
    if (owner.preservedTask) await checkPreserved(plan, owner);
    return response;
  }
  return { assertOwner, ensure, check, prepareHandoff, prepareComposition };
}
