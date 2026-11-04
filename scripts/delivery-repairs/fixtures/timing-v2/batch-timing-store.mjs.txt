import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BATCH_TIMING_VERSION,
  newTimeline,
  ingestNative,
  ingestContext,
  summarizeBatch,
  interruptedValidationIds,
} from './batch-timing-core.mjs';

export const timingDirectory = (common, batch) => {
  assert.match(batch, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  return path.join(common, 'task-timing', batch);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function safe(file) {
  if (existsSync(file)) assert.ok(!lstatSync(file).isSymbolicLink(), 'Linked timing source');
}
function atomic(file, value) {
  safe(file);
  const temp = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
}
function gitCommon(root) {
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, 'Timing repository unavailable');
  return path.resolve(root, r.stdout.trim());
}
function findSource(directory, thread, depth = 0) {
  if (depth > 4 || !existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((e) =>
    e.isSymbolicLink()
      ? []
      : e.isDirectory()
        ? findSource(path.join(directory, e.name), thread, depth + 1)
        : e.isFile() && e.name.endsWith('-' + thread + '.jsonl')
          ? [path.join(directory, e.name)]
          : [],
  );
}
function sourceIdentity(file) {
  safe(file);
  const s = lstatSync(file);
  assert.ok(s.isFile());
  return { device: s.dev, inode: s.ino };
}
export function inspectNativeSource(file, { thread, common }) {
  sourceIdentity(file);
  const bytes = readFileSync(file);
  let offset = 0,
    meta = null,
    last = null,
    request = null,
    terminal = null;
  const complete = bytes.subarray(0, bytes.lastIndexOf(10) + 1);
  for (const line of complete.toString('utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line),
      p = row.payload ?? {};
    if (row.type === 'session_meta') {
      assert.equal(p.id, thread);
      assert.equal(gitCommon(p.cwd), common, 'Native session belongs to another repository');
      meta = p.id;
    }
    if (row.type === 'event_msg' && p.type === 'task_started') {
      last = { turn: p.turn_id, at: Date.parse(row.timestamp), offset };
      request = null;
      terminal = null;
    }
    if (
      last &&
      row.type === 'event_msg' &&
      p.type === 'item_completed' &&
      p.item?.type === 'UserMessage' &&
      p.turn_id === last.turn &&
      !request
    )
      request = { id: p.item.id, at: Date.parse(row.timestamp) };
    if (
      last &&
      row.type === 'event_msg' &&
      p.turn_id === last.turn &&
      ['task_complete', 'turn_aborted'].includes(p.type)
    )
      terminal = { type: p.type, at: Date.parse(row.timestamp) };
    offset += Buffer.byteLength(line + '\n');
  }
  assert.ok(meta && last && request && Number.isFinite(request.at), 'Missing native authorization-turn identity');
  return { ...last, request, terminal, ...sourceIdentity(file) };
}
function lock(directory, run) {
  safe(path.dirname(directory));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  safe(directory);
  assert.equal(lstatSync(directory).mode & 0o077, 0);
  const file = path.join(directory, 'writer.lock');
  let held = false;
  for (let i = 0; i < 100; i++) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, host: os.hostname() }), { flag: 'wx', mode: 0o600 });
      held = true;
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  assert.ok(held, 'Timing writer busy; preserve owner');
  try {
    return run();
  } finally {
    unlinkSync(file);
  }
}
export function readTimeline(common, batch) {
  const file = path.join(timingDirectory(common, batch), 'timeline.json');
  safe(file);
  if (!existsSync(file)) return null;
  const state = JSON.parse(readFileSync(file));
  assert.ok([1, BATCH_TIMING_VERSION].includes(state.version), 'Unsupported batch timing format');
  return state;
}
function saveTimeline(directory, state) {
  const file = path.join(directory, 'timeline.json');
  if (existsSync(file)) {
    const bytes = readFileSync(file),
      prior = JSON.parse(bytes);
    if (prior.version === 1) {
      const backup = path.join(directory, 'timeline-v1-' + hash(bytes) + '.json');
      safe(backup);
      if (!existsSync(backup)) writeFileSync(backup, bytes, { flag: 'wx', mode: 0o600 });
      const summary = path.join(directory, 'summary.json');
      if (existsSync(summary)) {
        safe(summary);
        const summaryBytes = readFileSync(summary),
          summaryBackup = path.join(directory, 'summary-v1-' + hash(summaryBytes) + '.json');
        safe(summaryBackup);
        if (!existsSync(summaryBackup)) writeFileSync(summaryBackup, summaryBytes, { flag: 'wx', mode: 0o600 });
      }
    }
  }
  state.version = BATCH_TIMING_VERSION;
  atomic(file, state);
}
export function completionFor(state) {
  const file = path.join(state.common, 'task-delivery', state.batch, 'completion-session.json');
  safe(file);
  const completion = existsSync(file) ? JSON.parse(readFileSync(file)) : null;
  if (completion) assert.equal(completion.batch, state.batch);
  const archive = path.join(state.common, 'task-batches/archive', state.batch + '.json');
  safe(archive);
  if (existsSync(archive)) {
    const closed = JSON.parse(readFileSync(archive));
    assert.equal(closed.id, state.batch);
    const at = Date.parse(closed.closedAt);
    assert.ok(Number.isFinite(at));
    if (state.delivery) assert.equal(state.delivery.closedAt, at);
    else state.delivery = { closedAt: at };
  }
  return completion;
}
// Offsets always stop at complete JSON lines; pending bytes and message content are never persisted.
export function consumeSource(state, source) {
  try {
    assert.deepEqual(
      sourceIdentity(source.file),
      { device: source.device, inode: source.inode },
      'Native source identity changed',
    );
    // Repair only terminal metadata already consumed by older collectors. Never replay messages or guess an end.
    if (source.terminalReplayVersion !== 1 || source.verifiedOffset == null) {
      const prefix = readFileSync(source.file).subarray(0, source.offset).toString('utf8');
      for (const line of prefix.split('\n').filter(Boolean)) {
        const row = JSON.parse(line),
          p = row.payload ?? {};
        if (
          row.type === 'event_msg' &&
          ['task_complete', 'turn_aborted'].includes(p.type) &&
          state.turns.some((t) => t.thread === source.thread && t.id === p.turn_id && t.finishedAt == null)
        )
          ingestNative(state, row, source);
      }
      source.terminalReplayVersion = 1;
      source.verifiedOffset ??= source.offset;
    }
    // A v1 tool can advance its legacy cursor without understanding aborts. Only trust this reader's cursor.
    const start = source.verifiedOffset ?? source.offset;
    const size = lstatSync(source.file).size;
    assert.ok(size >= start && size >= source.offset, 'Native source truncated');
    const fd = openSync(source.file, 'r');
    let buffer;
    try {
      buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    const last = buffer.lastIndexOf(10);
    if (last < 0) return;
    for (const line of buffer
      .subarray(0, last + 1)
      .toString('utf8')
      .split('\n')
      .filter(Boolean)) {
      const row = JSON.parse(line);
      ingestNative(state, row, source);
      ingestContext(state, row, source);
    }
    source.offset = start + last + 1;
    source.verifiedOffset = source.offset;
  } catch (error) {
    const reason = 'native-source-unavailable:' + (error.code ?? error.name ?? 'unknown');
    if (!state.issues.includes(reason)) state.issues.push(reason);
  }
}
export function refreshTimeline(common, batch, { now = Date.now() } = {}) {
  const directory = timingDirectory(common, batch);
  return lock(directory, () => {
    const state = readTimeline(common, batch);
    assert.ok(state, 'Batch timing not initialized');
    assert.equal(state.common, common, 'Timing repository identity changed');
    assert.equal(state.batch, batch, 'Timing batch identity changed');
    const completion = completionFor(state);
    for (const source of state.sources) consumeSource(state, source);
    const summary = summarizeBatch(state, { now, completion });
    saveTimeline(directory, state);
    atomic(path.join(directory, 'summary.json'), summary);
    return { state, summary, completion };
  });
}
export function bindBatchTiming(
  root,
  batch,
  {
    env = process.env,
    sessionsRoot = path.join(env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'sessions'),
    resume = false,
    observer = true,
  } = {},
) {
  if (env.CI || env.GITHUB_ACTIONS === 'true' || !env.CODEX_THREAD_ID) return { status: 'not-required' };
  const common = gitCommon(root);
  assert.equal(common, batch.repository.commonDir);
  const sources = findSource(sessionsRoot, env.CODEX_THREAD_ID);
  assert.equal(sources.length, 1, 'Native timing session missing or ambiguous');
  const file = sources[0];
  const identity = inspectNativeSource(file, { thread: env.CODEX_THREAD_ID, common });
  const directory = timingDirectory(common, batch.id);
  const marker = timingRequiredFile(common, batch.id);
  lock(directory, () => {
    let state = readTimeline(common, batch.id);
    if (!state) {
      assert.ok(!existsSync(marker), 'Required timing state missing; never reset authorization time');
    }
    if (!state) assert.ok(!identity.terminal, 'Native authorization turn already ended; no new batch timing binding');
    if (!state)
      state = newTimeline({
        batch: batch.id,
        common,
        anchor: batch.repository.anchor,
        worktree: batch.worktree,
        authorizedAt: identity.request.at,
        requestId: identity.request.id,
        thread: env.CODEX_THREAD_ID,
        initialTurn: identity.turn,
      });
    if (batch.createdAt) {
      const registeredAt = Date.parse(batch.createdAt);
      assert.ok(Number.isFinite(registeredAt), 'Invalid batch registration time');
      if (state.registeredAt != null) assert.equal(state.registeredAt, registeredAt);
      else state.registeredAt = registeredAt;
    }
    assert.equal(state.common, common);
    assert.equal(state.batch, batch.id);
    assert.equal(state.delivery, null, 'Closed batch timing cannot be rebound');
    if (!state.sources.some((s) => s.thread === env.CODEX_THREAD_ID)) {
      assert.ok(!identity.terminal, 'Native resume turn already ended');
      assert.ok(!state.sources.length || resume, 'New thread requires explicit batch resume');
      for (const source of state.sources) consumeSource(state, source);
      assert.ok(!state.turns.some((t) => t.finishedAt == null), 'Previous execution still open; never take over');
      state.sources.push({
        file,
        thread: env.CODEX_THREAD_ID,
        offset: identity.offset,
        verifiedOffset: identity.offset,
        device: identity.device,
        inode: identity.inode,
      });
    }
    saveTimeline(directory, state);
    const markerDirectory = path.dirname(marker);
    safe(markerDirectory);
    mkdirSync(markerDirectory, { recursive: true, mode: 0o700 });
    const proof = { version: 1, batch: batch.id, authorizedAt: state.authorizedAt, requestId: state.requestId };
    if (existsSync(marker)) assert.deepEqual(JSON.parse(readFileSync(marker)), proof, 'Authorization marker differs');
    else atomic(marker, proof);
    atomic(
      path.join(directory, 'subscriptions.json'),
      state.sources.map((source) => source.file),
    );
  });
  const result = refreshTimeline(common, batch.id);
  if (observer) ensureObserver(directory);
  return { status: result.summary.status, batch: batch.id, file: path.join(directory, 'summary.json') };
}
export function ensureObserver(directory) {
  return lock(directory, () => startObserver(directory));
}
function startObserver(directory) {
  const names = ['batch-timing-core.mjs', 'batch-timing-store.mjs', 'batch-timing-observer.mjs'];
  const content = names.map((name) => [name, readFileSync(new URL(name, import.meta.url))]);
  const digest = hash(Buffer.concat(content.map(([, bytes]) => bytes)));
  const lease = path.join(directory, 'observer.json');
  safe(lease);
  if (existsSync(lease)) {
    const old = JSON.parse(readFileSync(lease));
    assert.equal(old.host, os.hostname(), 'Foreign timing observer');
    try {
      process.kill(old.pid, 0);
      const identity = spawnSync('ps', ['-p', String(old.pid), '-o', 'command='], { encoding: 'utf8' });
      assert.equal(identity.status, 0, 'Cannot prove timing observer process identity');
      assert.equal(
        identity.stdout.trim(),
        process.execPath +
          ' ' +
          path.join(directory, 'observer-' + old.bundleDigest, 'batch-timing-observer.mjs') +
          ' ' +
          directory +
          ' ' +
          old.token,
        'Timing PID belongs to another process; preserve lease',
      );
      if (old.bundleDigest === digest) return old;
      // Retire only the positively identified collector; a new parser must not reuse a stale bundle.
      process.kill(old.pid, 'SIGTERM');
      let exited = false;
      for (let i = 0; i < 100; i++) {
        const status = spawnSync('ps', ['-p', String(old.pid), '-o', 'stat='], { encoding: 'utf8' });
        if (status.status === 1 || (status.status === 0 && /^Z/.test(status.stdout.trim()))) {
          exited = true;
          break;
        }
        assert.equal(status.status, 0, 'Cannot prove old collector exit');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      assert.ok(exited, 'Previous timing collector still active; retain lease');
    } catch (error) {
      assert.equal(error.code, 'ESRCH', 'Cannot prove timing observer exited');
    }
  }
  const bundle = path.join(directory, 'observer-' + digest);
  safe(bundle);
  mkdirSync(bundle, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of content) {
    const file = path.join(bundle, name);
    safe(file);
    if (existsSync(file)) assert.deepEqual(readFileSync(file), bytes);
    else writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  }
  const token = randomUUID();
  const child = spawn(process.execPath, [path.join(bundle, 'batch-timing-observer.mjs'), directory, token], {
    detached: true,
    stdio: 'ignore',
    cwd: directory,
    env: { PATH: process.env.PATH, HOME: os.homedir() },
  });
  assert.ok(child.pid);
  child.unref();
  const owner = { pid: child.pid, host: os.hostname(), token, bundleDigest: digest };
  atomic(lease, owner);
  return owner;
}
export function readTimingSummary(common, batch) {
  const file = path.join(timingDirectory(common, batch), 'summary.json');
  safe(file);
  return existsSync(file) ? JSON.parse(readFileSync(file)) : null;
}
export const observerSource = fileURLToPath(new URL('./batch-timing-observer.mjs', import.meta.url));

export function recordValidationTiming(common, batch, attempt) {
  const directory = timingDirectory(common, batch);
  return lock(directory, () => {
    const state = readTimeline(common, batch);
    assert.ok(state);
    assert.ok(
      attempt.attemptId && Number.isFinite(Date.parse(attempt.startedAt)),
      'Validation timing identity missing',
    );
    state.validations ??= [];
    const prior = state.validations.find((v) => v.id === attempt.attemptId);
    const next = {
      id: attempt.attemptId,
      startedAt: Date.parse(attempt.startedAt),
      finishedAt: attempt.completedAt ? Date.parse(attempt.completedAt) : null,
      status: attempt.status,
    };
    assert.ok(next.finishedAt == null || next.finishedAt >= next.startedAt, 'Validation clock moved backwards');
    if (prior) {
      assert.equal(prior.startedAt, next.startedAt);
      if (prior.finishedAt != null) assert.deepEqual(prior, next, 'Immutable validation timing differs');
      else Object.assign(prior, next);
    } else state.validations.push(next);
    saveTimeline(directory, state);
    atomic(path.join(directory, 'observations.json'), { id: next.id, finishedAt: next.finishedAt });
  });
}

export function timingRequiredFile(common, batch) {
  timingDirectory(common, batch);
  return path.join(common, 'task-batches/timing-required', batch + '.json');
}

// Resolution is additive: the original running observation and raw attempt remain untouched.
export function recordValidationInterruptions(common, batch, interruptions) {
  const directory = timingDirectory(common, batch);
  return lock(directory, () => {
    const state = readTimeline(common, batch);
    assert.ok(state);
    state.validationInterruptions ??= [];
    for (const item of interruptions) {
      assert.ok(!state.validationInterruptions.some((v) => v.id === item.id), 'Interruption already recorded');
      const original = state.validations.find((v) => v.id === item.id);
      assert.ok(original?.finishedAt == null && original?.status === 'running', 'Validation no longer pending');
      state.validationInterruptions.push(item);
    }
    interruptedValidationIds(state);
    saveTimeline(directory, state);
    atomic(path.join(directory, 'observations.json'), { interrupted: interruptions.map((v) => v.id) });
  });
}
