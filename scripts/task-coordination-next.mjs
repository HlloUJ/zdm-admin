import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TASK_ACTIONS } from './task-action-dependencies.mjs';

export const coordinationDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyOf = ({ task, action }) => task + ':' + action;

function compare(a, b) {
  // Common prerequisites first, then comparable ready actions by original receipt.
  return (
    b.unblocks - a.unblocks ||
    a.order - b.order ||
    a.task.localeCompare(b.task) ||
    TASK_ACTIONS.indexOf(a.action) - TASK_ACTIONS.indexOf(b.action)
  );
}

export function planNextActions(candidates, capacity) {
  const seen = new Set();
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    assert.ok(TASK_ACTIONS.includes(candidate.action) && !seen.has(key), 'Duplicate or unknown candidate action');
    assert.ok(Number.isSafeInteger(candidate.order) && candidate.order > 0, 'Original receipt order required');
    assert.ok(Array.isArray(candidate.resources) && Array.isArray(candidate.dependencies));
    seen.add(key);
  }
  const waiting = [];
  const ready = [];
  const budget = capacity?.free;
  const reserved = capacity?.finalHeld === false ? 1 : 0;
  for (const candidate of candidates) {
    const { task, action, executor } = candidate;
    const blockers = candidate.dependencies.filter((item) => !item.ready).map((item) => item.reason);
    if (candidate.waitReason || blockers.length) {
      waiting.push({
        task,
        action,
        executor,
        reasons: [...(candidate.waitReason ? [candidate.waitReason] : []), ...blockers],
      });
      continue;
    }
    const unblocks = new Set(
      candidates
        .filter((other) =>
          other.dependencies.some((dep) => !dep.ready && dep.task === task && dep.unlockAction === action),
        )
        .map((other) => other.task),
    ).size;
    ready.push({ ...candidate, unblocks });
  }
  const selected = [];
  const held = new Set(capacity?.busyResources ?? []);
  let finalHeld = capacity?.finalHeld;
  for (const candidate of ready.sort(compare)) {
    const { task, action, executor, resources, unblocks } = candidate;
    const final = action === 'final';
    let reason;
    if (
      !Number.isSafeInteger(budget) ||
      budget < 0 ||
      typeof finalHeld !== 'boolean' ||
      !Array.isArray(capacity?.busyResources)
    )
      reason = 'Actual executor and resource capacity is unknown';
    else if (final && finalHeld) reason = 'Final main/shared runtime is occupied';
    else if (
      selected.some((other) => other.task === task || other.executor === executor) ||
      resources.some((name) => held.has(name))
    )
      reason = 'Worktree, executor or required resource is occupied';
    else if (selected.length >= budget - (!final && !finalHeld ? reserved : 0))
      reason = 'Preserve actual capacity for final delivery';
    if (reason) waiting.push({ task, action, executor, reasons: [reason] });
    else {
      selected.push({
        task,
        action,
        executor,
        unblocks,
        reason: unblocks ? `Unblocks ${unblocks} dependent task(s)` : 'Ready; original receipt order breaks ties',
      });
      for (const resource of resources) held.add(resource);
      if (final) finalHeld = true;
    }
  }
  return { selected, waiting };
}

const HANDLED_ACTION = 'coordinator-next-action';
export function recordNextAction(state, { sourceIndex, outcome, coordinator, expectedQueueRevision }) {
  assert.equal(state.revision, expectedQueueRevision, 'Queue changed before recording next action');
  assert.ok(Number.isSafeInteger(sourceIndex) && sourceIndex >= 0, 'Exact original event index required');
  const source = state.events[sourceIndex];
  assert.ok(
    source &&
      [
        'block',
        'complete',
        'preparation-finished',
        'capacity-released',
        'coordinator-observation',
        'delivery-phase-enrolled',
      ].includes(source.action),
    'Actual coordination event required',
  );
  const eventDigest = coordinationDigest({ sourceIndex, source });
  const previous = state.events.find((event) => event.action === HANDLED_ACTION && event.sourceDigest === eventDigest);
  if (previous) return structuredClone(previous);
  assert.ok(['dispatch-reserved', 'waiting'].includes(outcome.kind), 'Exact next decision or wait required');
  if (outcome.kind === 'dispatch-reserved') {
    const decision = state.dynamicDecisions?.find((item) => item.id === outcome.decisionId);
    assert.ok(
      ['reserved', 'consumed', 'finished'].includes(decision?.status),
      'Actual durable dispatch reservation required',
    );
    assert.equal(decision.input.task, outcome.task);
    assert.equal(source.task, outcome.task, 'Decision must dispose of this event');
    assert.equal(decision.coordinator, coordinator);
  } else assert.ok(typeof outcome.reason === 'string' && outcome.reason.trim(), 'Specific wait reason required');
  const record = {
    action: HANDLED_ACTION,
    sourceIndex,
    sourceDigest: eventDigest,
    coordinator,
    outcome: structuredClone(outcome),
  };
  state.events.push(record);
  return structuredClone(record);
}

export function recordCoordinationObservation(state, { task, observation, coordinator, expectedQueueRevision }) {
  assert.equal(state.revision, expectedQueueRevision, 'Queue changed during coordination observation');
  assert.ok(
    state.tickets.some((item) => item.task === task),
    'An original task ticket is required',
  );
  const digest = coordinationDigest(observation);
  const previous = state.events.findLast((event) => event.action === 'coordinator-observation' && event.task === task);
  if (previous?.digest === digest) return structuredClone(previous);
  const event = {
    action: 'coordinator-observation',
    task,
    coordinator,
    digest,
    observation: structuredClone(observation),
  };
  state.events.push(event);
  return structuredClone(event);
}
