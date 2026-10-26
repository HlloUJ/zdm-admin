import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { saveCompletion, recordRepair, finishRepair, completionSummary } from './completion-session.mjs';
import { evidenceIdentity } from './completion-ci-evidence.mjs';

function isGone(owner, { host = os.hostname(), probe = (pid) => process.kill(pid, 0) } = {}) {
  assert.ok(
    owner?.host === host && Number.isSafeInteger(owner.pid) && owner.pid > 0,
    'Unknown or foreign stage owner; preserve state',
  );
  try {
    probe(owner.pid);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
}
export function recoverWriter(directory, options) {
  const file = path.join(directory, 'completion-session.json.lock');
  if (!existsSync(file)) return;
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
  const bytes = readFileSync(file, 'utf8');
  assert.ok(isGone(JSON.parse(bytes), options), 'Writer is alive; never seize lock');
  assert.equal(readFileSync(file, 'utf8'), bytes);
  unlinkSync(file); // Only the proven-dead writer's private index lock, never a database/runtime lock.
}
export function recoverInterrupted(state, directory, options = {}) {
  for (const e of state.events.filter((event) => event.status === 'running')) {
    assert.ok(isGone(e.owner, options), 'Stage owner is alive; preserve its process');
    e.status = 'failure';
    e.finishedAt = options.now ?? Date.now();
    e.failure = { category: 'interrupted' };
    e.durationBasis = 'upper-bound-until-recovery; execution-stop-time-unknown';
  }
  saveCompletion(directory, state);
}
export function trackStageRestoration(state, directory) {
  if (state.startedAt === null) return;
  for (const e of state.events.filter((event) => event.status === 'failure' && !event.failure?.ci)) {
    if (state.repairs.some((r) => r.failureEventId === e.id)) continue;
    const file = path.join(directory, 'stage-failure-' + e.id + '.json');
    const diagnostic = JSON.stringify(
      {
        id: e.id,
        name: e.name,
        key: e.key,
        startedAt: e.startedAt,
        finishedAt: e.finishedAt,
        failure: e.failure,
        rootCause: 'unclassified; restoration must be reverified',
      },
      null,
      2,
    );
    if (existsSync(file)) assert.equal(readFileSync(file, 'utf8'), diagnostic);
    else writeFileSync(file, diagnostic, { flag: 'wx', mode: 0o600 });
    recordRepair(state, {
      id: 'stage-' + e.id,
      failureRun: 'stage:' + e.id,
      category: 'stage-restoration',
      evidence: file,
    });
  }
  saveCompletion(directory, state);
}
export function finishStageRestorations(state, directory) {
  for (const r of state.repairs.filter((r) => !r.finishedAt && r.isCiFailure === false)) {
    if (
      state.events.some(
        (e) =>
          e.name === r.failureName && e.key === r.failureKey && e.status === 'success' && e.startedAt >= r.startedAt,
      )
    )
      finishRepair(state, r.id);
  }
  saveCompletion(directory, state);
}
export function writeReceipt(file, result) {
  assert.ok(!existsSync(file) || !lstatSync(file).isSymbolicLink());
  const temporary = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}
export function restoreReceipt(directory, state, key, archived) {
  const results = {};
  for (const name of ['evidence', 'handoff', 'preserve', 'cleanup', 'close']) {
    const event = [...state.events].reverse().find((e) => e.name === name && e.key === key && e.status === 'success');
    assert.ok(
      event || (name === 'close' && archived?.main?.local === key.split(':')[0]),
      'No completed stage proof: ' + name,
    );
    results[name] = {
      result: event?.result ?? { batch: archived.id, main: archived.main, recoveredFrom: 'closed-registry-proof' },
      reused: true,
    };
  }
  const result = { results, summary: completionSummary(state), historical: true };
  writeReceipt(path.join(directory, 'completion-receipt.json'), result);
  return result;
}
export function completionEvidence({ root, evidence, proofFile, ci, execute, verifyEvidence }) {
  assert.ok(
    !existsSync(evidence) || (lstatSync(evidence).isDirectory() && !lstatSync(evidence).isSymbolicLink()),
    'Unsafe evidence directory',
  );
  assert.ok(
    !existsSync(proofFile) || (lstatSync(proofFile).isFile() && !lstatSync(proofFile).isSymbolicLink()),
    'Unsafe evidence proof',
  );
  if (existsSync(proofFile)) {
    const prior = JSON.parse(readFileSync(proofFile));
    const identity = evidenceIdentity(root, evidence);
    if (prior.identity === identity) return prior.result;
    // A changed proven packet must pass full validation again; never hide it by redownloading.
    const result = verifyEvidence(root, evidence, ci);
    writeReceipt(proofFile, { identity, result });
    return result;
  }
  if (existsSync(evidence)) {
    let result;
    try {
      result = verifyEvidence(root, evidence, ci);
    } catch {
      renameSync(evidence, evidence + '-incomplete-' + randomUUID());
    }
    if (result) {
      writeReceipt(proofFile, { identity: evidenceIdentity(root, evidence), result });
      return result;
    }
  }
  const staging = evidence + '-download-' + randomUUID();
  mkdirSync(staging, { mode: 0o700 });
  execute(root, 'gh', ['run', 'download', String(ci.runId), '--dir', staging]);
  const result = verifyEvidence(root, staging, ci); // Invalid fresh reports still fail; retain original download.
  renameSync(staging, evidence);
  writeReceipt(proofFile, { identity: evidenceIdentity(root, evidence), result });
  return result;
}
