import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { requireStartMonitoring } from './task-monitor-registration.mjs';
import { interruptionNotice, claimInterruptionNotice, receiptInterruptionNotice } from './task-interruption-notice.mjs';
import { createProgressOutbox, authenticatedBoardAdapter, flushProgress } from './task-progress-outbox.mjs';
import { recordToolProgress } from './task-delivery-status-sync.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';

// Platform reads and writes come from the authenticated host, never from repo credentials.
// This module has no scheduler, implicit task discovery, retry, owner transfer or global resume.
export async function codexMonitoringContext({ taskId, owner, rootThreadId, request }, { readTask, readThread }) {
  const board = await readTask(taskId);
  assert.equal(board.id, taskId, 'Exact task overview registration required');
  assert.ok(board.task_number && !board.deleted_at && board.status !== 'done', 'Current unfinished task required');
  assert.equal(request.roomId, rootThreadId, 'Native instruction room must be the coordinator thread');
  const source = await readThread(rootThreadId);
  assert.equal(source.thread.id, rootThreadId);
  assert.ok(
    source.turns.some((turn) =>
      turn.items?.some((item) => item.type === 'userMessage' && item.id === request.messageId),
    ),
    'Actual user execution message must be read from the platform',
  );
  const worker = owner === rootThreadId ? source : await readThread(owner);
  assert.equal(worker.thread.id, owner, 'Actual native execution thread required');
  const context = {
    executionSurface: 'codex-thread',
    worker: owner,
    rootThreadId,
    roomId: request.roomId,
    authorizationRef: request.messageId,
    taskStableId: taskId,
    taskNumber: board.task_number,
    taskName: board.title,
  };
  requireStartMonitoring(owner, taskId, context);
  return context;
}

export async function startCodexTask(input, { queue, readTask, readThread, start }) {
  const context = await codexMonitoringContext(input, { readTask, readThread });
  const state = queue.read();
  assert.ok(state && !state.paused, 'Global pause remains in effect');
  const ticket = state.tickets.find((t) => t.lane === 'development' && t.task === input.taskId);
  assert.ok(ticket && ticket.status === 'queued', 'Only a queued new task may be dispatched; do not replay launch');
  assert.equal(ticket.owner, input.owner);
  assert.deepEqual(ticket.request, input.request, 'Original queued instruction required');
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

export async function observeCodexTask(task, { readThread, paused, now = Date.now() }) {
  const base = { task: task.id, observedAt: now, automaticResumptionEnabled: false };
  if (task.stage === 'closed') return { ...base, status: 'closed' };
  if (paused === true) return { ...base, status: 'paused' };
  if (paused !== false) return { ...base, status: 'unknown', reason: 'Current pause state not verified' };
  const m = task.monitoring;
  assert.equal(m.executionSurface, 'codex-thread');
  assert.equal(m.state, 'registered');
  assert.equal(m.worker, task.owner);
  try {
    const snapshot = await readThread(m.worker);
    assert.equal(snapshot.thread.id, task.owner, 'Wrong platform thread');
    if (snapshot.thread.cwd && task.worktree)
      assert.equal(path.resolve(snapshot.thread.cwd), path.resolve(task.worktree), 'Thread worktree changed');
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

export async function inspectCodexTasks(root, { taskIds, readThread, now = Date.now() }) {
  assert.ok(Array.isArray(taskIds) && taskIds.length > 0, 'Explicit task allowlist required; no global scan');
  assert.equal(new Set(taskIds).size, taskIds.length);
  const registry = createTaskRegistry(root);
  const queue = createExecutionOrder(registry.commonDir).read();
  const results = [];
  for (const id of taskIds) {
    const task = registry.readTask(id);
    assert.ok(task, 'Exact registered task required');
    const ticket = queue?.tickets.find((t) => t.task === id && t.lane === 'development');
    const paused = queue?.paused === true || task.monitoring?.paused === true;
    if (ticket?.status === 'queued') {
      results.push({ task: id, status: paused ? 'paused' : 'queued', automaticResumptionEnabled: false });
      continue;
    }
    results.push(await observeCodexTask(task, { readThread, paused, now }));
  }
  return results;
}

export async function notifyCodexObservation(
  task,
  observation,
  { directory, paused, readThread, sendMessage, readMessage, now = Date.now() },
) {
  const m = task.monitoring;
  assert.equal(m.executionSurface, 'codex-thread');
  assert.equal(m.rootThreadId, process.env.CODEX_THREAD_ID, 'Original coordinator must send');
  const observedAt = observation.observedAt;
  if (!Number.isFinite(observedAt) || observedAt > now || now - observedAt > 60_000)
    return { status: 'stale-observation' };
  if (paused === true) return { status: 'silent' };
  // Re-read platform identity immediately before notification. Unknown delivery is never resent.
  const target = await readThread(m.roomId);
  assert.equal(target.thread.id, m.roomId);
  const notice = interruptionNotice(
    { ...m, task: task.id, monitoringMode: m.mode, resumeAllowed: false },
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
    const sent = await sendMessage({ threadId: m.roomId, text: notice.text, eventId: notice.eventId });
    const back = await readMessage(m.roomId, sent.messageId);
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
