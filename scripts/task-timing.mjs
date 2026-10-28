import { refreshCurrentTiming, timingCommon } from './batch-timing-runtime.mjs';
import { readTimingSummary } from './batch-timing-store.mjs';
// Observation only. No execution policy, cache decision, approval or task status depends on this report.
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { intervalDifference } from './completion-session.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ORDER = ['validation', 'waiting', 'tool', 'analysis', 'communication', 'context'];
const stamp = (value) => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value));
const valid = (n) => Number.isFinite(n);
function commonDirectory(root) {
  return realpathSync(
    execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 3000,
    }).trim(),
  );
}
function findSession(directory, thread, depth = 0) {
  if (depth > 4 || !existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return findSession(file, thread, depth + 1);
    return entry.isFile() && entry.name.endsWith(`-${thread}.jsonl`) ? [file] : [];
  });
}
function classify(item) {
  if (item.type === 'Reasoning') return 'analysis';
  if (item.type === 'AgentMessage') return 'communication';
  if (item.type === 'ContextCompaction') return 'context';
  if (['CommandExecution', 'McpToolCall'].includes(item.type)) return 'tool';
  if (item.type === 'Extension') return item.kind === 'clock.sleep' ? 'waiting' : 'tool';
  return null;
}
// Retain timing fields only. Never retain message text, reasoning, command, arguments or outputs.
export async function readTurnEvents(file, { expectedThread, projectRoot, repository = commonDirectory } = {}) {
  const turns = new Map();
  const seenItems = new Set();
  const turnProjects = new Map();
  let allowedRoots = [];
  let metadata = null,
    malformedLines = 0,
    repositoryMatched = false;
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        malformedLines++;
        continue;
      }
      const p = record.payload ?? {};
      if (record.type === 'session_meta') {
        if (p.id !== expectedThread) throw Error('Execution thread does not match');
        if (repository(p.cwd) !== repository(projectRoot))
          throw Error('Execution record belongs to another repository');
        allowedRoots = [path.resolve(p.cwd), path.resolve(projectRoot)];
        metadata = { thread: expectedThread };
        repositoryMatched = true;
        continue;
      }
      if (!metadata) continue;
      if (record.type === 'turn_context' && UUID.test(p.turn_id ?? '') && typeof p.cwd === 'string') {
        turnProjects.set(p.turn_id, allowedRoots.includes(path.resolve(p.cwd)));
        continue;
      }
      if (record.type !== 'event_msg' || !['task_started', 'task_complete', 'item_completed'].includes(p.type))
        continue;
      if (!UUID.test(p.turn_id ?? '')) continue;
      const turn = turns.get(p.turn_id) ?? { id: p.turn_id, items: [], startedAt: null, finishedAt: null };
      turns.set(p.turn_id, turn);
      if (p.type === 'task_started')
        turn.startedAt = valid(Date.parse(record.timestamp)) ? Date.parse(record.timestamp) : stamp(p.started_at);
      if (p.type === 'task_complete') {
        turn.finishedAt = valid(Date.parse(record.timestamp)) ? Date.parse(record.timestamp) : stamp(p.completed_at);
        if (valid(p.duration_ms) && p.duration_ms >= 0) turn.providerDurationMs = p.duration_ms;
      }
      if (p.type === 'item_completed') {
        const item = p.item ?? {},
          category = classify(item);
        if (item.id && seenItems.has(`${p.turn_id}:${item.id}`)) continue;
        if (item.id) seenItems.add(`${p.turn_id}:${item.id}`);
        if (!category) continue;
        const startedAt = p.started_at_ms,
          finishedAt = p.completed_at_ms;
        if (!valid(startedAt) || !valid(finishedAt) || finishedAt < startedAt) {
          turn.invalidIntervals = (turn.invalidIntervals ?? 0) + 1;
          continue;
        }
        turn.items.push({
          category,
          startedAt,
          finishedAt,
          failed: item.type === 'CommandExecution' && item.status === 'failed',
        });
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (!repositoryMatched) throw Error('Execution record has no verified project identity');
  return {
    thread: expectedThread,
    malformedLines,
    turns: [...turns.values()]
      .map((t) => ({ ...t, projectMatch: turnProjects.get(t.id) ?? true }))
      .filter((t) => valid(t.startedAt))
      .sort((a, b) => a.startedAt - b.startedAt),
  };
}
function union(intervals) {
  let end = -Infinity,
    total = 0;
  for (const [a, b] of intervals.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return total;
}
export function summarizeTurn(turn, { now = Date.now(), validation = [], completion = [] } = {}) {
  const start = turn.startedAt,
    end = turn.finishedAt ?? now;
  if (!valid(start) || !valid(end) || end < start) throw Error('Invalid execution window');
  const clip = (item) => ({
    ...item,
    startedAt: Math.max(start, item.startedAt),
    finishedAt: Math.min(end, item.finishedAt),
  });
  const records = [...turn.items, ...validation, ...completion]
    .filter((x) => valid(x.startedAt) && valid(x.finishedAt) && x.finishedAt >= x.startedAt)
    .map(clip)
    .filter((x) => x.finishedAt > x.startedAt);
  const primary = records.filter((x) => ORDER.includes(x.category));
  const points = [...new Set([start, end, ...primary.flatMap((x) => [x.startedAt, x.finishedAt])])].sort(
    (a, b) => a - b,
  );
  const exclusive = Object.fromEntries([...ORDER, 'unknown'].map((name) => [name, 0]));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const category =
      ORDER.find((name) => primary.some((x) => x.category === name && x.startedAt <= a && x.finishedAt >= b)) ??
      'unknown';
    exclusive[category] += b - a;
  }
  const repair = records.filter((x) => x.category === 'repair');
  const recovery = records.filter((x) => x.category === 'recovery');
  const pauses = records.filter((x) => x.category === 'pause');
  const blocked = records
    .filter((x) => ['waiting', 'pause'].includes(x.category))
    .map((x) => [x.startedAt, x.finishedAt]);
  return {
    version: 1,
    unit: 'codex-execution-turn',
    turnId: turn.id,
    status: turn.finishedAt == null ? 'snapshot' : 'completed',
    startedAt: new Date(start).toISOString(),
    observedUntil: new Date(end).toISOString(),
    wallMs: end - start,
    providerDurationMs: turn.providerDurationMs ?? null,
    exclusiveMs: exclusive,
    observedMs: end - start - exclusive.unknown,
    unattributedMs: exclusive.unknown,
    explicitRepairMs: repair.length
      ? intervalDifference(
          repair.map((x) => [x.startedAt, x.finishedAt]),
          blocked,
        )
      : null,
    explicitRepairWindowMs: repair.length ? union(repair.map((x) => [x.startedAt, x.finishedAt])) : null,
    explicitRecoveryMs: recovery.length
      ? intervalDifference(
          recovery.map((x) => [x.startedAt, x.finishedAt]),
          blocked,
        )
      : null,
    explicitPauseMs: pauses.length ? union(pauses.map((x) => [x.startedAt, x.finishedAt])) : null,
    repairBasis: repair.length ? 'explicit-completion-record' : 'not-recorded-do-not-infer',
    failedToolEvents: turn.items.filter((x) => x.failed).length,
    invalidIntervals: turn.invalidIntervals ?? 0,
    overlapPolicy:
      'Exclusive interval partition; validation > explicit wait > tool > platform reasoning > communication > compaction. Explicit repair is an overlay and is not added to wall time.',
    limits: [
      'One execution turn, not an inferred multi-turn task.',
      'Unobserved intervals remain unknown; no attribution to thinking, idle time or repair.',
      'Open turns are snapshots; later queries use the recorded completion boundary.',
    ],
  };
}
function recordsBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? recordsBelow(file) : entry.isFile() && entry.name.endsWith('.json') ? [file] : [];
  });
}
export function validationWindows(root, start, end) {
  const attempts = new Map();
  for (const file of recordsBelow(path.join(root, '.task-verification/attempts'))) {
    try {
      const item = JSON.parse(readFileSync(file, 'utf8')),
        a = stamp(item.startedAt),
        b = stamp(item.completedAt);
      if (!item.attemptId || !valid(a) || !valid(b) || b < a || b < start || a > end) continue;
      const prior = attempts.get(item.attemptId);
      if (prior && JSON.stringify(prior) !== JSON.stringify({ category: 'validation', startedAt: a, finishedAt: b }))
        continue;
      attempts.set(item.attemptId, { category: 'validation', startedAt: a, finishedAt: b });
    } catch {
      /* Missing or damaged observations never become zero-cost success. */
    }
  }
  return [...attempts.values()];
}
export function completionWindows(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.events)) return [];
  const records = [];
  for (const e of state.events)
    if (e.name === 'ci' && valid(e.startedAt) && valid(e.finishedAt))
      records.push({ category: 'waiting', startedAt: e.startedAt, finishedAt: e.finishedAt });
  for (const r of state.repairs ?? [])
    if (valid(r.startedAt) && valid(r.finishedAt))
      records.push({
        category: r.category === 'stage-restoration' ? 'recovery' : 'repair',
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      });
  for (const p of state.pauses ?? [])
    if (valid(p.startedAt) && valid(p.finishedAt))
      records.push({ category: 'pause', startedAt: p.startedAt, finishedAt: p.finishedAt });
  return records;
}
function save(root, summary) {
  const directory = path.join(root, '.task-verification/task-timing');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, summary.turnId + '.json');
  const temp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
  return file;
}
export async function recordTaskTiming(
  root,
  {
    env = process.env,
    sessionsRoot = path.join(env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions'),
    now = Date.now(),
    lastCompleted = false,
  } = {},
) {
  if (env.CI || env.GITHUB_ACTIONS === 'true')
    return { status: 'unavailable', reason: 'CI uses its existing timing records' };
  const thread = env.CODEX_THREAD_ID;
  if (!UUID.test(thread ?? '')) return { status: 'unavailable', reason: 'Current execution identity is unavailable' };
  const files = findSession(sessionsRoot, thread);
  if (files.length !== 1) return { status: 'unavailable', reason: 'Current execution record is missing or ambiguous' };
  const source = await readTurnEvents(files[0], { expectedThread: thread, projectRoot: root });
  const eligible = source.turns.filter((t) => t.startedAt <= now && (!lastCompleted || t.finishedAt != null)),
    turn = eligible.at(-1);
  if (!turn) return { status: 'unavailable', reason: 'No matching execution boundary recorded' };
  if (turn.projectMatch === false)
    return { status: 'unavailable', reason: 'Selected execution turn belongs to another project' };
  const start = turn.startedAt,
    end = turn.finishedAt ?? now;
  let completion = [];
  // Read only the current registered batch's existing formal record. Never open/start a delivery.
  try {
    const common = commonDirectory(root);
    const batch = JSON.parse(readFileSync(path.join(common, 'task-batches/active.json'), 'utf8'));
    if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(batch.id))
      completion = completionWindows(
        JSON.parse(readFileSync(path.join(common, 'task-delivery', batch.id, 'completion-session.json'), 'utf8')),
      );
  } catch {
    /* No explicit formal timing exists for this development round. */
  }
  const summary = {
    ...summarizeTurn(turn, { now, validation: validationWindows(root, start, end), completion }),
    threadId: thread,
    source: 'native-execution-event-metadata',
    malformedSourceLines: source.malformedLines,
  };
  if (source.malformedLines) summary.status = 'partial';
  return { status: summary.status, file: save(root, summary), summary };
}
export async function observeTaskTiming(root, report = console.log) {
  try {
    const batch = refreshCurrentTiming(root);
    if (batch.summary) {
      report(
        `Batch timing snapshot: ${batch.file}; ${batch.summary.status}; ${batch.summary.wallMs}ms since authorization`,
      );
      return;
    }
    const result = await recordTaskTiming(root);
    if (result.file) report(`Task timing snapshot: ${result.file}`);
    else report(`Task timing unavailable: ${result.reason}`);
  } catch (error) {
    try {
      report(`Task timing unavailable: ${error.message}`);
    } catch {
      /* Observation logging cannot affect a gate. */
    }
  }
}
export async function main(args = process.argv.slice(2)) {
  let requestedBatch = null;
  const batchIndex = args.indexOf('--batch');
  if (batchIndex >= 0) {
    requestedBatch = args[batchIndex + 1];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedBatch ?? '')) throw Error('Exact timing batch required');
    args = args.filter((_, index) => index !== batchIndex && index !== batchIndex + 1);
  }
  if (args.some((arg) => !['--json', '--last-completed', '--help'].includes(arg)))
    throw Error('Unknown task timing argument');
  if (args.includes('--help')) {
    console.log(
      'Usage: npm run task:timing -- [--batch batch-id] [--json] [--last-completed]\nReads the current thread event metadata and existing local observations. Does not run checks or change task state.',
    );
    return 0;
  }
  if (requestedBatch) {
    const summary = readTimingSummary(timingCommon(process.cwd()), requestedBatch);
    console.log(
      JSON.stringify(
        summary ?? { status: 'unavailable', batch: requestedBatch, reason: 'No native batch boundary captured' },
        null,
        2,
      ),
    );
    return summary ? 0 : 1;
  }
  const result = await recordTaskTiming(process.cwd(), { lastCompleted: args.includes('--last-completed') });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else if (result.summary) {
    console.log(
      `Execution ${result.summary.turnId}: ${result.status}; observed wall ${Math.round(result.summary.wallMs / 1000)}s`,
    );
    console.log(JSON.stringify(result.summary.exclusiveMs));
    console.log(`Report: ${result.file}`);
  } else console.log(result.reason);
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
