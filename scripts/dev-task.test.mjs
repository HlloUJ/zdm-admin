import assert from 'node:assert/strict';
import test from 'node:test';

import {
  backendSensitiveFiles,
  findAvailablePort,
  parseBackendPortBindings,
  parseTaskPreviewArgs,
  selectSharedNodeModules,
  selectTaskPreviewMode,
  taskPreviewErrors,
  taskProjectName,
} from './dev-task.mjs';

test('parses task preview mode, ports, target worktree, and stop options', () => {
  assert.deepEqual(
    parseTaskPreviewArgs([
      '--mode',
      'full',
      '--port',
      '5180',
      '--backend-port',
      '8088',
      '--worktree',
      '/tmp/task',
      '--stop',
    ]),
    {
      port: 5180,
      backendPort: 8088,
      apiTarget: null,
      mode: 'full',
      worktree: '/tmp/task',
      stop: true,
      help: false,
    },
  );
  assert.throws(() => parseTaskPreviewArgs(['--port', '5173']), /5174/);
  assert.throws(() => parseTaskPreviewArgs(['--backend-port', '8080']), /8081/);
  assert.throws(() => parseTaskPreviewArgs(['--mode', 'unknown']), /auto/);
});

test('requires a task branch', () => {
  assert.deepEqual(taskPreviewErrors({ branch: 'codex/task-preview' }), []);
  assert.deepEqual(taskPreviewErrors({ branch: 'main' }), ['只能预览 codex/* 任务分支，当前为：main']);
});

test('routes frontend-only changes to shared backend and backend changes to full stack', () => {
  assert.equal(selectTaskPreviewMode({ files: ['src/pages/example.vue'] }), 'frontend');
  assert.equal(selectTaskPreviewMode({ files: ['backend/src/main/java/example.java'] }), 'full');
  assert.equal(selectTaskPreviewMode({ files: ['src/pages/example.vue'], requestedMode: 'full' }), 'full');
  assert.equal(
    selectTaskPreviewMode({ files: ['backend/src/main/java/example.java'], apiTarget: 'http://127.0.0.1:9000' }),
    'frontend',
  );
});

test('chooses the first available port', async () => {
  const port = await findAvailablePort({
    start: 5174,
    end: 5177,
    isOpen: async (candidate) => candidate < 5176,
  });
  assert.equal(port, 5176);
});

test('identifies changes that require a task backend', () => {
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

test('creates a stable and worktree-specific Compose project name', () => {
  const first = taskProjectName({ branch: 'codex/Category Attribute', root: '/tmp/a' });
  const second = taskProjectName({ branch: 'codex/Category Attribute', root: '/tmp/a' });
  assert.equal(first, second);
  assert.match(first, /^zdm-task-category-attribute-[a-f0-9]{10}$/);
  assert.notEqual(first, taskProjectName({ branch: 'codex/Category Attribute', root: '/tmp/b' }));
});

test('reads a task backend port from Docker bindings', () => {
  assert.equal(parseBackendPortBindings('{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8086"}]}'), 8086);
  assert.equal(parseBackendPortBindings('{}'), null);
  assert.equal(parseBackendPortBindings('invalid'), null);
});

test('does not select dependencies without an identical lockfile', () => {
  assert.equal(selectSharedNodeModules({ root: '/missing/root', worktrees: [] }), null);
});
