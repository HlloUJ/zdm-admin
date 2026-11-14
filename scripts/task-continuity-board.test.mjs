import test from 'node:test';
import assert from 'node:assert/strict';
import { continuityBoardPatch } from './task-continuity-board.mjs';
const observation = { task: 'fixture-task', status: 'interrupted', reason: 'Recorded stage owner ended' };
const binding = { taskStableId: 'stable-fixture' };
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
