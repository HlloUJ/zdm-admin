import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  registerDynamicAuthority,
  reserveDynamicDecision,
  consumeDynamicDecision,
  finishDynamicPreparation,
  cancelDynamicDecision,
  assertDynamicAdmission,
  validateDynamicState,
} from './task-dynamic-model.mjs';

function fixture() {
  const coordinator = '22222222-2222-4222-8222-222222222222';
  const request = { messageId: 'real-user-delegation', roomId: coordinator, authorId: 'same-user', sequence: 20 };
  const coordination = { revision: 1, current: { rootThreadId: coordinator, request } };
  const state = {
    version: 1,
    revision: 10,
    paused: true,
    tickets: ['a', 'b', 'c', 'd'].map((task, index) => ({
      task,
      owner: 'worker-' + task,
      lane: 'delivery',
      status: 'queued',
      admission: null,
      request: { ...request, messageId: 'original-' + task, sequence: index + 1 },
      order: index + 1,
    })),
    events: [],
  };
  const authorityId = randomUUID();
  registerDynamicAuthority(
    state,
    { authorityId, request, taskIds: ['a', 'b', 'c'], expectedQueueRevision: 10, expectedCoordinationRevision: 1 },
    () => ({
      coordinator,
      coordination,
      message: {
        id: request.messageId,
        type: 'userMessage',
        content: [{ type: 'text', text: 'Dynamically coordinate this task list' }],
      },
      taskScope: state.tickets.slice(0, 3).map((t) => ({ task: t.task, owner: t.owner })),
    }),
  );
  const input = (task, phase = 'preparation') => ({
    decisionId: randomUUID(),
    authorityId,
    task,
    owner: 'worker-' + task,
    executor: 'worker-' + task,
    lane: 'delivery',
    phase,
    expectedTaskRevision: 13,
    expectedQueueRevision: state.revision,
    expectedCoordinationRevision: 1,
    expectedBoardRevision: 4,
  });
  const proof = (plan, changes = {}) => ({
    coordinator,
    coordination,
    task: { id: plan.task, owner: plan.owner, revision: 13, stage: 'frozen', monitoring: {} },
    executor: plan.executor,
    actor: plan.executor,
    workerIdle: true,
    dependenciesReady: true,
    bindingRevision: 0,
    boardRevision: 4,
    sourceProof: { digest: 'unchanged-original-source' },
    capacity: {
      limit: 5,
      activeDevelopment: 0,
      activePreparation: (state.scopedAdmissions ?? []).filter((s) => s.phase === 'preparation').length,
      activeDelivery: (state.scopedAdmissions ?? []).filter((s) => s.phase === 'final').length,
      activeOther: 1,
    },
    ...changes,
  });
  return { coordinator, request, coordination, state, authorityId, input, proof };
}
test('one real delegation records distinct decisions; two preparations coexist and final main stays exclusive', () => {
  const f = fixture(),
    a = f.input('a'),
    b = f.input('b'),
    c = f.input('c', 'final');
  for (const input of [a, b]) {
    reserveDynamicDecision(f.state, input, () => f.proof(input));
    consumeDynamicDecision(f.state, { decisionId: input.decisionId, expectedQueueRevision: 10 }, () => f.proof(input));
  }
  assert.equal(f.state.scopedAdmissions.length, 2);
  for (const scope of f.state.scopedAdmissions) {
    assert.doesNotThrow(() =>
      assertDynamicAdmission(
        f.state,
        scope,
        'preparation',
        f.proof(a).task.owner === scope.owner ? f.proof(a).task : f.proof(b).task,
        f.coordination,
      ),
    );
    assert.throws(() => assertDynamicAdmission(f.state, scope, 'final', { owner: scope.owner }, f.coordination));
  }
  reserveDynamicDecision(f.state, c, () => f.proof(c));
  consumeDynamicDecision(f.state, { decisionId: c.decisionId, expectedQueueRevision: 10 }, () => f.proof(c));
  assert.equal(f.state.scopedAdmissions.filter((s) => s.phase === 'final').length, 1);
  f.state.tickets[0].status = 'blocked';
  f.state.scopedAdmissions = f.state.scopedAdmissions.filter((s) => s.task !== 'a');
  const competingFinal = f.input('a', 'final');
  assert.throws(() => reserveDynamicDecision(f.state, competingFinal, () => f.proof(competingFinal)), /exclusive/);
  validateDynamicState(f.state);
  assert.deepEqual(new Set(f.state.events.map((e) => e.request.messageId)), new Set([f.request.messageId]));
  assert.equal(new Set(f.state.dynamicDecisions.map((d) => d.id)).size, 3);
});
test('blocked consumed task resumes with a new decision, preserving original ticket and every failure', () => {
  const f = fixture(),
    original = structuredClone(f.state.tickets[0]);
  const first = f.input('a', 'final');
  reserveDynamicDecision(f.state, first, () => f.proof(first));
  consumeDynamicDecision(f.state, { decisionId: first.decisionId, expectedQueueRevision: 10 }, () => f.proof(first));
  f.state.tickets[0].status = 'blocked';
  f.state.tickets[0].reason = 'original exact failure';
  f.state.scopedAdmissions = [];
  const second = f.input('a', 'final');
  reserveDynamicDecision(f.state, second, () => f.proof(second));
  const resumed = consumeDynamicDecision(f.state, { decisionId: second.decisionId, expectedQueueRevision: 10 }, () =>
    f.proof(second),
  );
  assert.equal(resumed.ticketBefore.reason, 'original exact failure');
  assert.equal(f.state.tickets[0].owner, original.owner);
  assert.deepEqual(f.state.tickets[0].request, original.request);
  assert.notEqual(resumed.admission, f.state.dynamicDecisions[0].admission);
  const bytes = JSON.stringify(f.state);
  assert.equal(
    consumeDynamicDecision(f.state, { decisionId: first.decisionId }, () => f.proof(first)).startAuthorized,
    false,
  );
  assert.equal(JSON.stringify(f.state), bytes);
});
test('completed preparation restores the original blocked ticket without closing or losing its position', () => {
  const f = fixture();
  f.state.tickets[0].status = 'blocked';
  f.state.tickets[0].reason = 'preserved old blocker';
  const original = structuredClone(f.state.tickets[0]),
    input = f.input('a');
  reserveDynamicDecision(f.state, input, () => f.proof(input));
  consumeDynamicDecision(f.state, { decisionId: input.decisionId, expectedQueueRevision: 10 }, () => f.proof(input));
  const prepared = { head: 'a'.repeat(40), runId: '42', accepted: 'b'.repeat(40) };
  finishDynamicPreparation(f.state, { decisionId: input.decisionId, expectedQueueRevision: 10 }, () => ({
    actor: input.executor,
    verified: true,
    prepared,
  }));
  assert.deepEqual(f.state.tickets[0], original);
  assert.equal(f.state.scopedAdmissions.length, 0);
  const before = JSON.stringify(f.state);
  finishDynamicPreparation(f.state, { decisionId: input.decisionId }, () => ({
    actor: input.executor,
    verified: true,
    prepared,
  }));
  assert.equal(JSON.stringify(f.state), before);
  validateDynamicState(f.state);
});
test('capacity includes pending decisions, other preparations and native creation reservations', () => {
  const f = fixture(),
    a = f.input('a'),
    b = f.input('b'),
    c = f.input('c');
  reserveDynamicDecision(f.state, a, () => f.proof(a));
  reserveDynamicDecision(f.state, b, () => f.proof(b));
  assert.throws(
    () =>
      reserveDynamicDecision(f.state, c, () =>
        f.proof(c, { capacity: { limit: 4, activeDevelopment: 0, activeDelivery: 0, activeOther: 1 } }),
      ),
    /capacity/,
  );
  f.state.tickets.push({ lane: 'development', task: 'native-pending', status: 'queued', nativeLaunchReserved: true });
  assert.throws(() => reserveDynamicDecision(f.state, c, () => f.proof(c)), /capacity/);
});
for (const scenario of [
  'closed',
  'terminal',
  'dependency',
  'outside-scope',
  'stale-queue',
  'stale-task',
  'stale-board',
  'old-coordinator',
  'wrong-user',
  'active-worker',
])
  test('dispatch refuses ' + scenario + ' before mutating queue', () => {
    const f = fixture(),
      input = f.input(scenario === 'outside-scope' ? 'd' : 'a');
    const proof = f.proof(input);
    if (scenario === 'closed') proof.task.stage = 'closed';
    if (scenario === 'terminal') f.state.tickets[0].status = 'completed';
    if (scenario === 'dependency') proof.dependenciesReady = false;
    if (scenario === 'stale-queue') input.expectedQueueRevision--;
    if (scenario === 'stale-task') input.expectedTaskRevision--;
    if (scenario === 'stale-board') input.expectedBoardRevision--;
    if (scenario === 'old-coordinator')
      proof.coordination = { revision: 2, current: { ...f.coordination.current, rootThreadId: 'new-root' } };
    if (scenario === 'wrong-user') f.state.tickets[0].request.authorId = 'another-user';
    if (scenario === 'active-worker') proof.workerIdle = false;
    const before = JSON.stringify(f.state);
    assert.throws(() => reserveDynamicDecision(f.state, input, () => proof));
    assert.equal(JSON.stringify(f.state), before);
  });
for (const scenario of ['worker', 'source', 'binding', 'task', 'capacity'])
  test('worker start independently rechecks ' + scenario, () => {
    const f = fixture(),
      input = f.input('a');
    reserveDynamicDecision(f.state, input, () => f.proof(input));
    const proof = f.proof(input);
    if (scenario === 'worker') proof.actor = 'external';
    if (scenario === 'source') proof.sourceProof = { digest: 'changed' };
    if (scenario === 'binding') proof.bindingRevision++;
    if (scenario === 'task') proof.task.revision++;
    if (scenario === 'capacity') proof.capacity = { limit: 2, activeDevelopment: 0, activeDelivery: 0, activeOther: 1 };
    const before = JSON.stringify(f.state);
    assert.throws(() =>
      consumeDynamicDecision(f.state, { decisionId: input.decisionId, expectedQueueRevision: 10 }, () => proof),
    );
    assert.equal(JSON.stringify(f.state), before);
  });
test('one decision ID cannot be repurposed; a changed pending decision can only be explicitly cancelled', () => {
  const f = fixture(),
    input = f.input('a');
  reserveDynamicDecision(f.state, input, () => f.proof(input));
  assert.throws(() => reserveDynamicDecision(f.state, { ...input, task: 'b' }, () => f.proof(input)), /replay changed/);
  const cancel = {
    decisionId: input.decisionId,
    expectedQueueRevision: 10,
    expectedTaskRevision: 13,
    expectedCoordinationRevision: 1,
  };
  assert.throws(
    () => cancelDynamicDecision(f.state, cancel, () => f.proof(input, { workerIdle: false })),
    /Unknown worker/,
  );
  cancelDynamicDecision(f.state, cancel, () => f.proof(input));
  assert.equal(f.state.dynamicDecisions[0].status, 'cancelled');
  assert.equal(
    consumeDynamicDecision(f.state, { decisionId: input.decisionId }, () => f.proof(input)).startAuthorized,
    false,
  );
});
test('later pause revokes delegation, and a changed coordinator fences already consumed scopes', () => {
  const f = fixture(),
    input = f.input('a');
  reserveDynamicDecision(f.state, input, () => f.proof(input));
  consumeDynamicDecision(f.state, { decisionId: input.decisionId, expectedQueueRevision: 10 }, () => f.proof(input));
  const scope = f.state.scopedAdmissions[0];
  assert.throws(
    () =>
      assertDynamicAdmission(f.state, scope, 'preparation', f.proof(input).task, { ...f.coordination, revision: 2 }),
    /Coordinator changed/,
  );
  f.state.events.push({ action: 'pause-all', request: { ...f.request, messageId: 'real-pause', sequence: 30 } });
  assert.throws(
    () => assertDynamicAdmission(f.state, scope, 'preparation', f.proof(input).task, f.coordination),
    /revoked/,
  );
});
