import { TASK_THREAD_MODE, createTaskThreadTitles } from './task-thread-titles.mjs';
import { taskExecutor, taskMonitoring } from './task-execution-binding.mjs';
import { executionPausedFor } from './task-execution-scope.mjs';
import { createBoardIntake, queuedProjectReference } from './task-board-intake.mjs';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { requireStartMonitoring } from './task-monitor-registration.mjs';
import { interruptionNotice, claimInterruptionNotice, receiptInterruptionNotice } from './task-interruption-notice.mjs';
import { createProgressOutbox, authenticatedBoardAdapter, flushProgress } from './task-progress-outbox.mjs';
import { recordToolProgress } from './task-delivery-status-sync.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { readTaskCoordination, verifyTaskAuthorization } from './task-coordination.mjs';

// Platform reads and writes come from the authenticated host, never from repo credentials.
// This module has no scheduler, implicit task discovery, retry, owner transfer or global resume.
export async function codexMonitoringContext(
  { taskId, owner, rootThreadId, request, coordinatorThreadId },
  { readTask, readThread, readUnavailableThread, intake, queue },
) {
  const board = await readTask(taskId);
  assert.equal(board.id, taskId, 'Exact task overview registration required');
  assert.ok(board.task_number && !board.deleted_at && board.status !== 'done', 'Current unfinished task required');
  const source = await verifyTaskAuthorization(
    intake?.commonDir ?? queue?.commonDir,
    { rootThreadId, request, coordinatorThreadId },
    readThread,
    {
      readUnavailableThread,
      ...(intake && queue
        ? {
            verifyPreservedSource: () =>
              intake.verifyQueuedSource(
                { taskId, owner, rootThreadId, request, coordinatorThreadId },
                { queue, readThread },
              ),
          }
        : {}),
    },
  );
  const worker = owner === request.roomId ? source : await readThread(owner);
  assert.equal(worker?.thread?.id, owner, 'Actual native execution thread required');
  const context = {
    executionSurface: 'codex-thread',
    worker: owner,
    rootThreadId,
    roomId: request.roomId,
    authorizationRef: request.messageId,
    taskStableId: taskId,
    taskNumber: board.task_number,
    taskName: board.title,
    ...(coordinatorThreadId ? { coordinatorThreadId } : {}),
  };
  requireStartMonitoring(owner, taskId, context);
  return context;
}

export function developmentCapacity({ limit, activeDevelopment, activeDelivery, activeOther = 0 }) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0, 'Actual executor limit required');
  for (const value of [activeDevelopment, activeDelivery, activeOther])
    assert.ok(Number.isSafeInteger(value) && value >= 0);
  assert.ok(activeDelivery <= 1, 'Delivery must remain serial');
  assert.ok(activeDevelopment + activeDelivery + activeOther <= limit, 'Invalid executor capacity snapshot');
  return { available: activeDevelopment < limit - activeOther - 1, reservedDelivery: 1 };
}

// Coordinator intake is mandatory before preflight, queue work or task dispatch.
export async function receiveCodexTask(input, host) {
  assert.ok(host.intake, 'Persistent board intake adapter required');
  const automaticMode = host.intake.modeFor?.(input.taskId);
  if (automaticMode && input.threadMode === undefined) input = { ...input, threadMode: automaticMode };
  await host.intake.accept(input, host);
  if (input.threadMode === TASK_THREAD_MODE) return receiveIndependentCodexTask(input, host);
  const context = await codexMonitoringContext(input, host);
  host.intake.require(context, input.taskId, input.owner);
  if (host.preflight) await host.preflight(input);
  return startCodexTask(input, host);
}

// Native callbacks are supplied by the authenticated desktop host. Node never invents a platform API.
async function receiveIndependentCodexTask(input, host, { continuing = false } = {}) {
  assert.equal(
    process.env.CODEX_THREAD_ID,
    input.coordinatorThreadId ?? input.rootThreadId,
    'Actual coordinator runtime required',
  );
  assert.equal(host.intake.commonDir, host.queue?.commonDir, 'Intake and queue must share the actual store');
  const { queue } = host;
  let state = queue.read();
  assert.ok(state, 'Execution policy required');
  const titles = createTaskThreadTitles(queue.commonDir);
  const existing = state.tickets.find((t) => t.lane === 'development' && t.task === input.taskId);
  if ((!existing || existing.awaitingNativeWorker) && !continuing)
    queue.enqueue({
      lane: 'development',
      task: input.taskId,
      owner: input.rootThreadId,
      request: input.request,
      awaitingNativeWorker: true,
    });
  else if (!continuing) {
    assert.equal(existing.nativeCoordinatorOwner, input.rootThreadId, 'Existing task cannot be adopted');
    assert.deepEqual(existing.request, input.request);
    assert.ok(titles.get(input.taskId), 'Original native binding required');
    assert.equal(existing.status, 'queued', 'Started tasks cannot be dispatched again');
  }
  state = queue.read();
  if (state.paused && input.startWhilePaused !== true)
    return { status: 'queued', taskId: input.taskId, reason: 'global-pause' };
  const first = state.tickets
    .filter((t) => t.lane === 'development' && t.status === 'queued')
    .sort((a, b) => a.order - b.order)[0];
  // Explicit fresh-task scoped start may leave old paused tickets untouched; ordinary mode remains FIFO.
  if (!state.paused && first.task !== input.taskId) return { status: 'queued', taskId: input.taskId, reason: 'fifo' };
  let capacity, snapshot;
  try {
    snapshot = host.readCapacity ? await host.readCapacity() : null;
    capacity = snapshot ? developmentCapacity(snapshot) : null;
  } catch {
    /* no unverified spawn */
  }
  const occupied = state.tickets.filter(
    (t) => t.lane === 'development' && ['running', 'blocked'].includes(t.status),
  ).length;
  if (!capacity?.available || (!state.paused && occupied >= (state.limits?.development ?? state.limit)))
    return { status: 'queued', taskId: input.taskId, reason: 'execution-capacity-unverified-or-reserved' };
  try {
    queue.reserveNativeCreation({
      task: input.taskId,
      owner: input.rootThreadId,
      request: input.request,
      capacity: snapshot,
      ...(input.coordinatorThreadId ? { coordinatorThreadId: input.coordinatorThreadId } : {}),
    });
  } catch (error) {
    return { status: 'queued', taskId: input.taskId, reason: error.message };
  }
  if (host.preflight) await host.preflight(input);
  const title = await titles.ensure(input, host);
  if (title.status !== 'confirmed') return title;
  const workerInput = { ...input, owner: title.threadId };
  const board = await host.readTask(input.taskId);
  const context = {
    executionSurface: 'codex-thread',
    worker: title.threadId,
    rootThreadId: input.rootThreadId,
    roomId: input.request.roomId,
    authorizationRef: input.request.messageId,
    taskStableId: input.taskId,
    taskNumber: board.task_number,
    taskName: board.title,
    ...(input.coordinatorThreadId ? { coordinatorThreadId: input.coordinatorThreadId } : {}),
  };
  queue.bindNativeWorker({
    task: input.taskId,
    coordinatorOwner: input.rootThreadId,
    workerOwner: title.threadId,
    request: input.request,
    context,
    ...(input.coordinatorThreadId ? { coordinatorThreadId: input.coordinatorThreadId } : {}),
  });
  if (!host.dispatchWorker) return { status: 'awaiting-worker-start', taskId: input.taskId, workerInput, title };
  return { ...(await titles.dispatch(input.taskId, workerInput, host)), workerInput, title };
}

export async function continueAcceptedCodexTask(input, host) {
  assert.equal(input.threadMode, TASK_THREAD_MODE);
  assert.equal(
    process.env.CODEX_THREAD_ID,
    input.coordinatorThreadId,
    'Actual current continuation coordinator required',
  );
  await host.intake.continueCoordinator(input, host);
  const state = host.queue.read();
  const latestPause = Math.max(
    0,
    ...state.events.filter((event) => event.action === 'pause-all').map((event) => event.request.sequence),
  );
  if (input.continuationRequest.sequence <= latestPause)
    return { status: 'queued', taskId: input.taskId, reason: 'newer-global-pause' };
  return receiveIndependentCodexTask({ ...input, startWhilePaused: true }, host, { continuing: true });
}

export async function startIndependentCodexTask(input, host) {
  assert.equal(input.threadMode, TASK_THREAD_MODE);
  const context = await codexMonitoringContext(input, host); // Checks the actual worker process identity.
  const state = host.queue.read();
  const ticket = state.tickets.find((t) => t.lane === 'development' && t.task === input.taskId);
  assert.ok(ticket && ticket.nativeCoordinatorOwner === input.rootThreadId && !ticket.awaitingNativeWorker);
  assert.equal(ticket.owner, input.owner);
  assert.deepEqual(ticket.request, input.request);
  assert.equal(ticket.status, 'queued', 'Never replay a started or blocked worker');
  assert.equal(ticket.admission, null);
  const projectAuthority = readTaskCoordination(host.queue.commonDir)
    ? queuedProjectReference(host.queue.commonDir, input, state)
    : null;
  const executionRequest = projectAuthority?.executionRequest ?? input.request;
  if (projectAuthority?.executionKind)
    assert.equal(input.kind, projectAuthority.executionKind, 'Accepted queued kind differs');
  if (state.paused) {
    assert.ok(input.startWhilePaused === true || executionRequest !== input.request, 'Global pause remains in effect');
    const latestPause = Math.max(
      0,
      ...state.events.filter((event) => event.action === 'pause-all').map((event) => event.request.sequence),
    );
    assert.ok(executionRequest.sequence > latestPause, 'A later pause revoked this queued direction');
  }
  await host.intake.refreshForStart(input, {
    ...host,
    verifyQueued: () => {
      const fresh = host.queue.read();
      assert.equal(fresh.revision, state.revision, 'Queue changed during start preflight');
      assert.deepEqual(
        fresh.tickets.find((t) => t.lane === 'development' && t.task === input.taskId),
        ticket,
      );
    },
  });
  createBoardIntake(host.queue.commonDir).require(context, input.taskId, input.owner);
  if (!state.paused) return startCodexTask(input, host);
  const capacity = await host.readCapacity();
  developmentCapacity(capacity);
  const currentCoordination = readTaskCoordination(host.queue.commonDir);
  const bindingRef = currentCoordination
    ? queuedProjectReference(host.queue.commonDir, input, host.queue.read())
    : null;
  host.queue.direct({
    action: 'resume-selected',
    request: bindingRef?.executionRequest ?? input.request,
    capacity,
    ...(bindingRef ? { bindingRef } : {}),
    members: [
      { lane: 'development', task: input.taskId, owner: input.owner, kind: input.kind, monitorContext: context },
    ],
  });
  const admission = host.queue.read().tickets.find((t) => t.lane === 'development' && t.task === input.taskId);
  const result = await host.start({
    taskId: input.taskId,
    owner: input.owner,
    monitorContext: context,
    admission: admission.admission,
  });
  assert.equal(result.task.id, input.taskId);
  assert.equal(result.task.owner, input.owner);
  assert.equal(result.task.monitoring.worker, context.worker);
  assert.equal(result.task.monitoring.executionSurface, 'codex-thread');
  return result;
}

export async function startCodexTask(
  input,
  { queue, readTask, readThread, start, readCapacity, intake, readUnavailableThread },
) {
  const context = await codexMonitoringContext(input, { queue, readTask, readThread, intake, readUnavailableThread });
  assert.ok(queue.commonDir, 'Persistent intake store required before queue dispatch');
  createBoardIntake(queue.commonDir).require(context, input.taskId, input.owner);
  const state = queue.read();
  assert.ok(state, 'Execution policy required');
  const ticket = state.tickets.find((t) => t.lane === 'development' && t.task === input.taskId);
  assert.ok(ticket && !executionPausedFor(state, ticket), 'Global pause remains in effect');
  assert.ok(ticket.status === 'queued', 'Only a queued new task may be dispatched; do not replay launch');
  assert.equal(ticket.owner, input.owner);
  assert.deepEqual(ticket.request, input.request, 'Original queued instruction required');
  let capacity;
  try {
    capacity = readCapacity ? developmentCapacity(await readCapacity()) : null;
  } catch {
    return { status: 'queued', taskId: input.taskId, reason: 'execution-capacity-unverified' };
  }
  if ((state.limits?.development === null && !capacity) || capacity?.available === false)
    return {
      status: 'queued',
      taskId: input.taskId,
      reason: capacity ? 'execution-capacity-reserved-for-delivery' : 'execution-capacity-unverified',
    };
  const admission = queue.claim({
    lane: 'development',
    task: input.taskId,
    owner: input.owner,
    monitorContext: context,
  });
  // Failure retains the occupied admission. A caller must inspect original evidence, not launch again.
  const result = await start({
    taskId: input.taskId,
    owner: input.owner,
    monitorContext: context,
    admission: admission.admission,
  });
  assert.equal(result.task.id, input.taskId);
  assert.equal(result.task.owner, input.owner);
  assert.deepEqual(result.task.monitoring.worker, context.worker);
  assert.equal(result.task.monitoring.executionSurface, 'codex-thread');
  return result; // Admission alone is never emitted as a started receipt.
}

export async function observeCodexTask(task, { readThread, readAgent, paused, now = Date.now() }) {
  const base = { task: task.id, observedAt: now, automaticResumptionEnabled: false };
  if (task.stage === 'closed') return { ...base, status: 'closed' };
  if (paused === true) return { ...base, status: 'paused' };
  if (paused !== false) return { ...base, status: 'unknown', reason: 'Current pause state not verified' };
  const m = taskMonitoring(task);
  if (m.executionSurface === 'collaboration-agent') {
    if (typeof readAgent !== 'function')
      return {
        ...base,
        status: 'unknown',
        reason:
          'Direct collaboration executor observation adapter unavailable; parent chat activity is not task liveness',
      };
    try {
      assert.equal(m.state, 'registered');
      assert.equal(m.rootThreadId, task.owner);
      const agent = await readAgent(m.worker);
      assert.equal(agent.canonicalTaskName, m.worker, 'Wrong collaboration executor');
      // A direct inventory alone cannot prove the task assignment of a reused agent.
      // The owner host must bind it to its recorded dispatch, never to the latest parent cwd.
      assert.deepEqual(
        agent.binding,
        { task: task.id, owner: task.owner, worker: m.worker, worktree: task.worktree },
        'Unverified executor assignment',
      );
      assert.ok(
        Number.isFinite(agent.observedAt) && agent.observedAt <= now && now - agent.observedAt <= 60_000,
        'Stale executor observation',
      );
      const observed = {
        ...base,
        executor: { kind: 'collaboration-agent', canonical: m.worker },
        executorStatus: agent.status,
      };
      if (agent.status === 'running')
        return { ...observed, status: 'running', reason: 'Direct assigned collaboration executor is running' };
      if (
        agent.status === 'error' &&
        agent.failure?.id &&
        Number.isFinite(agent.failure.finishedAt) &&
        agent.failure.finishedAt <= now
      )
        return {
          ...observed,
          status: 'blocked',
          reason: 'Assigned executor ended with an explicit failure',
          failureEvent: {
            id: agent.failure.id,
            name: 'collaboration-agent',
            status: 'failure',
            finishedAt: agent.failure.finishedAt,
          },
        };
      return {
        ...observed,
        status: 'unknown',
        reason: 'Executor ended or is idle; verify actual task stage without inferring completion',
      };
    } catch (error) {
      return { ...base, status: 'unknown', reason: `Collaboration observation unavailable: ${error.message}` };
    }
  }
  assert.equal(m.executionSurface, 'codex-thread');
  assert.equal(m.state, 'registered');
  assert.equal(m.worker, taskExecutor(task));
  try {
    const snapshot = await readThread(m.worker);
    assert.equal(snapshot.thread.id, taskExecutor(task), 'Wrong platform thread');
    if (snapshot.thread.cwd && task.worktree && path.resolve(snapshot.thread.cwd) !== path.resolve(task.worktree)) {
      // Native chats can stay attached to the main anchor while each tool uses its exact task cwd.
      // Only the newest command in the latest platform turn can establish that binding.
      const commands = snapshot.turns?.[0]?.items?.filter((item) => item.type === 'commandExecution') ?? [];
      const latest = commands.at(-1);
      assert.ok(latest?.cwd, 'Thread worktree changed; no actual task command binding');
      assert.equal(path.resolve(latest.cwd), path.resolve(task.worktree), 'Thread worktree changed');
    }
    const turn = snapshot.turns?.[0];
    const status = snapshot.thread.status;
    if (['active', 'running'].includes(typeof status === 'string' ? status : status?.type))
      return { ...base, status: 'running', reason: 'Platform reports an active thread; silence is not interruption' };
    if (turn?.error && turn.id && Number.isFinite(turn.completedAt)) {
      const finishedAt = turn.completedAt * 1000;
      assert.ok(finishedAt <= now, 'Future platform evidence refused');
      return {
        ...base,
        status: 'blocked',
        reason: 'Platform turn ended with an explicit error; inspect original failure',
        failureEvent: { id: turn.id, name: 'codex-turn', status: 'failure', finishedAt },
      };
    }
    return {
      ...base,
      status: 'unknown',
      reason: 'No matching active execution or explicit failure; inspect task evidence',
    };
  } catch (error) {
    return { ...base, status: 'unknown', reason: `Platform observation unavailable: ${error.message}` };
  }
}

export async function inspectCodexTasks(root, { taskIds, readThread, readAgent, now = Date.now() }) {
  assert.ok(Array.isArray(taskIds) && taskIds.length > 0, 'Explicit task allowlist required; no global scan');
  assert.equal(new Set(taskIds).size, taskIds.length);
  const registry = createTaskRegistry(root);
  const queue = createExecutionOrder(registry.commonDir).read();
  const results = [];
  for (const id of taskIds) {
    const task = registry.readTask(id);
    assert.ok(task, 'Exact registered task required');
    const ticket = queue?.tickets.find((t) => t.task === id && t.lane === 'development');
    const paused = executionPausedFor(queue, ticket) || taskMonitoring(task)?.paused === true;
    if (ticket?.status === 'queued') {
      results.push({ task: id, status: paused ? 'paused' : 'queued', automaticResumptionEnabled: false });
      continue;
    }
    results.push(await observeCodexTask(task, { readThread, readAgent, paused, now }));
  }
  return results;
}

export async function notifyCodexObservation(
  task,
  observation,
  { directory, paused, readThread, sendMessage, readMessage, now = Date.now() },
) {
  const m = taskMonitoring(task);
  assert.ok(['codex-thread', 'collaboration-agent'].includes(m.executionSurface));
  const currentCoordinator = task.repository?.commonDir
    ? readTaskCoordination(task.repository.commonDir)?.current.rootThreadId
    : null;
  const coordinator = currentCoordinator ?? m.coordinatorThreadId ?? m.rootThreadId;
  assert.equal(coordinator, process.env.CODEX_THREAD_ID, 'Current coordinator must send');
  const observedAt = observation.observedAt;
  if (!Number.isFinite(observedAt) || observedAt > now || now - observedAt > 60_000)
    return { status: 'stale-observation' };
  if (paused === true) return { status: 'silent' };
  // Re-read platform identity immediately before notification. Unknown delivery is never resent.
  const roomId = coordinator;
  const target = await readThread(roomId);
  assert.equal(target.thread.id, roomId);
  const notice = interruptionNotice(
    { ...m, rootThreadId: coordinator, roomId, task: task.id, monitoringMode: m.mode, resumeAllowed: false },
    observation,
    { connected: true, paused, now, observedAt },
  );
  if (!notice) return { status: 'silent' };
  const claimed = claimInterruptionNotice(directory, notice);
  if (claimed.status !== 'send-once') {
    const receipt = path.join(directory, notice.eventId + '.receipt.json');
    return { status: existsSync(receipt) ? 'already-delivered' : 'delivery-unknown', eventId: notice.eventId };
  }
  try {
    const sent = await sendMessage({ threadId: roomId, text: notice.text, eventId: notice.eventId });
    const back = await readMessage(roomId, sent.messageId);
    receiptInterruptionNotice(directory, notice, {
      messageId: sent.messageId,
      readbackRoom: back.roomId,
      readbackText: back.text,
    });
    return { status: 'delivered', eventId: notice.eventId };
  } catch (error) {
    return { status: 'delivery-unknown', reason: error.message, eventId: notice.eventId };
  }
}

// The 417 receipt protocol is reused verbatim. No invented receipt endpoint or inference from prose.
// If the connected host lacks receipt methods, keep the outbox and report transport unavailable.
export async function syncCodexProgress(directory, call) {
  return flushProgress(createProgressOutbox(directory), authenticatedBoardAdapter(call));
}
export function recordCodexProgress(directory, taskId, sourceKey, payload) {
  return recordToolProgress(directory, taskId, sourceKey, payload);
}

export function readCodexNoticeReceipt(directory, eventId) {
  assert.match(eventId, /^[a-f0-9]{64}$/);
  return JSON.parse(readFileSync(path.join(directory, eventId + '.receipt.json'), 'utf8'));
}
