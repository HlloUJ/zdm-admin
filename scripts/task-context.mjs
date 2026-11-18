import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, realpathSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';
import path from 'node:path';
import { assertAcceptedSource, readAcceptance } from './accepted-source.mjs';
import { deliveryStatus } from './completion-status.mjs';
import { collectActionDependencies, requireActionDependencies } from './task-action-dependencies.mjs';
import { assertTaskCommitOwnership } from './task-commit-ownership.mjs';
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
  return {
    ...task,
    version: 1,
    taskRegistryVersion: 2,
    repository: { ...task.repository, anchor: realpathSync(anchor[0].worktree) },
    modules: [
      {
        id: task.id,
        title: task.title ?? task.id,
        // Preserve frozen/archive snapshots without deriving an active task's
        // readiness from the retired development metadata.
        status:
          (task.frozen || task.stage === 'closed') && task.development?.reviewed === true ? 'ready' : 'in-progress',
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
function readDependencyRuntime(task, source) {
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL('./task-dependency-runtime-cli.mjs', import.meta.url)), task.id, source.head],
        {
          cwd: task.worktree,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 30_000,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
        },
      ),
    );
  } catch {
    throw new Error('Pinned dependency preview has no current health, API and data identity proof');
  }
}
export function taskActionDependencies(root, batch, action, { runtime = readDependencyRuntime, candidate } = {}) {
  if (!(batch.dependsOn ?? []).length && !(batch.actionDependencies ?? []).length)
    return collectActionDependencies(batch, action, {});
  const registry = createTaskRegistry(root);
  const git = (cwd, ...args) =>
    execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  function checkpoint({ task: id, head }) {
    const recorded = registry.readTask(id);
    if (recorded?.stage === 'closed') {
      const proof = delivered({ task: id });
      assert.ok(
        recorded.checkpoints.some((item) => item.commit === head),
        'Dependency never owned the pinned SHA',
      );
      git(root, 'merge-base', '--is-ancestor', head, proof.main);
      return { task: id, head, tree: git(root, 'rev-parse', head + '^{tree}') };
    }
    const dependency = registry.resolve({ id });
    assert.equal(dependency.recordedHead, head, 'Dependency checkpoint changed');
    assert.ok(
      dependency.checkpoints.some((item) => item.commit === head),
      'No owned checkpoint at the pinned SHA',
    );
    assert.equal(git(dependency.worktree, 'rev-parse', 'HEAD'), head, 'Dependency source is on a different SHA');
    assert.equal(git(dependency.worktree, 'status', '--porcelain'), '', 'Dependency source has local changes');
    assertTaskCommitOwnership(dependency.worktree, dependency, head);
    return { task: dependency.id, head, tree: git(dependency.worktree, 'rev-parse', head + '^{tree}') };
  }
  function delivered({ task: id }) {
    const dependency = registry.readTask(id);
    assert.ok(
      dependency?.stage === 'closed' && dependency.closedAt && dependency.main?.local,
      'Declared dependency is not formally delivered: ' + id,
    );
    assert.equal(
      deliveryStatus(path.join(registry.commonDir, 'task-delivery', id), id, dependency).formalDeliveryComplete,
      true,
      'Declared dependency has no complete formal receipt: ' + id,
    );
    const main = git(root, 'rev-parse', 'origin/main');
    try {
      git(root, 'merge-base', '--is-ancestor', dependency.main.local, main);
    } catch {
      assert.fail('Dependent delivery is absent from origin/main: ' + id);
    }
    return { task: id, main: dependency.main.local, closedAt: dependency.closedAt };
  }
  return collectActionDependencies(batch, action, {
    source(dependency) {
      const proof = checkpoint(dependency);
      if (['combination', 'final'].includes(action)) {
        // An available checkpoint is useful for preparation. A combination
        // must also carry that input in its exact ancestry.
        const heads = candidate ? [candidate] : [batch.recordedHead, git(root, 'rev-parse', 'origin/main')];
        assert.ok(
          heads.some((head) => {
            if (!head) return false;
            try {
              git(root, 'merge-base', '--is-ancestor', proof.head, head);
              return true;
            } catch {
              return false;
            }
          }),
          'Pinned source is absent from the actual combination inputs',
        );
      }
      return proof;
    },
    runtime(dependency) {
      const source = checkpoint(dependency);
      assert.equal(typeof runtime, 'function', 'Current runtime identity must be verified by the action entry');
      const proof = runtime(registry.readTask(dependency.task), source);
      assert.equal(proof?.head, source.head, 'Runtime proof does not match the pinned source');
      assert.equal(proof.runtimeReady, true, 'Dependency runtime has not passed its original health checks');
      assert.deepEqual(checkpoint(dependency), source, 'Dependency source changed during runtime proof');
      return { source, runtime: proof };
    },
    delivery: delivered,
  });
}
export function taskDispatchDependencies(root, task, phase) {
  const report = taskActionDependencies(root, task, phase);
  if (phase !== 'final' || ['merged', 'main-verified', 'handoff-verified', 'closed'].includes(task.stage))
    return report;
  const composition = taskActionDependencies(root, task, 'combination');
  const dependencies = [
    ...report.dependencies,
    ...composition.dependencies.filter(
      (item) =>
        !report.dependencies.some(
          (other) => other.task === item.task && other.evidence === item.evidence && other.head === item.head,
        ),
    ),
  ];
  return { action: phase, ready: report.ready && composition.ready, dependencies };
}
export function assertDeliveredDependencies(root, batch, action = 'final', adapters) {
  return requireActionDependencies(taskActionDependencies(root, batch, action, adapters));
}
export function planTaskDelivery(root, batch, { action = 'final' } = {}) {
  batch = validateTaskBatch(root, batch);
  const git = (...args) =>
    execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-C', batch.worktree, ...args], {
      encoding: 'utf8',
    }).trim();
  assert.equal(git('status', '--porcelain'), '', 'Task must be clean before delivery planning');
  if (batch.frozen) {
    assert.equal(
      readAcceptance(batch.worktree, batch.id)?.commit,
      batch.frozen.accepted,
      'Original accepted source changed',
    );
    assertAcceptedSource(batch.worktree, batch.id, git('rev-parse', 'HEAD'));
  }
  const head = git('rev-parse', 'HEAD'),
    originMain = git('rev-parse', 'origin/main');
  assert.equal(head, batch.recordedHead, 'Checkpoint the exact current task head');
  assertDeliveredDependencies(root, batch, action);
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
    originalDevelopmentStateRetained: Boolean(batch.frozen),
    verificationProven: false,
    requiredExternalChecks: [
      'Exact candidate and main CI',
      'Serialized authorized main merge',
      'Owned runtime handoff and safe current-task cleanup',
    ],
  };
}
