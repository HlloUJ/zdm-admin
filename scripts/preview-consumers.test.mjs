import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPreviewConsumers } from './preview-consumers.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import { assertPreviewConsumersReleased } from './task-preview-service.mjs';

const closed = { statusCode: 0, errorCode: 'ECONNREFUSED' };
const task = { id: 'a', worktree: '/repo/a', branch: 'codex/a' };
const metadata = (worktree = '/repo/a', api = 8081) => ({
  type: 'zdm-task-preview',
  workspaceRoot: worktree,
  branch: 'codex/' + worktree.split('/').at(-1),
  mode: 'full',
  apiTarget: `http://127.0.0.1:${api}`,
});
const response = (meta) => ({ statusCode: 200, body: JSON.stringify(meta) });
const lease = {
  port: 5188,
  resource: 'temporary-port-5188',
  task: 'b',
  pid: process.pid,
  token: 'fixed-observed-owner',
};

for (const unavailable of [
  { statusCode: 0, errorCode: 'ETIMEDOUT' },
  { statusCode: 0, errorCode: 'ECONNRESET' },
  { statusCode: 503, body: 'unavailable' },
  { statusCode: 200, body: 'not-json' },
  closed,
])
  test(`a leased consumer without verifiable metadata blocks both stop and cleanup: ${JSON.stringify(unavailable)}`, async () => {
    const dependencies = {
      readLeases: () => [lease],
      request: async (url) => {
        const port = Number(new URL(url).port);
        return port === 5188 ? unavailable : [5175, 5176].includes(port) ? response(metadata()) : closed;
      },
    };
    await assert.rejects(
      taskRuntimeReferences(task, { ...dependencies, backendPorts: () => [8081] }),
      /unknown on leased port 5188/,
    );
    await assert.rejects(
      assertPreviewConsumersReleased(task.worktree, dependencies.request, dependencies),
      /unknown on leased port 5188/,
    );
  });
test('only a closed exact temporary port owned by this process may finish its own cleanup', async () => {
  const own = { ...lease, task: 'a' };
  const dependencies = { readLeases: () => [own], request: async () => closed, backendPorts: () => [] };
  await assert.rejects(taskRuntimeReferences(task, dependencies), /unknown on leased port/);
  assert.deepEqual((await taskRuntimeReferences(task, { ...dependencies, closingLeases: [own] })).owned, []);
  await assert.rejects(
    taskRuntimeReferences(task, { ...dependencies, closingLeases: [{ ...own, token: 'stale' }] }),
    /unknown on leased port/,
  );
  for (const changed of [{ task: 'b' }, { pid: process.pid + 1 }])
    await assert.rejects(
      taskRuntimeReferences(task, {
        ...dependencies,
        closingLeases: [own],
        readLeases: () => [{ ...own, ...changed }],
      }),
      /unknown on leased port/,
    );
  await assert.rejects(
    taskRuntimeReferences(task, {
      ...dependencies,
      closingLeases: [own],
      request: async (url) => (Number(new URL(url).port) === 5188 ? { statusCode: 503 } : closed),
    }),
    /unknown on leased port/,
  );
});
test('independent healthy leased B and unrelated unleased web servers remain untouched', async () => {
  const r = await taskRuntimeReferences(task, {
    backendPorts: () => [8081],
    readLeases: () => [lease],
    request: async (url) => {
      const port = Number(new URL(url).port);
      return [5175, 5176, 5188].includes(port)
        ? response(metadata('/repo/b', 8082))
        : { statusCode: 200, body: '<html>other application</html>' };
    },
  });
  assert.deepEqual(r.owned, []);
});
test('unknown fixed entries and unleased transport failures do not become absence evidence', async () => {
  for (const failure of [
    { statusCode: 0, errorCode: 'ETIMEDOUT' },
    { statusCode: 503 },
    { statusCode: 200, body: 'wrong service' },
  ])
    await assert.rejects(
      inspectPreviewConsumers(
        { worktree: task.worktree, ports: [5176] },
        { request: async () => failure, readLeases: () => [] },
      ),
      /state is unknown/,
    );
});
test('lease appearance, disappearance or changed nonce during probing prevents a stale clearance', async () => {
  for (const after of [[], [{ ...lease, token: 'changed' }]]) {
    let reads = 0;
    await assert.rejects(
      inspectPreviewConsumers(
        { worktree: task.worktree, ports: [5188] },
        {
          readLeases: () => (reads++ ? after : [lease]),
          request: async () => response(metadata('/repo/b', 8082)),
        },
      ),
      /leases changed/,
    );
  }
});
