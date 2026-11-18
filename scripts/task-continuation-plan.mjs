import { readTaskData } from './task-data-environment.mjs';
import { validateTaskDependencies } from './task-dependencies.mjs';
import { assertCompletionQuality } from './completion-ci-evidence.mjs';
import { createProgressOutbox } from './task-progress-outbox.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { taskExecutor } from './task-execution-binding.mjs';
import { taskDispatchDependencies } from './task-context.mjs';
import { assertTaskCommitOwnership } from './task-commit-ownership.mjs';
import { isTechnicalPath } from './accepted-source-policy.mjs';
import { createTaskDeliveryQueue } from './task-delivery-queue.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { temporaryPreviewLeases } from './preview-consumers.mjs';
import { imageIdentity, readImageLock } from './ci-browser-image.mjs';
import { TASK_ACTIONS } from './task-action-dependencies.mjs';
import { readAcceptance, sourceDifference, sourceEntries } from './accepted-source.mjs';
import { coordinationDigest } from './task-coordination-next.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['--no-optional-locks', '--no-replace-objects', '-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function check(operation) {
  try {
    return { ready: true, value: operation() };
  } catch (error) {
    return { ready: false, reason: error.message };
  }
}

function readSession(common, task, head) {
  const file = path.join(common, 'task-delivery', task.id, 'completion-session.json');
  for (const item of [file, path.dirname(file), path.dirname(path.dirname(file))])
    if (existsSync(item)) assert.ok(!lstatSync(item).isSymbolicLink(), 'Linked completion evidence');
  if (!existsSync(file)) return null;
  const session = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(session.events), 'Unknown completion session');
  const candidate = session.events.find(
    (event) =>
      event.name === 'ci' &&
      event.status === 'success' &&
      event.result?.headSha === head &&
      event.result?.eventName === 'pull_request' &&
      event.result?.branch === task.branch,
  );
  const initialCi = candidate
    ? check(() => {
        assertCompletionQuality(candidate.result, head, candidate.result.runId);
        return { head, runId: String(candidate.result.runId) };
      })
    : { ready: false, reason: 'No first successful PR quality proof at the current SHA' };
  const reduced = session.events.map(({ name, key, status, result }) => ({
    name,
    key,
    status,
    head: result?.headSha ?? null,
    runId: result?.runId ?? null,
  }));
  return {
    digest: coordinationDigest(reduced),
    events: reduced.slice(-8),
    hasRunning: reduced.some((e) => e.status === 'running'),
    initialCi,
  };
}

// This is a read-only diagnostic, including Git status without optional locks.
// The shared Git object database is untouched; overlapping paths are warnings,
// never a claim that a future protected composition will merge.
export function continuationPlan(root, id) {
  const registry = createTaskRegistry(root);
  const task = registry.readTask(id);
  assert.ok(task && !task.compatibility?.readOnly, 'An exact current project task is required');
  const common = registry.commonDir;
  const queue = createExecutionOrder(common).read();
  const finalQueue = createTaskDeliveryQueue(common).inspect();
  const worktrees = registeredTaskWorktrees(root);
  const integration = worktrees.find((entry) => entry.branch === 'codex/integration-current');
  const main = git(root, 'rev-parse', 'origin/main');
  const source = check(() => {
    const entry = worktrees.find((record) => record.worktree === task.worktree && record.branch === task.branch);
    assert.ok(entry, 'Registered Git worktree differs or is missing');
    const head = git(task.worktree, 'rev-parse', 'HEAD');
    const branch = git(task.worktree, 'branch', '--show-current');
    assert.equal(branch, task.branch, 'Registered branch differs');
    const changes = git(task.worktree, 'status', '--porcelain=v1', '-z');
    const index = git(task.worktree, 'ls-files', '--stage', '-z');
    const conflicts = git(task.worktree, 'ls-files', '--unmerged');
    assert.equal(conflicts, '', 'Unmerged index entries remain');
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'])
      assert.ok(
        !existsSync(path.resolve(task.worktree, git(task.worktree, 'rev-parse', '--git-path', marker))),
        'Git operation remains: ' + marker,
      );
    return {
      head,
      clean: !changes,
      indexedIdentity: coordinationDigest(index),
      statusIdentity: coordinationDigest(changes),
    };
  });
  const frozen = check(() => {
    const acceptance = readAcceptance(task.worktree, task.id);
    if (!task.frozen) {
      assert.equal(acceptance, null, 'Accepted source exists without a frozen registry entry');
      return null;
    }
    assert.equal(acceptance?.commit, task.frozen.accepted, 'Original accepted source differs');
    assert.equal(acceptance.tree, task.frozen.tree, 'Original accepted tree differs');
    const composition = path.join(common, 'task-delivery', task.id, 'composition.json');
    // Validation of an existing composition reconstructs Git objects. Keep this
    // diagnostic read-only and have the actual protected entry reprove it.
    if (existsSync(composition)) {
      assert.ok(!lstatSync(composition).isSymbolicLink(), 'Existing composition proof is linked');
      return { accepted: acceptance.commit, tree: acceptance.tree, compositionNeedsRecheck: true };
    }
    const entries = (tree) => sourceEntries(task.worktree, tree, false, acceptance.tree, acceptance.protectedPaths);
    const changed = sourceDifference(entries(acceptance.tree), entries(source.value?.head));
    assert.deepEqual(changed, [], 'Protected source differs from the original frozen tree');
    assert.equal(existsSync(composition), false, 'Composition changed during the read-only freeze check');
    return { accepted: acceptance.commit, tree: acceptance.tree, compositionNeedsRecheck: false };
  });
  const deliverySession = check(() => readSession(common, task, source.value?.head));
  const progress = check(() => {
    const outbox = createProgressOutbox(path.join(common, 'task-progress', task.id)).read();
    return {
      pending: outbox.pending.map(({ receipt_id, receipt, revision, failure }) => ({
        receiptId: receipt_id,
        event: receipt.event,
        sequence: receipt.sequence,
        prepared: revision !== undefined,
        knownFailure: failure?.code ?? null,
      })),
      acknowledged: outbox.acknowledged.length,
      retired: outbox.retired?.length ?? 0,
    };
  });
  const taskPackages = check(() => {
    const proof = validateTaskDependencies(task.worktree);
    assert.equal(proof.modules, path.join(task.worktree, 'node_modules'), 'Task packages point outside this worktree');
    return { packagesChecked: proof.packagesChecked };
  });
  const taskData = check(() => ({ registered: Boolean(readTaskData(task.worktree)), liveDatabaseProven: false }));
  const environment = check(() => ({
    image: imageIdentity(readImageLock(task.worktree)),
    lockfileDigest: coordinationDigest(readFileSync(path.join(task.worktree, 'package-lock.json'), 'utf8')),
    runtimeBlocked: Boolean(task.recovery?.runtimeBlocked),
    integrationDatabaseLocked: Boolean(
      integration && existsSync(path.join(integration.worktree, 'backups/task-preview/active-database-task.json')),
    ),
  }));
  const resources = check(() => {
    const leases = createResourceLeases(common);
    return {
      finalQueue: finalQueue.tickets.map(({ task: ownerTask, status }) => ({ task: ownerTask, status })),
      finalLease: Boolean(leases.inspect('main-delivery')),
      integrationLease: Boolean(leases.inspect('integration-5173')),
      previewPorts: temporaryPreviewLeases(common)
        .filter((lease) => lease.task === task.id)
        .map((lease) => lease.port),
    };
  });
  const overlap =
    source.ready && source.value.clean
      ? check(() => {
          const base = git(root, 'merge-base', main, source.value.head);
          const names = (head) =>
            git(root, 'diff', '--no-renames', '--name-only', '-z', base, head).split('\0').filter(Boolean);
          const mainPaths = new Set(names(main));
          const shared = names(source.value.head).filter((file) => mainPaths.has(file));
          const declared = new Set(readAcceptance(task.worktree, task.id)?.protectedPaths ?? []);
          const entry = (commit, file) => git(root, '--literal-pathspecs', 'ls-tree', commit, '--', file);
          const protectedDeleteModify = shared.filter(
            (file) =>
              (declared.has(file) || !isTechnicalPath(file)) &&
              entry(base, file) &&
              Boolean(entry(main, file)) !== Boolean(entry(source.value.head, file)),
          );
          return { samePathChanges: shared, protectedDeleteModify, confirmsMergeability: false };
        })
      : null;
  const tickets = (queue?.tickets ?? []).filter((ticket) => ticket.task === task.id);
  const activeDispatch = (queue?.dynamicDecisions ?? [])
    .filter(
      (record) =>
        record.input.task === task.id &&
        (record.status === 'reserved' ||
          [queue.scopedAdmission, ...(queue.scopedAdmissions ?? [])].some((scope) => scope?.decisionId === record.id)),
    )
    .map(({ id: decisionId, status, input: { phase } }) => ({ decisionId, status, phase }));
  const plannedSource =
    source.ready && source.value.clean
      ? check(() => {
          const carrier = registry.resolve({ id: task.id, worktree: task.worktree });
          assert.equal(carrier.recordedHead, source.value.head, 'Checkpoint the exact current task head');
          return assertTaskCommitOwnership(task.worktree, task, source.value.head);
        })
      : { ready: false, reason: 'A clean task checkpoint is required for delivery planning' };

  const actions = TASK_ACTIONS.map((action) => {
    const dependencyCheck = check(() => taskDispatchDependencies(root, task, action));
    const reasons = [];
    const lane = action === 'development' ? 'development' : 'delivery';
    const ticket = tickets.find((record) => record.lane === lane);
    if (!dependencyCheck.ready) reasons.push(dependencyCheck.reason);
    else
      for (const blocked of dependencyCheck.value.dependencies.filter((item) => !item.ready))
        reasons.push(blocked.task + ': ' + blocked.reason);
    if (!source.ready) reasons.push(source.reason);
    if (task.stage === 'closed' || (action === 'development' && task.frozen))
      reasons.push('Task stage excludes this action');
    if (activeDispatch.length) reasons.push('Existing dispatch requires readback before planning another');
    if (['development', 'preparation', 'final'].includes(action) && !ticket)
      reasons.push('Missing ' + lane + ' phase ticket');
    if (action === 'development' && ticket?.status === 'completed')
      reasons.push('Verified development is already complete');
    if (action !== 'development' && !frozen.ready) reasons.push(frozen.reason);
    const initialCi = deliverySession.value?.initialCi;
    const merged = ['merged', 'main-verified', 'handoff-verified'].includes(task.stage);
    if (action === 'preparation' && initialCi?.ready) reasons.push('The exact candidate already passed initial PR CI');
    if (action === 'final' && !merged && !initialCi?.ready)
      reasons.push(initialCi?.reason ?? 'Initial candidate PR CI evidence is absent');
    if (['preparation', 'final'].includes(action) && !plannedSource.ready) reasons.push(plannedSource.reason);
    if (['preparation', 'final'].includes(action) && !environment.ready) reasons.push(environment.reason);
    if (['runtime', 'combination', 'final'].includes(action)) {
      if (!resources.ready) reasons.push(resources.reason);
      if (environment.value?.runtimeBlocked) reasons.push('Historical runtime recovery is blocked');
      if (environment.value?.integrationDatabaseLocked && action === 'final')
        reasons.push('Integration database protection is held');
      if (resources.value?.previewPorts.length && action === 'final')
        reasons.push('Existing task preview lease requires exact release proof');
    }
    if (['combination', 'final'].includes(action) && overlap?.value?.protectedDeleteModify.length)
      reasons.push('Protected delete/modify conflict: ' + overlap.value.protectedDeleteModify.join(', '));
    if (action === 'final' && !progress.ready) reasons.push(progress.reason);
    if (action === 'final' && progress.value?.pending.some((entry) => entry.event === 'paused' || entry.knownFailure))
      reasons.push('A pending pause or failed receipt needs exact readback before board placement');
    if (action === 'final' && resources.value?.finalQueue.some((item) => item.task !== task.id))
      reasons.push('Another task remains in the final main queue');
    if (['preparation', 'final'].includes(action) && deliverySession.value?.hasRunning)
      reasons.push('Existing delivery action or CI still needs readback');
    return {
      action,
      state: reasons.length ? 'wait' : 'diagnostic-ready',
      reasons,
      dependencies: dependencyCheck.value?.dependencies ?? [],
      ticket: ticket ? { lane, status: ticket.status, order: ticket.order } : null,
    };
  });
  assert.deepEqual(createExecutionOrder(common).read(), queue, 'Execution queue changed during read-only plan');
  assert.deepEqual(registry.readTask(task.id), task, 'Task identity changed during read-only plan');
  assert.equal(git(root, 'rev-parse', 'origin/main'), main, 'Main changed during read-only plan');
  return {
    task: task.id,
    worktree: task.worktree,
    branch: task.branch,
    revision: task.revision,
    queueRevision: queue?.revision ?? null,
    executor: taskExecutor(task),
    main,
    source,
    frozen,
    overlap,
    deliverySession,
    progress,
    environment,
    taskPackages,
    taskData,
    resources,
    plannedSource,
    activeDispatch,
    actions,
    operationalAuthorization: false,
    requiresFreshChecks: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'continuation <exact task ID>');
    console.log(JSON.stringify(continuationPlan(process.cwd(), process.argv[2]), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
