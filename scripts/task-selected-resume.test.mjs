import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createExecutionOrder } from './task-execution-order.mjs';
import { executionPausedFor } from './task-execution-scope.mjs';
const source = (n) => ({ messageId: 'fixture-' + n, roomId: 'fixture-room', authorId: 'fixture-user', sequence: n });
function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'selected-resume-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const queue = createExecutionOrder(root);
  queue.initialize(source(1));
  queue.direct({ action: 'resume-all', request: source(2) });
  queue.direct({ action: 'set-limits', limits: { development: null, delivery: 1 }, request: source(3) });
  for (let n = 1; n <= 5; n++) {
    queue.enqueue({ lane: 'development', task: 'task-' + n, owner: 'owner-' + n, request: source(10 + n) });
    if (n <= 3) queue.claim({ lane: 'development', task: 'task-' + n, owner: 'owner-' + n });
  }
  queue.enqueue({ lane: 'delivery', task: 'delivery', owner: 'delivery-owner', request: source(20) });
  queue.direct({ action: 'pause-all', request: source(90) });
  queue.direct({
    action: 'resume-only',
    lane: 'delivery',
    task: 'delivery',
    owner: 'delivery-owner',
    request: source(100),
  });
  const members = [
    { lane: 'development', task: 'task-1', owner: 'owner-1' },
    { lane: 'development', task: 'task-4', owner: 'owner-4' },
  ];
  return {
    root,
    queue,
    members,
    direction: {
      action: 'resume-selected',
      members,
      request: source(101),
      capacity: { limit: 4, activeDevelopment: 0, activeDelivery: 1, activeOther: 0 },
    },
  };
}
const admission = (t) => ({ lane: t.lane, task: t.task, owner: t.owner, admission: t.admission });
test('selected developers coexist with exact active delivery while all unselected held tickets remain paused', (t) => {
  const { queue, direction, members } = fixture(t);
  const before = queue.read();
  queue.direct(direction);
  const after = queue.read();
  assert.equal(after.paused, true);
  assert.deepEqual(after.scopedAdmission, before.scopedAdmission);
  assert.equal(after.scopedAdmissions.length, 2);
  for (const old of before.tickets) {
    const current = after.tickets.find((x) => x.lane === old.lane && x.task === old.task);
    if (members.some((m) => m.lane === old.lane && m.task === old.task)) {
      assert.equal(queue.assertAdmission(admission(current)).active, true);
      assert.equal(executionPausedFor(after, current), false);
    } else {
      assert.deepEqual(current, old);
      if (old.lane === 'development') assert.throws(() => queue.assertAdmission(admission(current)), /paused/);
    }
  }
});
test('repeat exact restore does not rotate admissions; a changed source target or capacity is refused', (t) => {
  const { queue, direction } = fixture(t);
  queue.direct(direction);
  const before = queue.read();
  queue.direct(direction);
  const after = queue.read();
  assert.deepEqual(after.tickets, before.tickets);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.scopedAdmissions, before.scopedAdmissions);
  assert.throws(() => queue.direct({ ...direction, members: direction.members.slice(0, 1) }));
  assert.throws(() => queue.direct({ ...direction, capacity: { ...direction.capacity, limit: 8 } }));
});
test('capacity unknown, exhausted, double delivery and omitted active delivery all fail without mutation', (t) => {
  const { queue, direction } = fixture(t);
  const before = queue.read();
  for (const capacity of [
    undefined,
    { limit: 2, activeDevelopment: 0, activeDelivery: 1, activeOther: 0 },
    { limit: 4, activeDevelopment: 0, activeDelivery: 2, activeOther: 0 },
    { limit: 4, activeDevelopment: 0, activeDelivery: 0, activeOther: 0 },
    { limit: 4, activeDevelopment: 0, activeDelivery: 1, activeOther: 2 },
  ]) {
    assert.throws(() => queue.direct({ ...direction, capacity }));
    assert.deepEqual(queue.read(), before);
  }
});
test('foreign owner, user, room, duplicate target and delivery member cannot be selected', (t) => {
  const { queue, direction } = fixture(t);
  const before = queue.read();
  for (const change of [
    { members: [{ ...direction.members[0], owner: 'wrong' }] },
    { request: { ...direction.request, authorId: 'wrong' } },
    { request: { ...direction.request, roomId: 'wrong' } },
    { members: [direction.members[0], direction.members[0]] },
    { members: [{ lane: 'delivery', task: 'delivery', owner: 'delivery-owner' }] },
  ]) {
    assert.throws(() => queue.direct({ ...direction, ...change }));
    assert.deepEqual(queue.read(), before);
  }
});
test('completion removes only its own selected exception; original delivery lease remains usable', (t) => {
  const { queue, direction } = fixture(t);
  queue.direct(direction);
  const current = queue.read().tickets.find((t) => t.task === 'task-1');
  queue.complete({ ...admission(current), evidence: { verified: true } }, () => true);
  const state = queue.read();
  assert.equal(state.scopedAdmissions.length, 1);
  assert.equal(state.scopedAdmissions[0].task, 'task-4');
  assert.equal(queue.assertAdmission(admission(state.tickets.find((t) => t.task === 'delivery'))).active, true);
  assert.equal(state.paused, true);
});
test('new pause revokes all selections; replay of old direction cannot restore them', (t) => {
  const { queue, direction } = fixture(t);
  queue.direct(direction);
  queue.direct({ action: 'pause-all', request: source(102) });
  queue.direct(direction);
  const state = queue.read();
  assert.equal(state.scopedAdmissions, undefined);
  assert.equal(state.scopedAdmission, undefined);
  for (const task of ['task-1', 'task-4', 'delivery'])
    assert.throws(() => queue.assertAdmission(admission(state.tickets.find((t) => t.task === task))), /paused/);
});
test('corrupted selected admission cannot become a paused-state bypass', (t) => {
  const { root, queue, direction } = fixture(t);
  queue.direct(direction);
  const state = queue.read();
  state.scopedAdmissions[0].admission = 'fabricated';
  writeFileSync(path.join(root, 'task-registry/execution-order/state.json'), JSON.stringify(state));
  assert.throws(() => queue.read());
});
