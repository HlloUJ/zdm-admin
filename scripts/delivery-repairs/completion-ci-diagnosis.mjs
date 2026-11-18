import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { assertCompletionQuality } from '../completion-ci-evidence.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function evidenceBytes(file, worktree) {
  const directory = path.join(worktree, '.task-verification');
  assert.ok(path.isAbsolute(file) && file.startsWith(directory + path.sep), 'Exact task diagnosis evidence required');
  assert.equal(realpathSync(file), file, 'Linked diagnosis evidence refused');
  assert.ok(lstatSync(file).isFile(), 'Diagnosis evidence must be a file');
  return readFileSync(file);
}

function failedRun(state, runId) {
  assert.match(runId, /^\d+$/);
  const entries = state.events.filter(
    (event) => event.name === 'ci' && event.status === 'failure' && event.failure?.ci?.runId === runId,
  );
  assert.equal(entries.length, 1, 'Exact original failed CI event required');
  const [event] = entries;
  const ci = event.failure.ci;
  assert.equal(ci.attempt, 1, 'Original first-attempt failure required');
  assert.ok(ci.failedJob?.id && Number.isFinite(Date.parse(ci.failedJob.completedAt)), 'Original failed job required');
  return event;
}

function mainVerification(state, { head, runId }, eventId) {
  const event = state.events.find(
    (item) =>
      item.name === 'ci' &&
      item.key === head + ':' + runId &&
      item.status === 'success' &&
      (!eventId || item.id === eventId),
  );
  assert.ok(event, 'Exact successful main CI event required');
  assertCompletionQuality(event.result, head, runId);
  assert.equal(event.result.eventName, 'push');
  assert.equal(event.result.branch, 'main');
  const completedAt = event.result.gatesFinishedAt;
  assert.ok(Number.isFinite(Date.parse(completedAt)), 'Remote CI completion time required');
  return { event, completedAt };
}

export function recordHistoricalCiDiagnosis(state, batch, runId, file, now = Date.now()) {
  assert.equal(batch.stage, 'handoff-verified', 'Exact published runtime handoff required');
  const failed = failedRun(state, runId);
  const bytes = evidenceBytes(file, batch.worktree);
  const evidence = JSON.parse(bytes);
  assert.equal(evidence.task, batch.id);
  assert.equal(evidence.accepted, batch.frozen.accepted);
  assert.equal(evidence.failureEventId, failed.id);
  assert.deepEqual(evidence.failedCI, failed.failure.ci);
  assert.equal(evidence.rootCause, 'unproven');
  assert.equal(evidence.historicalDiagnosisDurationMs, null);
  assert.equal(evidence.diagnosedCodeRepairOfOriginalFailure, false);
  assert.ok(evidence.observedFailure?.trim() && evidence.diagnosticEvidence?.length, 'Original diagnosis required');
  for (const source of evidence.diagnosticEvidence)
    assert.equal(digest(evidenceBytes(source.path, batch.worktree)), source.sha256, 'Diagnostic source bytes changed');

  const prior = mainVerification(state, evidence.mainCI, evidence.mainCI.id);
  assert.equal(prior.event.startedAt, evidence.mainCI.startedAt);
  assert.equal(prior.event.finishedAt, evidence.mainCI.finishedAt);
  const pr = state.events.find(
    (item) =>
      item.name === 'ci' && item.key === evidence.candidate + ':' + evidence.laterPRRun && item.status === 'success',
  );
  assert.ok(pr, 'Exact successful PR CI event required');
  assertCompletionQuality(pr.result, evidence.candidate, evidence.laterPRRun);
  assert.equal(pr.result.eventName, 'pull_request');
  assert.equal(pr.result.branch, batch.branch);
  assert.notEqual(evidence.candidate, failed.failure.ci.headSha);

  const main = { head: batch.main.local, runId: batch.main.runId };
  assert.equal(main.head, batch.main.remote);
  const current = mainVerification(state, main);
  assert.ok(
    state.events.some(
      (item) => item.name === 'handoff' && item.key === main.head + ':final' && item.status === 'success',
    ),
    'Exact published runtime handoff required',
  );
  const failedAt = failed.failure.ci.failedJob.completedAt;
  assert.ok(
    Date.parse(failedAt) < Date.parse(pr.result.gatesFinishedAt) &&
      Date.parse(pr.result.gatesFinishedAt) < Date.parse(prior.completedAt) &&
      Date.parse(prior.completedAt) < Date.parse(current.completedAt) &&
      Date.parse(current.completedAt) <= now &&
      new Set([runId, evidence.laterPRRun, evidence.mainCI.runId, main.runId]).size === 4,
    'Distinct CI runs and actual remote chronology required',
  );

  const record = {
    failureRun: runId,
    failureEventId: failed.id,
    failedAt,
    observedFailure: evidence.observedFailure,
    accepted: evidence.accepted,
    evidenceDigest: digest(bytes),
    priorPRRun: evidence.laterPRRun,
    priorMainRun: evidence.mainCI.runId,
    settlement: { ...main, eventId: current.event.id, completedAt: current.completedAt },
    rootCause: null,
    repairDurationMs: null,
  };
  state.historicalCiDiagnoses ??= [];
  const existing = state.historicalCiDiagnoses.find((entry) => entry.failureRun === runId);
  if (existing) {
    assert.deepEqual(existing, { ...record, recordedAt: existing.recordedAt }, 'Historical diagnosis already recorded');
    return existing;
  }
  const diagnosis = { ...record, recordedAt: new Date(now).toISOString() };
  state.historicalCiDiagnoses.push(diagnosis);
  return diagnosis;
}

export function hasHistoricalCiDiagnosis(state, failed, accepted, main, runId) {
  const record = state.historicalCiDiagnoses?.find((item) => item.failureEventId === failed.id);
  if (!record) return false;
  assert.equal(record.failureRun, failed.failure.ci.runId);
  assert.equal(record.failedAt, failed.failure.ci.failedJob.completedAt);
  assert.equal(record.accepted, accepted);
  assert.equal(record.rootCause, null);
  assert.equal(record.repairDurationMs, null);
  assert.match(record.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(record.settlement.head, main);
  assert.equal(record.settlement.runId, runId);
  const { completedAt } = mainVerification(state, record.settlement, record.settlement.eventId);
  assert.equal(record.settlement.completedAt, completedAt);
  assert.ok(Date.parse(record.failedAt) < Date.parse(completedAt));
  assert.ok(Date.parse(completedAt) <= Date.parse(record.recordedAt));
  return true;
}
