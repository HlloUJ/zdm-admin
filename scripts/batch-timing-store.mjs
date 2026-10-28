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
import { newTimeline, ingestNative, ingestContext, summarizeBatch } from './batch-timing-core.mjs';

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
    request = null;
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
    offset += Buffer.byteLength(line + '\n');
  }
  assert.ok(meta && last && request && Number.isFinite(request.at), 'Missing native authorization-turn identity');
  return { ...last, request, ...sourceIdentity(file) };
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
  return existsSync(file) ? JSON.parse(readFileSync(file)) : null;
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
    const size = lstatSync(source.file).size;
    assert.ok(size >= source.offset, 'Native source truncated');
    const fd = openSync(source.file, 'r');
    let buffer;
    try {
      buffer = Buffer.alloc(size - source.offset);
      readSync(fd, buffer, 0, buffer.length, source.offset);
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
    source.offset += last + 1;
  } catch (error) {
    const reason = 'native-source-unavailable:' + error.message.split('\n')[0];
    if (!state.issues.includes(reason)) state.issues.push(reason);
  }
}
export function refreshTimeline(common, batch, { now = Date.now() } = {}) {
  const directory = timingDirectory(common, batch);
  return lock(directory, () => {
    const state = readTimeline(common, batch);
    assert.ok(state, 'Batch timing not initialized');
    const completion = completionFor(state);
    for (const source of state.sources) consumeSource(state, source);
    const summary = summarizeBatch(state, { now, completion });
    atomic(path.join(directory, 'timeline.json'), state);
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
  lock(directory, () => {
    let state = readTimeline(common, batch.id);
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
    assert.equal(state.common, common);
    assert.equal(state.batch, batch.id);
    assert.equal(state.delivery, null, 'Closed batch timing cannot be rebound');
    if (!state.sources.some((s) => s.thread === env.CODEX_THREAD_ID)) {
      assert.ok(!state.sources.length || resume, 'New thread requires explicit batch resume');
      for (const source of state.sources) consumeSource(state, source);
      assert.ok(!state.turns.some((t) => t.finishedAt == null), 'Previous execution still open; never take over');
      state.sources.push({
        file,
        thread: env.CODEX_THREAD_ID,
        offset: identity.offset,
        device: identity.device,
        inode: identity.inode,
      });
    }
    atomic(path.join(directory, 'timeline.json'), state);
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
  const lease = path.join(directory, 'observer.json');
  safe(lease);
  if (existsSync(lease)) {
    const old = JSON.parse(readFileSync(lease));
    assert.equal(old.host, os.hostname(), 'Foreign timing observer');
    try {
      process.kill(old.pid, 0);
      return old;
    } catch (error) {
      assert.equal(error.code, 'ESRCH', 'Cannot prove timing observer exited');
    }
  }
  const names = ['batch-timing-core.mjs', 'batch-timing-store.mjs', 'batch-timing-observer.mjs'];
  const content = names.map((name) => [name, readFileSync(new URL(name, import.meta.url))]);
  const digest = hash(Buffer.concat(content.map(([, bytes]) => bytes)));
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
