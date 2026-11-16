import { notifyProgressHost } from './task-progress-host.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createProgressOutbox } from './task-progress-outbox.mjs';

// This bridge emits facts, never a board status, current_work patch or movement decision.
export function validateProgressReceipt(payload) {
  assert.ok(['queued', 'started', 'completed', 'blocked', 'paused'].includes(payload.event));
  assert.ok(payload.action && typeof payload.action.id === 'string' && payload.action.id.length > 0);
  assert.ok(typeof payload.action.label === 'string' && payload.action.label.length > 0);
  assert.ok(Number.isFinite(Date.parse(payload.observed_at)));
  assert.ok(Array.isArray(payload.evidence_refs) && payload.evidence_refs.length > 0);
  assert.ok(payload.evidence_refs.every((ref) => typeof ref === 'string' && ref.length > 0));
  assert.ok(['action', 'wait', 'none'].includes(payload.next?.kind));
  if (payload.next.kind !== 'none') assert.ok(typeof payload.next.label === 'string' && payload.next.label.length > 0);
  assert.ok(!('status' in payload) && !('current_work' in payload) && !('placement' in payload));
  if (payload.stage_fact) {
    assert.ok(['development_ready', 'begin_delivery', 'delivery_complete'].includes(payload.stage_fact.kind));
    assert.ok(payload.stage_fact.conditions && payload.stage_fact.references);
  }
  return payload;
}
export function recordToolProgress(directory, task, sourceKey, payload) {
  const receipt = createProgressOutbox(directory).enqueue(task, sourceKey, validateProgressReceipt(payload));
  notifyProgressHost(directory);
  return receipt;
}
// Must be called AFTER original evidence is durably saved. Failures cannot change the tool result.
export function bestEffortProgress(directory, task, sourceKey, payload, warn = console.error) {
  try {
    return recordToolProgress(directory, task, sourceKey, payload);
  } catch (error) {
    warn(`Task progress remains unsynchronized; original evidence retained: ${error.message}`);
    return null;
  }
}
export function captureCompletionProgress(directory, state, previous) {
  const outboxDirectory =
    path.basename(path.dirname(directory)) === 'task-delivery' && path.basename(directory) === state.batch
      ? path.join(path.dirname(path.dirname(directory)), 'task-progress', state.batch)
      : path.join(directory, 'progress'); // isolated/noncanonical sessions remain inside their own evidence directory
  for (const event of state.events ?? []) {
    if (previous?.events.some((old) => old.id === event.id && old.status === event.status)) continue;
    if (!event.id || !['running', 'success', 'failure'].includes(event.status)) continue;
    const eventType = { running: 'started', success: 'completed', failure: 'blocked' }[event.status];
    const timestamp = event.finishedAt ?? event.startedAt;
    const payload = {
      observed_at: new Date(timestamp).toISOString(),
      action: { id: event.id, label: event.name },
      event: eventType,
      evidence_refs: [`completion-session:${state.batch}:${event.id}:${event.status}`],
      next: event.next ?? { kind: 'wait', label: '下一步确认' },
      ...(event.status === 'failure' ? { reason: event.failure?.category ?? '工具执行失败，原因待确认' } : {}),
    };
    bestEffortProgress(outboxDirectory, state.batch, `completion:${event.id}:${event.status}`, payload);
  }
}
export function captureQueueProgress(commonDir, state, previous) {
  for (const ticket of state.tickets) {
    if (['completed', 'cancelled'].includes(ticket.status)) continue;
    const before = previous?.tickets.find((item) => item.task === ticket.task && item.lane === ticket.lane);
    // Admission is NOT proof of actual action start. No synthetic started event on claim.
    const changed = !before || before.status !== ticket.status || state.paused !== previous.paused;
    if (!changed || (!['queued', 'blocked'].includes(ticket.status) && !state.paused)) continue;
    const event = state.paused ? 'paused' : ticket.status;
    bestEffortProgress(
      path.join(commonDir, 'task-progress', ticket.task),
      ticket.task,
      `queue:${state.revision}:${ticket.lane}`,
      {
        observed_at: new Date().toISOString(),
        action: { id: `queue:${ticket.lane}`, label: ticket.lane },
        event,
        evidence_refs: [`execution-order:${state.revision}:${ticket.lane}:${ticket.task}`],
        next: { kind: 'wait', label: state.paused ? '等待恢复指令' : '等待执行' },
        ...(ticket.reason ? { reason: ticket.reason } : {}),
      },
    );
  }
}
