import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry, parallelTaskMode } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { assertPreviewOwner, transitionSelectedPreview } from './preview-transition.mjs';
import { preparePreviewTarget, prepareRetainedTarget, validatePreparedTarget } from './preview-target.mjs';

export const RETAINED_HANDOFF_PROTOCOL = 1;
export const SERVICE_LABEL = 'com.zdm.admin.task-preview';
export const CURRENT_TASK_PREVIEW_URL = 'http://127.0.0.1:5175/';
export const INTEGRATION_PREVIEW_URL = 'http://127.0.0.1:5173/';
export const MANAGED_TASK_PREVIEW_PORT = 5176;
const CONTROL_PATH = '/__zdm_task_preview__';
const CONTROL_TIMEOUT_MS = 300_000;
const DOCKER_START_TIMEOUT_MS = 180_000;
const COMMANDS = new Set(['install', 'switch', 'status', 'stop', 'logs', 'run', 'help']);
const sourceFile = fileURLToPath(import.meta.url);

export function servicePaths(home = homedir()) {
  const runtimeDirectory = path.join(home, 'Library', 'Application Support', 'zdm-admin', 'task-preview');
  return {
    runtimeDirectory,
    runtimeScript: path.join(runtimeDirectory, 'task-preview-service.mjs'),
    configFile: path.join(runtimeDirectory, 'config.json'),
    socketFile: path.join(runtimeDirectory, 'service.sock'),
    logFile: path.join(home, 'Library', 'Logs', 'zdm-admin', 'task-preview.log'),
    launchAgentFile: path.join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`),
  };
}

export function parseServiceArgs(args) {
  const values = [...args];
  let command = 'switch';
  let json = false;
  if (values[0] === '--help' || values[0] === '-h') {
    values.shift();
    command = 'help';
  } else if (COMMANDS.has(values[0])) {
    command = values.shift();
  }
  let worktree = null;
  let lines = 120;
  const taskArgs = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--worktree') {
      worktree = values[index + 1];
      if (!worktree) throw new Error('--worktree 缺少目录');
      index += 1;
      continue;
    }
    if (value === '--lines') {
      lines = Number(values[index + 1]);
      if (!Number.isInteger(lines) || lines < 1 || lines > 1_000) throw new Error('--lines 必须是 1 至 1000');
      index += 1;
      continue;
    }
    if (value === '--json') {
      json = true;
      continue;
    }
    taskArgs.push(value);
  }
  if (json && command !== 'status') throw new Error('--json 只能用于 status');
  return { command, worktree, lines, json, taskArgs };
}

export function shouldRunForeground(taskArgs) {
  return taskArgs.includes('--temporary') || taskArgs.includes('--port');
}

export function previewCommand({
  nodePath,
  launcherPath,
  worktree,
  taskArgs = [],
  managedPort = MANAGED_TASK_PREVIEW_PORT,
}) {
  return {
    command: nodePath,
    args: [launcherPath, '--worktree', worktree, '--port', String(managedPort), ...taskArgs],
  };
}

export function taskArgsEqual(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
export function frozenRestoreArgs(config, worktree, args) {
  if (config.taskRegistryProtocol !== 2) return args;
  const registry = createTaskRegistry(path.dirname(path.dirname(config.launcherPath)));
  const task = registry.list().find((record) => record.worktree === worktree);
  if (!task?.frozen) return args;
  const leases = createResourceLeases(registry.commonDir),
    preview = leases.inspect('preview-5175'),
    completion = leases.inspect('task-delivery-' + task.id);
  if (
    preview?.task !== task.id ||
    completion?.task !== task.owner ||
    gitCapture(worktree, ['rev-parse', 'HEAD']) !== task.recordedHead ||
    gitCapture(worktree, ['status', '--porcelain'])
  )
    throw new Error('冻结候选恢复归属或源码变化，保留数据和当前选择');
  process.kill(preview.pid, 0);
  process.kill(completion.pid, 0);
  if (args.length && !taskArgsEqual(args, ['--mode', 'full'])) throw new Error('冻结候选恢复参数尚未核验');
  return ['--mode', 'full', '--validation-candidate', task.recordedHead];
}

export function dockerDesktopLaunchCommand(platform = process.platform) {
  return platform === 'darwin' ? { command: '/usr/bin/open', args: ['-gj', '-a', 'Docker'] } : null;
}

export function restartDelay(attempt) {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

function xmlEscape(value) {
  return `${value}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xmlString(value) {
  return `    <string>${xmlEscape(value)}</string>`;
}

export function launchAgentPlist({ nodePath, runtimeScript, workingDirectory, logFile, pathValue }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${xmlString(nodePath)}
${xmlString(runtimeScript)}
${xmlString('run')}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(pathValue)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logFile)}</string>
</dict>
</plist>
`;
}

function ensureDirectory(directory) {
  if (existsSync(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`目录不安全：${directory}`);
    return;
  }
  mkdirSync(directory, { recursive: true });
}

function writeAtomic(file, content, mode = undefined) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { flag: 'wx', ...(mode ? { mode } : {}) });
  renameSync(temporary, file);
}

function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readConfig(paths) {
  const config = readJson(paths.configFile);
  if (!config?.launcherPath || !config?.nodePath) {
    throw new Error(`预览服务尚未安装或配置损坏：${paths.configFile}`);
  }
  return config;
}

function writeConfig(paths, config) {
  writeAtomic(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, 0o600);
}

function run(command, args, { cwd = process.cwd(), allowFailure = false, stdio = 'pipe' } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio });
  if (result.status === 0 || allowFailure) return result;
  throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
}

function gitCapture(cwd, args) {
  return run('git', args, { cwd }).stdout.trim();
}

function guardedJson(file) {
  if (lstatSync(path.dirname(file)).isSymbolicLink() || lstatSync(file).isSymbolicLink())
    throw new Error('预览交接登记不得为软链接');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function retainedCarrier(root, selected) {
  if (!selected || path.basename(selected) !== 'preview-current' || lstatSync(selected).isSymbolicLink())
    throw new Error('当前预览不是已交付的长期载体');
  const common = (cwd) => realpathSync(path.resolve(cwd, gitCapture(cwd, ['rev-parse', '--git-common-dir'])));
  const commonDir = common(root);
  if (common(selected) !== commonDir) throw new Error('预览与目标不属于同一仓库');
  if (
    gitCapture(selected, ['branch', '--show-current']) !== 'codex/preview-current' ||
    gitCapture(selected, ['status', '--porcelain'])
  )
    throw new Error('长期预览载体不干净或分支不符');
  const head = gitCapture(selected, ['rev-parse', 'HEAD']);
  if (head !== gitCapture(root, ['rev-parse', 'origin/main'])) throw new Error('长期预览不是已发布主线');
  const record = guardedJson(path.join(commonDir, 'preview-environment/environment.json'));
  if (record.version !== 1 || path.resolve(record.repository ?? '') !== commonDir || record.profile?.status !== 'ready')
    throw new Error('长期预览数据身份未就绪');
  return {
    commonDir,
    head,
    profileFingerprint: createHash('sha256').update(JSON.stringify(record.profile)).digest('hex'),
  };
}

// Shared by the task starter, CLI and the installed, self-contained service.
export function retainedPublishedPreview(root, selected) {
  try {
    retainedCarrier(root, selected);
    return true;
  } catch {
    return false;
  }
}

export function retainedHandoffProof(target, selected, { freshRemote = false } = {}) {
  const carrier = retainedCarrier(target, selected);
  const record = guardedJson(path.join(carrier.commonDir, 'task-batches/active.json'));
  const branch = gitCapture(target, ['branch', '--show-current']);
  if (
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    !record.id ||
    record.closedAt ||
    record.kind !== 'business' ||
    path.resolve(record.worktree ?? '') !== path.resolve(target) ||
    path.resolve(record.repository?.commonDir ?? '') !== carrier.commonDir ||
    record.branch !== branch ||
    !branch.startsWith('codex/') ||
    ['codex/preview-current', 'codex/integration-current'].includes(branch) ||
    record.originMain !== carrier.head ||
    record.recordedHead !== gitCapture(target, ['rev-parse', 'HEAD'])
  )
    throw new Error('目标不是当前仓库已登记的新业务任务');
  const entries = gitCapture(target, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/);
  const integration = entries
    .find((entry) => entry.split(/\r?\n/).includes('branch refs/heads/codex/integration-current'))
    ?.split(/\r?\n/)
    .find((line) => line.startsWith('worktree '))
    ?.slice(9);
  if (!integration || existsSync(path.join(integration, 'backups/task-preview/active-database-task.json')))
    throw new Error('集成载体未知或数据库保护锁尚未交接');
  if (freshRemote) {
    const remote = gitCapture(target, ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/);
    if (remote.length !== 2 || remote[0] !== carrier.head || remote[1] !== 'refs/heads/main')
      throw new Error('长期预览不再是远端最新主线');
  }
  return {
    source: path.resolve(selected),
    target: path.resolve(target),
    main: carrier.head,
    profileFingerprint: carrier.profileFingerprint,
    batchId: record.id,
  };
}

function stopRetainedBackend(config, root) {
  run(config.nodePath, [config.launcherPath, '--worktree', root, '--stop'], { cwd: root, stdio: 'inherit' });
}

function resolveTaskWorktree(value = process.cwd()) {
  const requested = path.resolve(value);
  const root = path.resolve(gitCapture(requested, ['rev-parse', '--show-toplevel']));
  if (root !== requested) throw new Error(`请指定任务 Worktree 根目录：${root}`);
  const branch = gitCapture(root, ['branch', '--show-current']);
  if (
    !branch.startsWith('codex/') ||
    branch === 'codex/integration-current' ||
    branch.startsWith('codex/acceptance-')
  ) {
    throw new Error(`只能切换到普通 codex/* 任务分支，当前为：${branch || '(detached)'}`);
  }
  const registered = gitCapture(root, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length)));
  if (!registered.includes(root)) throw new Error(`目录不是已登记的 Git Worktree：${root}`);
  return { root, branch };
}

function discoverIntegrationLauncher(cwd = process.cwd()) {
  const root = path.resolve(gitCapture(cwd, ['rev-parse', '--show-toplevel']));
  const records = gitCapture(root, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/);
  for (const record of records) {
    const lines = record.split(/\r?\n/);
    const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length);
    if (worktree && branch === 'refs/heads/codex/integration-current') {
      const launcher = path.join(worktree, 'scripts', 'dev-task.mjs');
      if (!existsSync(launcher)) throw new Error(`集成 Worktree 缺少任务启动器：${launcher}`);
      return path.resolve(launcher);
    }
  }
  throw new Error('未找到 codex/integration-current 固定 Worktree');
}

export function normalizedPath(nodePath = process.execPath) {
  const values = [
    path.dirname(nodePath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  return [...new Set(values.filter(Boolean))].join(path.delimiter);
}

function launchctlTarget() {
  if (typeof process.getuid !== 'function') throw new Error('当前系统不支持用户级 launchd');
  return `gui/${process.getuid()}`;
}

function launchctl(args, allowFailure = false) {
  return run('/bin/launchctl', args, { allowFailure });
}

export function requestJson({ paths, method = 'GET', requestPath = '/status', payload = null, timeoutMs = 5_000 }) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const request = http.request(
      {
        socketPath: paths.socketFile,
        // Synchronous delivery work can delay FIN handling beyond the server idle timeout.
        agent: false,
        path: requestPath,
        method,
        headers: {
          'x-zdm-preview-protocol': '2',
          ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let value;
          try {
            value = text ? JSON.parse(text) : {};
          } catch {
            reject(new Error(`预览服务返回了无效响应：${text}`));
            return;
          }
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(value.error || `预览服务请求失败：${response.statusCode}`));
            return;
          }
          resolve(value);
        });
      },
    );
    request.once('timeout', () => request.destroy(new Error('预览服务请求超时')));
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function requestPreviewMetadata(baseUrl = CURRENT_TASK_PREVIEW_URL, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const request = http.get(new URL(CONTROL_PATH, baseUrl), { timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(value?.type === 'zdm-task-preview' ? value : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.once('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.once('error', () => resolve(null));
  });
}

// Check before stopping the selected frontend/backend. Temporary validation and
// other frontend consumers retain their own lifetimes; this check stops nothing.
export async function assertPreviewConsumersReleased(worktree, request = requestPreviewMetadata) {
  if (!worktree) return;
  const selected = await request('http://127.0.0.1:5176/');
  const api = selected?.workspaceRoot === worktree ? selected.apiTarget : null;
  const metadata = await Promise.all(
    Array.from({ length: 23 }, (_, index) => request(`http://127.0.0.1:${5177 + index}/`)),
  );
  if (metadata.some((item) => item && (item.workspaceRoot === worktree || (api && item.apiTarget === api))))
    throw new Error('临时预览或验证仍在引用当前后端；保留所有运行环境，稍后重试准确请求');
}

export function resumeServiceSelection(supervisor) {
  if (supervisor.config.taskRegistryProtocol !== 2 && supervisor.config.selectedWorktree)
    return supervisor.switch(supervisor.config.selectedWorktree, supervisor.config.taskArgs ?? []);
  return supervisor.enqueue(() => supervisor.launchSelected());
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function dockerIsReady(config) {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    env: { ...process.env, PATH: config.pathValue || process.env.PATH },
    encoding: 'utf8',
    timeout: 5_000,
  });
  return result.status === 0;
}

async function ensureDockerReady(config, timeoutMs = DOCKER_START_TIMEOUT_MS) {
  if (dockerIsReady(config)) return;
  const launch = dockerDesktopLaunchCommand();
  if (!launch) throw new Error('Docker 不可用，请先启动 Docker 服务');
  const result = spawnSync(launch.command, launch.args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || '无法启动 Docker Desktop');
  }
  console.log('Docker Desktop 尚未运行，已在后台启动并等待就绪…');
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (dockerIsReady(config)) return;
    await sleep(2_000);
  }
  throw new Error('等待 Docker Desktop 就绪超时');
}

async function waitForService(paths, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await requestJson({ paths, timeoutMs: 1_000 });
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`等待预览守护服务启动超时：${lastError?.message || paths.socketFile}`);
}

async function waitForPreview(
  worktree,
  child,
  { baseUrl = CURRENT_TASK_PREVIEW_URL, timeoutMs = CONTROL_TIMEOUT_MS } = {},
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`任务预览进程已退出：${child.exitCode ?? child.signalCode}`);
    }
    const metadata = await requestPreviewMetadata(baseUrl);
    if (metadata && path.resolve(metadata.workspaceRoot) === path.resolve(worktree)) return metadata;
    await sleep(1_000);
  }
  throw new Error(`等待 ${CURRENT_TASK_PREVIEW_URL} 切换到 ${worktree} 超时`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill('SIGTERM');
  const exited = once(child, 'exit').then(() => true);
  const timedOut = sleep(15_000).then(() => false);
  if (!(await Promise.race([exited, timedOut])) && child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => undefined);
  }
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function proxyHeaders(headers, target, forwardedHost) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    result[name] = value;
  }
  result.host = target.host;
  result['x-forwarded-host'] = forwardedHost || target.host;
  result['x-forwarded-proto'] = 'http';
  return result;
}

function writeUnavailableResponse(response, target, error) {
  if (response.headersSent) {
    response.destroy(error);
    return;
  }
  const acceptsHtml = `${response.req?.headers?.accept || ''}`.includes('text/html');
  response.statusCode = 503;
  response.setHeader('cache-control', 'no-store');
  if (acceptsHtml) {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>5175 预览入口</title></head>
  <body><main><h1>长期预览暂不可用</h1><p>5175 入口运行正常，正在等待上游 ${target?.origin ?? '长期预览服务'} 恢复。</p></main></body>
</html>`);
    return;
  }
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify({ error: 'preview upstream unavailable', upstream: target?.origin ?? null })}\n`);
}

export class PreviewGateway {
  constructor({ host = '127.0.0.1', port = 5175, integrationUrl = INTEGRATION_PREVIEW_URL } = {}) {
    this.host = host;
    this.port = port;
    this.integrationUrl = new URL(integrationUrl);
    this.upstream = null;
    this.mode = 'preview-unavailable';
    this.server = null;
    this.sockets = new Set();
  }

  status() {
    return {
      mode: this.mode,
      upstream: this.upstream?.origin ?? null,
      listening: Boolean(this.server?.listening),
    };
  }

  useUnavailable() {
    this.mode = 'preview-unavailable';
    this.upstream = null;
  }

  useIntegration() {
    this.useUnavailable();
  }

  useTask(port = MANAGED_TASK_PREVIEW_PORT) {
    this.mode = 'task';
    this.upstream = new URL(`http://127.0.0.1:${port}/`);
  }

  proxyRequest(request, response) {
    const target = this.upstream;
    if (!target) {
      writeUnavailableResponse(response, null, new Error('Persistent preview unavailable'));
      return;
    }
    const upstreamRequest = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: proxyHeaders(request.headers, target, request.headers.host),
      },
      (upstreamResponse) => {
        response.statusCode = upstreamResponse.statusCode ?? 502;
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
          response.setHeader(name, value);
        }
        upstreamResponse.pipe(response);
      },
    );
    upstreamRequest.once('error', (error) => writeUnavailableResponse(response, target, error));
    request.pipe(upstreamRequest);
  }

  proxyUpgrade(request, socket, head) {
    const target = this.upstream;
    if (!target) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstreamSocket = net.connect(Number(target.port || 80), target.hostname);
    upstreamSocket.once('connect', () => {
      const headers = { ...request.headers, host: target.host };
      const headerLines = [];
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) headerLines.push(`${name}: ${item}`);
      }
      upstreamSocket.write(
        `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headerLines.join('\r\n')}\r\n\r\n`,
      );
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstreamSocket.once('error', () => socket.destroy());
    socket.once('error', () => upstreamSocket.destroy());
  }

  async start() {
    if (this.server?.listening) return;
    const server = http.createServer((request, response) => this.proxyRequest(request, response));
    server.on('upgrade', (request, socket, head) => this.proxyUpgrade(request, socket, head));
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, resolve);
    });
    this.server = server;
  }

  async stop() {
    const server = this.server;
    if (!server) return;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function checkSelectedPreview(config, root) {
  await new Promise((resolve, reject) => {
    execFile(
      config.nodePath,
      [config.launcherPath, '--check', '--worktree', root],
      { cwd: root, env: { ...process.env, PATH: config.pathValue || process.env.PATH }, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || stdout.trim() || error.message));
        else resolve();
      },
    );
  });
}

export function resolveRetainedPreview(config) {
  const root = path.dirname(path.dirname(config.launcherPath));
  const entries = gitCapture(root, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/);
  const matches = entries.filter((entry) => entry.split(/\r?\n/).includes('branch refs/heads/codex/preview-current'));
  if (matches.length !== 1) throw new Error('长期预览载体缺失或不唯一；不重建数据或选择集成环境');
  const line = matches[0].split(/\r?\n/).find((item) => item.startsWith('worktree '));
  const target = line?.slice('worktree '.length);
  retainedCarrier(root, target);
  return target;
}

export function assertBatchStopAllowed(worktree) {
  const common = path.resolve(worktree, gitCapture(worktree, ['rev-parse', '--git-common-dir']));
  const registry = createTaskRegistry(worktree);
  const current = registry.list().filter((task) => task.worktree === realpathSync(worktree));
  if (current.length) {
    const task = registry.resolve({ worktree });
    if (!['main-verified', 'handoff-verified'].includes(task.stage))
      throw new Error('当前任务尚未完成主线验收；交接预览请使用准确任务切换，不停止或清理开发资源');
    return;
  }
  const file = path.join(common, 'task-batches', 'active.json');
  if (!existsSync(file)) throw new Error('停止目标没有有效批次登记；保留共享预览');
  const batch = guardedJson(file);
  if (
    batch.version !== 1 ||
    path.resolve(batch.worktree ?? '') !== path.resolve(worktree) ||
    path.resolve(batch.repository?.commonDir ?? '') !== common ||
    batch.branch !== gitCapture(worktree, ['branch', '--show-current']) ||
    batch.closedAt
  )
    throw new Error('预览与活动批次归属不一致；保留共享预览');
  if (
    !Array.isArray(batch.modules) ||
    !batch.modules.length ||
    batch.modules.some((module) => module.status !== 'ready')
  )
    throw new Error('仍有未完成模块；保留共享预览');
  if (typeof batch.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(batch.id)) throw new Error('批次身份无效');
  const workers = path.join(common, 'task-batches', batch.id + '.workers', 'workers.json');
  if (existsSync(workers)) {
    const state = guardedJson(workers);
    if (
      state.version !== 1 ||
      !Array.isArray(state.workers) ||
      state.workers.some(
        (worker) =>
          worker.module !== 'batch-delivery' || worker.resources?.length !== 1 || worker.resources[0] !== 'shared',
      )
    )
      throw new Error('仍有并行执行方或未知登记；保留共享预览');
  }
}

export class PreviewSupervisor {
  constructor(paths, config, gateway, dependencies = {}) {
    this.paths = paths;
    this.config = config;
    this.gateway = gateway;
    this.child = null;
    this.currentWorktree = null;
    this.currentTaskArgs = [];
    this.phase = 'idle';
    this.lastError = null;
    this.lastTransitionAt = new Date().toISOString();
    this.restartAttempts = 0;
    this.restartTimer = null;
    this.intentionalStop = false;
    this.operation = Promise.resolve();
    this.selectionRevision = 0;
    this.dependencies = {
      resolveTaskWorktree,
      run,
      assertStopAllowed: assertBatchStopAllowed,
      resolveRetainedPreview,
      writeConfig,
      ensureDockerReady,
      stopChild,
      retainedHandoffProof,
      stopRetainedBackend,
      spawn,
      waitForPreview,
      checkSelectedPreview,
      preparePreviewTarget,
      prepareRetainedTarget,
      frozenRestoreArgs,
      assertPreviewConsumersReleased,
      proveTaskDeliveryFreeze: (task, candidate) => {
        if (
          gitCapture(task.worktree, ['rev-parse', 'HEAD']) !== candidate ||
          gitCapture(task.worktree, ['status', '--porcelain'])
        )
          throw new Error('冻结候选源码已变化，保留当前运行环境');
      },
      proveRetainedAdvance: (root, selected, main) => {
        const common = (cwd) => realpathSync(path.resolve(cwd, gitCapture(cwd, ['rev-parse', '--git-common-dir'])));
        if (
          common(root) !== common(selected) ||
          gitCapture(selected, ['branch', '--show-current']) !== 'codex/preview-current' ||
          gitCapture(selected, ['status', '--porcelain'])
        )
          throw new Error('保留载体来源不明确或存在改动');
        if (gitCapture(root, ['rev-parse', 'origin/main']) !== main)
          throw new Error('待交接 main 不是准确远端跟踪版本');
        gitCapture(root, ['merge-base', '--is-ancestor', gitCapture(selected, ['rev-parse', 'HEAD']), main]);
      },
      validatePreparedTarget,
      createTaskRegistry,
      createResourceLeases,
      log: console.log,
      error: console.error,
      ...dependencies,
    };
  }

  status() {
    const gateway = this.gateway.status();
    return {
      type: 'zdm-task-preview-service',
      retainedHandoffProtocol: RETAINED_HANDOFF_PROTOCOL,
      servicePid: process.pid,
      stopOwnershipProtocol: 1,
      taskSelectionProtocol: 2,
      selectionRevision: this.selectionRevision,
      handoffHold: this.config.handoffHold ?? null,
      childPid: this.child?.pid ?? null,
      phase: this.phase,
      mode: gateway.mode,
      upstream: gateway.upstream,
      worktree: this.config.selectedWorktree ?? null,
      taskArgs: this.config.taskArgs ?? [],
      url: gateway.listening ? CURRENT_TASK_PREVIEW_URL : null,
      lastError: this.lastError,
      lastTransitionAt: this.lastTransitionAt,
      restartAttempts: this.restartAttempts,
      logFile: this.paths.logFile,
    };
  }

  transition(phase, error = null) {
    this.phase = phase;
    this.lastError = error;
    this.lastTransitionAt = new Date().toISOString();
  }

  enqueue(operation) {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(() => undefined);
    return result;
  }

  saveSelection(worktree, taskArgs) {
    this.selectionRevision += 1;
    this.config = {
      ...this.config,
      selectedWorktree: worktree,
      taskArgs,
      updatedAt: new Date().toISOString(),
    };
    this.dependencies.writeConfig(this.paths, this.config);
  }

  clearRestart() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  scheduleRestart() {
    if (this.restartTimer) return;
    this.gateway.useIntegration();
    this.restartAttempts += 1;
    const delay = restartDelay(this.restartAttempts);
    this.transition('retrying', this.lastError);
    this.dependencies.error(`任务预览将在 ${Math.round(delay / 1_000)} 秒后重试：${this.lastError || '进程退出'}`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.enqueue(() => this.launchSelected()).catch((error) => {
        this.transition('error', error instanceof Error ? error.message : `${error}`);
        this.scheduleRestart();
      });
    }, delay);
  }

  async stopOwnedChild() {
    this.intentionalStop = true;
    const child = this.child;
    try {
      await this.dependencies.stopChild(child);
      if (this.child === child) this.child = null;
    } finally {
      this.intentionalStop = false;
    }
  }

  async launchSelected() {
    if (this.config.handoffHold) throw new Error('已发布预览交接尚未完成；保留数据和当前归属，不自动启动其他环境');
    let worktree = this.config.selectedWorktree;
    if (!worktree) {
      if (this.child) throw new Error('没有登记目标但仍有预览子进程；禁止接管');
      this.gateway.useIntegration();
      this.transition('preview-unavailable');
      worktree = this.dependencies.resolveRetainedPreview(this.config);
      this.saveSelection(worktree, ['--mode', 'full']);
    }
    const resolved = this.dependencies.resolveTaskWorktree(worktree);
    if (this.child && this.currentWorktree !== resolved.root) {
      throw new Error('当前预览进程归属另一 Worktree，请先明确交接，不自动接管');
    }
    const taskArgs = this.config.taskArgs ?? [];
    if (
      this.child &&
      this.currentWorktree === resolved.root &&
      taskArgsEqual(this.currentTaskArgs, taskArgs) &&
      this.phase === 'running' &&
      this.gateway.mode === 'task'
    ) {
      const checkedChild = this.child;
      try {
        await this.dependencies.checkSelectedPreview(this.config, resolved.root);
        if (this.child === checkedChild && this.phase === 'running' && this.gateway.mode === 'task') {
          return this.status();
        }
      } catch (error) {
        this.dependencies.log(`当前任务预览检查未通过，按启动保护流程恢复：${error.message}`);
      }
    }
    if (this.config.taskRegistryProtocol === 2) await this.dependencies.assertPreviewConsumersReleased(resolved.root);
    this.gateway.useIntegration();
    await this.dependencies.ensureDockerReady(this.config);
    if (this.child) await this.stopOwnedChild();

    const command = previewCommand({
      nodePath: this.config.nodePath,
      launcherPath: this.config.launcherPath,
      worktree: resolved.root,
      taskArgs: this.dependencies.frozenRestoreArgs(this.config, resolved.root, taskArgs),
    });
    this.currentWorktree = resolved.root;
    this.currentTaskArgs = [...taskArgs];
    this.transition('starting');
    this.dependencies.log(`启动当前任务预览：${resolved.branch} (${resolved.root})`);
    const child = this.dependencies.spawn(command.command, command.args, {
      cwd: resolved.root,
      env: {
        ...process.env,
        PATH: this.config.pathValue || process.env.PATH,
        ZDM_TASK_PUBLIC_ORIGIN: new URL(CURRENT_TASK_PREVIEW_URL).origin,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    this.child = child;
    child.once('error', (error) => {
      if (this.child !== child) return;
      this.transition('error', error.message);
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.intentionalStop || !this.config.selectedWorktree) return;
      this.gateway.useIntegration();
      this.transition('error', `任务预览进程退出：${code ?? signal}`);
      this.scheduleRestart();
    });

    try {
      const taskUrl = `http://127.0.0.1:${MANAGED_TASK_PREVIEW_PORT}/`;
      await this.dependencies.waitForPreview(resolved.root, child, { baseUrl: taskUrl });
      this.gateway.useTask();
      const metadata = await this.dependencies.waitForPreview(resolved.root, child);
      await this.dependencies.checkSelectedPreview(this.config, resolved.root);
      if (this.child !== child || child.exitCode !== null || this.gateway.mode !== 'task')
        throw new Error('新预览在 API 和数据绑定检查期间失去运行身份；不能报告就绪');
      this.restartAttempts = 0;
      this.transition('running');
      this.dependencies.log(`当前任务预览已就绪：${CURRENT_TASK_PREVIEW_URL} (${metadata.branch})`);
      return this.status();
    } catch (error) {
      if (this.child === child) await this.stopOwnedChild();
      this.gateway.useIntegration();
      this.transition('error', error instanceof Error ? error.message : `${error}`);
      this.scheduleRestart();
      throw error;
    }
  }

  switch(worktree, taskArgs = [], retainedHandoff = null) {
    return this.enqueue(async () => {
      if (this.config.taskRegistryProtocol === 2)
        throw new Error('多任务环境必须使用 task:preview 的准确身份切换；旧 switch 不能接管预览');
      const resolved = this.dependencies.resolveTaskWorktree(worktree);
      if (retainedHandoff) {
        const expected = retainedHandoff;
        const child = this.child;
        const assertOwner = () => {
          if (
            expected.servicePid !== process.pid ||
            !child ||
            expected.childPid !== child.pid ||
            this.child !== child ||
            child.exitCode !== null ||
            this.phase !== 'running' ||
            this.gateway.mode !== 'task' ||
            this.currentWorktree !== expected.source ||
            this.config.selectedWorktree !== expected.source ||
            resolved.root === expected.source ||
            !taskArgsEqual(this.currentTaskArgs, this.config.taskArgs)
          )
            throw new Error('预览归属已变化，未停止任何任务');
        };
        assertOwner();
        await this.dependencies.checkSelectedPreview(this.config, expected.source);
        assertOwner();
        const proof = this.dependencies.retainedHandoffProof(resolved.root, expected.source, { freshRemote: true });
        for (const key of ['source', 'target', 'main', 'profileFingerprint', 'batchId'])
          if (proof[key] !== expected[key]) throw new Error('预览交接证明变化，保留现场');
        this.clearRestart();
        this.gateway.useIntegration();
        try {
          await this.stopOwnedChild();
          await this.dependencies.stopRetainedBackend(this.config, expected.source);
          const afterStop = this.dependencies.retainedHandoffProof(resolved.root, expected.source, {
            freshRemote: true,
          });
          for (const key of ['source', 'target', 'main', 'profileFingerprint', 'batchId'])
            if (afterStop[key] !== proof[key]) throw new Error('长期预览交接证明变化，禁止启动新任务');
          this.currentWorktree = null;
          this.currentTaskArgs = [];
        } catch (error) {
          this.transition('error', error.message);
          throw error;
        }
      }
      if (!retainedHandoff) assertPreviewSelection(this.status(), resolved.root);
      if (this.child && this.currentWorktree !== resolved.root) {
        throw new Error('当前预览进程归属另一 Worktree 或归属未知，请先明确交接');
      }
      this.clearRestart();
      this.saveSelection(resolved.root, taskArgs);
      return this.launchSelected();
    });
  }

  selectTask(request, retained = false, preparingDelivery = false) {
    return this.enqueue(async () => {
      assertPreviewOwner(request.expected, this.status());
      const root = path.dirname(path.dirname(this.config.launcherPath));
      const registry = this.dependencies.createTaskRegistry(root);
      const currentTask = registry.resolve({ id: request.task, worktree: request.worktree });
      if (currentTask.owner !== request.owner) throw new Error('任务请求身份不匹配');
      if (preparingDelivery) {
        if (
          !retained ||
          !currentTask.frozen ||
          currentTask.recordedHead !== request.candidate ||
          !['frozen', 'queued', 'validating', 'pr-pending'].includes(currentTask.stage)
        )
          throw new Error('只能为准确冻结候选准备交付运行交接');
        this.dependencies.proveTaskDeliveryFreeze(currentTask, request.candidate);
      } else if (
        retained &&
        (!['main-verified', 'handoff-verified'].includes(currentTask.stage) || currentTask.main?.local !== request.main)
      )
        throw new Error('当前任务尚未完成准确 main 验收；不切换保留载体');
      const task = retained
        ? {
            id: currentTask.id,
            worktree: this.dependencies.resolveRetainedPreview(this.config),
            branch: 'codex/preview-current',
          }
        : currentTask;
      if (
        this.config.handoffHold &&
        (!retained || this.config.handoffHold.task !== currentTask.id || this.config.handoffHold.main !== request.main)
      )
        throw new Error('另一次已发布预览交接尚未完成；不接管其归属');
      const leases = this.dependencies.createResourceLeases(registry.commonDir);
      return leases.run('preview-5175', task.id, async () => {
        const previous = this.config.selectedWorktree;
        if (preparingDelivery && previous !== currentTask.worktree) {
          // Source composition may restart a mounted backend even when its
          // frontend is not selected. Stop only this task's backend; preserve B.
          if (previous) {
            const selected = registry.list().find((item) => item.worktree === previous);
            if (!selected && previous !== task.worktree) throw new Error('当前预览归属未知，禁止准备交付');
          }
          await this.dependencies.assertPreviewConsumersReleased(currentTask.worktree);
          await this.dependencies.stopRetainedBackend(this.config, currentTask.worktree);
          return { status: this.status(), preserved: previous };
        }
        if (retained && previous && previous !== currentTask.worktree && previous !== task.worktree)
          throw new Error('5175 正在展示另一个任务；本任务交付不得停止或切换它');
        if (previous && previous !== task.worktree) {
          const selected = registry.list().find((item) => item.worktree === previous);
          if (selected) registry.resolve({ id: selected.id, worktree: previous });
          else if (this.dependencies.resolveRetainedPreview(this.config) !== previous)
            throw new Error('当前预览归属尚未接入任务登记；保留现场');
        }
        this.dependencies.log('固定 5176 上游采用受保护交接；切换期间 5175 将短暂显示重连。');
        return transitionSelectedPreview({
          expected: request.expected,
          target: task,
          forceTransition: retained,
          taskArgs: request.taskArgs ?? ['--mode', 'full'],
          control: {
            status: () => this.status(),
            prepare: () =>
              retained
                ? this.dependencies.prepareRetainedTarget(root, task.worktree, request.main, this.config)
                : this.dependencies.preparePreviewTarget(root, request, this.config),
            validate: (prepared) => this.dependencies.validatePreparedTarget(prepared, this.config),
            selection: () => {
              return {
                worktree: this.config.selectedWorktree,
                taskArgs: [...(this.config.taskArgs ?? [])],
                canRestore: this.phase === 'running',
                handoffHold: this.config.handoffHold ?? null,
              };
            },
            stop: async (selection) => {
              await this.dependencies.assertPreviewConsumersReleased(selection.worktree);
              this.clearRestart();
              this.gateway.useIntegration();
              await this.stopOwnedChild();
              if (selection.worktree) await this.dependencies.stopRetainedBackend(this.config, selection.worktree);
              this.currentWorktree = null;
              this.currentTaskArgs = [];
            },
            select: (worktree, args) => {
              this.config = { ...this.config, handoffHold: null };
              this.saveSelection(worktree, args);
            },
            restore: (previous) => {
              this.config = { ...this.config, handoffHold: previous.handoffHold };
              this.saveSelection(previous.worktree, previous.taskArgs);
            },
            launch: () => this.launchSelected(),
            cancelRestart: () => this.clearRestart(),
            error: (error) => this.transition('error', error.message),
          },
        });
      });
    });
  }

  pauseRetained(request) {
    return this.enqueue(async () => {
      assertPreviewOwner(request.expected, this.status());
      const root = path.dirname(path.dirname(this.config.launcherPath));
      const registry = this.dependencies.createTaskRegistry(root),
        task = registry.resolve({ id: request.task, worktree: request.worktree });
      if (
        task.owner !== request.owner ||
        !['main-verified', 'handoff-verified'].includes(task.stage) ||
        task.main?.local !== request.main
      )
        throw new Error('当前任务尚未完成准确 main 验收，不暂停保留载体');
      const selected = this.config.selectedWorktree;
      if (!selected || this.dependencies.resolveTaskWorktree(selected).branch !== 'codex/preview-current')
        throw new Error('当前显示其他任务；不得暂停它');
      this.dependencies.proveRetainedAdvance(root, selected, request.main);
      return this.dependencies.createResourceLeases(registry.commonDir).run('preview-5175', task.id, async () => {
        if (this.phase === 'running') await this.dependencies.checkSelectedPreview(this.config, selected);
        await this.dependencies.assertPreviewConsumersReleased(selected);
        this.clearRestart();
        this.config = { ...this.config, handoffHold: { task: task.id, main: request.main, worktree: selected } };
        this.saveSelection(selected, this.config.taskArgs ?? []);
        this.gateway.useIntegration();
        try {
          await this.stopOwnedChild();
          await this.dependencies.stopRetainedBackend(this.config, selected);
        } catch (error) {
          this.transition('error', error.message);
          throw error;
        }
        this.currentWorktree = null;
        this.currentTaskArgs = [];
        this.transition('preview-unavailable');
        return this.status();
      });
    });
  }

  stop(expected) {
    return this.enqueue(async () => {
      if (this.config.taskRegistryProtocol === 2) {
        const root = path.dirname(path.dirname(this.config.launcherPath));
        const registry = this.dependencies.createTaskRegistry(root);
        const task = registry.resolve({ worktree: expected?.worktree });
        return this.dependencies
          .createResourceLeases(registry.commonDir)
          .run('preview-5175', task.id, () => this.stopSelected(expected));
      }
      return this.stopSelected(expected);
    });
  }

  async stopSelected(expected) {
    const current = this.status();
    if (
      !expected ||
      ['worktree', 'childPid', 'servicePid', 'selectionRevision'].some((key) => expected[key] !== current[key])
    )
      throw new Error('停止请求归属已变化或缺失；保留当前预览');
    const worktree = this.config.selectedWorktree;
    this.dependencies.assertStopAllowed(worktree);
    if (this.config.taskRegistryProtocol === 2) await this.dependencies.assertPreviewConsumersReleased(worktree);
    this.clearRestart();
    this.gateway.useIntegration();
    try {
      await this.stopOwnedChild();
      if (worktree) {
        const result = this.dependencies.run(
          this.config.nodePath,
          [this.config.launcherPath, '--worktree', worktree, '--stop'],
          { cwd: worktree, allowFailure: true, stdio: 'inherit' },
        );
        if (result.status !== 0) throw new Error(`任务前端已停止，但后端停止失败：${worktree}`);
      }
    } catch (error) {
      this.transition('error', error.message);
      throw error;
    }
    this.saveSelection(null, []);
    this.currentWorktree = null;
    this.currentTaskArgs = [];
    this.transition('preview-unavailable');
    this.dependencies.log('当前任务预览已停止；5175 保留预览入口并显示不可用，预览数据继续保留。');
    return this.status();
  }

  async shutdown() {
    this.clearRestart();
    await this.stopOwnedChild();
    await this.gateway.stop();
  }
}

// Older published handoff launchers use these two strings as a stop receipt.
// This compatibility response never selects an integration upstream.
export function statusForProtocol(status, protocol) {
  if (
    protocol !== '2' &&
    status.phase === 'preview-unavailable' &&
    status.childPid === null &&
    status.worktree === null
  )
    return {
      ...status,
      phase: 'integration-fallback',
      mode: 'integration-fallback',
      environment: 'preview',
      legacyStopReceipt: true,
    };
  return status;
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function respond(response, statusCode, value) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(value)}\n`);
}

async function runService(paths) {
  ensureDirectory(paths.runtimeDirectory);
  if (existsSync(paths.socketFile)) {
    let serviceIsRunning = false;
    try {
      await requestJson({ paths, timeoutMs: 500 });
      serviceIsRunning = true;
    } catch {
      // A failed request leaves either a stale Socket or a service that is still starting.
    }
    if (serviceIsRunning) throw new Error('预览守护服务已经运行');
    if (existsSync(paths.socketFile)) {
      const stat = lstatSync(paths.socketFile);
      if (!stat.isSocket() || stat.isSymbolicLink()) throw new Error(`拒绝覆盖非 Socket 文件：${paths.socketFile}`);
      unlinkSync(paths.socketFile);
    }
  }

  const config = readConfig(paths);
  const gateway = new PreviewGateway({ integrationUrl: config.integrationUrl || INTEGRATION_PREVIEW_URL });
  await gateway.start();
  const supervisor = new PreviewSupervisor(paths, config, gateway);
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/status') {
        respond(response, 200, statusForProtocol(supervisor.status(), request.headers['x-zdm-preview-protocol']));
        return;
      }
      if (request.method === 'POST' && request.url === '/switch') {
        const body = await readRequestBody(request);
        if (!body.worktree) throw new Error('缺少 worktree');
        respond(
          response,
          200,
          await supervisor.switch(body.worktree, body.taskArgs ?? [], body.retainedHandoff ?? null),
        );
        return;
      }
      if (request.method === 'POST' && request.url === '/select-task') {
        const body = await readRequestBody(request);
        respond(response, 200, await supervisor.selectTask(body));
        return;
      }
      if (request.method === 'POST' && request.url === '/retain-task') {
        respond(response, 200, await supervisor.selectTask(await readRequestBody(request), true));
        return;
      }
      if (request.method === 'POST' && request.url === '/prepare-task-delivery') {
        respond(response, 200, await supervisor.selectTask(await readRequestBody(request), true, true));
        return;
      }
      if (request.method === 'POST' && request.url === '/pause-retained') {
        respond(response, 200, await supervisor.pauseRetained(await readRequestBody(request)));
        return;
      }
      if (request.method === 'POST' && request.url === '/stop') {
        const body = await readRequestBody(request);
        respond(
          response,
          200,
          statusForProtocol(await supervisor.stop(body.expected), request.headers['x-zdm-preview-protocol']),
        );
        return;
      }
      respond(response, 404, { error: 'not found' });
    } catch (error) {
      respond(response, 500, { error: error instanceof Error ? error.message : `${error}` });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(paths.socketFile, resolve);
  });
  chmodSync(paths.socketFile, 0o600);
  console.log(`任务预览守护服务已启动：PID ${process.pid}`);

  const shutdown = async () => {
    server.close();
    await supervisor.shutdown();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  void resumeServiceSelection(supervisor).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    supervisor.scheduleRestart();
  });
}

function tailFile(file, lines) {
  if (!existsSync(file)) return '';
  const size = statSync(file).size;
  const length = Math.min(size, 256 * 1024);
  const descriptor = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString('utf8').split(/\r?\n/).slice(-lines).join('\n');
  } finally {
    closeSync(descriptor);
  }
}

async function installService({ paths, worktree, taskArgs = [] }) {
  if (process.platform !== 'darwin') throw new Error('长期预览服务目前仅支持 macOS launchd');
  const selected = resolveTaskWorktree(worktree || process.cwd()).root;
  const launcherOverride = process.env.ZDM_TASK_PREVIEW_LAUNCHER_WORKTREE;
  const launcherPath = launcherOverride
    ? path.join(resolveTaskWorktree(launcherOverride).root, 'scripts', 'dev-task.mjs')
    : discoverIntegrationLauncher();
  if (!existsSync(launcherPath)) throw new Error('指定的任务启动器不存在');
  const launcherSource = readFileSync(launcherPath, 'utf8');
  if (!launcherSource.includes("from './task-data-environment.mjs'"))
    throw new Error('所选启动器未实现长期预览隔离数据契约，不自动降级安装；保留现有常驻服务');
  const workingDirectory = path.dirname(path.dirname(launcherPath));
  const protocol = parallelTaskMode(workingDirectory) ? 2 : 1;
  if (protocol === 2) {
    const task = createTaskRegistry(workingDirectory).resolve({ worktree: selected });
    preparePreviewTarget(
      workingDirectory,
      { task: task.id, owner: task.owner, worktree: selected, taskArgs: ['--mode', 'full'] },
      { launcherPath },
    );
  }
  ensureDirectory(paths.runtimeDirectory);
  ensureDirectory(path.dirname(paths.logFile));
  ensureDirectory(path.dirname(paths.launchAgentFile));
  if (path.resolve(sourceFile) !== path.resolve(paths.runtimeScript)) {
    // Installed services execute outside the checkout. Copy the reviewed native-only
    // module closure alongside the entry point, never resolve helpers from a task.
    for (const name of [
      'task-registry.mjs',
      'resource-lease.mjs',
      'preview-transition.mjs',
      'preview-target.mjs',
      'task-dependencies.mjs',
      'preview-policy.mjs',
      'task-data-environment.mjs',
    ]) {
      const moduleFile = path.join(path.dirname(sourceFile), name);
      if (!lstatSync(moduleFile).isFile() || lstatSync(moduleFile).isSymbolicLink())
        throw new Error('预览服务依赖不是安全文件：' + name);
      writeAtomic(path.join(paths.runtimeDirectory, name), readFileSync(moduleFile), 0o600);
    }
    writeAtomic(paths.runtimeScript, readFileSync(sourceFile), 0o700);
  }
  chmodSync(paths.runtimeScript, 0o700);

  const config = {
    version: 2,
    taskRegistryProtocol: protocol,
    nodePath: process.execPath,
    launcherPath,
    pathValue: normalizedPath(),
    integrationUrl: INTEGRATION_PREVIEW_URL,
    selectedWorktree: selected,
    taskArgs,
    installedAt: new Date().toISOString(),
  };
  writeConfig(paths, config);
  writeAtomic(
    paths.launchAgentFile,
    launchAgentPlist({
      nodePath: process.execPath,
      runtimeScript: paths.runtimeScript,
      workingDirectory,
      logFile: paths.logFile,
      pathValue: config.pathValue,
    }),
    0o600,
  );

  const target = launchctlTarget();
  launchctl(['bootout', target, paths.launchAgentFile], true);
  launchctl(['bootstrap', target, paths.launchAgentFile]);
  launchctl(['kickstart', `${target}/${SERVICE_LABEL}`], true);
  await waitForService(paths);
  if (protocol === 2) {
    const deadline = Date.now() + CONTROL_TIMEOUT_MS;
    for (;;) {
      const status = await requestJson({ paths, timeoutMs: 5000 });
      if (status.phase === 'running' && status.worktree === selected) break;
      if (status.phase === 'error' || Date.now() > deadline)
        throw new Error('已安装服务未恢复准确任务，保留数据及备份：' + (status.lastError ?? status.phase));
      await sleep(1000);
    }
  } else if (selected) {
    await requestJson({
      paths,
      method: 'POST',
      requestPath: '/switch',
      payload: { worktree: selected, taskArgs },
      timeoutMs: CONTROL_TIMEOUT_MS,
    });
  }
  console.log(`预览守护服务已安装：${paths.launchAgentFile}`);
  console.log(`5175 页面入口：${CURRENT_TASK_PREVIEW_URL}`);
  console.log(`当前模式：${selected ? '任务预览' : '保留预览待恢复'}`);
}

async function ensureService(paths) {
  try {
    return await requestJson({ paths, timeoutMs: 1_000 });
  } catch {
    if (!existsSync(paths.launchAgentFile)) {
      throw new Error(`预览服务尚未安装，请先运行：npm run dev:task:install -- --worktree "<任务Worktree>"`);
    }
    const target = launchctlTarget();
    launchctl(['kickstart', `${target}/${SERVICE_LABEL}`], true);
    return waitForService(paths);
  }
}

export async function readServiceStatus(paths, { request = requestJson, read = readJson, exists = existsSync } = {}) {
  try {
    const status = await request({ paths, timeoutMs: 1_000 });
    if (
      status?.type !== 'zdm-task-preview-service' ||
      typeof status.phase !== 'string' ||
      !(status.worktree === null || (typeof status.worktree === 'string' && path.isAbsolute(status.worktree)))
    ) {
      throw new Error('预览服务状态格式无效');
    }
    return status;
  } catch (error) {
    let config;
    try {
      config = read(paths.configFile);
    } catch {
      // Corrupt or absent ownership cannot authorize starting or switching a task.
    }
    const selectionKnown = Boolean(
      config?.launcherPath &&
      config?.nodePath &&
      (config.selectedWorktree === null ||
        (typeof config.selectedWorktree === 'string' && path.isAbsolute(config.selectedWorktree))),
    );
    return {
      type: 'zdm-task-preview-service',
      phase: 'offline',
      selectionKnown,
      installed: exists(paths.launchAgentFile),
      worktree: selectionKnown ? config.selectedWorktree : null,
      servicePid: null,
      childPid: null,
      mode: null,
      upstream: null,
      url: null,
      logFile: paths.logFile,
      lastError: error.message,
    };
  }
}

function assertPreviewSelection(status, target) {
  if (!(status?.worktree === null || (typeof status?.worktree === 'string' && path.isAbsolute(status.worktree)))) {
    throw new Error('预览任务归属未知，不自动启动或切换');
  }
  if (status.phase === 'offline' && !status.selectionKnown) {
    throw new Error('预览服务离线且任务归属未知，请先核对安装配置与任务归属，不自动启动或切换');
  }
  if (status.worktree && path.resolve(status.worktree) !== path.resolve(target)) {
    throw new Error(`预览仍归属 ${status.worktree}，请先交接，不自动切换到 ${target}`);
  }
}

function resolveLauncher(paths) {
  const config = readJson(paths.configFile);
  if (config?.launcherPath && existsSync(config.launcherPath)) return config.launcherPath;
  return discoverIntegrationLauncher();
}

function printStatus(status) {
  console.log(`服务状态：${status.phase}`);
  console.log(`入口模式：${status.mode ?? '-'}`);
  console.log(`实际上游：${status.upstream ?? '-'}`);
  console.log(`服务 PID：${status.servicePid ?? '-'}`);
  console.log(`预览 PID：${status.childPid ?? '-'}`);
  console.log(`当前任务：${status.worktree ?? '-'}`);
  console.log(`页面地址：${status.url ?? '-'}`);
  console.log(`日志文件：${status.logFile ?? '-'}`);
  if (status.lastError) console.log(`最近错误：${status.lastError}`);
}

function printHelp() {
  console.log(`Usage: node scripts/task-preview-service.mjs [command] [options]

Commands:
  install                 安装或更新 macOS 登录常驻服务，并选择当前任务
  switch                  把 5175 切换到当前任务（默认命令）
  status                  只读查看状态；离线时不启动守护服务
  stop                    停止当前任务前后端，5175 显示预览不可用，数据保留
  logs                    查看服务日志

Options:
  --worktree /path        指定普通 codex/* 任务 Worktree
  --lines 120             logs 返回的末尾行数
  --json                  status 输出机器可读 JSON
  --temporary             前台运行临时预览，不改变固定入口
  --port 5176             前台运行指定端口预览

其余任务参数会原样传递给现有 dev-task.mjs 启动器。`);
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const system = {
    servicePaths,
    readServiceStatus,
    ensureService,
    requestJson,
    resolveTaskWorktree,
    retainedHandoffProof,
    printStatus,
    log: console.log,
    ...dependencies,
  };
  const options = parseServiceArgs(args);
  if (options.command === 'help') {
    printHelp();
    return;
  }
  const paths = system.servicePaths();
  if (options.command === 'run') {
    await runService(paths);
    return;
  }
  if (options.command === 'install') {
    await installService({ paths, worktree: options.worktree, taskArgs: options.taskArgs });
    return;
  }
  if (options.command === 'logs') {
    process.stdout.write(`${tailFile(paths.logFile, options.lines)}\n`);
    return;
  }
  if (options.command === 'status') {
    const status = await system.readServiceStatus(paths);
    if (options.json) system.log(JSON.stringify(status));
    else system.printStatus(status);
    return;
  }
  if (options.command === 'stop') {
    const current = await system.readServiceStatus(paths);
    if (current.phase === 'offline')
      throw new Error('预览服务离线，无法证明任务资源已停止；未启动守护服务，请核对现场');
    const target = system.resolveTaskWorktree(options.worktree || process.cwd());
    if (typeof current.worktree !== 'string' || path.resolve(current.worktree) !== path.resolve(target.root))
      throw new Error('停止目标与当前预览归属不一致；保留现有服务，不停止其他任务');
    if (current.stopOwnershipProtocol !== 1) throw new Error('已安装服务不支持原子停止归属校验；保留现有预览');
    const expected = Object.fromEntries(
      ['worktree', 'childPid', 'servicePid', 'selectionRevision'].map((key) => [key, current[key]]),
    );
    system.printStatus(
      await system.requestJson({
        paths,
        method: 'POST',
        requestPath: '/stop',
        payload: { expected },
        timeoutMs: CONTROL_TIMEOUT_MS,
      }),
    );
    return;
  }

  const target = system.resolveTaskWorktree(options.worktree || process.cwd());
  if (shouldRunForeground(options.taskArgs)) {
    const result = run(process.execPath, [resolveLauncher(paths), '--worktree', target.root, ...options.taskArgs], {
      cwd: target.root,
      stdio: 'inherit',
    });
    process.exitCode = result.status ?? 1;
    return;
  }
  const current = await system.readServiceStatus(paths);
  let retainedHandoff;
  try {
    assertPreviewSelection(current, target.root);
  } catch (error) {
    if (
      current.phase !== 'running' ||
      current.mode !== 'task' ||
      !Number.isInteger(current.childPid) ||
      !Number.isInteger(current.servicePid)
    )
      throw error;
    let proof;
    try {
      proof = system.retainedHandoffProof(target.root, current.worktree);
    } catch {
      throw error;
    }
    if (current.retainedHandoffProtocol !== RETAINED_HANDOFF_PROTOCOL)
      throw new Error('常驻预览服务尚不支持安全自动交接，请先完成一次受控升级', { cause: error });
    retainedHandoff = { ...proof, servicePid: current.servicePid, childPid: current.childPid };
  }
  if (current.phase === 'offline') assertPreviewSelection(await system.ensureService(paths), target.root);
  const status = await system.requestJson({
    paths,
    method: 'POST',
    requestPath: '/switch',
    payload: { worktree: target.root, taskArgs: options.taskArgs, ...(retainedHandoff ? { retainedHandoff } : {}) },
    timeoutMs: CONTROL_TIMEOUT_MS,
  });
  system.printStatus(status);
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint === sourceFile) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
