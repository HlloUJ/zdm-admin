import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withTaskRegistryWriteLock } from './task-registry.mjs';

export const EXECUTION_LANES = ['development', 'delivery'];
const occupied = new Set(['running', 'blocked']);
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const id = (v) => typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  const keys = new Set();
  for (const ticket of state.tickets) {
    assert.ok(EXECUTION_LANES.includes(ticket.lane) && id(ticket.task) && text(ticket.owner));
    assert.ok(['queued', 'running', 'blocked', 'completed'].includes(ticket.status));
    event(ticket.request);
    assert.ok(Number.isSafeInteger(ticket.order) && ticket.order > 0, 'Exact effective queue order required');
    const key = `${ticket.lane}:${ticket.task}`;
    assert.ok(!keys.has(key), 'Duplicate task lane');
    keys.add(key);
  }
  for (const lane of EXECUTION_LANES)
    assert.ok(
      state.tickets.filter((t) => t.lane === lane && occupied.has(t.status)).length <= 3,
      'Capacity invariant violated',
    );
  return state;
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
    const temporary = path.join(directory, randomUUID() + '.json');
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
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
      const result = action(state);
      state.revision++;
      write(state);
      return result;
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
  function claim({ lane, task, owner }) {
    return update((state) => {
      assert.ok(!state.paused, 'All execution launches paused');
      const current = ticket(state, lane, task, owner);
      if (current.status === 'running') return structuredClone(current); // no new spawn is authorized by repeat claim
      assert.equal(current.status, 'queued', 'Blocked/completed task cannot auto-resume');
      assert.ok(
        state.tickets.filter((t) => t.lane === lane && occupied.has(t.status)).length < state.limit,
        'All lane slots occupied',
      );
      const next = state.tickets
        .filter((t) => t.lane === lane && t.status === 'queued')
        .sort((a, b) => a.order - b.order)[0];
      assert.equal(next.task, task, 'Only the FIFO head may claim');
      current.status = 'running';
      current.admission = randomUUID();
      state.events.push({ action: 'claim', lane, task, admission: current.admission });
      return structuredClone(current);
    });
  }
  function assertAdmission({ lane, task, owner, admission }) {
    const state = read();
    if (!state) return { active: false };
    assert.ok(!state.paused, 'All execution launches paused');
    const current = ticket(state, lane, task, owner);
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
      current.reason = reason;
      state.events.push({ action: 'block', lane, task, reason });
      return structuredClone(current);
    });
  }
  function direct({ action, request, lane, task, owner, tasks }) {
    const source = event(request);
    assert.ok(
      ['pause-all', 'resume-all', 'resume-task', 'reorder'].includes(action),
      'Only explicit supported user directions',
    );
    return update((state) => {
      const prior = state.events.find((e) => e.request?.messageId === source.messageId);
      const command = {
        action,
        request: source,
        ...(action === 'resume-task' ? { lane, task, owner } : {}),
        ...(action === 'reorder' ? { lane, tasks } : {}),
      };
      if (prior) {
        assert.deepEqual(prior, command, 'User event already used for a different action');
        return structuredClone(state);
      }
      assert.ok(
        state.events.filter((e) => e.request).every((e) => e.request.sequence < source.sequence),
        'Stale user direction refused',
      );
      if (action === 'pause-all') state.paused = true;
      if (action === 'resume-all') state.paused = false; // blocked tickets remain blocked
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
  function complete({ lane, task, owner, admission, evidence }, verify) {
    assert.equal(typeof verify, 'function', 'Independent stage evidence verifier required');
    return update((state) => {
      const current = ticket(state, lane, task, owner);
      assert.equal(current.status, 'running', 'Blocked task must await explicit user decision');
      assert.equal(current.admission, admission);
      assert.equal(verify(structuredClone(current), evidence), true, 'Stage completion evidence not proven');
      current.status = 'completed';
      current.completion = { digest: digest(evidence), evidence: structuredClone(evidence) };
      state.events.push({ action: 'complete', lane, task, evidenceDigest: current.completion.digest });
      return structuredClone(current); // never launches queued work
    });
  }
  return { read, initialize, enqueue, claim, assertAdmission, block, direct, complete };
}
