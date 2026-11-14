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
