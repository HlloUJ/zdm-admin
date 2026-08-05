import { existsSync, readFileSync, symlinkSync, watch } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { branchKind, DEFAULT_INTEGRATION_BRANCH, parseWorktreePorcelain } from './git-workflow-core.mjs';

const FRONTEND_PORT_START = 5174;
const FRONTEND_PORT_END = 5199;
const BACKEND_PORT_START = 8081;
const BACKEND_PORT_END = 8099;
const SHARED_API_TARGET = 'http://127.0.0.1:8080';
const MAVEN_VOLUME = 'zdm-admin_zdm_maven_repo';
const launcherRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const taskComposeFile = path.join(launcherRoot, 'docker-compose.task.yml');

export function parseTaskPreviewArgs(args) {
  const result = {
    port: null,
    backendPort: null,
    apiTarget: null,
    mode: 'auto',
    worktree: null,
    stop: false,
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
    return Number.isInteger(port) ? port : null;
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

function composeContext({ root, project, backendPort }) {
  return {
    cwd: root,
    env: {
      ...process.env,
      ZDM_TASK_WORKSPACE: root,
      ZDM_TASK_BACKEND_PORT: String(backendPort),
    },
    args: [
      'compose',
      '--project-name',
      project,
      '--project-directory',
      root,
      '--file',
      path.join(root, 'docker-compose.yml'),
      '--file',
      taskComposeFile,
    ],
  };
}

function composeCapture(context, args, allowFailure = false) {
  return capture('docker', [...context.args, ...args], { ...context, allowFailure });
}

function composeRun(context, args) {
  run('docker', [...context.args, ...args], context);
}

function requestStatus(url, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(target, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.once('timeout', () => {
      request.destroy();
      resolve(0);
    });
    request.once('error', () => resolve(0));
  });
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
  if (!capture('docker', ['volume', 'inspect', MAVEN_VOLUME], { cwd: root, allowFailure: true })) {
    run('docker', ['volume', 'create', MAVEN_VOLUME], { cwd: root });
  }
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

async function ensureTaskBackend(context) {
  ensureDocker(context.cwd);
  composeRun(context, ['up', '-d', 'mysql']);
  const mysqlId = composeCapture(context, ['ps', '--quiet', 'mysql']);
  await waitUntil(
    () =>
      capture('docker', ['inspect', '--format', '{{.State.Health.Status}}', mysqlId], { cwd: context.cwd }) ===
      'healthy',
    { timeoutMs: 120_000, message: '等待任务 MySQL 健康检查超时' },
  );
  composeRun(context, ['up', '-d', '--force-recreate', 'backend']);
  const healthUrl = `http://127.0.0.1:${context.env.ZDM_TASK_BACKEND_PORT}/actuator/health`;
  try {
    await waitForHttp(healthUrl);
  } catch (error) {
    composeRun(context, ['logs', '--tail', '80', 'backend']);
    throw error;
  }
  console.log(`任务后端：http://127.0.0.1:${context.env.ZDM_TASK_BACKEND_PORT}`);
  console.log('任务数据库：独立 MySQL（不暴露主机端口，停止任务环境时删除）');
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
  const integrationWorktree = worktrees.find((worktree) => worktree.branch === DEFAULT_INTEGRATION_BRANCH);
  if (!integrationWorktree) throw new Error(`未找到 ${DEFAULT_INTEGRATION_BRANCH} 固定 Worktree`);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'backend:ensure'], {
    cwd: integrationWorktree.path,
  });
  await waitForHttp(healthUrl);
}

function targetViteConfig(root) {
  const localConfig = path.join(root, 'vite.config.js');
  if (existsSync(localConfig) && readFileSync(localConfig, 'utf8').includes('ZDM_TASK_PREVIEW')) return localConfig;
  return path.join(launcherRoot, 'vite.config.js');
}

function spawnFrontend({ root, port, apiTarget }) {
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
        VITE_PUBLIC_APP_ORIGIN: `http://127.0.0.1:${port}`,
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
  --port 5174               指定任务前端端口（5174-5199）
  --backend-port 8081       指定任务后端端口（8081-8099）
  --api http://...          显式使用指定 API，并进入前端模式
  --worktree /path          从新版启动器预览尚未包含该脚本的旧任务 Worktree
  --stop                    停止并删除该任务的完整后端与临时数据库`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseTaskPreviewArgs(args);
  if (options.help) {
    printHelp();
    return;
  }
  if (options.apiTarget && options.mode === 'full') throw new Error('--api 不能与 --mode full 同时使用');

  const root = await resolveTargetRoot(options.worktree);
  const branch = gitCapture(root, ['branch', '--show-current']);
  const errors = taskPreviewErrors({ branch });
  if (errors.length > 0) throw new Error(errors.map((error) => `- ${error}`).join('\n'));
  const worktrees = parseWorktreePorcelain(gitCapture(root, ['worktree', 'list', '--porcelain']));
  if (!worktrees.some((worktree) => path.resolve(worktree.path) === path.resolve(root))) {
    throw new Error(`目标目录不是当前仓库已登记的 Worktree：${root}`);
  }

  const project = taskProjectName({ branch, root });
  if (options.stop) {
    ensureDocker(root);
    const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
    const context = composeContext({ root, project, backendPort });
    composeRun(context, ['down', '--remove-orphans']);
    console.log(`已停止 ${branch} 的完整任务环境；临时数据库已删除，Maven 共享缓存保留。`);
    return;
  }

  ensureNodeModules(root, worktrees);
  const files = changedFiles(root);
  let mode = selectTaskPreviewMode({ files, requestedMode: options.mode, apiTarget: options.apiTarget });
  const frontendPort =
    options.port ?? (await findAvailablePort({ start: FRONTEND_PORT_START, end: FRONTEND_PORT_END }));
  if (options.port && (await isPortOpen(options.port))) throw new Error(`前端端口 ${options.port} 已被占用`);

  let backendContext = null;
  let apiTarget = options.apiTarget;
  if (mode === 'full') {
    const backendPort = await chooseBackendPort({ root, project, requestedPort: options.backendPort });
    backendContext = composeContext({ root, project, backendPort });
    await ensureTaskBackend(backendContext);
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

  console.log(`任务预览：${branch}`);
  console.log(`自动模式：${mode === 'full' ? '完整前后端' : '快速前端'}`);
  if (mode === 'full') {
    for (const file of backendSensitiveFiles(files)) console.log(`- 后端影响：${file}`);
  }
  console.log(`页面地址：http://127.0.0.1:${frontendPort}/`);
  console.log(`API 代理：${apiTarget}`);
  console.log('按 Ctrl+C 只停止前端；完整任务后端与数据库会保留供后续反馈复用。');

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
            await ensureTaskBackend(backendContext);
            apiTarget = `http://127.0.0.1:${backendPort}`;
            restartingFrontend = true;
            await stopChild(frontend);
            frontend = attachFrontend(spawnFrontend({ root, port: frontendPort, apiTarget }));
            restartingFrontend = false;
            mode = 'full';
            console.log(`已切换完整模式，页面地址保持：http://127.0.0.1:${frontendPort}/`);
            return;
          }
          if (['docker-compose.yml', 'compose.yml', 'compose.yaml'].includes(reason)) {
            await ensureTaskBackend(backendContext);
          } else {
            await restartTaskBackend(backendContext);
          }
        })
        .catch((error) => console.error(error instanceof Error ? error.message : error));
    }, 700);
  });

  const closeWatchers = () => {
    clearTimeout(backendTimer);
    for (const watcher of watchers) watcher.close();
  };
  frontend = attachFrontend(spawnFrontend({ root, port: frontendPort, apiTarget }));

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    closeWatchers();
    await stopChild(frontend);
    if (mode === 'full') {
      console.log(`完整任务环境仍在运行。清理命令：node ${fileURLToPath(import.meta.url)} --worktree "${root}" --stop`);
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
