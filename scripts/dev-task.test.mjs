import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import viteConfig from '../vite.config.js';

const syncIntegrationSource = readFileSync(new URL('./sync-integration.mjs', import.meta.url), 'utf8');
const taskPreviewSource = readFileSync(new URL('./dev-task.mjs', import.meta.url), 'utf8');

import {
  backendSensitiveFiles,
  chooseTaskFrontendPort,
  CURRENT_TASK_FRONTEND_PORT,
  databaseLockError,
  databaseRiskFiles,
  findAvailablePort,
  mergeMigrationCatalog,
  parseBackendPortBindings,
  parseDatabaseLock,
  parseTaskPreviewArgs,
  parseTaskPreviewMetadata,
  previewServiceOwnsWorktree,
  selectSharedNodeModules,
  selectTaskPreviewMode,
  taskPreviewReadinessErrors,
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
      '--temporary',
      '--database-risk',
      '--stop',
    ]),
    {
      port: 5180,
      backendPort: 8088,
      apiTarget: null,
      mode: 'full',
      worktree: '/tmp/task',
      temporary: true,
      databaseRisk: true,
      handoff: false,
      stop: true,
      check: false,
      help: false,
    },
  );
  assert.throws(() => parseTaskPreviewArgs(['--port', '5174']), /5175/);
  assert.throws(() => parseTaskPreviewArgs(['--backend-port', '8080']), /8081/);
  assert.throws(() => parseTaskPreviewArgs(['--mode', 'unknown']), /auto/);
  assert.equal(parseTaskPreviewArgs(['--handoff']).handoff, true);
  assert.equal(parseTaskPreviewArgs(['--check']).check, true);
});

test('makes integration sync invoke the mandatory task handoff', () => {
  assert.match(syncIntegrationSource, /dev:task:handoff/);
  assert.match(syncIntegrationSource, /任务交接：completed/);
});

test('makes task handoff stop the old managed preview before its backend', () => {
  const handoffStart = taskPreviewSource.indexOf('async function handoffDatabaseTask');
  const handoffEnd = taskPreviewSource.indexOf('function targetViteConfig', handoffStart);
  const handoffSource = taskPreviewSource.slice(handoffStart, handoffEnd);
  const previewStop = handoffSource.indexOf('await stopSupervisedPreview(root);');
  const backendStop = handoffSource.indexOf("composeRun(context, ['stop', 'backend']);", previewStop);
  assert.ok(handoffStart >= 0);
  assert.ok(handoffEnd > handoffStart);
  assert.ok(previewStop >= 0);
  assert.ok(backendStop > previewStop);
});

test('scopes preview supervisor shutdown to the handed-off worktree', () => {
  const status = { type: 'zdm-task-preview-service', worktree: '/tmp/task-a' };
  assert.equal(previewServiceOwnsWorktree(status, '/tmp/task-a'), true);
  assert.equal(previewServiceOwnsWorktree(status, '/tmp/task-b'), false);
  assert.equal(previewServiceOwnsWorktree({ type: 'other', worktree: '/tmp/task-a' }, '/tmp/task-a'), false);
});

test('uses one fixed current-task port and reserves dynamic ports for temporary previews', async () => {
  assert.equal(await chooseTaskFrontendPort(), CURRENT_TASK_FRONTEND_PORT);
  assert.equal(await chooseTaskFrontendPort({ temporary: true, isOpen: async (candidate) => candidate < 5178 }), 5178);
  assert.equal(await chooseTaskFrontendPort({ requestedPort: 5188 }), 5188);
});

test('recognizes managed task preview metadata including its API route', () => {
  assert.deepEqual(
    parseTaskPreviewMetadata(
      JSON.stringify({
        type: 'zdm-task-preview',
        workspaceRoot: '/tmp/task',
        branch: 'codex/task',
        mode: 'frontend',
        apiTarget: 'http://127.0.0.1:8080',
      }),
    ),
    {
      type: 'zdm-task-preview',
      workspaceRoot: '/tmp/task',
      branch: 'codex/task',
      mode: 'frontend',
      apiTarget: 'http://127.0.0.1:8080',
    },
  );
  assert.equal(parseTaskPreviewMetadata('{"type":"other"}'), null);
  assert.equal(parseTaskPreviewMetadata('invalid'), null);
});

test('requires exact preview identity and an UP response through the frontend proxy', () => {
  const metadata = {
    type: 'zdm-task-preview',
    workspaceRoot: '/tmp/task',
    branch: 'codex/task',
    mode: 'frontend',
    apiTarget: 'http://127.0.0.1:8080',
  };
  assert.deepEqual(
    taskPreviewReadinessErrors({
      metadata,
      expectedWorkspaceRoot: '/tmp/task',
      expectedBranch: 'codex/task',
      expectedMode: 'frontend',
      expectedApiTarget: 'http://127.0.0.1:8080',
      healthStatus: 200,
      healthBody: '{"status":"UP"}',
    }),
    [],
  );
  assert.match(
    taskPreviewReadinessErrors({
      metadata: { type: 'zdm-task-preview', workspaceRoot: '/tmp/old', branch: 'codex/old' },
      healthStatus: 200,
      healthBody: '<html></html>',
    }).join('\n'),
    /版本过旧/,
  );
  assert.match(
    taskPreviewReadinessErrors({
      metadata,
      expectedWorkspaceRoot: '/tmp/other',
      healthStatus: 502,
    }).join('\n'),
    /不是 \/tmp\/other/,
  );
  assert.match(
    taskPreviewReadinessErrors({ metadata, healthStatus: 200, healthBody: '<html></html>' }).join('\n'),
    /非 JSON/,
  );
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

test('treats only Flyway migrations as automatic shared-database risk', () => {
  assert.deepEqual(
    databaseRiskFiles([
      'backend/src/main/java/example.java',
      'backend/src/main/resources/db/migration/V40__example.sql',
      'src/pages/example.vue',
    ]),
    ['backend/src/main/resources/db/migration/V40__example.sql'],
  );
});

test('combines integration and task migrations while rejecting version or checksum conflicts', () => {
  assert.deepEqual(
    mergeMigrationCatalog({
      integrationFiles: [
        { name: 'V1__base.sql', content: 'base' },
        { name: 'V2__shared.sql', content: 'shared' },
      ],
      taskFiles: [
        { name: 'V1__base.sql', content: 'base' },
        { name: 'V3__task.sql', content: 'task' },
      ],
    }).map((entry) => entry.name),
    ['V1__base.sql', 'V2__shared.sql', 'V3__task.sql'],
  );
  assert.throws(
    () =>
      mergeMigrationCatalog({
        integrationFiles: [{ name: 'V2__shared.sql', content: 'shared' }],
        taskFiles: [{ name: 'V2__other.sql', content: 'other' }],
      }),
    /版本 V2/,
  );
  assert.throws(
    () =>
      mergeMigrationCatalog({
        integrationFiles: [{ name: 'V2__shared.sql', content: 'shared' }],
        taskFiles: [{ name: 'V2__shared.sql', content: 'changed' }],
      }),
    /内容冲突/,
  );
});

test('recognizes and scopes a shared-database task lock', () => {
  const lock = parseDatabaseLock(
    JSON.stringify({
      type: 'zdm-shared-database-lock',
      project: 'zdm-task-a',
      branch: 'codex/a',
      workspaceRoot: '/tmp/a',
      backupFile: '/tmp/a.sql.gz',
    }),
  );
  assert.equal(databaseLockError(lock, { project: 'zdm-task-a', branch: 'codex/a' }), null);
  assert.match(databaseLockError(lock, { project: 'zdm-task-b', branch: 'codex/b' }), /codex\/a/);
  assert.equal(parseDatabaseLock('{"type":"other"}'), null);
});

test('task Compose reuses integration MySQL and contains no task database storage', () => {
  const compose = readFileSync(new URL('../docker-compose.task.yml', import.meta.url), 'utf8');
  assert.match(compose, /jdbc:mysql:\/\/zdm-platform-mysql:3306\/zdm_admin/);
  assert.match(compose, /SPRING_FLYWAY_LOCATIONS: filesystem:\/task-migrations/);
  assert.match(compose, /target: \/task-migrations/);
  assert.match(compose, /com\.zdm\.task\.database: integration/);
  assert.doesNotMatch(compose, /^\s{2}mysql:/m);
  assert.doesNotMatch(compose, /\/var\/lib\/mysql|tmpfs:/);
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

test('roots task preview assets and aliases in the selected worktree', () => {
  const previousPreview = process.env.ZDM_TASK_PREVIEW;
  const previousWorkspace = process.env.ZDM_TASK_WORKSPACE;
  const previousMode = process.env.ZDM_TASK_MODE;
  const previousApiTarget = process.env.ZDM_API_PROXY_TARGET;
  const selectedWorktree = '/tmp/zdm-selected-task-worktree';

  process.env.ZDM_TASK_PREVIEW = '1';
  process.env.ZDM_TASK_WORKSPACE = selectedWorktree;
  process.env.ZDM_TASK_MODE = 'frontend';
  process.env.ZDM_API_PROXY_TARGET = 'http://127.0.0.1:8080';
  try {
    const config = viteConfig({ mode: 'development' });
    assert.equal(config.root, resolve(selectedWorktree));
    assert.equal(config.resolve.alias['@'], resolve(selectedWorktree, 'src'));
    assert.equal(
      config.plugins.some((plugin) => plugin.name === 'zdm-task-preview-control'),
      true,
    );
    assert.equal(config.server.proxy['/__zdm_task_preview_api_health__'].target, 'http://127.0.0.1:8080');
    assert.equal(config.server.proxy['/__zdm_task_preview_api_health__'].rewrite(), '/actuator/health');
  } finally {
    if (previousPreview === undefined) delete process.env.ZDM_TASK_PREVIEW;
    else process.env.ZDM_TASK_PREVIEW = previousPreview;
    if (previousWorkspace === undefined) delete process.env.ZDM_TASK_WORKSPACE;
    else process.env.ZDM_TASK_WORKSPACE = previousWorkspace;
    if (previousMode === undefined) delete process.env.ZDM_TASK_MODE;
    else process.env.ZDM_TASK_MODE = previousMode;
    if (previousApiTarget === undefined) delete process.env.ZDM_API_PROXY_TARGET;
    else process.env.ZDM_API_PROXY_TARGET = previousApiTarget;
  }
});
