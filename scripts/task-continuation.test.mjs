import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectActionDependencies, requireActionDependencies } from './task-action-dependencies.mjs';
import { assertParkedContinuation, releaseIdleCapacity, validateReleasedCapacity } from './task-capacity-release.mjs';
import {
  coordinationOccupancy,
  pendingCoordinationEvents,
  planNextActions,
  recordCoordinationObservation,
  recordNextAction,
} from './task-coordination-next.mjs';

const head = 'a'.repeat(40);
test('dependency evidence stops only declared actions while old task-wide dependencies keep their scope', () => {
  const task = {
    id: 'consumer',
    dependsOn: [],
    actionDependencies: [
      { task: 'provider', actions: ['combination'], evidence: 'source', head },
      { task: 'provider', actions: ['runtime'], evidence: 'runtime', head },
      { task: 'provider', actions: ['final'], evidence: 'delivery' },
    ],
  };
  const readers = { source: (dependency) => ({ head: dependency.head }) };
  for (const action of ['development', 'preparation', 'combination'])
    assert.equal(requireActionDependencies(collectActionDependencies(task, action, readers)), true);
  for (const action of ['final', 'runtime'])
    assert.throws(
      () => requireActionDependencies(collectActionDependencies(task, action, readers)),
      /waits for provider/,
    );
  task.dependsOn = ['legacy'];
  for (const action of ['development', 'preparation'])
    assert.throws(
      () => requireActionDependencies(collectActionDependencies(task, action, readers)),
      /waits for legacy/,
    );
});

const action = (task, name, order, options) => ({
  task,
  action: name,
  order,
  executor: 'worker:' + task,
  dependencies: [],
  resources: ['task:' + task],
  ...options,
});
test('a ready shared prerequisite can outrank an older action without starving unrelated ready work', () => {
  const candidates = [
    action('older', 'preparation', 1),
    action('consumer', 'final', 2, {
      dependencies: [{ task: 'dependency', ready: false, reason: 'Unmerged', unlockAction: 'final' }],
    }),
    action('dependency', 'final', 3),
    action('peer', 'development', 4),
    action('same-resource', 'preparation', 5, { resources: ['task:peer'] }),
    action('other-final', 'final', 6),
  ];
  const plan = planNextActions(candidates, { free: 3, finalHeld: false, busyResources: [] });
  assert.deepEqual(
    plan.selected.map(({ task }) => task),
    ['dependency', 'older', 'peer'],
  );
  assert.ok(plan.waiting.some(({ task, reasons }) => task === 'consumer' && reasons.includes('Unmerged')));
  assert.ok(plan.waiting.some(({ task, reasons }) => task === 'other-final' && reasons[0].includes('occupied')));
  assert.deepEqual(planNextActions(candidates, null).selected, []);
  assert.deepEqual(planNextActions([candidates[0]], { free: 1, finalHeld: false, busyResources: [] }).selected, []);
});

function blocked() {
  const ticket = {
    task: 'example',
    owner: 'worker',
    status: 'blocked',
    lane: 'development',
    admission: 'original',
    reason: 'Waiting on source',
  };
  const state = {
    revision: 4,
    tickets: [ticket],
    events: [
      { action: 'pause-all', request: { sequence: 2 } },
      { action: 'block', task: ticket.task, reason: ticket.reason },
    ],
  };
  const input = {
    task: ticket.task,
    owner: ticket.owner,
    lane: ticket.lane,
    admission: ticket.admission,
    action: 'development',
    expectedQueueRevision: 4,
    recovery: { kind: 'resource', reason: 'Original isolated runtime is available' },
  };
  const checkpoint = { head, revision: 3, executor: ticket.owner, bindingRevision: 0 };
  const proof = { checkpoint, coordinator: 'root', idle: { ...ticket, originalHead: head, outcome: 'quiescent' } };
  return { state, ticket, input, proof };
}
test('safe release preserves the old ticket and only a fresh matching checkpoint can resume', () => {
  const { state, ticket, input, proof } = blocked();
  assert.throws(
    () =>
      releaseIdleCapacity(state, input, () => {
        throw Error('Unknown CI state');
      }),
    /Unknown CI state/,
  );
  assert.equal(ticket.status, 'blocked');
  assert.equal(releaseIdleCapacity(state, input, () => proof).status, 'parked');
  assert.equal(ticket.admission, 'original');
  assert.equal(ticket.reason, 'Waiting on source');
  validateReleasedCapacity(state, ticket);
  assert.equal(state.events.length, 3);
  releaseIdleCapacity(state, input, (_ticket, { replay }) => assert.equal(replay, true));
  assert.equal(state.events.length, 3);
  const next = {
    task: { revision: 4, recordedHead: head },
    sourceProof: { head },
    executor: 'worker',
    bindingRevision: 0,
  };
  assertParkedContinuation(state, ticket, next, 'development');
  assert.throws(
    () => assertParkedContinuation(state, ticket, { ...next, sourceProof: { head: 'b'.repeat(40) } }, 'development'),
    /Parked candidate changed/,
  );
  state.events.push({ action: 'pause-all', request: { sequence: 5 } });
  assert.throws(() => assertParkedContinuation(state, ticket, next, 'development'), /later user pause/);
});

test('observations and next decisions persist once per actual event without conflating repeated failures', () => {
  const { state } = blocked();
  const observation = {
    task: 'example',
    coordinator: 'root',
    observation: { dependency: false },
    expectedQueueRevision: 4,
  };
  assert.deepEqual(
    recordCoordinationObservation(state, observation),
    recordCoordinationObservation(state, observation),
  );
  const waiting = {
    sourceIndex: 1,
    expectedQueueRevision: 4,
    coordinator: 'root',
    outcome: { kind: 'waiting', reason: 'Waiting on source' },
  };
  const first = recordNextAction(state, waiting);
  assert.deepEqual(recordNextAction(state, waiting), first);
  state.events.push(structuredClone(state.events[1]));
  assert.notEqual(
    recordNextAction(state, { ...waiting, sourceIndex: state.events.length - 1 }).sourceDigest,
    first.sourceDigest,
  );
  assert.throws(
    () =>
      recordNextAction(state, {
        ...waiting,
        sourceIndex: 2,
        outcome: { kind: 'dispatch-reserved', decisionId: 'missing', task: 'example' },
      }),
    /durable dispatch reservation/,
  );
});

test('an already closed delivery clears only its original coordination event', () => {
  const event = { action: 'complete', lane: 'delivery', task: 'done', evidenceDigest: 'retained-proof' };
  const ticket = {
    task: 'done',
    lane: 'delivery',
    status: 'completed',
    completion: { digest: 'retained-proof', evidence: { main: head } },
  };
  const state = {
    events: [event, { action: 'block', task: 'still-working', lane: 'development' }],
    tickets: [ticket],
    revision: 4,
  };
  const scope = ['done', 'still-working'];
  assert.equal(pendingCoordinationEvents(state, scope).length, 2);
  const input = {
    sourceIndex: 0,
    expectedQueueRevision: 4,
    coordinator: 'root',
    outcome: { kind: 'delivery-closed', main: head },
  };
  assert.throws(() => recordNextAction(state, { ...input, outcome: { ...input.outcome, main: 'unrelated' } }));
  recordNextAction(state, input);
  assert.deepEqual(
    pendingCoordinationEvents(state, scope).map(({ task }) => task),
    ['still-working'],
  );
  assert.deepEqual(state.tickets[0], ticket);
});

test('a fenced legacy running ticket does not claim live capacity and a blocked final retains its own place', () => {
  const state = {
    paused: true,
    tickets: [
      { task: 'legacy', lane: 'development', status: 'running' },
      { task: 'own-final', lane: 'delivery', status: 'blocked' },
    ],
  };
  const { busyResources, finalHeld, retainedFinal } = coordinationOccupancy(state);
  assert.deepEqual([...busyResources], []);
  assert.equal(finalHeld, false);
  assert.deepEqual(retainedFinal, ['own-final']);
  const result = planNextActions(
    [action('other-final', 'final', 1), action('legacy', 'development', 2), action('own-final', 'final', 3)],
    { free: 3, finalHeld, retainedFinal, busyResources: [...busyResources] },
  );
  assert.deepEqual(
    result.selected.map(({ task }) => task),
    ['legacy', 'own-final'],
  );
  assert.equal(result.waiting[0].task, 'other-final');
});
