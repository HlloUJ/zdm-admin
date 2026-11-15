import assert from 'node:assert/strict';
import { inspectTaskContinuity } from './task-continuity.mjs';

// Time prompts a check, never proves failure or interruption. No execution adapter exists here.
export function inspectTaskProgress(
  task,
  completion,
  { connected = true, paused = false, now = Date.now(), reviewAfterMs = 30 * 60_000, observeOwner } = {},
) {
  assert.ok(Number.isFinite(reviewAfterMs) && reviewAfterMs > 0);
  const base = { task: task.id, automaticResumptionEnabled: false };
  if (!task.monitoring) return { ...base, status: 'unregistered', reason: 'Historical task not enrolled' };
  if (task.stage === 'closed') return { ...base, status: 'closed', reason: 'Registered completion' };
  if (paused === true) return { ...base, status: 'paused', reason: 'Explicit pause; no interruption alert' };
  if (connected !== true || paused !== false)
    return { ...base, status: 'unknown', reason: 'Connection or pause state unverified; not proof of interruption' };
  if (task.monitoring.state !== 'registered')
    return { ...base, status: 'registration-incomplete', reason: task.monitoring.reason };
  let observation;
  try {
    observation = inspectTaskContinuity(task, completion, { observeOwner });
  } catch (error) {
    return { ...base, status: 'unknown', reason: `Execution evidence unreadable: ${error.message}` };
  }
  if (['paused', 'closed', 'interrupted', 'blocked'].includes(observation.status)) return { ...observation, ...base };
  const event = completion?.events?.at(-1);
  const anchor = event?.finishedAt ?? event?.startedAt ?? Date.parse(task.createdAt);
  if (Number.isFinite(anchor) && now >= anchor && now - anchor >= reviewAfterMs)
    return {
      ...base,
      status: observation.status === 'unobserved' ? 'unknown' : 'review-needed',
      reason: 'No newer instrumented progress for review interval; check actual worker before drawing conclusions',
      evidenceStatus: observation.status,
      anchor,
      reviewAfterMs,
    };
  return { ...observation, ...base };
}
