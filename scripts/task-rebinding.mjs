import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { observeCancellationHost, assertHostIdle } from './task-cancellation-proof.mjs';
import {
  assertTaskExecutor,
  executionBinding,
  taskExecutor,
  verifyExecutionWorker,
} from './task-execution-binding.mjs';
import { threadTitle, createTaskThreadTitles } from './task-thread-titles.mjs';
import { requireTaskCoordinator, verifyTaskAuthorization, readTaskCoordination } from './task-coordination.mjs';
import { readAcceptance } from './accepted-source.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

// A legacy collaboration worker is an execution surface, not a native chat ID.
// Its original coordinator and authorization must be independently observable.
async function previousExecutorEvidence(task, binding, worker, host, input) {
  const monitoring = task.monitoring;
  const collaboration =
    !binding &&
    (monitoring?.executionSurface === 'collaboration-agent' ||
      (monitoring?.executionSurface === undefined && monitoring?.worker?.startsWith('/root/')));
  const previous = taskExecutor(task);
  if (input.historicalRecovery?.mode === 'preserved-project-state') {
    const target = collaboration ? monitoring.rootThreadId : previous;
    const unavailable = await host.readUnavailableThread?.(target);
    if (unavailable) {
      assert.equal(worker.thread.hostId, 'local', 'Project-state recovery only proves this local registered carrier');
      return {
        executionSurface: collaboration ? 'collaboration-agent' : binding ? 'codex-thread' : 'historical-unclassified',
        historicalOwner: task.owner,
        previousExecutor: previous,
        availability: 'native-not-found',
        unavailableThreadId: target,
        unavailableDigest: digest(unavailable),
        historicalMonitoring: monitoring ?? null,
        source: 'preserved-project-state',
      };
    }
    const stored = await host.readThread(target);
    if (stored?.thread?.status?.type === 'notLoaded') {
      assert.equal(stored.thread.id, target, 'Stored historical executor identity differs');
      assert.equal(stored.thread.hostId, 'local', 'Stored executor requires independent remote evidence');
      assert.equal(worker.thread.hostId, 'local', 'Project-state recovery only proves this local registered carrier');
      assert.deepEqual(Object.keys(stored.thread.status), ['type'], 'Unknown stored executor runtime flags');
      for (const turn of stored.turns ?? [])
        if (turn.status !== undefined)
          assert.ok(
            ['completed', 'interrupted', 'failed'].includes(turn.status),
            'Stored executor has an active or unknown turn; preserve original carrier',
          );
      // notLoaded only describes this app-server's memory, not quiescence.
      // Use the full original carrier/source review and two OS/resource rounds
      // below; never add this status to the normal idle/error allowlist.
      return {
        executionSurface: collaboration ? 'collaboration-agent' : binding ? 'codex-thread' : 'historical-unclassified',
        historicalOwner: task.owner,
        previousExecutor: previous,
        availability: 'native-not-loaded',
        threadId: target,
        hostId: stored.thread.hostId,
        status: stored.thread.status,
        nativeObservationDigest: digest(stored),
        historicalMonitoring: monitoring ?? null,
        source: 'preserved-project-state',
      };
    }
  }
  if (collaboration) {
    assert.match(monitoring.worker, /^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/);
    assert.match(monitoring.rootThreadId, uuid, 'Original collaboration root is missing');
    assert.equal(monitoring.owner, task.owner, 'Original collaboration owner differs');
    assert.ok(monitoring.roomId && monitoring.authorizationRef, 'Original collaboration authorization is missing');
    const root = await host.readThread(monitoring.rootThreadId);
    assert.equal(root?.thread?.id, monitoring.rootThreadId, 'Original collaboration root is unobservable; retain task');
    assert.equal(
      root.thread.hostId,
      worker.thread.hostId,
      'Cross-host collaboration requires independent remote evidence',
    );
    assert.ok(
      ['idle', 'error'].includes(root.thread.status?.type),
      'Original collaboration root is active or unobservable',
    );
    const source = monitoring.roomId === root.thread.id ? root : await host.readThread(monitoring.roomId);
    assert.equal(source?.thread?.id, monitoring.roomId, 'Original collaboration authorization room is unobservable');
    const authorization = source.turns
      ?.flatMap((turn) => turn.items ?? [])
      .find((item) => item.type === 'userMessage' && item.id === monitoring.authorizationRef);
    assert.ok(authorization, 'Original collaboration authorization message is missing');
    return {
      executionSurface: 'collaboration-agent',
      historicalOwner: previous,
      worker: monitoring.worker,
      rootThreadId: root.thread.id,
      hostId: root.thread.hostId,
      rootStatus: root.thread.status,
      authorization: { roomId: source.thread.id, messageId: authorization.id, digest: digest(authorization) },
    };
  }
  assert.ok(
    binding || monitoring?.executionSurface === undefined || monitoring.executionSurface === 'codex-thread',
    'Unknown historical execution surface; retain task',
  );
  const old = await host.readThread(previous);
  assert.equal(old?.thread?.id, previous, 'Previous native executor is unobservable; retain task');
  assert.equal(old.thread.hostId, worker.thread.hostId, 'Cross-host takeover requires independent remote evidence');
  assert.ok(['idle', 'error'].includes(old.thread.status?.type), 'Previous executor is active or unobservable');
  return { threadId: old.thread.id, hostId: old.thread.hostId, status: old.thread.status };
}

function projectSource(task, state, input) {
  const common = task.repository.commonDir;
  const tickets = state.tickets.filter((ticket) => ticket.task === task.id);
  assert.ok(tickets.length, 'Original project authorization ledger is missing');
  for (const ticket of tickets) {
    assert.equal(ticket.owner, task.owner, 'Original project ledger owner differs');
    assert.equal(ticket.request.authorId, input.request.authorId, 'Original project user differs');
    assert.ok(ticket.request.messageId && ticket.request.roomId && ticket.request.sequence < input.request.sequence);
  }
  const intentFile = path.join(common, 'task-registry/start-intents', task.id + '.json');
  safe(intentFile);
  let carrier;
  if (existsSync(intentFile)) {
    const intent = JSON.parse(readFileSync(intentFile));
    for (const key of ['owner', 'branch', 'worktree', 'base'])
      assert.equal(intent[key], task[key], 'Original registered project carrier differs');
    assert.equal(intent.task, task.id);
    assert.equal(intent.state, 'registered');
    carrier = { kind: 'registered-start-intent', value: intent };
  } else {
    const file = path.join(common, 'task-delivery', task.id, 'accepted-source.json');
    safe(file);
    assert.ok(task.frozen && existsSync(file), 'Original registered carrier/freeze is missing');
    const accepted = JSON.parse(readFileSync(file));
    assert.equal(accepted.batch, task.id);
    assert.equal(accepted.branch, task.branch);
    assert.equal(accepted.commit, task.frozen.accepted);
    assert.equal(accepted.tree, task.frozen.tree);
    carrier = { kind: 'preserved-freeze', value: accepted };
  }
  const git = (...args) =>
    execFileSync('git', ['--no-replace-objects', '-C', task.worktree, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const entries = [...new Set(files)].sort().map((name) => {
    assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..'), 'Unsafe project source path');
    const file = path.join(task.worktree, name);
    safe(file);
    if (!existsSync(file)) return { name, deleted: true };
    assert.ok(lstatSync(file).isFile(), 'Unknown project source entry');
    return { name, mode: lstatSync(file).mode, digest: createHash('sha256').update(readFileSync(file)).digest('hex') };
  });
  return {
    task,
    tickets,
    carrier,
    head: git('rev-parse', 'HEAD').trim(),
    index: git('ls-files', '--stage', '-z'),
    entries,
  };
}

function assertProcessRecord(name, record) {
  const token = name.slice('process-'.length, -'.json'.length);
  if (uuid.test(token)) {
    assert.ok(
      record.token === token &&
        typeof record.host === 'string' &&
        record.host &&
        Number.isSafeInteger(record.pgid) &&
        record.pgid > 1,
      'Unknown original process journal',
    );
    assert.equal(record.status, 'quiescent', 'Unsealed original process journal');
    return;
  }
  // Report names share the prefix. Only a structured test report without any
  // launch fields is unrelated; unknown or renamed journals still fail closed.
  assert.ok(
    !['token', 'host', 'pgid', 'status'].some((key) => Object.hasOwn(record, key)) &&
      typeof record.scope === 'string' &&
      record.scope &&
      /^[a-f0-9]{40}$/.test(record.baseCheckpoint) &&
      ['passed', 'failed', 'skipped', 'retries'].every(
        (key) => Number.isSafeInteger(record.tests?.[key]) && record.tests[key] >= 0,
      ) &&
      record.static &&
      typeof record.static === 'object' &&
      record.production &&
      typeof record.production === 'object',
    'Unknown process-prefixed record; retain original evidence',
  );
}
function safe(file) {
  for (let cursor = path.resolve(file); ; cursor = path.dirname(cursor)) {
    try {
      assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked rebinding state refused');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (cursor === path.dirname(cursor)) break;
  }
}
function resources(task) {
  const common = task.repository.commonDir,
    result = [];
  const add = (file) => {
    safe(file);
    assert.ok(lstatSync(file).isFile());
    const bytes = readFileSync(file),
      value = JSON.parse(bytes);
    result.push({ file, digest: createHash('sha256').update(bytes).digest('hex') });
    return value;
  };
  const leases = path.join(common, 'task-registry/resource-leases');
  safe(leases);
  if (existsSync(leases))
    for (const name of readdirSync(leases)) {
      const lease = add(path.join(leases, name, 'owner.json'));
      assert.ok(
        lease.resource === name &&
          typeof lease.task === 'string' &&
          lease.task &&
          typeof lease.token === 'string' &&
          lease.token &&
          Number.isSafeInteger(lease.pid) &&
          lease.pid > 1,
        'Unknown resource ownership',
      );
      assert.ok(
        ![task.id, task.owner, taskExecutor(task)].includes(lease.task),
        'Task resource lease remains; resolve its original ownership before rebinding',
      );
    }
  const delivery = path.join(common, 'task-delivery', task.id);
  for (const environment of [
    path.join(common, 'task-environments', task.id, 'environment.json'),
    path.join(common, 'preview-environment/environment.json'),
  ]) {
    safe(environment);
    if (existsSync(environment)) add(environment);
  }
  const referencedProcesses = new Set();
  const originalReferences = new Set();
  let hasSession = false;
  const startIntent = path.join(common, 'task-registry/start-intents', task.id + '.json');
  if (!executionBinding(task) && task.monitoring?.worker?.startsWith('/root/')) {
    assert.ok(existsSync(startIntent), 'Original collaboration start intent is missing');
    const start = add(startIntent);
    for (const key of ['owner', 'branch', 'worktree'])
      assert.equal(start[key], task[key], 'Original collaboration start identity differs');
    assert.equal(start.task, task.id);
    assert.equal(start.state, 'registered', 'Unfinished collaboration start intent');
    assert.equal(start.base, task.base, 'Original collaboration source differs');
  }
  if (task.frozen) assert.ok(readAcceptance(task.worktree, task.id), 'Original frozen source is missing');
  for (const name of ['accepted-source.json', 'completion-session.json']) {
    const file = path.join(delivery, name);
    safe(file);
    if (existsSync(file)) {
      const record = add(file);
      if (name === 'accepted-source.json') {
        assert.equal(record.batch, task.id, 'Frozen source belongs to another task');
        assert.equal(record.commit, task.frozen?.accepted, 'Original accepted source identity differs');
        assert.equal(record.tree, task.frozen?.tree, 'Original frozen tree differs');
      }
      if (name === 'completion-session.json') {
        hasSession = true;
        assert.ok(
          !record.events?.some((e) => e.status === 'running'),
          'Unresolved formal delivery process; retain original session',
        );
        for (const event of record.events ?? []) {
          if (event.processTracking !== undefined || event.processes !== undefined)
            assert.ok(
              event.processTracking === 1 && Array.isArray(event.processes),
              'Unknown original process inventory',
            );
          for (const child of event.processes ?? []) {
            assert.match(child.token, uuid, 'Unknown original process reference');
            const journal = path.join(delivery, 'process-' + child.token + '.json');
            referencedProcesses.add(journal);
            originalReferences.add(journal);
          }
        }
      }
    }
  }
  for (const base of [
    delivery,
    path.join(task.worktree, '.task-runtime'),
    path.join(task.worktree, '.task-verification'),
  ]) {
    const visit = (folder) => {
      safe(folder);
      if (!existsSync(folder)) return;
      for (const name of readdirSync(folder)) {
        const file = path.join(folder, name);
        // Dependency directories were already excluded from journal traversal.
        // Preserve a legacy node_modules link by identity, without following it
        // or granting permission to alter its target. Other links still refuse.
        if (name === 'node_modules' && lstatSync(file).isSymbolicLink()) {
          result.push({ file, excludedDependencyLink: readlinkSync(file) });
          continue;
        }
        safe(file);
        assert.ok(!name.endsWith('.lock'), 'Retained task lock requires original recovery');
        if (lstatSync(file).isDirectory()) {
          if (!['cache', 'node_modules', 'maven-local', 'maven-tools'].includes(name)) visit(file);
        } else if (/^process-.*\.json$/.test(name)) {
          assertProcessRecord(name, add(file));
          if (hasSession && uuid.test(name.slice('process-'.length, -'.json'.length)))
            assert.ok(originalReferences.has(file), 'Original process journal has no session reference');
          referencedProcesses.delete(file);
        }
      }
    };
    visit(base);
  }
  assert.equal(referencedProcesses.size, 0, 'Referenced original process journal is missing');
  const mainQueue = path.join(common, 'task-registry/delivery-queue.json');
  safe(mainQueue);
  if (existsSync(mainQueue)) {
    const state = add(mainQueue);
    assert.ok(Array.isArray(state.tickets), 'Unknown main queue');
    for (const ticket of state.tickets)
      assert.ok(
        ticket.task && ticket.owner && ticket.id && ['waiting', 'running', 'blocked'].includes(ticket.status),
        'Unknown main queue ownership',
      );
    // Preserve reservations, including the original owner. A live main writer
    // must finish/recover through its existing protected entry first.
    assert.ok(
      !state.tickets.some((t) => t.task === task.id && t.status === 'running'),
      'Task is writing main; rebinding is not permitted',
    );
  }
  return result;
}

// The authenticated host supplies real native observations; the published CLI
// supplies OS evidence itself. JSON cannot inject a safe flag or inventory.
export async function rebindHistoricalTask(
  input,
  host,
  { registry, queue, observe = observeCancellationHost, now = Date.now(), planOnly = false },
) {
  assert.equal(process.env.CODEX_THREAD_ID, input.rootThreadId, 'Actual coordinator runtime required');
  requireTaskCoordinator(registry.commonDir, input.rootThreadId);
  const initial = registry.readTask(input.taskId);
  assert.ok(initial, 'Historical task must already be registered');
  const priorBinding = executionBinding(initial);
  await verifyTaskAuthorization(registry.commonDir, input, host.readThread, {
    readUnavailableThread: host.readUnavailableThread,
    verifyPreservedSource: async () => {
      const current = readTaskCoordination(registry.commonDir);
      if (
        current?.current.rootThreadId === input.rootThreadId &&
        current.current.request.messageId === input.request.messageId
      ) {
        assert.deepEqual(current.current.request, input.request);
        const tickets = queue.read().tickets.filter((ticket) => ticket.task === initial.id);
        assert.ok(tickets.length, 'Original task authorization ledger missing');
        for (const ticket of tickets) {
          assert.equal(ticket.owner, initial.owner);
          assert.equal(ticket.request.authorId, input.request.authorId);
          assert.ok(ticket.request.sequence < input.request.sequence);
        }
        return; // The exact current appointment was already natively accepted.
      }
      assert.ok(priorBinding, 'No previously accepted takeover authorization');
      assert.equal(priorBinding.executor, input.owner);
      assert.equal(priorBinding.coordinator, input.rootThreadId);
      assert.deepEqual(
        priorBinding.request,
        input.request,
        'Unreadable new authorization cannot replace the accepted binding',
      );
    },
  });
  const boardTaskId =
    input.boardTaskId ?? priorBinding?.boardTaskId ?? initial.monitoring?.taskStableId ?? input.taskId;
  if (priorBinding) assert.equal(boardTaskId, priorBinding.boardTaskId, 'Keep original bound carrier-to-board mapping');
  if (initial.monitoring?.taskStableId)
    assert.equal(boardTaskId, initial.monitoring.taskStableId, 'Keep original carrier-to-board mapping');
  const board = await host.readTask(boardTaskId);
  assert.ok(board && board.id === boardTaskId && !board.deleted_at && board.status !== 'done');
  assert.equal(board.revision, input.boardRevision, 'Board revision changed; do not rebase');
  const worker = await host.readThread(input.owner);
  const previous = taskExecutor(initial);
  const nativeOrigin = createTaskThreadTitles(registry.commonDir).get(input.taskId);
  const creationRoot =
    input.owner === previous
      ? (priorBinding?.nativeEvidence?.worker.sourceRootThreadId ??
        priorBinding?.coordinator ??
        (nativeOrigin?.threadId === previous ? nativeOrigin.creationRootThreadId : undefined) ??
        initial.monitoring?.rootThreadId ??
        input.rootThreadId)
      : input.rootThreadId;
  const workerCreation = verifyExecutionWorker(worker, { ...input, rootThreadId: creationRoot }, threadTitle(board));
  if (boardTaskId !== input.taskId)
    verifyExecutionWorker(worker, { ...input, rootThreadId: creationRoot, taskId: boardTaskId }, threadTitle(board));
  const existing = priorBinding;
  if (existing?.request.messageId === input.request.messageId) {
    assert.equal(existing.executor, input.owner, 'Replayed binding has a different worker');
    assert.equal(existing.coordinator, input.rootThreadId, 'Replayed binding has a different coordinator');
    assert.deepEqual(existing.request, input.request);
    assert.equal(existing.expectedRevision, input.expectedRevision);
    assert.equal(existing.queueRevision, input.queueRevision);
    assert.equal(existing.boardRevision, input.boardRevision);
    assert.equal(existing.boardTaskId, boardTaskId);
    return { status: 'bound', task: initial, replayed: true }; // No inventory, mutation or resume.
  }
  assert.ok(
    previous !== input.owner || (priorBinding?.coordinator ?? initial.monitoring?.rootThreadId) !== input.rootThreadId,
    'Task already belongs to this executor and coordinator',
  );
  const previousEvidence = await previousExecutorEvidence(initial, priorBinding, worker, host, input);
  if (input.historicalRecovery?.digest)
    assert.equal(
      previousEvidence.source,
      'preserved-project-state',
      'Project recovery availability changed; re-read the plan without downgrading its review',
    );
  const monitoring = {
    version: 1,
    mode: 'confirmed-interruption-notice-only',
    state: 'registered',
    owner: input.owner,
    runtimeOwnerVerified: false,
    platformWorkerVerified: true,
    registeredAt: new Date(now).toISOString(),
    paused: false,
    automaticResumptionEnabled: false,
    executionSurface: 'codex-thread',
    worker: input.owner,
    rootThreadId: input.rootThreadId,
    roomId: input.request.roomId,
    authorizationRef: input.request.messageId,
    taskStableId: boardTaskId,
    taskNumber: board.task_number,
    taskName: board.title,
  };
  const binding = {
    version: 1,
    revision: (initial.executionBindings?.length ?? 0) + 1,
    taskId: initial.id,
    historicalOwner: initial.owner,
    previousExecutor: previous,
    executor: input.owner,
    coordinator: input.rootThreadId,
    request: input.request,
    expectedRevision: input.expectedRevision,
    queueRevision: input.queueRevision,
    boardRevision: input.boardRevision,
    boardTaskId,
    nativeEvidence: {
      worker: {
        threadId: worker.thread.id,
        sourceRootThreadId: creationRoot,
        creationMessageId: workerCreation.id,
        creationDigest: digest(workerCreation),
      },
      previousExecutor: previousEvidence,
      authorization: { threadId: input.request.roomId, messageId: input.request.messageId },
    },
    worktree: initial.worktree,
    branch: initial.branch,
    commonDir: registry.commonDir,
    monitoring,
    boundAt: new Date(now).toISOString(),
  };
  const task = queue.guard(() => {
    const state = queue.read();
    assert.equal(state?.revision, input.queueRevision, 'Queue revision changed; do not rebase');
    assert.equal(state.paused, true, 'Fence execution before changing its binding');
    assert.ok(
      ![...(state.scopedAdmissions ?? []), ...(state.scopedAdmission ? [state.scopedAdmission] : [])].some(
        (scope) => scope.task === initial.id,
      ),
      'Target scoped executor remains admitted',
    );
    for (const ticket of state.tickets.filter((t) => t.task === initial.id)) {
      assert.equal(ticket.owner, initial.owner, 'Historical queue owner differs');
      assert.equal(ticket.request.authorId, input.request.authorId, 'Original user required');
      assert.ok(ticket.request.sequence < input.request.sequence, 'Fresh explicit takeover instruction required');
    }
    const check = (record) => {
      assert.deepEqual(record, initial, 'Task changed during native observation');
      registry.validateLive(record);
      const project =
        previousEvidence.source === 'preserved-project-state' ? projectSource(record, state, input) : null;
      if (project) {
        binding.projectSourceDigest = digest(project);
        binding.sourceContentDigest = digest({ head: project.head, index: project.index, entries: project.entries });
        if (!planOnly)
          assert.equal(
            input.historicalRecovery.digest,
            binding.projectSourceDigest,
            'Project recovery review changed; re-read plan without rebasing',
          );
      }
      const before = resources(record),
        first = observe();
      assertHostIdle(first, record);
      const assertHistoricalWriterAbsent = (snapshot) => {
        if (!project) return;
        const tokens = [record.owner, taskExecutor(record), record.monitoring?.worker].filter(Boolean);
        for (const process of snapshot.processes)
          if (process.pid !== globalThis.process.pid)
            assert.ok(
              !tokens.some((token) => process.command.includes(token)),
              'Historical executor process remains; retain original carrier',
            );
      };
      assertHistoricalWriterAbsent(first);
      const second = observe();
      assertHostIdle(second, record);
      assertHistoricalWriterAbsent(second);
      assert.deepEqual(resources(record), before, 'Resource evidence changed during observation');
      if (project)
        assert.deepEqual(
          projectSource(record, state, input),
          project,
          'Original project source changed during observation',
        );
      binding.quiescenceDigest = digest({ first, second, resources: before });
      executionBinding({ ...record, executionBindings: [...(record.executionBindings ?? []), binding] });
      return true;
    };
    if (planOnly) {
      assert.equal(initial.revision, input.expectedRevision, 'Task revision changed; do not rebase');
      check(initial);
      assert.deepEqual(registry.readTask(initial.id), initial, 'Task changed during plan');
      return {
        status: 'ready-to-bind',
        taskId: initial.id,
        boardTaskId,
        executor: input.owner,
        expectedRevision: input.expectedRevision,
        queueRevision: input.queueRevision,
        boardRevision: input.boardRevision,
        readyFor: 'binding-only',
        historicalRecoveryDigest: binding.projectSourceDigest ?? null,
        historicalAvailability: previousEvidence.availability ?? 'native-readable',
        sourceReviewed: true,
        resumed: false,
        previewStarted: false,
        instruction: 'Re-read exact native observations, then rebind with this source digest and unchanged revisions',
      };
    }
    return registry.bindExecution(initial.id, input.expectedRevision, binding, check);
  });
  if (planOnly) return task;
  return { status: 'bound', task, replayed: false, resumed: false, previewStarted: false };
}

export function rebindingAdapters(root) {
  const registry = createTaskRegistry(root);
  return { registry, queue: createExecutionOrder(registry.commonDir) };
}

export async function resumeBoundTask(
  input,
  host,
  { registry, queue, observe = host.observe ?? observeCancellationHost },
) {
  const task = registry.resolve({ id: input.taskId });
  assert.equal(task.revision, input.taskRevision, 'Task revision changed before resume');
  const binding = executionBinding(task);
  assert.ok(binding, 'No historical execution binding; use normal enrolled start');
  assertTaskExecutor(task);
  assert.equal(input.owner, binding.executor);
  assert.equal(input.rootThreadId, binding.coordinator);
  requireTaskCoordinator(registry.commonDir, input.rootThreadId);
  assert.deepEqual(input.request, binding.request, 'Exact bound takeover instruction required');
  assert.equal(input.kind, task.kind, 'Task kind must remain unchanged');
  await verifyTaskAuthorization(registry.commonDir, input, host.readThread, {
    readUnavailableThread: host.readUnavailableThread,
    verifyPreservedSource: async () => {
      assert.deepEqual(binding.request, input.request);
      const current = registry.readTask(task.id);
      assert.deepEqual(current, task, 'Bound project source changed');
      const state = queue.read();
      assert.equal(state.revision, input.queueRevision);
      assert.ok(
        state.tickets.some(
          (ticket) =>
            ticket.task === task.id &&
            ticket.owner === task.owner &&
            ticket.request.authorId === input.request.authorId,
        ),
        'Original bound project authorization is missing',
      );
    },
  });
  const board = await host.readTask(binding.boardTaskId);
  assert.ok(
    board && !board.deleted_at && ['active', 'review', 'merging'].includes(board.status),
    'Paused, cancelled, archived or completed board task cannot resume',
  );
  if (input.lane === 'development') assert.equal(board.status, 'active', 'Development must remain in its active card');
  assert.equal(board.id, binding.boardTaskId);
  assert.equal(board.revision, input.boardRevision, 'Board revision changed before resume');
  verifyExecutionWorker(
    await host.readThread(input.owner),
    { ...input, rootThreadId: binding.nativeEvidence?.worker.sourceRootThreadId ?? input.rootThreadId },
    threadTitle(board),
  );
  assert.equal(board.task_number, binding.monitoring.taskNumber);
  assert.equal(board.title, binding.monitoring.taskName);
  const state = queue.read();
  assert.equal(state?.revision, input.queueRevision, 'Queue changed; read back before resuming');
  assert.equal(state.paused, true, 'Use the ordinary FIFO when not paused');
  const ticket = state.tickets.find((t) => t.task === task.id && t.lane === input.lane);
  const scoped = [...(state.scopedAdmissions ?? []), ...(state.scopedAdmission ? [state.scopedAdmission] : [])];
  assert.ok(
    ticket &&
      ['queued', 'blocked', 'running'].includes(ticket.status) &&
      !scoped.some((s) => s.task === task.id && s.lane === input.lane) &&
      !state.events.some((e) => e.bindingRef?.task === task.id && e.bindingRef?.revision === binding.revision),
    'Only a fenced historical task may resume; never replay a running task',
  );
  assert.equal(ticket.owner, task.owner);
  if (task.dependsOn?.length || task.actionDependencies?.length) {
    assert.equal(typeof host.dependenciesReady, 'function', 'Formal delivered dependency proof required');
    assert.equal(
      host.dependenciesReady(task, input.lane === 'development' ? 'development' : 'final'),
      true,
      'Waiting for formally delivered task dependencies',
    );
  }
  const assertResumeReady = () => {
    const before = resources(task);
    const source = binding.sourceContentDigest ? projectSource(task, state, input) : null;
    const sourceDigest = (value) => digest({ head: value.head, index: value.index, entries: value.entries });
    if (source)
      assert.equal(
        sourceDigest(source),
        binding.sourceContentDigest,
        'Project source changed since binding; preserve and review a new binding',
      );
    const first = observe();
    assertHostIdle(first, task);
    const second = observe();
    assertHostIdle(second, task);
    assert.deepEqual(resources(task), before, 'Resources changed before admission');
    if (source)
      assert.equal(
        sourceDigest(projectSource(task, state, input)),
        binding.sourceContentDigest,
        'Project source changed before admission',
      );
    assert.deepEqual(registry.readTask(task.id), task, 'Task changed before admission');
  };
  if (input.lane === 'development') {
    assert.ok(
      !task.frozen && ['developing', 'dev-validated', 'blocked'].includes(task.stage),
      'Frozen formal source must resume in the delivery lane',
    );
    const capacity = await host.readCapacity();
    for (const key of ['limit', 'activeDevelopment', 'activeDelivery', 'activeOther'])
      assert.ok(Number.isSafeInteger(capacity[key]) && capacity[key] >= 0, 'Actual capacity required');
    assert.ok(
      capacity.activeDelivery <= 1 &&
        capacity.activeDevelopment + capacity.activeDelivery + capacity.activeOther <= capacity.limit,
    );
    assert.ok(capacity.activeDevelopment < capacity.limit - capacity.activeOther - 1, 'Reserve delivery executor');
    assertResumeReady();
    queue.direct({
      action: 'resume-selected',
      request: input.request,
      capacity,
      expectedRevision: input.queueRevision,
      bindingRef: { task: task.id, revision: binding.revision },
      members: [
        { lane: 'development', task: task.id, owner: task.owner, kind: task.kind, monitorContext: binding.monitoring },
      ],
    });
  } else {
    assert.equal(input.lane, 'delivery');
    assert.equal(typeof host.dependenciesReady, 'function', 'Formal delivered dependency proof required');
    assert.equal(
      host.dependenciesReady(task, input.lane === 'development' ? 'development' : 'final'),
      true,
      'Waiting for formally delivered task dependencies',
    );
    assertResumeReady();
    queue.direct({
      action: 'resume-only',
      lane: 'delivery',
      task: task.id,
      owner: task.owner,
      request: input.request,
      expectedRevision: input.queueRevision,
      bindingRef: { task: task.id, revision: binding.revision },
    });
  }
  const admitted = queue.read().tickets.find((t) => t.task === task.id && t.lane === input.lane);
  if (input.lane === 'delivery')
    return {
      status: 'admitted',
      task,
      lane: 'delivery',
      admission: admitted.admission,
      actor: input.owner,
      historicalOwner: task.owner,
      deliveryStarted: false,
    };
  return host.start({
    taskId: task.id,
    owner: input.owner,
    monitorContext: binding.monitoring,
    admission: admitted.admission,
  });
}
