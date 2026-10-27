import { completionDirectory, processScope } from './completion-process.mjs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function openCompletion(directory, batch, { now = Date.now(), requestedAt, formal = true } = {}) {
  assert.match(batch, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  for (const p of [directory, path.join(directory, 'completion-session.json')])
    assert.ok(!existsSync(p) || !lstatSync(p).isSymbolicLink(), 'Linked completion state');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.equal(lstatSync(directory).mode & 0o077, 0, 'Completion state must be owner-only');
  const file = path.join(directory, 'completion-session.json');
  if (existsSync(file)) {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(state.version, 1);
    assert.equal(state.batch, batch);
    if (formal && state.startedAt === null) {
      const start = requestedAt ? Date.parse(requestedAt) : now;
      assert.ok(Number.isFinite(start) && start <= now);
      state.startedAt = start;
      state.clockSource = requestedAt ? 'request-timestamp' : 'first-completion-command';
      saveCompletion(directory, state);
    }
    Object.defineProperty(state, completionDirectory, { value: directory });
    return state;
  }
  const startedAt = requestedAt ? Date.parse(requestedAt) : now;
  assert.ok(Number.isFinite(startedAt) && startedAt <= now, 'Invalid completion start');
  const state = {
    version: 1,
    batch,
    recordingStartedAt: now,
    startedAt: formal ? startedAt : null,
    clockSource: !formal ? 'not-started' : requestedAt ? 'request-timestamp' : 'first-completion-command',
    events: [],
    repairs: [],
    pauses: [],
    pauseTrackingSince: now,
  };
  saveCompletion(directory, state);
  Object.defineProperty(state, completionDirectory, { value: directory });
  return state;
}
export function saveCompletion(directory, state) {
  const file = path.join(directory, 'completion-session.json'),
    lock = file + '.lock';
  assert.ok(!existsSync(file) || !lstatSync(file).isSymbolicLink(), 'Linked completion state');
  let held = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname() }), { flag: 'wx', mode: 0o600 });
      held = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  assert.ok(held, 'Completion state writer busy; retain lock and retry, never seize it');
  try {
    if (existsSync(file)) {
      const disk = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(disk.batch, state.batch);
      assert.equal(disk.version, state.version);
      const merge = (old, incoming, key) => {
        const map = new Map(old.map((e) => [key(e), e]));
        for (const e of incoming) {
          const prior = map.get(key(e));
          if (prior?.finishedAt && e.finishedAt)
            assert.equal(e.status, prior.status, 'Completed event status is immutable');
          if (prior?.finishedAt && (!e.finishedAt || prior.finishedAt > e.finishedAt)) continue;
          map.set(key(e), e);
        }
        return [...map.values()];
      };
      state.events = merge(disk.events, state.events, (e) => e.id ?? `${e.name}:${e.key}:${e.startedAt}`);
      state.repairs = merge(disk.repairs, state.repairs, (r) => r.id);
      state.pauses = merge(disk.pauses ?? [], state.pauses ?? [], (p) => p.id);
      state.pauseTrackingSince = disk.pauseTrackingSince ?? state.pauseTrackingSince;
      if (disk.startedAt !== null) {
        if (state.startedAt !== null) assert.equal(state.startedAt, disk.startedAt, 'Completion start cannot be reset');
        state.startedAt = disk.startedAt;
        state.clockSource = disk.clockSource;
      }
      state.previewFingerprint ??= disk.previewFingerprint;
      if (
        !state.integrationPush ||
        (disk.integrationPush?.localHead === state.integrationPush.localHead && disk.integrationPush.status === 'done')
      )
        state.integrationPush = disk.integrationPush ?? state.integrationPush;
      state.closedAt ??= disk.closedAt;
    }
    const pending = file + '.' + randomUUID() + '.tmp';
    writeFileSync(pending, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(pending, file);
  } finally {
    unlinkSync(lock);
  }
}

export async function completionStage(state, name, key, run, { now = Date.now, save = () => {}, reuse } = {}) {
  assert.ok(
    [
      'ci',
      'evidence',
      'handoff',
      'preserve',
      'cleanup',
      'close',
      'prepare',
      'review',
      'repair',
      'push',
      'pr',
      'merge',
      'sync',
      'recovery',
      'discovery',
    ].includes(name),
    'Unknown completion stage',
  );
  assert.ok(typeof key === 'string' && key.length > 0);
  const prior = [...state.events].reverse().find((e) => e.name === name && e.key === key && e.status === 'success');
  if (prior && reuse && (await reuse(prior.result))) {
    return { result: prior.result, reused: true };
  }
  const event = {
    id: randomUUID(),
    name,
    key,
    startedAt: now(),
    status: 'running',
    processTracking: 1,
    processes: [],
    owner: { host: os.hostname(), pid: process.pid },
  };
  state.events.push(event);
  save(state);
  try {
    const result = await processScope(state, event, save, run);
    event.result = result;
    event.status = 'success';
    return { result, reused: false };
  } catch (error) {
    event.status = 'failure';
    event.failure = {
      category: error.ciFailure ? 'ci-failed-unclassified' : 'stage-failure',
      ...(error.ciFailure ? { ci: error.ciFailure } : {}),
      ...(error.networkObservations ? { networkObservations: error.networkObservations } : {}),
    };
    throw error;
  } finally {
    event.finishedAt = now();
    assert.ok(event.finishedAt >= event.startedAt, 'Clock moved backwards');
    save(state);
  }
}
export function recordRepair(state, { id, failureRun, evidence, category, kind = 'unclassified', now = Date.now() }) {
  assert.ok(state.startedAt !== null, 'Begin formal completion before recording repair');
  assert.match(id, /^[a-z0-9-]+$/);
  assert.ok(
    ['test', 'equivalence', 'upload', 'environment', 'transport', 'other-verified', 'stage-restoration'].includes(
      category,
    ),
  );
  const failure = state.events.find(
    (e) =>
      e.status === 'failure' && (failureRun === 'stage:' + e.id || String(e.failure?.ci?.runId) === String(failureRun)),
  );
  assert.ok(failure, 'Repair requires a recorded real failure');
  assert.ok(
    evidence && existsSync(evidence) && lstatSync(evidence).isFile() && !lstatSync(evidence).isSymbolicLink(),
    'Missing diagnostic evidence',
  );
  assert.ok(['code', 'environment', 'transport', 'unclassified'].includes(kind), 'Unknown repair work kind');
  assert.ok(!state.repairs.some((r) => r.id === id), 'Repair already recorded');
  state.repairs.push({
    id,
    failureRun: String(failureRun),
    failureHead: failure.failure?.ci?.headSha ?? null,
    failureEventId: failure.id,
    failureName: failure.name,
    failureKey: failure.key,
    isCiFailure: Boolean(failure.failure?.ci),
    category,
    kind,
    evidence,
    evidenceDigest: createHash('sha256').update(readFileSync(evidence)).digest('hex'),
    startedAt: now,
  });
}
export function finishRepair(state, id, { now = Date.now() } = {}) {
  const repair = state.repairs.find((r) => r.id === id);
  assert.ok(repair && !repair.finishedAt, 'Unknown or finished repair');
  assert.ok(
    state.events.some(
      (e) =>
        (repair.isCiFailure === false
          ? e.name === repair.failureName && e.key === repair.failureKey
          : e.name === 'ci') &&
        e.status === 'success' &&
        e.startedAt >= repair.startedAt &&
        (repair.isCiFailure === false ||
          (e.result?.headSha !== repair.failureHead && e.result?.eventName === 'push' && e.result?.branch === 'main')),
    ),
    'Repair needs successful re-verification of the failed stage or new-candidate main CI',
  );
  assert.equal(
    createHash('sha256').update(readFileSync(repair.evidence)).digest('hex'),
    repair.evidenceDigest,
    'Diagnostic evidence changed',
  );
  repair.finishedAt = now;
}
function union(intervals) {
  let total = 0,
    end = -Infinity;
  for (const [a, b] of intervals.sort((x, y) => x[0] - y[0])) {
    assert.ok(b >= a);
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return total;
}
export function completionSummary(state, now = Date.now()) {
  if (state.startedAt === null)
    return { batch: state.batch, status: 'not-started', recordedEvents: state.events.length };
  const clip = (pairs) =>
    pairs
      .map(([a, b]) => [Math.max(a, state.startedAt), Math.min(b, state.closedAt ?? now)])
      .filter(([a, b]) => b >= a);
  const end = state.closedAt ?? now,
    intervals = state.events.map((e) => [e.startedAt, e.finishedAt ?? end]);
  const wallMs = end - state.startedAt;
  assert.ok(wallMs >= 0);
  const measuredMs = union(clip(intervals)),
    ci = state.events.filter((e) => e.name === 'ci' && e.status === 'success').at(-1);
  const windows = (records) => clip(records.map((r) => [r.startedAt, r.finishedAt ?? end]));
  const ciWindows = windows(state.events.filter((e) => e.name === 'ci'));
  const pauseWindows = windows(state.pauses ?? []);
  const completePauseHistory = Number.isFinite(state.pauseTrackingSince) && state.pauseTrackingSince <= state.startedAt;
  const restorations = state.repairs.filter((r) => r.category === 'stage-restoration');
  const remediation = state.repairs.filter((r) => r.category !== 'stage-restoration');
  const blocked = [...ciWindows, ...pauseWindows];
  const active = (records) => intervalDifference(windows(records), blocked);
  const repairMs = active(remediation);
  return {
    batch: state.batch,
    startedAt: new Date(state.startedAt).toISOString(),
    finishedAt: new Date(end).toISOString(),
    clockSource: state.clockSource,
    wallMs,
    measuredStageMs: measuredMs,
    unattributedMs: Math.max(0, wallMs - measuredMs),
    postFinalCiMs: ci
      ? Math.max(
          0,
          end -
            Math.max(
              Number.isFinite(Date.parse(ci.result?.gatesFinishedAt))
                ? Date.parse(ci.result.gatesFinishedAt)
                : ci.finishedAt,
              state.startedAt,
            ),
        )
      : null,
    ciCompletionSource: ci?.result?.gatesFinishedAt ? 'github-job-completed-at' : 'observed-wait-end',
    ciWaitMs: union(clip(state.events.filter((e) => e.name === 'ci').map((e) => [e.startedAt, e.finishedAt ?? end]))),
    ciJobWindowMs: union(
      clip(
        state.events
          .filter((e) => e.name === 'ci' && e.result?.jobs)
          .flatMap((e) =>
            e.result.jobs
              .filter((j) => j.started_at && j.completed_at)
              .map((j) => [Date.parse(j.started_at), Date.parse(j.completed_at)])
              .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a),
          ),
      ),
    ),
    timingVersion: 2,
    repairMs,
    repairWindowMs: union(windows(remediation)),
    codeRepairMs: active(remediation.filter((r) => r.kind === 'code')),
    environmentRepairMs: active(remediation.filter((r) => ['environment', 'transport'].includes(r.kind))),
    unclassifiedRepairMs: active(remediation.filter((r) => !r.kind || r.kind === 'unclassified')),
    restorationWindowMs: union(windows(restorations)),
    recoveryMs: active(restorations),
    pauseMs: completePauseHistory ? union(pauseWindows) : null,
    recordedPauseMs: union(pauseWindows),
    pauseTiming: completePauseHistory ? 'recorded-request-resume' : 'incomplete-history-no-estimated-subtraction',
    activeCiWaitMs: completePauseHistory ? intervalDifference(ciWindows, pauseWindows) : null,
    waitTiming: state.events.some((e) => e.name === 'ci' && e.durationBasis?.includes('unknown'))
      ? 'includes-unknown-interruption-upper-bound'
      : 'observed-wait-windows',
    pauses: (state.pauses ?? []).map((p) => ({ ...p, durationMs: (p.finishedAt ?? end) - p.startedAt })),
    unrecordedFailedRuns: state.events
      .filter((e) => e.failure?.ci && !state.repairs.some((r) => r.failureRun === String(e.failure.ci.runId)))
      .map((e) => e.failure.ci.runId),
    gaps: completionGaps(state, end),
    networkObservations: state.events.flatMap(
      (e) => e.result?.networkObservations ?? e.failure?.networkObservations ?? [],
    ),
    unrecordedFailedStages: state.events
      .filter((e) => e.status === 'failure' && !e.failure?.ci && !state.repairs.some((r) => r.failureEventId === e.id))
      .map((e) => ({ id: e.id, name: e.name, key: e.key })),
    repairs: state.repairs.map((r) => ({ ...r, durationMs: (r.finishedAt ?? end) - r.startedAt })),
    repairCounts: {
      code: remediation.filter((r) => r.kind === 'code').length,
      unclassified: remediation.filter((r) => !r.kind || r.kind === 'unclassified').length,
      restorations: restorations.length,
    },
    failureCounts: {
      ci: state.events.filter((e) => e.failure?.ci).length,
      interruptions: state.events.filter((e) => e.failure?.category === 'interrupted').length,
      otherStages: state.events.filter(
        (e) => e.status === 'failure' && !e.failure?.ci && e.failure?.category !== 'interrupted',
      ).length,
    },
    failedStages: state.events
      .filter((e) => e.status === 'failure')
      .map((e) => ({ name: e.name, key: e.key, failure: e.failure })),
    overlapPolicy:
      'Union intervals; pause/recovery/repair windows may overlap remote CI. Active repair and recovery exclude recorded CI wait and pause. Never add categories to wall time.',
    stages: state.events.map((e) => ({
      id: e.id,
      name: e.name,
      key: e.key,
      status: e.status,
      durationBasis: e.durationBasis ?? 'observed-stage-interval',
      durationMs: (e.finishedAt ?? end) - e.startedAt,
    })),
  };
}
// Ordered post-CI stages: no destructive callback can run after missing/failed evidence.
export async function settleCompletion(state, identity, stages, options = {}) {
  const results = {};
  for (const name of ['evidence', 'handoff', 'preserve', 'cleanup', 'close']) {
    const stage = stages[name];
    assert.ok(typeof stage?.run === 'function', 'Missing stage ' + name);
    results[name] = await completionStage(state, name, identity, stage.run, { ...options, reuse: stage.reuse });
  }
  state.closedAt = (options.now ?? Date.now)();
  options.save?.(state);
  return { results, summary: completionSummary(state, state.closedAt) };
}

export function completionGaps(state, end) {
  let cursor = state.startedAt,
    previous = null;
  const gaps = [];
  for (const e of [...state.events].sort((a, b) => a.startedAt - b.startedAt)) {
    const start = Math.max(state.startedAt, e.startedAt),
      stop = Math.min(end, e.finishedAt ?? end);
    if (start > end || stop < cursor) continue;
    if (start > cursor)
      gaps.push({ startedAt: cursor, finishedAt: start, durationMs: start - cursor, previous, next: e.name });
    if (stop >= cursor) {
      cursor = stop;
      previous = e.name;
    }
  }
  if (cursor < end) gaps.push({ startedAt: cursor, finishedAt: end, durationMs: end - cursor, previous, next: null });
  return gaps;
}

export function intervalDifference(intervals, blocked) {
  const ranges = [...new Set(intervals.flatMap(([a, b]) => [a, b]).concat(blocked.flatMap(([a, b]) => [a, b])))].sort(
    (a, b) => a - b,
  );
  let total = 0;
  for (let i = 1; i < ranges.length; i++) {
    const a = ranges[i - 1],
      b = ranges[i];
    if (intervals.some(([x, y]) => x <= a && y >= b) && !blocked.some(([x, y]) => x <= a && y >= b)) total += b - a;
  }
  return total;
}
export function pauseCompletion(state, { now = Date.now() } = {}) {
  assert.equal(state.closedAt, undefined, 'Closed delivery cannot be paused');
  assert.ok(state.startedAt !== null && now >= state.startedAt, 'Formal delivery must be started');
  const prior = (state.pauses ?? []).find((p) => p.finishedAt == null);
  if (prior) return prior;
  state.pauseTrackingSince ??= now;
  const pause = {
    id: randomUUID(),
    startedAt: now,
    status: 'paused',
    reason: 'user-request',
    stageIds: state.events.filter((e) => e.status === 'running').map((e) => e.id),
  };
  (state.pauses ??= []).push(pause);
  return pause;
}
export function resumeCompletion(state, { now = Date.now() } = {}) {
  const pause = (state.pauses ?? []).find((p) => p.finishedAt == null);
  if (!pause) return null;
  assert.equal(state.closedAt, undefined, 'Closed delivery cannot resume');
  assert.ok(now >= pause.startedAt, 'Clock moved backwards');
  pause.finishedAt = now;
  pause.status = 'resumed';
  return pause;
}
export function completionPhase(state) {
  if (state.startedAt === null) return 'local-validation';
  if ((state.pauses ?? []).some((p) => p.finishedAt == null)) return 'paused';
  const main = [...state.events]
    .reverse()
    .find((e) => e.name === 'ci' && e.status === 'success' && e.result?.branch === 'main');
  const key = main?.key;
  const success = (name, k) => state.events.some((e) => e.name === name && e.key === k && e.status === 'success');
  if (
    state.closedAt &&
    key &&
    ['evidence', 'handoff', 'preserve', 'cleanup', 'close'].every((name) => success(name, key))
  )
    return 'delivered';
  const latest = [...state.events].reverse().find((e) => e.name === 'ci');
  if (latest?.status === 'failure' && latest.failure?.ci) return 'ci-failed';
  if (main) {
    if (success('handoff', key) || success('handoff', main.result.headSha + ':final'))
      return 'handoff-verified-awaiting-settlement';
    return 'main-verified-awaiting-handoff';
  }
  if (latest?.status === 'success') return 'pr-verified-awaiting-main';
  return 'delivery-in-progress';
}
