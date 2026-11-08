import assert from 'node:assert/strict';
import test from 'node:test';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
const task = { id: 'a', worktree: '/repo/a', branch: 'codex/a' };
const metadata = (worktree, port) => ({
  statusCode: 200,
  body: JSON.stringify({
    type: 'zdm-task-preview',
    workspaceRoot: worktree,
    branch: 'codex/' + worktree.split('/').at(-1),
    mode: 'frontend',
    apiTarget: `http://127.0.0.1:${port}`,
  }),
});
test('another selected or temporary frontend referencing A backend blocks before any stopping action', async () => {
  for (const port of [5175, 5188])
    await assert.rejects(
      taskRuntimeReferences(task, {
        backendPorts: () => [8081],
        readLeases: () => [],
        request: async (url) =>
          Number(new URL(url).port) === port ? metadata('/repo/b', 8081) : { statusCode: 0, errorCode: 'ECONNREFUSED' },
      }),
      /Another frontend still uses/,
    );
});
test('own temporary frontends are identified while an independent B backend and unknown web server are preserved', async () => {
  const proof = await taskRuntimeReferences(task, {
    backendPorts: () => [8081],
    readLeases: () => [],
    request: async (url) => {
      const port = Number(new URL(url).port);
      if ([5175, 5176].includes(port)) return metadata('/repo/b', 8082);
      if (port === 5178) return metadata('/repo/a', 8081);
      return { statusCode: 200, body: '<html>unrelated</html>' };
    },
  });
  assert.deepEqual(
    proof.owned.map((item) => item.port),
    [5178],
  );
  assert.deepEqual(proof.backendPorts, [8081]);
});
