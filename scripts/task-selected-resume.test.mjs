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

function completedSelectedDevelopment(t) {
  const f = fixture(t);
  f.direction.members = f.members.map((m) => ({ ...m, kind: 'infrastructure' }));
  f.queue.direct(f.direction);
  const finish = (lane, task) => {
    const current = f.queue.read().tickets.find((t) => t.lane === lane && t.task === task);
    return f.queue.complete({ ...admission(current), evidence: { task, head: 'fixture-verified' } }, () => true);
  };
  const development = finish('development', 'task-1');
  return {
    ...f,
    finish,
    input: { task: 'task-1', owner: 'owner-1', developmentEvidenceDigest: development.completion.digest },
  };
}
test('engineering phase admission derives from exact restore and completed development while preserving serial delivery', (t) => {
  const f = completedSelectedDevelopment(t),
    before = f.queue.read();
  assert.throws(
    () =>
      f.queue.promoteDelivery(
        f.input,
        () => assert.fail('638 retains slot'),
        () => true,
      ),
    /serial slot/,
  );
  assert.deepEqual(f.queue.read(), before);
  f.finish('delivery', 'delivery');
  const unselected = f.queue.read().tickets.filter((t) => ['task-2', 'task-3', 'task-5'].includes(t.task));
  const result = f.queue.promoteDelivery(
    f.input,
    (development, authorization) => {
      assert.equal(development.task, 'task-1');
      assert.deepEqual(authorization.request, f.direction.request);
      assert.equal(authorization.kind, 'infrastructure');
      return true;
    },
    () => true,
  );
  assert.equal(result.lane, 'delivery');
  assert.equal(result.status, 'running');
  assert.equal(f.queue.assertAdmission(admission(result)).active, true);
  const state = f.queue.read();
  assert.equal(state.paused, true);
  assert.deepEqual(
    state.tickets.filter((t) => ['task-2', 'task-3', 'task-5'].includes(t.task)),
    unselected,
  );
  assert.deepEqual(state.events.at(-1).request, f.direction.request);
  assert.equal(state.events.at(-1).action, 'promote-delivery');
  const again = f.queue.promoteDelivery(
    f.input,
    () => assert.fail('no repeat verification or phase start'),
    () => assert.fail('no repeat dependency action'),
  );
  assert.deepEqual(again, result);
  assert.deepEqual(f.queue.read(), state);
});
test('phase derivation rejects missing evidence, dependencies, wrong owner and later pause without inventing a user event', (t) => {
  const f = completedSelectedDevelopment(t);
  f.finish('delivery', 'delivery');
  const before = f.queue.read();
  for (const [input, verify, dependencies] of [
    [{ ...f.input, developmentEvidenceDigest: 'changed' }, () => true, () => true],
    [{ ...f.input, owner: 'other' }, () => true, () => true],
    [f.input, () => false, () => true],
    [f.input, () => true, () => false],
  ]) {
    assert.throws(() => f.queue.promoteDelivery(input, verify, dependencies));
    assert.deepEqual(f.queue.read(), before);
  }
  f.queue.direct({ action: 'pause-all', request: source(102) });
  const paused = f.queue.read();
  assert.throws(
    () =>
      f.queue.promoteDelivery(
        f.input,
        () => true,
        () => true,
      ),
    /later pause/,
  );
  assert.deepEqual(f.queue.read(), paused);
});
test('blocked derived delivery holds its serial slot and replay cannot revive it or launch a successor', (t) => {
  const f = completedSelectedDevelopment(t);
  f.finish('delivery', 'delivery');
  const first = f.queue.promoteDelivery(
    f.input,
    () => true,
    () => true,
  );
  f.queue.block({ lane: 'delivery', task: first.task, owner: first.owner, reason: 'actual failure' });
  const second = f.finish('development', 'task-4');
  const before = f.queue.read();
  assert.equal(
    f.queue.promoteDelivery(
      f.input,
      () => assert.fail('blocked replay does not execute'),
      () => true,
    ).status,
    'blocked',
  );
  assert.throws(
    () =>
      f.queue.promoteDelivery(
        { task: 'task-4', owner: 'owner-4', developmentEvidenceDigest: second.completion.digest },
        () => true,
        () => true,
      ),
    /serial slot/,
  );
  assert.deepEqual(f.queue.read(), before);
});
test('eligible engineering deliveries retain receipt order, with only proven dependency ordering allowed', (t) => {
  const f = completedSelectedDevelopment(t);
  f.finish('delivery', 'delivery');
  const second = f.finish('development', 'task-4');
  const input = { task: 'task-4', owner: 'owner-4', developmentEvidenceDigest: second.completion.digest };
  assert.throws(
    () =>
      f.queue.promoteDelivery(
        input,
        () => true,
        () => true,
      ),
    /Earlier eligible/,
  );
  f.queue.direct({
    action: 'set-limits',
    request: source(102),
    limits: { development: null, delivery: 1 },
    dependenciesFirst: true,
  });
  assert.equal(
    f.queue.promoteDelivery(
      input,
      () => true,
      (t) => t.task !== 'task-1',
    ).task,
    'task-4',
  );
});
test('business or untyped development never inherits engineering self-delivery authority', (t) => {
  const f = fixture(t);
  f.queue.direct(f.direction);
  const current = f.queue.read().tickets.find((t) => t.task === 'task-1');
  const completed = f.queue.complete({ ...admission(current), evidence: { verified: true } }, () => true);
  assert.throws(
    () =>
      f.queue.promoteDelivery(
        { task: 'task-1', owner: 'owner-1', developmentEvidenceDigest: completed.completion.digest },
        () => true,
        () => true,
      ),
    /engineering lifecycle/,
  );
});
test('explicit delivery resume preserves selected developer scopes instead of consuming their reservations', (t) => {
  const f = fixture(t);
  f.queue.direct(f.direction);
  const previous = f.queue.read(),
    delivery = previous.tickets.find((t) => t.task === 'delivery');
  f.queue.complete({ ...admission(delivery), evidence: { verified: true } }, () => true);
  f.queue.enqueue({ lane: 'delivery', task: 'next-delivery', owner: 'next-owner', request: source(102) });
  f.queue.direct({
    action: 'resume-only',
    lane: 'delivery',
    task: 'next-delivery',
    owner: 'next-owner',
    request: source(103),
  });
  const state = f.queue.read();
  assert.deepEqual(state.scopedAdmissions, previous.scopedAdmissions);
  assert.equal(state.scopedAdmission.task, 'next-delivery');
  for (const task of ['task-1', 'task-4'])
    assert.equal(f.queue.assertAdmission(admission(state.tickets.find((t) => t.task === task))).active, true);
});

test('an explicit new delivery resume preserves derived authorization and records its new admission', (t) => {
  const f = completedSelectedDevelopment(t);
  f.finish('delivery', 'delivery');
  const original = f.queue.promoteDelivery(
    f.input,
    () => true,
    () => true,
  );
  f.queue.block({ lane: 'delivery', task: original.task, owner: original.owner, reason: 'known interruption' });
  f.queue.direct({
    action: 'resume-only',
    lane: 'delivery',
    task: original.task,
    owner: original.owner,
    request: source(102),
  });
  const resumed = f.queue.read().tickets.find((t) => t.lane === 'delivery' && t.task === original.task);
  assert.notEqual(resumed.admission, original.admission);
  assert.deepEqual(resumed.derivedAuthorization, original.derivedAuthorization);
  assert.equal(f.queue.assertAdmission(admission(resumed)).active, true);
});
