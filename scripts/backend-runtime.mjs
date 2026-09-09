import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { mergeMigrationCatalog, verifyPausedCatalog } from './dev-task.mjs';
import { parseWorktreePorcelain, DEFAULT_INTEGRATION_BRANCH } from './git-workflow-core.mjs';

export function resolveRuntimeMigrations(currentFiles, pausedRecords, history) {
  if (history.some((entry) => entry.success !== '1')) throw new Error('存在失败迁移，不能启动集成后端');
  const applied = new Set(history.map((entry) => entry.script));
  const pausedFiles = pausedRecords.flatMap(verifyPausedCatalog).filter((entry) => applied.has(entry.name));
  const catalog = mergeMigrationCatalog({ integrationFiles: pausedFiles, taskFiles: currentFiles });
  const available = new Set(catalog.map((entry) => entry.name));
  for (const script of applied) {
    if (!available.has(script)) throw new Error(`已执行迁移缺少可信原始文件：${script}`);
  }
  return catalog;
}

function runtimeComposeArgs(root) {
  const worktrees = parseWorktreePorcelain(capture(root, 'git', ['worktree', 'list', '--porcelain']));
  const integration = worktrees.find((entry) => entry.branch === DEFAULT_INTEGRATION_BRANCH);
  const recordsDir = integration && path.join(integration.path, 'backups', 'task-preview');
  const records =
    recordsDir && existsSync(recordsDir)
      ? readdirSync(recordsDir)
          .filter((name) => /^paused-.*\.json$/.test(name))
          .map((name) => {
            const file = path.join(recordsDir, name);
            if (lstatSync(file).isSymbolicLink()) throw new Error('暂停迁移快照不能是符号链接');
            return JSON.parse(readFileSync(file, 'utf8'));
          })
      : [];
  const sourceDir = path.join(root, 'backend', 'src', 'main', 'resources', 'db', 'migration');
  const files = readdirSync(sourceDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, content: readFileSync(path.join(sourceDir, name), 'utf8') }));
  const tables = capture(root, 'docker', [
    'exec',
    'zdm-platform-mysql',
    'sh',
    '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=0x666c797761795f736368656d615f686973746f7279"',
  ]);
  if (!['0', '1'].includes(tables)) throw new Error('无法确认迁移历史表状态');
  const result =
    tables === '0'
      ? { status: 0, stdout: '' }
      : spawnSync(
          'docker',
          [
            'exec',
            'zdm-platform-mysql',
            'sh',
            '-c',
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot "$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT script,success FROM flyway_schema_history ORDER BY installed_rank"',
          ],
          { cwd: root, encoding: 'utf8' },
        );
  if (result.status !== 0) throw new Error('读取数据库迁移历史失败，保留现场');
  const history = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [script, success] = line.split('\t');
      return { script, success };
    });
  const catalog = resolveRuntimeMigrations(files, records, history);
  const digest = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
  const directory = path.join(tmpdir(), 'zdm-backend-migrations', digest);
  mkdirSync(directory, { recursive: true });
  if (lstatSync(directory).isSymbolicLink()) throw new Error('迁移运行目录不能是符号链接');
  for (const name of [...catalog.map((entry) => entry.name), 'compose.json']) {
    const file = path.join(directory, name);
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('迁移运行文件不能是符号链接');
  }
  for (const entry of catalog) writeFileSync(path.join(directory, entry.name), entry.content);
  const override = path.join(directory, 'compose.json');
  writeFileSync(
    override,
    JSON.stringify({
      services: {
        backend: {
          environment: { SPRING_FLYWAY_LOCATIONS: 'filesystem:/opt/zdm-migrations' },
          volumes: [`${directory}:/opt/zdm-migrations:ro`],
        },
      },
    }),
  );
  return { args: ['compose', '-f', path.join(root, 'docker-compose.yml'), '-f', override], directory };
}

export async function waitForBackendHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const healthy = await new Promise((resolve) => {
      const request = http.get('http://127.0.0.1:8080/actuator/health', { timeout: 1000 }, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve(response.statusCode === 200 && JSON.parse(body).status === 'UP');
          } catch {
            resolve(false);
          }
        });
      });
      request.on('timeout', () => request.destroy());
      request.on('error', () => resolve(false));
    });
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('后端健康检查失败，不能标记为已就绪');
}

function run(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function normalizeDockerMountPath(mountPath) {
  if (process.platform === 'darwin' && mountPath.startsWith('/host_mnt/')) {
    return mountPath.slice('/host_mnt'.length);
  }
  return mountPath;
}

export function waitForPort(port, timeoutMs = 120_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(1_000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}.`));
          return;
        }
        setTimeout(attempt, 1_000);
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    attempt();
  });
}

export async function ensureBackend(root) {
  if (!capture(root, 'docker', ['info', '--format', '{{.ServerVersion}}'])) {
    console.error('Docker is unavailable. Start Docker Desktop and retry.');
    process.exit(1);
  }

  const services = new Set(
    capture(root, 'docker', ['compose', 'ps', '-a', '--services']).split(/\r?\n/).filter(Boolean),
  );
  const backendWorkspace = capture(root, 'docker', [
    'inspect',
    '--format',
    '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}',
    'zdm-platform-backend',
  ]);
  const backendUsesCurrentWorktree =
    backendWorkspace && path.resolve(normalizeDockerMountPath(backendWorkspace)) === path.resolve(root);

  run(root, 'docker', ['compose', 'up', '-d', 'mysql']);
  await waitForPort(3306);
  const runtime = runtimeComposeArgs(root);
  const existingMigrations = capture(root, 'docker', [
    'inspect',
    '--format',
    '{{range .Mounts}}{{if eq .Destination "/opt/zdm-migrations"}}{{.Source}}{{end}}{{end}}',
    'zdm-platform-backend',
  ]);
  if (
    services.has('backend') &&
    backendUsesCurrentWorktree &&
    path.resolve(normalizeDockerMountPath(existingMigrations || '.')) === path.resolve(runtime.directory)
  ) {
    run(root, 'docker', [...runtime.args, 'start', 'backend']);
  } else {
    run(root, 'docker', [...runtime.args, 'up', '-d', '--force-recreate', 'backend']);
  }

  try {
    await waitForBackendHealth();
  } catch (error) {
    console.error(error.message);
    run(root, 'docker', ['compose', 'logs', '--tail', '80', 'backend']);
    process.exit(1);
  }

  console.log(`Backend is ready from ${root} at http://127.0.0.1:8080`);
}
