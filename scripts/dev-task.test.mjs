import assert from 'node:assert/strict';
import test from 'node:test';

import {
  backendSensitiveFiles,
  findAvailablePort,
  parseTaskPreviewArgs,
  selectSharedNodeModules,
  taskPreviewErrors,
} from './dev-task.mjs';

test('parses task preview overrides', () => {
  assert.deepEqual(parseTaskPreviewArgs(['--port', '5180', '--api', 'http://127.0.0.1:8081']), {
    port: 5180,
    apiTarget: 'http://127.0.0.1:8081',
    help: false,
  });
  assert.throws(() => parseTaskPreviewArgs(['--port', '5173']), /5174/);
  assert.throws(() => parseTaskPreviewArgs(['--port', '5200']), /5199/);
  assert.throws(() => parseTaskPreviewArgs(['--unknown']), /未知参数/);
});

test('requires a task branch and a running backend', () => {
  assert.deepEqual(taskPreviewErrors({ branch: 'codex/task-preview', backendReady: true }), []);
  assert.deepEqual(taskPreviewErrors({ branch: 'main', backendReady: false }), [
    '只能从 codex/* 任务分支启动预览，当前为：main',
    '共享集成后端未运行，先启动 npm run integration:dev',
  ]);
});

test('chooses the first available preview port', async () => {
  const port = await findAvailablePort({
    start: 5174,
    end: 5177,
    isOpen: async (candidate) => candidate < 5176,
  });
  assert.equal(port, 5176);
});

test('identifies changes that are not loaded by the shared integration backend', () => {
  assert.deepEqual(
    backendSensitiveFiles([
      'src/pages/example.vue',
      'backend/src/main/java/example.java',
      'docker-compose.yml',
      'tests/e2e/example.spec.ts',
    ]),
    ['backend/src/main/java/example.java', 'docker-compose.yml'],
  );
});

test('does not select dependencies without an identical lockfile', () => {
  assert.equal(selectSharedNodeModules({ root: '/missing/root', worktrees: [] }), null);
});
