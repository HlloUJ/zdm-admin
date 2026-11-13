import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationOutbox, schedulingNotice, submitMacNotification } from './task-resource-notifications.mjs';
const notice = schedulingNotice({
  id: 1,
  job: 'job-one',
  task: '921',
  stage: 'tests',
  from: 'queued',
  to: 'starting',
  reason: 'Resources stable',
  at: 1700000000000,
});
function setup(extra = {}) {
  let state = { notices: {} };
  const store = { read: () => structuredClone(state), write: (s) => (state = structuredClone(s)) };
  const calls = [];
  const options = {
    store,
    mac: async (n) => {
      calls.push('mac');
      return { eventId: n.eventId, status: 'submitted' };
    },
    board: async (n) => {
      calls.push('board');
      return { eventId: n.eventId, status: 'recorded', receipt: 'row' };
    },
    ...extra,
  };
  return {
    options,
    calls,
    outbox: createNotificationOutbox(options),
    get state() {
      return state;
    },
  };
}
test('stable event ID and readable task/reason/time', () => {
  assert.equal(
    notice.eventId,
    schedulingNotice({
      id: 1,
      job: 'job-one',
      task: '921',
      stage: 'tests',
      from: 'queued',
      to: 'starting',
      reason: 'Resources stable',
      at: 1700000000000,
    }).eventId,
  );
  assert.match(notice.body, /921/);
  assert.match(notice.body, /Resources stable/);
});
test('two independent channels and successful replay creates no duplicates', async () => {
  const s = setup();
  s.outbox.enqueue(notice);
  await s.outbox.pump();
  assert.deepEqual(s.calls, ['mac', 'board']);
  assert.equal(s.outbox.enqueue(notice), false);
  const restored = createNotificationOutbox(s.options);
  await restored.pump();
  assert.deepEqual(s.calls, ['mac', 'board']);
  assert.equal(restored.snapshot()[notice.eventId].mac.status, 'submitted');
});
test('unknown Mac result does not block board and is not blindly retried', async () => {
  const s = setup({
    mac: async () => {
      throw Error('timeout');
    },
  });
  s.outbox.enqueue(notice);
  await s.outbox.pump();
  await s.outbox.pump();
  assert.equal(s.calls.length, 1);
  assert.equal(s.outbox.snapshot()[notice.eventId].mac.status, 'unknown');
  assert.equal(s.outbox.snapshot()[notice.eventId].board.status, 'recorded');
});
test('confirmed not-submitted failures have bounded attempts', async () => {
  let calls = 0,
    time = 0;
  const s = setup({
    mac: async () => {
      calls++;
      return { status: 'not-submitted', error: 'permission not granted' };
    },
    now: () => time,
  });
  s.outbox.enqueue(notice);
  for (let i = 0; i < 5; i++) {
    await s.outbox.pump();
    time += 100000;
  }
  assert.equal(calls, 3);
  assert.equal(s.outbox.snapshot()[notice.eventId].mac.status, 'failed');
});
test('restart during sending preserves ambiguity instead of generating duplicate banner', () => {
  const record = {
    notice,
    mac: { status: 'sending', attempts: 1 },
    board: { status: 'pending', attempts: 0, nextAt: 0 },
  };
  let state = { notices: { [notice.eventId]: record } };
  const store = { read: () => state, write: (s) => (state = s) };
  const outbox = createNotificationOutbox({ store, mac: async () => {}, board: async () => {} });
  assert.equal(outbox.snapshot()[notice.eventId].mac.status, 'unknown');
});
test('osascript transport passes text as argv, never modifies notification/security settings', () => {
  let called;
  const result = submitMacNotification(
    { ...notice, body: '" & malicious text' },
    {
      execute: (command, args) => {
        called = { command, args };
        return '';
      },
    },
  );
  assert.equal(called.command, '/usr/bin/osascript');
  assert.equal(called.args.at(-1), '" & malicious text');
  assert.equal(result.status, 'submitted');
  assert.equal(result.visibility, 'unverified');
  assert.equal(
    submitMacNotification(notice, {
      execute: () => {
        throw Error('unavailable');
      },
    }).status,
    'unknown',
  );
});
test('board receipt mismatch does not claim written', async () => {
  const s = setup({ board: async () => ({ status: 'recorded', eventId: 'wrong', receipt: 'row' }) });
  s.outbox.enqueue(notice);
  await s.outbox.pump();
  assert.equal(s.outbox.snapshot()[notice.eventId].board.status, 'unknown');
});

test('Mac-only mode disables legacy pending dashboard channel without fabricating delivery', async () => {
  const s = setup();
  s.outbox.enqueue(notice);
  const { board: unused, ...localOptions } = s.options;
  const local = createNotificationOutbox(localOptions);
  await local.pump();
  const record = local.snapshot()[notice.eventId];
  assert.equal(record.board.status, 'disabled');
  assert.equal(record.board.previousStatus, 'pending');
  assert.deepEqual(s.calls, ['mac']);
});
