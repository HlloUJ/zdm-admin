import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { validateTaskDependencies } from './task-dependencies.mjs';
import { previewDescriptor } from './preview-policy.mjs';
import { previewDataFile, readTaskData } from './task-data-environment.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { encoding: 'utf8' });
function regular(file) {
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Unsafe preview input: ' + file);
  return readFileSync(file);
}
export function previewSourceDigest(root) {
  const files = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    // Include all source/configuration, including deletions. Build/test outputs are ignored by Git.
    const full = path.join(root, file);
    hash.update(file).update('\0');
    hash.update(existsSync(full) ? regular(full) : Buffer.from('deleted')).update('\0');
  }
  return hash.digest('hex');
}
export function preparePreviewTarget(root, request, config) {
  const registry = createTaskRegistry(root);
  const task = registry.resolve({ id: request.task, worktree: request.worktree });
  assert.equal(task.owner, request.owner, 'Preview request does not own this task');
  assert.ok(!task.frozen, 'Task is frozen for delivery; do not restart its development runtime');
  assert.ok(!task.recovery?.runtimeBlocked, 'Historical recovery candidate must be reviewed before preview');
  assert.ok(
    task.resources.dataScope === 'isolated-task' || task.resources.persistentPreviewOwner === true,
    'Unproved cross-task database compatibility; prepare this task with task:data isolate before switching. Do not start it against another unfinished task database',
  );
  const taskArgs = request.taskArgs ?? ['--mode', 'full'];
  assert.deepEqual(
    taskArgs,
    ['--mode', 'full'],
    'Task switching currently requires the isolated full-stack launcher; use a proved compatibility path for frontend reuse',
  );
  const descriptor = previewDescriptor('development', { task });
  return prepareRuntimeInputs(task, descriptor, taskArgs, registry.commonDir, config);
}
function prepareRuntimeInputs(task, descriptor, taskArgs, commonDir, config) {
  const modules = path.join(task.worktree, 'node_modules');
  assert.ok(
    existsSync(modules) && !lstatSync(modules).isSymbolicLink(),
    'Prepare private task dependencies before selecting preview',
  );
  validateTaskDependencies(task.worktree);
  const launcher = regular(config.launcherPath).toString();
  assert.ok(
    launcher.includes("from './task-data-environment.mjs'"),
    'Do not downgrade the installed data-aware launcher',
  );
  const dataFile = previewDataFile(task.worktree);
  const dataBytes = regular(dataFile);
  const data = JSON.parse(dataBytes);
  assert.equal(data.version, 1, 'Unknown persistent preview data schema');
  assert.equal(data.repository, commonDir, 'Preview data belongs to another repository');
  assert.equal(data.profile?.status, 'ready', 'Preview data is not ready; do not recreate it');
  assert.ok(/^zdm_task_[a-f0-9]{16}$/.test(data.profile?.database), 'Integration or unknown database is forbidden');
  assert.ok(
    /^zdm-task-media-[a-f0-9]{16}$/.test(data.profile?.mediaVolume),
    'Integration or unknown media is forbidden',
  );
  readTaskData(task.worktree); // Full namespace, password-shape and profile ownership validation.
  return {
    task,
    descriptor,
    taskArgs,
    sourceDigest: previewSourceDigest(task.worktree),
    launcherDigest: digest(regular(config.launcherPath)),
    dataDigest: digest(dataBytes),
    dataFile,
    interruption: 'protected-handoff-on-fixed-port',
  };
}
export function prepareRetainedTarget(root, worktree, main, config) {
  assert.match(main, /^[a-f0-9]{40}$/, 'Exact published main required');
  const registry = createTaskRegistry(root),
    retained = createTaskRegistry(worktree);
  assert.equal(retained.commonDir, registry.commonDir, 'Retained preview belongs to another repository');
  assert.equal(git(worktree, 'branch', '--show-current').trim(), 'codex/preview-current');
  assert.equal(git(worktree, 'status', '--porcelain').trim(), '', 'Retained preview is dirty');
  assert.equal(git(worktree, 'rev-parse', 'HEAD').trim(), main);
  assert.equal(git(worktree, 'rev-parse', 'origin/main').trim(), main);
  const remote = execFileSync('git', ['-C', root, 'ls-remote', 'origin', 'refs/heads/main'], {
    encoding: 'utf8',
    timeout: 30_000,
  }).trim();
  assert.equal(remote, main + '\trefs/heads/main', 'Retained preview is no longer the published main');
  const task = { id: 'retained-preview', worktree, branch: 'codex/preview-current', stage: 'main-verified' };
  return {
    ...prepareRuntimeInputs(
      task,
      { role: 'development', source: 'published-main', main },
      ['--mode', 'full'],
      registry.commonDir,
      config,
    ),
    retainedMain: main,
  };
}
export function validatePreparedTarget(prepared, config) {
  const registry = createTaskRegistry(prepared.task.worktree);
  const task = prepared.retainedMain
    ? prepared.task
    : registry.resolve({ id: prepared.task.id, worktree: prepared.task.worktree });
  if (prepared.retainedMain) {
    assert.equal(git(task.worktree, 'branch', '--show-current').trim(), 'codex/preview-current');
    assert.equal(git(task.worktree, 'rev-parse', 'HEAD').trim(), prepared.retainedMain);
  } else assert.equal(task.revision, prepared.task.revision, 'Task registration changed during preview preparation');
  assert.equal(
    previewSourceDigest(task.worktree),
    prepared.sourceDigest,
    'Task source changed during preview preparation',
  );
  assert.equal(digest(regular(config.launcherPath)), prepared.launcherDigest, 'Installed launcher changed');
  assert.equal(digest(regular(prepared.dataFile)), prepared.dataDigest, 'Preview data binding changed');
}
