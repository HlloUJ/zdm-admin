import { assertParkedContinuation } from '../task-capacity-release.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (value) => assert.match(value ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const scopes = (state) => [state.scopedAdmission, ...(state.scopedAdmissions ?? [])].filter(Boolean);
const latestPause = (state) =>
  Math.max(0, ...state.events.filter((e) => e.action === 'pause-all').map((e) => e.request.sequence));
const authority = (state, id) => {
  const value = state.dynamicAuthorities?.find((item) => item.id === id);
  assert.ok(value && value.request.sequence > latestPause(state), 'Standing delegation missing or revoked by pause');
  return value;
};
function currentAuthority(state, id, proof) {
  const grant = authority(state, id);
  assert.equal(proof.coordination.current.request.authorId, grant.request.authorId);
  assert.equal(proof.coordinator, proof.coordination.current.rootThreadId, 'Current coordinator required');
  return grant;
}
export function dynamicScopes(state) {
  return scopes(state).filter((scope) => scope.decisionId);
}
export function validateDynamicState(state) {
  const ids = new Set();
  for (const item of state.dynamicAuthorities ?? []) {
    uuid(item.id);
    assert.ok(!ids.has(item.id));
    ids.add(item.id);
    assert.equal(item.digest, hash(item.source));
    assert.deepEqual(item.source.request, item.request);
    assert.ok(
      item.request.messageId &&
        item.request.roomId &&
        item.request.authorId &&
        Number.isSafeInteger(item.request.sequence) &&
        item.request.sequence > 0,
    );
    assert.ok(Array.isArray(item.source.tasks) && item.source.tasks.length);
    assert.equal(new Set(item.source.tasks.map((task) => task.task)).size, item.source.tasks.length);
  }
  ids.clear();
  const reservations = new Set();
  for (const decision of state.dynamicDecisions ?? []) {
    uuid(decision.id);
    assert.ok(!ids.has(decision.id));
    ids.add(decision.id);
    assert.equal(decision.input.decisionId, decision.id);
    assert.equal(decision.inputDigest, hash(decision.input));
    assert.ok(['reserved', 'consumed', 'finished', 'cancelled'].includes(decision.status));
    assert.ok(state.dynamicAuthorities?.some((item) => item.id === decision.input.authorityId));
    assert.ok(['development', 'delivery'].includes(decision.input.lane));
    assert.ok(
      decision.input.lane === 'delivery'
        ? ['preparation', 'final'].includes(decision.input.phase)
        : decision.input.phase === 'development',
    );
    if (decision.status === 'consumed') assert.ok(decision.admission && decision.ticketBefore);
    if (decision.status === 'reserved') {
      const key = decision.input.lane + ':' + decision.input.task;
      assert.ok(!reservations.has(key), 'Duplicate reserved task');
      reservations.add(key);
    }
  }
  for (const scope of dynamicScopes(state)) {
    const decision = state.dynamicDecisions?.find((item) => item.id === scope.decisionId);
    assert.equal(decision?.status, 'consumed');
    assert.equal(scope.admission, decision.admission);
    for (const key of ['task', 'lane', 'owner', 'phase']) assert.equal(scope[key], decision.input[key]);
    assert.deepEqual(scope.request, authorityForHistory(state, decision).request);
  }
  for (const ticket of state.tickets.filter((item) => item.dynamicDecisionId)) {
    const decision = state.dynamicDecisions?.find((item) => item.id === ticket.dynamicDecisionId);
    assert.equal(decision?.status, 'consumed');
    assert.equal(ticket.admission, decision.admission);
    for (const key of ['task', 'lane', 'owner']) assert.equal(ticket[key], decision.input[key]);
  }
  const phases = new Set();
  for (const ticket of state.tickets.filter((item) => item.phaseOrigin)) {
    const origin = ticket.phaseOrigin;
    uuid(origin.phaseId);
    assert.equal(origin.inputDigest, hash(origin.input));
    assert.equal(origin.input.phaseId, origin.phaseId);
    assert.ok(!phases.has(origin.phaseId), 'Duplicate delivery phase identity');
    phases.add(origin.phaseId);
    assert.equal(ticket.lane, 'delivery');
    if (ticket.status === 'running')
      assert.ok(
        ticket.dynamicDecisionId &&
          scopes(state).some(
            (scope) =>
              scope.task === ticket.task && scope.lane === 'delivery' && scope.decisionId === ticket.dynamicDecisionId,
          ),
        'Derived delivery phase needs a verified dispatch admission',
      );
    const development = completedDevelopment(state, ticket.task, ticket.owner);
    assert.equal(origin.developmentTicketDigest, hash(development));
    assert.equal(origin.developmentEvidenceDigest, development.completion.digest);
    assert.deepEqual(ticket.request, development.request, 'Original development request must remain intact');
    const grant = state.dynamicAuthorities?.find((item) => item.id === origin.authorityId);
    assert.ok(grant?.source.tasks.some((item) => item.task === ticket.task && item.owner === ticket.owner));
    assert.equal(grant.request.authorId, ticket.request.authorId);
    assert.ok(
      state.events.some(
        (event) =>
          event.action === 'delivery-phase-enrolled' &&
          event.phaseId === origin.phaseId &&
          event.task === ticket.task &&
          event.owner === ticket.owner &&
          event.developmentEvidenceDigest === development.completion.digest &&
          event.order === development.order &&
          hash(event.request) === hash(grant.request) &&
          event.phaseDigest === hash(origin),
      ),
      'Derived preparation ticket lacks its exact phase event',
    );
  }
}
function authorityForHistory(state, decision) {
  return state.dynamicAuthorities.find((item) => item.id === decision.input.authorityId);
}
function completedDevelopment(state, task, owner) {
  const development = state.tickets.find((item) => item.task === task && item.lane === 'development');
  assert.equal(development?.status, 'completed', 'Original verified development must be completed');
  assert.equal(development.owner, owner);
  assert.equal(development.completion?.digest, hash(development.completion?.evidence));
  assert.ok(
    state.events.some(
      (event) =>
        event.action === 'complete' &&
        event.lane === 'development' &&
        event.task === task &&
        event.evidenceDigest === development.completion.digest,
    ),
    'Original development completion event required',
  );
  return development;
}

// A phase transition retains real original request/order. It is neither a new
// user event nor an admission, and cannot occupy preparation or final main.
export function enrollDynamicDelivery(state, input, verify) {
  assert.equal(state.paused, true);
  for (const field of ['request', 'sequence', 'admission', 'lane', 'phase'])
    assert.equal(input[field], undefined, 'Phase enrollment creates neither a user event nor an admission');
  uuid(input.phaseId);
  const proof = verify();
  const grant = currentAuthority(state, input.authorityId, proof);
  assert.equal(proof.actor, proof.coordinator, 'Actual current coordinator required');
  const existing = state.tickets.find((item) => item.task === input.task && item.lane === 'delivery');
  if (existing) {
    assert.equal(existing.phaseOrigin?.phaseId, input.phaseId, 'Existing delivery instruction cannot be adopted');
    assert.equal(existing.phaseOrigin.inputDigest, hash(input), 'Phase replay changed');
    return structuredClone(existing);
  }
  assert.ok(!state.tickets.some((item) => item.phaseOrigin?.phaseId === input.phaseId), 'Phase ID already used');
  assert.equal(state.revision, input.expectedQueueRevision, 'Queue revision changed');
  assert.equal(proof.task.id, input.task);
  assert.equal(proof.task.owner, input.owner);
  assert.equal(proof.executor, input.executor);
  assert.equal(proof.task.revision, input.expectedTaskRevision, 'Task revision changed');
  assert.notEqual(proof.task.stage, 'closed');
  assert.equal(proof.coordination.revision, input.expectedCoordinationRevision, 'Coordinator revision changed');
  assert.equal(proof.boardRevision, input.expectedBoardRevision, 'Board revision changed');
  assert.equal(proof.workerIdle, true);
  assert.equal(proof.dependenciesReady, true);
  assert.ok(
    grant.source.tasks.some((item) => item.task === input.task && item.owner === input.owner),
    'Task outside delegation',
  );
  const development = completedDevelopment(state, input.task, input.owner);
  assert.equal(development.request.authorId, grant.request.authorId, 'Original user differs');
  assert.equal(development.completion.digest, input.developmentEvidenceDigest, 'Development evidence changed');
  assert.equal(proof.development?.verified, true, 'Current original development reports required');
  assert.equal(proof.development.ticketDigest, hash(development));
  assert.equal(proof.development.evidenceDigest, development.completion.digest);
  assert.equal(proof.development.head, development.completion.evidence.head);
  assert.equal(proof.development.head, proof.sourceProof.head, 'Completed source changed');
  const ticket = {
    lane: 'delivery',
    task: input.task,
    owner: input.owner,
    request: structuredClone(development.request),
    order: development.order,
    status: 'queued',
    admission: null,
    phaseOrigin: {
      phaseId: input.phaseId,
      authorityId: grant.id,
      inputDigest: hash(input),
      input: structuredClone(input),
      developmentTicketDigest: hash(development),
      developmentEvidenceDigest: development.completion.digest,
      sourceProof: structuredClone(proof.sourceProof),
      bindingRevision: proof.bindingRevision,
      coordinator: proof.coordinator,
      coordinationRevision: proof.coordination.revision,
    },
  };
  state.tickets.push(ticket);
  state.events.push({
    action: 'delivery-phase-enrolled',
    phaseId: input.phaseId,
    authorityId: grant.id,
    task: input.task,
    owner: input.owner,
    order: development.order,
    phaseDigest: hash(ticket.phaseOrigin),
    developmentEvidenceDigest: development.completion.digest,
    request: structuredClone(grant.request),
  });
  return structuredClone(ticket);
}
export function registerDynamicAuthority(state, input, verify) {
  const proof = verify();
  assert.equal(proof.coordinator, proof.coordination.current.rootThreadId);
  assert.equal(input.request.authorId, proof.coordination.current.request.authorId);
  assert.equal(proof.message.id, input.request.messageId, 'Exact real user delegation message required');
  assert.equal(proof.message.type, 'userMessage');
  assert.equal(input.expectedCoordinationRevision, proof.coordination.revision);
  assert.ok(input.request.sequence > latestPause(state), 'Delegation predates pause');
  uuid(input.authorityId);
  assert.ok(
    Array.isArray(input.taskIds) && input.taskIds.length && new Set(input.taskIds).size === input.taskIds.length,
    'Exact delegated task list required',
  );
  assert.deepEqual([...input.taskIds].sort(), proof.taskScope.map((item) => item.task).sort());
  const source = {
    request: input.request,
    message: proof.message,
    tasks: proof.taskScope,
    scope: 'dependency-ready-development-and-delivery-preparation-with-exclusive-final-main-v1',
  };
  const prior = state.dynamicAuthorities?.find((item) => item.id === input.authorityId);
  if (prior) {
    assert.deepEqual(prior.source, source, 'Delegation replay changed');
    return structuredClone(prior);
  }
  assert.equal(state.revision, input.expectedQueueRevision, 'Queue revision changed');
  const record = {
    id: input.authorityId,
    request: input.request,
    source,
    digest: hash(source),
    registeredBy: proof.coordinator,
    coordinationRevision: proof.coordination.revision,
  };
  (state.dynamicAuthorities ??= []).push(record);
  state.events.push({ action: 'standing-delegation', authorityId: record.id, request: record.request });
  return structuredClone(record);
}
function target(state, input, proof) {
  assert.ok(['development', 'delivery'].includes(input.lane));
  assert.ok(
    input.lane === 'development' ? input.phase === 'development' : ['preparation', 'final'].includes(input.phase),
  );
  const ticket = state.tickets.find((item) => item.task === input.task && item.lane === input.lane);
  assert.ok(ticket && !ticket.awaitingNativeWorker, 'Original enrolled task ticket required');
  assert.ok(['queued', 'blocked', 'parked', 'running'].includes(ticket.status), 'Terminal task lane cannot resume');
  assert.notEqual(proof.task.stage, 'closed', 'Closed task cannot resume');
  assert.equal(proof.task.id, input.task);
  assert.equal(proof.task.owner, input.owner);
  assert.equal(ticket.owner, input.owner);
  assert.equal(proof.executor, input.executor);
  assert.equal(proof.task.revision, input.expectedTaskRevision, 'Task revision changed');
  assert.equal(proof.coordination.revision, input.expectedCoordinationRevision, 'Coordinator revision changed');
  assert.equal(proof.dependenciesReady, true, 'Formal delivered dependencies required');
  assert.equal(proof.boardRevision, input.expectedBoardRevision, 'Board revision changed');
  const grant = currentAuthority(state, input.authorityId, proof);
  assert.ok(
    grant.source.tasks.some((item) => item.task === input.task && item.owner === input.owner),
    'Task is outside the preserved user delegation',
  );
  assert.equal(ticket.request.authorId, grant.request.authorId, 'Original task user differs');
  assertParkedContinuation(state, ticket, { ...proof, authoritySequence: grant.request.sequence }, input.phase);
  return ticket;
}
function assertCapacity(state, input, proof, self = null) {
  const capacity = proof.capacity;
  for (const key of ['limit', 'activeDevelopment', 'activeDelivery', 'activeOther'])
    assert.ok(Number.isSafeInteger(capacity?.[key]) && capacity[key] >= 0, 'Actual capacity required');
  assert.ok(capacity.limit > 0 && capacity.activeDelivery <= 1);
  const preparation = capacity.activePreparation ?? 0;
  assert.ok(Number.isSafeInteger(preparation) && preparation >= 0);
  const active = scopes(state);
  assert.ok(
    capacity.activeDevelopment >= active.filter((s) => s.lane === 'development').length,
    'Capacity omits development',
  );
  assert.ok(preparation >= active.filter((s) => s.phase === 'preparation').length, 'Capacity omits preparation');
  assert.ok(
    capacity.activeDelivery >= active.filter((s) => s.lane === 'delivery' && s.phase !== 'preparation').length,
    'Capacity omits final delivery',
  );
  const reserved = (state.dynamicDecisions ?? []).filter((item) => item.status === 'reserved' && item.id !== self);
  const nativeReserved = state.tickets.filter(
    (ticket) =>
      ticket.status === 'queued' &&
      ticket.nativeLaunchReserved &&
      !(ticket.task === input.task && ticket.lane === input.lane),
  ).length;
  const existing = active.find((s) => s.task === input.task && s.lane === input.lane);
  const total = capacity.activeDevelopment + preparation + capacity.activeDelivery + capacity.activeOther;
  const final = input.phase === 'final';
  const finalHeld =
    active.some((s) => s.lane === 'delivery' && s.phase !== 'preparation' && s !== existing) ||
    reserved.some((item) => item.input.phase === 'final');
  if (final) assert.equal(finalHeld, false, 'Final main/shared runtime admission remains exclusive');
  const reserveFinal =
    capacity.activeDelivery || final || reserved.some((item) => item.input.phase === 'final') ? 0 : 1;
  assert.ok(
    total +
      nativeReserved +
      reserved.filter((item) => !active.some((s) => s.task === item.input.task && s.lane === item.input.lane)).length +
      (existing ? 0 : 1) +
      reserveFinal <=
      capacity.limit,
    'Reserve real capacity and final delivery executor',
  );
}
export function reserveDynamicDecision(state, input, verify) {
  assert.equal(state.paused, true, 'Dynamic scoped dispatch requires protected paused mode');
  uuid(input.decisionId);
  const proof = verify();
  currentAuthority(state, input.authorityId, proof);
  const prior = state.dynamicDecisions?.find((item) => item.id === input.decisionId);
  if (prior) {
    assert.deepEqual(prior.input, input, 'Decision replay changed');
    return structuredClone(prior);
  }
  assert.equal(state.revision, input.expectedQueueRevision, 'Queue revision changed');
  const ticket = target(state, input, proof);
  assert.equal(proof.workerIdle, true, 'Actual worker must be idle before dispatch');
  assert.ok(
    !(state.dynamicDecisions ?? []).some(
      (item) => item.status === 'reserved' && item.input.task === input.task && item.input.lane === input.lane,
    ),
    'Task already has a reserved decision',
  );
  const existing = scopes(state).find((s) => s.task === input.task && s.lane === input.lane);
  if (existing) assert.equal(proof.fencedScope, true, 'Running task cannot be redispatched');
  assertCapacity(state, input, proof);
  const record = {
    id: input.decisionId,
    input: structuredClone(input),
    inputDigest: hash(input),
    status: 'reserved',
    sourceProof: proof.sourceProof,
    readiness: proof.readiness,
    dependencies: proof.dependencies,
    bindingRevision: proof.bindingRevision,
    coordinator: proof.coordinator,
    capacity: proof.capacity,
    ticketDigest: hash(ticket),
    priorScope: existing ?? null,
  };
  (state.dynamicDecisions ??= []).push(record);
  state.events.push({
    action: 'dispatch-reserved',
    decisionId: record.id,
    authorityId: input.authorityId,
    request: authorityForHistory(state, record).request,
  });
  return structuredClone(record);
}
export function consumeDynamicDecision(state, input, verify) {
  const record = state.dynamicDecisions?.find((item) => item.id === input.decisionId);
  assert.ok(record, 'Unknown dispatch decision');
  const proof = verify(record);
  currentAuthority(state, record.input.authorityId, proof);
  assert.equal(proof.actor, record.input.executor, 'Actual bound worker runtime required');
  if (record.status !== 'reserved') return { ...structuredClone(record), replay: true, startAuthorized: false };
  assert.equal(state.revision, input.expectedQueueRevision, 'Queue revision changed before worker start');
  const ticket = target(state, record.input, proof);
  assert.equal(hash(ticket), record.ticketDigest, 'Original ticket changed before start');
  assert.deepEqual(proof.sourceProof, record.sourceProof, 'Task source/resources changed before start');
  assert.equal(proof.bindingRevision, record.bindingRevision, 'Execution binding changed');
  assert.deepEqual(proof.dependencies, record.dependencies, 'Evidence required by this action changed before start');
  assertCapacity(state, record.input, proof, record.id);
  record.ticketBefore = structuredClone(ticket);
  record.admission = randomUUID();
  record.status = 'consumed';
  ticket.status = 'running';
  ticket.admission = record.admission;
  ticket.dynamicDecisionId = record.id;
  delete ticket.reason;
  ticket.monitorContext = structuredClone(proof.task.executionBindings?.at(-1)?.monitoring ?? proof.task.monitoring);
  record.consumedCapacity = proof.capacity;
  record.consumedReadiness = proof.readiness;
  record.consumedDependencies = proof.dependencies;
  const kept = scopes(state).filter((s) => !(s.task === ticket.task && s.lane === ticket.lane));
  delete state.scopedAdmission;
  state.scopedAdmissions = [
    ...kept,
    {
      lane: ticket.lane,
      task: ticket.task,
      owner: ticket.owner,
      phase: record.input.phase,
      admission: record.admission,
      decisionId: record.id,
      request: authorityForHistory(state, record).request,
    },
  ];
  state.events.push({
    action: 'dispatch-applied',
    decisionId: record.id,
    task: ticket.task,
    lane: ticket.lane,
    phase: record.input.phase,
    owner: ticket.owner,
    admission: record.admission,
    request: authorityForHistory(state, record).request,
  });
  return { ...structuredClone(record), startAuthorized: true };
}
export function assertDynamicAdmission(state, scope, effect, task, coordination) {
  if (!scope?.decisionId) return;
  const record = state.dynamicDecisions.find((item) => item.id === scope.decisionId);
  assert.equal(record.status, 'consumed');
  assert.equal(record.admission, scope.admission);
  assert.equal(
    record.input.expectedCoordinationRevision,
    coordination?.revision,
    'Coordinator changed; dispatch fenced',
  );
  assert.equal(record.coordinator, coordination.current.rootThreadId, 'Old coordinator dispatch is fenced');
  assert.equal(task.owner, record.input.owner);
  assert.equal(record.input.executor, task.executionBindings?.at(-1)?.executor ?? task.owner);
  assert.equal(record.bindingRevision, task.executionBindings?.at(-1)?.revision ?? 0);
  authority(state, record.input.authorityId);
  if (scope.phase === 'preparation')
    assert.equal(effect, 'preparation', 'Preparation admission cannot mutate final main/shared runtime');
}
export function finishDynamicPreparation(state, input, verify) {
  const record = state.dynamicDecisions?.find((item) => item.id === input.decisionId);
  assert.ok(record && record.input.phase === 'preparation');
  const proof = verify(record);
  assert.equal(proof.actor, record.input.executor);
  assert.equal(proof.verified, true, 'Exact prepared candidate and original PR CI proof required');
  if (record.status === 'finished') {
    assert.deepEqual(record.prepared, proof.prepared);
    return structuredClone(record);
  }
  assert.equal(record.status, 'consumed');
  assert.equal(state.revision, input.expectedQueueRevision);
  const ticket = state.tickets.find((item) => item.task === record.input.task && item.lane === 'delivery');
  assert.equal(ticket.status, 'running', 'Blocked preparation needs a new explicit dispatch decision');
  assert.ok(
    scopes(state).some((scope) => scope.decisionId === record.id),
    'Preparation scope is fenced',
  );
  assert.equal(ticket.admission, record.admission);
  for (const key of Object.keys(ticket)) delete ticket[key];
  Object.assign(ticket, structuredClone(record.ticketBefore));
  const kept = scopes(state).filter((s) => s.decisionId !== record.id);
  delete state.scopedAdmission;
  state.scopedAdmissions = kept;
  record.status = 'finished';
  record.prepared = proof.prepared;
  state.events.push({
    action: 'preparation-finished',
    decisionId: record.id,
    task: ticket.task,
    request: authorityForHistory(state, record).request,
  });
  return structuredClone(record);
}
export function cancelDynamicDecision(state, input, verify) {
  const record = state.dynamicDecisions?.find((item) => item.id === input.decisionId);
  assert.ok(record, 'Unknown reserved decision');
  const proof = verify(record);
  currentAuthority(state, record.input.authorityId, proof);
  assert.equal(input.expectedCoordinationRevision, proof.coordination.revision);
  if (record.status === 'cancelled') return structuredClone(record);
  assert.equal(input.expectedTaskRevision, proof.task.revision);
  assert.equal(proof.workerIdle, true, 'Unknown worker/start outcome cannot release a reservation');
  assert.equal(record.status, 'reserved', 'Consumed decisions cannot be cancelled or replayed');
  assert.equal(state.revision, input.expectedQueueRevision);
  const ticket = state.tickets.find((item) => item.task === record.input.task && item.lane === record.input.lane);
  assert.equal(hash(ticket), record.ticketDigest, 'Ticket changed; preserve unknown start outcome');
  record.status = 'cancelled';
  record.cancelledBy = proof.coordinator;
  state.events.push({
    action: 'dispatch-cancelled',
    decisionId: record.id,
    request: authorityForHistory(state, record).request,
  });
  return structuredClone(record);
}
