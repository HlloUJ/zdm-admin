import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { branchKind, DEFAULT_INTEGRATION_BRANCH, parseWorktreePorcelain } from './git-workflow-core.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';
import {
  assertIntegrationRuntimeReady,
  integrationBackendSnapshot,
  integrationProofMatches,
  readIntegrationProof,
  writeIntegrationProof,
} from './integration-handoff-state.mjs';
import { compatibleTaskDependencies, validateTaskDependencies } from './task-dependencies.mjs';
import {
  createLatestChangeQueue,
  runtimeDigest,
  taskBackendAction,
  taskBackendContainerIdentity,
  taskBackendSourceIdentity,
} from './task-runtime-state.mjs';

export const CURRENT_TASK_FRONTEND_PORT = 5175;
const FRONTEND_PORT_START = 5175;
const FRONTEND_PORT_END = 5199;
const TEMPORARY_FRONTEND_PORT_START = 5177;
const BACKEND_PORT_START = 8081;
const BACKEND_PORT_END = 8099;
const SHARED_API_TARGET = 'http://127.0.0.1:8080';
const INTEGRATION_MYSQL_CONTAINER = 'zdm-platform-mysql';
const INTEGRATION_NETWORK = 'zdm-admin_default';
const TASK_PREVIEW_CONTROL_PATH = '/__zdm_task_preview__';
export const TASK_PREVIEW_API_HEALTH_PATH = '/__zdm_task_preview_api_health__';
const TASK_PREVIEW_CONTROL_HEADER = 'x-zdm-task-preview-control';
const TASK_PREVIEW_CONTROL_VALUE = 'switch-current-task';
const MAVEN_VOLUME = 'zdm-admin_zdm_maven_repo';
const CRAFT_IMAGE_VOLUME = 'zdm-admin_zdm_craft_images';
const DATABASE_LOCK_FILENAME = 'active-database-task.json';
const PREVIEW_SERVICE_SOCKET = path.join(
  homedir(),
  'Library',
  'Application Support',
  'zdm-admin',
  'task-preview',
  'service.sock',
);
const launcherRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const taskComposeFile = path.join(launcherRoot, 'docker-compose.task.yml');

export function parseTaskPreviewArgs(args) {
  const result = {
    port: null,
    backendPort: null,
    apiTarget: null,
    mode: 'auto',
    worktree: null,
    temporary: false,
    databaseRisk: false,
    handoff: false,
    stop: false,
    check: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--help' || value === '-h') {
      result.help = true;
      continue;
    }
    if (value === '--pause') {
      result.pause = true;
      continue;
    }
    if (value === '--stop') {
      result.stop = true;
      continue;
    }
    if (value === '--check') {
      result.check = true;
      continue;
    }
    if (value === '--temporary') {
      result.temporary = true;
      continue;
    }
    if (value === '--database-risk') {
      result.databaseRisk = true;
      continue;
    }
    if (value === '--handoff') {
      result.handoff = true;
      continue;
    }
    if (value === '--force-integration-backend') {
      result.forceIntegrationBackend = true;
      continue;
    }
    if (value === '--port' || value === '--backend-port') {
      const port = Number(args[index + 1]);
      const [start, end] =
        value === '--port' ? [FRONTEND_PORT_START, FRONTEND_PORT_END] : [BACKEND_PORT_START, BACKEND_PORT_END];
      if (!Number.isInteger(port) || port < start || port > end) {
        throw new Error(`${value} 必须是 ${start} 至 ${end} 之间的整数`);
      }
      if (value === '--port') result.port = port;
      else result.backendPort = port;
      index += 1;
      continue;
    }
    if (value === '--api') {
      const apiTarget = args[index + 1];
      if (!apiTarget) throw new Error('--api 缺少目标地址');
      const parsed = new URL(apiTarget);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('--api 只支持 http 或 https');
      result.apiTarget = parsed.origin;
      index += 1;
      continue;
    }
    if (value === '--mode') {
      const mode = args[index + 1];
      if (!['auto', 'frontend', 'full'].includes(mode)) throw new Error('--mode 只支持 auto、frontend 或 full');
      result.mode = mode;
      index += 1;
      continue;
    }
    if (value === '--worktree') {
      const worktree = args[index + 1];
      if (!worktree) throw new Error('--worktree 缺少目录');
      result.worktree = worktree;
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }
  return result;
}

export function taskPublicOrigin(port, override = process.env.ZDM_TASK_PUBLIC_ORIGIN) {
  if (!override) return `http://127.0.0.1:${port}`;
  const parsed = new URL(override);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('ZDM_TASK_PUBLIC_ORIGIN 只支持 http 或 https');
  return parsed.origin;
}

export function taskPreviewErrors({ branch }) {
  return branchKind(branch) === 'task' ? [] : [`只能预览 codex/* 任务分支，当前为：${branch || '(detached)'}`];
}

export function backendSensitiveFiles(files) {
  return files.filter((file) => classifyChangedFiles([file]).runtime);
}

export function databaseRiskFiles(files) {
  return files.filter((file) => file.startsWith('backend/src/main/resources/db/migration/'));
}

export function selectTaskPreviewMode({ files, requestedMode = 'auto', apiTarget = null }) {
  if (requestedMode !== 'auto') return requestedMode;
  if (apiTarget) return 'frontend';
  return backendSensitiveFiles(files).length > 0 ? 'full' : 'frontend';
}

export function taskProjectName({ branch, root }) {
  const slug =
    branch
      .replace(/^codex\//, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'preview';
  const digest = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 10);
  return `zdm-task-${slug}-${digest}`;
}

export function parseBackendPortBindings(value) {
  try {
    const bindings = JSON.parse(value);
    const port = Number(bindings?.['8080/tcp']?.[0]?.HostPort);
    return Number.isInteger(port) && port >= BACKEND_PORT_START && port <= BACKEND_PORT_END ? port : null;
  } catch {
    return null;
  }
}

export async function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const close = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', close);
    socket.once('timeout', close);
  });
}

export async function findAvailablePort({ start, end, isOpen = isPortOpen } = {}) {
  for (let port = start; port <= end; port += 1) {
    if (!(await isOpen(port))) return port;
  }
  throw new Error(`${start}-${end} 没有可用端口`);
}

export async function chooseTaskFrontendPort({ requestedPort = null, temporary = false, isOpen = isPortOpen } = {}) {
  if (requestedPort) return requestedPort;
  if (!temporary) return CURRENT_TASK_FRONTEND_PORT;
  return findAvailablePort({ start: TEMPORARY_FRONTEND_PORT_START, end: FRONTEND_PORT_END, isOpen });
}

export function parseTaskPreviewMetadata(value) {
  try {
    const metadata = JSON.parse(value);
    if (metadata?.type !== 'zdm-task-preview' || typeof metadata.workspaceRoot !== 'string') return null;
    return metadata;
  } catch {
    return null;
  }
}

export function taskPreviewReadinessErrors({
  metadata,
  expectedWorkspaceRoot = null,
  expectedBranch = null,
  expectedMode = null,
  expectedApiTarget = null,
  healthStatus = 0,
  healthBody = '',
}) {
  if (!metadata) return ['当前端口不是可识别的装点猫任务预览'];
  const errors = [];
  if (typeof metadata.mode !== 'string' || typeof metadata.apiTarget !== 'string') {
    errors.push('预览元数据版本过旧，无法证明 API 链路；请重新运行 dev:task');
  }
  if (expectedWorkspaceRoot && path.resolve(metadata.workspaceRoot) !== path.resolve(expectedWorkspaceRoot)) {
    errors.push(`当前预览属于 ${metadata.workspaceRoot}，不是 ${expectedWorkspaceRoot}`);
  }
  if (expectedBranch && metadata.branch !== expectedBranch) {
    errors.push(`当前预览分支为 ${metadata.branch || '(未知)'}，不是 ${expectedBranch}`);
  }
  if (expectedMode && metadata.mode !== expectedMode) {
    errors.push(`当前预览模式为 ${metadata.mode || '(未知)'}，不是 ${expectedMode}`);
  }
  if (expectedApiTarget && metadata.apiTarget !== expectedApiTarget) {
    errors.push(`当前 API 目标为 ${metadata.apiTarget || '(未知)'}，不是 ${expectedApiTarget}`);
  }
  if (errors.length === 0) {
    if (healthStatus !== 200) {
      errors.push(`预览 API 代理不可用（HTTP ${healthStatus || '无法连接'}）`);
    } else {
      try {
        if (JSON.parse(healthBody)?.status !== 'UP') errors.push('预览 API 代理未返回 UP');
      } catch {
        errors.push('预览 API 健康检查返回了非 JSON 内容');
      }
    }
  }
  return errors;
}

// Worktree-scoped checks must prove the current branch and the backend required by the complete task diff.
// The unscoped --check keeps its existing generic health-check semantics.
export function taskPreviewCheckExpectations({
  root,
  branch,
  files,
  metadata,
  registeredBackendPort = null,
  registeredApiTarget = null,
}) {
  const errors = taskPreviewErrors({ branch });
  if (errors.length) throw new Error(errors.join('\n'));
  if (!metadata || path.resolve(metadata.workspaceRoot) !== path.resolve(root))
    throw new Error('当前预览不属于待验证 Worktree');
  if (metadata.branch !== branch) throw new Error(`当前预览分支为 ${metadata.branch || '(未知)'}，不是 ${branch}`);
  if (!['frontend', 'full'].includes(metadata.mode)) throw new Error('当前预览模式不可证明，请重新运行 dev:task');
  const requiredMode = selectTaskPreviewMode({ files });
  if (requiredMode === 'full' && metadata.mode !== 'full')
    throw new Error('当前任务包含后端变更，必须使用 full 任务预览');
  // A frontend task may have been explicitly started in full mode; retain that supported choice.
  const expectedMode = metadata.mode;
  let expectedApiTarget = registeredApiTarget ?? SHARED_API_TARGET;
  if (expectedMode === 'full') {
    if (
      !Number.isInteger(registeredBackendPort) ||
      registeredBackendPort < BACKEND_PORT_START ||
      registeredBackendPort > BACKEND_PORT_END
    )
      throw new Error('无法证明当前任务的已登记后端端口，不能声明运行环境就绪');
    expectedApiTarget = `http://127.0.0.1:${registeredBackendPort}`;
  }
  return { expectedWorkspaceRoot: root, expectedBranch: branch, expectedMode, expectedApiTarget };
}

export function taskPreviewChangedFiles(root) {
  const baseRef = refExists('refs/remotes/origin/main', root) ? 'origin/main' : 'main';
  const queries = [
    ['diff', '--name-only', '-z', '--no-renames', `${baseRef}...HEAD`],
    ['diff', '--name-only', '-z', '--no-renames'],
    ['diff', '--cached', '--name-only', '-z', '--no-renames', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ];
  const files = queries.flatMap((args) => {
    const value = capture('git', args, { cwd: root, trim: false });
    if (value && !value.endsWith('\0')) throw new Error('Git 变更路径输出不完整');
    return value ? value.slice(0, -1).split('\0') : [];
  });
  return [...new Set(files)].sort();
}

export function parseDatabaseLock(value) {
  try {
    const lock = JSON.parse(value);
    if (
      lock?.type !== 'zdm-shared-database-lock' ||
      typeof lock.project !== 'string' ||
      typeof lock.workspaceRoot !== 'string' ||
      typeof lock.backupFile !== 'string'
    ) {
      return null;
    }
    return lock;
  } catch {
    return null;
  }
}

export function selectSharedNodeModules({ root, worktrees }) {
  for (const worktree of worktrees) {
    if (path.resolve(worktree.path) === path.resolve(root)) continue;
    const modules = path.join(worktree.path, 'node_modules');
    if (compatibleTaskDependencies(root, modules)) return modules;
  }
  return null;
}

function capture(command, args, { cwd, allowFailure = false, env = process.env, trim = true } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status === 0) return trim ? result.stdout.trim() : result.stdout;
  if (allowFailure) return '';
  throw new Error(result.stderr.trim() || `${command} ${args.join(' ')} failed`);
}

function run(command, args, { cwd, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function gitCapture(root, args, allowFailure = false) {
  return capture('git', args, { cwd: root, allowFailure });
}

function refExists(ref, cwd) {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd }).status === 0;
}

export function ensureNodeModules(root, worktrees) {
  const localModules = path.join(root, 'node_modules');
  // An existing symlink is not evidence that its target matches this Worktree's lock.
  try {
    lstatSync(localModules);
    try {
      return validateTaskDependencies(root, localModules);
    } catch (error) {
      throw new Error(
        `当前 node_modules 无法证明与锁文件一致；请在依赖所属目录修复后重试，不会自动修改共享依赖：${error.message}`,
        { cause: error },
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const sharedModules = selectSharedNodeModules({ root, worktrees });
  if (!sharedModules) throw new Error('当前 Worktree 缺少可复用且实际安装版本一致的 node_modules，请先安装依赖');
  symlinkSync(sharedModules, localModules, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`复用依赖：${sharedModules}`);
  return validateTaskDependencies(root, localModules);
}

function integrationWorktreeFor(worktrees) {
  const integrationWorktree = worktrees.find((worktree) => worktree.branch === DEFAULT_INTEGRATION_BRANCH);
  if (!integrationWorktree) throw new Error(`未找到 ${DEFAULT_INTEGRATION_BRANCH} 固定 Worktree`);
  return integrationWorktree;
}

function databaseRuntimePaths(integrationRoot) {
  const directory = path.join(integrationRoot, 'backups', 'task-preview');
  return {
    directory,
    lockFile: path.join(directory, DATABASE_LOCK_FILENAME),
  };
}

function readDatabaseLock(integrationRoot) {
  const { lockFile } = databaseRuntimePaths(integrationRoot);
  if (!existsSync(lockFile)) return null;
  const lock = parseDatabaseLock(readFileSync(lockFile, 'utf8'));
  if (!lock) throw new Error(`共享数据库锁文件损坏，请先检查：${lockFile}`);
  return lock;
}

export function databaseLockError(lock, { project, branch }) {
  if (!lock || lock.project === project) return null;
  return `共享数据库正由 ${lock.branch || lock.project} 执行结构或高风险数据任务；完成交付或经确认恢复后，才能切换到 ${branch}`;
}

function migrationVersion(filename) {
  return filename.match(/^V(.+?)__.+\.sql$/i)?.[1] ?? null;
}

export function mergeMigrationCatalog({ integrationFiles, taskFiles }) {
  const byName = new Map();
  const byVersion = new Map();
  for (const entry of [...integrationFiles, ...taskFiles]) {
    const version = migrationVersion(entry.name);
    if (version) {
      const existingName = byVersion.get(version);
      if (existingName && existingName !== entry.name) {
        throw new Error(`Flyway 版本 V${version} 同时对应 ${existingName} 和 ${entry.name}`);
      }
      byVersion.set(version, entry.name);
    }
    const existing = byName.get(entry.name);
    if (existing && existing.content !== entry.content) {
      throw new Error(`Flyway 迁移内容冲突：${entry.name}`);
    }
    byName.set(entry.name, entry);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function readMigrationCatalog(root) {
  const directory = path.join(root, 'backend', 'src', 'main', 'resources', 'db', 'migration');
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => ({ name: entry.name, content: readFileSync(path.join(directory, entry.name), 'utf8') }));
}

export function snapshotAppliedMigrations(catalog, history) {
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  return history.map(({ script, success }) => {
    if (success !== '1') throw new Error(`Flyway 存在失败记录：${script}`);
    const entry = byName.get(script);
    if (!entry) throw new Error(`找不到已执行迁移的原始文件：${script}`);
    return { ...entry, sha256: createHash('sha256').update(entry.content).digest('hex') };
  });
}

export function verifyPausedCatalog(record) {
  if (record?.type !== 'zdm-paused-database-task' || !Array.isArray(record.catalog)) {
    throw new Error('暂停任务迁移记录格式无效');
  }
  return record.catalog.map((entry) => {
    if (
      !entry ||
      typeof entry.name !== 'string' ||
      path.basename(entry.name) !== entry.name ||
      !migrationVersion(entry.name) ||
      typeof entry.content !== 'string' ||
      entry.sha256 !== createHash('sha256').update(entry.content).digest('hex')
    ) {
      throw new Error('暂停任务迁移快照校验失败');
    }
    return { name: entry.name, content: entry.content };
  });
}

function readPausedMigrations(integrationRoot) {
  const { directory } = databaseRuntimePaths(integrationRoot);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^paused-.*\.json$/.test(name))
    .flatMap((name) => {
      const file = path.join(directory, name);
      if (lstatSync(file).isSymbolicLink()) throw new Error('暂停记录不能是符号链接');
      return verifyPausedCatalog(JSON.parse(readFileSync(file, 'utf8')));
    });
}

async function pauseDatabaseTask({ root, branch, project, integrationRoot, context }) {
  const lock = readDatabaseLock(integrationRoot);
  if (!lock || lock.project !== project || path.resolve(lock.workspaceRoot) !== path.resolve(root)) {
    throw new Error('只有当前共享数据库锁的所属任务可以暂停交接');
  }
  if (failedFlywayVersions(integrationRoot)) throw new Error('存在失败迁移，保留现场，不能暂停交接');
  const competing = otherSharedDatabaseTaskBackends(integrationRoot, project);
  if (competing.length) throw new Error(`存在其他任务后端：${competing.join(', ')}`);
  const historyText = capture(
    'docker',
    [
      'exec',
      INTEGRATION_MYSQL_CONTAINER,
      'mysql',
      '--user=zdm_admin',
      '--password=zdm_admin_pwd',
      '--database=zdm_admin',
      '--batch',
      '--skip-column-names',
      '--execute',
      'SELECT script, success FROM flyway_schema_history ORDER BY installed_rank;',
    ],
    { cwd: integrationRoot },
  );
  const history = historyText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [script, success] = line.split('\t');
      return { script, success };
    });
  const combined = mergeMigrationCatalog({
    integrationFiles: [...readMigrationCatalog(integrationRoot), ...readPausedMigrations(integrationRoot)],
    taskFiles: readMigrationCatalog(root),
  });
  const catalog = snapshotAppliedMigrations(combined, history);
  // Stop writers first. Any failure keeps the old lock and every existing backup.
  await stopSupervisedPreview(root);
  const managed = await currentManagedPreview();
  if (managed && path.resolve(managed.workspaceRoot) === path.resolve(root)) await stopManagedPreview();
  composeRun(context, ['stop', 'backend']);
  stopIntegrationBackend(integrationRoot);
  if (otherSharedDatabaseTaskBackends(integrationRoot, '__paused__').length) {
    throw new Error('仍有任务后端运行，保留原锁');
  }
  const backupFile = createDatabaseBackup({ integrationRoot, project });
  const { directory, lockFile } = databaseRuntimePaths(integrationRoot);
  const current = readDatabaseLock(integrationRoot);
  if (JSON.stringify(current) !== JSON.stringify(lock)) throw new Error('暂停期间数据库锁已变化');
  const record = {
    type: 'zdm-paused-database-task',
    project,
    branch,
    workspaceRoot: root,
    head: gitCapture(root, ['rev-parse', 'HEAD']),
    backupFile,
    previousLock: lock,
    catalog,
    pausedAt: new Date().toISOString(),
  };
  const recordPath = path.join(directory, `paused-${project}-${Date.now()}.json`);
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  unlinkSync(lockFile);
  console.log(`任务已暂停：${branch}`);
  console.log(`迁移现场：${recordPath}`);
  console.log(`当前数据备份：${backupFile}`);
  console.log('未修改 Git、未恢复或删除数据库；下一任务启动时将重新校验全部已执行迁移。');
}

function taskMigrationDirectory(project) {
  return path.join(tmpdir(), 'zdm-task-preview', project, 'migrations');
}

function prepareTaskMigrations({ root, integrationRoot, project }) {
  const directory = taskMigrationDirectory(project);
  if (existsSync(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`任务迁移目录不安全：${directory}`);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error(`任务迁移目录包含非文件项，已停止覆盖：${entry.name}`);
    }
  } else {
    mkdirSync(directory, { recursive: true });
  }
  const catalog = mergeMigrationCatalog({
    integrationFiles: [...readMigrationCatalog(integrationRoot), ...readPausedMigrations(integrationRoot)],
    taskFiles: readMigrationCatalog(root),
  });
  const names = new Set(catalog.map((entry) => entry.name));
  for (const name of readdirSync(directory)) {
    if (!names.has(name)) unlinkSync(path.join(directory, name));
  }
  for (const entry of catalog) {
    const file = path.join(directory, entry.name);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== entry.content) writeFileSync(file, entry.content);
  }
  return { directory, count: catalog.length };
}

function composeContext({ root, project, backendPort }) {
  return {
    cwd: root,
    env: {
      ...process.env,
      ZDM_TASK_WORKSPACE: root,
      ZDM_TASK_BACKEND_PORT: String(backendPort),
      ZDM_INTEGRATION_NETWORK: INTEGRATION_NETWORK,
      ZDM_TASK_MIGRATION_DIR: taskMigrationDirectory(project),
    },
    args: ['compose', '--project-name', project, '--project-directory', root, '--file', taskComposeFile],
  };
}

function composeCapture(context, args, allowFailure = false) {
  return capture('docker', [...context.args, ...args], { ...context, allowFailure });
}

function composeRun(context, args) {
  run('docker', [...context.args, ...args], context);
}

function requestResponse(url, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(target, { timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.once('timeout', () => {
      request.destroy();
      resolve({ statusCode: 0, body: '' });
    });
    request.once('error', () => resolve({ statusCode: 0, body: '' }));
  });
}

async function requestStatus(url, timeoutMs = 1_000) {
  return (await requestResponse(url, timeoutMs)).statusCode;
}

function taskPreviewControlRequest(port, method = 'GET', timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: TASK_PREVIEW_CONTROL_PATH,
        method,
        headers: method === 'DELETE' ? { [TASK_PREVIEW_CONTROL_HEADER]: TASK_PREVIEW_CONTROL_VALUE } : undefined,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    request.once('timeout', () => {
      request.destroy();
      resolve({ statusCode: 0, body: '' });
    });
    request.once('error', () => resolve({ statusCode: 0, body: '' }));
    request.end();
  });
}

function previewServiceRequest(method, requestPath, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    if (!existsSync(PREVIEW_SERVICE_SOCKET)) {
      resolve({ statusCode: 0, body: '', absent: true });
      return;
    }
    const request = http.request(
      {
        socketPath: PREVIEW_SERVICE_SOCKET,
        path: requestPath,
        method,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    request.once('timeout', () => {
      request.destroy();
      resolve({ statusCode: 0, body: '' });
    });
    request.once('error', () => resolve({ statusCode: 0, body: '' }));
    request.end();
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function previewServiceOwnsWorktree(status, root) {
  return (
    status?.type === 'zdm-task-preview-service' &&
    typeof status.worktree === 'string' &&
    path.resolve(status.worktree) === path.resolve(root)
  );
}

export async function stopSupervisedPreview(root, { request = previewServiceRequest } = {}) {
  const stopped = (status) =>
    status?.type === 'zdm-task-preview-service' &&
    status.worktree === null &&
    status.childPid === null &&
    status.phase === 'integration-fallback' &&
    status.mode === 'integration-fallback';
  const currentResponse = await request('GET', '/status');
  // A missing supervisor socket preserves foreground-preview handoff. An unreachable
  // installed supervisor is unknown state, never proof that its child has stopped.
  if (currentResponse.absent) return false;
  const currentStatus = currentResponse.statusCode === 200 ? parseJson(currentResponse.body) : null;
  if (
    currentStatus?.type !== 'zdm-task-preview-service' ||
    !(
      currentStatus.worktree === null ||
      (typeof currentStatus.worktree === 'string' && path.isAbsolute(currentStatus.worktree))
    ) ||
    (currentStatus.worktree === null && !stopped(currentStatus))
  )
    throw new Error(`无法确认任务预览守护服务的进程归属和停止状态：${root}`);
  if (!previewServiceOwnsWorktree(currentStatus, root)) return false;

  const stopResponse = await request('POST', '/stop');
  if (stopResponse.statusCode >= 200 && stopResponse.statusCode < 300 && stopped(parseJson(stopResponse.body)))
    return true;
  const finalResponse = await request('GET', '/status');
  const finalStatus = finalResponse.statusCode === 200 ? parseJson(finalResponse.body) : null;
  if (!stopped(finalStatus)) throw new Error(`任务预览守护服务未能证明旧任务进程已停止：${root}`);
  return true;
}

async function currentManagedPreview(port = CURRENT_TASK_FRONTEND_PORT) {
  const response = await taskPreviewControlRequest(port);
  return response.statusCode === 200 ? parseTaskPreviewMetadata(response.body) : null;
}

async function inspectManagedPreview({
  port = CURRENT_TASK_FRONTEND_PORT,
  expectedWorkspaceRoot = null,
  expectedBranch = null,
  expectedMode = null,
  expectedApiTarget = null,
}) {
  const metadata = await currentManagedPreview(port);
  let health = { statusCode: 0, body: '' };
  if (typeof metadata?.mode === 'string' && typeof metadata?.apiTarget === 'string') {
    health = await requestResponse(`http://127.0.0.1:${port}${TASK_PREVIEW_API_HEALTH_PATH}`, 3_000);
  }
  const errors = taskPreviewReadinessErrors({
    metadata,
    expectedWorkspaceRoot,
    expectedBranch,
    expectedMode,
    expectedApiTarget,
    healthStatus: health.statusCode,
    healthBody: health.body,
  });
  return { metadata, errors };
}

async function requireManagedPreviewReady(options) {
  const result = await inspectManagedPreview(options);
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => `- ${error}`).join('\n'));
  }
  return result.metadata;
}

async function waitForManagedPreviewReady(options, timeoutMs = 30_000) {
  let latestErrors = [];
  try {
    await waitUntil(
      async () => {
        const result = await inspectManagedPreview(options);
        latestErrors = result.errors;
        return result.errors.length === 0;
      },
      {
        timeoutMs,
        message: '等待任务预览 API 链路就绪超时',
      },
    );
  } catch {
    throw new Error(['等待任务预览 API 链路就绪超时', ...latestErrors.map((error) => `- ${error}`)].join('\n'));
  }
}

async function stopManagedPreview(port = CURRENT_TASK_FRONTEND_PORT) {
  const response = await taskPreviewControlRequest(port, 'DELETE');
  if (response.statusCode !== 202) throw new Error(`无法切换固定任务预览端口 ${port}`);
  await waitUntil(async () => !(await isPortOpen(port)), {
    timeoutMs: 10_000,
    message: `等待旧任务预览释放端口 ${port} 超时`,
  });
}

async function prepareFrontendPort({ port, allowManagedSwitch }) {
  if (!(await isPortOpen(port))) return;
  if (!allowManagedSwitch) throw new Error(`前端端口 ${port} 已被占用`);
  const currentPreview = await currentManagedPreview(port);
  if (!currentPreview) {
    throw new Error(`固定任务预览端口 ${port} 被非 Codex 任务预览进程占用，已停止自动切换`);
  }
  console.log(`正在把固定入口从 ${currentPreview.branch || currentPreview.workspaceRoot} 切换到当前任务…`);
  await stopManagedPreview(port);
}

async function waitUntil(check, { timeoutMs, message }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(message);
}

async function waitForHttp(url, timeoutMs = 240_000) {
  await waitUntil(async () => (await requestStatus(url)) === 200, {
    timeoutMs,
    message: `等待 ${url} 健康检查超时`,
  });
}

function ensureDocker(root) {
  if (!capture('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd: root, allowFailure: true })) {
    throw new Error('Docker 不可用，请启动 Docker Desktop 后重试');
  }
  for (const volume of [MAVEN_VOLUME, CRAFT_IMAGE_VOLUME]) {
    if (!capture('docker', ['volume', 'inspect', volume], { cwd: root, allowFailure: true })) {
      run('docker', ['volume', 'create', volume], { cwd: root });
    }
  }
}

function integrationComposeContext(integrationRoot) {
  return {
    cwd: integrationRoot,
    args: [
      'compose',
      '--project-directory',
      integrationRoot,
      '--file',
      path.join(integrationRoot, 'docker-compose.yml'),
    ],
  };
}

export async function ensureIntegrationDatabase(
  integrationRoot,
  { prepare = ensureDocker, execute = run, inspect = capture, wait = waitUntil } = {},
) {
  prepare(integrationRoot);
  const context = integrationComposeContext(integrationRoot);
  execute('docker', [...context.args, 'up', '-d', 'mysql'], context);
  await wait(
    () =>
      inspect('docker', ['inspect', '--format', '{{.State.Health.Status}}', INTEGRATION_MYSQL_CONTAINER], {
        cwd: integrationRoot,
      }) === 'healthy',
    { timeoutMs: 120_000, message: '等待集成 MySQL 健康检查超时' },
  );
}

function failedFlywayVersions(integrationRoot) {
  return capture(
    'docker',
    [
      'exec',
      INTEGRATION_MYSQL_CONTAINER,
      'mysql',
      '--user=zdm_admin',
      '--password=zdm_admin_pwd',
      '--database=zdm_admin',
      '--batch',
      '--skip-column-names',
      '--execute',
      'SELECT version FROM flyway_schema_history WHERE success = 0 ORDER BY installed_rank;',
    ],
    { cwd: integrationRoot },
  );
}

function createDatabaseBackup({ integrationRoot, project }) {
  const { directory } = databaseRuntimePaths(integrationRoot);
  const backupDirectory = path.join(directory, project);
  mkdirSync(backupDirectory, { recursive: true });
  const result = spawnSync(path.join(launcherRoot, 'scripts', 'backup-db.sh'), [], {
    cwd: integrationRoot,
    env: { ...process.env, BACKUP_DIR: backupDirectory },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || '共享数据库备份失败');
  }
  const match = result.stdout.match(/^Created (.+)$/m);
  if (!match || !existsSync(match[1])) throw new Error('共享数据库备份未生成有效文件');
  return path.resolve(match[1]);
}

function stopIntegrationBackend(integrationRoot) {
  const context = integrationComposeContext(integrationRoot);
  run('docker', [...context.args, 'stop', 'backend'], context);
}

export async function startIntegrationBackend(
  integrationRoot,
  { execute = run, waitForHealth = waitForHttp, forceRecreate = false } = {},
) {
  execute(
    process.execPath,
    [
      path.join(launcherRoot, 'scripts', 'ensure-backend.mjs'),
      '--worktree',
      integrationRoot,
      ...(forceRecreate ? ['--force-recreate'] : []),
    ],
    {
      cwd: integrationRoot,
    },
  );
  await waitForHealth(`${SHARED_API_TARGET}/actuator/health`);
}

function otherSharedDatabaseTaskBackends(root, project) {
  const value = capture(
    'docker',
    [
      'ps',
      '--filter',
      'label=com.zdm.task.database=integration',
      '--format',
      '{{.Label "com.docker.compose.project"}}',
    ],
    { cwd: root, allowFailure: true },
  );
  return [...new Set(value.split(/\r?\n/).filter((candidate) => candidate && candidate !== project))];
}

async function acquireDatabaseLock({ context, integrationRoot, root, branch, project, riskFiles }) {
  const existingLock = readDatabaseLock(integrationRoot);
  const conflict = databaseLockError(existingLock, { project, branch });
  if (conflict) throw new Error(`${conflict}\n当前任务备份：${existingLock.backupFile}`);
  if (existingLock) {
    stopIntegrationBackend(integrationRoot);
    console.log(`复用共享数据库保护点：${existingLock.backupFile}`);
    return existingLock;
  }

  const failedVersions = failedFlywayVersions(integrationRoot);
  if (failedVersions)
    throw new Error(`Flyway 存在失败记录（${failedVersions.split(/\r?\n/).join(', ')}），已停止启动任务后端`);

  const otherBackends = otherSharedDatabaseTaskBackends(integrationRoot, project);
  if (otherBackends.length > 0) {
    throw new Error(`以下任务后端仍连接共享数据库，请先明确停止后再执行迁移：${otherBackends.join(', ')}`);
  }

  composeRun(context, ['stop', 'backend']);
  stopIntegrationBackend(integrationRoot);
  let backupFile;
  try {
    backupFile = createDatabaseBackup({ integrationRoot, project });
  } catch (error) {
    await startIntegrationBackend(integrationRoot);
    composeRun(context, ['start', 'backend']);
    throw error;
  }
  const { directory, lockFile } = databaseRuntimePaths(integrationRoot);
  mkdirSync(directory, { recursive: true });
  const lock = {
    type: 'zdm-shared-database-lock',
    project,
    branch,
    workspaceRoot: root,
    backupFile,
    riskFiles,
    createdAt: new Date().toISOString(),
  };
  try {
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    await startIntegrationBackend(integrationRoot);
    composeRun(context, ['start', 'backend']);
    throw error;
  }
  console.log(`共享数据库已备份：${backupFile}`);
  console.log('集成后端已暂停写入；迁移失败时不会自动恢复数据库。');
  return lock;
}

function existingTaskBackendPort(context) {
  const containerId = composeCapture(context, ['ps', '--all', '--quiet', 'backend'], true);
  if (!containerId) return null;
  const bindings = capture(
    'docker',
    ['inspect', '--format', '{{json .HostConfig.PortBindings}}', containerId.split(/\r?\n/)[0]],
    { cwd: context.cwd, allowFailure: true },
  );
  return parseBackendPortBindings(bindings);
}

async function chooseBackendPort({ root, project, requestedPort }) {
  const probeContext = composeContext({ root, project, backendPort: requestedPort ?? BACKEND_PORT_START });
  const existingPort = existingTaskBackendPort(probeContext);
  if (requestedPort) {
    if ((await isPortOpen(requestedPort)) && existingPort !== requestedPort) {
      throw new Error(`后端端口 ${requestedPort} 已被其他进程占用`);
    }
    return requestedPort;
  }
  if (existingPort) return existingPort;
  return findAvailablePort({ start: BACKEND_PORT_START, end: BACKEND_PORT_END });
}

function backendResponseHealthy(response) {
  try {
    return response.statusCode === 200 && JSON.parse(response.body).status === 'UP';
  } catch {
    return false;
  }
}

function inspectTaskBackend(context) {
  const ids = composeCapture(context, ['ps', '--all', '--quiet', 'backend'], true).split(/\r?\n/).filter(Boolean);
  if (ids.length !== 1) return null;
  try {
    const containers = JSON.parse(capture('docker', ['inspect', ids[0]], { cwd: context.cwd }));
    return containers.length === 1 ? containers[0] : null;
  } catch {
    return null;
  }
}

function readBackendRecord(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, '.task-runtime/backend-state.json'), 'utf8'));
  } catch {
    return null;
  }
}

function writeBackendRecord(root, record) {
  mkdirSync(path.join(root, '.task-runtime'), { recursive: true });
  writeFileSync(path.join(root, '.task-runtime/backend-state.json'), `${JSON.stringify(record)}\n`);
}

export async function ensureTaskBackend(
  { context, integrationRoot, root, branch, project, riskFiles = [] },
  {
    ensureDatabase = ensureIntegrationDatabase,
    prepareMigrations = prepareTaskMigrations,
    readLock = readDatabaseLock,
    acquireLock = acquireDatabaseLock,
    inspect = inspectTaskBackend,
    configuration = (value) => composeCapture(value, ['config', '--format', 'json']),
    snapshot = taskBackendSourceIdentity,
    readRecord = readBackendRecord,
    writeRecord = writeBackendRecord,
    execute = composeRun,
    health = requestResponse,
    waitForHealth = waitForHttp,
  } = {},
) {
  await ensureDatabase(integrationRoot);
  const migrations = prepareMigrations({ root, integrationRoot, project });
  const lock = readLock(integrationRoot);
  const conflict = databaseLockError(lock, { project, branch });
  if (conflict) throw new Error(`${conflict}\n当前任务备份：${lock.backupFile}`);
  if (riskFiles.length > 0) {
    await acquireLock({ context, integrationRoot, root, branch, project, riskFiles });
  }
  const expected = {
    root,
    project,
    backendPort: context.env.ZDM_TASK_BACKEND_PORT,
    migrationDirectory: migrations.directory,
  };
  const state = () => ({
    sourceIdentity: snapshot({ root, migrationDirectory: migrations.directory }),
    configurationIdentity: runtimeDigest(configuration(context)),
    containerIdentity: taskBackendContainerIdentity(inspect(context), expected),
  });
  let before = state();
  const record = readRecord(root);
  let action = taskBackendAction(record, { ...before, risk: riskFiles.length > 0 });
  const healthUrl = `http://127.0.0.1:${context.env.ZDM_TASK_BACKEND_PORT}/actuator/health`;
  if (action === 'reuse') {
    const response = await health(healthUrl);
    const after = state();
    if (backendResponseHealthy(response) && JSON.stringify(before) === JSON.stringify(after)) {
      console.log(`复用已核验的任务后端：http://127.0.0.1:${context.env.ZDM_TASK_BACKEND_PORT}`);
      return { action: 'reuse' };
    }
    before = after;
    action = taskBackendAction(record, { ...before, risk: riskFiles.length > 0 });
    if (action === 'reuse') action = 'restart';
  }
  execute(
    context,
    action === 'restart' ? ['restart', 'backend'] : ['up', '-d', '--no-deps', '--force-recreate', 'backend'],
  );
  try {
    const launchedIdentity = taskBackendContainerIdentity(inspect(context), expected);
    if (!launchedIdentity || launchedIdentity === before.containerIdentity)
      throw new Error('任务后端未产生新的有效启动身份，未登记复用证据');
    await waitForHealth(healthUrl);
    if (!backendResponseHealthy(await health(healthUrl))) throw new Error('任务后端未返回 UP 健康状态，未登记复用证据');
    const after = state();
    if (after.sourceIdentity !== before.sourceIdentity || after.configurationIdentity !== before.configurationIdentity)
      throw Object.assign(new Error('后端启动期间运行输入发生变化，未登记复用证据；请在改动稳定后重试'), {
        code: 'RUNTIME_INPUT_CHANGED',
      });
    if (!after.containerIdentity || after.containerIdentity !== launchedIdentity)
      throw new Error('任务后端容器身份、挂载或端口不匹配，未登记复用证据');
    writeRecord(root, { version: 1, ...after });
  } catch (error) {
    if (error.code === 'RUNTIME_INPUT_CHANGED') throw error;
    execute(context, ['logs', '--tail', '80', 'backend']);
    const activeLock = readLock(integrationRoot);
    if (activeLock?.project === project) {
      console.error(`数据库保护点保留：${activeLock.backupFile}`);
      console.error('集成后端保持暂停；恢复数据库必须先取得用户明确确认。');
    }
    throw error;
  }
  console.log(`任务后端：http://127.0.0.1:${context.env.ZDM_TASK_BACKEND_PORT}`);
  console.log('任务数据库：复用集成 MySQL / zdm_admin（手工验收数据持续保留）');
  console.log(`Flyway 迁移目录：集成基线 + 当前任务（${migrations.count} 个）`);
  return { action };
}

export async function ensureSharedBackend(
  worktrees,
  { health = requestStatus, restore = startIntegrationBackend } = {},
) {
  const healthUrl = `${SHARED_API_TARGET}/actuator/health`;
  if ((await health(healthUrl)) === 200) return;
  const integrationWorktree = integrationWorktreeFor(worktrees);
  await restore(integrationWorktree.path);
}

export async function handoffDatabaseTask(
  { root, branch, project, integrationRoot, context, forceIntegrationBackend = false },
  {
    readLock = readDatabaseLock,
    captureGit = gitCapture,
    contains = (taskHead, integrationHead) =>
      spawnSync('git', ['merge-base', '--is-ancestor', taskHead, integrationHead], { cwd: integrationRoot }).status ===
      0,
    stopSupervised = stopSupervisedPreview,
    currentPreview = currentManagedPreview,
    stopPreview = stopManagedPreview,
    stopBackend = () => composeRun(context, ['stop', 'backend']),
    restoreBackend = startIntegrationBackend,
    snapshot = integrationBackendSnapshot,
    readReceipt = readIntegrationProof,
    writeReceipt = writeIntegrationProof,
    releaseLock = () => unlinkSync(databaseRuntimePaths(integrationRoot).lockFile),
  } = {},
) {
  const lock = readLock(integrationRoot);
  if (lock && lock.project !== project) throw new Error(databaseLockError(lock, { project, branch }));
  const taskHead = captureGit(root, ['rev-parse', 'HEAD']);
  const integrationHead = captureGit(integrationRoot, ['rev-parse', 'HEAD']);
  if (!contains(taskHead, integrationHead)) {
    throw new Error('任务提交尚未包含在 codex/integration-current，不能执行任务交接');
  }

  const before = snapshot(integrationRoot);
  if (!before.worktreeClean) throw new Error('集成 Worktree 存在未提交改动，不能执行运行交接');
  const recreate = forceIntegrationBackend || !integrationProofMatches(readReceipt(integrationRoot), before);
  writeReceipt(integrationRoot, { version: 1, status: 'pending', integrationHead, taskHead });
  const supervisedPreviewStopped = await stopSupervised(root);
  const managedPreview = supervisedPreviewStopped ? null : await currentPreview();
  if (managedPreview && path.resolve(managedPreview.workspaceRoot) === path.resolve(root)) {
    await stopPreview();
  }
  if (supervisedPreviewStopped || managedPreview) {
    console.log(`旧任务预览已停止：${branch}`);
  }
  stopBackend();
  // backend:ensure owns database readiness before restoring the integration backend.
  await restoreBackend(integrationRoot, { forceRecreate: recreate });
  const after = snapshot(integrationRoot);
  assertIntegrationRuntimeReady(before, after, { recreate });
  // This receipt proves the runtime, not delivery completion. Persist it before releasing the safety lock.
  writeReceipt(integrationRoot, {
    version: 1,
    status: 'passed',
    taskHead,
    ...after,
    action: recreate ? 'recreated' : 'reused',
  });
  if (lock) {
    releaseLock();
    console.log(`共享数据库锁已释放：${branch}`);
    console.log(`安全备份继续保留：${lock.backupFile}`);
  } else {
    console.log('当前任务没有共享数据库锁。');
  }
  console.log(`任务运行环境已交接到集成环境：${branch}`);
}

function targetViteConfig(root) {
  const localConfig = path.join(root, 'vite.config.js');
  if (existsSync(localConfig) && readFileSync(localConfig, 'utf8').includes('ZDM_TASK_PREVIEW')) return localConfig;
  return path.join(launcherRoot, 'vite.config.js');
}

function spawnFrontend({ root, branch, port, apiTarget, mode }) {
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) throw new Error(`缺少 Vite：${viteBin}`);
  return spawn(
    process.execPath,
    [
      viteBin,
      '--configLoader',
      'runner',
      '--config',
      targetViteConfig(root),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ZDM_TASK_WORKSPACE: root,
        ZDM_TASK_BRANCH: branch,
        ZDM_TASK_MODE: mode,
        VITE_PUBLIC_APP_ORIGIN: taskPublicOrigin(port),
        ZDM_TASK_PREVIEW: '1',
        ZDM_FRONTEND_PORT: String(port),
        ZDM_API_PROXY_TARGET: apiTarget,
      },
      stdio: 'inherit',
    },
  );
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 5_000);
  await once(child, 'exit').catch(() => undefined);
  clearTimeout(forceTimer);
}

export function runtimeWatchFile(directory, filename) {
  // An unnamed event cannot prove a test-only scope; retain the watched directory's conservative scope.
  const unknown = {
    '': 'docker-compose.task.yml',
    scripts: 'scripts/dev-task.mjs',
    '.codex': '.codex/zdm-project-workflow.yaml',
    '.mvn': '.mvn/jvm.config',
  };
  const file =
    filename == null
      ? (unknown[directory] ?? directory)
      : path.posix.join(directory, String(filename).replaceAll('\\', '/'));
  return backendSensitiveFiles([file]).length ? file : null;
}

export function createBackendWatchers(root, onChange, watchDirectory = watch) {
  const watchers = [];
  const add = (directory, recursive = false, filter = () => true) => {
    const absolute = path.join(root, directory);
    if (!existsSync(absolute)) return;
    watchers.push(
      watchDirectory(absolute, { recursive }, (event, filename) => {
        if (!filter(filename)) return;
        const file = runtimeWatchFile(directory, filename);
        if (file) onChange(file);
      }),
    );
  };
  add('backend/src', true);
  add('backend/.mvn', true);
  add('.mvn', true);
  add('scripts', true);
  add('.codex', true);
  add('backend', false, (filename) => filename == null || ['pom.xml', 'src', '.mvn'].includes(String(filename)));
  add('', false, (filename) => filename == null || !['backend', 'scripts', '.codex'].includes(String(filename)));
  return watchers;
}

// Install the listeners before classification/startup. Until startup settles, events are
// buffered instead of racing the first frontend readiness check or being dropped.
export async function withRuntimeStartupWatch(root, start, watchRuntime = createBackendWatchers) {
  const pending = new Set();
  let forward = null;
  let closed = false;
  const notify = (file) => {
    if (closed) return;
    if (forward) forward(file);
    else pending.add(file);
  };
  const watchers = watchRuntime(root, notify);
  const close = () => {
    if (closed) return;
    closed = true;
    pending.clear();
    for (const watcher of watchers) watcher.close();
  };
  try {
    return await start({
      notify,
      close,
      async settle(run, onChange) {
        while (!closed && pending.size) {
          const files = [...pending];
          pending.clear();
          await run(files);
        }
        if (!closed) forward = onChange;
      },
    });
  } catch (error) {
    close();
    throw error;
  }
}

async function resolveTargetRoot(worktree) {
  const cwd = worktree ? path.resolve(worktree) : process.cwd();
  return capture('git', ['rev-parse', '--show-toplevel'], { cwd });
}

function printHelp() {
  console.log(`Usage: npm run dev:task -- [options]

Options:
  --mode auto|frontend|full  自动识别（默认）、只用共享后端或完整任务环境
  --port 5176               指定临时任务前端端口（5175-5199）
  --temporary               从 5177-5199 自动选择临时端口，不切换固定入口
  --backend-port 8081       指定任务后端端口（8081-8099）
  --api http://...          显式使用指定 API，并进入前端模式
  --database-risk           将非 Flyway 的破坏性数据任务纳入备份与写入锁
  --worktree /path          从新版启动器预览尚未包含该脚本的旧任务 Worktree
  --check                   检查当前任务预览身份及其 API 代理链路；指定 --worktree 时只读核对 Git/模式/已登记 Docker 端口
  --handoff                 集成分支包含任务提交后，停止任务预览和后端、恢复集成后端并释放数据库锁
  --pause                   备份并暂停当前锁所属任务，保留已执行迁移供其他任务校验
  --stop                    仅停止当前任务前端和后端；不删除数据库或备份`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseTaskPreviewArgs(args);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.apiTarget && options.mode === 'full') throw new Error('--api 不能与 --mode full 同时使用');
  if (options.databaseRisk && options.mode === 'frontend')
    throw new Error('--database-risk 不能与 --mode frontend 同时使用');
  if (options.port && options.temporary) throw new Error('--port 不能与 --temporary 同时使用');
  if (options.pause && (options.stop || options.handoff || options.temporary || options.apiTarget || options.check))
    throw new Error('--pause 只能用于暂停当前任务');
  if (options.stop && options.handoff) throw new Error('--stop 不能与 --handoff 同时使用');
  if (options.forceIntegrationBackend && !options.handoff)
    throw new Error('--force-integration-backend 只能用于 --handoff');
  if (
    options.check &&
    (options.backendPort ||
      options.apiTarget ||
      options.mode !== 'auto' ||
      options.temporary ||
      options.databaseRisk ||
      options.handoff ||
      options.stop)
  ) {
    throw new Error('--check 只能与 --port 或 --worktree 组合使用');
  }

  if (options.check) {
    const expectedWorkspaceRoot = options.worktree ? await resolveTargetRoot(options.worktree) : null;
    const port = options.port || CURRENT_TASK_FRONTEND_PORT;
    let expectations = { expectedWorkspaceRoot };
    if (expectedWorkspaceRoot) {
      const branch = gitCapture(expectedWorkspaceRoot, ['branch', '--show-current']);
      const files = taskPreviewChangedFiles(expectedWorkspaceRoot);
      const current = await currentManagedPreview(port);
      let registeredBackendPort = null;
      let registeredApiTarget = null;
      if (current?.mode === 'full') {
        const project = taskProjectName({ branch, root: expectedWorkspaceRoot });
        registeredBackendPort = existingTaskBackendPort(
          composeContext({ root: expectedWorkspaceRoot, project, backendPort: BACKEND_PORT_START }),
        );
      } else if (current?.apiTarget && current.apiTarget !== SHARED_API_TARGET) {
        const response = await previewServiceRequest('GET', '/status');
        const status = response.statusCode === 200 ? parseJson(response.body) : null;
        if (previewServiceOwnsWorktree(status, expectedWorkspaceRoot))
          registeredApiTarget = parseTaskPreviewArgs(status.taskArgs ?? []).apiTarget;
      }
      expectations = taskPreviewCheckExpectations({
        root: expectedWorkspaceRoot,
        branch,
        files,
        metadata: current,
        registeredBackendPort,
        registeredApiTarget,
      });
    }
    const metadata = await requireManagedPreviewReady({ port, ...expectations });
    console.log(`任务预览就绪：http://127.0.0.1:${port}/`);
    console.log(`Worktree：${metadata.workspaceRoot}`);
    console.log(`分支：${metadata.branch}`);
    console.log(`模式：${metadata.mode}`);
    console.log(`API 目标：${metadata.apiTarget}`);
    return;
  }

  const root = await resolveTargetRoot(options.worktree);
  const branch = gitCapture(root, ['branch', '--show-current']);
  const errors = taskPreviewErrors({ branch });
  if (errors.length > 0) throw new Error(errors.map((error) => `- ${error}`).join('\n'));
  const worktrees = parseWorktreePorcelain(gitCapture(root, ['worktree', 'list', '--porcelain']));
  if (!worktrees.some((worktree) => path.resolve(worktree.path) === path.resolve(root))) {
    throw new Error(`目标目录不是当前仓库已登记的 Worktree：${root}`);
  }

  const project = taskProjectName({ branch, root });
  const integrationWorktree = integrationWorktreeFor(worktrees);
  const integrationRoot = integrationWorktree.path;
  if (options.pause) {
    ensureDocker(root);
    const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
    await pauseDatabaseTask({
      root,
      branch,
      project,
      integrationRoot,
      context: composeContext({ root, project, backendPort }),
    });
    return;
  }
  if (options.handoff) {
    ensureDocker(root);
    const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
    const context = composeContext({ root, project, backendPort });
    await handoffDatabaseTask({
      root,
      branch,
      project,
      integrationRoot,
      context,
      forceIntegrationBackend: options.forceIntegrationBackend,
    });
    return;
  }
  if (options.stop) {
    const lock = readDatabaseLock(integrationRoot);
    const previewPort = options.port || CURRENT_TASK_FRONTEND_PORT;
    const managedPreview = await currentManagedPreview(previewPort);
    if (managedPreview && path.resolve(managedPreview.workspaceRoot) === path.resolve(root)) {
      await stopManagedPreview(previewPort);
    }
    ensureDocker(root);
    const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
    const context = composeContext({ root, project, backendPort });
    composeRun(context, ['stop', 'backend']);
    console.log(`已停止 ${branch} 的任务前端和后端；共享数据库和备份均未删除。`);
    if (lock?.project === project) {
      console.log(`共享数据库锁继续保留：${lock.backupFile}`);
    }
    return;
  }

  ensureNodeModules(root, worktrees);
  return withRuntimeStartupWatch(root, async (startupWatch) => {
    const files = taskPreviewChangedFiles(root);
    let mode = selectTaskPreviewMode({ files, requestedMode: options.mode, apiTarget: options.apiTarget });
    if (options.databaseRisk) mode = 'full';
    const riskFiles = databaseRiskFiles(files);
    if (options.databaseRisk) riskFiles.push('--database-risk');
    const activeDatabaseLock = readDatabaseLock(integrationRoot);
    const lockConflict = databaseLockError(activeDatabaseLock, { project, branch });
    if (lockConflict) throw new Error(`${lockConflict}\n当前任务备份：${activeDatabaseLock.backupFile}`);
    const frontendPort = await chooseTaskFrontendPort({
      requestedPort: options.port,
      temporary: options.temporary,
    });

    let backendContext = null;
    let apiTarget = options.apiTarget;
    if (mode === 'full') {
      const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
      backendContext = composeContext({ root, project, backendPort });
      await ensureTaskBackend({ context: backendContext, integrationRoot, root, branch, project, riskFiles });
      apiTarget = `http://127.0.0.1:${backendPort}`;
    } else if (apiTarget) {
      const apiUrl = new URL(apiTarget);
      if (
        ['127.0.0.1', 'localhost'].includes(apiUrl.hostname) &&
        (await requestStatus(`${apiTarget}/actuator/health`)) !== 200
      ) {
        throw new Error(`指定 API 未就绪：${apiTarget}`);
      }
    } else {
      await ensureSharedBackend(worktrees);
      apiTarget = SHARED_API_TARGET;
    }

    await prepareFrontendPort({
      port: frontendPort,
      allowManagedSwitch: !options.port && !options.temporary,
    });

    console.log(`任务预览：${branch}`);
    console.log(`自动模式：${mode === 'full' ? '完整前后端' : '快速前端'}`);
    if (mode === 'full') {
      for (const file of backendSensitiveFiles(files)) console.log(`- 后端影响：${file}`);
    }
    console.log(
      `${options.port || options.temporary ? '准备临时页面' : '准备固定页面'}：http://127.0.0.1:${frontendPort}/`,
    );
    console.log(`API 代理：${apiTarget}`);
    console.log('按 Ctrl+C 只停止前端；任务后端继续保留，数据始终位于集成数据库。');

    let frontend = null;
    let shuttingDown = false;
    let restartingFrontend = false;
    const attachFrontend = (child) => {
      child.on('error', (error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
      child.on('exit', (code) => {
        if (shuttingDown || restartingFrontend || child !== frontend) return;
        closeWatchers();
        process.exitCode = code ?? 1;
      });
      return child;
    };
    const updateBackend = async (reasons) => {
      try {
        const reason = reasons.join(', ');
        if (mode === 'frontend') {
          if (options.apiTarget || options.mode === 'frontend') {
            console.warn(`检测到 ${reason} 变化，但当前为显式前端模式；重新运行并使用 --mode auto 或 full。`);
            return;
          }
          console.log(`检测到 ${reason} 变化，正在自动升级为完整前后端模式…`);
          const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
          backendContext = composeContext({ root, project, backendPort });
          const currentRiskFiles = databaseRiskFiles(taskPreviewChangedFiles(root));
          if (options.databaseRisk) currentRiskFiles.push('--database-risk');
          await ensureTaskBackend({
            context: backendContext,
            integrationRoot,
            root,
            branch,
            project,
            riskFiles: currentRiskFiles,
          });
          apiTarget = `http://127.0.0.1:${backendPort}`;
          restartingFrontend = true;
          await stopChild(frontend);
          mode = 'full';
          frontend = attachFrontend(spawnFrontend({ root, branch, port: frontendPort, apiTarget, mode }));
          try {
            await waitForManagedPreviewReady({
              port: frontendPort,
              expectedWorkspaceRoot: root,
              expectedBranch: branch,
              expectedMode: mode,
              expectedApiTarget: apiTarget,
            });
          } catch (error) {
            await stopChild(frontend);
            throw error;
          } finally {
            restartingFrontend = false;
          }
          console.log(`已切换完整模式，页面地址保持：http://127.0.0.1:${frontendPort}/`);
          return;
        }
        const currentRiskFiles = databaseRiskFiles(taskPreviewChangedFiles(root));
        if (options.databaseRisk) currentRiskFiles.push('--database-risk');
        await ensureTaskBackend({
          context: backendContext,
          integrationRoot,
          root,
          branch,
          project,
          riskFiles: currentRiskFiles,
        });
      } catch (error) {
        if (error.code !== 'RUNTIME_INPUT_CHANGED') throw error;
        console.log('后端启动期间又有修改，合并到下一次加载。');
        startupWatch.notify('backend/src');
      }
    };
    const backendQueue = createLatestChangeQueue({
      run: updateBackend,
      onError: async (error) => {
        console.error(error instanceof Error ? error.message : error);
        closeWatchers();
        await stopChild(frontend);
        process.exitCode = 1;
        console.error('任务后端未能恢复健康，已关闭当前任务页面入口。');
      },
    });
    const closeWatchers = () => {
      backendQueue.close();
      startupWatch.close();
    };

    frontend = attachFrontend(spawnFrontend({ root, branch, port: frontendPort, apiTarget, mode }));
    try {
      await waitForManagedPreviewReady({
        port: frontendPort,
        expectedWorkspaceRoot: root,
        expectedBranch: branch,
        expectedMode: mode,
        expectedApiTarget: apiTarget,
      });
      await startupWatch.settle(updateBackend, (reason) => backendQueue.notify(reason));
    } catch (error) {
      closeWatchers();
      await stopChild(frontend);
      if (mode === 'full') {
        console.log('任务后端继续保留，便于检查日志；当前页面入口已关闭。');
      }
      throw error;
    }
    console.log(`预览 API 链路已就绪：http://127.0.0.1:${frontendPort}/ → ${apiTarget}`);

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      closeWatchers();
      await stopChild(frontend);
      if (mode === 'full') {
        console.log(`任务后端仍在运行。停止命令：node ${fileURLToPath(import.meta.url)} --worktree "${root}" --stop`);
      }
      process.exit(0);
    };
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
  });
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
