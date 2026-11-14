import assert from 'node:assert/strict';
import { writeFileSync, renameSync, readFileSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  completionDirectory,
  processScope,
  startCompletionProcess,
  assertProcessesGone,
} from './completion-process.mjs';
import { inspectProcess } from './task-resource-runner.mjs';
// Reuse the existing POSIX supervisor rather than adding another service or process framework.
export function createVerificationProcessLifecycle({
  root,
  lock,
  inspect = inspectProcess,
  launch = startCompletionProcess,
  scope = processScope,
  assertGone = assertProcessesGone,
}) {
  const owner = inspect(process.pid);
  assert.ok(owner?.startTime, 'Verifier owner identity unavailable');
  const event = { processTracking: 1, processes: [] };
  const state = { [completionDirectory]: lock };
  const proof = { version: 1, host: os.hostname(), worktree: root, owner, attemptId: null, fingerprint: null, event };
  const file = path.join(lock, 'verification-owner.json');
  const save = () => {
    const temporary = file + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(proof), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  };
  save();
  return {
    start(record, command, args, options) {
      assert.equal(proof.attemptId, null, 'Only one actual launch per verification attempt');
      assert.ok(record.attemptId && record.fingerprint);
      const attempts = path.join(root, '.task-verification', 'attempts');
      const matches = readdirSync(attempts)
        .filter((key) => /^[a-f0-9]{64}$/.test(key))
        .map((key) => path.join(attempts, key, `${record.attemptId}.started.json`))
        .filter((file) => {
          try {
            return lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink();
          } catch {
            return false;
          }
        });
      assert.equal(matches.length, 1, 'Exactly one immutable attempt must precede launch');
      const started = JSON.parse(readFileSync(matches[0], 'utf8'));
      for (const key of ['attemptId', 'fingerprint', 'startedAt']) assert.equal(started[key], record[key]);
      proof.attemptFile = path.relative(root, matches[0]);
      proof.startedAt = record.startedAt;
      proof.attemptId = record.attemptId;
      proof.fingerprint = record.fingerprint;
      save();
      return scope(state, event, save, () => launch(command, args, options));
    },
    assertGone() {
      assertGone(event, lock);
    },
  };
}

// Only new producer-owned locks can be sealed. Legacy empty locks remain explicitly unsupported.
export function sealEndedVerificationLock({ root, lock, inspect = inspectProcess, assertGone = assertProcessesGone }) {
  assert.equal(path.dirname(lock), path.join(root, '.task-verification'));
  assert.ok(lstatSync(lock).isDirectory() && !lstatSync(lock).isSymbolicLink());
  const file = path.join(lock, 'verification-owner.json');
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
  const bytes = readFileSync(file, 'utf8'),
    proof = JSON.parse(bytes);
  assert.equal(proof.host, os.hostname());
  assert.equal(proof.worktree, root);
  assert.ok(proof.owner?.pid > 1 && proof.owner.startTime && proof.attemptId && proof.fingerprint);
  assert.match(proof.attemptFile ?? '', /^\.task-verification\/attempts\/[a-f0-9]{64}\/[a-f0-9-]{36}\.started\.json$/);
  const startedFile = path.join(root, proof.attemptFile);
  assert.ok(lstatSync(startedFile).isFile() && !lstatSync(startedFile).isSymbolicLink());
  const startedBytes = readFileSync(startedFile, 'utf8');
  const started = JSON.parse(startedBytes);
  for (const key of ['attemptId', 'fingerprint', 'startedAt']) assert.equal(started[key], proof[key]);
  const owner = inspect(proof.owner.pid);
  assert.ok(!owner || owner.startTime !== proof.owner.startTime, 'Original verifier still alive');
  assertGone(proof.event, lock);
  assert.equal(readFileSync(file, 'utf8'), bytes, 'Proof changed while observing');
  assert.equal(readFileSync(startedFile, 'utf8'), startedBytes, 'Immutable attempt changed');
  const archive = lock + '.ended-' + randomUUID();
  renameSync(lock, archive); // Keep all original launch evidence; never fabricate an attempt completion.
  return { archive, retryAuthorized: false, originalFailurePreserved: true };
}
