import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_INTEGRATION_BRANCH, parseWorktreePorcelain } from './git-workflow-core.mjs';

const MAIN_BRANCH = 'main';
const REMOTE = 'origin';
const TASK_BRANCH_PREFIX = 'codex/';
const sourceFile = fileURLToPath(import.meta.url);

export function parseMicroTaskArgs(args) {
  const options = { slug: '', resume: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--help' || value === '-h') {
      options.help = true;
      continue;
    }
    if (value === '--resume') {
      options.resume = true;
      continue;
    }
    if (value === '--slug') {
      options.slug = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }
  if (!options.help && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)) {
    throw new Error('--slug 只能使用小写字母、数字和单个连字符，例如 status-copy');
  }
  return options;
}

export function taskBranchForSlug(slug) {
  return `${TASK_BRANCH_PREFIX}${slug}`;
}

export function taskWorktreeForSlug(taskParent, slug) {
  return path.join(taskParent, slug);
}

export function microTaskGitCommands({ branch, targetWorktree }) {
  return {
    fetch: ['fetch', REMOTE, '--prune'],
    fastForwardMain: ['merge', '--ff-only', `${REMOTE}/${MAIN_BRANCH}`],
    addWorktree: ['worktree', 'add', '-b', branch, targetWorktree, `${REMOTE}/${MAIN_BRANCH}`],
  };
}

export function previewConflictError({ currentWorktree, targetWorktree }) {
  if (!currentWorktree) return null;
  const current = path.resolve(currentWorktree);
  if (current === path.resolve(targetWorktree)) return null;
  return `5175 当前仍由其他未交接任务使用：${currentWorktree}`;
}

export function newTaskSetupErrors({
  mainClean,
  integrationClean,
  integrationSynced,
  localBranchExists,
  remoteBranchExists,
  targetPathExists,
}) {
  const errors = [];
  if (!mainClean) errors.push('main Worktree 存在未提交改动或未完成的 Git 操作');
  if (!integrationClean) errors.push('集成 Worktree 存在未提交改动');
  if (!integrationSynced) errors.push('集成分支本地与远程不一致');
  if (localBranchExists) errors.push('本地任务分支已存在，如需继续请使用 --resume');
  if (remoteBranchExists) errors.push('远程任务分支已存在，不自动覆盖或重建');
  if (targetPathExists) errors.push('目标 Worktree 目录已存在，不自动复用来源不明的目录');
  return errors;
}

function run(command, args, { cwd, allowFailure = false, stdio = 'pipe' } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio });
  if (result.status === 0 || allowFailure) return result;
  throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
}

function captureGit(cwd, args) {
  return run('git', args, { cwd }).stdout.trim();
}

function gitRefExists(cwd, ref) {
  return run('git', ['show-ref', '--verify', '--quiet', ref], { cwd, allowFailure: true }).status === 0;
}

function pathEntryExists(value) {
  try {
    lstatSync(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function gitOperationInProgress(cwd) {
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'].some((name) =>
    pathEntryExists(captureGit(cwd, ['rev-parse', '--git-path', name])),
  );
}

function refsAreSynced(cwd, left, right) {
  return captureGit(cwd, ['rev-list', '--left-right', '--count', `${left}...${right}`]) === '0\t0';
}

function assertSafeDirectory(value, label) {
  const stat = lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label}不是安全的真实目录：${value}`);
}

function queryPreviewStatus(previewService, cwd) {
  const result = run(process.execPath, [previewService, 'status', '--json'], { cwd });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`无法解析任务预览状态：${result.stdout.trim()}`);
  }
}

function findManagedWorktrees(root) {
  const worktrees = parseWorktreePorcelain(captureGit(root, ['worktree', 'list', '--porcelain']));
  const main = worktrees.find((worktree) => worktree.branch === MAIN_BRANCH);
  const integration = worktrees.find((worktree) => worktree.branch === DEFAULT_INTEGRATION_BRANCH);
  if (!main) throw new Error(`未找到 ${MAIN_BRANCH} 固定 Worktree`);
  if (!integration) throw new Error(`未找到 ${DEFAULT_INTEGRATION_BRANCH} 固定 Worktree`);
  return { worktrees, main, integration };
}

function printHelp() {
  console.log(`Usage: npm run task:micro -- --slug <task-slug> [--resume]

从最新 origin/main 创建微改任务 Worktree，立即将 5175 切换到该任务并校验预览身份。

Options:
  --slug status-copy   任务标识，对应 codex/status-copy
  --resume             复用已存在的同名任务 Worktree
  --help               显示帮助`);
}

export function main(args = process.argv.slice(2)) {
  const options = parseMicroTaskArgs(args);
  if (options.help) {
    printHelp();
    return;
  }

  const invocationRoot = captureGit(process.cwd(), ['rev-parse', '--show-toplevel']);
  const { worktrees, main: mainWorktree, integration } = findManagedWorktrees(invocationRoot);
  const taskParent = path.dirname(integration.path);
  assertSafeDirectory(taskParent, '任务 Worktree 父目录');

  const branch = taskBranchForSlug(options.slug);
  const targetWorktree = taskWorktreeForSlug(taskParent, options.slug);
  const commands = microTaskGitCommands({ branch, targetWorktree });
  if (path.dirname(targetWorktree) !== taskParent) throw new Error(`任务 Worktree 越界：${targetWorktree}`);

  const existingWorktree = worktrees.find(
    (worktree) => worktree.branch === branch || path.resolve(worktree.path) === path.resolve(targetWorktree),
  );
  const previewService = path.join(invocationRoot, 'scripts', 'task-preview-service.mjs');
  const previewStatus = queryPreviewStatus(previewService, invocationRoot);
  const conflict = previewConflictError({
    currentWorktree: previewStatus.worktree,
    targetWorktree,
  });
  if (conflict) throw new Error(`${conflict}\n请先验收或交接当前任务，不自动覆盖其预览。`);

  if (options.resume) {
    if (
      !existingWorktree ||
      existingWorktree.branch !== branch ||
      path.resolve(existingWorktree.path) !== path.resolve(targetWorktree)
    ) {
      throw new Error(`未找到可恢复的任务 Worktree：${branch}`);
    }
  } else {
    run('git', commands.fetch, { cwd: mainWorktree.path, stdio: 'inherit' });
    const errors = newTaskSetupErrors({
      mainClean:
        captureGit(mainWorktree.path, ['status', '--porcelain']) === '' && !gitOperationInProgress(mainWorktree.path),
      integrationClean:
        captureGit(integration.path, ['status', '--porcelain']) === '' && !gitOperationInProgress(integration.path),
      integrationSynced: refsAreSynced(
        integration.path,
        DEFAULT_INTEGRATION_BRANCH,
        `${REMOTE}/${DEFAULT_INTEGRATION_BRANCH}`,
      ),
      localBranchExists: gitRefExists(mainWorktree.path, `refs/heads/${branch}`),
      remoteBranchExists: gitRefExists(mainWorktree.path, `refs/remotes/${REMOTE}/${branch}`),
      targetPathExists: pathEntryExists(targetWorktree),
    });
    if (errors.length > 0) throw new Error(errors.map((error) => `- ${error}`).join('\n'));
    run('git', commands.fastForwardMain, { cwd: mainWorktree.path, stdio: 'inherit' });
    run('git', commands.addWorktree, {
      cwd: mainWorktree.path,
      stdio: 'inherit',
    });
  }

  run(process.execPath, [previewService, 'switch', '--worktree', targetWorktree], {
    cwd: invocationRoot,
    stdio: 'inherit',
  });
  run(
    process.execPath,
    [path.join(invocationRoot, 'scripts', 'dev-task.mjs'), '--check', '--worktree', targetWorktree],
    {
      cwd: invocationRoot,
      stdio: 'inherit',
    },
  );

  console.log(`微改任务已就绪：${branch}`);
  console.log(`Worktree：${targetWorktree}`);
  console.log('验收入口：http://127.0.0.1:5175/');
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint === sourceFile) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
