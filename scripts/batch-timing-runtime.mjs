import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { existsSync, readFileSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import { readActiveBatch } from './task-batch.mjs';
import {
  bindBatchTiming,
  readTimeline,
  refreshTimeline,
  ensureObserver,
  timingDirectory,
  recordValidationTiming,
  recordValidationInterruptions,
  timingRequiredFile,
  readTimingSummary as readTimingSummaryFor,
} from './batch-timing-store.mjs';
import { assertTimingReady, interruptedValidationIds } from './batch-timing-core.mjs';

export function timingCommon(root) {
  const value = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  assert.equal(value.status, 0, 'Batch timing repository unavailable');
  return path.resolve(root, value.stdout.trim());
}
const belongsToBatch = (root, batch) => realpathSync(root) === realpathSync(batch.worktree);

// Observation is optional; strict binding and authorization checks remain separate.
export function observeCurrentTiming(root, options = {}, report = console.error) {
  try {
    return refreshCurrentTiming(root, options);
  } catch (error) {
    try {
      report('Batch timing observation unavailable: ' + error.message);
    } catch {
      /* Observation reporting cannot block quality checks. */
    }
    return { status: 'unavailable', reason: error.message };
  }
}

export function refreshCurrentTiming(root, { env = process.env, bind = false, resume = false } = {}) {
  if (env.CI || env.GITHUB_ACTIONS === 'true') return { status: 'not-required' };
  const batch = readActiveBatch(root);
  if (!batch) return { status: 'no-active-batch' };
  if (!belongsToBatch(root, batch)) return { status: 'outside-active-batch' };
  if (bind) return bindBatchTiming(root, batch, { env, resume });
  const common = batch.repository.commonDir,
    state = readTimeline(common, batch.id);
  if (!state)
    return {
      status: 'legacy-no-batch-timing',
      reason: 'No authorization boundary was captured; do not claim whole-task timing.',
    };
  if (env.CODEX_THREAD_ID)
    assert.ok(
      state.sources.some((s) => s.thread === env.CODEX_THREAD_ID),
      'Timing thread not bound; explicitly resume the batch first',
    );
  const result = refreshTimeline(common, batch.id);
  ensureObserver(timingDirectory(common, batch.id));
  return {
    ...result,
    status: result.summary.status,
    file: path.join(timingDirectory(common, batch.id), 'summary.json'),
  };
}
export function requireBatchTiming(common, batch, { now = Date.now(), legacyAllowed = true } = {}) {
  const state = readTimeline(common, batch);
  if (!state) {
    assert.ok(legacyAllowed && !existsSync(timingRequiredFile(common, batch)), 'New batch timing proof missing');
    return { status: 'legacy-no-batch-timing', wallMs: null };
  }
  const marker = timingRequiredFile(common, batch);
  if (existsSync(marker)) {
    const proof = JSON.parse(readFileSync(marker));
    assert.equal(proof.batch, batch);
    assert.equal(proof.authorizedAt, state.authorizedAt, 'Authorization boundary changed');
    assert.equal(proof.requestId, state.requestId, 'Authorization identity changed');
  }
  const result = refreshTimeline(common, batch, { now });
  const summary = assertTimingReady(result.state, { now, completion: result.completion });
  return summary;
}

export function observeValidationTiming(root, attempt, env = process.env) {
  if (env.CI || env.GITHUB_ACTIONS === 'true') return;
  try {
    const batch = readActiveBatch(root);
    if (batch && belongsToBatch(root, batch) && readTimeline(batch.repository.commonDir, batch.id))
      recordValidationTiming(batch.repository.commonDir, batch.id, attempt);
  } catch (error) {
    console.error('Batch validation timing unavailable: ' + error.message);
  }
}

export function currentTimingSummary(root) {
  const batch = readActiveBatch(root);
  if (!batch || !belongsToBatch(root, batch)) return null;
  return readTimingSummaryFor(batch.repository.commonDir, batch.id);
}

const timingDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function inspectValidationProcesses(root) {
  assert.notEqual(process.platform, 'win32', 'Validation interruption proof requires POSIX process inspection');
  root = realpathSync(root);
  const query = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, 'Process inspection unavailable; retain pending validation');
    assert.equal(result.stderr.trim(), '', 'Incomplete process inspection');
    return result;
  };
  const ps = query('ps', ['-A', '-o', 'pid=,ppid=']);
  const parents = new Map(
    ps.stdout
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/).map(Number)),
  );
  const excluded = new Set([ps.pid]);
  let ancestor = process.pid;
  while (ancestor && !excluded.has(ancestor)) {
    excluded.add(ancestor);
    assert.ok(parents.has(ancestor), 'Caller ancestry is incomplete');
    ancestor = parents.get(ancestor);
  }
  const files = query('lsof', ['-n', '-P', '-a', '-u', String(os.userInfo().uid), '-d', 'cwd', '-Fpn']);
  excluded.add(files.pid);
  let pid = null;
  const active = [];
  for (const line of files.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (!line.startsWith('n') || excluded.has(pid)) continue;
    const directory = line.slice(1);
    if (!directory.startsWith('/')) continue;
    const canonical = existsSync(directory) ? realpathSync(directory) : directory;
    if (canonical === root || canonical.startsWith(root + path.sep)) active.push(pid);
  }
  assert.deepEqual([...new Set(active)], [], 'Task processes remain active; retain pending validation');
  // Only a digest is retained, never process arguments or other applications' paths.
  return timingDigest(
    JSON.stringify({ checkedAt: Date.now(), caller: process.pid, processCount: parents.size, active }),
  );
}
export function reconcileInterruptedValidationTiming(common, batch, { root, completion, key, now = Date.now() }) {
  const state = readTimeline(common, batch);
  if (!state) return { interrupted: 0 };
  const resolved = interruptedValidationIds(state);
  const pending = (state.validations ?? []).filter((v) => v.finishedAt == null && !resolved.has(v.id));
  if (!pending.length) return { interrupted: 0 };
  assert.ok(state.roots.includes(root), 'Foreign validation worktree');
  const succeeded = (name) =>
    completion.events.findLast((e) => e.name === name && e.key === key && e.status === 'success');
  const ci = succeeded('ci'),
    evidence = succeeded('evidence'),
    handoff = succeeded('handoff'),
    preservation = succeeded('preserve');
  assert.ok(ci && evidence && handoff && preservation, 'Complete gates, handoff and preservation required');
  assert.equal(key, ci.result.headSha + ':' + ci.result.runId);
  assert.equal(ci.result.branch, 'main');
  assert.equal(ci.result.attempt, 1);
  assert.equal(ci.result.conclusion, 'success');
  for (const name of ['Frontend quality', 'Backend quality'])
    assert.equal(
      ci.result.jobs.filter((j) => j.name === name && j.status === 'completed' && j.conclusion === 'success').length,
      1,
    );
  assert.ok(ci.result.jobs.every((j) => j.status === 'completed' && ['success', 'skipped'].includes(j.conclusion)));
  assert.equal(evidence.result.head, ci.result.headSha);
  assert.equal(String(evidence.result.runId), String(ci.result.runId));
  assert.ok(evidence.result.coverage.frontend > 0 && evidence.result.coverage.backend.tests > 0);
  assert.ok(handoff.result.runtimeHealthy && handoff.result.integrationHealthy && handoff.result.backupRetained);
  const gateStart = ci.startedAt;
  assert.ok(Number.isFinite(gateStart) && ci.finishedAt <= now);
  assert.ok(
    pending.every((v) => v.startedAt < gateStart),
    'A newer validation is still pending',
  );
  const manifestFile = preservation.result.manifest;
  assert.equal(path.dirname(manifestFile), path.join(common, 'task-assets', batch));
  assert.ok(!lstatSync(manifestFile).isSymbolicLink());
  const manifestBytes = readFileSync(manifestFile),
    preservationDigest = timingDigest(manifestBytes);
  assert.equal(path.basename(manifestFile), 'assets-' + preservationDigest + '.json');
  const assets = JSON.parse(manifestBytes);
  inspectValidationProcesses(root);
  const interruptions = pending.map((v) => {
    const directory = path.join(root, '.task-verification/attempts');
    const sources = readdirSync(directory, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[a-f0-9]{64}$/.test(e.name))
      .map((e) => path.join(directory, e.name, v.id + '.started.json'))
      .filter(existsSync);
    assert.equal(sources.length, 1, 'Unique raw validation start required');
    const source = sources[0];
    assert.ok(!lstatSync(source).isSymbolicLink());
    assert.equal(
      existsSync(source.replace('.started.json', '.json')),
      false,
      'Completion exists; reconcile its real result instead',
    );
    const bytes = readFileSync(source),
      original = JSON.parse(bytes),
      attemptDigest = timingDigest(bytes);
    assert.equal(original.attemptId, v.id);
    assert.equal(Date.parse(original.startedAt), v.startedAt);
    assert.equal(original.status, 'running');
    const asset = assets.find((a) => a.file === path.relative(root, source));
    assert.equal(asset?.digest, attemptDigest, 'Raw attempt is not preserved');
    const blob = path.join(path.dirname(manifestFile), 'blobs', attemptDigest);
    assert.ok(!lstatSync(blob).isSymbolicLink());
    assert.equal(timingDigest(readFileSync(blob)), attemptDigest);
    return {
      id: v.id,
      startedAt: v.startedAt,
      status: 'interrupted',
      finishedAt: null,
      durationMs: null,
      confirmedInactiveAt: now,
      gateKey: key,
      attemptDigest,
      preservationDigest,
    };
  });
  const processInspectionDigest = inspectValidationProcesses(root);
  recordValidationInterruptions(
    common,
    batch,
    interruptions.map((v) => ({ ...v, processInspectionDigest })),
  );
  return { interrupted: interruptions.length, durationMs: null };
}
