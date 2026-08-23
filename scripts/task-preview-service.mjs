import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { homedir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVICE_LABEL = 'com.zdm.admin.task-preview';
export const CURRENT_TASK_PREVIEW_URL = 'http://127.0.0.1:5175/';
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

export function previewCommand({ nodePath, launcherPath, worktree, taskArgs = [] }) {
  return {
    command: nodePath,
    args: [launcherPath, '--worktree', worktree, ...taskArgs],
  };
}

export function taskArgsEqual(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function requestJson({ paths, method = 'GET', requestPath = '/status', payload = null, timeoutMs = 5_000 }) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const request = http.request(
      {
        socketPath: paths.socketFile,
        path: requestPath,
        method,
        headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : undefined,
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

function requestPreviewMetadata(timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:5175${CONTROL_PATH}`, { timeout: timeoutMs }, (response) => {
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

async function waitForPreview(worktree, child, timeoutMs = CONTROL_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(`任务预览进程已退出：${child.exitCode ?? child.signalCode}`);
    }
    const metadata = await requestPreviewMetadata();
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

class PreviewSupervisor {
  constructor(paths, config) {
    this.paths = paths;
    this.config = config;
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
  }

  status() {
    return {
      type: 'zdm-task-preview-service',
      servicePid: process.pid,
      childPid: this.child?.pid ?? null,
      phase: this.phase,
      worktree: this.config.selectedWorktree ?? null,
      taskArgs: this.config.taskArgs ?? [],
      url: this.phase === 'running' ? CURRENT_TASK_PREVIEW_URL : null,
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
    this.config = {
      ...this.config,
      selectedWorktree: worktree,
      taskArgs,
      updatedAt: new Date().toISOString(),
    };
    writeConfig(this.paths, this.config);
  }

  clearRestart() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  scheduleRestart() {
    if (!this.config.selectedWorktree || this.restartTimer) return;
    this.restartAttempts += 1;
    const delay = restartDelay(this.restartAttempts);
    this.transition('retrying', this.lastError);
    console.error(`任务预览将在 ${Math.round(delay / 1_000)} 秒后重试：${this.lastError || '进程退出'}`);
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
    await stopChild(child);
    if (this.child === child) this.child = null;
    this.intentionalStop = false;
  }

  async launchSelected() {
    const worktree = this.config.selectedWorktree;
    if (!worktree) {
      this.transition('idle');
      return this.status();
    }
    const resolved = resolveTaskWorktree(worktree);
    const taskArgs = this.config.taskArgs ?? [];
    if (
      this.child &&
      this.currentWorktree === resolved.root &&
      taskArgsEqual(this.currentTaskArgs, taskArgs) &&
      this.phase === 'running'
    ) {
      return this.status();
    }
    await ensureDockerReady(this.config);
    if (this.child) await this.stopOwnedChild();

    const command = previewCommand({
      nodePath: this.config.nodePath,
      launcherPath: this.config.launcherPath,
      worktree: resolved.root,
      taskArgs,
    });
    this.currentWorktree = resolved.root;
    this.currentTaskArgs = [...taskArgs];
    this.transition('starting');
    console.log(`启动当前任务预览：${resolved.branch} (${resolved.root})`);
    const child = spawn(command.command, command.args, {
      cwd: resolved.root,
      env: { ...process.env, PATH: this.config.pathValue || process.env.PATH },
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
      this.transition('error', `任务预览进程退出：${code ?? signal}`);
      this.scheduleRestart();
    });

    try {
      const metadata = await waitForPreview(resolved.root, child);
      this.restartAttempts = 0;
      this.transition('running');
      console.log(`当前任务预览已就绪：${CURRENT_TASK_PREVIEW_URL} (${metadata.branch})`);
      return this.status();
    } catch (error) {
      if (this.child === child) await this.stopOwnedChild();
      this.transition('error', error instanceof Error ? error.message : `${error}`);
      this.scheduleRestart();
      throw error;
    }
  }

  switch(worktree, taskArgs = []) {
    return this.enqueue(async () => {
      const resolved = resolveTaskWorktree(worktree);
      this.clearRestart();
      this.saveSelection(resolved.root, taskArgs);
      return this.launchSelected();
    });
  }

  stop() {
    return this.enqueue(async () => {
      const worktree = this.config.selectedWorktree;
      this.clearRestart();
      this.saveSelection(null, []);
      await this.stopOwnedChild();
      this.currentWorktree = null;
      this.currentTaskArgs = [];
      this.transition('idle');
      if (worktree) {
        const result = run(this.config.nodePath, [this.config.launcherPath, '--worktree', worktree, '--stop'], {
          cwd: worktree,
          allowFailure: true,
          stdio: 'inherit',
        });
        if (result.status !== 0) throw new Error(`任务前端已停止，但后端停止失败：${worktree}`);
      }
      console.log('当前任务预览已停止；守护服务继续运行。');
      return this.status();
    });
  }

  async shutdown() {
    this.clearRestart();
    await this.stopOwnedChild();
  }
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

  const supervisor = new PreviewSupervisor(paths, readConfig(paths));
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/status') {
        respond(response, 200, supervisor.status());
        return;
      }
      if (request.method === 'POST' && request.url === '/switch') {
        const body = await readRequestBody(request);
        if (!body.worktree) throw new Error('缺少 worktree');
        respond(response, 200, await supervisor.switch(body.worktree, body.taskArgs ?? []));
        return;
      }
      if (request.method === 'POST' && request.url === '/stop') {
        respond(response, 200, await supervisor.stop());
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

  if (supervisor.config.selectedWorktree) {
    void supervisor.switch(supervisor.config.selectedWorktree, supervisor.config.taskArgs ?? []).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    });
  }
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
  const launcherPath = discoverIntegrationLauncher();
  const workingDirectory = path.dirname(path.dirname(launcherPath));
  ensureDirectory(paths.runtimeDirectory);
  ensureDirectory(path.dirname(paths.logFile));
  ensureDirectory(path.dirname(paths.launchAgentFile));
  if (path.resolve(sourceFile) !== path.resolve(paths.runtimeScript)) {
    writeAtomic(paths.runtimeScript, readFileSync(sourceFile), 0o700);
  }
  chmodSync(paths.runtimeScript, 0o700);

  const config = {
    version: 1,
    nodePath: process.execPath,
    launcherPath,
    pathValue: normalizedPath(),
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
  if (selected) {
    await requestJson({
      paths,
      method: 'POST',
      requestPath: '/switch',
      payload: { worktree: selected, taskArgs },
      timeoutMs: CONTROL_TIMEOUT_MS,
    });
  }
  console.log(`预览守护服务已安装：${paths.launchAgentFile}`);
  console.log(`当前任务预览：${selected ? CURRENT_TASK_PREVIEW_URL : '尚未选择任务'}`);
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

function resolveLauncher(paths) {
  const config = readJson(paths.configFile);
  if (config?.launcherPath && existsSync(config.launcherPath)) return config.launcherPath;
  return discoverIntegrationLauncher();
}

function printStatus(status) {
  console.log(`服务状态：${status.phase}`);
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
  status                  查看守护服务和当前任务状态
  stop                    停止当前任务前后端，守护服务保持空闲
  logs                    查看服务日志

Options:
  --worktree /path        指定普通 codex/* 任务 Worktree
  --lines 120             logs 返回的末尾行数
  --json                  status 输出机器可读 JSON
  --temporary             前台运行临时预览，不改变固定入口
  --port 5176             前台运行指定端口预览

其余任务参数会原样传递给现有 dev-task.mjs 启动器。`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseServiceArgs(args);
  if (options.command === 'help') {
    printHelp();
    return;
  }
  const paths = servicePaths();
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
    const status = await ensureService(paths);
    if (options.json) console.log(JSON.stringify(status));
    else printStatus(status);
    return;
  }
  if (options.command === 'stop') {
    await ensureService(paths);
    printStatus(await requestJson({ paths, method: 'POST', requestPath: '/stop', timeoutMs: CONTROL_TIMEOUT_MS }));
    return;
  }

  const target = resolveTaskWorktree(options.worktree || process.cwd());
  if (shouldRunForeground(options.taskArgs)) {
    const result = run(process.execPath, [resolveLauncher(paths), '--worktree', target.root, ...options.taskArgs], {
      cwd: target.root,
      stdio: 'inherit',
    });
    process.exitCode = result.status ?? 1;
    return;
  }
  await ensureService(paths);
  const status = await requestJson({
    paths,
    method: 'POST',
    requestPath: '/switch',
    payload: { worktree: target.root, taskArgs: options.taskArgs },
    timeoutMs: CONTROL_TIMEOUT_MS,
  });
  printStatus(status);
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint === sourceFile) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
