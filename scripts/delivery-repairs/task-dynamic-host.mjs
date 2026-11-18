import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { readTaskCoordination, requireTaskCoordinator } from '../task-coordination.mjs';
import {
  verifyCoordinatorSource,
  taskExecutor,
  taskMonitoring,
  executionBinding,
  assertTaskExecutor,
  verifyExecutionWorker,
} from '../task-execution-binding.mjs';
import { assertBoundResumeReady } from '../task-rebinding.mjs';
import { assertHostIdle, observeCancellationHost } from '../task-cancellation-proof.mjs';
import { captureSource } from '../verification-evidence.mjs';
import { readAcceptance, assertAcceptedSource } from '../accepted-source.mjs';
import { threadTitle } from '../task-thread-titles.mjs';
import { assertCompletionQuality } from '../completion-ci-evidence.mjs';
import { assertTaskCommitOwnership } from '../task-commit-ownership.mjs';
import { verifyDevelopmentCompletion } from '../task-execution-order-cli.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
function readOnlySource(root) {
  const previous = process.env.GIT_OPTIONAL_LOCKS;
  process.env.GIT_OPTIONAL_LOCKS = '0';
  try {
    return captureSource(root);
  } finally {
    if (previous === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
    else process.env.GIT_OPTIONAL_LOCKS = previous;
  }
}
async function role(commonDir, input, host, actorIsCoordinator) {
  const coordination = readTaskCoordination(commonDir);
  assert.ok(coordination, 'Published current coordinator route required');
  requireTaskCoordinator(commonDir, input.coordinatorThreadId);
  if (actorIsCoordinator)
    assert.equal(process.env.CODEX_THREAD_ID, input.coordinatorThreadId, 'Actual current coordinator runtime required');
  const observed = await host.readThread(input.coordinatorThreadId);
  assert.equal(observed.thread.id, coordination.current.rootThreadId);
  assert.equal(observed.thread.hostId, 'local', 'Only this local project host is supported');
  assert.deepEqual(readTaskCoordination(commonDir), coordination, 'Coordinator changed during observation');
  return { coordination, coordinator: input.coordinatorThreadId, observed };
}
function frozenCheckpoint(task) {
  const acceptance = readAcceptance(task.worktree, task.id);
  assert.ok(acceptance && task.frozen, 'Original frozen source required');
  assert.equal(acceptance.commit, task.frozen.accepted);
  assert.equal(acceptance.tree, task.frozen.tree);
  assert.equal(git(task.worktree, 'status', '--porcelain'), '', 'Frozen candidate has uncommitted source');
  assertAcceptedSource(task.worktree, task.id, git(task.worktree, 'rev-parse', 'HEAD'));
  return hash({ accepted: acceptance.commit, tree: acceptance.tree, businessDigest: acceptance.businessDigest });
}
function registeredDevelopmentCheckpoint(task, state, registry, lane) {
  assert.equal(lane, 'development', 'Unfrozen checkpoints only resume development');
  assert.ok(!task.frozen && ['developing', 'dev-validated', 'blocked'].includes(task.stage));
  assert.equal(readAcceptance(task.worktree, task.id), null, 'Existing accepted source cannot become unfrozen');
  const binding = executionBinding(task),
    head = git(task.worktree, 'rev-parse', 'HEAD');
  assert.ok(binding, 'Original binding required');
  assert.equal(git(task.worktree, 'status', '--porcelain'), '', 'Registered checkpoint must be clean');
  assert.equal(head, task.recordedHead, 'HEAD is not the exact registered checkpoint');
  const checkpoint = task.checkpoints.find((entry) => entry.commit === head);
  assert.ok(
    checkpoint && typeof checkpoint.verification === 'string' && checkpoint.verification.trim(),
    'Exact owned checkpoint entry required',
  );
  const at = Date.parse(checkpoint.recordedAt);
  assert.ok(
    Number.isFinite(at) && at >= Date.parse(binding.boundAt) && at <= Date.now(),
    'Checkpoint must follow this binding',
  );
  const ticket = state.tickets.find(
    (item) => item.task === task.id && item.lane === 'development' && item.owner === task.owner,
  );
  assert.ok(ticket?.admission, 'Original legal development admission required');
  const direct = state.events.some(
    (event) =>
      event.action === 'resume-selected' &&
      event.bindingRef?.task === task.id &&
      event.bindingRef.revision === binding.revision &&
      event.members?.some(
        (member) =>
          member.task === task.id &&
          member.owner === task.owner &&
          member.lane === 'development' &&
          member.admission === ticket.admission &&
          hash(member.monitorContext) === hash(binding.monitoring),
      ),
  );
  const decision = state.dynamicDecisions?.find((item) => item.id === ticket.dynamicDecisionId);
  const dynamic =
    decision?.status === 'consumed' &&
    decision.input.task === task.id &&
    decision.input.owner === task.owner &&
    decision.input.executor === binding.executor &&
    decision.input.lane === 'development' &&
    decision.bindingRevision === binding.revision &&
    decision.admission === ticket.admission &&
    state.events.some(
      (event) =>
        event.action === 'dispatch-applied' && event.decisionId === decision.id && event.admission === ticket.admission,
    );
  assert.ok(direct || dynamic, 'Checkpoint has no exact bound development admission');
  const ownership = assertTaskCommitOwnership(task.worktree, task, head);
  const owned = new Set(ownership.commits);
  assert.ok(
    !registry
      .list()
      .some((other) => other.id !== task.id && other.checkpoints.some((entry) => owned.has(entry.commit))),
    'Checkpoint includes another task ownership',
  );
  return {
    version: 1,
    taskRevision: task.revision,
    bindingRevision: binding.revision,
    head,
    tree: git(task.worktree, 'rev-parse', head + '^{tree}'),
    checkpoint: structuredClone(checkpoint),
    ownership,
    admission: ticket.admission,
  };
}
function completedDevelopmentSource(task, state, registry) {
  const development = state.tickets.find((item) => item.task === task.id && item.lane === 'development');
  assert.equal(development?.owner, task.owner);
  assert.equal(development.status, 'completed', 'Verified original development completion required');
  assert.equal(development.completion?.digest, hash(development.completion?.evidence));
  assert.equal(verifyDevelopmentCompletion(task, development.completion.evidence), true);
  const head = git(task.worktree, 'rev-parse', 'HEAD');
  assert.equal(head, task.recordedHead, 'Completed HEAD is not registered');
  const ownership = assertTaskCommitOwnership(task.worktree, task, head);
  const owned = new Set(ownership.commits);
  assert.ok(
    !registry
      .list()
      .some((other) => other.id !== task.id && other.checkpoints.some((entry) => owned.has(entry.commit))),
    'Completed checkpoint has foreign ownership',
  );
  return {
    verified: true,
    ticketDigest: hash(development),
    evidenceDigest: development.completion.digest,
    head,
    tree: git(task.worktree, 'rev-parse', head + '^{tree}'),
    ownership,
  };
}
function sourceReady(task, state, registry, observe, request, lane, enrollPhase) {
  const before = captureSource(task.worktree);
  assert.equal(git(task.worktree, 'branch', '--show-current'), task.branch);
  const binding = executionBinding(task);
  let readiness,
    checkpoint = null;
  if (binding) {
    const sourceRequest = request.sequence > binding.request.sequence ? request : binding.request;
    readiness = assertBoundResumeReady(
      task,
      state,
      { request: sourceRequest, lane },
      {
        registry,
        observe,
        acceptFrozenCheckpoint: () => {
          frozenCheckpoint(task);
          return true;
        },
        acceptRegisteredCheckpoint: () => {
          if (lane === 'delivery') {
            const ticket = state.tickets.find((item) => item.task === task.id && item.lane === 'delivery');
            assert.ok(enrollPhase || ticket?.phaseOrigin, 'Unfrozen delivery needs its exact completed phase');
            completedDevelopmentSource(task, state, registry);
            checkpoint = registeredDevelopmentCheckpoint(task, state, registry, 'development');
          } else checkpoint = registeredDevelopmentCheckpoint(task, state, registry, lane);
          return true;
        },
      },
    );
  } else {
    // Native new tasks retain their enrolled identity; unknown/legacy owners
    // require the existing binding workflow rather than a dispatch adoption.
    assert.equal(task.monitoring?.executionSurface, 'codex-thread');
    assert.equal(task.monitoring?.worker, task.owner);
    assert.equal(task.monitoring?.runtimeOwnerVerified, true);
    const startFile = path.join(task.repository.commonDir, 'task-registry/start-intents', task.id + '.json');
    const stat = lstatSync(startFile);
    assert.ok(
      stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
      'Private original start intent required',
    );
    const start = JSON.parse(readFileSync(startFile));
    for (const key of ['owner', 'branch', 'worktree', 'base'])
      assert.equal(start[key], task[key], 'Original registered start differs');
    assert.equal(start.task, task.id);
    assert.equal(start.state, 'registered');
    assertHostIdle(observe(), task);
    assertHostIdle(observe(), task);
    readiness = { sourceDigest: before.digest };
  }
  const accepted = task.frozen ? frozenCheckpoint(task) : null;
  const after = captureSource(task.worktree);
  assert.equal(after.digest, before.digest, 'Source changed during dispatch observation');
  assert.equal(after.head, before.head);
  assert.deepEqual(registry.readTask(task.id), task, 'Task changed during dispatch observation');
  return {
    sourceProof: {
      head: after.head,
      digest: after.digest,
      index: hash(git(task.worktree, 'ls-files', '--stage', '-z')),
      accepted,
      acceptedRecord: task.frozen
        ? hash(readFileSync(path.join(task.repository.commonDir, 'task-delivery', task.id, 'accepted-source.json')))
        : null,
      boundSource: readiness.sourceDigest,
      checkpoint,
    },
    readiness,
  };
}
async function taskProof(
  commonDir,
  input,
  host,
  registry,
  queue,
  asWorker,
  observe,
  requireDependencies = true,
  enrollPhase = false,
) {
  const roleProof = await role(commonDir, input, host, !asWorker);
  const task = registry.resolve({ id: input.task });
  assert.notEqual(task.stage, 'closed', 'Closed task cannot dispatch');
  const binding = executionBinding(task),
    executor = taskExecutor(task);
  assert.equal(input.owner, task.owner);
  assert.equal(input.executor, executor);
  if (asWorker) assertTaskExecutor(task);
  const boardId = binding?.boardTaskId ?? task.monitoring?.taskStableId ?? task.id;
  const board = await host.readTask(boardId);
  assert.ok(
    board && board.id === boardId && !board.deleted_at && ['active', 'review', 'merging'].includes(board.status),
    'Paused or terminal board task cannot dispatch',
  );
  if (input.lane === 'development') {
    assert.equal(board.status, 'active');
    assert.ok(!task.frozen && ['developing', 'dev-validated', 'blocked'].includes(task.stage));
  } else {
    assert.equal(input.lane, 'delivery');
    assert.ok(
      task.frozen || ['review', 'merging'].includes(board.status),
      'Delivery preparation requires existing delivery scope',
    );
    if (input.phase === 'preparation')
      assert.ok(
        !['merged', 'main-verified', 'handoff-verified'].includes(task.stage),
        'Already merged task requires final recovery, not preparation',
      );
  }
  const worker = await host.readThread(executor);
  assert.equal(worker.thread.id, executor);
  assert.equal(worker.thread.hostId, roleProof.observed.thread.hostId);
  assert.equal(worker.thread.title, threadTitle(board));
  assert.ok(['active', 'idle', 'error'].includes(worker.thread.status?.type), 'Unknown worker native state');
  verifyExecutionWorker(
    worker,
    {
      taskId: task.id,
      owner: executor,
      rootThreadId:
        binding?.nativeEvidence?.worker.sourceRootThreadId ?? binding?.coordinator ?? task.monitoring.rootThreadId,
    },
    threadTitle(board),
  );
  const state = queue.read();
  const grant = state.dynamicAuthorities?.find((item) => item.id === input.authorityId);
  assert.ok(grant, 'Standing delegation must be published first');
  assert.equal(grant.request.authorId, roleProof.coordination.current.request.authorId);
  assert.equal(typeof host.dependenciesReady, 'function');
  const dependenciesReady = host.dependenciesReady(task);
  if (requireDependencies) assert.equal(dependenciesReady, true, 'Waiting for formally delivered task dependencies');
  const dependencies = (task.dependsOn ?? []).map((id) => {
    const dependency = registry.readTask(id);
    return {
      task: id,
      revision: dependency?.revision ?? null,
      stage: dependency?.stage ?? null,
      main: dependency?.main?.local ?? null,
      closedAt: dependency?.closedAt ?? null,
    };
  });
  const phaseTicket = state.tickets.find((item) => item.task === task.id && item.lane === 'delivery');
  const development =
    enrollPhase || (input.lane === 'delivery' && phaseTicket?.phaseOrigin && !task.frozen)
      ? completedDevelopmentSource(task, state, registry)
      : null;
  let source;
  if (enrollPhase) {
    // Enrollment only appends metadata. Runtime quiescence/capacity remain at
    // dispatch and worker consumption; no source or process is adopted here.
    const before = readOnlySource(task.worktree);
    assert.equal(git(task.worktree, 'branch', '--show-current'), task.branch);
    assert.deepEqual(completedDevelopmentSource(task, state, registry), development);
    const accepted = task.frozen ? frozenCheckpoint(task) : null;
    const after = readOnlySource(task.worktree);
    assert.deepEqual(after, before, 'Completed source changed during phase enrollment');
    source = {
      sourceProof: {
        kind: 'completed-development-enrollment-v1',
        head: after.head,
        digest: after.digest,
        index: hash(git(task.worktree, 'ls-files', '--stage', '-z')),
        accepted,
        development,
      },
      readiness: { workNotStarted: true },
    };
  } else source = sourceReady(task, state, registry, observe, grant.request, input.lane, false);
  const capacity = enrollPhase ? null : await host.readCapacity();
  const existing = [state.scopedAdmission, ...(state.scopedAdmissions ?? [])]
    .filter(Boolean)
    .find((scope) => scope.task === task.id && scope.lane === input.lane);
  const existingDecision =
    existing?.decisionId && state.dynamicDecisions?.find((item) => item.id === existing.decisionId);
  const fencedScope = Boolean(
    existingDecision && existingDecision.input.expectedCoordinationRevision !== roleProof.coordination.revision,
  );
  assert.deepEqual(readTaskCoordination(commonDir), roleProof.coordination);
  return {
    ...roleProof,
    ...source,
    development,
    task,
    executor,
    bindingRevision: binding?.revision ?? 0,
    boardRevision: board.revision,
    dependenciesReady,
    dependencies,
    capacity,
    actor: process.env.CODEX_THREAD_ID,
    workerIdle: ['idle', 'error'].includes(worker.thread.status?.type),
    fencedScope,
  };
}
export async function dynamicHostAction(
  action,
  input,
  host,
  { commonDir, registry, queue, observe = observeCancellationHost },
) {
  assert.ok(
    ['delegate', 'delivery-enroll', 'dispatch', 'dispatch-start', 'dispatch-cancel', 'preparation-finish'].includes(
      action,
    ),
  );
  if (action === 'delegate') {
    const current = await role(commonDir, input, host, true);
    const source = await verifyCoordinatorSource(
      { rootThreadId: current.coordinator, request: input.request },
      host.readThread,
    );
    const message = source.turns
      .flatMap((turn) => turn.items ?? [])
      .find((item) => item.type === 'userMessage' && item.id === input.request.messageId);
    const prior = queue.read().dynamicAuthorities?.find((item) => item.id === input.authorityId);
    const taskScope = prior?.source.tasks ?? [];
    if (!prior)
      for (const id of [...input.taskIds].sort()) {
        const task = registry.resolve({ id });
        assert.notEqual(task.stage, 'closed');
        const tickets = queue.read().tickets.filter((ticket) => ticket.task === id);
        assert.ok(
          tickets.length &&
            tickets.every(
              (ticket) => ticket.owner === task.owner && ticket.request.authorId === input.request.authorId,
            ),
          'Task list has unknown or foreign authorization',
        );
        const boardId = executionBinding(task)?.boardTaskId ?? task.monitoring?.taskStableId ?? id;
        const board = await host.readTask(boardId);
        assert.ok(board && !board.deleted_at && board.status !== 'done', 'Delegated task is terminal');
        taskScope.push({ task: id, owner: task.owner, boardId });
      }
    return queue.registerDelegation(input, () => {
      assert.deepEqual(readTaskCoordination(commonDir), current.coordination);
      return { ...current, message, taskScope };
    });
  }
  if (action === 'delivery-enroll') {
    assert.ok(input.lane === undefined && input.phase === undefined, 'Phase enrollment grants no work admission');
    const existing = queue.read().tickets.find((item) => item.task === input.task && item.lane === 'delivery');
    if (existing) {
      const current = await role(commonDir, input, host, true);
      return {
        ticket: queue.enrollDeliveryPhase(input, () => ({ ...current, actor: process.env.CODEX_THREAD_ID })),
        startAuthorized: false,
        replay: true,
      };
    }
    const proof = await taskProof(
      commonDir,
      { ...input, lane: 'delivery', phase: 'preparation' },
      host,
      registry,
      queue,
      false,
      observe,
      true,
      true,
    );
    const ticket = queue.enrollDeliveryPhase(input, () => {
      assert.deepEqual(registry.readTask(input.task), proof.task);
      assert.deepEqual(readTaskCoordination(commonDir), proof.coordination);
      return proof;
    });
    return { ticket, startAuthorized: false, replay: false };
  }
  if (action === 'dispatch') {
    const prior = queue.read().dynamicDecisions?.find((item) => item.id === input.decisionId);
    if (prior) {
      const current = await role(commonDir, input, host, true);
      const result = queue.reserveDecision(input, () => current);
      return { status: result.status, decision: result, startAuthorized: false, replay: true };
    }
    const proof = await taskProof(commonDir, input, host, registry, queue, false, observe);
    const result = queue.reserveDecision(input, () => {
      assert.deepEqual(registry.readTask(input.task), proof.task);
      assert.deepEqual(readTaskCoordination(commonDir), proof.coordination);
      return proof;
    });
    return {
      status: result.status,
      decision: result,
      workerInput: {
        decisionId: result.id,
        coordinatorThreadId: proof.coordinator,
        task: input.task,
        executor: input.executor,
        owner: input.owner,
      },
    };
  }
  const decision = queue.read().dynamicDecisions?.find((item) => item.id === input.decisionId);
  assert.ok(decision, 'Unknown dispatch decision');
  if (action === 'dispatch-cancel') {
    if (decision.status === 'cancelled') {
      const current = await role(commonDir, input, host, true);
      return queue.cancelDecision(input, () => current);
    }
    const proof = await taskProof(
      commonDir,
      { ...decision.input, ...input },
      host,
      registry,
      queue,
      false,
      observe,
      false,
    );
    return queue.cancelDecision(input, () => {
      assert.deepEqual(registry.readTask(proof.task.id), proof.task);
      assert.deepEqual(readTaskCoordination(commonDir), proof.coordination);
      return proof;
    });
  }
  if (action === 'dispatch-start') {
    const plan = { ...decision.input, coordinatorThreadId: input.coordinatorThreadId };
    assert.equal(input.task, plan.task);
    assert.equal(input.executor, plan.executor);
    assert.equal(input.owner, plan.owner);
    if (decision.status !== 'reserved') {
      const current = await role(commonDir, input, host, false);
      const task = registry.readTask(plan.task);
      assertTaskExecutor(task);
      return {
        status: 'decision-already-consumed-no-replay',
        decision: queue.consumeDecision(input, () => ({ ...current, actor: process.env.CODEX_THREAD_ID })),
      };
    }
    const proof = await taskProof(commonDir, plan, host, registry, queue, true, observe);
    const result = queue.consumeDecision(input, () => {
      assert.deepEqual(registry.readTask(plan.task), proof.task);
      assert.deepEqual(readTaskCoordination(commonDir), proof.coordination);
      return proof;
    });
    return {
      status: result.startAuthorized ? 'admitted-work-not-started' : 'decision-already-consumed-no-replay',
      decision: result,
      task: proof.task,
      monitorContext: taskMonitoring(proof.task),
    };
  }
  const current = await role(commonDir, input, host, false);
  if (decision.status === 'finished') {
    const task = registry.readTask(decision.input.task);
    assertTaskExecutor(task);
    return queue.finishPreparation(input, () => ({
      actor: process.env.CODEX_THREAD_ID,
      verified: true,
      prepared: decision.prepared,
    }));
  }
  const task = registry.resolve({ id: decision.input.task });
  assertTaskExecutor(task);
  queue.assertAdmission({
    lane: 'delivery',
    task: task.id,
    owner: task.owner,
    admission: decision.admission,
    effect: 'preparation',
  });
  const session = JSON.parse(readFileSync(path.join(commonDir, 'task-delivery', task.id, 'completion-session.json')));
  const prepared = session.preparedCandidates?.find((item) => item.head === task.recordedHead);
  assert.ok(prepared, 'Exact prepared candidate missing');
  assert.equal(git(task.worktree, 'status', '--porcelain'), '');
  assert.equal(git(task.worktree, 'rev-parse', 'HEAD'), prepared.head);
  assert.equal(readAcceptance(task.worktree, task.id).commit, prepared.accepted);
  assertAcceptedSource(task.worktree, task.id, prepared.head);
  const ci = session.events.find(
    (event) =>
      event.name === 'ci' &&
      event.status === 'success' &&
      String(event.result?.runId) === prepared.runId &&
      event.result?.headSha === prepared.head,
  )?.result;
  assert.ok(ci && ci.eventName === 'pull_request' && ci.branch === task.branch);
  assertCompletionQuality(ci, prepared.head, prepared.runId);
  return queue.finishPreparation(input, () => {
    assert.deepEqual(readTaskCoordination(commonDir), current.coordination);
    assert.deepEqual(registry.readTask(task.id), task);
    return { actor: process.env.CODEX_THREAD_ID, verified: true, prepared };
  });
}
