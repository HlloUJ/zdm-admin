import assert from 'node:assert/strict';
// Library protocol, not an installed LaunchAgent. Caller must own this broker and its locks.
export function createSchedulerLifecycle({ broker, closeOwnedStores }) {
  assert.equal(typeof closeOwnedStores, 'function');
  let phase = 'running';
  return {
    drain() {
      assert.notEqual(phase, 'stopped');
      if (phase === 'running') {
        phase = 'draining';
        broker.quiesce();
      }
      return this.status();
    },
    status() {
      const unresolved = broker
        .snapshot()
        .jobs.filter((j) => j.runtimeUncertain || ['running', 'starting', 'stopping'].includes(j.status))
        .map((j) => ({ id: j.id, task: j.task, status: j.status }));
      return { phase, unresolved, canClose: phase === 'draining' && unresolved.length === 0 };
    },
    close() {
      const state = this.status();
      assert.equal(
        state.canClose,
        true,
        'Active or uncertain external work must finish before releasing coordinator ownership',
      );
      closeOwnedStores();
      phase = 'stopped';
      return { phase };
    },
  };
}
// A container/PID disappearing is not success evidence. No destructive recovery action is performed.
export function assessExternalRecovery({ job, observations, now = Date.now(), maxAgeMs = 15000 }) {
  const reasons = [];
  if (!job?.spawnProof?.runToken || !job.spawnProof.startTime) reasons.push('Exact original process proof unavailable');
  if (!observations || observations.runToken !== job?.spawnProof?.runToken)
    reasons.push('Observation belongs to another execution');
  if (
    !Number.isFinite(observations?.observedAt) ||
    !Number.isFinite(observations?.requestedAt) ||
    observations.observedAt < observations.requestedAt
  )
    reasons.push('Fresh observation time unavailable');
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs <= 0 ||
    observations?.observedAt > now ||
    now - observations?.observedAt > maxAgeMs
  )
    reasons.push('Recovery observations are stale');
  if (
    observations?.process?.pid !== job?.spawnProof?.pid ||
    observations?.process?.expectedStartTime !== job?.spawnProof?.startTime
  )
    reasons.push('Process observation identity does not match original proof');
  const manifest = job?.externalManifest;
  if (
    manifest?.runToken !== job?.spawnProof?.runToken ||
    !job?.fingerprint ||
    manifest?.fingerprint !== job.fingerprint
  )
    reasons.push('Resource manifest source/execution mismatch');
  if (!manifest?.complete || !Array.isArray(manifest.containers) || !Array.isArray(manifest.leases))
    reasons.push('Complete external-resource manifest missing');
  if (observations?.process?.status !== 'absent' && observations?.process?.status !== 'identity-reused')
    reasons.push('Original process termination not proved');
  if (
    observations?.process?.status === 'identity-reused' &&
    observations.process.startTime === job?.spawnProof?.startTime
  )
    reasons.push('Process identity still matches original run');
  if (manifest?.complete) {
    for (const expected of manifest.containers ?? []) {
      const actual = observations?.containers?.find((v) => v.id === expected.id);
      if (
        !expected.id ||
        !expected.runToken ||
        expected.runToken !== job.spawnProof?.runToken ||
        !actual ||
        actual.runToken !== expected.runToken ||
        !['stopped', 'absent-proven'].includes(actual.status)
      )
        reasons.push('Container termination/ownership not proved');
    }
    for (const expected of manifest.leases ?? []) {
      const actual = observations?.leases?.find((v) => v.resource === expected.resource);
      if (
        !expected.tokenDigest ||
        !actual ||
        actual.tokenDigest !== expected.tokenDigest ||
        actual.runToken !== job.spawnProof?.runToken ||
        actual.status !== 'released-by-owner'
      )
        reasons.push('Original resource lease is unresolved');
    }
  }
  return {
    resourcesEnded: reasons.length === 0,
    releaseAutomatically: false,
    restartAutomatically: false,
    successEvidence: false,
    reasons,
    next: reasons.length
      ? 'Keep original reservations and investigate exact resources'
      : 'Reconcile original verifier evidence; termination alone cannot certify success or retry',
  };
}
