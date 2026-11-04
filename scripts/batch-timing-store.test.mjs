import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  rmSync,
  existsSync,
  realpathSync,
  readdirSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bindBatchTiming,
  refreshTimeline,
  readTimeline,
  readTimingSummary,
  ensureObserver,
  timingDirectory,
} from './batch-timing-store.mjs';
const epoch = 1700000000000,
  thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'batch-timing-real-')));
  const observers = new Set();
  const trackObserver = (owner) => {
    observers.add(owner.pid);
    return owner;
  };
  t.after(async () => {
    for (const pid of observers) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      await until(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
          return true;
        }
      });
    }
    rmSync(root, { recursive: true, force: true });
  });
  for (const a of [
    ['init', '-b', 'main'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
  ])
    execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  const common = path.join(root, '.git');
  mkdirSync(path.join(common, 'task-batches'), { recursive: true });
  mkdirSync(path.join(common, 'task-delivery'), { recursive: true });
  const sessions = path.join(root, 'sessions');
  mkdirSync(sessions);
  const file = path.join(sessions, 'rollout-fixture-' + thread + '.jsonl');
  const row = (type, payload, at) =>
    JSON.stringify({ timestamp: new Date(epoch + at).toISOString(), type, payload }) + '\n';
  const start = (id, at) =>
    row('event_msg', { type: 'task_started', turn_id: id }, at) +
    row('turn_context', { turn_id: id, cwd: root }, at) +
    row(
      'event_msg',
      {
        type: 'item_completed',
        turn_id: id,
        item: { type: 'UserMessage', id: 'request-' + id, content: [{ type: 'text', text: 'PRIVATE request' }] },
      },
      at + 1,
    );
  writeFileSync(file, row('session_meta', { id: thread, cwd: root }, -1) + start('one', 0));
  const batch = { id: 'timing', repository: { commonDir: common, anchor: root }, worktree: root };
  const env = { CODEX_THREAD_ID: thread };
  const bind = (options = {}) =>
    bindBatchTiming(root, batch, { env, sessionsRoot: sessions, observer: false, ...options });
  const append = (text) => appendFileSync(file, text);
  return {
    root,
    trackObserver,
    common,
    sessions,
    file,
    row,
    start,
    batch,
    env,
    bind,
    append,
    directory: timingDirectory(common, 'timing'),
  };
}
const event = (f, type, turn, at, extra = {}) => f.row('event_msg', { type, turn_id: turn, ...extra }, at);
test('persistent binding uses native authorization identity, incremental offsets and never stores message bodies', (t) => {
  const f = fixture(t);
  f.bind();
  let s = readTimeline(f.common, 'timing');
  assert.equal(s.authorizedAt, epoch + 1);
  assert.equal(s.requestId, 'request-one');
  const before = s.sources[0].offset;
  f.append(event(f, 'task_complete', 'one', 100));
  f.bind();
  s = readTimeline(f.common, 'timing');
  assert.ok(s.sources[0].offset > before);
  assert.equal(s.turns.length, 1);
  assert.equal(s.turns[0].finishedAt, epoch + 100);
  assert.ok(!readFileSync(path.join(f.directory, 'timeline.json'), 'utf8').includes('PRIVATE'));
  assert.ok(!readFileSync(path.join(f.directory, 'summary.json'), 'utf8').includes('PRIVATE'));
});
test('partial append waits for a complete line; truncation is a visible incomplete proof', (t) => {
  const f = fixture(t);
  f.bind();
  const text = event(f, 'task_complete', 'one', 100),
    cut = 20;
  f.append(text.slice(0, cut));
  const x = refreshTimeline(f.common, 'timing');
  assert.equal(x.state.turns[0].finishedAt, null);
  f.append(text.slice(cut));
  assert.equal(refreshTimeline(f.common, 'timing').state.turns[0].finishedAt, epoch + 100);
  writeFileSync(f.file, '');
  assert.equal(refreshTimeline(f.common, 'timing').summary.status, 'incomplete');
});
test('a different thread needs explicit resume and a proven ended predecessor; wrong repositories are rejected', (t) => {
  const f = fixture(t);
  f.bind();
  const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    otherFile = path.join(f.sessions, 'rollout-fixture-' + other + '.jsonl');
  writeFileSync(otherFile, f.row('session_meta', { id: other, cwd: f.root }, -1) + f.start('two', 200));
  assert.throws(() => f.bind({ env: { CODEX_THREAD_ID: other } }), /explicit batch resume/);
  assert.throws(() => f.bind({ env: { CODEX_THREAD_ID: other }, resume: true }), /still open/);
  f.append(event(f, 'task_complete', 'one', 100));
  f.bind({ env: { CODEX_THREAD_ID: other }, resume: true });
  assert.equal(readTimeline(f.common, 'timing').sources.length, 2);
  const foreign = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'foreign-native-')));
  t.after(() => rmSync(foreign, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: foreign, stdio: 'ignore' });
  writeFileSync(otherFile, f.row('session_meta', { id: other, cwd: foreign }, -1) + f.start('two', 200));
  assert.throws(() => f.bind({ env: { CODEX_THREAD_ID: other }, resume: true }), /another repository/);
});
async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('Observer did not receive the expected filesystem event');
}
test('real detached collector records approval, survives task carrier removal, seals only after final turn and exits', async (t) => {
  const f = fixture(t);
  f.batch.worktree = path.join(f.root, 'task-carrier');
  mkdirSync(f.batch.worktree);
  f.bind();
  const owner = f.trackObserver(ensureObserver(f.directory));
  // Prove duplicate starts reuse the owned process; no second collector is created.
  assert.equal(ensureObserver(f.directory).pid, owner.pid);
  f.append(
    event(f, 'item_completed', 'one', 10, {
      item: { type: 'AgentMessage', id: 'approval', questions: [{ title: 'PRIVATE question' }] },
    }) + event(f, 'task_complete', 'one', 100),
  );
  await until(() => readTimeline(f.common, 'timing').turns[0].finishedAt === epoch + 100);
  f.append(
    f.start('two', 500) +
      event(f, 'item_completed', 'two', 501, {
        item: {
          type: 'UserMessage',
          id: 'answer',
          content: [
            {
              type: 'text',
              text:
                '<send_user_message_question_reply>' +
                JSON.stringify([
                  {
                    questionItemId: JSON.stringify(['request_user_input_async', 'approval', 0]),
                    answer: 'PRIVATE answer',
                  },
                ]) +
                '</send_user_message_question_reply>',
            },
          ],
        },
      }),
  );
  await until(() => readTimeline(f.common, 'timing').questions[0]?.answeredAt === epoch + 501);
  const archive = path.join(f.common, 'task-batches/archive');
  mkdirSync(archive);
  writeFileSync(
    path.join(archive, 'timing.json'),
    JSON.stringify({ id: 'timing', closedAt: new Date(epoch + 600).toISOString() }),
  );
  writeFileSync(path.join(f.common, 'task-batches/active.json'), '{}');
  const snapshot = await until(() => {
    const s = readTimingSummary(f.common, 'timing');
    return s.deliveryCompleteAt && s;
  });
  assert.equal(snapshot.status, 'awaiting-turn-end');
  assert.equal(snapshot.finalReplyCompleteAt, null);
  rmSync(f.batch.worktree, { recursive: true });
  assert.equal(existsSync(f.batch.worktree), false);
  // Final native event arrives after normal completion/cleanup. No explicit report command is called.
  f.append(event(f, 'task_complete', 'two', 700));
  const final = await until(() => {
    const s = readTimingSummary(f.common, 'timing');
    return s.status === 'completed' && s;
  });
  assert.equal(final.wallMs, 699);
  assert.equal(final.approvalBlockedMs, 400);
  assert.equal(final.executionRoundsMs, 299);
  assert.ok(!JSON.stringify(readTimeline(f.common, 'timing')).includes('PRIVATE'));
  await until(() => {
    try {
      process.kill(owner.pid, 0);
      return false;
    } catch (error) {
      return error.code === 'ESRCH';
    }
  });
  const finalBytes = readFileSync(path.join(f.directory, 'summary.json'), 'utf8');
  f.append(f.start('unrelated', 900));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(readFileSync(path.join(f.directory, 'summary.json'), 'utf8'), finalBytes);
  assert.ok(readdirSync(f.directory).some((name) => name.startsWith('observer-')));
  assert.ok(existsSync(path.join(f.directory, 'observer.json')));
});

test('native abort closes an interrupted round and permits explicit handoff without marking it successful', (t) => {
  const f = fixture(t);
  f.bind();
  f.append(event(f, 'turn_aborted', 'one', 100));
  const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  writeFileSync(
    path.join(f.sessions, 'rollout-fixture-' + other + '.jsonl'),
    f.row('session_meta', { id: other, cwd: f.root }, -1) + f.start('two', 200),
  );
  f.bind({ env: { CODEX_THREAD_ID: other }, resume: true });
  const state = readTimeline(f.common, 'timing');
  assert.equal(state.turns[0].finishedAt, epoch + 100);
  assert.equal(state.turns[0].termination, 'interrupted');
  assert.equal(state.authorizedAt, epoch + 1);
  assert.equal(state.sources.length, 2);
  assert.equal(readTimingSummary(f.common, 'timing').interruptedTurnIds.length, 1);
});

test('legacy cursor past an ignored abort recovers exact terminal metadata once, preserving original authorization', (t) => {
  const f = fixture(t);
  f.bind();
  f.append(event(f, 'turn_aborted', 'one', 100));
  const file = path.join(f.directory, 'timeline.json');
  const state = readTimeline(f.common, 'timing');
  state.sources[0].offset = Buffer.byteLength(readFileSync(f.file));
  delete state.sources[0].terminalReplayVersion;
  writeFileSync(file, JSON.stringify(state));
  const recovered = refreshTimeline(f.common, 'timing').state;
  assert.equal(recovered.turns[0].finishedAt, epoch + 100);
  assert.equal(recovered.turns[0].termination, 'interrupted');
  assert.equal(recovered.authorizedAt, state.authorizedAt);
  assert.equal(recovered.requestId, state.requestId);
  assert.equal(recovered.sources[0].offset, state.sources[0].offset);
  assert.deepEqual(refreshTimeline(f.common, 'timing').state, recovered);
});

for (const terminal of ['task_complete', 'turn_aborted']) {
  test(`new binding rejects an already ${terminal} authorization source`, (t) => {
    const f = fixture(t);
    f.append(event(f, terminal, 'one', 100));
    assert.throws(() => f.bind(), /authorization turn already ended/);
    assert.equal(readTimeline(f.common, 'timing'), null);
  });
}

test('legacy stale authorization retains its boundary but reports whole-batch time unavailable', (t) => {
  const f = fixture(t);
  f.bind();
  f.append(event(f, 'turn_aborted', 'one', 100));
  f.batch.createdAt = new Date(epoch + 200).toISOString();
  f.bind();
  const summary = readTimingSummary(f.common, 'timing');
  assert.equal(summary.wallMs, null);
  assert.equal(summary.executionRoundsMs, null);
  assert.equal(summary.status, 'incomplete');
  assert.ok(summary.issues.includes('authorization-turn-ended-before-registration'));
  assert.equal(readTimeline(f.common, 'timing').authorizedAt, epoch + 1);
});

test('collector upgrade replaces only its proven owned stale bundle and retains unrelated processes', async (t) => {
  const f = fixture(t);
  f.bind();
  const oldCode = path.join(f.root, 'old-collector');
  mkdirSync(oldCode);
  for (const name of [
    'batch-timing-core.mjs',
    'batch-timing-store.mjs',
    'delivery-repairs/batch-timing-io.mjs',
    'batch-timing-observer.mjs',
  ]) {
    mkdirSync(path.dirname(path.join(oldCode, name)), { recursive: true });
    writeFileSync(
      path.join(oldCode, name),
      readFileSync(new URL(name, import.meta.url), 'utf8') + '\n// Previous collector version\n',
    );
  }
  const { pathToFileURL } = await import('node:url');
  const previous = await import(pathToFileURL(path.join(oldCode, 'batch-timing-store.mjs')).href);
  const owner = f.trackObserver(previous.ensureObserver(f.directory));
  await until(() => {
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  const upgraded = f.trackObserver(ensureObserver(f.directory));
  assert.notEqual(upgraded.pid, owner.pid);
  assert.notEqual(upgraded.bundleDigest, owner.bundleDigest);
  assert.equal(ensureObserver(f.directory).pid, upgraded.pid);
  f.append(event(f, 'turn_aborted', 'one', 100));
  await until(() => readTimeline(f.common, 'timing').turns[0].termination === 'interrupted');
  const lease = path.join(f.directory, 'observer.json');
  writeFileSync(lease, JSON.stringify({ ...upgraded, pid: process.pid }));
  assert.throws(() => ensureObserver(f.directory), /Cannot prove timing observer exited/);
  process.kill(process.pid, 0);
  writeFileSync(lease, JSON.stringify(upgraded));
});

test('a command containing collector arguments cannot authorize stopping an unrelated process', async (t) => {
  const f = fixture(t);
  f.bind();
  const directory = f.directory,
    token = 'fixture-token',
    bundleDigest = 'a'.repeat(64);
  const suffix =
    path.join(directory, 'observer-' + bundleDigest, 'batch-timing-observer.mjs') + ' ' + directory + ' ' + token;
  const child = spawn(process.execPath, ['-e', "process.send('ready');setInterval(()=>{},1000)", suffix], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
  });
  try {
    writeFileSync(
      path.join(directory, 'observer.json'),
      JSON.stringify({ pid: child.pid, host: os.hostname(), token, bundleDigest }),
    );
    assert.throws(() => ensureObserver(directory), /Cannot prove timing observer exited/);
    process.kill(child.pid, 0);
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }
});

test('v1 history migrates with immutable backups and the real legacy reader cannot overwrite its summary', async (t) => {
  const f = fixture(t);
  f.bind();
  const timeline = path.join(f.directory, 'timeline.json'),
    summary = path.join(f.directory, 'summary.json');
  const state = readTimeline(f.common, 'timing');
  state.version = 1;
  writeFileSync(timeline, JSON.stringify(state));
  const original = readFileSync(timeline),
    oldSummary = readFileSync(summary);
  const upgraded = refreshTimeline(f.common, 'timing');
  assert.equal(upgraded.state.version, 3);
  const backups = readdirSync(f.directory).filter((name) => name.startsWith('timeline-v1-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(readFileSync(path.join(f.directory, backups[0])), original);
  const summaryBackup = readdirSync(f.directory).find((name) => name.startsWith('summary-v1-'));
  assert.deepEqual(readFileSync(path.join(f.directory, summaryBackup)), oldSummary);
  const legacyDirectory = path.join(f.root, 'legacy');
  mkdirSync(legacyDirectory);
  for (const name of ['batch-timing-core.mjs', 'batch-timing-store.mjs'])
    writeFileSync(
      path.join(legacyDirectory, name),
      readFileSync(new URL('./delivery-repairs/fixtures/timing-v1/' + name + '.txt', import.meta.url)),
    );
  const { pathToFileURL } = await import('node:url');
  const legacy = await import(pathToFileURL(path.join(legacyDirectory, 'batch-timing-store.mjs')).href);
  const beforeTimeline = readFileSync(timeline),
    beforeSummary = readFileSync(summary);
  assert.throws(() => legacy.refreshTimeline(f.common, 'timing'), /AssertionError/);
  assert.deepEqual(readFileSync(timeline), beforeTimeline);
  assert.deepEqual(readFileSync(summary), beforeSummary);
});

test('a legacy writer advancing its cursor cannot hide an abort from the current reader', (t) => {
  const f = fixture(t);
  f.bind();
  const file = path.join(f.directory, 'timeline.json'),
    state = readTimeline(f.common, 'timing');
  const verified = state.sources[0].verifiedOffset;
  f.append(event(f, 'turn_aborted', 'one', 100));
  // The old writer preserves unknown fields but only advances its own cursor, ignoring turn_aborted.
  state.sources[0].offset = Buffer.byteLength(readFileSync(f.file));
  writeFileSync(file, JSON.stringify(state));
  const recovered = refreshTimeline(f.common, 'timing').state;
  assert.equal(recovered.turns[0].termination, 'interrupted');
  assert.equal(recovered.turns[0].finishedAt, epoch + 100);
  assert.ok(recovered.sources[0].verifiedOffset > verified);
  assert.equal(recovered.sources[0].verifiedOffset, recovered.sources[0].offset);
});
