import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { duration, ranges, subtract } from './batch-timing-core.mjs';

const notify = (report, message) => {
  try {
    report(message);
  } catch {
    /* Observation must not change command outcome. */
  }
};
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const stamp = (v) => (typeof v === 'number' ? v : Date.parse(v));
function safe(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if (existsSync(p)) assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked timing path refused');
    if (p === path.dirname(p)) return;
  }
}
function read(file) {
  safe(file);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function directory(common, task) {
  assert.match(task, idPattern);
  const dir = path.join(common, 'task-timing-events', task);
  safe(dir);
  return dir;
}
// Independent immutable files avoid a global timing lock and never rewrite historical evidence.
export function writeTimingEvent(common, task, event) {
  const dir = directory(common, task);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const allowed = ['id', 'kind', 'phase', 'at', 'status', 'reason', 'source'];
  assert.ok(allowed.every((k) => k in event || ['status', 'reason'].includes(k)));
  assert.ok(['start', 'end', 'binding'].includes(event.kind));
  assert.ok(Number.isFinite(event.at));
  const record = {
    version: 1,
    task,
    ...Object.fromEntries(allowed.filter((k) => k in event).map((k) => [k, event[k]])),
  };
  const file = path.join(
    dir,
    createHash('sha256')
      .update(event.source + ':' + event.id + ':' + event.kind)
      .digest('hex') + '.json',
  );
  const bytes = JSON.stringify(record) + '\n';
  try {
    writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    safe(file);
    assert.equal(readFileSync(file, 'utf8'), bytes, 'Conflicting immutable timing event');
  }
  return record;
}
export function observeBinding(task, result, report = console.error) {
  try {
    writeTimingEvent(task.repository.commonDir, task.id, {
      id: randomUUID(),
      kind: 'binding',
      phase: 'native-binding',
      at: Date.now(),
      status: result.status ?? 'unknown',
      reason: result.reason ?? null,
      source: 'task-start',
    });
    if (['unavailable', 'not-required'].includes(result.status))
      notify(
        report,
        `Task timing ${task.id}: native whole-task coverage unavailable (${result.reason ?? result.status}); process observations remain partial.`,
      );
  } catch (e) {
    notify(report, 'Task timing binding observation unavailable: ' + e.message);
  }
}
export function observeValidation(task, attempt, report = console.error) {
  try {
    const event = {
      id: attempt.attemptId,
      kind: 'start',
      phase: 'validation',
      at: stamp(attempt.startedAt),
      source: 'verification-attempt',
    };
    writeTimingEvent(task.repository.commonDir, task.id, event);
    if (attempt.completedAt)
      writeTimingEvent(task.repository.commonDir, task.id, {
        ...event,
        kind: 'end',
        at: stamp(attempt.completedAt),
        status: attempt.status,
      });
  } catch (e) {
    notify(report, 'Task validation timing unavailable: ' + e.message);
  }
}
export const measuredPhases = [
  'development',
  'validation',
  'resource-wait',
  'approval-wait',
  'merge',
  'cleanup',
  'dependencies',
];
export function entryPhase(command, args) {
  if (command === 'measure') {
    assert.ok(measuredPhases.includes(args[0]), 'Unsupported measured phase');
    return args[0];
  }
  if (
    ['registry', 'check'].includes(command) ||
    args.some((v) => ['--list', '--help', 'status', 'plan', 'report'].includes(v))
  )
    return null;
  return (
    {
      start: 'workspace-and-dependencies',
      work: 'development-checkpoint',
      preview: 'preview',
      data: 'data-preparation',
      schedule: 'scheduler-command',
      complete: 'formal-delivery',
      combination: 'combination',
      temporary: 'preview',
    }[command] ?? null
  );
}
export function observeEntry(plan, registry, execute, { now = Date.now, report = console.error } = {}) {
  let event = null,
    task = null;
  try {
    const phase = entryPhase(plan.command, plan.originalArgs);
    if (phase) {
      const index = plan.originalArgs.indexOf('--slug');
      task =
        plan.command === 'start' && index >= 0
          ? plan.originalArgs[index + 1]
          : registry.resolve({ worktree: plan.cwd }).id;
      event = { id: randomUUID(), kind: 'start', phase, at: now(), source: 'published-task-entry' };
      writeTimingEvent(registry.commonDir, task, event);
    }
  } catch (e) {
    notify(report, 'Task process timing unavailable: ' + e.message);
  }
  let result;
  try {
    result = execute();
    return result;
  } finally {
    if (event && task)
      try {
        writeTimingEvent(registry.commonDir, task, {
          ...event,
          kind: 'end',
          at: now(),
          status: result?.status === 0 ? 'success' : 'failed',
        });
      } catch (e) {
        notify(report, 'Task process timing close unavailable: ' + e.message);
      }
  }
}
function overlapDuration(perTask) {
  const points = perTask
    .flatMap((list) =>
      ranges(list).flatMap(([a, b]) => [
        [a, 1],
        [b, -1],
      ]),
    )
    .sort((a, b) => a[0] - b[0]);
  let count = 0,
    last = 0,
    total = 0;
  for (const [at, change] of points) {
    if (count > 1) total += at - last;
    count += change;
    last = at;
  }
  return total;
}
export function summarizeProcessTiming(tasks, { now = Date.now() } = {}) {
  const rows = tasks.map(({ task, events = [], intervals = [], issues = [], native = null, milestones = {} }) => {
    const groups = new Map();
    for (const e of events.filter((e) => e.kind !== 'binding')) {
      assert.equal(e.task, task.id);
      const g = groups.get(e.id) ?? [];
      g.push(e);
      groups.set(e.id, g);
    }
    const pending = [];
    for (const [id, list] of groups) {
      const starts = list.filter((e) => e.kind === 'start'),
        ends = list.filter((e) => e.kind === 'end');
      if (
        starts.length !== 1 ||
        !Number.isFinite(starts[0]?.at) ||
        starts[0]?.at > now ||
        typeof starts[0]?.phase !== 'string' ||
        (ends[0] && !Number.isFinite(ends[0].at)) ||
        ends.length > 1 ||
        (ends[0] && (ends[0].phase !== starts[0].phase || ends[0].at < starts[0].at))
      ) {
        issues.push('conflicting-process-event:' + id);
        continue;
      }
      if (!ends.length) {
        pending.push({
          id,
          phase: starts[0].phase,
          startedAt: starts[0].at,
          status: 'unclosed; actual running state unknown',
        });
        continue;
      }
      intervals.push({
        phase: starts[0].phase,
        start: starts[0].at,
        end: ends[0].at,
        status: ends[0].status,
        source: starts[0].source,
      });
    }
    const valid = intervals.filter(
      (e) => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end >= e.start && e.end <= now,
    );
    if (valid.length !== intervals.length) issues.push('invalid-or-future-interval');
    valid.sort((a, b) => a.start - b.start);
    const observed = ranges(valid.map((e) => [e.start, e.end]));
    const registered = stamp(task.createdAt),
      closed = stamp(task.closedAt),
      end = Number.isFinite(closed) ? closed : now;
    const start = Math.min(...[registered, ...observed.map(([a]) => a)].filter(Number.isFinite));
    const window = Number.isFinite(start) && end >= start ? [[start, end]] : [];
    const clipped = ranges(observed.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b >= a));
    const waiting = ranges(
      valid.filter((e) => ['ci', 'resource-wait', 'approval-wait'].includes(e.phase)).map((e) => [e.start, e.end]),
    );
    return {
      task: task.id,
      status: issues.length ? 'incomplete' : pending.length ? 'partial-unclosed' : 'partial',
      native: native ?? { status: 'unavailable', reason: 'No verified native whole-task report' },
      wholeTaskWallMs: native?.status === 'completed' ? native.wallMs : null,
      observedWindow: {
        from: Number.isFinite(start) ? start : null,
        until: end,
        basis: 'first recorded process or registration; NOT user request',
      },
      observedWindowMs: window.length ? duration(window) : null,
      observedProcessWallMs: duration(clipped),
      coverageRatio: window.length && duration(window) > 0 ? duration(clipped) / duration(window) : null,
      unknownMs: window.length ? duration(subtract(window, clipped)) : null,
      observedProcessIntervals: clipped,
      waitingIntervals: waiting,
      phases: valid,
      pending,
      issues,
      milestones,
      binding:
        events
          .filter((e) => e.kind === 'binding')
          .sort((a, b) => a.at - b.at)
          .at(-1) ?? null,
    };
  });
  const active = rows.map((r) => r.observedProcessIntervals),
    waits = rows.map((r) => r.waitingIntervals);
  return {
    version: 1,
    status: 'partial-observation',
    tasks: rows,
    observedProcessWallMs: duration(active.flat()),
    parallelOverlapMs: overlapDuration(active),
    sumTaskProcessMs: rows.reduce((n, r) => n + r.observedProcessWallMs, 0),
    waitingWallMs: duration(waits.flat()),
    meaning:
      'Process elapsed time includes internal waits, not CPU time. Per-task totals overlap; never add them to wall time. Missing/unclosed periods are unknown, not idle or continuous execution.',
  };
}
function jsonFiles(dir) {
  safe(dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    assert.ok(!e.isSymbolicLink(), 'Linked timing input refused');
    return e.isDirectory()
      ? jsonFiles(path.join(dir, e.name))
      : e.name.endsWith('.json')
        ? [path.join(dir, e.name)]
        : [];
  });
}
export function readParallelTiming(common, tasks, { now = Date.now(), readNative = () => null } = {}) {
  const rows = tasks.map((task) => {
    const events = [],
      intervals = [],
      issues = [],
      milestones = { registeredAt: task.createdAt, closedAt: task.closedAt ?? null };
    const load = (file) => {
      try {
        return read(file);
      } catch {
        issues.push('unreadable:' + path.basename(file));
        return null;
      }
    };
    try {
      for (const f of jsonFiles(directory(common, task.id))) {
        const e = load(f);
        if (e?.version === 1 && e.task === task.id) events.push(e);
        else issues.push('invalid-process-record');
      }
    } catch (e) {
      issues.push(e.message);
    }
    let formal = load(path.join(common, 'task-delivery', task.id, 'completion-session.json'));
    if (formal && (formal.version !== 1 || formal.batch !== task.id)) {
      issues.push('formal-identity-mismatch');
      formal = null;
    }
    for (const e of formal?.events ?? []) {
      if (Number.isFinite(e.startedAt) && Number.isFinite(e.finishedAt) && !e.durationBasis?.startsWith('upper-bound'))
        intervals.push({
          phase: e.name,
          start: e.startedAt,
          end: e.finishedAt,
          status: e.status,
          source: 'formal-delivery',
        });
      else issues.push('unclosed-or-unknown-formal:' + e.name);
    }
    milestones.formalStartedAt = formal?.startedAt ?? null;
    // Reports only: no native session traversal, process probing, test or state mutation.
    if (existsSync(task.worktree)) {
      const dep = load(path.join(task.worktree, '.task-runtime/dependency-install-result.json'));
      milestones.dependenciesReadyAt = dep?.exitCode === 0 && dep.task === task.id ? dep.completedAt : null;
      const seen = new Set(events.filter((e) => e.source === 'verification-attempt').map((e) => e.id));
      const attempts = new Map();
      try {
        for (const f of jsonFiles(path.join(task.worktree, '.task-verification/attempts'))) {
          const a = load(f);
          if (!a?.attemptId || seen.has(a.attemptId)) continue;
          const previous = attempts.get(a.attemptId);
          if (previous && previous.startedAt !== a.startedAt) {
            issues.push('conflicting-validation:' + a.attemptId);
            continue;
          }
          if (!previous || a.completedAt) attempts.set(a.attemptId, a);
        }
        for (const a of attempts.values()) {
          events.push({
            task: task.id,
            id: a.attemptId,
            kind: 'start',
            phase: 'validation',
            at: stamp(a.startedAt),
            source: 'verification-attempt',
          });
          if (a.completedAt)
            events.push({
              task: task.id,
              id: a.attemptId,
              kind: 'end',
              phase: 'validation',
              at: stamp(a.completedAt),
              status: a.status,
              source: 'verification-attempt',
            });
        }
      } catch (e) {
        issues.push(e.message);
      }
    }
    let native = null;
    try {
      native = readNative(common, task.id);
    } catch {
      issues.push('native-report-unavailable');
    }
    return { task, events, intervals, issues, native, milestones };
  });
  return summarizeProcessTiming(rows, { now });
}
