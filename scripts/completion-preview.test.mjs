import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { previewFixture } from './test-support/completion-preview-fixture.mjs';
import { checkCompletionRuntime } from './task-completion.mjs';
import { requestResponse } from './dev-task.mjs';

const plan = { anchor: '/repo/main', task: '/repo/task', preview: '/repo/preview-current', common: '/repo/.git' };
test('an unavailable retained preview is explicitly started full and verified through real probes', async (t) => {
  const f = await previewFixture(t, plan);
  const result = await f.control.ensure(plan);
  assert.equal(result.reused, false);
  assert.equal(f.starts, 1);
  assert.equal(f.bindings, 1);
  await f.control.ensure(plan);
  assert.equal(f.starts, 1, 'healthy retained preview must not restart');
  assert.equal(f.bindings, 2);
});
for (const problem of [
  'foreign-owner',
  'unknown-owner',
  'unknown-phase',
  'unowned-child',
  'offline-unknown',
  'old-task-selected',
  'foreign-launcher',
  'startup',
  '503',
  'wrong-worktree',
  'frontend-mode',
  'integration-api',
  'wrong-branch',
  'data-binding',
]) {
  test(`real retained preview checks refuse ${problem}`, async (t) => {
    const f = await previewFixture(t, plan);
    if (problem === 'foreign-owner') f.state.worktree = '/other/task';
    if (problem === 'unknown-owner') delete f.state.worktree;
    if (problem === 'unknown-phase') f.state.phase = 'unrecognized';
    if (problem === 'unowned-child') f.state.childPid = 42;
    if (problem === 'offline-unknown') Object.assign(f.state, { phase: 'offline', selectionKnown: false });
    if (problem === 'old-task-selected') f.state.worktree = plan.task;
    if (problem === 'foreign-launcher') f.foreignLauncher = true;
    if (problem === 'startup') f.failStart = true;
    if (problem === '503') f.health = 503;
    if (problem === 'wrong-worktree') f.metadata.workspaceRoot = '/other/task';
    if (problem === 'frontend-mode') f.metadata.mode = 'frontend';
    if (problem === 'integration-api') f.metadata.apiTarget = 'http://127.0.0.1:8080';
    if (problem === 'wrong-branch') f.metadata.branch = 'codex/other';
    if (problem === 'data-binding') f.failData = true;
    await assert.rejects(f.control.ensure(plan));
    if (
      [
        'foreign-owner',
        'unknown-owner',
        'unknown-phase',
        'unowned-child',
        'offline-unknown',
        'old-task-selected',
        'foreign-launcher',
      ].includes(problem)
    )
      assert.equal(f.starts, 0);
  });
}
test('all permitted isolated backend ports remain valid, and later health failure is never reused', async (t) => {
  const f = await previewFixture(t, plan);
  f.metadata.apiTarget = 'http://127.0.0.1:8099';
  await f.control.ensure(plan);
  f.health = 503;
  await assert.rejects(f.control.check(plan));
});
test('only preflight may tolerate missing preview; final runtime and integration/data checks stay strict', async (t) => {
  const root = mkdtempSync('/tmp/zdm-runtime-probe-');
  mkdirSync(path.join(root, 'preview-environment'));
  const backupFile = path.join(root, 'backup.sql');
  writeFileSync(backupFile, 'fixture backup');
  const profile = {
    status: 'ready',
    database: 'zdm_task_1234567890abcdef',
    mediaVolume: 'zdm-task-media-1234567890abcdef',
    backupFile,
  };
  writeFileSync(
    path.join(root, 'preview-environment/environment.json'),
    JSON.stringify({ version: 1, repository: root, profile }),
  );
  let failing = 'preview',
    malformed = false;
  const server = http.createServer((req, res) => {
    const bad = req.url.includes(failing);
    res.statusCode = bad && !malformed ? 503 : 200;
    res.end(malformed && bad ? 'not-json' : JSON.stringify({ status: 'UP' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  const request = (url) =>
    requestResponse(
      `http://127.0.0.1:${server.address().port}/${url.includes(':5175/') ? 'preview' : url.includes(':8080/') ? 'backend' : 'frontend'}`,
    );
  const before = await checkCompletionRuntime(root, root, { request, allowPreviewUnavailable: true });
  assert.equal(before.integrationHealthy, true);
  assert.equal(before.runtimeHealthy, false);
  assert.equal(before.backupRetained, true);
  await assert.rejects(checkCompletionRuntime(root, root, { request }), /Runtime unavailable/);
  failing = 'backend';
  await assert.rejects(
    checkCompletionRuntime(root, root, { request, allowPreviewUnavailable: true }),
    /Runtime unavailable/,
  );
  failing = 'preview';
  malformed = true;
  await assert.rejects(checkCompletionRuntime(root, root, { request }), /Runtime unavailable/);
  failing = 'none';
  const after = await checkCompletionRuntime(root, root, { request });
  assert.equal(after.runtimeHealthy, true);
  assert.equal(after.profileFingerprint, before.profileFingerprint);
  rmSync(backupFile);
  await assert.rejects(
    checkCompletionRuntime(root, root, { request, allowPreviewUnavailable: true }),
    /backup is unavailable/,
  );
});
