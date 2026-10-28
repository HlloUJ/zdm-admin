import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { servicePaths, readServiceStatus } from './task-preview-service.mjs';
import { inspectManagedPreview } from './dev-task.mjs';

// Use the installed compatible service; never install, replace its launcher or choose integration API.
export function createCompletionPreviewControl({
  execute,
  paths = servicePaths(),
  readStatus = () => readServiceStatus(paths),
  inspect = inspectManagedPreview,
  readInstalled = () => {
    assert.ok(
      lstatSync(paths.configFile).isFile() && !lstatSync(paths.configFile).isSymbolicLink(),
      'Unsafe installed preview configuration',
    );
    return JSON.parse(readFileSync(paths.configFile, 'utf8'));
  },
} = {}) {
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
    if (status.worktree !== null)
      assert.ok(
        [plan.task, plan.preview].some((root) => root && path.resolve(root) === path.resolve(status.worktree)),
        'Preview belongs to another task; do not stop or switch it',
      );
    else assert.ok(status.childPid === null, 'Unowned preview child remains');
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
  function checkInstalled(plan) {
    const installed = installedLauncher(plan);
    // The installed data-aware launcher proves actual registered backend/data bindings.
    execute(plan.preview, installed.nodePath, [installed.launcherPath, '--check', '--worktree', plan.preview]);
  }
  async function check(plan) {
    assert.ok(await retainedReady(plan), 'Retained preview identity, full mode or API health is unavailable');
    checkInstalled(plan);
    assert.ok(await retainedReady(plan), 'Retained preview changed during its data binding check');
    return { ready: true };
  }
  async function ensure(plan) {
    const owner = await assertOwner(plan);
    assert.ok(
      !owner.worktree || path.resolve(owner.worktree) !== path.resolve(plan.task),
      'Old task is still selected; complete its owned handoff before switching',
    );
    const reused = await retainedReady(plan);
    if (!reused) {
      // Fail before starting anything if the installed isolated launcher cannot be proven.
      installedLauncher(plan);
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
  return { assertOwner, ensure, check };
}
