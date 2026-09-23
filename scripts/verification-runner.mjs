import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import {
  canReuse,
  captureArtifacts,
  captureIdentity,
  captureSource,
  digest,
  evidenceMissReason,
  EVIDENCE_VERSION,
  verificationAttempts,
  requiresFailureHistory,
} from './verification-evidence.mjs';
import { backendReportState, validateBackendReports } from './backend-test-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';

function save(file, record) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, file);
}

function appendAttempt(directory, record, started = false) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${record.attemptId}${started ? '.started' : ''}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
}

function failureReference(attempt) {
  return attempt
    ? { attemptId: attempt.attemptId, fingerprint: attempt.fingerprint, startedAt: attempt.startedAt, log: attempt.log }
    : null;
}

export async function runVerificationTask(task, options = {}) {
  const { root, name, command, args = [], env = process.env } = task;
  const inspect = options.captureIdentity ?? captureIdentity;
  const artifacts = options.captureArtifacts ?? captureArtifacts;
  const report = options.report ?? console.log;
  const directory = path.join(root, '.task-verification');
  const key = digest(JSON.stringify({ command, args, coverage: task.coverage ?? [name], kind: task.kind ?? 'node' }));
  mkdirSync(path.join(directory, 'logs'), { recursive: true });
  const file = path.join(directory, `${key}.json`);
  const attemptsDirectory = path.join(directory, 'attempts', key);
  const lock = path.join(directory, `${task.kind === 'backend' ? 'backend-artifacts' : key}.lock`);
  try {
    mkdirSync(lock);
  } catch {
    report(`[blocked] ${name}: another run owns ${lock}; inspect it before retrying`);
    return { exitCode: 1, reused: false };
  }
  const startedAt = new Date().toISOString();
  const start = performance.now();
  let attemptRecord;
  let completionWritten = false;
  try {
    const snapshot = () => {
      try {
        return inspect(task);
      } catch (error) {
        // Evidence collection failure never skips the original command. Source identity remains mandatory.
        const source = captureSource(root);
        const identity = {
          source: { digest: source.digest, baseline: source.baseline, mergeBase: source.mergeBase },
          artifacts: [],
        };
        return {
          source,
          identity,
          fingerprint: digest(JSON.stringify(identity)),
          reusable: false,
          inputProofComplete: false,
          failureHistoryRequired: requiresFailureHistory(task),
          reason: `Evidence unavailable: ${error.message}`,
        };
      }
    };
    const probeStarted = performance.now();
    const candidateBefore = captureSource(root);
    const candidate = Object.fromEntries(
      ['digest', 'baseline', 'mergeBase'].map((field) => [field, candidateBefore[field]]),
    );
    const before = snapshot();
    const beforeArtifacts = artifacts(task);
    let probeMs = performance.now() - probeStarted;
    let record;
    try {
      record = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* Missing or damaged evidence is a cache miss. */
    }
    let attempts = [];
    let historyError = null;
    try {
      // Preserve pre-ledger records before replacing the latest-result index.
      if (record && !record.attemptId && record.fingerprint && record.startedAt) {
        const legacy = { ...record, attemptId: randomUUID() };
        appendAttempt(attemptsDirectory, legacy, true);
        if (legacy.completedAt && Number.isInteger(legacy.exitCode)) appendAttempt(attemptsDirectory, legacy);
      }
      attempts = verificationAttempts(attemptsDirectory);
      if (record?.attemptId && !attempts.some((attempt) => attempt.attemptId === record.attemptId))
        throw new Error('Latest verification result has no immutable attempt history');
    } catch (error) {
      historyError = `Verification attempt history unavailable: ${error.message}`;
    }
    const failures = attempts.filter((attempt) => attempt.exitCode !== 0);
    const firstFailure = failures.find(
      (attempt) =>
        attempt.fingerprint === before.fingerprint ||
        ((attempt.inputProofComplete === false || before.inputProofComplete === false) &&
          (!attempt.candidate ||
            ['digest', 'baseline', 'mergeBase'].some((field) => !attempt.candidate[field]) ||
            ['digest', 'baseline', 'mergeBase'].every((field) => attempt.candidate[field] === candidate[field]))),
    );
    const previousFailure =
      firstFailure ?? failures.find((attempt) => attempt.fingerprint === failures.at(-1)?.fingerprint);
    const runtimeCheck = task.kind === 'runtime';
    const failureHistoryRequired = before.failureHistoryRequired ?? requiresFailureHistory(task);
    const retryError =
      firstFailure && failureHistoryRequired
        ? `Attempt ${firstFailure.attemptId} already failed for these inputs; repair relevant source or environment inputs before validation can pass`
        : null;
    if (retryError && !historyError && before.inputProofComplete !== false && !options.force && !task.force) {
      // A policy-disabled cache is not a request to repeat an already failed test run.
      // --force / --no-reuse may collect diagnostics, but cannot clear retryError below.
      const blocked = {
        ...firstFailure,
        status: 'blocked',
        exitCode: 1,
        commandExitCode: null,
        executed: false,
        blockedAt: new Date().toISOString(),
        firstFailure: failureReference(firstFailure),
        retryBasis: 'same-inputs',
        reason: retryError,
      };
      save(file, blocked);
      report(`[blocked] ${name}: ${retryError}; first failure log: ${firstFailure.log ?? 'unavailable'}`);
      return { exitCode: 1, reused: false, evidence: file, reason: retryError, status: 'blocked', executed: false };
    }
    const reuse = !options.force && !task.force && task.reuse !== false && !env.CI;
    if (!historyError && !retryError && reuse && canReuse(record, before, beforeArtifacts, root)) {
      const candidateAfter = captureSource(root);
      if (
        ['digest', 'baseline', 'mergeBase', 'mutationStamp'].some(
          (field) => candidateBefore[field] !== candidateAfter[field],
        )
      )
        throw new Error('Candidate changed while reusing evidence');
      report(`[reused] ${name} (${Math.round(record.elapsedMs / 1000)}s previously; ${record.log})`);
      return { exitCode: 0, reused: true, evidence: file };
    }
    const missReason = reuse ? evidenceMissReason(record, before, beforeArtifacts) : null;
    const log = path.join('.task-verification', 'logs', `${Date.now()}-${randomUUID()}.log`);
    const absoluteLog = path.join(root, log);
    record = {
      version: EVIDENCE_VERSION,
      attemptId: randomUUID(),
      previousAttemptId: record?.attemptId ?? null,
      firstFailure: failureReference(previousFailure),
      retryBasis: previousFailure
        ? runtimeCheck
          ? 'runtime-recheck'
          : !failureHistoryRequired
            ? 'fresh-check'
            : firstFailure
              ? 'same-inputs'
              : 'inputs-changed'
        : 'first-attempt',
      name,
      status: 'running',
      startedAt,
      completedAt: null,
      exitCode: null,
      elapsedMs: null,
      log,
      identity: before.identity,
      candidate,
      inputProofComplete: before.inputProofComplete !== false,
      failureHistoryRequired,
      fingerprint: before.fingerprint,
      source: before.source,
      artifacts: null,
      executed: true,
    };
    attemptRecord = record;
    try {
      appendAttempt(attemptsDirectory, record, true);
    } catch (error) {
      // Still run the command, but a run without durable history cannot satisfy the gate.
      historyError = `Cannot retain verification attempt: ${error.message}`;
    }
    save(file, record);
    report(`[run] ${name}${missReason || before.reason ? `; ${missReason ?? before.reason}` : ''}`);
    const stream = createWriteStream(absoluteLog);
    let logError;
    stream.on('error', (error) => {
      logError = error;
    });
    const commandStarted = performance.now();
    const previousReports = task.kind === 'backend' && args.includes('backend:test') ? backendReportState(root) : {};
    const relatedRunId = args.includes('test:related') ? randomUUID() : null;
    const relatedResult = relatedRunId ? path.join(directory, `related-${relatedRunId}.json`) : null;
    const childEnv = relatedRunId
      ? { ...env, FRONTEND_TEST_RUN_ID: relatedRunId, FRONTEND_TEST_RESULT_PATH: relatedResult }
      : env;
    let tail = '';
    const append = (chunk) => {
      stream.write(chunk);
      tail = `${tail}${chunk}`.slice(-6000);
    };
    const exitCode = await new Promise((resolve) => {
      const child = spawn(command, args, { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.on('error', (error) => append(`${error.message}\n`));
      child.on('close', (code) => resolve(code ?? 1));
    });
    await new Promise((resolve) => stream.end(resolve));
    if (logError) throw logError;
    const commandMs = performance.now() - commandStarted;
    const afterProbeStarted = performance.now();
    let reportResult = null;
    let reportError = null;
    if (exitCode === 0 && relatedRunId) {
      try {
        const result = JSON.parse(readFileSync(relatedResult, 'utf8'));
        reportResult = {
          ...validateFrontendTestReport(result, { kind: 'related', runId: relatedRunId }),
          selection: result.selection,
        };
      } catch (error) {
        reportError = error.message;
      }
    }
    if (exitCode === 0 && task.kind === 'backend' && args.includes('backend:test')) {
      try {
        reportResult = validateBackendReports(root, {
          startedAt,
          previousReports,
          selector: args.find((arg) => arg.startsWith('-Dtest='))?.slice(7),
        });
      } catch (error) {
        reportError = error.message;
      }
    }
    const after = snapshot();
    const candidateAfter = captureSource(root);
    const afterArtifacts = artifacts(task);
    probeMs += performance.now() - afterProbeStarted;
    const sourceUnchanged =
      ['digest', 'baseline', 'mergeBase', 'mutationStamp'].every(
        (field) => candidateBefore[field] === candidateAfter[field],
      ) &&
      JSON.stringify(before.identity.source) === JSON.stringify(after.identity.source) &&
      before.source.mutationStamp === after.source.mutationStamp;
    const unchanged = before.fingerprint === after.fingerprint;
    const finalCode = sourceUnchanged && !reportError && !historyError && !retryError ? exitCode : 1;
    const notApplicable = finalCode === 0 && reportResult?.status === 'not-applicable';
    record = {
      ...record,
      status:
        finalCode !== 0
          ? 'failed'
          : notApplicable
            ? 'not-applicable'
            : unchanged && before.reusable && after.reusable
              ? 'passed'
              : 'not-reusable',
      completedAt: new Date().toISOString(),
      exitCode: finalCode,
      commandExitCode: exitCode,
      elapsedMs: Math.round(performance.now() - start),
      artifacts: afterArtifacts,
      tests: reportResult,
      commandMs: Math.round(commandMs),
      probeMs: Math.round(probeMs),
      logDigest: digest(readFileSync(absoluteLog)),
      afterFingerprint: after.fingerprint,
      reason:
        historyError ??
        retryError ??
        reportError ??
        (notApplicable ? reportResult.reason : null) ??
        (!sourceUnchanged
          ? 'Source or baseline changed during validation'
          : !unchanged
            ? 'Environment changed during validation'
            : after.reason),
    };
    attemptRecord = record;
    save(file, record);
    appendAttempt(attemptsDirectory, record);
    completionWritten = true;
    report(
      `[${finalCode === 0 ? (notApplicable ? 'not-applicable' : 'passed') : 'failed'}] ${name} ${(record.elapsedMs / 1000).toFixed(1)}s (command ${(commandMs / 1000).toFixed(1)}s, evidence ${(probeMs / 1000).toFixed(1)}s); log: ${log}${record.reason ? `; ${record.reason}` : ''}`,
    );
    if (finalCode !== 0 && tail) report(tail);
    return { exitCode: finalCode, reused: false, evidence: file, reason: record.reason, status: record.status };
  } catch (error) {
    // Never allow a previous success to survive a failed identity capture or interrupted attempt.
    const failed = {
      ...attemptRecord,
      version: EVIDENCE_VERSION,
      name,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: 1,
      reason: error.message,
    };
    save(file, failed);
    if (attemptRecord && !completionWritten) {
      try {
        appendAttempt(attemptsDirectory, failed);
      } catch {
        // The immutable start remains incomplete and blocks any same-input retry.
      }
    }
    report(`[failed] ${name}: ${error.message}`);
    return { exitCode: 1, reused: false };
  } finally {
    rmSync(lock, { recursive: true });
  }
}
