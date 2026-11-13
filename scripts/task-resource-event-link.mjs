import assert from 'node:assert/strict';
import { schedulingNotice } from './task-resource-notifications.mjs';
const active = (status) => ['starting', 'running', 'stopping'].includes(status);
const changes = new Set(['starting', 'stopping', 'resource-paused', 'blocked', 'done']);
// Event history is authoritative. Counts are reconstructed from the frozen snapshot, never current CPU samples.
export function schedulerNotices(snapshot, resolveTask) {
  const events = [...snapshot.events].sort((a, b) => a.id - b.id);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length, 'Duplicate event sequence');
  const statuses = new Map(snapshot.jobs.map((j) => [j.id, j.status]));
  for (const e of [...events].reverse()) statuses.set(e.job, e.from);
  const count = () => [...statuses.values()].filter(active).length;
  const notices = [];
  for (const event of events) {
    const parallelBefore = count();
    statuses.set(event.job, event.to);
    const parallelAfter = count();
    if (!changes.has(event.to)) continue;
    const identity = resolveTask(event.task);
    assert.ok(identity?.stableId && identity?.label, 'Exact task stable ID and display label required');
    notices.push(
      schedulingNotice(
        { ...event, parallelBefore, parallelAfter, taskStableId: identity.stableId },
        { taskLabel: identity.label },
      ),
    );
  }
  return notices;
}
export function exportSchedulerNotices({ broker, outbox, resolveTask }) {
  let added = 0;
  for (const notice of schedulerNotices(broker.snapshot(), resolveTask)) if (outbox.enqueue(notice)) added++;
  return { added };
}
// Does not send native notifications. The separate outbox pump must run independently.
export function tickWithNotificationExport({ broker, outbox, resolveTask, sample }) {
  const actions = broker.tick(sample);
  try {
    return {
      actions,
      notificationExport: exportSchedulerNotices({ broker, outbox, resolveTask }),
      notificationHealth: 'ready',
    };
  } catch (error) {
    return { actions, notificationHealth: 'pending-error', notificationError: error.message };
  }
}
