import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { registerJob, planTick, acknowledgeNotification } from './task-resource-scheduler.mjs';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function transition(state, job, to, reason, now) {
  const from = job.status;
  job.status = to;
  state.events.push({
    id: ++state.revision,
    job: job.id,
    task: job.task,
    stage: job.stage,
    from,
    to,
    reason,
    at: now,
    delivered: false,
  });
}
// In-process single-owner admission coordinator with durable storage. No socket/server/daemon is installed here.
// Only legacy, non-preemptible verifier stages are accepted. Owned interruptible runners use a separate lifecycle.
export function createAdmissionBroker({ store, budget, validateEvidence, now = Date.now, policy }) {
  for (const fn of [budget, validateEvidence, store?.read, store?.write]) assert.equal(typeof fn, 'function');
  let state = store.read(),
    fault = null;
  const waiting = new Map();
  const localTickets = new Set();
  const claimedWaiters = new Set();
  // An old active job may still own locks/containers. Do not free its reservation or admit new jobs blindly.
  assert.ok(
    !state.jobs.some((j) => j.runtimeUncertain || ['starting', 'running', 'stopping'].includes(j.status)),
    'Unreconciled active scheduler jobs; no admission after restart',
  );
  function healthy() {
    if (fault) throw fault;
  }
  function transact(fn) {
    healthy();
    const next = structuredClone(state);
    const result = fn(next);
    try {
      store.write(next);
    } catch (error) {
      fault = error;
      for (const w of waiting.values()) w.reject(error);
      waiting.clear();
      throw error;
    }
    state = next;
    return result;
  }
  function jobFor(s, ticket) {
    const j = s.jobs.find((j) => j.id === ticket?.id);
    assert.ok(j && j.ticketToken === ticket.token, 'Unknown ticket identity');
    return j;
  }
  return {
    async enqueue(descriptor) {
      healthy();
      assert.equal(descriptor.restartable, false);
      assert.equal(descriptor.externalResources, true);
      const allocation = budget(descriptor);
      assert.ok(allocation && Number.isFinite(allocation.macPeakBytes) && Number.isFinite(allocation.dockerPeakBytes));
      const ticket = { id: randomUUID(), token: randomUUID() };
      transact((s) => {
        registerJob(s, {
          ...structuredClone(descriptor),
          macPeakBytes: allocation.macPeakBytes,
          dockerPeakBytes: allocation.dockerPeakBytes,
          id: ticket.id,
          ticketToken: ticket.token,
          descriptorDigest: digest(descriptor),
        });
        const j = jobFor(s, ticket);
        transition(s, j, 'queued', 'Stage queued for resource admission', now());
      });
      localTickets.add(ticket.id);
      return ticket;
    },
    waitAdmission(ticket) {
      healthy();
      const j = jobFor(state, ticket);
      assert.equal(claimedWaiters.has(ticket.id), false, 'Only one live waiter may own a stage');
      claimedWaiters.add(ticket.id);
      if (j.status === 'starting') return Promise.resolve({ id: j.id, token: j.admissionToken });
      assert.equal(j.status, 'queued', 'Stage is not waiting for admission');
      return new Promise((resolve, reject) => waiting.set(ticket.id, { resolve, reject }));
    },
    tick(sample) {
      healthy();
      assert.ok(!state.jobs.some((j) => j.runtimeUncertain), 'Active stage termination is unresolved');
      // A new coordinator cannot revive an orphaned queued caller. Its command/env was deliberately not persisted.
      const actions = transact((s) => {
        const detached = s.jobs.filter((j) => j.status === 'queued' && !localTickets.has(j.id));
        for (const j of detached)
          transition(s, j, 'blocked', 'Queued caller is absent; explicit reattachment required', now());
        const actions = planTick(s, sample, now(), policy);
        assert.ok(
          actions.every((a) => a.kind === 'start-verified'),
          'Legacy verifier stages may only pause at boundaries',
        );
        for (const a of actions) s.jobs.find((j) => j.id === a.job).admissionToken = randomUUID();
        return actions;
      });
      for (const a of actions) {
        const j = state.jobs.find((j) => j.id === a.job),
          w = waiting.get(a.job);
        waiting.delete(a.job);
        w?.resolve({ id: j.id, token: j.admissionToken });
      }
      return actions;
    },
    async assertAdmission(ticket, admission, descriptor) {
      transact((s) => {
        const j = jobFor(s, ticket);
        assert.equal(j.status, 'starting');
        assert.equal(admission?.id, j.id);
        assert.equal(admission?.token, j.admissionToken);
        assert.equal(digest(descriptor), j.descriptorDigest, 'Stage descriptor changed');
        transition(s, j, 'running', 'Verified gate stage admitted', now());
      });
    },
    async complete(ticket, result) {
      healthy();
      assert.equal(result.exitCode, 0);
      assert.equal(validateEvidence(result), true, 'Original verifier evidence must be validated');
      transact((s) => {
        const j = jobFor(s, ticket);
        assert.equal(j.status, 'running');
        j.evidence.push(structuredClone(result));
        transition(s, j, 'done', 'Original verifier returned valid success evidence', now());
      });
    },
    async block(ticket, reason, { stageEnded = false } = {}) {
      healthy();
      transact((s) => {
        const j = jobFor(s, ticket);
        assert.ok(!['done', 'blocked'].includes(j.status), 'Terminal stage cannot be rewritten');
        if (j.status === 'running' && !stageEnded) j.runtimeUncertain = true;
        transition(s, j, 'blocked', reason, now());
      });
      const waiter = waiting.get(ticket.id);
      waiting.delete(ticket.id);
      waiter?.reject(Error(reason));
    },
    pendingNotifications() {
      healthy();
      return structuredClone(state.events.filter((e) => !e.delivered));
    },
    acknowledge(id, receipt) {
      transact((s) => acknowledgeNotification(s, id, receipt));
    },
    snapshot() {
      healthy();
      return structuredClone(state);
    },
  };
}
