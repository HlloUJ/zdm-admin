import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import viteConfig from '../vite.config.js';
import { runtimeDigest, taskBackendContainerIdentity } from './task-runtime-state.mjs';
import { PreviewSupervisor } from './task-preview-service.mjs';

const syncIntegrationSource = readFileSync(new URL('./sync-integration.mjs', import.meta.url), 'utf8');
const taskPreviewSource = readFileSync(new URL('./dev-task.mjs', import.meta.url), 'utf8');

import {
  snapshotAppliedMigrations,
  stopSupervisedPreview,
  handoffDatabaseTask,
  ensureTaskBackend,
  runtimeWatchFile,
  createBackendWatchers,
  withRuntimeStartupWatch,
  verifyPausedCatalog,
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
  taskPublicOrigin,
  taskPreviewReadinessErrors,
  taskPreviewCheckExpectations,
  taskPreviewChangedFiles,
  taskPreviewErrors,
  taskProjectName,
} from './dev-task.mjs';

test('keeps the public task origin separate from the internal managed port', () => {
  assert.equal(taskPublicOrigin(5176, ''), 'http://127.0.0.1:5176');
  assert.equal(taskPublicOrigin(5176, 'http://127.0.0.1:5175/'), 'http://127.0.0.1:5175');
  assert.throws(() => taskPublicOrigin(5176, 'file:///tmp/task'), /只支持 http 或 https/);
});

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
  assert.match(syncIntegrationSource, /new URL\('\.\/dev-task\.mjs', import\.meta\.url\)/);
  assert.match(syncIntegrationSource, /'--handoff'/);
  assert.match(syncIntegrationSource, /任务交接：completed/);
});

test('makes task handoff stop the old managed preview before its backend', () => {
  const handoffStart = taskPreviewSource.indexOf('async function handoffDatabaseTask');
  const handoffEnd = taskPreviewSource.indexOf('function targetViteConfig', handoffStart);
  const handoffSource = taskPreviewSource.slice(handoffStart, handoffEnd);
  const previewStop = handoffSource.indexOf('await stopSupervised(root);');
  const backendStop = handoffSource.indexOf('stopBackend();', previewStop);
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

const supervisorStatus = (fields = {}) => ({
  type: 'zdm-task-preview-service',
  worktree: null,
  childPid: null,
  phase: 'integration-fallback',
  mode: 'integration-fallback',
  ...fields,
});
const supervisorResponse = (status, statusCode = 200) => ({ statusCode, body: JSON.stringify(status) });
const activeSupervisorStatus = () =>
  supervisorStatus({ worktree: '/task', childPid: 123, phase: 'running', mode: 'task' });

test('supervised stop requires proof of child exit after a failed or incomplete stop response', async () => {
  for (const finalResponse of [
    supervisorResponse(supervisorStatus({ childPid: 123, phase: 'running' })),
    supervisorResponse(activeSupervisorStatus()),
    supervisorResponse(supervisorStatus({ childPid: undefined })),
    supervisorResponse({ type: 'other', worktree: null, childPid: null }),
    { statusCode: 0, body: '' },
    { statusCode: 200, body: 'invalid' },
  ]) {
    for (const stopCode of [200, 500]) {
      const responses = [supervisorResponse(activeSupervisorStatus()), supervisorResponse({}, stopCode), finalResponse];
      const calls = [];
      await assert.rejects(
        stopSupervisedPreview('/task', {
          request: async (...args) => {
            calls.push(args);
            return responses.shift();
          },
        }),
        /未能证明旧任务进程已停止/,
      );
      assert.deepEqual(calls, [
        ['GET', '/status'],
        ['POST', '/stop'],
        ['GET', '/status'],
      ]);
    }
  }
});

test('supervised stop accepts confirmed exit and never stops another task or an absent supervisor', async () => {
  for (const acknowledged of [true, false]) {
    const responses = [
      supervisorResponse(activeSupervisorStatus()),
      acknowledged ? supervisorResponse(supervisorStatus()) : supervisorResponse({}, 500),
      ...(!acknowledged ? [supervisorResponse(supervisorStatus())] : []),
    ];
    assert.equal(await stopSupervisedPreview('/task', { request: async () => responses.shift() }), true);
    assert.equal(responses.length, 0);
  }
  for (const response of [
    supervisorResponse(supervisorStatus()),
    supervisorResponse(activeSupervisorStatus()),
    { statusCode: 0, body: '', absent: true },
  ]) {
    let requests = 0;
    assert.equal(
      await stopSupervisedPreview('/other', {
        request: async () => {
          requests++;
          return response;
        },
      }),
      false,
    );
    assert.equal(requests, 1);
  }
});

test('supervised stop blocks unknown initial state and a retry with a live unowned child', async () => {
  for (const response of [
    { statusCode: 0, body: '' },
    { statusCode: 200, body: 'invalid' },
    supervisorResponse(supervisorStatus({ childPid: 123, phase: 'running' })),
  ]) {
    let requests = 0;
    await assert.rejects(
      stopSupervisedPreview('/task', {
        request: async () => {
          requests++;
          return response;
        },
      }),
      /无法确认/,
    );
    assert.equal(requests, 1);
  }
});

test('an actual supervisor stop failure blocks handoff and its retry before backend restore or lock release', async () => {
  const gateway = {
    mode: 'task',
    status() {
      return { mode: this.mode, upstream: 'mock', listening: true };
    },
    useIntegration() {
      this.mode = 'integration-fallback';
    },
  };
  const supervisor = new PreviewSupervisor(
    { logFile: '/unused' },
    { selectedWorktree: '/task', taskArgs: [] },
    gateway,
    {
      writeConfig() {},
      stopChild: async () => {
        throw new Error('injected child stop failure');
      },
    },
  );
  supervisor.child = { pid: 123, exitCode: null };
  supervisor.currentWorktree = '/task';
  supervisor.phase = 'running';
  const request = async (method) => {
    if (method === 'GET') return supervisorResponse(supervisor.status());
    try {
      return supervisorResponse(await supervisor.stop());
    } catch (error) {
      return supervisorResponse({ error: error.message }, 500);
    }
  };
  const events = [];
  const runHandoff = () =>
    handoffDatabaseTask(
      { root: '/task', branch: 'codex/task', project: 'task', integrationRoot: '/integration', context: {} },
      {
        readLock: () => ({ project: 'task', branch: 'codex/task', backupFile: '/retained/backup.sql' }),
        captureGit: () => 'merged',
        contains: () => true,
        snapshot: () => ({ worktreeClean: true }),
        readReceipt: () => null,
        writeReceipt: (_, proof) => events.push(proof.status),
        stopSupervised: (root) => stopSupervisedPreview(root, { request }),
        currentPreview: async () => events.push('fallback-preview'),
        stopBackend: () => events.push('stop-backend'),
        restoreBackend: async () => events.push('restore-backend'),
        releaseLock: () => events.push('release-lock'),
      },
    );
  await assert.rejects(runHandoff(), /未能证明旧任务进程已停止/);
  assert.equal(supervisor.status().worktree, null);
  assert.equal(supervisor.status().childPid, 123);
  await assert.rejects(runHandoff(), /无法确认/);
  assert.deepEqual(events, ['pending', 'pending']);
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
  assert.equal(parseBackendPortBindings('{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8080"}]}'), null);
  assert.equal(parseBackendPortBindings('{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8100"}]}'), null);
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
    assert.equal(config.cacheDir, resolve(selectedWorktree, '.task-runtime/cache/vite'));
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

test('pause snapshots only applied migrations and rejects missing or failed history', () => {
  const catalog = [
    { name: 'V1__a.sql', content: 'SELECT 1;' },
    { name: 'V2__b.sql', content: 'SELECT 2;' },
  ];
  const snapshot = snapshotAppliedMigrations(catalog, [{ script: 'V1__a.sql', success: '1' }]);
  assert.equal(snapshot.length, 1);
  assert.deepEqual(verifyPausedCatalog({ type: 'zdm-paused-database-task', catalog: snapshot }), [catalog[0]]);
  assert.throws(() => snapshotAppliedMigrations(catalog, [{ script: 'V3__missing.sql', success: '1' }]), /找不到/);
  assert.throws(() => snapshotAppliedMigrations(catalog, [{ script: 'V1__a.sql', success: '0' }]), /失败/);
  assert.throws(
    () => verifyPausedCatalog({ type: 'zdm-paused-database-task', catalog: [{ ...snapshot[0], content: 'changed' }] }),
    /校验失败/,
  );
  assert.throws(
    () =>
      verifyPausedCatalog({ type: 'zdm-paused-database-task', catalog: [{ ...snapshot[0], name: '../V1__a.sql' }] }),
    /校验失败/,
  );
});

test('pause is an explicit operation and does not imply delivery', () => {
  const options = parseTaskPreviewArgs(['--pause', '--worktree', '/tmp/owned-task']);
  assert.equal(options.pause, true);
  assert.equal(options.handoff, false);
  assert.equal(options.stop, false);
});

test('worktree checks reject a stale branch and a frontend preview when the task needs its own backend', () => {
  const metadata = {
    workspaceRoot: '/tmp/task',
    branch: 'codex/task',
    mode: 'frontend',
    apiTarget: 'http://127.0.0.1:8080',
  };
  const input = { root: '/tmp/task', branch: 'codex/task', files: ['src/page.vue'], metadata };
  assert.throws(
    () => taskPreviewCheckExpectations({ ...input, metadata: { ...metadata, branch: 'codex/old' } }),
    /不是 codex\/task/,
  );
  assert.throws(
    () => taskPreviewCheckExpectations({ ...input, files: ['backend/src/main/java/Service.java'] }),
    /必须使用 full/,
  );
  assert.throws(() => taskPreviewCheckExpectations({ ...input, branch: '' }), /只能预览/);
});

test('worktree checks preserve explicit full mode and bind it to the registered task backend port', () => {
  const metadata = {
    workspaceRoot: '/tmp/task',
    branch: 'codex/task',
    mode: 'full',
    apiTarget: 'http://127.0.0.1:8083',
  };
  const input = {
    root: '/tmp/task',
    branch: 'codex/task',
    files: ['src/page.vue'],
    metadata,
    registeredBackendPort: 8083,
  };
  const expected = taskPreviewCheckExpectations(input);
  assert.equal(expected.expectedMode, 'full');
  assert.equal(expected.expectedApiTarget, 'http://127.0.0.1:8083');
  assert.deepEqual(
    taskPreviewReadinessErrors({ metadata, ...expected, healthStatus: 200, healthBody: '{"status":"UP"}' }),
    [],
  );
  assert.match(
    taskPreviewReadinessErrors({
      metadata: { ...metadata, apiTarget: 'http://127.0.0.1:8080' },
      ...expected,
      healthStatus: 200,
      healthBody: '{"status":"UP"}',
    }).join('\n'),
    /不是 http/,
  );
  assert.throws(() => taskPreviewCheckExpectations({ ...input, registeredBackendPort: null }), /无法证明/);
});

test('frontend worktree checks use the shared API or an independently registered explicit API target', () => {
  const metadata = {
    workspaceRoot: '/tmp/task',
    branch: 'codex/task',
    mode: 'frontend',
    apiTarget: 'http://127.0.0.1:9000',
  };
  const input = { root: '/tmp/task', branch: 'codex/task', files: ['src/page.vue'], metadata };
  const defaultExpected = taskPreviewCheckExpectations(input);
  assert.equal(defaultExpected.expectedApiTarget, 'http://127.0.0.1:8080');
  assert.match(
    taskPreviewReadinessErrors({ metadata, ...defaultExpected, healthStatus: 200, healthBody: '{"status":"UP"}' }).join(
      '\n',
    ),
    /不是 http/,
  );
  const explicitExpected = taskPreviewCheckExpectations({ ...input, registeredApiTarget: metadata.apiTarget });
  assert.deepEqual(
    taskPreviewReadinessErrors({ metadata, ...explicitExpected, healthStatus: 200, healthBody: '{"status":"UP"}' }),
    [],
  );
});

test('worktree runtime scope includes committed, staged, unstaged, deleted and untracked changes', (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'zdm-runtime-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'runtime@example.invalid');
  git('config', 'user.name', 'Runtime fixture');
  mkdirSync(resolve(root, 'backend'), { recursive: true });
  for (const file of ['committed.java', 'deleted.java', 'staged.java', 'unstaged.java', 'renamed.java'])
    writeFileSync(resolve(root, 'backend', file), 'baseline');
  git('add', '.');
  git('commit', '-m', 'baseline', '--no-verify');
  git('checkout', '-b', 'codex/task');
  writeFileSync(resolve(root, 'backend/committed.java'), 'committed');
  git('add', '.');
  git('commit', '-m', 'task change', '--no-verify');
  writeFileSync(resolve(root, 'backend/staged.java'), 'staged');
  git('add', '.');
  writeFileSync(resolve(root, 'backend/unstaged.java'), 'unstaged');
  rmSync(resolve(root, 'backend/deleted.java'));
  writeFileSync(resolve(root, 'backend/untracked.java'), 'untracked');
  git('mv', 'backend/renamed.java', 'backend/rename target.java');
  writeFileSync(resolve(root, 'backend/ leading\nname.java'), 'untracked special');
  writeFileSync(resolve(root, ' leading\nroot.java'), 'untracked root special');
  assert.deepEqual(taskPreviewChangedFiles(root), [
    ' leading\nroot.java',
    'backend/ leading\nname.java',
    'backend/committed.java',
    'backend/deleted.java',
    'backend/rename target.java',
    'backend/renamed.java',
    'backend/staged.java',
    'backend/unstaged.java',
    'backend/untracked.java',
  ]);
});

test('startup, check and watch share the same runtime scope; test/tools-only changes stay frontend', () => {
  for (const file of [
    'backend/src/test/java/ExampleTest.java',
    'backend/src/test/resources/application.yml',
    'scripts/backend-test-plan.mjs',
    'scripts/dev-task.test.mjs',
  ]) {
    assert.equal(selectTaskPreviewMode({ files: [file] }), 'frontend', file);
    const slash = file.indexOf('/');
    assert.equal(runtimeWatchFile(file.slice(0, slash), file.slice(slash + 1)), null, file);
  }
  for (const file of [
    'backend/src/main/java/Example.java',
    'backend/src/main/resources/db/migration/V2__test.sql',
    'docker-compose.task.yml',
    'backend/pom.xml',
    '.codex/zdm-project-workflow.yaml',
  ]) {
    assert.equal(selectTaskPreviewMode({ files: [file] }), 'full', file);
    assert.equal(runtimeWatchFile('', file), file);
  }
  assert.ok(runtimeWatchFile('backend/src', null));
  assert.ok(runtimeWatchFile('', null));
});

test('watch callbacks keep the actual filename and ignore tests/build output', (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'zdm-watch-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'backend/src/test'), { recursive: true });
  const subscriptions = new Map();
  const changed = [];
  const watchers = createBackendWatchers(
    root,
    (file) => changed.push(file),
    (directory, options, callback) => {
      subscriptions.set(directory, callback);
      return { close() {} };
    },
  );
  assert.ok(watchers.length);
  subscriptions.get(resolve(root, 'backend/src'))('change', 'test/java/ExampleTest.java');
  subscriptions.get(resolve(root, 'backend/src'))('change', 'main/java/Example.java');
  subscriptions.get(resolve(root, 'backend'))('change', 'target');
  subscriptions.get(root)('change', 'docker-compose.task.yml');
  assert.deepEqual(changed, ['backend/src/main/java/Example.java', 'docker-compose.task.yml']);
});

function backendStartupFixture() {
  const options = {
    root: '/task',
    integrationRoot: '/integration',
    project: 'zdm-task-test',
    branch: 'codex/test',
    context: { env: { ZDM_TASK_BACKEND_PORT: '8084' } },
  };
  const container = {
    Id: 'container-1',
    State: { Running: true, StartedAt: 'start-1' },
    Image: 'image-1',
    Config: {
      Labels: {
        'com.docker.compose.project': options.project,
        'com.docker.compose.service': 'backend',
        'com.zdm.task.preview': 'true',
        'com.zdm.task.database': 'integration',
      },
    },
    HostConfig: { PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8084' }] } },
    Mounts: [
      { Type: 'bind', Source: '/task', Destination: '/workspace', RW: true },
      { Type: 'bind', Source: '/migrations', Destination: '/task-migrations', RW: false },
    ],
  };
  const commands = [];
  const writes = [];
  const order = [];
  const record = {
    version: 1,
    sourceIdentity: 'source-1',
    configurationIdentity: runtimeDigest('config-1'),
    containerIdentity: taskBackendContainerIdentity(container, {
      ...options,
      backendPort: 8084,
      migrationDirectory: '/migrations',
    }),
  };
  const dependencies = {
    ensureDatabase: async () => order.push('database'),
    prepareMigrations: () => ({ directory: '/migrations', count: 1 }),
    readLock: () => null,
    acquireLock: async () => order.push('lock'),
    inspect: () => container,
    configuration: () => 'config-1',
    snapshot: () => 'source-1',
    readRecord: () => record,
    writeRecord: (root, value) => writes.push(value),
    execute: (context, args) => {
      commands.push(args);
      if (args[0] !== 'logs') container.State.StartedAt = 'start-2';
    },
    health: async () => {
      order.push('health');
      return { statusCode: 200, body: '{"status":"UP"}' };
    },
    waitForHealth: async () => {},
  };
  return { options, dependencies, container, commands, writes, order };
}

test('verified healthy backend is reused after the existing migration lock guards', async () => {
  const fixture = backendStartupFixture();
  fixture.options.riskFiles = ['migration.sql'];
  assert.deepEqual(await ensureTaskBackend(fixture.options, fixture.dependencies), { action: 'reuse' });
  assert.deepEqual(fixture.order, ['database', 'lock', 'health']);
  assert.deepEqual(fixture.commands, []);
  assert.deepEqual(fixture.writes, []);
  fixture.dependencies.readLock = () => ({ project: 'other', branch: 'codex/other', backupFile: '/backup' });
  await assert.rejects(ensureTaskBackend(fixture.options, fixture.dependencies), /共享数据库正由/);
  assert.deepEqual(fixture.commands, []);
});

test('backend startup restarts only known source changes and recreates unknown or changed configuration', async () => {
  for (const scenario of ['source', 'config', 'unknown', 'migration', 'unhealthy']) {
    const fixture = backendStartupFixture();
    if (scenario === 'source' || scenario === 'migration') fixture.dependencies.snapshot = () => 'source-2';
    if (scenario === 'migration') fixture.options.riskFiles = ['migration.sql'];
    if (scenario === 'config') fixture.dependencies.configuration = () => 'config-2';
    if (scenario === 'unknown') fixture.dependencies.readRecord = () => null;
    if (scenario === 'unhealthy') {
      let probes = 0;
      fixture.dependencies.health = async () => ({
        statusCode: 200,
        body: ++probes === 1 ? '{"status":"DOWN"}' : '{"status":"UP"}',
      });
    }
    const expected = ['source', 'unhealthy'].includes(scenario) ? 'restart' : 'recreate';
    assert.equal((await ensureTaskBackend(fixture.options, fixture.dependencies)).action, expected, scenario);
    assert.equal(fixture.commands[0][0], expected === 'restart' ? 'restart' : 'up');
    assert.equal(fixture.writes.length, 1);
  }
});

test('runtime proof is never written for changing inputs, wrong containers, or a no-op restart', async () => {
  for (const scenario of ['changing', 'wrong mount', 'unchanged start', 'not UP', 'replaced during start']) {
    const fixture = backendStartupFixture();
    fixture.dependencies.readRecord = () => null;
    if (scenario === 'changing') {
      let source = 'source-1';
      fixture.dependencies.snapshot = () => source;
      fixture.dependencies.waitForHealth = async () => {
        source = 'source-2';
      };
    }
    if (scenario === 'wrong mount')
      fixture.dependencies.waitForHealth = async () => (fixture.container.Mounts[0].Source = '/other');
    if (scenario === 'not UP')
      fixture.dependencies.health = async () => ({ statusCode: 200, body: '<html>wrong service</html>' });
    if (scenario === 'replaced during start')
      fixture.dependencies.waitForHealth = async () => {
        fixture.container.Id = 'another-container';
      };
    if (scenario === 'unchanged start') fixture.dependencies.execute = (context, args) => fixture.commands.push(args);
    await assert.rejects(ensureTaskBackend(fixture.options, fixture.dependencies), /未登记复用证据/, scenario);
    assert.deepEqual(fixture.writes, []);
  }
});

test('a container change during the health probe cannot pass the backend reuse path', async () => {
  const fixture = backendStartupFixture();
  fixture.dependencies.health = async () => {
    fixture.container.Id = 'replaced';
    return { statusCode: 200, body: '{"status":"UP"}' };
  };
  assert.equal((await ensureTaskBackend(fixture.options, fixture.dependencies)).action, 'recreate');
  assert.equal(fixture.commands[0][0], 'up');
});

test('startup listeners capture a frontend-to-full change and drain the final change before activating live updates', async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'zdm-startup-window-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  mkdirSync(resolve(root, 'backend/src/main/java'), { recursive: true });
  mkdirSync(resolve(root, 'src'), { recursive: true });
  writeFileSync(resolve(root, 'backend/src/main/java/Example.java'), 'baseline');
  writeFileSync(resolve(root, 'src/page.vue'), 'baseline');
  git('add', '.');
  git('commit', '-m', 'baseline', '--no-verify');
  git('checkout', '-b', 'codex/task');
  writeFileSync(resolve(root, 'src/page.vue'), 'frontend change');
  const subscriptions = new Map();
  const updates = [];
  const forwarded = [];
  let closed = 0;
  const watchRuntime = (directory, notify) =>
    createBackendWatchers(directory, notify, (watched, options, callback) => {
      subscriptions.set(watched, callback);
      return { close: () => (closed += 1) };
    });
  await withRuntimeStartupWatch(
    root,
    async (startup) => {
      assert.ok(subscriptions.has(resolve(root, 'backend/src')), 'listeners exist before initial classification');
      assert.equal(selectTaskPreviewMode({ files: taskPreviewChangedFiles(root) }), 'frontend');
      // Simulate the await between shared-backend readiness and frontend port preparation.
      await Promise.resolve();
      writeFileSync(resolve(root, 'backend/src/main/java/Example.java'), 'backend change');
      subscriptions.get(resolve(root, 'backend/src'))('change', 'main/java/Example.java');
      subscriptions.get(resolve(root, 'backend/src'))('change', 'main/java/Example.java');
      assert.deepEqual(updates, [], 'startup does not race its first frontend readiness check');
      await startup.settle(
        async (files) => {
          updates.push({ files, mode: selectTaskPreviewMode({ files: taskPreviewChangedFiles(root) }) });
          if (updates.length === 1) {
            await Promise.resolve();
            writeFileSync(resolve(root, 'docker-compose.task.yml'), 'changed runtime configuration');
            subscriptions.get(root)('change', 'docker-compose.task.yml');
          }
        },
        (file) => forwarded.push(file),
      );
      assert.deepEqual(updates, [
        { files: ['backend/src/main/java/Example.java'], mode: 'full' },
        { files: ['docker-compose.task.yml'], mode: 'full' },
      ]);
      subscriptions.get(resolve(root, 'backend/src'))('change', 'main/java/Example.java');
      assert.deepEqual(forwarded, ['backend/src/main/java/Example.java']);
      startup.close();
    },
    watchRuntime,
  );
  assert.equal(closed, subscriptions.size);
});

test('a backend edit after initial healthy reuse is handled before startup finishes', async () => {
  const fixture = backendStartupFixture();
  let notify;
  let source = 'source-1';
  fixture.dependencies.snapshot = () => source;
  await withRuntimeStartupWatch(
    '/task',
    async (startup) => {
      assert.deepEqual(await ensureTaskBackend(fixture.options, fixture.dependencies), { action: 'reuse' });
      // The previously uncovered window: backend has returned, prepareFrontendPort is still awaiting.
      await Promise.resolve();
      source = 'source-2';
      notify('backend/src/main/java/Example.java');
      const results = [];
      await startup.settle(
        async () => results.push(await ensureTaskBackend(fixture.options, fixture.dependencies)),
        () => {},
      );
      assert.deepEqual(results, [{ action: 'restart' }]);
      assert.equal(fixture.writes.at(-1).sourceIdentity, 'source-2');
      assert.deepEqual(fixture.commands, [['restart', 'backend']]);
      startup.close();
    },
    (root, callback) => {
      notify = callback;
      return [{ close() {} }];
    },
  );
});

test('startup failures and failed convergence close the early listeners without activating queued work', async () => {
  for (const duringConvergence of [false, true]) {
    let notify;
    let closed = 0;
    let forwarded = 0;
    await assert.rejects(
      withRuntimeStartupWatch(
        '/task',
        async (startup) => {
          notify('backend/src/main/java/Example.java');
          if (!duringConvergence) throw new Error('initial failure');
          await startup.settle(
            async () => {
              throw new Error('convergence failure');
            },
            () => (forwarded += 1),
          );
        },
        (root, callback) => {
          notify = callback;
          return [{ close: () => (closed += 1) }];
        },
      ),
      /failure/,
    );
    notify('after failure');
    assert.equal(closed, 1);
    assert.equal(forwarded, 0);
  }
});
