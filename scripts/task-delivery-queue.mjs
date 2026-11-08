import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import path from 'node:path';
import { createResourceLeases } from './resource-lease.mjs';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function safe(file) {
  if (existsSync(file)) assert.ok(!lstatSync(file).isSymbolicLink(), 'Linked delivery queue is unsafe');
}
export function createTaskDeliveryQueue(commonDir, dependencies = {}) {
  const directory = path.join(commonDir, 'task-registry'),
    stateFile = path.join(directory, 'delivery-queue.json');
  const leases = createResourceLeases(commonDir);
  const system = {
    tick: () => new Promise((resolve) => setTimeout(resolve, 1_000)),
    notify: console.error,
    alive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
      }
    },
    ...dependencies,
  };
  function read() {
    safe(directory);
    safe(stateFile);
    const state = existsSync(stateFile)
      ? JSON.parse(readFileSync(stateFile))
      : { version: 1, sequence: 0, tickets: [] };
    assert.equal(state.version, 1);
    assert.ok(Number.isSafeInteger(state.sequence) && Array.isArray(state.tickets));
    assert.equal(new Set(state.tickets.map((ticket) => ticket.id)).size, state.tickets.length);
    for (const ticket of state.tickets) {
      assert.match(ticket.task, ID);
      assert.ok(['waiting', 'running', 'blocked'].includes(ticket.status));
      assert.ok(ticket.id && ticket.owner && ticket.accepted);
    }
    return state;
  }
  function change(action) {
    safe(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lock = path.join(directory, 'queue-write.lock');
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      const failure = new Error('Delivery queue metadata is owned; retain the other writer', { cause: error });
      if (error.code === 'EEXIST') failure.code = 'QUEUE_METADATA_BUSY';
      throw failure;
    }
    const token = randomUUID(),
      ownerFile = path.join(lock, 'owner.json');
    writeFileSync(ownerFile, JSON.stringify({ token, pid: process.pid }), { flag: 'wx', mode: 0o600 });
    try {
      const state = read(),
        result = action(state);
      const temporary = stateFile + '.' + token + '.tmp';
      try {
        writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        renameSync(temporary, stateFile);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      return result;
    } finally {
      assert.equal(JSON.parse(readFileSync(ownerFile)).token, token, 'Queue metadata owner changed');
      unlinkSync(ownerFile);
      rmdirSync(lock);
    }
  }
  async function update(action) {
    const started = Date.now();
    for (;;) {
      try {
        return change(action);
      } catch (error) {
        if (error.code !== 'QUEUE_METADATA_BUSY' || Date.now() - started >= 30_000) throw error;
        const ownerFile = path.join(directory, 'queue-write.lock/owner.json');
        safe(ownerFile);
        if (existsSync(ownerFile)) {
          const owner = JSON.parse(readFileSync(ownerFile));
          if (!system.alive(owner.pid))
            throw new Error('Interrupted queue metadata writer; inspect its exact state before recovery', {
              cause: error,
            });
        }
        await system.tick();
      }
    }
  }
  function ticketFor(state, supplied) {
    const ticket = state.tickets.find((item) => item.id === supplied.id);
    assert.ok(
      ticket &&
        ticket.task === supplied.task &&
        ticket.owner === supplied.owner &&
        ticket.accepted === supplied.accepted,
      'Exact queue ticket changed',
    );
    return ticket;
  }
  function enqueue({ task, owner, accepted, head }) {
    assert.match(task, ID);
    assert.ok(owner);
    assert.match(accepted, /^[a-f0-9]{40}$/);
    assert.match(head, /^[a-f0-9]{40}$/);
    return update((state) => {
      const existing = state.tickets.find((ticket) => ticket.task === task);
      if (existing) {
        assert.equal(existing.owner, owner);
        assert.equal(existing.accepted, accepted, 'Queue cannot replace the original accepted source');
        return structuredClone(existing);
      }
      const ticket = {
        id: randomUUID(),
        task,
        owner,
        accepted,
        initialHead: head,
        sequence: ++state.sequence,
        status: 'waiting',
        mainMutationStarted: false,
        enqueuedAt: new Date().toISOString(),
      };
      state.tickets.push(ticket);
      return structuredClone(ticket);
    });
  }
  function start(supplied, resume) {
    return update((state) => {
      const ticket = ticketFor(state, supplied);
      if (state.tickets[0].id !== ticket.id)
        return { waiting: true, ahead: state.tickets[0].task, blocked: state.tickets[0].status === 'blocked' };
      const current = leases.inspect('main-delivery');
      if (current) {
        assert.equal(current.task, ticket.id, 'Main lease belongs to an unknown delivery; do not take over');
        if (!resume || (current.pid !== process.pid && system.alive(current.pid)))
          return { waiting: true, ahead: ticket.task, blocked: ticket.status === 'blocked' };
        assert.ok(ticket.status === 'blocked' || !system.alive(current.pid), 'Previous delivery may still be running');
        leases.release(current); // Exact own ticket, nonce and proved ended owner, never an age-based takeover.
      }
      if (ticket.status === 'running' && !resume) return { waiting: true, ahead: ticket.task, blocked: false };
      ticket.lease = leases.acquire('main-delivery', ticket.id);
      ticket.status = 'running';
      ticket.startedAt = new Date().toISOString();
      return { waiting: false, ticket: structuredClone(ticket) };
    });
  }
  async function wait(supplied, { resume = true } = {}) {
    let previous;
    for (;;) {
      const result = await start(supplied, resume);
      if (!result.waiting) return result.ticket;
      const message = `正式交付排队：${supplied.task} 等待 ${result.ahead}${result.blocked ? ' 完成受保护的恢复' : ''}；其他任务仍可继续开发。`;
      if (message !== previous) {
        system.notify(message);
        previous = message;
      }
      await system.tick();
    }
  }
  function markMainMutation(supplied) {
    return update((state) => {
      const ticket = ticketFor(state, supplied);
      assert.equal(ticket.status, 'running');
      assert.equal(leases.inspect('main-delivery')?.token, supplied.lease.token);
      ticket.mainMutationStarted = true;
      return structuredClone(ticket);
    });
  }
  function finish(supplied, { success, error } = {}) {
    return update((state) => {
      const ticket = ticketFor(state, supplied),
        current = leases.inspect('main-delivery');
      assert.equal(current?.token, supplied.lease.token, 'Main delivery lease changed');
      const history = {
        ...ticket,
        completedAt: new Date().toISOString(),
        outcome: success ? 'success' : 'failure',
        ...(error ? { failure: String(error.message) } : {}),
      };
      const folder = path.join(commonDir, 'task-delivery', ticket.task, 'queue-attempts');
      for (const entry of [path.dirname(path.dirname(folder)), path.dirname(folder), folder]) safe(entry);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileSync(
        path.join(folder, ticket.id + '-' + randomUUID() + '.json'),
        JSON.stringify(history, null, 2) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
      if (success || !ticket.mainMutationStarted) {
        leases.release(current);
        state.tickets = state.tickets.filter((item) => item.id !== ticket.id);
      } else {
        ticket.status = 'blocked';
        ticket.lastFailure = history.failure;
      }
      return history;
    });
  }
  return { inspect: read, enqueue, wait, markMainMutation, finish };
}
