import { requireNativeIntake, createTaskThreadTitles } from './task-thread-titles.mjs';
import { hasScopedAdmission, scopedAdmissions } from './task-execution-scope.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withTaskRegistryWriteLock } from './task-registry.mjs';
import { captureQueueProgress } from './task-delivery-status-sync.mjs';
import { executionBinding, assertTaskExecutor } from './task-execution-binding.mjs';

export const EXECUTION_LANES = ['development', 'delivery'];
const occupied = new Set(['running', 'blocked']);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const id = (v) => typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const laneLimit = (state, lane) => (state.limits?.[lane] === null ? Infinity : (state.limits?.[lane] ?? state.limit));
const retainedLimit = (state, lane) => (state.limits?.[lane] === null ? Infinity : state.limit);
const engineeringKind = (kind) => ['infrastructure', 'maintenance'].includes(kind);
const lastPauseSequence = (state) =>
  Math.max(0, ...state.events.filter((e) => e.action === 'pause-all').map((e) => e.request.sequence));
function recoveryAuthorization(state, development) {
  const a = development.recoveryAuthorization;
  assert.ok(a && engineeringKind(a.kind), 'Explicit engineering lifecycle authorization required');
  event(a.request);
  assert.equal(development.executionKind, a.kind, 'Engineering kind changed');
  assert.ok(
    state.events.some(
      (e) =>
        e.action === 'resume-selected' &&
        JSON.stringify(e.request) === JSON.stringify(a.request) &&
        e.members?.some(
          (m) =>
            m.task === development.task &&
            m.owner === development.owner &&
            m.lane === 'development' &&
            m.kind === a.kind &&
            m.admission === a.developmentAdmission,
        ),
    ),
    'Recovery authorization has no exact selected instruction',
  );
  return a;
}
function event(value) {
  assert.ok(
    value && text(value.messageId) && text(value.roomId) && text(value.authorId),
    'Exact user event provenance required',
  );
  assert.ok(Number.isSafeInteger(value.sequence) && value.sequence > 0, 'Explicit user receipt sequence required');
  return structuredClone(value);
}
function validate(state) {
  assert.equal(state.version, 1);
  assert.equal(typeof state.paused, 'boolean');
  assert.equal(state.limit, 3);
  assert.ok(Number.isSafeInteger(state.revision) && Array.isArray(state.tickets) && Array.isArray(state.events));
  if (state.dependenciesFirst !== undefined) assert.equal(typeof state.dependenciesFirst, 'boolean');
  if (state.limits) {
    assert.deepEqual(Object.keys(state.limits).sort(), [...EXECUTION_LANES].sort());
    for (const lane of EXECUTION_LANES)
      assert.ok(
        (lane === 'development' && state.limits[lane] === null) ||
          (Number.isSafeInteger(state.limits[lane]) && state.limits[lane] >= 1 && state.limits[lane] <= 3),
      );
  }
  const keys = new Set();
  for (const ticket of state.tickets) {
    assert.ok(EXECUTION_LANES.includes(ticket.lane) && id(ticket.task) && text(ticket.owner));
    assert.ok(['queued', 'running', 'blocked', 'completed', 'cancelled'].includes(ticket.status));
    event(ticket.request);
    assert.ok(Number.isSafeInteger(ticket.order) && ticket.order > 0, 'Exact effective queue order required');
    const key = `${ticket.lane}:${ticket.task}`;
    assert.ok(!keys.has(key), 'Duplicate task lane');
    keys.add(key);
    if (ticket.awaitingNativeWorker !== undefined) {
      assert.equal(ticket.awaitingNativeWorker, true);
      assert.equal(ticket.lane, 'development');
      assert.equal(ticket.status, 'queued');
      assert.equal(ticket.admission, null);
      assert.equal(ticket.nativeCoordinatorOwner, undefined);
    }
    if (ticket.nativeLaunchReserved !== undefined) assert.equal(ticket.nativeLaunchReserved, true);
    if (ticket.nativeCoordinatorOwner !== undefined) {
      assert.equal(ticket.lane, 'development');
      assert.notEqual(ticket.nativeCoordinatorOwner, ticket.owner);
      assert.ok(
        state.events.some(
          (e) =>
            e.action === 'bind-native-worker' &&
            e.task === ticket.task &&
            e.coordinatorOwner === ticket.nativeCoordinatorOwner &&
            e.workerOwner === ticket.owner,
        ),
        'Native binding event missing',
      );
    }
    if (ticket.recoveryAuthorization) recoveryAuthorization(state, ticket);
    if (ticket.derivedAuthorization) {
      assert.equal(ticket.lane, 'delivery');
      const development = state.tickets.find(
        (t) => t.lane === 'development' && t.task === ticket.task && t.owner === ticket.owner,
      );
      assert.equal(development?.status, 'completed', 'Derived delivery lacks completed development');
      const authorization = recoveryAuthorization(state, development);
      assert.deepEqual(ticket.derivedAuthorization, {
        ...authorization,
        developmentEvidenceDigest: development.completion.digest,
      });
      assert.ok(
        state.events.some(
          (e) =>
            e.action === 'promote-delivery' &&
            e.task === ticket.task &&
            e.owner === ticket.owner &&
            e.admission === ticket.deliveryOriginAdmission &&
            e.developmentEvidenceDigest === development.completion.digest,
        ),
        'Derived delivery lacks its exact phase transition',
      );
      assert.ok(
        ticket.admission === ticket.deliveryOriginAdmission ||
          state.events.some(
            (e) =>
              ['resume-only', 'resume-task'].includes(e.action) &&
              e.lane === 'delivery' &&
              e.task === ticket.task &&
              e.owner === ticket.owner &&
              e.admission === ticket.admission,
          ),
        'Derived admission changed without an explicit resume',
      );
    }
  }
  for (const lane of EXECUTION_LANES)
    assert.ok(
      state.tickets.filter((t) => t.lane === lane && occupied.has(t.status)).length <=
        (state.paused ? retainedLimit(state, lane) : laneLimit(state, lane)),
      'Capacity invariant violated',
    );
  const scopes = scopedAdmissions(state);
  if (state.scopedAdmissions !== undefined) assert.ok(Array.isArray(state.scopedAdmissions));
  const scopedKeys = new Set();
  for (const scoped of scopes) {
    assert.equal(state.paused, true, 'Scoped admission requires the global pause');
    const key = scoped.lane + ':' + scoped.task;
    assert.ok(!scopedKeys.has(key), 'Duplicate scoped task');
    scopedKeys.add(key);
    const current = state.tickets.find((t) => t.lane === scoped.lane && t.task === scoped.task);
    assert.ok(current && current.status === 'running' && current.owner === scoped.owner);
    assert.ok(text(scoped.admission) && current.admission === scoped.admission);
    event(scoped.request);
    assert.ok(
      state.events.some(
        (e) =>
          JSON.stringify(e.request) === JSON.stringify(scoped.request) &&
          ((e.action === 'resume-only' &&
            e.lane === scoped.lane &&
            e.task === scoped.task &&
            e.owner === scoped.owner &&
            e.admission === scoped.admission) ||
            (e.action === 'promote-delivery' &&
              scoped.lane === 'delivery' &&
              e.task === scoped.task &&
              e.owner === scoped.owner &&
              e.admission === scoped.admission) ||
            (e.action === 'resume-selected' &&
              e.members?.some(
                (m) =>
                  m.lane === scoped.lane &&
                  m.task === scoped.task &&
                  m.owner === scoped.owner &&
                  m.admission === scoped.admission,
              ))),
      ),
      'Scoped admission lacks its exact user direction',
    );
  }
  assert.ok(scopes.filter((s) => s.lane === 'delivery').length <= 1, 'Delivery must remain serial');
  return state;
}
const scopedFor = hasScopedAdmission;
function removeScope(state, current) {
  if (state.scopedAdmission?.lane === current.lane && state.scopedAdmission?.task === current.task)
    delete state.scopedAdmission;
  if (state.scopedAdmissions) {
    state.scopedAdmissions = state.scopedAdmissions.filter(
      (s) => !(s.lane === current.lane && s.task === current.task),
    );
    if (!state.scopedAdmissions.length) delete state.scopedAdmissions;
  }
}
function safe(file) {
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked execution-order state refused');
    if (path.dirname(cursor) === cursor) break;
  }
}
export function createExecutionOrder(commonDir) {
  const directory = path.join(commonDir, 'task-registry', 'execution-order');
  const file = path.join(directory, 'state.json');
  function read() {
    safe(file);
    if (!existsSync(file)) {
      assert.ok(!existsSync(directory), 'Incomplete execution-order initialization; preserve state');
      return null; // Not activated. No migration or automatic adoption of existing work.
    }
    assert.ok(lstatSync(file).isFile());
    return validate(JSON.parse(readFileSync(file, 'utf8')));
  }
  function write(state) {
    validate(state);
    const previous = existsSync(file) ? read() : null;
    const temporary = path.join(directory, randomUUID() + '.json');
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
    try {
      captureQueueProgress(commonDir, state, previous);
    } catch (error) {
      console.error('Progress capture failed; original queue retained: ' + error.message);
    }
  }
  function initialize(request) {
    const source = event(request);
    safe(directory);
    assert.ok(!existsSync(directory), 'Already initialized or interrupted; do not replace');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return withTaskRegistryWriteLock(directory, () => {
      assert.ok(!existsSync(file), 'Initialization already published; do not replace');
      const state = {
        version: 1,
        revision: 1,
        limit: 3,
        paused: true,
        tickets: [],
        events: [{ action: 'initialize', request: source }],
      };
      write(state);
      return state;
    });
  }
  function update(action) {
    assert.ok(read(), 'Execution-order policy not activated');
    return withTaskRegistryWriteLock(directory, () => {
      const state = read();
      const before = JSON.stringify(state);
      const result = action(state);
      if (JSON.stringify(state) !== before) {
        state.revision++;
        write(state);
      }
      return result?.tickets && result.version === state.version ? structuredClone(state) : result;
    });
  }
  function ticket(state, lane, task, owner) {
    const found = state.tickets.find((t) => t.lane === lane && t.task === task);
    assert.ok(found, 'Task has no explicit execution instruction in this lane');
    assert.equal(found.owner, owner, 'Original execution owner required');
    const registeredFile = path.join(commonDir, 'task-registry/tasks', task + '.json');
    safe(registeredFile);
    if (existsSync(registeredFile)) {
      const registered = JSON.parse(readFileSync(registeredFile, 'utf8'));
      if (executionBinding(registered)) assertTaskExecutor(registered);
    }
    return found;
  }
  function assertDirectionAuthority(current, source) {
    const registryFile = path.join(commonDir, 'task-registry/tasks', current.task + '.json');
    safe(registryFile);
    const binding = existsSync(registryFile) ? executionBinding(JSON.parse(readFileSync(registryFile, 'utf8'))) : null;
    if (binding) {
      assert.equal(source.roomId, binding.request.roomId, 'Bound authorization room required');
      assert.equal(source.authorId, binding.request.authorId, 'Bound authorization user required');
      assert.ok(source.sequence >= binding.request.sequence, 'Direction predates current binding');
    } else {
      assert.equal(source.roomId, current.request.roomId, 'Original user conversation required');
      assert.equal(source.authorId, current.request.authorId, 'Original user required');
    }
  }
  function enqueue({ lane, task, owner, request, awaitingNativeWorker = false }) {
    assert.ok(EXECUTION_LANES.includes(lane) && id(task) && text(owner));
    const source = event(request);
    if (awaitingNativeWorker) {
      assert.equal(lane, 'development');
      requireNativeIntake(commonDir, { taskId: task, rootThreadId: owner, request });
    }
    return update((state) => {
      const old = state.tickets.find((t) => t.lane === lane && t.task === task);
      if (old) {
        assert.equal(old.owner, owner);
        assert.equal(old.awaitingNativeWorker === true, awaitingNativeWorker);
        assert.deepEqual(old.request, source, 'Task already has a different immutable instruction');
        return structuredClone(old);
      }
      assert.ok(
        !state.tickets.some((t) => t.lane === lane && t.request.sequence === source.sequence),
        'Receipt order collision',
      );
      assert.ok(
        !state.tickets.some((t) => t.lane === lane && t.request.messageId === source.messageId),
        'Message already registered in this lane',
      );
      assert.ok(
        state.tickets.filter((t) => t.lane === lane).every((t) => t.request.sequence < source.sequence),
        'Late event cannot reorder registered instructions',
      );
      const added = {
        lane,
        task,
        owner,
        request: source,
        order: source.sequence,
        status: 'queued',
        admission: null,
        ...(awaitingNativeWorker ? { awaitingNativeWorker: true } : {}),
      };
      state.tickets.push(added);
      return structuredClone(added);
    });
  }
  function reserveNativeCreation({ task, owner, request, capacity }) {
    requireNativeIntake(commonDir, { taskId: task, rootThreadId: owner, request });
    assert.ok(capacity && Number.isSafeInteger(capacity.limit) && capacity.limit > 0);
    for (const key of ['activeDevelopment', 'activeDelivery', 'activeOther'])
      assert.ok(Number.isSafeInteger(capacity[key]) && capacity[key] >= 0);
    assert.ok(
      capacity.activeDelivery <= 1 &&
        capacity.activeDevelopment + capacity.activeDelivery + capacity.activeOther <= capacity.limit,
    );
    return update((state) => {
      const current = state.tickets.find((t) => t.lane === 'development' && t.task === task);
      assert.ok(current?.status === 'queued' && current.admission === null);
      assert.deepEqual(current.request, request);
      assert.ok(current.owner === owner || current.nativeCoordinatorOwner === owner);
      if (current.nativeLaunchReserved) return structuredClone(current);
      assert.equal(current.awaitingNativeWorker, true);
      const reservations = state.tickets.filter((t) => t.status === 'queued' && t.nativeLaunchReserved).length;
      assert.ok(
        capacity.activeDevelopment + reservations + 1 <= capacity.limit - capacity.activeOther - 1,
        'Reserve one executor for delivery, including outstanding native launches',
      );
      const active = state.paused
        ? scopedAdmissions(state).filter((t) => t.lane === 'development').length
        : state.tickets.filter((t) => t.lane === 'development' && occupied.has(t.status)).length;
      assert.ok(active + reservations < laneLimit(state, 'development'), 'Development lane capacity exceeded');
      current.nativeLaunchReserved = true;
      return structuredClone(current);
    });
  }
  function bindNativeWorker({ task, coordinatorOwner, workerOwner, request, context }) {
    requireNativeIntake(commonDir, { taskId: task, rootThreadId: coordinatorOwner, request });
    createTaskThreadTitles(commonDir).requireBinding(context, task, workerOwner);
    assert.notEqual(coordinatorOwner, workerOwner);
    return update((state) => {
      const current = state.tickets.find((t) => t.lane === 'development' && t.task === task);
      assert.ok(current, 'Original pending-native ticket required');
      assert.deepEqual(current.request, request);
      if (current.nativeCoordinatorOwner !== undefined) {
        assert.equal(current.nativeCoordinatorOwner, coordinatorOwner);
        assert.equal(current.owner, workerOwner);
        return structuredClone(current);
      }
      assert.equal(current.owner, coordinatorOwner);
      assert.equal(current.awaitingNativeWorker, true, 'Legacy/started owners cannot transfer');
      assert.equal(current.status, 'queued');
      assert.equal(current.admission, null);
      assert.equal(
        existsSync(path.join(commonDir, 'task-registry', 'tasks', task + '.json')),
        false,
        'Registered tasks cannot transfer owners',
      );
      current.nativeCoordinatorOwner = coordinatorOwner;
      current.owner = workerOwner;
      delete current.awaitingNativeWorker;
      state.events.push({ action: 'bind-native-worker', task, coordinatorOwner, workerOwner });
      return structuredClone(current);
    });
  }
  function claim({ lane, task, owner, monitorContext }, dependenciesReady) {
    return update((state) => {
      const current = ticket(state, lane, task, owner);
      assert.notEqual(current.awaitingNativeWorker, true, 'Native worker identity not bound');
      if (current.nativeCoordinatorOwner) createTaskThreadTitles(commonDir).requireBinding(monitorContext, task, owner);
      assert.ok(!state.paused || scopedFor(state, current), 'All execution launches paused');
      if (current.status === 'running') {
        if (monitorContext !== undefined)
          assert.deepEqual(monitorContext, current.monitorContext, 'Claim monitoring context differs');
        return structuredClone(current); // no new spawn is authorized by repeat claim
      }
      assert.equal(current.status, 'queued', 'Blocked/completed task cannot auto-resume');
      if (lane === 'delivery' && state.dependenciesFirst) {
        assert.equal(typeof dependenciesReady, 'function', 'Trusted dependency reader required');
        assert.equal(dependenciesReady(structuredClone(current)), true, 'Task dependencies are not delivered');
      }
      assert.ok(
        state.tickets.filter(
          (t) =>
            t.lane === lane &&
            (occupied.has(t.status) || (t !== current && t.status === 'queued' && t.nativeLaunchReserved)),
        ).length < laneLimit(state, lane),
        'All lane slots occupied',
      );
      const next = state.tickets
        .filter((t) => t.lane === lane && t.status === 'queued')
        .filter(
          (t) => lane !== 'delivery' || !state.dependenciesFirst || dependenciesReady(structuredClone(t)) === true,
        )
        .sort((a, b) => a.order - b.order)[0];
      assert.equal(next.task, task, 'Only the FIFO head may claim');
      if (monitorContext !== undefined) current.monitorContext = structuredClone(monitorContext);
      current.status = 'running';
      current.admission = randomUUID();
      state.events.push({ action: 'claim', lane, task, admission: current.admission });
      return structuredClone(current);
    });
  }
  function assertAdmission({ lane, task, owner, admission }) {
    const state = read();
    if (!state) return { active: false };
    const current = ticket(state, lane, task, owner);
    assert.ok(!state.paused || scopedFor(state, current), 'All execution launches paused');
    assert.equal(current.status, 'running', 'Task is not admitted; no automatic resume');
    assert.ok(text(admission) && admission === current.admission, 'Exact current admission required');
    return { active: true, ticket: structuredClone(current) };
  }
  function block({ lane, task, owner, reason }) {
    assert.ok(text(reason), 'Known blocker or explicit unknown required');
    return update((state) => {
      const current = ticket(state, lane, task, owner);
      assert.ok(occupied.has(current.status), 'Only an occupied slot can block');
      current.status = 'blocked';
      if (scopedFor(state, current)) removeScope(state, current);
      current.reason = reason;
      state.events.push({ action: 'block', lane, task, reason });
      return structuredClone(current);
    });
  }
  function direct({
    action,
    request,
    lane,
    task,
    owner,
    tasks,
    limits,
    dependenciesFirst,
    monitorContext,
    members,
    capacity,
    bindingRef,
    expectedRevision,
  }) {
    const source = event(request);
    assert.ok(
      ['pause-all', 'resume-all', 'resume-task', 'resume-only', 'resume-selected', 'set-limits', 'reorder'].includes(
        action,
      ),
      'Only explicit supported user directions',
    );
    return update((state) => {
      if (expectedRevision !== undefined) assert.equal(state.revision, expectedRevision, 'Queue revision changed');
      if (bindingRef !== undefined) {
        assert.ok(['resume-only', 'resume-selected'].includes(action), 'Binding cannot authorize global changes');
        const file = path.join(commonDir, 'task-registry/tasks', bindingRef.task + '.json');
        safe(file);
        const registered = JSON.parse(readFileSync(file, 'utf8')),
          binding = executionBinding(registered);
        assertTaskExecutor(registered);
        assert.equal(binding?.revision, bindingRef.revision);
        assert.deepEqual(binding.request, source);
        assert.ok(source.sequence > lastPauseSequence(state), 'A later pause revoked this direction');
        if (action === 'resume-only') assert.equal(task, registered.id);
        else assert.ok(members?.length === 1 && members[0].task === registered.id, 'One exact bound task required');
      }
      const sameSource = state.events.filter(
        (e) => e.request?.messageId === source.messageId && JSON.stringify(e.bindingRef) === JSON.stringify(bindingRef),
      );
      const continuation =
        action === 'resume-only' &&
        sameSource.length === 1 &&
        sameSource[0].action === 'pause-all' &&
        JSON.stringify(sameSource[0].request) === JSON.stringify(source);
      const prior = sameSource.find((e) => e.action === action) ?? (continuation ? null : sameSource[0]);
      const command = {
        action,
        request: source,
        ...(bindingRef ? { bindingRef } : {}),
        ...(['resume-task', 'resume-only'].includes(action) ? { lane, task, owner } : {}),
        ...(action === 'resume-only' && monitorContext !== undefined ? { monitorContext } : {}),
        ...(action === 'reorder' ? { lane, tasks } : {}),
        ...(action === 'resume-selected'
          ? {
              members: members?.map((member) => {
                const result = { ...member };
                delete result.admission;
                return result;
              }),
              capacity,
            }
          : {}),
        ...(action === 'set-limits' ? { limits } : {}),
        ...(action === 'set-limits' && dependenciesFirst !== undefined ? { dependenciesFirst } : {}),
      };
      if (prior) {
        const direction = { ...prior };
        delete direction.admission;
        if (direction.members)
          direction.members = direction.members.map((member) => {
            const result = { ...member };
            delete result.admission;
            return result;
          });
        assert.deepEqual(direction, command, 'User event already used for a different action');
        return structuredClone(state);
      }
      assert.ok(
        state.events
          .filter((e) => e.request)
          .every(
            (e) =>
              e.request.sequence < source.sequence ||
              (continuation && e === sameSource[0]) ||
              // Exact current binding was independently checked above, including
              // actor, request and the latest pause. Unrelated later task events
              // do not revoke this task's persistent takeover authorization.
              bindingRef !== undefined,
          ),
        'Stale user direction refused',
      );
      if (action === 'pause-all' || action === 'resume-all') {
        state.paused = action === 'pause-all';
        delete state.scopedAdmissions;
        delete state.scopedAdmission; // A new pause revokes the exception; resume-all is explicit.
      }
      if (action === 'set-limits') {
        assert.ok(limits && typeof limits === 'object' && !Array.isArray(limits), 'Exact lane limits required');
        assert.deepEqual(Object.keys(limits).sort(), [...EXECUTION_LANES].sort());
        for (const lane of EXECUTION_LANES)
          assert.ok(
            (lane === 'development' && limits[lane] === null) ||
              (Number.isSafeInteger(limits[lane]) && limits[lane] >= 1 && limits[lane] <= 3),
            'Development may be explicitly unbounded; numeric lane limits must be 1 to 3',
          );
        state.limits = structuredClone(limits); // No release, claim, resume or reorder.
        if (dependenciesFirst !== undefined) {
          assert.equal(typeof dependenciesFirst, 'boolean');
          state.dependenciesFirst = dependenciesFirst;
        }
      }
      if (action === 'resume-selected') {
        assert.equal(state.paused, true, 'Use ordinary FIFO when not globally paused');
        assert.ok(Array.isArray(members) && members.length > 0, 'Exact selected development tasks required');
        assert.equal(
          new Set(members.map((m) => m.lane + ':' + m.task)).size,
          members.length,
          'Duplicate selected task',
        );
        assert.ok(
          capacity && Number.isSafeInteger(capacity.limit) && capacity.limit > 0,
          'Actual executor capacity required',
        );
        for (const key of ['activeDevelopment', 'activeDelivery', 'activeOther'])
          assert.ok(Number.isSafeInteger(capacity[key]) && capacity[key] >= 0);
        assert.ok(capacity.activeDelivery <= 1, 'Delivery must remain serial');
        assert.ok(
          capacity.activeDevelopment + capacity.activeDelivery + capacity.activeOther <= capacity.limit,
          'Invalid capacity snapshot',
        );
        const existingScopes = [
          ...(state.scopedAdmission ? [state.scopedAdmission] : []),
          ...(state.scopedAdmissions ?? []),
        ];
        assert.ok(
          capacity.activeDevelopment >= existingScopes.filter((s) => s.lane === 'development').length,
          'Capacity omits current development',
        );
        assert.ok(
          capacity.activeDelivery >= existingScopes.filter((s) => s.lane === 'delivery').length,
          'Capacity omits current delivery',
        );
        const targets = members.map((m) => {
          assert.equal(
            m.lane,
            'development',
            'Selected restore only admits development; final delivery remains serial',
          );
          const current = ticket(state, m.lane, m.task, m.owner);
          assert.notEqual(current.awaitingNativeWorker, true, 'Native worker identity not bound');
          if (m.kind !== undefined) {
            assert.ok(['business', 'infrastructure', 'maintenance'].includes(m.kind), 'Unknown task kind');
            if (current.executionKind !== undefined)
              assert.equal(current.executionKind, m.kind, 'Task kind cannot be retagged');
          }
          assert.ok(['queued', 'running', 'blocked'].includes(current.status), 'Terminal task cannot resume');
          assertDirectionAuthority(current, source);
          assert.ok(current.request.sequence <= source.sequence, 'Stale selected direction refused');
          return { current, m };
        });
        const additions = targets.filter(({ current }) => !scopedFor(state, current));
        assert.ok(
          capacity.activeDevelopment + additions.length <= capacity.limit - capacity.activeOther - 1,
          'Reserve one executor slot for delivery',
        );
        assert.ok(
          existingScopes.filter((s) => s.lane === 'development').length + additions.length <=
            laneLimit(state, 'development'),
          'Development lane capacity exceeded',
        );
        state.scopedAdmissions ??= [];
        command.members = [];
        for (const { current, m } of targets) {
          if (!scopedFor(state, current)) {
            current.status = 'running';
            current.admission = randomUUID();
            delete current.reason;
            if (m.monitorContext !== undefined) current.monitorContext = structuredClone(m.monitorContext);
            state.scopedAdmissions.push({
              lane: current.lane,
              task: current.task,
              owner: current.owner,
              admission: current.admission,
              request: source,
            });
          }
          if (m.kind !== undefined) current.executionKind = m.kind;
          if (engineeringKind(m.kind))
            current.recoveryAuthorization = { request: source, kind: m.kind, developmentAdmission: current.admission };
          command.members.push({ ...m, admission: current.admission });
        }
      }
      if (action === 'resume-only') {
        assert.equal(state.paused, true, 'Use ordinary FIFO when not globally paused');
        assert.ok(
          lane === 'delivery'
            ? !scopedAdmissions(state).some((s) => s.lane === 'delivery')
            : !scopedAdmissions(state).length,
          'Another scoped direction remains active',
        );
        const current = ticket(state, lane, task, owner);
        assert.notEqual(current.awaitingNativeWorker, true, 'Native worker identity not bound');
        assert.ok(
          ['queued', 'blocked'].includes(current.status) || (bindingRef && current.status === 'running'),
          'Only queued, blocked or verified fenced bound tasks can resume alone',
        );
        assertDirectionAuthority(current, source);
        assert.ok(
          bindingRef !== undefined ||
            state.tickets.every(
              (t) =>
                t.request.sequence < source.sequence ||
                (t === current && JSON.stringify(t.request) === JSON.stringify(source)),
            ),
          'Stale scoped direction refused',
        );
        assert.ok(
          occupied.has(current.status) ||
            state.tickets.filter((t) => t.lane === lane && occupied.has(t.status)).length < retainedLimit(state, lane),
          'All lane slots occupied',
        );
        // Other historical slots remain held but administratively paused. Exactly
        // one task can execute in this mode; global resume still checks the new limits.
        if (lane === 'development' && monitorContext !== undefined)
          current.monitorContext = structuredClone(monitorContext);
        current.status = 'running';
        current.admission = randomUUID();
        delete current.reason;
        command.admission = current.admission;
        if (state.scopedAdmission) {
          state.scopedAdmissions ??= [];
          state.scopedAdmissions.push(state.scopedAdmission);
        }
        state.scopedAdmission = { lane, task, owner, admission: current.admission, request: source };
      }
      if (action === 'resume-task') {
        assert.ok(!state.paused, 'Global pause remains in effect');
        const current = ticket(state, lane, task, owner);
        assert.equal(current.status, 'blocked');
        current.status = 'running';
        current.admission = randomUUID();
        delete current.reason;
        command.admission = current.admission;
      }
      if (action === 'reorder') {
        assert.ok(EXECUTION_LANES.includes(lane), 'Exact lane required');
        assert.ok(
          Array.isArray(tasks) && tasks.length > 0 && tasks.every(id),
          'Exact user-specified pending order required',
        );
        const queued = state.tickets
          .filter((t) => t.lane === lane && t.status === 'queued')
          .sort((a, b) => a.order - b.order);
        assert.equal(new Set(tasks).size, tasks.length, 'Duplicate task in user order');
        assert.deepEqual(
          [...tasks].sort(),
          queued.map((t) => t.task).sort(),
          'Reorder must name all and only queued tasks; occupied slots remain unchanged',
        );
        const before = queued.map((t) => t.task);
        for (const [index, taskId] of tasks.entries())
          state.tickets.find((t) => t.lane === lane && t.task === taskId).order = index + 1;
        state.events.push({ action: 'reorder-applied', messageId: source.messageId, lane, before, after: [...tasks] });
      }
      state.events.push(command);
      return structuredClone(state);
    });
  }
  function cancellationTarget({ lane, task, owner, admission }) {
    assert.ok(EXECUTION_LANES.includes(lane) && id(task) && text(owner) && text(admission));
    const state = read();
    assert.ok(state, 'Execution-order policy not activated');
    const current = ticket(state, lane, task, owner);
    assert.equal(current.status, 'blocked', 'Only a blocked original slot can be cancelled');
    assert.equal(current.admission, admission, 'Exact original admission required');
    return structuredClone(current);
  }
  // Cancellation is a terminal user decision, not completion or a retry.
  function cancel({ lane, task, owner, admission, request }, verify) {
    const source = event(request);
    assert.ok(EXECUTION_LANES.includes(lane) && id(task) && text(owner) && text(admission));
    assert.equal(typeof verify, 'function', 'Independent cancellation verifier required');
    assert.ok(read(), 'Execution-order policy not activated');
    return withTaskRegistryWriteLock(directory, () => {
      const state = read();
      const current = ticket(state, lane, task, owner);
      assert.equal(current.admission, admission, 'Exact original admission required');
      const command = { action: 'cancel', lane, task, owner, admission, request: source };
      const prior = state.events.find((e) => e.request?.messageId === source.messageId);
      if (prior) {
        assert.deepEqual(prior, command, 'User event already used for a different action');
        assert.equal(current.status, 'cancelled');
        return structuredClone(current); // no write, probe, release or dispatch on replay
      }
      assert.equal(current.status, 'blocked', 'Only a blocked original slot can be cancelled');
      assert.equal(source.roomId, current.request.roomId, 'Original user conversation required');
      assert.equal(source.authorId, current.request.authorId, 'Original user required');
      assert.ok(
        [...state.events.map((e) => e.request), ...state.tickets.map((t) => t.request)]
          .filter(Boolean)
          .every((r) => r.sequence < source.sequence),
        'Stale cancellation direction refused',
      );
      const proof = verify(structuredClone(current));
      assert.equal(proof?.version, 1, 'Independent live cancellation proof required');
      for (const key of ['lane', 'task', 'owner', 'admission']) assert.equal(proof[key], current[key]);
      assert.equal(proof.outcome, 'quiescent');
      assert.match(proof.observationDigest ?? '', /^[a-f0-9]{64}$/);
      assert.ok(text(proof.host) && text(proof.observedAt));
      current.status = 'cancelled';
      current.cancellation = { request: source, proof: structuredClone(proof) };
      state.events.push(command);
      state.revision++;
      write(state);
      return structuredClone(current);
    });
  }
  function complete({ lane, task, owner, admission, evidence }, verify) {
    assert.equal(typeof verify, 'function', 'Independent stage evidence verifier required');
    return update((state) => {
      const current = ticket(state, lane, task, owner);
      assert.equal(current.status, 'running', 'Blocked task must await explicit user decision');
      assert.equal(current.admission, admission);
      assert.equal(verify(structuredClone(current), evidence), true, 'Stage completion evidence not proven');
      current.status = 'completed';
      if (scopedFor(state, current)) removeScope(state, current);
      current.completion = { digest: digest(evidence), evidence: structuredClone(evidence) };
      state.events.push({ action: 'complete', lane, task, evidenceDigest: current.completion.digest });
      return structuredClone(current); // never launches queued work
    });
  }
  // A phase transition references the original real user authorization. It is
  // deliberately not a new user direction, a refreshed timestamp or a replay.
  function promoteDelivery({ task, owner, developmentEvidenceDigest }, verify, dependenciesReady) {
    assert.equal(typeof verify, 'function', 'Independent development/registry verification required');
    assert.equal(typeof dependenciesReady, 'function', 'Trusted dependency reader required');
    return update((state) => {
      assert.equal(state.paused, true, 'Unpaused tasks use the ordinary FIFO entry');
      const development = ticket(state, 'development', task, owner);
      assert.equal(development.status, 'completed', 'Development must be verified complete first');
      const authorization = recoveryAuthorization(state, development);
      assert.ok(
        authorization.request.sequence > lastPauseSequence(state),
        'A later pause revoked lifecycle authorization',
      );
      assert.equal(
        development.completion.digest,
        developmentEvidenceDigest,
        'Exact development completion proof required',
      );
      const old = state.tickets.find((t) => t.lane === 'delivery' && t.task === task);
      const derived = { ...authorization, developmentEvidenceDigest };
      if (old?.derivedAuthorization) {
        assert.equal(old.owner, owner);
        assert.deepEqual(old.derivedAuthorization, derived);
        return structuredClone(old); // Never rotate/revive a running, blocked or terminal admission.
      }
      assert.ok(!old, 'An existing delivery instruction cannot be adopted or overwritten');
      const held = state.tickets
        .filter((t) => t.lane === 'delivery' && occupied.has(t.status))
        .some(
          (t) =>
            scopedFor(state, t) ||
            t.derivedAuthorization?.request.sequence > lastPauseSequence(state) ||
            state.events.some(
              (e) =>
                e.action === 'resume-only' &&
                e.lane === 'delivery' &&
                e.task === t.task &&
                e.admission === t.admission &&
                e.request.sequence >= lastPauseSequence(state),
            ),
        );
      assert.equal(held, false, 'Current delivery retains its serial slot');
      assert.equal(dependenciesReady({ lane: 'delivery', task, owner }), true, 'Task dependencies are not delivered');
      const earlier = state.tickets.filter(
        (t) =>
          t.lane === 'development' &&
          t.status === 'completed' &&
          t.recoveryAuthorization &&
          t.order < development.order &&
          t.recoveryAuthorization.request.sequence > lastPauseSequence(state) &&
          !state.tickets.some((d) => d.lane === 'delivery' && d.task === t.task && d.status === 'completed'),
      );
      assert.ok(
        !earlier.some(
          (t) => !state.dependenciesFirst || dependenciesReady({ lane: 'delivery', task: t.task, owner: t.owner }),
        ),
        'Earlier eligible engineering task retains delivery order',
      );
      assert.equal(
        verify(structuredClone(development), structuredClone(authorization)),
        true,
        'Development/registered engineering identity not proven',
      );
      const current = {
        lane: 'delivery',
        task,
        owner,
        request: structuredClone(authorization.request),
        order: development.order,
        status: 'running',
        admission: randomUUID(),
        derivedAuthorization: structuredClone(derived),
      };
      current.deliveryOriginAdmission = current.admission;
      state.tickets.push(current);
      if (state.scopedAdmission) {
        state.scopedAdmissions ??= [];
        state.scopedAdmissions.push(state.scopedAdmission);
      }
      state.scopedAdmission = {
        lane: 'delivery',
        task,
        owner,
        admission: current.admission,
        request: structuredClone(authorization.request),
      };
      state.events.push({
        action: 'promote-delivery',
        task,
        owner,
        kind: authorization.kind,
        request: structuredClone(authorization.request),
        admission: current.admission,
        developmentAdmission: authorization.developmentAdmission,
        developmentEvidenceDigest,
      });
      return structuredClone(current);
    });
  }
  return {
    commonDir,
    read,
    initialize,
    enqueue,
    reserveNativeCreation,
    bindNativeWorker,
    claim,
    assertAdmission,
    block,
    direct,
    complete,
    promoteDelivery,
    cancel,
    cancellationTarget,
    guard: (operation) => withTaskRegistryWriteLock(directory, operation),
  };
}
