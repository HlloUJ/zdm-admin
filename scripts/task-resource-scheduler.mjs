import assert from 'node:assert/strict';

// Policy only: no process starts/stops or test-result reinterpretation in this module.
export const RESOURCE_POLICY = Object.freeze({
  maxConcurrent: 4,
  maxDockerGroups: 2,
  recoveryMs: 60_000,
  overloadMs: 15_000,
  sampleMaxAgeMs: 15_000,
  macReserveBytes: 2 * 1024 ** 3,
  dockerReserveBytes: 2 * 1024 ** 3,
  diskReserveBytes: 10 * 1024 ** 3,
  criticalDockerBytes: 1024 ** 3,
  cpuBusyPercent: 85,
  cpuRecoveryPercent: 70,
  maxResourceInterruptions: 3,
});
export function initialSchedulerState() {
  return { version: 1, revision: 0, healthySince: null, overloadedSince: null, jobs: [], events: [] };
}
export function registerJob(state, job) {
  assert.ok(job.id && job.task && job.stage && job.fingerprint && job.worktree);
  assert.ok(!state.jobs.some((j) => j.id === job.id), 'Duplicate immutable job id');
  for (const key of ['macPeakBytes', 'dockerPeakBytes']) assert.ok(Number.isFinite(job[key]) && job[key] >= 0);
  assert.ok(Array.isArray(job.resources));
  state.jobs.push({ ...structuredClone(job), status: 'queued', interruptions: 0, evidence: [] });
}
function change(state, job, status, reason, now) {
  const from = job.status;
  if (from === status) return;
  job.status = status;
  state.revision++;
  state.events.push({
    id: state.revision,
    job: job.id,
    task: job.task,
    stage: job.stage,
    from,
    to: status,
    reason,
    at: now,
    delivered: false,
  });
}
export function acknowledgeNotification(state, id, receipt) {
  const event = state.events.find((e) => e.id === id);
  assert.ok(event && receipt?.destination && receipt?.messageId, 'Verified user-visible receipt required');
  event.delivered = true;
  event.receipt = receipt;
}
export function planTick(state, sample, now, policy = RESOURCE_POLICY) {
  assert.equal(state.version, 1);
  const fields = ['at', 'macAvailableBytes', 'dockerAvailableBytes', 'diskAvailableBytes', 'cpuBusyPercent'];
  const known =
    sample &&
    fields.every((k) => Number.isFinite(sample[k]) && sample[k] >= 0) &&
    now >= sample.at &&
    now - sample.at <= policy.sampleMaxAgeMs &&
    typeof sample.memoryPressure === 'boolean' &&
    typeof sample.swapGrowing === 'boolean' &&
    typeof sample.ioCongested === 'boolean';
  const overload =
    !known ||
    sample.memoryPressure ||
    sample.swapGrowing ||
    sample.ioCongested ||
    sample.cpuBusyPercent >= policy.cpuBusyPercent ||
    sample.macAvailableBytes < policy.macReserveBytes ||
    sample.dockerAvailableBytes < policy.dockerReserveBytes ||
    sample.diskAvailableBytes < policy.diskReserveBytes;
  const healthy = known && !overload && sample.cpuBusyPercent <= policy.cpuRecoveryPercent;
  if (!healthy) state.healthySince = null;
  else state.healthySince ??= now;
  if (!overload) state.overloadedSince = null;
  else state.overloadedSince ??= now;
  const actions = [];
  const running = state.jobs.filter((j) => ['running', 'starting', 'stopping'].includes(j.status));
  const critical = known && sample.dockerAvailableBytes < policy.criticalDockerBytes;
  if (critical || (overload && now - state.overloadedSince >= policy.overloadMs)) {
    // At most one group per decision, and never signal an unowned or non-restartable phase.
    const victim = [...running].reverse().find((j) => j.status === 'running' && j.restartable && j.ownershipVerified);
    if (victim && !running.some((j) => j.status === 'stopping')) {
      change(state, victim, 'stopping', critical ? 'Docker memory critical' : 'Resource pressure sustained', now);
      actions.push({ kind: 'stop-owned', job: victim.id, signal: 'SIGTERM' });
    }
    return actions;
  }
  if (!healthy || now - state.healthySince < policy.recoveryMs || running.some((j) => j.status === 'stopping'))
    return actions;
  let mac = sample.macAvailableBytes - policy.macReserveBytes;
  let docker = sample.dockerAvailableBytes - policy.dockerReserveBytes;
  // Full reservation for all active groups is deliberately conservative: protects unobserved peaks.
  for (const j of running) {
    mac -= j.macPeakBytes;
    docker -= j.dockerPeakBytes;
  }
  const occupied = new Set(running.flatMap((j) => j.resources));
  let slots = running.length,
    dockerGroups = running.filter((j) => j.dockerPeakBytes > 0).length;
  for (const job of state.jobs) {
    if (!['queued', 'resource-paused'].includes(job.status)) continue;
    if (job.interruptions >= policy.maxResourceInterruptions) {
      change(state, job, 'blocked', 'Resource interruption budget exhausted; diagnose before retry', now);
      continue;
    }
    if (
      slots >= policy.maxConcurrent ||
      (job.dockerPeakBytes > 0 && dockerGroups >= policy.maxDockerGroups) ||
      job.macPeakBytes > mac ||
      job.dockerPeakBytes > docker ||
      job.resources.some((r) => occupied.has(r))
    )
      continue;
    const resumed = job.status === 'resource-paused';
    change(
      state,
      job,
      'starting',
      resumed ? 'Resources stable; rerun interrupted stage' : 'Resources stable; admit stage',
      now,
    );
    actions.push({ kind: 'start-verified', job: job.id, fingerprint: job.fingerprint });
    slots++;
    if (job.dockerPeakBytes > 0) dockerGroups++;
    mac -= job.macPeakBytes;
    docker -= job.dockerPeakBytes;
    for (const r of job.resources) occupied.add(r);
  }
  return actions;
}
export function recordStarted(state, id, identity, now) {
  const job = state.jobs.find((j) => j.id === id);
  assert.equal(job?.status, 'starting');
  assert.ok(identity?.runToken && identity?.pid && identity?.startTime && identity?.fingerprint === job.fingerprint);
  job.runtime = identity;
  job.ownershipVerified = true;
  change(state, job, 'running', 'Owned runner started', now);
}
export function recordExit(state, id, result, now) {
  const job = state.jobs.find((j) => j.id === id);
  assert.ok(job && ['running', 'stopping', 'starting'].includes(job.status));
  assert.equal(result.runToken, job.runtime?.runToken, 'Runner identity mismatch');
  assert.equal(result.processesEnded, true, 'Owned process group/container termination must be verified');
  if (job.status === 'stopping') {
    job.interruptions++;
    change(state, job, 'resource-paused', 'Owned processes ended; interrupted stage has no success evidence', now);
  } else if (result.code === 0 && result.evidence && result.fingerprint === job.fingerprint) {
    job.evidence.push(result.evidence);
    change(state, job, 'done', 'Stage completed with matching evidence', now);
  } else change(state, job, 'blocked', 'Stage failed or evidence missing; no automatic failure retry', now);
  job.runtime = null;
  job.ownershipVerified = false;
}
export function recoverJob(state, id, proof, now) {
  const job = state.jobs.find((j) => j.id === id);
  assert.ok(job && ['starting', 'running', 'stopping'].includes(job.status));
  if (proof.processesEnded === true && proof.fingerprint === job.fingerprint && job.restartable) {
    job.interruptions++;
    job.runtime = null;
    job.ownershipVerified = false;
    change(
      state,
      job,
      'resource-paused',
      'Interrupted runner proved ended; stage will rerun after stable capacity',
      now,
    );
  } else change(state, job, 'blocked', 'Restart recovery ownership/source/termination not proved', now);
  state.healthySince = null;
}
