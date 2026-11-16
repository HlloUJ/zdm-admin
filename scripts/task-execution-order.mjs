import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withTaskRegistryWriteLock } from './task-registry.mjs';
import { captureQueueProgress } from './task-delivery-status-sync.mjs';

export const EXECUTION_LANES = ['development', 'delivery'];
const occupied = new Set(['running', 'blocked']);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const id = (v) => typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const laneLimit = (state, lane) => (state.limits?.[lane] === null ? Infinity : (state.limits?.[lane] ?? state.limit));
const retainedLimit = (state, lane) => (state.limits?.[lane] === null ? Infinity : state.limit);
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
  }
  for (const lane of EXECUTION_LANES)
    assert.ok(
      state.tickets.filter((t) => t.lane === lane && occupied.has(t.status)).length <=
        (state.paused ? retainedLimit(state, lane) : laneLimit(state, lane)),
      'Capacity invariant violated',
    );
  if (state.scopedAdmission) {
    const scoped = state.scopedAdmission;
    assert.equal(state.paused, true, 'Scoped admission requires the global pause');
    const current = state.tickets.find((t) => t.lane === scoped.lane && t.task === scoped.task);
    assert.ok(current && current.status === 'running' && current.owner === scoped.owner);
    assert.ok(text(scoped.admission) && current.admission === scoped.admission);
    event(scoped.request);
    assert.ok(
      state.events.some(
        (e) =>
          e.action === 'resume-only' &&
          e.lane === scoped.lane &&
          e.task === scoped.task &&
          e.owner === scoped.owner &&
          e.admission === scoped.admission &&
          JSON.stringify(e.request) === JSON.stringify(scoped.request),
      ),
      'Scoped admission lacks its exact user direction',
    );
  }
  return state;
}
const scopedFor = (state, current) =>
  state.scopedAdmission?.lane === current.lane &&
  state.scopedAdmission?.task === current.task &&
  state.scopedAdmission?.owner === current.owner &&
  state.scopedAdmission?.admission === current.admission;
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
    return found;
  }
  function enqueue({ lane, task, owner, request }) {
    assert.ok(EXECUTION_LANES.includes(lane) && id(task) && text(owner));
    const source = event(request);
    return update((state) => {
      const old = state.tickets.find((t) => t.lane === lane && t.task === task);
      if (old) {
        assert.equal(old.owner, owner);
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
      const added = { lane, task, owner, request: source, order: source.sequence, status: 'queued', admission: null };
      state.tickets.push(added);
      return structuredClone(added);
    });
  }
  function claim({ lane, task, owner, monitorContext }, dependenciesReady) {
    return update((state) => {
      const current = ticket(state, lane, task, owner);
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
        state.tickets.filter((t) => t.lane === lane && occupied.has(t.status)).length < laneLimit(state, lane),
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
      if (scopedFor(state, current)) delete state.scopedAdmission;
      current.reason = reason;
      state.events.push({ action: 'block', lane, task, reason });
      return structuredClone(current);
    });
  }
  function direct({ action, request, lane, task, owner, tasks, limits, dependenciesFirst, monitorContext }) {
    const source = event(request);
    assert.ok(
      ['pause-all', 'resume-all', 'resume-task', 'resume-only', 'set-limits', 'reorder'].includes(action),
      'Only explicit supported user directions',
    );
    return update((state) => {
      const sameSource = state.events.filter((e) => e.request?.messageId === source.messageId);
      const continuation =
        action === 'resume-only' &&
        sameSource.length === 1 &&
        sameSource[0].action === 'pause-all' &&
        JSON.stringify(sameSource[0].request) === JSON.stringify(source);
      const prior = sameSource.find((e) => e.action === action) ?? (continuation ? null : sameSource[0]);
      const command = {
        action,
        request: source,
        ...(['resume-task', 'resume-only'].includes(action) ? { lane, task, owner } : {}),
        ...(action === 'resume-only' && monitorContext !== undefined ? { monitorContext } : {}),
        ...(action === 'reorder' ? { lane, tasks } : {}),
        ...(action === 'set-limits' ? { limits } : {}),
        ...(action === 'set-limits' && dependenciesFirst !== undefined ? { dependenciesFirst } : {}),
      };
      if (prior) {
        const direction = { ...prior };
        delete direction.admission;
        assert.deepEqual(direction, command, 'User event already used for a different action');
        return structuredClone(state);
      }
      assert.ok(
        state.events
          .filter((e) => e.request)
          .every((e) => e.request.sequence < source.sequence || (continuation && e === sameSource[0])),
        'Stale user direction refused',
      );
      if (action === 'pause-all' || action === 'resume-all') {
        state.paused = action === 'pause-all';
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
      if (action === 'resume-only') {
        assert.equal(state.paused, true, 'Use ordinary FIFO when not globally paused');
        assert.ok(!state.scopedAdmission, 'Another scoped direction remains active');
        const current = ticket(state, lane, task, owner);
        assert.ok(['queued', 'blocked'].includes(current.status), 'Only queued or blocked tasks can resume alone');
        assert.equal(source.roomId, current.request.roomId, 'Original user conversation required');
        assert.equal(source.authorId, current.request.authorId, 'Original user required');
        assert.ok(
          state.tickets.every(
            (t) =>
              t.request.sequence < source.sequence ||
              (t === current && JSON.stringify(t.request) === JSON.stringify(source)),
          ),
          'Stale scoped direction refused',
        );
        assert.ok(
          current.status === 'blocked' ||
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
        state.scopedAdmission = { lane, task, owner, admission: current.admission, request: source };
      }
      if (action === 'resume-task') {
        assert.ok(!state.paused, 'Global pause remains in effect');
        const current = ticket(state, lane, task, owner);
        assert.equal(current.status, 'blocked');
        current.status = 'running';
        current.admission = randomUUID();
        delete current.reason;
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
      if (scopedFor(state, current)) delete state.scopedAdmission;
      current.completion = { digest: digest(evidence), evidence: structuredClone(evidence) };
      state.events.push({ action: 'complete', lane, task, evidenceDigest: current.completion.digest });
      return structuredClone(current); // never launches queued work
    });
  }
  return {
    commonDir,
    read,
    initialize,
    enqueue,
    claim,
    assertAdmission,
    block,
    direct,
    complete,
    cancel,
    cancellationTarget,
  };
}
