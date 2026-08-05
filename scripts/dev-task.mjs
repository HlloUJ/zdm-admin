import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { branchKind, parseWorktreePorcelain } from './git-workflow-core.mjs';

const DEFAULT_PORT_START = 5174;
const DEFAULT_PORT_END = 5199;
const DEFAULT_API_TARGET = 'http://127.0.0.1:8080';

export function parseTaskPreviewArgs(args) {
  const result = { port: null, apiTarget: DEFAULT_API_TARGET, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--help' || value === '-h') {
      result.help = true;
      continue;
    }
    if (value === '--port') {
      const port = Number(args[index + 1]);
      if (!Number.isInteger(port) || port < DEFAULT_PORT_START || port > DEFAULT_PORT_END) {
        throw new Error(`--port 必须是 ${DEFAULT_PORT_START} 至 ${DEFAULT_PORT_END} 之间的整数`);
      }
      result.port = port;
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
    throw new Error(`未知参数：${value}`);
  }
  return result;
}

export function taskPreviewErrors({ branch, backendReady }) {
  const errors = [];
  if (branchKind(branch) !== 'task') errors.push(`只能从 codex/* 任务分支启动预览，当前为：${branch || '(detached)'}`);
  if (!backendReady) errors.push('共享集成后端未运行，先启动 npm run integration:dev');
  return errors;
}

export function backendSensitiveFiles(files) {
  return files.filter(
    (file) =>
      file.startsWith('backend/') ||
      file === 'docker-compose.yml' ||
      file === 'compose.yaml' ||
      file.startsWith('scripts/restore-db') ||
      file.startsWith('scripts/backup-db'),
  );
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

export async function findAvailablePort({
  start = DEFAULT_PORT_START,
  end = DEFAULT_PORT_END,
  isOpen = isPortOpen,
} = {}) {
  for (let port = start; port <= end; port += 1) {
    if (!(await isOpen(port))) return port;
  }
  throw new Error(`${start}-${end} 没有可用的任务预览端口`);
}

export function selectSharedNodeModules({ root, worktrees }) {
  const currentLock = path.join(root, 'package-lock.json');
  if (!existsSync(currentLock)) return null;
  const lockContent = readFileSync(currentLock, 'utf8');
  for (const worktree of worktrees) {
    if (worktree.path === root) continue;
    const modules = path.join(worktree.path, 'node_modules');
    const lock = path.join(worktree.path, 'package-lock.json');
    if (existsSync(modules) && existsSync(lock) && readFileSync(lock, 'utf8') === lockContent) return modules;
  }
  return null;
}

function capture(args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status === 0) return result.stdout.trim();
  if (allowFailure) return '';
  throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
}

function refExists(ref, cwd) {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd }).status === 0;
}

function changedFiles(root) {
  const baseRef = refExists('refs/remotes/origin/main', root) ? 'origin/main' : 'main';
  const values = [
    capture(['diff', '--name-only', `${baseRef}...HEAD`], { cwd: root, allowFailure: true }),
    capture(['diff', '--name-only'], { cwd: root, allowFailure: true }),
    capture(['diff', '--cached', '--name-only'], { cwd: root, allowFailure: true }),
    capture(['ls-files', '--others', '--exclude-standard'], { cwd: root, allowFailure: true }),
  ];
  return [...new Set(values.flatMap((value) => value.split(/\r?\n/)).filter(Boolean))];
}

function ensureNodeModules(root, worktrees) {
  const localModules = path.join(root, 'node_modules');
  if (existsSync(localModules)) return;
  const sharedModules = selectSharedNodeModules({ root, worktrees });
  if (!sharedModules) {
    throw new Error('当前Worktree缺少可复用且版本一致的node_modules，请先安装依赖');
  }
  symlinkSync(sharedModules, localModules, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`复用依赖：${sharedModules}`);
}

function backendPort(apiTarget) {
  const url = new URL(apiTarget);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

export async function main(args = process.argv.slice(2)) {
  const options = parseTaskPreviewArgs(args);
  if (options.help) {
    console.log('Usage: npm run dev:task -- [--port 5174] [--api http://127.0.0.1:8080]');
    return;
  }

  const root = capture(['rev-parse', '--show-toplevel']);
  const branch = capture(['branch', '--show-current'], { cwd: root });
  const worktrees = parseWorktreePorcelain(capture(['worktree', 'list', '--porcelain'], { cwd: root }));
  const apiPort = backendPort(options.apiTarget);
  const backendReady = apiPort === null || (await isPortOpen(apiPort));
  const errors = taskPreviewErrors({ branch, backendReady });
  if (errors.length > 0) throw new Error(errors.map((error) => `- ${error}`).join('\n'));

  ensureNodeModules(root, worktrees);
  const port = options.port ?? (await findAvailablePort());
  if (options.port && (await isPortOpen(options.port))) throw new Error(`端口 ${options.port} 已被占用`);

  const backendChanges = backendSensitiveFiles(changedFiles(root));
  if (backendChanges.length > 0) {
    console.warn('注意：当前任务包含后端或运行配置改动；本预览只加载任务前端，共享后端仍来自集成Worktree。');
    for (const file of backendChanges) console.warn(`- ${file}`);
  }

  console.log(`任务预览：${branch}`);
  console.log(`本机地址：http://127.0.0.1:${port}/`);
  console.log(`API代理：${options.apiTarget}`);
  console.log('按 Ctrl+C 停止；未提交代码会通过热更新直接显示。');

  const child = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: root,
      env: {
        ...process.env,
        ZDM_TASK_PREVIEW: '1',
        ZDM_FRONTEND_PORT: String(port),
        ZDM_API_PROXY_TARGET: options.apiTarget,
      },
      stdio: 'inherit',
    },
  );
  child.once('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
