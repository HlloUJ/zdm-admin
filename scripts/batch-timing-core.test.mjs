import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  newTimeline,
  ingestNative,
  ingestContext,
  summarizeBatch,
  assertTimingReady,
  subtract,
} from './batch-timing-core.mjs';
const source = { thread: 'thread' };
const start = 1700000000000;
function state() {
  const value = newTimeline({
    batch: 'timing',
    common: '/repo/.git',
    anchor: '/repo',
    worktree: '/task',
    authorizedAt: start,
    requestId: 'request',
    thread: 'thread',
  });
  value.sources.push({ thread: 'thread' });
  return value;
}
function row(type, turn, at, extra = {}) {
  return {
    timestamp: new Date(start + at).toISOString(),
    type: 'event_msg',
    payload: { type, turn_id: turn, ...extra },
  };
}
function put(s, r) {
  ingestNative(s, r, source);
  ingestContext(s, r, source);
}
function begin(s, id, at) {
  put(s, row('task_started', id, at));
  put(s, {
    timestamp: new Date(start + at).toISOString(),
    type: 'turn_context',
    payload: { turn_id: id, cwd: '/repo' },
  });
}
function question(s, id, at) {
  put(s, row('item_completed', 'one', at, { item: { type: 'AgentMessage', id, questions: [{}] } }));
}
function answer(s, id, at) {
  put(
    s,
    row('item_completed', 'two', at, {
      item: {
        type: 'UserMessage',
        id: 'reply',
        content: [
          {
            type: 'text',
            text:
              '<send_user_message_question_reply>' +
              JSON.stringify([
                { questionItemId: JSON.stringify(['request_user_input_async', id, 0]), answer: 'PRIVATE answer' },
              ]) +
              '</send_user_message_question_reply>',
          },
        ],
      },
    }),
  );
}
test('authorization to final reply is distinct from delivery closure; subsequent questions stay outside', () => {
  const s = state();
  begin(s, 'one', 0);
  s.delivery = { closedAt: start + 500 };
  const pending = summarizeBatch(s, { now: start + 600 });
  assert.equal(pending.status, 'awaiting-turn-end');
  assert.equal(pending.finalReplyCompleteAt, null);
  put(s, row('task_complete', 'one', 700));
  put(s, row('task_started', 'unrelated', 900));
  const final = summarizeBatch(s, { now: start + 1500 });
  assert.equal(final.status, 'completed');
  assert.equal(final.wallMs, 700);
  assert.equal(s.turns.length, 1);
});
test('asynchronous question work stays active; CI and response latency are overlays', () => {
  const s = state();
  begin(s, 'one', 0);
  question(s, 'approval', 100);
  put(s, row('task_complete', 'one', 300));
  begin(s, 'two', 800);
  answer(s, 'approval', 850);
  s.delivery = { closedAt: start + 900 };
  put(s, row('task_complete', 'two', 1000));
  const summary = summarizeBatch(s, {
    completion: { events: [{ name: 'ci', startedAt: start + 150, finishedAt: start + 950 }], pauses: [] },
  });
  assert.equal(summary.wallMs, 1000);
  assert.equal(summary.executionRoundsMs, 500);
  assert.equal(summary.approvalBlockedMs, 500);
  assert.equal(summary.approvalResponseLatencyMs, 750);
  assert.equal(summary.ciWaitMs, 800);
  assert.equal(summary.unclassifiedBetweenRoundsMs, 0);
  assert.equal(summary.status, 'completed');
  assert.ok(!JSON.stringify(s).includes('PRIVATE'));
});
test('explicit pause and overlapping questions partition once without idle inference', () => {
  const s = state();
  begin(s, 'one', 0);
  question(s, 'a', 100);
  question(s, 'b', 120);
  put(s, row('task_complete', 'one', 200));
  begin(s, 'two', 900);
  answer(s, 'a', 910);
  answer(s, 'b', 920);
  s.delivery = { closedAt: start + 950 };
  put(s, row('task_complete', 'two', 1000));
  const r = summarizeBatch(s, {
    completion: { pauses: [{ startedAt: start + 300, finishedAt: start + 500 }], events: [] },
  });
  assert.equal(r.approvalBlockedMs, 500);
  assert.equal(r.explicitPauseOutsideRoundsMs, 200);
  assert.equal(r.executionRoundsMs, 300);
  assert.equal(r.wallMs, 1000);
});
test('between-round boundaries are measured even when their cause is unknown', () => {
  const s = state();
  begin(s, 'one', 0);
  put(s, row('task_complete', 'one', 100));
  begin(s, 'two', 900);
  assert.equal(summarizeBatch(s, { now: start + 1000 }).unclassifiedBetweenRoundsMs, 800);
  assertTimingReady(s, { now: start + 1000 });
});
for (const fault of ['missing-context', 'conflict', 'foreign-root', 'open-prior', 'bad-reply', 'missing-reply'])
  test('boundary proof rejects ' + fault, () => {
    const s = state();
    begin(s, 'one', 0);
    if (fault === 'missing-context' || fault === 'foreign-root') s.turns[0].projectVerified = false;
    if (fault === 'conflict') put(s, row('task_started', 'one', 1));
    if (fault === 'bad-reply')
      put(
        s,
        row('item_completed', 'one', 10, {
          item: {
            type: 'UserMessage',
            id: 'x',
            content: [
              { type: 'text', text: '<send_user_message_question_reply>broken</send_user_message_question_reply>' },
            ],
          },
        }),
      );
    if (fault === 'missing-reply') question(s, 'pending', 10);
    if (fault !== 'open-prior') put(s, row('task_complete', 'one', 100));
    begin(s, 'two', 200);
    s.delivery = { closedAt: start + 250 };
    put(s, row('task_complete', 'two', 300));
    assert.throws(() => assertTimingReady(s, { now: start + 400 }));
  });
test('same-source duplicate events are idempotent and interval subtraction preserves endpoints', () => {
  const s = state();
  begin(s, 'one', 0);
  const end = row('task_complete', 'one', 100);
  put(s, end);
  put(s, end);
  assert.equal(s.turns.length, 1);
  assert.equal(summarizeBatch(s, { now: start + 100 }).executionRoundsMs, 100);
  assert.deepEqual(
    subtract(
      [
        [0, 100],
        [50, 150],
      ],
      [
        [20, 30],
        [80, 120],
      ],
    ),
    [
      [0, 20],
      [30, 80],
      [120, 150],
    ],
  );
});
test('retained real PR73 metadata automatically explains the original 47m gap and full multi-turn duration', () => {
  const f = JSON.parse(readFileSync(new URL('./test-support/batch-timing-replay.json', import.meta.url)));
  const s = newTimeline({
    batch: 'replay',
    common: '/repo/.git',
    anchor: '/repo',
    worktree: '/task',
    authorizedAt: f.authorizedAt,
    requestId: f.requestId,
    thread: f.thread,
    initialTurn: f.records.find((r) => r.payload.type === 'task_started').payload.turn_id,
  });
  const src = { thread: f.thread };
  s.sources.push(src);
  for (const r of f.records) {
    if (Date.parse(r.timestamp) > f.closedAt && !s.delivery) s.delivery = { closedAt: f.closedAt };
    ingestNative(s, r, src);
    ingestContext(s, r, src);
  }
  const r = summarizeBatch(s, { now: f.closedAt + 100000 });
  assert.equal(r.status, 'completed');
  assert.equal(r.wallMs, 5074724);
  assert.equal(r.approvalBlockedMs, 2538310);
  assert.equal(r.executionRoundsMs, 2536414);
  assert.equal(r.unclassifiedBetweenRoundsMs, 0);
  assertTimingReady(s, { now: f.closedAt + 100000 });
});
