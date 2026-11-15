import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { inspectProcess } from './verification-process-identity.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readRegular = (file) => {
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Regular evidence file required');
  return readFileSync(file, 'utf8');
};
// Observation only: never signals processes, alters an attempt, removes a lock or grants retry eligibility.
export function diagnoseVerificationInterruption({
  root,
  key,
  lockName = key + '.lock',
  inspect = inspectProcess,
  host = os.hostname(),
  now = Date.now(),
}) {
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.ok(lockName === key + '.lock' || lockName === 'backend-artifacts.lock');
  const directory = path.join(realpathSync(root), '.task-verification');
  assert.equal(realpathSync(directory), directory, 'Evidence directory cannot be a symlink');
  const file = path.join(directory, key + '.json'),
    bytes = readRegular(file),
    record = JSON.parse(bytes);
  assert.match(record.attemptId, /^[a-f0-9-]{36}$/);
  const attemptDirectory = path.join(directory, 'attempts', key);
  assert.equal(realpathSync(attemptDirectory), attemptDirectory);
  const startedFile = path.join(attemptDirectory, record.attemptId + '.started.json');
  const startedBytes = readRegular(startedFile),
    started = JSON.parse(startedBytes);
  for (const field of ['attemptId', 'fingerprint', 'startedAt'])
    assert.equal(started[field], record[field], 'Attempt identity mismatch');
  const completed = existsSync(path.join(attemptDirectory, record.attemptId + '.json'));
  const lock = path.join(directory, lockName),
    hasLock = existsSync(lock),
    blockers = [];
  if (hasLock) assert.ok(lstatSync(lock).isDirectory() && !lstatSync(lock).isSymbolicLink());
  const observations = [];
  // Future producer must persist this binding before launch; absent legacy metadata cannot be invented.
  const ownerFile = path.join(lock, 'owner.json');
  if (!hasLock || !existsSync(ownerFile)) blockers.push('Original lock owner/process identity unavailable');
  else {
    const owner = JSON.parse(readRegular(ownerFile));
    if (
      owner.host !== host ||
      owner.attemptId !== record.attemptId ||
      owner.fingerprint !== record.fingerprint ||
      owner.worktree !== realpathSync(root)
    )
      blockers.push('Owner binding does not match this host/attempt/worktree');
    else if (!Array.isArray(owner.processes) || !owner.processes.length)
      blockers.push('Original process inventory unavailable');
    else
      for (const process of owner.processes) {
        if (!Number.isSafeInteger(process.pid) || process.pid <= 1 || !process.startTime) {
          blockers.push('Incomplete process identity');
          continue;
        }
        try {
          const current = inspect(process.pid);
          const status = !current ? 'absent' : current.startTime === process.startTime ? 'alive' : 'pid-reused';
          observations.push({ pid: process.pid, expectedStartTime: process.startTime, status });
          if (status === 'alive') blockers.push('Original process remains alive');
        } catch {
          blockers.push('Process inspection unavailable');
        }
      }
  }
  if (completed || record.status !== 'running') blockers.push('Not an unsettled running attempt');
  // PID absence alone says nothing about detached browsers, containers, or shared-resource leases.
  blockers.push('External resource termination and interruption cause not proven');
  return {
    version: 1,
    observedAt: now,
    root: realpathSync(root),
    key,
    attemptId: record.attemptId,
    evidenceDigest: hash(bytes),
    startedDigest: hash(startedBytes),
    classification: completed
      ? 'completion-present'
      : record.status === 'running'
        ? 'interrupted-unsettled'
        : 'not-running',
    observations,
    blockers,
    canReleaseLock: false,
    canRetry: false,
  };
}
// Seal a diagnostic sidecar, not a fabricated completion. Original failure history remains authoritative.
export function sealInterruptionDiagnostic(options) {
  const report = diagnoseVerificationInterruption(options);
  const file = path.join(
    report.root,
    '.task-verification',
    `${report.key}.${report.attemptId}.interruption-observed.json`,
  );
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { file, report };
}
