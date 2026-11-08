import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  taskDataNames,
  previewDataFile,
  previewDataRoot,
  adoptPreviewData,
  assertPreviewWriter,
  protectPreviewUpdate,
  taskDataComposeEnv,
  validateTaskData,
  readTaskData,
  verifyDataCopy,
  protectIntegrationMigrations,
  releaseIntegrationMigration,
  ensureTaskData,
  provisionPreviewData,
} from './task-data-environment.mjs';
import { taskBackendContainerIdentity } from './task-runtime-state.mjs';
import { backendFixture } from './test-support/task-backend-fixture.mjs';
function profile(root, project = 'batch') {
  return {
    version: 1,
    status: 'ready',
    workspaceRoot: path.resolve(root),
    project,
    ...taskDataNames(root, project),
    password: 'a'.repeat(48),
    backupFile: '/backup.sql.gz',
  };
}
test('data names remain stable within a batch and separate task worktrees', () => {
  assert.deepEqual(taskDataNames('/task', 'batch'), taskDataNames('/task', 'batch'));
  assert.notDeepEqual(taskDataNames('/task', 'batch'), taskDataNames('/other', 'batch'));
  const p = profile('/task');
  assert.equal(validateTaskData(p, '/task', 'batch'), p);
  for (const change of [
    { database: 'zdm_admin' },
    { mediaVolume: 'zdm-admin_zdm_craft_images' },
    { workspaceRoot: '/other' },
    { status: 'failed' },
    { password: 'bad' },
  ]) {
    assert.throws(() => validateTaskData({ ...p, ...change }, '/task', 'batch'), /不可核验/);
  }
});
test('no unregistered or symlinked data manifest is accepted', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zdm-data-test-'));
  try {
    spawnSync('git', ['init', '-q', root]);
    assert.equal(readTaskData(root, 'batch'), null);
    mkdirSync(path.join(root, '.task-runtime'));
    writeFileSync(path.join(root, 'record'), JSON.stringify(profile(root)));
    mkdirSync(path.dirname(previewDataFile(root)), { recursive: true });
    symlinkSync(path.join(root, 'record'), previewDataFile(root));
    assert.throws(() => readTaskData(root, 'batch'), /安全文件/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('database and media targets never fall back to shared integration assets', () => {
  const p = profile('/task');
  const env = taskDataComposeEnv(p);
  assert.equal(env.ZDM_TASK_DB_NAME, p.database);
  assert.equal(env.ZDM_TASK_MEDIA_VOLUME, p.mediaVolume);
  assert.throws(() => taskDataComposeEnv({ ...p, database: 'zdm_admin' }), /不能指向/);
  assert.throws(() => taskDataComposeEnv({ ...p, mediaVolume: 'zdm-admin_zdm_craft_images' }), /不能指向/);
  assert.throws(() => taskDataComposeEnv({ ...p, database: 'bad;DROP DATABASE zdm_admin' }), /不能指向/);
});
test('copy validation rejects missing tables or different business row counts', () => {
  verifyDataCopy({ a: '1', b: '2' }, { a: '1', b: '2' });
  assert.throws(() => verifyDataCopy({ a: '1', b: '2' }, { a: '1' }), /不一致/);
  assert.throws(() => verifyDataCopy({ a: '1' }, { a: '2' }), /不一致/);
});
test('isolated runtime rejects shared database, wrong schema, username and media volume', () => {
  const { container, expected } = backendFixture();
  const p = profile('/task');
  const next = { ...expected, database: p.database, username: p.username, mediaVolume: p.mediaVolume };
  container.Config.Labels['com.zdm.task.database'] = 'isolated';
  container.Config.Env = [
    `ZDM_DB_URL=jdbc:mysql://zdm-platform-mysql:3306/${p.database}?serverTimezone=Asia/Shanghai`,
    `ZDM_DB_USERNAME=${p.username}`,
  ];
  container.Mounts.push({ Type: 'volume', Destination: '/data/zdm/craft-images', Name: p.mediaVolume, RW: true });
  assert.ok(taskBackendContainerIdentity(container, next));
  for (const mutate of [
    (c) => (c.Config.Env[0] = 'ZDM_DB_URL=jdbc:mysql://zdm-platform-mysql:3306/zdm_admin?'),
    (c) => (c.Config.Env[1] = 'ZDM_DB_USERNAME=zdm_admin'),
    (c) => (c.Mounts[2].Name = 'zdm-admin_zdm_craft_images'),
    (c) => (c.Config.Labels['com.zdm.task.database'] = 'integration'),
  ]) {
    const copy = structuredClone(container);
    mutate(copy);
    assert.equal(taskBackendContainerIdentity(copy, next), null);
  }
});
test('delivery skips already applied migrations and backs up before new migration writes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zdm-integration-protect-'));
  const events = [];
  const execute = (args) => {
    events.push(args);
    return args[0] === 'exec' ? 'CREATE TABLE sample(id INT);' : args[1] === '-a' ? 'running' : '';
  };
  try {
    assert.equal(
      protectIntegrationMigrations(root, [{ name: 'V1.sql' }], [{ script: 'V1.sql', success: '1' }], execute),
      null,
    );
    assert.equal(events.length, 0);
    const protection = protectIntegrationMigrations(root, [{ name: 'V2.sql' }], [], execute);
    assert.ok(existsSync(protection.lock.backupFile));
    assert.deepEqual(
      events.map((e) => e[0]),
      ['ps', 'ps', 'stop', 'exec'],
    );
    const lock = JSON.parse(readFileSync(protection.lockFile));
    assert.deepEqual(lock.pending, ['V2.sql']);
    releaseIntegrationMigration(protection);
    assert.equal(existsSync(protection.lockFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('migration failure or lock replacement preserves backups and blocks lock release', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zdm-integration-protect-'));
  try {
    const p = protectIntegrationMigrations(root, [{ name: 'V2.sql' }], [], (args) =>
      args[0] === 'exec' ? 'SELECT 1;' : '',
    );
    writeFileSync(p.lockFile, JSON.stringify({ different: true }));
    assert.throws(() => releaseIntegrationMigration(p), /已变化/);
    assert.ok(existsSync(p.lock.backupFile));
    assert.ok(existsSync(p.lockFile));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function provisioningFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'zdm-isolated-copy-'));
  spawnSync('git', ['init', '-q', root]);
  const integrationRoot = path.join(root, 'integration');
  mkdirSync(integrationRoot);
  const events = [];
  let provisioned = false;
  const execute = (args, options = {}) => {
    events.push({ args, input: options.input });
    const sql = options.input ?? '';
    if (sql.includes('CREATE DATABASE')) provisioned = true;
    if (sql.includes('COUNT(*) FROM information_schema.SCHEMATA')) return provisioned ? '1' : '0';
    if (sql.includes('COUNT(*) FROM mysql.user')) return '0';
    if (sql.includes('SELECT TABLE_NAME')) return 'flyway_schema_history\nsample';
    if (sql.includes('SELECT COUNT(*) FROM `')) return '2';
    if (sql.includes('DEFAULT_CHARACTER_SET_NAME')) return 'utf8mb4 utf8mb4_0900_ai_ci';
    if (sql.includes('SELECT version,script')) return '1\tV1.sql\t123\t1';
    if (args[0] === 'inspect') return 'false';
    if (args.join(' ').includes('mysqldump')) return 'CREATE TABLE sample(id INT);';
    if (args.join(' ').includes('cmp /tmp/source.sha')) return 'abc123  /tmp/source.sha';
    return '';
  };
  return { root, integrationRoot, project: 'batch', execute, events, volumeExists: () => false };
}
test('provisioning copies once, verifies rows/history/media and reuses without business-data synchronization', async () => {
  const f = provisioningFixture();
  try {
    const p = await provisionPreviewData(f, f);
    assert.equal(p.status, 'ready');
    assert.ok(existsSync(p.backupFile));
    assert.deepEqual(p.initialTableCounts, { flyway_schema_history: '2', sample: '2' });
    assert.equal(existsSync(path.join(f.integrationRoot, 'backups/task-preview/active-database-task.json')), false);
    assert.equal(f.events.filter((e) => e.args.join(' ').includes('mysqldump')).length, 1);
    assert.ok(f.events.some((e) => e.input?.includes(`GRANT ALL PRIVILEGES ON \`${p.database}\`.*`)));
    const reused = await ensureTaskData(f, {
      execute: (args, options) => {
        f.events.push({ args });
        return options?.input ? '1' : '';
      },
    });
    assert.equal(reused.database, p.database);
    assert.equal(f.events.filter((e) => e.args.join(' ').includes('mysqldump')).length, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('copy failure preserves the backup, failed profile and lock, and refuses automatic overwrite', async () => {
  const f = provisioningFixture();
  const original = f.execute;
  f.execute = (args, options) => {
    if (args[0] === 'volume' && args[1] === 'create') throw new Error('copy failed');
    return original(args, options);
  };
  try {
    await assert.rejects(provisionPreviewData(f, f), /copy failed/);
    const p = JSON.parse(readFileSync(path.join(previewDataRoot(f.root), '.task-runtime/data-environment.json')));
    assert.equal(p.status, 'failed');
    assert.ok(existsSync(p.backupFile));
    assert.ok(existsSync(path.join(f.integrationRoot, 'backups/task-preview/active-database-task.json')));
    await assert.rejects(provisionPreviewData(f, f), /EEXIST|不可核验/);
    assert.equal(f.events.filter((e) => e.args.join(' ').includes('mysqldump')).length, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('successive task worktrees reuse exactly the registered preview data without recloning', async () => {
  const f = provisioningFixture();
  try {
    const original = path.join(f.root, 'original.json');
    const data = profile('/original-task', 'old-batch');
    writeFileSync(original, JSON.stringify(data));
    const execute = (args, options) => (options?.input ? '1' : '');
    adoptPreviewData(f.root, original, execute);
    const next = path.join(f.root, 'next-task');
    writeFileSync(path.join(f.root, 'tracked.txt'), 'preview');
    spawnSync('git', ['add', 'tracked.txt'], { cwd: f.root });
    spawnSync(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'],
      { cwd: f.root },
    );
    const worktree = spawnSync('git', ['worktree', 'add', '--detach', next, 'HEAD'], { cwd: f.root });
    assert.equal(worktree.status, 0);
    // Linked task worktrees must resolve to the same durable registration.
    assert.equal(previewDataFile(next), previewDataFile(f.root));
    const reused = await ensureTaskData(
      { root: next, project: 'next-batch', integrationRoot: f.integrationRoot },
      { execute },
    );
    assert.deepEqual(reused, data);
    assert.throws(() => adoptPreviewData(f.root, original, execute), /已有登记/);
    assert.equal(readTaskData(next).database, data.database);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('missing persistent database never falls back to integration or creates a new copy', async () => {
  const f = provisioningFixture();
  try {
    const source = path.join(f.root, 'original.json');
    writeFileSync(source, JSON.stringify(profile('/original-task')));
    adoptPreviewData(f.root, source, (args, options) => (options?.input ? '1' : ''));
    await assert.rejects(
      ensureTaskData(f, { execute: (args, options) => (options?.input ? '0' : '') }),
      /丢失，不自动重建/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('persistent data refuses a concurrent task writer and permits only its owner', () => {
  const data = profile('/old-task');
  const execute = (args) =>
    args[0] === 'ps'
      ? 'other-backend'
      : JSON.stringify([
          {
            Config: {
              Labels: { 'com.docker.compose.project': 'other' },
              Env: [`ZDM_DB_URL=jdbc:mysql://zdm-platform-mysql:3306/${data.database}?serverTimezone=Asia/Shanghai`],
            },
          },
        ]);
  assert.throws(() => assertPreviewWriter(data, 'next-task', execute), /仍被其他任务/);
  assert.doesNotThrow(() => assertPreviewWriter(data, 'other', execute));
});
test('preview migration backs up the preview schema before startup and preserves failed protection', () => {
  const f = provisioningFixture();
  try {
    const source = path.join(f.root, 'source.json');
    const data = profile('/old-task');
    writeFileSync(source, JSON.stringify(data));
    adoptPreviewData(f.root, source, (args, options) => (options?.input ? '1' : ''));
    const directory = path.join(f.root, 'migrations');
    mkdirSync(directory);
    writeFileSync(path.join(directory, 'V2.sql'), 'SELECT 1;');
    const events = [];
    const execute = (args, options) => {
      events.push(args.join(' '));
      return options?.input ? 'V1.sql' : 'SELECT 1;';
    };
    const p = protectPreviewUpdate({ root: f.root, data, directory, stop: () => events.push('stop-preview') }, execute);
    assert.equal(events[1], 'stop-preview');
    assert.ok(events[2].includes(`--set-gtid-purged=OFF ${data.database}`));
    assert.ok(existsSync(p.lock.backupFile));
    assert.throws(
      () => protectPreviewUpdate({ root: f.root, data, directory, stop: () => {} }, execute),
      /保护尚未完成/,
    );
    releaseIntegrationMigration(p);
    assert.equal(existsSync(p.lockFile), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
