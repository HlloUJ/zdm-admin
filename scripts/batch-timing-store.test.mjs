import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
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
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
  const owner = ensureObserver(f.directory);
  t.after(() => {
    try {
      process.kill(owner.pid, 'SIGTERM');
    } catch {
      /* already exited */
    }
  });
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
