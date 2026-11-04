import assert from 'node:assert/strict';
import {
  atomicTimingJson,
  preserveTimingSnapshot,
  safeTimingPath,
  timingWriterLock,
} from './delivery-repairs/batch-timing-io.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
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
const safe = safeTimingPath;
const atomic = atomicTimingJson;
const lock = timingWriterLock;
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function unavailableSummary(batch, reason) {
  return {
    version: 1,
    timingVersion: 5,
    batch,
    status: 'incomplete',
    wallMs: null,
    executionRoundsMs: null,
    approvalBlockedMs: null,
    explicitPauseOutsideRoundsMs: null,
    unclassifiedBetweenRoundsMs: null,
    issues: [reason],
    meaning: 'No matching committed timing publication is available.',
  };
}
function authorizationDigest(state) {
  const marker = timingRequiredFile(state.common, state.batch);
  safe(marker);
  if (!existsSync(marker)) {
    assert.ok(!state.authorizationRequired, 'Required authorization marker missing');
    return null;
  }
  const bytes = readFileSync(marker),
    proof = JSON.parse(bytes);
  assert.equal(proof.batch, state.batch, 'Authorization batch changed');
  assert.equal(proof.authorizedAt, state.authorizedAt, 'Authorization boundary changed');
  assert.equal(proof.requestId, state.requestId, 'Authorization identity changed');
  return hash(bytes);
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
export function readTimeline(common, batch) {
  const file = path.join(timingDirectory(common, batch), 'timeline.json');
  safe(file);
  if (!existsSync(file)) return null;
  const state = JSON.parse(readFileSync(file));
  assert.ok([1, 2, BATCH_TIMING_VERSION].includes(state.version), 'Unsupported batch timing format');
  return state;
}
function saveTimeline(directory, state, { now = Date.now(), completion = completionFor(state) } = {}) {
  const file = path.join(directory, 'timeline.json');
  const proofDigest = authorizationDigest(state);
  if (existsSync(file)) {
    const bytes = readFileSync(file),
      prior = JSON.parse(bytes);
    if (prior.version < BATCH_TIMING_VERSION) {
      preserveTimingSnapshot(path.join(directory, `timeline-v${prior.version}-${hash(bytes)}.json`), bytes);
      const summaryFile = path.join(directory, 'summary.json');
      safe(summaryFile);
      if (existsSync(summaryFile)) {
        const bytes = readFileSync(summaryFile);
        preserveTimingSnapshot(path.join(directory, `summary-v${prior.version}-${hash(bytes)}.json`), bytes);
      }
    }
  }
  state.version = BATCH_TIMING_VERSION;
  state.authorizationRequired = proofDigest !== null;
  const summary = summarizeBatch(state, { now, completion });
  // Old read-only clients must see unknown, never an obsolete total, before any state upgrade is visible.
  atomic(path.join(directory, 'summary.json'), unavailableSummary(state.batch, 'timing-publication-pending'));
  atomic(file, state);
  atomic(path.join(directory, 'summary.json'), summary);
  atomic(path.join(directory, 'publication.json'), {
    version: 1,
    recordVersion: BATCH_TIMING_VERSION,
    batch: state.batch,
    common: state.common,
    timelineDigest: hash(encode(state)),
    summaryDigest: hash(encode(summary)),
    authorizationDigest: proofDigest,
  });
  return summary;
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
    const summary = saveTimeline(directory, state, { now, completion });
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
    const initializationFile = path.join(directory, 'initialization.json');
    safe(initializationFile);
    if (!state && existsSync(initializationFile)) {
      assert.ok(
        !existsSync(path.join(directory, 'publication.json')),
        'Committed timing state missing; never reset authorization or history',
      );
      const prepared = JSON.parse(readFileSync(initializationFile));
      assert.equal(prepared.digest, hash(encode(prepared.state)), 'Prepared timing identity damaged');
      assert.equal(prepared.state.common, common);
      assert.equal(prepared.state.batch, batch.id);
      state = prepared.state;
    }
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
    const markerDirectory = path.dirname(marker);
    safe(markerDirectory);
    mkdirSync(markerDirectory, { recursive: true, mode: 0o700 });
    const proof = { version: 1, batch: batch.id, authorizedAt: state.authorizedAt, requestId: state.requestId };
    if (existsSync(marker)) assert.deepEqual(JSON.parse(readFileSync(marker)), proof, 'Authorization marker differs');
    if (!existsSync(path.join(directory, 'timeline.json')) && !existsSync(initializationFile)) {
      preserveTimingSnapshot(initializationFile, encode({ version: 1, state, digest: hash(encode(state)) }));
    }
    if (!existsSync(marker)) preserveTimingSnapshot(marker, encode(proof));
    saveTimeline(directory, state);
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
  const names = [
    'batch-timing-core.mjs',
    'batch-timing-store.mjs',
    'delivery-repairs/batch-timing-io.mjs',
    'batch-timing-observer.mjs',
  ];
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
    safe(path.dirname(file));
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
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
  const directory = timingDirectory(common, batch);
  const manifestFile = path.join(directory, 'publication.json');
  try {
    for (const name of ['publication.json', 'timeline.json', 'summary.json']) safe(path.join(directory, name));
    if (!['publication.json', 'timeline.json', 'summary.json'].some((name) => existsSync(path.join(directory, name))))
      return null;
    if (!existsSync(manifestFile)) return unavailableSummary(batch, 'timing-publication-unverified');
    const before = readFileSync(manifestFile),
      publication = JSON.parse(before);
    const timelineBytes = readFileSync(path.join(directory, 'timeline.json'));
    const summaryBytes = readFileSync(path.join(directory, 'summary.json'));
    assert.equal(publication.version, 1);
    assert.equal(publication.recordVersion, BATCH_TIMING_VERSION);
    assert.equal(publication.batch, batch);
    assert.equal(publication.common, common);
    assert.equal(hash(timelineBytes), publication.timelineDigest);
    assert.equal(hash(summaryBytes), publication.summaryDigest);
    const state = JSON.parse(timelineBytes),
      summary = JSON.parse(summaryBytes);
    assert.equal(state.version, BATCH_TIMING_VERSION);
    assert.equal(state.batch, batch);
    assert.equal(state.common, common);
    assert.equal(summary.batch, batch);
    assert.equal(summary.timingVersion, 5);
    assert.equal(authorizationDigest(state), publication.authorizationDigest);
    assert.deepEqual(readFileSync(manifestFile), before, 'Timing publication changed while reading');
    return summary;
  } catch {
    return unavailableSummary(batch, 'timing-publication-unavailable');
  }
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
      const existing = state.validationInterruptions.find((v) => v.id === item.id);
      if (existing) {
        assert.deepEqual(existing, item, 'Immutable interruption differs');
        continue;
      }
      const original = state.validations.find((v) => v.id === item.id);
      assert.ok(original?.finishedAt == null && original?.status === 'running', 'Validation no longer pending');
      state.validationInterruptions.push(item);
    }
    interruptedValidationIds(state);
    saveTimeline(directory, state);
    atomic(path.join(directory, 'observations.json'), { interrupted: interruptions.map((v) => v.id) });
  });
}
