import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { completionSummary, openCompletion, saveCompletion } from '../completion-session.mjs';
import { hasHistoricalCiDiagnosis, recordHistoricalCiDiagnosis } from './completion-ci-diagnosis.mjs';

const time = (seconds) => new Date(seconds * 1000).toISOString();
function fixture(t) {
  const worktree = mkdtempSync(path.join(realpathSync(tmpdir()), 'historical-ci-diagnosis-'));
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  const evidenceDirectory = path.join(worktree, '.task-verification');
  mkdirSync(evidenceDirectory);
  const sessionDirectory = path.join(worktree, 'session');
  const batch = {
    id: 'fixture',
    worktree,
    stage: 'handoff-verified',
    branch: 'codex/fixture',
    frozen: { accepted: 'a'.repeat(40) },
    main: { local: 'c'.repeat(40), remote: 'c'.repeat(40), runId: '14' },
  };
  const state = openCompletion(sessionDirectory, batch.id, { now: 1 });
  const failure = {
    id: 'failure',
    name: 'ci',
    key: 'original:11',
    startedAt: 1000,
    finishedAt: 2000,
    status: 'failure',
    failure: {
      ci: {
        runId: '11',
        headSha: 'd'.repeat(40),
        attempt: 1,
        failedJob: { id: 9, name: 'Frontend E2E 1/2', completedAt: time(2) },
      },
    },
  };
  const success = (runId, headSha, usedMain, seconds) => ({
    id: 'event-' + runId,
    name: 'ci',
    key: headSha + ':' + runId,
    startedAt: (seconds - 1) * 1000,
    finishedAt: seconds * 1000,
    status: 'success',
    result: {
      runId,
      headSha,
      eventName: usedMain ? 'push' : 'pull_request',
      branch: usedMain ? 'main' : batch.branch,
      gatesFinishedAt: time(seconds),
      attempt: 1,
      conclusion: 'success',
      jobs: ['Frontend quality', 'Backend quality'].map((name) => ({
        name,
        status: 'completed',
        conclusion: 'success',
      })),
    },
  });
  const candidate = 'e'.repeat(40);
  const before = success('13', 'b'.repeat(40), true, 6);
  const current = success('14', batch.main.local, true, 8);
  state.events.push(failure, success('12', candidate, false, 4), before, current, {
    id: 'handoff',
    name: 'handoff',
    key: batch.main.local + ':final',
    startedAt: 8100,
    finishedAt: 8200,
    status: 'success',
  });
  const source = path.join(evidenceDirectory, 'diagnostic.log');
  const bytes = 'Original observations only. Root cause unknown.';
  writeFileSync(source, bytes);
  const evidence = {
    task: batch.id,
    accepted: batch.frozen.accepted,
    candidate,
    failedCI: structuredClone(failure.failure.ci),
    failureEventId: failure.id,
    observedFailure: 'Timed out waiting for the dialog',
    rootCause: 'unproven',
    historicalDiagnosisDurationMs: null,
    diagnosedCodeRepairOfOriginalFailure: false,
    laterPRRun: '12',
    mainCI: {
      head: before.result.headSha,
      runId: before.result.runId,
      id: before.id,
      startedAt: before.startedAt,
      finishedAt: before.finishedAt,
    },
    diagnosticEvidence: [{ path: source, sha256: createHash('sha256').update(bytes).digest('hex') }],
  };
  const file = path.join(evidenceDirectory, 'diagnosis.json');
  const record = () => {
    writeFileSync(file, JSON.stringify(evidence));
    return recordHistoricalCiDiagnosis(state, batch, '11', file, 10_000);
  };
  return { batch, state, failure, current, file, source, evidence, record, sessionDirectory };
}

test('historical diagnosis binds original failure and newer CI without counting repair time or closing', (t) => {
  const f = fixture(t);
  const original = structuredClone(f.state.events);
  const diagnosis = f.record();
  assert.deepEqual(f.state.events, original);
  assert.deepEqual(f.state.repairs, []);
  assert.equal(diagnosis.failedAt, time(2));
  assert.equal(diagnosis.settlement.completedAt, time(8));
  assert.equal(diagnosis.recordedAt, time(10));
  assert.equal(diagnosis.rootCause, null);
  assert.equal(diagnosis.repairDurationMs, null);
  assert.deepEqual(f.record(), diagnosis);
  saveCompletion(f.sessionDirectory, f.state);
  const saved = openCompletion(f.sessionDirectory, f.batch.id);
  assert.equal(hasHistoricalCiDiagnosis(saved, f.failure, f.batch.frozen.accepted, f.batch.main.local, '14'), true);
  assert.throws(() => hasHistoricalCiDiagnosis(saved, f.failure, f.batch.frozen.accepted, f.batch.main.local, '13'));
  const summary = completionSummary(saved, 10_000);
  assert.equal(summary.repairMs, 0);
  assert.deepEqual(summary.unrecordedFailedRuns, []);
  assert.equal(saved.closedAt, undefined);
});

for (const scenario of [
  'wrong-failure',
  'tampered-source',
  'changed-freeze',
  'unknown-handoff',
  'retry',
  'late-read',
]) {
  test('historical diagnosis rejects ' + scenario, (t) => {
    const f = fixture(t);
    if (scenario === 'wrong-failure') f.evidence.failureEventId = 'other';
    if (scenario === 'tampered-source') writeFileSync(f.source, 'changed');
    if (scenario === 'changed-freeze') f.evidence.accepted = '0'.repeat(40);
    if (scenario === 'unknown-handoff') f.state.events.pop();
    if (scenario === 'retry') f.current.result.attempt = 2;
    if (scenario === 'late-read') {
      f.current.startedAt = 9000;
      f.current.result.gatesFinishedAt = time(6);
    }
    assert.throws(f.record);
    assert.equal(f.state.historicalCiDiagnoses, undefined);
  });
}
