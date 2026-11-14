import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { inspectProcess } from './task-resource-runner.mjs';
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
export function createAdmissionBroker({
  store,
  budget,
  validateEvidence,
  now = Date.now,
  policy,
  inspectSpawn = inspectProcess,
  waiterLeaseMs = 30000,
}) {
  for (const fn of [budget, validateEvidence, store?.read, store?.write]) assert.equal(typeof fn, 'function');
  let state = store.read(),
    fault = null;
  assert.ok(Number.isFinite(waiterLeaseMs) && waiterLeaseMs >= 1000);
  let accepting = true;
  const pollingLeases = new Map();
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
      assert.ok(accepting, 'Coordinator is draining; no new tasks');
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
      assert.ok(!j.pollClaimId, 'Polling caller already owns this stage');
      assert.equal(claimedWaiters.has(ticket.id), false, 'Only one live waiter may own a stage');
      claimedWaiters.add(ticket.id);
      if (j.status === 'starting') return Promise.resolve({ id: j.id, token: j.admissionToken });
      assert.equal(j.status, 'queued', 'Stage is not waiting for admission');
      return new Promise((resolve, reject) => waiting.set(ticket.id, { resolve, reject }));
    },
    async pollAdmission(ticket, claimId) {
      healthy();
      assert.ok(accepting, 'Coordinator is draining; no new admission');
      assert.ok(typeof claimId === 'string' && claimId.length >= 16, 'Stable caller claim required');
      const prior = jobFor(state, ticket);
      assert.ok(!prior.pollClaimId || prior.pollClaimId === claimId, 'Another caller owns this admission');
      assert.ok(!claimedWaiters.has(ticket.id), 'Legacy waiter already owns this stage');
      assert.ok(
        ['queued', 'waiting-client', 'starting'].includes(prior.status),
        'Execution or terminal stage cannot be replayed',
      );
      const expired = !pollingLeases.has(ticket.id) || pollingLeases.get(ticket.id) <= now();
      transact((s) => {
        const j = jobFor(s, ticket);
        j.pollClaimId = claimId;
        if (j.status === 'starting' && expired) {
          delete j.admissionToken;
          transition(s, j, 'waiting-client', 'Unclaimed admission expired; no execution was authorized', now());
        }
        if (j.status === 'waiting-client')
          transition(s, j, 'queued', 'Same verified caller reattached before execution', now());
      });
      localTickets.add(ticket.id);
      pollingLeases.set(ticket.id, now() + waiterLeaseMs);
      const j = jobFor(state, ticket);
      return j.status === 'starting'
        ? { status: 'admitted', admission: { id: j.id, token: j.admissionToken } }
        : { status: 'pending' };
    },
    tick(sample) {
      healthy();
      if (!accepting) return [];
      assert.ok(!state.jobs.some((j) => j.runtimeUncertain), 'Active stage termination is unresolved');
      // A new coordinator cannot revive an orphaned queued caller. Its command/env was deliberately not persisted.
      const actions = transact((s) => {
        for (const j of s.jobs) {
          if (j.pollClaimId && ['queued', 'starting'].includes(j.status) && (pollingLeases.get(j.id) ?? 0) <= now()) {
            delete j.admissionToken;
            transition(s, j, 'waiting-client', 'Waiting caller lease expired; execution remains unauthorized', now());
          }
        }
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
      assert.ok(accepting, 'Coordinator is draining; no new execution');
      transact((s) => {
        const j = jobFor(s, ticket);
        assert.equal(j.status, 'starting');
        if (j.pollClaimId) assert.ok((pollingLeases.get(j.id) ?? 0) > now(), 'Caller admission lease expired');
        assert.equal(admission?.id, j.id);
        assert.equal(admission?.token, j.admissionToken);
        assert.equal(digest(descriptor), j.descriptorDigest, 'Stage descriptor changed');
        transition(s, j, 'running', 'Verified gate stage admitted', now());
      });
    },
    async recordSpawn(ticket, proof) {
      healthy();
      const j = jobFor(state, ticket);
      assert.equal(j.status, 'running', 'Only admitted executing stage may report spawn');
      assert.ok(typeof proof.runToken === 'string' && proof.runToken.length > 0);
      assert.equal(proof.fingerprint, j.fingerprint, 'Spawn fingerprint changed');
      if (j.spawnProof) {
        assert.equal(j.spawnProof.runToken, proof.runToken, 'Second execution is not authorized');
        assert.equal(j.spawnProof.pid, proof.pid, 'Duplicate proof PID differs');
        return { recorded: true, duplicate: true };
      }
      const actual = inspectSpawn(proof.pid);
      assert.ok(
        actual && actual.pid === proof.pid && Number.isSafeInteger(actual.pgid) && actual.pgid > 0 && actual.startTime,
        'Spawn process identity unavailable',
      );
      transact((s) => {
        const job = jobFor(s, ticket);
        job.spawnProof = { ...proof, pgid: actual.pgid, startTime: actual.startTime };
        transition(s, job, 'running', 'Original verifier process actually spawned and identity verified', now());
        Object.assign(s.events.at(-1), { executionStarted: true, runToken: proof.runToken });
      });
      return { recorded: true, duplicate: false };
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
    quiesce() {
      accepting = false;
      transact((s) => {
        for (const j of s.jobs)
          if (['queued', 'starting'].includes(j.status)) {
            delete j.admissionToken;
            transition(s, j, 'waiting-client', 'Coordinator draining; unexecuted admission withdrawn', now());
          }
      });
      for (const w of waiting.values()) w.reject(Error('Coordinator draining before stage execution'));
      waiting.clear();
      return { accepting: false };
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
