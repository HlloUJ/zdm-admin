import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authorizeTaskCoordinator, readTaskCoordination, requireTaskCoordinator } from './task-coordination.mjs';

test('current coordination has native authority, revision protection and read-only replay without changing task owners', async (t) => {
  const common = realpathSync(mkdtempSync(path.join(tmpdir(), 'task-coordination-')));
  const root = '11111111-1111-4111-8111-111111111111',
    replacement = '22222222-2222-4222-8222-222222222222';
  const previous = process.env.CODEX_THREAD_ID;
  t.after(() => {
    rmSync(common, { recursive: true, force: true });
    if (previous === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previous;
  });
  process.env.CODEX_THREAD_ID = root;
  const input = {
    rootThreadId: root,
    expectedRevision: 0,
    request: { messageId: 'explicit-current-coordinator', roomId: root, authorId: 'human', sequence: 5 },
  };
  const host = {
    readThread: async (id) => ({
      thread: { id },
      turns: [{ items: [{ type: 'userMessage', id: input.request.messageId }] }],
    }),
  };
  assert.equal(readTaskCoordination(common), null);
  const first = await authorizeTaskCoordinator(common, input, host);
  assert.equal(first.current.rootThreadId, root);
  const file = path.join(common, 'task-coordination/current.json'),
    original = readFileSync(file);
  assert.deepEqual(await authorizeTaskCoordinator(common, input, host), first);
  assert.deepEqual(readFileSync(file), original);
  assert.throws(() => requireTaskCoordinator(common, replacement), /current authorized coordinator/);
  assert.doesNotThrow(() => requireTaskCoordinator(common, root));
  process.env.CODEX_THREAD_ID = replacement;
  const second = {
    rootThreadId: replacement,
    expectedRevision: 1,
    request: { ...input.request, roomId: replacement, messageId: 'fresh-new-coordinator', sequence: 6 },
  };
  const newHost = {
    readThread: async (id) => ({
      thread: { id },
      turns: [{ items: [{ type: 'userMessage', id: second.request.messageId }] }],
    }),
  };
  await assert.rejects(authorizeTaskCoordinator(common, { ...second, expectedRevision: 0 }, newHost), /revision/);
  await assert.rejects(
    authorizeTaskCoordinator(common, { ...second, request: { ...second.request, authorId: 'other' } }, newHost),
    /Original coordination user/,
  );
  const changed = await authorizeTaskCoordinator(common, second, newHost);
  assert.equal(changed.revision, 2);
  assert.deepEqual(changed.history[0], first.current);
  assert.throws(() => requireTaskCoordinator(common, root), /historical root/);
});
