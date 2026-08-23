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
  return files.filter(
    (file) =>
      file.startsWith('backend/') ||
      ['docker-compose.yml', 'docker-compose.task.yml', 'compose.yml', 'compose.yaml', 'pom.xml'].includes(file) ||
      file.startsWith('scripts/backend-') ||
      file === 'scripts/ensure-backend.mjs' ||
      file.startsWith('scripts/restore-db') ||
      file.startsWith('scripts/backup-db'),
  );
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
  const currentLock = path.join(root, 'package-lock.json');
  if (!existsSync(currentLock)) return null;
  const lockContent = readFileSync(currentLock, 'utf8');
  for (const worktree of worktrees) {
    if (path.resolve(worktree.path) === path.resolve(root)) continue;
    const modules = path.join(worktree.path, 'node_modules');
    const lock = path.join(worktree.path, 'package-lock.json');
    if (existsSync(modules) && existsSync(lock) && readFileSync(lock, 'utf8') === lockContent) return modules;
  }
  return null;
}

function capture(command, args, { cwd, allowFailure = false, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status === 0) return result.stdout.trim();
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

function changedFiles(root) {
  const baseRef = refExists('refs/remotes/origin/main', root) ? 'origin/main' : 'main';
  const values = [
    gitCapture(root, ['diff', '--name-only', `${baseRef}...HEAD`], true),
    gitCapture(root, ['diff', '--name-only'], true),
    gitCapture(root, ['diff', '--cached', '--name-only'], true),
    gitCapture(root, ['ls-files', '--others', '--exclude-standard'], true),
  ];
  return [...new Set(values.flatMap((value) => value.split(/\r?\n/)).filter(Boolean))];
}

function ensureNodeModules(root, worktrees) {
  const localModules = path.join(root, 'node_modules');
  if (existsSync(localModules)) return;
  const sharedModules = selectSharedNodeModules({ root, worktrees });
  if (!sharedModules) throw new Error('当前 Worktree 缺少可复用且版本一致的 node_modules，请先安装依赖');
  symlinkSync(sharedModules, localModules, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`复用依赖：${sharedModules}`);
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
      unlinkSync(path.join(directory, entry.name));
    }
  } else {
    mkdirSync(directory, { recursive: true });
  }
  const catalog = mergeMigrationCatalog({
    integrationFiles: readMigrationCatalog(integrationRoot),
    taskFiles: readMigrationCatalog(root),
  });
  for (const entry of catalog) writeFileSync(path.join(directory, entry.name), entry.content, { flag: 'wx' });
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
      resolve({ statusCode: 0, body: '' });
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

async function stopSupervisedPreview(root) {
  const currentResponse = await previewServiceRequest('GET', '/status');
  const currentStatus = currentResponse.statusCode === 200 ? parseJson(currentResponse.body) : null;
  if (!previewServiceOwnsWorktree(currentStatus, root)) return false;

  const stopResponse = await previewServiceRequest('POST', '/stop');
  if (stopResponse.statusCode >= 200 && stopResponse.statusCode < 300) return true;
  const finalResponse = await previewServiceRequest('GET', '/status');
  const finalStatus = finalResponse.statusCode === 200 ? parseJson(finalResponse.body) : null;
  if (previewServiceOwnsWorktree(finalStatus, root)) {
    throw new Error(`任务预览守护服务未能释放旧任务：${root}`);
  }
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

async function ensureIntegrationDatabase(integrationRoot) {
  ensureDocker(integrationRoot);
  const context = integrationComposeContext(integrationRoot);
  run('docker', [...context.args, 'up', '-d', 'mysql'], context);
  await waitUntil(
    () =>
      capture('docker', ['inspect', '--format', '{{.State.Health.Status}}', INTEGRATION_MYSQL_CONTAINER], {
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

async function startIntegrationBackend(integrationRoot) {
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'backend:ensure'], { cwd: integrationRoot });
  await waitForHttp(`${SHARED_API_TARGET}/actuator/health`);
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

async function ensureTaskBackend({ context, integrationRoot, root, branch, project, riskFiles = [] }) {
  await ensureIntegrationDatabase(integrationRoot);
  const migrations = prepareTaskMigrations({ root, integrationRoot, project });
  const lock = readDatabaseLock(integrationRoot);
  const conflict = databaseLockError(lock, { project, branch });
  if (conflict) throw new Error(`${conflict}\n当前任务备份：${lock.backupFile}`);
  if (riskFiles.length > 0) {
    await acquireDatabaseLock({ context, integrationRoot, root, branch, project, riskFiles });
  }
  composeRun(context, ['up', '-d', '--no-deps', '--force-recreate', 'backend']);
  const healthUrl = `http://127.0.0.1:${context.env.ZDM_TASK_BACKEND_PORT}/actuator/health`;
  try {
    await waitForHttp(healthUrl);
  } catch (error) {
    composeRun(context, ['logs', '--tail', '80', 'backend']);
    const activeLock = readDatabaseLock(integrationRoot);
    if (activeLock?.project === project) {
      console.error(`数据库保护点保留：${activeLock.backupFile}`);
      console.error('集成后端保持暂停；恢复数据库必须先取得用户明确确认。');
    }
    throw error;
  }
  console.log(`任务后端：http://127.0.0.1:${context.env.ZDM_TASK_BACKEND_PORT}`);
  console.log('任务数据库：复用集成 MySQL / zdm_admin（手工验收数据持续保留）');
  console.log(`Flyway 迁移目录：集成基线 + 当前任务（${migrations.count} 个）`);
}

async function restartTaskBackend(context) {
  console.log('检测到后端源码变化，正在重启任务后端…');
  composeRun(context, ['restart', 'backend']);
  const healthUrl = `http://127.0.0.1:${context.env.ZDM_TASK_BACKEND_PORT}/actuator/health`;
  try {
    await waitForHttp(healthUrl);
    console.log('任务后端已加载最新代码。');
  } catch (error) {
    composeRun(context, ['logs', '--tail', '80', 'backend']);
    throw error;
  }
}

async function ensureSharedBackend(worktrees) {
  const healthUrl = `${SHARED_API_TARGET}/actuator/health`;
  if ((await requestStatus(healthUrl)) === 200) return;
  const integrationWorktree = integrationWorktreeFor(worktrees);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'backend:ensure'], {
    cwd: integrationWorktree.path,
  });
  await waitForHttp(healthUrl);
}

async function handoffDatabaseTask({ root, branch, project, integrationRoot, context }) {
  const lock = readDatabaseLock(integrationRoot);
  if (lock && lock.project !== project) throw new Error(databaseLockError(lock, { project, branch }));
  const taskHead = gitCapture(root, ['rev-parse', 'HEAD']);
  const integrationHead = gitCapture(integrationRoot, ['rev-parse', 'HEAD']);
  const contained = spawnSync('git', ['merge-base', '--is-ancestor', taskHead, integrationHead], {
    cwd: integrationRoot,
  }).status;
  if (contained !== 0) {
    throw new Error('任务提交尚未包含在 codex/integration-current，不能执行任务交接');
  }

  const supervisedPreviewStopped = await stopSupervisedPreview(root);
  const managedPreview = supervisedPreviewStopped ? null : await currentManagedPreview();
  if (managedPreview && path.resolve(managedPreview.workspaceRoot) === path.resolve(root)) {
    await stopManagedPreview();
  }
  if (supervisedPreviewStopped || managedPreview) {
    console.log(`旧任务预览已停止：${branch}`);
  }
  composeRun(context, ['stop', 'backend']);
  await ensureIntegrationDatabase(integrationRoot);
  await startIntegrationBackend(integrationRoot);
  if (lock) {
    const { lockFile } = databaseRuntimePaths(integrationRoot);
    unlinkSync(lockFile);
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

function createBackendWatchers(root, onChange) {
  const watchers = [];
  const source = path.join(root, 'backend', 'src');
  if (existsSync(source)) watchers.push(watch(source, { recursive: true }, () => onChange('backend/src')));
  const backend = path.join(root, 'backend');
  if (existsSync(backend)) {
    watchers.push(
      watch(backend, (event, filename) => {
        if (`${filename}` === 'pom.xml') onChange('backend/pom.xml');
      }),
    );
  }
  watchers.push(
    watch(root, (event, filename) => {
      if (['docker-compose.yml', 'compose.yml', 'compose.yaml'].includes(`${filename}`)) onChange(`${filename}`);
    }),
  );
  return watchers;
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
  --check                   检查当前任务预览身份及其 API 代理链路
  --handoff                 集成分支包含任务提交后，停止任务预览和后端、恢复集成后端并释放数据库锁
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
  if (options.stop && options.handoff) throw new Error('--stop 不能与 --handoff 同时使用');
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
    const metadata = await requireManagedPreviewReady({ port, expectedWorkspaceRoot });
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
  if (options.handoff) {
    ensureDocker(root);
    const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
    const context = composeContext({ root, project, backendPort });
    await handoffDatabaseTask({ root, branch, project, integrationRoot, context });
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
  const files = changedFiles(root);
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
  let backendTimer = null;
  let backendJob = Promise.resolve();
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
  const watchers = createBackendWatchers(root, (reason) => {
    clearTimeout(backendTimer);
    backendTimer = setTimeout(() => {
      backendJob = backendJob
        .then(async () => {
          if (mode === 'frontend') {
            if (options.apiTarget || options.mode === 'frontend') {
              console.warn(`检测到 ${reason} 变化，但当前为显式前端模式；重新运行并使用 --mode auto 或 full。`);
              return;
            }
            console.log(`检测到 ${reason} 变化，正在自动升级为完整前后端模式…`);
            const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
            backendContext = composeContext({ root, project, backendPort });
            const currentRiskFiles = databaseRiskFiles(changedFiles(root));
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
          const currentRiskFiles = databaseRiskFiles(changedFiles(root));
          if (options.databaseRisk) currentRiskFiles.push('--database-risk');
          if (currentRiskFiles.length > 0 || ['docker-compose.yml', 'compose.yml', 'compose.yaml'].includes(reason)) {
            await ensureTaskBackend({
              context: backendContext,
              integrationRoot,
              root,
              branch,
              project,
              riskFiles: currentRiskFiles,
            });
          } else {
            await restartTaskBackend(backendContext);
          }
        })
        .catch(async (error) => {
          console.error(error instanceof Error ? error.message : error);
          closeWatchers();
          await stopChild(frontend);
          process.exitCode = 1;
          console.error('任务后端未能恢复健康，已关闭当前任务页面入口。');
        });
    }, 700);
  });

  const closeWatchers = () => {
    clearTimeout(backendTimer);
    for (const watcher of watchers) watcher.close();
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
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
