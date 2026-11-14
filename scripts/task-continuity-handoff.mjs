import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function safeDirectory(directory) {
  for (let p = path.resolve(directory); ; p = path.dirname(p)) {
    if (existsSync(p)) assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked handoff path');
    if (p === path.dirname(p)) break;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}
function create(file, value) {
  const fd = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const parent = openSync(path.dirname(file), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
// Mapping is supplied by the coordinating root from actual worker assignments, never inferred
// from a repository owner UUID or a process name. This module cannot wake a cloud agent.
export function continuityHandoffs(observations, bindings, observedAt) {
  assert.ok(Number.isFinite(observedAt));
  return observations
    .filter((v) => ['interrupted', 'blocked', 'awaiting-continuation', 'unobserved'].includes(v.status))
    .map((observation) => {
      const binding = bindings[observation.task];
      if (binding) {
        assert.match(binding.worker, /^\/root\/[a-z0-9_/]+$/);
        assert.ok(binding.authorization && binding.taskStableId && binding.owner);
      }
      const eventId = hash({ observation, binding: binding ?? null });
      return {
        version: 1,
        eventId,
        observedAt,
        task: observation.task,
        taskStableId: binding?.taskStableId ?? null,
        worker: binding?.worker ?? null,
        owner: binding?.owner ?? null,
        authorization: binding?.authorization ?? null,
        observation,
        action: binding ? 'inspect-original-worker-before-followup' : 'resolve-original-worker',
        canReplayCommands: false,
        canAssumeStopped: false,
        instructions: [
          'Re-read task and original worker state; a queued message or active worker is not a stopped task.',
          'If worker is active, send context only. If idle and scope is still authorized, follow up on that exact worker.',
          'Reconcile prior effects, queues, candidate and locks via original tools before any continuation.',
          'Unknown results, ownership or required confirmation block that action; report exact missing evidence.',
          'Persist claim before waking worker; uncertain wake delivery must be read back, never blindly resent.',
          'Update task overview from verified result; do not mark completed or resumed from send success alone.',
        ],
      };
    });
}
export function claimContinuityHandoff(event, directory, { now = Date.now() } = {}) {
  assert.match(event.eventId, /^[a-f0-9]{64}$/);
  assert.ok(event.worker && event.owner && event.authorization, 'Unassigned event cannot start a worker');
  assert.ok(now >= event.observedAt && now - event.observedAt <= 120000, 'Refresh stale handoff observation');
  safeDirectory(directory);
  const file = path.join(directory, event.eventId + '.claim.json');
  try {
    create(file, {
      eventId: event.eventId,
      task: event.task,
      worker: event.worker,
      owner: event.owner,
      status: 'dispatch-pending',
      claimedAt: now,
    });
  } catch (error) {
    if (error.code === 'EEXIST') return { claimed: false, status: 'must-reconcile-existing-claim' };
    throw error;
  }
  return { claimed: true, file, eventId: event.eventId };
}
export function receiptContinuityHandoff(event, directory, receipt) {
  safeDirectory(directory);
  assert.match(event.eventId, /^[a-f0-9]{64}$/);
  const file = path.join(directory, event.eventId + '.claim.json');
  assert.ok(!lstatSync(file).isSymbolicLink());
  const claim = JSON.parse(readFileSync(file));
  assert.equal(claim.worker, event.worker);
  assert.equal(claim.task, event.task);
  assert.ok(['delivered', 'unknown', 'already-running', 'blocked'].includes(receipt.status));
  assert.ok(receipt.evidence, 'Read-back or exact blocker evidence required');
  create(path.join(directory, event.eventId + '.receipt.json'), {
    eventId: event.eventId,
    ...receipt,
    taskCompleted: false,
  });
}
