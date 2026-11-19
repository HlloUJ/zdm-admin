import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProgressOutbox } from '../task-progress-outbox.mjs';
import { captureDeliveryQueueProgress } from './task-delivery-queue-progress.mjs';
import {
  registerDynamicAuthority,
  reserveDynamicDecision,
  consumeDynamicDecision,
  finishDynamicPreparation,
  cancelDynamicDecision,
  assertDynamicAdmission,
  validateDynamicState,
  enrollDynamicDelivery,
} from './task-dynamic-model.mjs';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function progressFixture(t, f) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'delivery-queue-progress-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  f.state.events.unshift({ action: 'initialize', request: { ...f.request, sequence: 10 } });
  const box = createProgressOutbox(path.join(root, 'task-progress', 'a'));
  return {
    capture(previous) {
      f.state.revision++;
      const original = structuredClone(f.state);
      captureDeliveryQueueProgress(root, f.state, previous);
      assert.deepEqual(f.state, original);
      return box.read().pending.map(({ receipt }) => receipt);
    },
    pause() {
      const previous = structuredClone(f.state);
      f.state.events.push({ action: 'pause-all', request: { ...f.request, sequence: 21 } });
      return this.capture(previous);
    },
  };
}

function phaseFixture() {
  const f = fixture();
  for (const task of ['a', 'b']) {
    const development = f.state.tickets.find((item) => item.task === task);
    development.lane = 'development';
    development.status = 'completed';
    const evidence = { task, owner: development.owner, head: task.repeat(40), reports: [{ path: 'original-report' }] };
    development.completion = { evidence, digest: hash(evidence) };
    f.state.events.push({
      action: 'complete',
      lane: 'development',
      task,
      evidenceDigest: development.completion.digest,
    });
  }
  const phase = (task) => ({
    coordinatorThreadId: f.coordinator,
    authorityId: f.authorityId,
    phaseId: randomUUID(),
    task,
    owner: 'worker-' + task,
    executor: 'worker-' + task,
    developmentEvidenceDigest: f.state.tickets.find((item) => item.task === task && item.lane === 'development')
      .completion.digest,
    expectedQueueRevision: 10,
    expectedTaskRevision: 13,
    expectedCoordinationRevision: 1,
    expectedBoardRevision: 4,
  });
  const proof = (input) => {
    const development = f.state.tickets.find((item) => item.task === input.task && item.lane === 'development');
    return {
      ...f.proof(input),
      actor: f.coordinator,
      sourceProof: { head: development.completion.evidence.head, digest: 'original-completed-source' },
      development: {
        verified: true,
        ticketDigest: hash(development),
        evidenceDigest: development.completion.digest,
        head: development.completion.evidence.head,
      },
    };
  };
  return { ...f, phase, phaseProof: proof };
}
test('derived delivery enrollment and preparation finish project queued before a later explicit pause', (t) => {
  const f = phaseFixture();
  const progress = progressFixture(t, f);
  const beforeEnrollment = structuredClone(f.state);
  const phase = { ...f.phase('a'), expectedQueueRevision: f.state.revision };
  const ticket = enrollDynamicDelivery(f.state, phase, () => f.phaseProof(phase));
  assert.ok(ticket.request.sequence < 10);
  assert.deepEqual(
    progress.capture(beforeEnrollment).map(({ event }) => event),
    ['queued'],
  );

  const input = f.input('a');
  reserveDynamicDecision(f.state, input, () => f.proof(input));
  consumeDynamicDecision(f.state, { decisionId: input.decisionId, expectedQueueRevision: f.state.revision }, () =>
    f.proof(input),
  );
  const beforeFinish = structuredClone(f.state);
  finishDynamicPreparation(f.state, { decisionId: input.decisionId, expectedQueueRevision: f.state.revision }, () => ({
    actor: input.executor,
    verified: true,
    prepared: { head: 'a'.repeat(40), runId: '42' },
  }));
  assert.deepEqual(
    f.state.tickets.find((item) => item.lane === 'delivery' && item.task === 'a'),
    ticket,
  );
  assert.deepEqual(
    progress.capture(beforeFinish).map(({ event }) => event),
    ['queued', 'queued'],
  );
  const receipts = progress.pause();
  assert.deepEqual(
    receipts.map(({ event }) => event),
    ['queued', 'queued', 'paused'],
  );
  assert.equal(receipts.at(-1).next.label, '等待恢复指令');
});
test('one preserved delegation enrolls two completed developments without claiming final, then prepares independently', () => {
  const f = phaseFixture(),
    final = f.input('c', 'final');
  reserveDynamicDecision(f.state, final, () => f.proof(final));
  consumeDynamicDecision(f.state, { decisionId: final.decisionId, expectedQueueRevision: 10 }, () => f.proof(final));
  const scopes = structuredClone(f.state.scopedAdmissions);
  const originalDevelopment = structuredClone(f.state.tickets.filter((t) => t.lane === 'development'));
  const phases = ['a', 'b'].map(f.phase);
  for (const input of phases) {
    const ticket = enrollDynamicDelivery(f.state, input, () => f.phaseProof(input));
    assert.equal(ticket.status, 'queued');
    assert.equal(ticket.admission, null);
    const development = originalDevelopment.find((t) => t.task === input.task);
    assert.deepEqual(ticket.request, development.request);
    assert.equal(ticket.order, development.order);
    assert.deepEqual(f.state.scopedAdmissions, scopes);
    const bytes = JSON.stringify(f.state);
    assert.deepEqual(
      enrollDynamicDelivery(f.state, input, () => f.phaseProof(input)),
      ticket,
    );
    assert.equal(JSON.stringify(f.state), bytes);
  }
  assert.deepEqual(
    f.state.tickets.filter((t) => t.lane === 'development'),
    originalDevelopment,
  );
  for (const task of ['a', 'b']) {
    const input = f.input(task);
    reserveDynamicDecision(f.state, input, () => f.proof(input));
    consumeDynamicDecision(f.state, { decisionId: input.decisionId, expectedQueueRevision: 10 }, () => f.proof(input));
  }
  assert.equal(f.state.scopedAdmissions.filter((s) => s.phase === 'preparation').length, 2);
  assert.equal(f.state.scopedAdmissions.filter((s) => s.phase === 'final').length, 1);
  const prep = f.state.dynamicDecisions.find((d) => d.input.task === 'a');
  finishDynamicPreparation(f.state, { decisionId: prep.id, expectedQueueRevision: 10 }, () => ({
    actor: prep.input.executor,
    verified: true,
    prepared: { head: 'a'.repeat(40), runId: '42' },
  }));
  assert.equal(f.state.tickets.find((t) => t.task === 'a' && t.lane === 'delivery').status, 'queued');
  const compete = f.input('a', 'final');
  assert.throws(() => reserveDynamicDecision(f.state, compete, () => f.proof(compete)), /exclusive/);
  f.state.scopedAdmissions = f.state.scopedAdmissions.filter((s) => s.task !== 'c');
  f.state.tickets.find((t) => t.task === 'c').status = 'completed';
  reserveDynamicDecision(f.state, compete, () => f.proof(compete));
  consumeDynamicDecision(f.state, { decisionId: compete.decisionId, expectedQueueRevision: 10 }, () =>
    f.proof(compete),
  );
  assert.equal(f.state.scopedAdmissions.filter((s) => s.phase === 'final').length, 1);
  validateDynamicState(f.state);
  assert.deepEqual(
    f.state.tickets.filter((t) => t.lane === 'development'),
    originalDevelopment,
  );
  assert.ok(
    f.state.events
      .filter((e) => e.action === 'delivery-phase-enrolled')
      .every((e) => e.request.messageId === f.request.messageId),
  );
});
for (const scenario of [
  'incomplete',
  'missing-completion-event',
  'wrong-user',
  'stale-queue',
  'stale-task',
  'stale-board',
  'foreign-task',
  'old-coordinator',
  'wrong-executor',
  'active-worker',
  'dependencies',
  'unverified-reports',
  'changed-source',
  'changed-digest',
  'pause',
  'synthetic-user-event',
  'direct-admission',
])
  test('phase enrollment refuses ' + scenario + ' without changing original tickets or granting any scope', () => {
    const f = phaseFixture(),
      input = f.phase('a'),
      proof = f.phaseProof(input),
      development = f.state.tickets.find((t) => t.task === 'a');
    if (scenario === 'incomplete') development.status = 'blocked';
    if (scenario === 'missing-completion-event') f.state.events = f.state.events.filter((e) => e.task !== 'a');
    if (scenario === 'wrong-user') development.request.authorId = 'foreign';
    if (scenario === 'stale-queue') input.expectedQueueRevision--;
    if (scenario === 'stale-task') input.expectedTaskRevision--;
    if (scenario === 'stale-board') input.expectedBoardRevision--;
    if (scenario === 'foreign-task') input.task = 'outside';
    if (scenario === 'old-coordinator') proof.coordinator = 'old';
    if (scenario === 'wrong-executor') input.executor = 'foreign';
    if (scenario === 'active-worker') proof.workerIdle = false;
    if (scenario === 'dependencies') proof.dependenciesReady = false;
    if (scenario === 'unverified-reports') proof.development.verified = false;
    if (scenario === 'changed-source') proof.sourceProof.head = 'f'.repeat(40);
    if (scenario === 'changed-digest') input.developmentEvidenceDigest = '0'.repeat(64);
    if (scenario === 'pause') f.state.events.push({ action: 'pause-all', request: { ...f.request, sequence: 21 } });
    if (scenario === 'synthetic-user-event') input.request = { ...f.request, messageId: 'invented' };
    if (scenario === 'direct-admission') input.admission = randomUUID();
    const before = JSON.stringify(f.state);
    assert.throws(() => enrollDynamicDelivery(f.state, input, () => proof));
    assert.equal(JSON.stringify(f.state), before);
  });
test('phase IDs cannot overwrite another ticket or be repurposed, including after terminal completion', () => {
  const f = phaseFixture(),
    input = f.phase('a');
  enrollDynamicDelivery(f.state, input, () => f.phaseProof(input));
  assert.throws(() => enrollDynamicDelivery(f.state, { ...input, phaseId: randomUUID() }, () => f.phaseProof(input)));
  const second = f.phase('b');
  second.phaseId = input.phaseId;
  assert.throws(() => enrollDynamicDelivery(f.state, second, () => f.phaseProof(second)), /already used/);
  const current = f.state.tickets.find((t) => t.lane === 'delivery' && t.task === 'a');
  current.status = 'completed';
  const bytes = JSON.stringify(f.state);
  assert.equal(enrollDynamicDelivery(f.state, input, () => f.phaseProof(input)).status, 'completed');
  assert.equal(JSON.stringify(f.state), bytes);
});

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
test('completed preparation restores the original blocked ticket and projects its preserved reason', (t) => {
  const f = fixture();
  const progress = progressFixture(t, f);
  f.state.tickets[0].status = 'blocked';
  f.state.tickets[0].reason = 'preserved old blocker';
  const original = structuredClone(f.state.tickets[0]),
    input = f.input('a');
  reserveDynamicDecision(f.state, input, () => f.proof(input));
  consumeDynamicDecision(f.state, { decisionId: input.decisionId, expectedQueueRevision: 10 }, () => f.proof(input));
  const beforeFinish = structuredClone(f.state);
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
  const [receipt] = progress.capture(beforeFinish);
  assert.equal(receipt.event, 'blocked');
  assert.equal(receipt.reason, 'preserved old blocker');
  const receipts = progress.pause();
  assert.deepEqual(
    receipts.map(({ event }) => event),
    ['blocked', 'paused'],
  );
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
