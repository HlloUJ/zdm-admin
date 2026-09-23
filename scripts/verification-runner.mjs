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
} from './verification-evidence.mjs';
import { backendReportState, validateBackendReports } from './backend-test-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';

function save(file, record) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, file);
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
  const lock = path.join(directory, `${task.kind === 'backend' ? 'backend-artifacts' : key}.lock`);
  try {
    mkdirSync(lock);
  } catch {
    report(`[blocked] ${name}: another run owns ${lock}; inspect it before retrying`);
    return { exitCode: 1, reused: false };
  }
  const startedAt = new Date().toISOString();
  const start = performance.now();
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
          reason: `Evidence unavailable: ${error.message}`,
        };
      }
    };
    const probeStarted = performance.now();
    const candidateBefore = captureSource(root);
    const before = snapshot();
    const beforeArtifacts = artifacts(task);
    let probeMs = performance.now() - probeStarted;
    let record;
    try {
      record = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* Missing or damaged evidence is a cache miss. */
    }
    const reuse = !options.force && !task.force && task.reuse !== false && !env.CI;
    if (reuse && canReuse(record, before, beforeArtifacts, root)) {
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
      name,
      status: 'running',
      startedAt,
      completedAt: null,
      exitCode: null,
      elapsedMs: null,
      log,
      identity: before.identity,
      fingerprint: before.fingerprint,
      source: before.source,
      artifacts: null,
    };
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
    const finalCode = sourceUnchanged && !reportError ? exitCode : 1;
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
        reportError ??
        (notApplicable ? reportResult.reason : null) ??
        (!sourceUnchanged
          ? 'Source or baseline changed during validation'
          : !unchanged
            ? 'Environment changed during validation'
            : after.reason),
    };
    save(file, record);
    report(
      `[${finalCode === 0 ? (notApplicable ? 'not-applicable' : 'passed') : 'failed'}] ${name} ${(record.elapsedMs / 1000).toFixed(1)}s (command ${(commandMs / 1000).toFixed(1)}s, evidence ${(probeMs / 1000).toFixed(1)}s); log: ${log}${record.reason ? `; ${record.reason}` : ''}`,
    );
    if (finalCode !== 0 && tail) report(tail);
    return { exitCode: finalCode, reused: false, evidence: file, reason: record.reason, status: record.status };
  } catch (error) {
    // Never allow a previous success to survive a failed identity capture or interrupted attempt.
    save(file, {
      version: EVIDENCE_VERSION,
      name,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: 1,
      reason: error.message,
    });
    report(`[failed] ${name}: ${error.message}`);
    return { exitCode: 1, reused: false };
  } finally {
    rmSync(lock, { recursive: true });
  }
}
