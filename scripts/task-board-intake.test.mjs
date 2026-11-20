import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoardIntake } from './task-board-intake.mjs';
import { receiveCodexTask } from './task-codex-host.mjs';
const owner = '11111111-1111-4111-8111-111111111111';
const input = {
  taskId: 'fixture-task',
  title: 'isolated fixture',
  owner,
  rootThreadId: owner,
  request: { messageId: 'user-execute', roomId: owner, authorId: 'fixture-user', sequence: 3 },
};
const board = () => ({
  id: input.taskId,
  title: input.title,
  task_number: '123',
  revision: 1,
  status: 'active',
  board_column: 'active',
});
const source = async () => ({
  thread: { id: owner },
  turns: [{ items: [{ type: 'userMessage', id: input.request.messageId }] }],
});
const context = () => ({
  executionSurface: 'codex-thread',
  taskStableId: input.taskId,
  taskName: input.title,
  taskNumber: '123',
  rootThreadId: owner,
  authorizationRef: input.request.messageId,
});
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'intake-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, intake: createBoardIntake(root) };
}
test('create response alone cannot authorize work; fixed-ID readback is required', async (t) => {
  const { intake } = fixture(t);
  let reads = 0,
    created = 0;
  await assert.rejects(
    intake.accept(input, {
      readThread: source,
      readTask: async () => {
        reads++;
        return null;
      },
      createTask: async () => {
        created++;
        return board();
      },
    }),
    /Wrong board/,
  );
  assert.equal(created, 1);
  assert.equal(reads, 2);
  assert.throws(() => intake.require(context(), input.taskId, owner), /state|accepted/);
});
test('existing record is reused, readback is durable and bound to task/owner/instruction', async (t) => {
  const { intake } = fixture(t);
  let reads = 0;
  await intake.accept(input, {
    readThread: source,
    readTask: async () => {
      reads++;
      return board();
    },
    createTask: () => assert.fail('duplicate create'),
  });
  assert.equal(reads, 2);
  assert.equal(intake.require(context(), input.taskId, owner).number, '123');
  assert.throws(() => intake.require({ ...context(), taskNumber: '999' }, input.taskId, owner));
  assert.throws(() => intake.require({ ...context(), authorizationRef: 'other' }, input.taskId, owner));
  assert.throws(() => intake.require(context(), input.taskId, 'other'));
});
test('transport errors do not cause blind creation', async (t) => {
  const { intake } = fixture(t);
  await assert.rejects(
    intake.accept(input, {
      readThread: source,
      readTask: async () => {
        throw Error('transport');
      },
      createTask: () => assert.fail('must not create'),
    }),
    /transport/,
  );
});
test('wrong card, archived, numberless and wrong task are refused', async (t) => {
  const { intake } = fixture(t);
  for (const patch of [
    { status: 'done' },
    { deleted_at: 'now' },
    { task_number: null },
    { id: 'another' },
    { board_column: 'review' },
    { revision: 0 },
  ])
    await assert.rejects(
      intake.accept(input, { readThread: source, readTask: async () => ({ ...board(), ...patch }) }),
    );
});
test('readback changed after create is refused and start cannot run', async (t) => {
  const { intake } = fixture(t);
  let reads = 0;
  await assert.rejects(
    receiveCodexTask(input, {
      intake,
      readThread: source,
      readTask: async () => (++reads === 1 ? null : { ...board(), id: 'other' }),
      createTask: async () => board(),
      preflight: () => assert.fail('no preflight'),
      start: () => assert.fail('no start'),
    }),
  );
});
test('missing original execution message is refused before any board write', async (t) => {
  const { intake } = fixture(t);
  await assert.rejects(
    intake.accept(input, {
      readThread: async () => ({ thread: { id: owner }, turns: [] }),
      readTask: () => assert.fail('no board mutation'),
    }),
    /Original execution/,
  );
});
test('expired receipt requires fresh readback, not recreation', async (t) => {
  const { intake } = fixture(t);
  await intake.accept(input, { readThread: source, readTask: async () => board(), now: 1000 });
  assert.throws(() => intake.require(context(), input.taskId, owner, { now: 301001 }), /expired/);
  await intake.accept(input, { readThread: source, readTask: async () => board() });
  assert.equal(intake.require(context(), input.taskId, owner).state, 'accepted');
});
test('concurrent or interrupted intake writer preserves original lock', async (t) => {
  const { root, intake } = fixture(t);
  const dir = path.join(root, 'task-board-intake');
  mkdirSync(dir);
  const lock = path.join(dir, 'fixture-task.json.lock');
  mkdirSync(lock);
  await assert.rejects(intake.accept(input, { readThread: source, readTask: async () => board() }), /EEXIST/);
  assert.ok(existsSync(lock));
});
