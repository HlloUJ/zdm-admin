import test from 'node:test';
import assert from 'node:assert/strict';
import { continuityBoardPatch } from './task-continuity-board.mjs';
const observation = { task: 'fixture-task', status: 'interrupted', reason: 'Recorded stage owner ended' };
const binding = { task: observation.task, taskStableId: 'stable-fixture' };
const current = { id: binding.taskStableId, revision: 3, status: 'merging', updated_at: new Date(0).toISOString() };
test('truthful interruption patch preserves merge lane and only targets exact existing record', () => {
  const patch = continuityBoardPatch(observation, binding, current, 1000, 1001);
  assert.equal(patch.revision, 3);
  assert.equal(patch.id, current.id);
  assert.equal(Object.hasOwn(patch, 'status'), false);
  assert.match(patch.current_work, /尚未证明安全续接/);
  assert.throws(() => continuityBoardPatch(observation, binding, { ...current, id: 'other' }, 1000, 1001));
});
test('newer owner state, completed task and unobserved task are never overwritten', () => {
  assert.equal(
    continuityBoardPatch(observation, binding, { ...current, updated_at: new Date(1001).toISOString() }, 1000, 1001),
    null,
  );
  assert.equal(continuityBoardPatch(observation, binding, { ...current, status: 'done' }, 1000, 1001), null);
  assert.equal(continuityBoardPatch({ ...observation, status: 'unobserved' }, binding, current, 1000, 1001), null);
});
test('same patch does not churn revisions and stale snapshots are refused', () => {
  const patch = continuityBoardPatch(observation, binding, current, 1000, 1001);
  assert.equal(continuityBoardPatch(observation, binding, { ...current, ...patch }, 1000, 1001), null);
  assert.throws(() => continuityBoardPatch(observation, binding, current, 1000, 122000));
});
test('connector receives exact id/revision and cannot authorize task recovery', async () => {
  const { syncContinuityBoard } = await import('./task-continuity-board.mjs');
  const result = await syncContinuityBoard({
    observation,
    binding,
    observedAt: 1000,
    now: () => 1001,
    readTask: async (id) => {
      assert.equal(id, current.id);
      return current;
    },
    updateTask: async (patch) => {
      assert.equal(patch.revision, 3);
      assert.equal(patch.id, current.id);
      return { id: patch.id, revision: 4 };
    },
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.resumePermitted, false);
});
test('concurrent revision conflict is retained without retry or overwriting newer state', async () => {
  const { syncContinuityBoard } = await import('./task-continuity-board.mjs');
  let calls = 0;
  const newer = { ...current, revision: 4, current_work: '原执行者已恢复' };
  const before = JSON.stringify(newer);
  const result = await syncContinuityBoard({
    observation,
    binding,
    observedAt: 1000,
    now: () => 1001,
    readTask: async () => current,
    updateTask: async (patch) => {
      calls++;
      assert.notEqual(patch.revision, newer.revision);
      throw new Error('revision conflict');
    },
  });
  assert.equal(result.status, 'unconfirmed');
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(newer), before);
});
test('uncertain connector receipt must be read back, never repeated', async () => {
  const { syncContinuityBoard } = await import('./task-continuity-board.mjs');
  let calls = 0;
  const result = await syncContinuityBoard({
    observation,
    binding,
    observedAt: 1000,
    now: () => 1001,
    readTask: async () => current,
    updateTask: async () => {
      calls++;
      return { isError: true };
    },
  });
  assert.equal(result.status, 'unconfirmed');
  assert.equal(calls, 1);
  assert.equal(result.resumePermitted, false);
});

test('foreign source task and incomplete board state fail closed', () => {
  assert.throws(() => continuityBoardPatch({ ...observation, task: 'foreign' }, binding, current, 1000, 1001));
  assert.throws(() => continuityBoardPatch(observation, binding, { ...current, updated_at: null }, 1000, 1001));
  assert.throws(() => continuityBoardPatch(observation, binding, { ...current, revision: undefined }, 1000, 1001));
});
test('isolated read-only journal to event, exact board patch and deduplicated safe notice', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, realpathSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { inspectTaskContinuity, notifyContinuityChanges } = await import('./task-continuity.mjs');
  const { continuityHandoffs } = await import('./task-continuity-handoff.mjs');
  const { syncContinuityBoard } = await import('./task-continuity-board.mjs');
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'continuity-closed-loop-')));
  const journal = path.join(directory, 'session.json');
  const original = JSON.stringify({
    version: 1,
    batch: observation.task,
    events: [{ id: 'failed-prepare', name: 'prepare', status: 'failure' }],
  });
  writeFileSync(journal, original);
  const observed = inspectTaskContinuity(
    { id: observation.task, stage: 'validating' },
    JSON.parse(readFileSync(journal)),
  );
  const mapped = { ...binding, worker: '/root/fixture', owner: 'fixture-owner', authorization: 'fixture-only' };
  const [event] = continuityHandoffs([observed], { [observed.task]: mapped }, 1000);
  assert.equal(event.taskStableId, current.id);
  assert.equal(event.canReplayCommands, false);
  let board = { ...current };
  const other = { id: 'untouched', revision: 8 };
  const result = await syncContinuityBoard({
    observation: event.observation,
    binding: mapped,
    observedAt: 1000,
    now: () => 1001,
    readTask: async (id) => {
      assert.equal(id, board.id);
      return board;
    },
    updateTask: async (patch) => {
      assert.equal(patch.revision, board.revision);
      board = { ...board, ...patch, revision: board.revision + 1 };
      return board;
    },
  });
  assert.equal(result.status, 'updated');
  assert.equal(result.resumePermitted, false);
  assert.equal(board.status, 'merging');
  assert.deepEqual(other, { id: 'untouched', revision: 8 });
  let sends = 0;
  const send = async (notice) => {
    sends++;
    assert.match(notice.body, /Original stage failure/);
    return { status: 'unknown' };
  };
  const noticeDirectory = path.join(directory, 'notices');
  assert.equal((await notifyContinuityChanges([observed], noticeDirectory, { send }))[0].status, 'unknown');
  assert.deepEqual(await notifyContinuityChanges([observed], noticeDirectory, { send }), []);
  assert.equal(sends, 1);
  const nextFailure = inspectTaskContinuity(
    { id: observation.task, stage: 'validating' },
    { version: 1, batch: observation.task, events: [{ id: 'second-failure', name: 'prepare', status: 'failure' }] },
  );
  await notifyContinuityChanges([nextFailure], noticeDirectory, { send });
  assert.equal(sends, 2);
  assert.equal(readFileSync(journal, 'utf8'), original);
});
