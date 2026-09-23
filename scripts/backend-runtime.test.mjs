import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureBackend, resolveRuntimeMigrations, runtimeMigrationDirectory } from './backend-runtime.mjs';
import { ensureIntegrationDatabase, ensureSharedBackend, startIntegrationBackend } from './dev-task.mjs';
const first = { name: 'V1__base.sql', content: 'SELECT 1;' };
const pending = { name: 'V2__paused.sql', content: 'SELECT 2;' };
const record = {
  type: 'zdm-paused-database-task',
  catalog: [pending].map((entry) => ({ ...entry, sha256: createHash('sha256').update(entry.content).digest('hex') })),
};
test('loads only already applied verified snapshots and keeps current migrations', () => {
  assert.deepEqual(resolveRuntimeMigrations([first], [record], [{ script: pending.name, success: '1' }]), [
    first,
    pending,
  ]);
  assert.deepEqual(resolveRuntimeMigrations([first], [record], []), [first]);
});
test('rejects missing, failed, tampered and conflicting migrations', () => {
  assert.throws(() => resolveRuntimeMigrations([first], [], [{ script: pending.name, success: '1' }]), /缺少可信/);
  assert.throws(() => resolveRuntimeMigrations([first], [], [{ script: first.name, success: '0' }]), /失败迁移/);
  assert.throws(
    () =>
      resolveRuntimeMigrations([first], [{ ...record, catalog: [{ ...record.catalog[0], content: 'changed' }] }], []),
    /校验失败/,
  );
  assert.throws(
    () =>
      resolveRuntimeMigrations(
        [{ ...pending, content: 'changed' }],
        [record],
        [{ script: pending.name, success: '1' }],
      ),
    /冲突/,
  );
});

test('starts MySQL once and waits for container health before backend runtime work', async () => {
  const root = '/tmp/integration';
  const events = [];
  const health = ['starting', 'healthy'];
  await ensureBackend(root, {
    ensureDatabase: (directory) =>
      ensureIntegrationDatabase(directory, {
        prepare: (cwd) => {
          assert.equal(cwd, root);
          events.push('docker-and-volume-protection');
        },
        execute: (command, args, context) => {
          assert.equal(command, 'docker');
          assert.equal(context.cwd, root);
          assert.deepEqual(args, [
            'compose',
            '--project-directory',
            root,
            '--file',
            `${root}/docker-compose.yml`,
            'up',
            '-d',
            'mysql',
          ]);
          events.push('mysql-up');
        },
        inspect: (command, args) => {
          assert.equal(command, 'docker');
          assert.deepEqual(args, ['inspect', '--format', '{{.State.Health.Status}}', 'zdm-platform-mysql']);
          return health.shift();
        },
        wait: async (isHealthy, options) => {
          assert.equal(options.timeoutMs, 120_000);
          assert.equal(isHealthy(), false);
          assert.equal(isHealthy(), true);
          events.push('mysql-healthy');
        },
      }),
    inspect: (_, command, args) => {
      assert.equal(command, 'docker');
      assert.ok(events.includes('mysql-healthy'));
      if (args[0] === 'compose') return 'mysql\nbackend';
      return args[2].includes('/workspace') ? root : '/tmp/runtime-migrations';
    },
    resolveRuntime: () => {
      events.push('verify-migration-catalog');
      return { args: ['compose', '-f', 'runtime-compose.json'], directory: '/tmp/runtime-migrations' };
    },
    execute: (_, command, args) => {
      assert.equal(command, 'docker');
      assert.deepEqual(args, ['compose', '-f', 'runtime-compose.json', 'start', 'backend']);
      events.push('backend-start');
    },
    waitForHealth: async () => events.push('backend-healthy'),
  });
  assert.deepEqual(events, [
    'docker-and-volume-protection',
    'mysql-up',
    'mysql-healthy',
    'verify-migration-catalog',
    'backend-start',
    'backend-healthy',
  ]);
});

test('database health failure blocks migration and backend startup', async () => {
  const error = new Error('等待集成 MySQL 健康检查超时');
  let started = 0;
  await assert.rejects(
    ensureBackend('/tmp/integration', {
      ensureDatabase: async () => {
        throw error;
      },
      inspect: () => assert.fail('Runtime inspection must wait for database health'),
      resolveRuntime: () => assert.fail('Migrations must wait for database health'),
      execute: () => started++,
      waitForHealth: () => assert.fail('Backend health cannot precede database readiness'),
    }),
    error,
  );
  assert.equal(started, 0);
});

test('restores a different workspace or migration mount by recreating, without unconditional restarts', async () => {
  for (const mounts of [
    { workspace: '/tmp/other-task', migrations: '/tmp/current-migrations' },
    { workspace: '/tmp/integration', migrations: '/tmp/old-migrations' },
  ]) {
    const actions = [];
    await ensureBackend('/tmp/integration', {
      ensureDatabase: async () => actions.push('database-ready'),
      inspect: (_, __, args) => {
        if (args[0] === 'compose') return 'backend\nmysql';
        return args[2].includes('/workspace') ? mounts.workspace : mounts.migrations;
      },
      resolveRuntime: () => ({ args: ['compose', '-f', 'runtime.json'], directory: '/tmp/current-migrations' }),
      execute: (_, __, args) => actions.push(args),
      waitForHealth: async () => actions.push('backend-healthy'),
    });
    assert.deepEqual(actions, [
      'database-ready',
      ['compose', '-f', 'runtime.json', 'up', '-d', '--force-recreate', 'backend'],
      'backend-healthy',
    ]);
  }
});

test('a temporary-root symlink keeps an existing canonical migration mount without recreating the backend', async (t) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'zdm-runtime-path-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const physical = path.join(fixture, 'physical');
  const alias = path.join(fixture, 'alias');
  mkdirSync(physical);
  symlinkSync(physical, alias, 'dir');
  const directory = runtimeMigrationDirectory('catalog-digest', alias);
  assert.equal(directory, path.join(realpathSync(physical), 'zdm-backend-migrations', 'catalog-digest'));
  assert.equal(runtimeMigrationDirectory('catalog-digest', physical), directory);
  const commands = [];
  await ensureBackend('/fixture/integration', {
    ensureDatabase: async () => {},
    inspect: (_, __, args) => {
      if (args[0] === 'compose') return 'backend\nmysql';
      if (args[2].includes('/workspace')) return '/fixture/integration';
      return process.platform === 'darwin' ? `/host_mnt${directory}` : directory;
    },
    resolveRuntime: () => ({ args: ['compose', '-f', 'runtime.json'], directory }),
    execute: (_, __, args) => commands.push(args),
    waitForHealth: async () => {},
  });
  assert.deepEqual(commands, [['compose', '-f', 'runtime.json', 'start', 'backend']]);
});

test('integration recovery uses the launcher backend entrypoint even for an older target Worktree', async () => {
  const target = '/tmp/old-integration';
  const events = [];
  await startIntegrationBackend(target, {
    execute: (command, args, context) => {
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [fileURLToPath(new URL('./ensure-backend.mjs', import.meta.url)), '--worktree', target]);
      assert.deepEqual(context, { cwd: target });
      events.push('same-launcher-entrypoint');
    },
    waitForHealth: async (url) => {
      assert.equal(url, 'http://127.0.0.1:8080/actuator/health');
      events.push('integration-api-healthy');
    },
  });
  assert.deepEqual(events, ['same-launcher-entrypoint', 'integration-api-healthy']);
});

test('explicit recovery recreates even matching mounts after database and migration protection', async () => {
  const events = [];
  await ensureBackend('/tmp/integration', {
    forceRecreate: true,
    ensureDatabase: async () => events.push('database-ready'),
    inspect: (_, __, args) =>
      args[0] === 'compose'
        ? 'backend\nmysql'
        : args[2].includes('/workspace')
          ? '/tmp/integration'
          : '/tmp/current-migrations',
    resolveRuntime: () => {
      events.push('migrations-verified');
      return { args: ['compose', '-f', 'protected-runtime.json'], directory: '/tmp/current-migrations' };
    },
    execute: (_, command, args) => {
      assert.equal(command, 'docker');
      events.push(args);
    },
    waitForHealth: async () => events.push('backend-healthy'),
  });
  assert.deepEqual(events, [
    'database-ready',
    'migrations-verified',
    ['compose', '-f', 'protected-runtime.json', 'up', '-d', '--no-deps', '--force-recreate', 'backend'],
    'backend-healthy',
  ]);
});

test('runtime launch failure blocks backend health and propagates to the caller', async () => {
  await assert.rejects(
    ensureBackend('/tmp/integration', {
      forceRecreate: true,
      ensureDatabase: async () => undefined,
      inspect: () => '',
      resolveRuntime: () => ({ args: ['compose', '-f', 'protected-runtime.json'], directory: '/tmp/migrations' }),
      execute: () => {
        throw new Error('injected compose startup failure');
      },
      waitForHealth: () => assert.fail('health must not turn launch failure into success'),
    }),
    /injected compose startup failure/,
  );
});

test('frontend shared-backend recovery uses the current protected launcher while healthy reuse stays unchanged', async () => {
  const worktrees = [{ branch: 'codex/integration-current', path: '/old/integration' }];
  await ensureSharedBackend(worktrees, {
    health: async () => 200,
    restore: () => assert.fail('Healthy backend must be reused'),
  });
  let recovered = null;
  await ensureSharedBackend(worktrees, {
    health: async () => 503,
    restore: async (root) => {
      recovered = root;
    },
  });
  assert.equal(recovered, '/old/integration');
});
