import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, realpathSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';
import { developmentReviewStatus, assertStoredDevelopmentReview } from './task-review.mjs';
import path from 'node:path';
import { assertAcceptedSource, readAcceptance } from './accepted-source.mjs';
import { deliveryStatus } from './completion-status.mjs';
const context = new AsyncLocalStorage();
export const withTaskContext = (identity, action) => context.run(identity, action);
export function closeTaskBatch(root, batch) {
  const registry = createTaskRegistry(root),
    task = registry.readTask(batch.id);
  assert.ok(task && !task.compatibility?.readOnly, 'Exact current task required');
  assert.ok(['handoff-verified', 'closed'].includes(task.stage), 'Task runtime handoff is incomplete');
  const git = (...args) =>
    execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { encoding: 'utf8' }).trim();
  const local = git('rev-parse', 'main'),
    remote = git('rev-parse', 'origin/main');
  assert.equal(local, remote);
  git('merge-base', '--is-ancestor', task.recordedHead, local);
  assert.ok(
    !existsSync(task.worktree) && !registeredTaskWorktrees(root).some((entry) => entry.worktree === task.worktree),
    'Current task carrier remains',
  );
  for (const ref of ['refs/heads/' + task.branch, 'refs/remotes/origin/' + task.branch])
    assert.equal(git('for-each-ref', '--format=%(objectname)', ref), '', 'Current task ref remains');
  const closed =
    task.stage === 'closed'
      ? task
      : registry.revise(task.id, task.revision, (record) => {
          record.stage = 'closed';
          record.closedAt = new Date().toISOString();
          record.main = { local, remote, remoteFreshnessProven: false };
        });
  assert.equal(closed.main.local, local, 'Closed task main identity changed');
  const archived = {
    ...taskBatch(closed, root),
    closureNote: 'Registry closure only; exact CI, runtime and cleanup remain proven by the task completion receipt.',
  };
  const directory = path.join(registry.commonDir, 'task-batches/archive');
  for (const entry of [path.dirname(directory), directory])
    if (existsSync(entry)) assert.ok(!lstatSync(entry).isSymbolicLink(), 'Unsafe legacy archive');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, task.id + '.json');
  // Compatibility readers consume this historical archive, never an active copy.
  if (existsSync(file)) {
    assert.ok(!lstatSync(file).isSymbolicLink());
    assert.deepEqual(JSON.parse(readFileSync(file)), archived, 'Conflicting historical task archive');
  } else writeFileSync(file, JSON.stringify(archived, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return archived;
}
export function taskBatch(task, root) {
  const anchor = registeredTaskWorktrees(root).filter((entry) => entry.branch === 'main');
  assert.equal(anchor.length, 1, 'Exact main anchor required');
  const reviewStatus = task.frozen || task.stage === 'closed' ? null : developmentReviewStatus(task.worktree, task);
  return {
    ...task,
    ...(reviewStatus ? { developmentReview: reviewStatus } : {}),
    version: 1,
    taskRegistryVersion: 2,
    repository: { ...task.repository, anchor: realpathSync(anchor[0].worktree) },
    modules: [
      {
        id: task.id,
        title: task.title ?? task.id,
        status: (reviewStatus ? reviewStatus.developmentComplete : task.development?.reviewed === true)
          ? 'ready'
          : 'in-progress',
        dependsOn: [],
        checkpoints: task.checkpoints,
      },
    ],
  };
}
export function selectedTaskBatch(root) {
  const registry = createTaskRegistry(root);
  const bound = context.getStore();
  let task;
  if (bound) {
    assert.equal(bound.commonDir, registry.commonDir, 'Bound completion belongs to another repository');
    task = registry.readTask(bound.id);
    assert.ok(task, 'Bound task was removed');
    assert.equal(task.owner, bound.owner, 'Bound completion task owner changed');
  } else if (process.env.ZDM_TASK_ID) {
    task = registry.readTask(process.env.ZDM_TASK_ID);
    assert.ok(task, 'Explicit task is not registered');
  } else if (existsSync(root)) {
    const matching = registry.list().filter((item) => item.worktree === realpathSync(root));
    assert.ok(matching.length < 2, 'Ambiguous task worktree');
    task = matching[0];
  }
  if (!task) return null;
  assert.ok(!task.compatibility?.readOnly, 'Legacy task is preserved read-only; use its reviewed recovery path');
  return taskBatch(task, root);
}
export function validateTaskBatch(root, batch) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id: batch.id, worktree: batch.worktree });
  assert.equal(task.branch, batch.branch, 'Task branch changed');
  return taskBatch(task, root);
}
export function assertTaskDevelopmentSnapshot(batch) {
  if (batch.taskRegistryVersion !== 2) return;
  assertStoredDevelopmentReview(batch.worktree, batch);
}
export function planTaskDelivery(root, batch) {
  batch = validateTaskBatch(root, batch);
  const registry = createTaskRegistry(root);
  const git = (...args) =>
    execFileSync('git', ['--no-replace-objects', '-C', batch.worktree, ...args], { encoding: 'utf8' }).trim();
  assert.equal(git('status', '--porcelain'), '', 'Task must be clean before delivery planning');
  if (!batch.frozen) assert.equal(batch.modules[0].status, 'ready', 'Current task development review is incomplete');
  if (batch.frozen) {
    assert.equal(
      readAcceptance(batch.worktree, batch.id)?.commit,
      batch.frozen.accepted,
      'Original accepted source changed',
    );
    assertAcceptedSource(batch.worktree, batch.id, git('rev-parse', 'HEAD'));
  } else assertTaskDevelopmentSnapshot(batch);
  const head = git('rev-parse', 'HEAD'),
    originMain = git('rev-parse', 'origin/main');
  assert.equal(head, batch.recordedHead, 'Checkpoint the exact current task head');
  for (const dependencyId of batch.dependsOn) {
    const dependency = registry.readTask(dependencyId);
    assert.ok(
      dependency?.stage === 'closed' && dependency.closedAt && dependency.main?.local,
      'Declared dependency is not formally delivered: ' + dependencyId,
    );
    assert.equal(
      deliveryStatus(path.join(registry.commonDir, 'task-delivery', dependencyId), dependencyId, dependency)
        .formalDeliveryComplete,
      true,
      'Declared dependency has no complete formal receipt: ' + dependencyId,
    );
    git('merge-base', '--is-ancestor', dependency.main.local, originMain);
  }
  const commits = git('rev-list', '--reverse', batch.base + '..' + head, '--not', originMain)
    .split('\n')
    .filter(Boolean);
  const owned = new Set(batch.checkpoints.map((item) => item.commit));
  for (const commit of commits) assert.ok(owned.has(commit), 'Unassigned task commit: ' + commit);
  return {
    type: 'delivery-plan',
    taskRegistryVersion: 2,
    batchId: batch.id,
    branch: batch.branch,
    worktree: batch.worktree,
    base: batch.base,
    head,
    originMain,
    commits,
    modules: batch.modules,
    businessDevelopmentReviewed: batch.development?.reviewed === true,
    originalDevelopmentStateRetained: Boolean(batch.frozen),
    verificationProven: false,
    requiredExternalChecks: [
      'Exact candidate and main CI',
      'Serialized authorized main merge',
      'Owned runtime handoff and safe current-task cleanup',
    ],
  };
}
