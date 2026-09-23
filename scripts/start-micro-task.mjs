import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_INTEGRATION_BRANCH, parseWorktreePorcelain } from './git-workflow-core.mjs';
import { assertBatchIdAvailable, readActiveBatch, registerBatch, validateActiveBatch } from './task-batch.mjs';

const MAIN_BRANCH = 'main';
const REMOTE = 'origin';
const TASK_BRANCH_PREFIX = 'codex/';
const sourceFile = fileURLToPath(import.meta.url);

export function parseMicroTaskArgs(args) {
  const options = { slug: '', kind: 'business', resume: false, independent: false, help: false };
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
    if (value === '--independent') {
      options.independent = true;
      continue;
    }
    if (value === '--slug' || value === '--kind') {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${value} 需要参数值`);
      options[value.slice(2)] = next;
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }
  if (!options.help && options.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)) {
    throw new Error('--slug 只能使用小写字母、数字和单个连字符，例如 status-copy');
  }
  if (!['business', 'infrastructure', 'maintenance'].includes(options.kind))
    throw new Error('--kind 只能是 business、infrastructure 或 maintenance');
  if (options.resume && !options.slug && !options.help) throw new Error('--resume 需要 --slug 指定真实任务 Worktree');
  if (options.resume && options.independent) throw new Error('--resume 与 --independent 不能同时使用');
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

export function gitOperationInProgress(cwd) {
  const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];
  const paths = captureGit(cwd, ['rev-parse', ...markers.flatMap((marker) => ['--git-path', marker])]).split('\n');
  if (paths.length !== markers.length) throw new Error('无法证明 Git 操作状态');
  return paths.some((file) => pathEntryExists(path.resolve(cwd, file)));
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
    const status = JSON.parse(result.stdout);
    if (
      status?.type !== 'zdm-task-preview-service' ||
      typeof status.phase !== 'string' ||
      !(status.worktree === null || (typeof status.worktree === 'string' && path.isAbsolute(status.worktree)))
    ) {
      throw new Error('状态缺少可核验的任务归属');
    }
    return status;
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
  console.log(`Usage: npm run task:start -- [--slug <task-slug>] [--kind <kind>] [--resume | --independent]

默认恢复同类型未交付批次的分支和 Worktree；没有活动批次时从最新 origin/main 创建并登记。
随后切换 5175 并校验完整累计任务差异所需的预览环境。task:micro 保持兼容。

Options:
  --slug status-copy   新批次标识；已有批次时新模块名不会创建新分支
  --kind business     批次类型：business（默认）、infrastructure、maintenance
  --resume             恢复 --slug 对应的真实任务 Worktree；不得替换另一个活动批次
  --independent        明确要求独立任务；存在活动批次时停止，不接管其资源
  --help               显示帮助`);
}

export function startTask(options, dependencies = {}) {
  const system = {
    cwd: process.cwd(),
    captureGit,
    readActiveBatch,
    validateActiveBatch,
    assertBatchIdAvailable,
    registerBatch,
    findManagedWorktrees,
    assertSafeDirectory,
    queryPreviewStatus,
    gitOperationInProgress,
    refsAreSynced,
    gitRefExists,
    pathEntryExists,
    run,
    log: console.log,
    ...dependencies,
  };
  const invocationRoot = system.captureGit(system.cwd, ['rev-parse', '--show-toplevel']);
  const active = system.readActiveBatch(invocationRoot);
  let batch = active ? system.validateActiveBatch(invocationRoot, active) : null;
  let branch;
  let targetWorktree;
  let mainWorktree;
  let integration;
  let commands;
  const restored = Boolean(batch);

  if (batch) {
    if (options.independent) {
      throw new Error(`当前已有未交付批次 ${batch.id}，本工具不接管；需先安排该批次交接或另行配置独立运行资源。`);
    }
    if (batch.kind !== options.kind) {
      throw new Error(
        `当前批次 ${batch.id} 类型为 ${batch.kind}，不能混入 ${options.kind}；恢复时请显式使用 --kind ${batch.kind}。`,
      );
    }
    branch = batch.branch;
    targetWorktree = batch.worktree;
    if (options.resume) {
      const { integration: managedIntegration } = system.findManagedWorktrees(invocationRoot);
      const requestedWorktree = taskWorktreeForSlug(path.dirname(managedIntegration.path), options.slug);
      if (
        taskBranchForSlug(options.slug) !== branch ||
        path.resolve(requestedWorktree) !== path.resolve(targetWorktree)
      )
        throw new Error(`--resume 指定的 Worktree 与活动批次 ${batch.id} 不同，不自动替换批次。`);
    }
    system.log(
      `恢复未交付批次：${batch.id}（${branch}）${options.slug && options.slug !== batch.id ? `；请求的 ${options.slug} 将在原批次继续，不新建分支` : ''}`,
    );
  } else {
    if (!options.slug) throw new Error('没有活动批次，新建任务需要 --slug <task-slug>');
    system.assertBatchIdAvailable(invocationRoot, options.slug);
    const managed = system.findManagedWorktrees(invocationRoot);
    mainWorktree = managed.main;
    integration = managed.integration;
    const taskParent = path.dirname(integration.path);
    system.assertSafeDirectory(taskParent, '任务 Worktree 父目录');
    branch = taskBranchForSlug(options.slug);
    targetWorktree = taskWorktreeForSlug(taskParent, options.slug);
    commands = microTaskGitCommands({ branch, targetWorktree });
    if (path.dirname(targetWorktree) !== taskParent) throw new Error(`任务 Worktree 越界：${targetWorktree}`);

    if (options.resume) {
      const existing = managed.worktrees.find(
        (worktree) => worktree.branch === branch && path.resolve(worktree.path) === path.resolve(targetWorktree),
      );
      if (!existing) throw new Error(`未找到可恢复的任务 Worktree：${branch}`);
      system.assertSafeDirectory(targetWorktree, '任务 Worktree');
    }
  }

  const previewService = path.join(invocationRoot, 'scripts', 'task-preview-service.mjs');
  const previewStatus = system.queryPreviewStatus(previewService, invocationRoot);
  if (
    previewStatus.phase === 'offline' &&
    (!previewStatus.selectionKnown ||
      !(restored || options.resume) ||
      !previewStatus.worktree ||
      path.resolve(previewStatus.worktree) !== path.resolve(targetWorktree))
  ) {
    throw new Error('预览服务离线，尚不能证明可安全新建或切换；请先核对并显式恢复原任务，不自动建立新批次');
  }
  const conflict = previewConflictError({ currentWorktree: previewStatus.worktree, targetWorktree });
  if (conflict) throw new Error(`${conflict}\n请先验收或交接当前任务，不自动覆盖其预览。`);

  if (!batch) {
    if (!options.resume) {
      system.run('git', commands.fetch, { cwd: mainWorktree.path, stdio: 'inherit' });
      const errors = newTaskSetupErrors({
        mainClean:
          system.captureGit(mainWorktree.path, ['status', '--porcelain']) === '' &&
          !system.gitOperationInProgress(mainWorktree.path),
        integrationClean:
          system.captureGit(integration.path, ['status', '--porcelain']) === '' &&
          !system.gitOperationInProgress(integration.path),
        integrationSynced: system.refsAreSynced(
          integration.path,
          DEFAULT_INTEGRATION_BRANCH,
          `${REMOTE}/${DEFAULT_INTEGRATION_BRANCH}`,
        ),
        localBranchExists: system.gitRefExists(mainWorktree.path, `refs/heads/${branch}`),
        remoteBranchExists: system.gitRefExists(mainWorktree.path, `refs/remotes/${REMOTE}/${branch}`),
        targetPathExists: system.pathEntryExists(targetWorktree),
      });
      if (errors.length > 0) throw new Error(errors.map((error) => `- ${error}`).join('\n'));
      system.run('git', commands.fastForwardMain, { cwd: mainWorktree.path, stdio: 'inherit' });
      system.run('git', commands.addWorktree, { cwd: mainWorktree.path, stdio: 'inherit' });
    }
    // Register before switching the preview so a failed startup remains recoverable in this batch.
    batch = system.registerBatch(targetWorktree, { id: options.slug, kind: options.kind });
  }

  const checkPreview = () =>
    system.run(
      process.execPath,
      [path.join(invocationRoot, 'scripts', 'dev-task.mjs'), '--check', '--worktree', targetWorktree],
      { cwd: invocationRoot, stdio: 'inherit' },
    );
  let previewReady = false;
  if (
    restored &&
    previewStatus.phase !== 'offline' &&
    previewStatus.worktree &&
    path.resolve(previewStatus.worktree) === path.resolve(targetWorktree)
  ) {
    try {
      checkPreview();
      previewReady = true;
      system.log('当前批次预览身份和 API 健康检查通过，复用现有运行环境。');
    } catch (error) {
      system.log(`当前批次预览检查未通过，将通过正常启动保护流程恢复：${error.message}`);
    }
  }
  if (!previewReady) {
    system.run(process.execPath, [previewService, 'switch', '--worktree', targetWorktree], {
      cwd: invocationRoot,
      stdio: 'inherit',
    });
    checkPreview();
  }
  system.log(`任务批次已就绪：${batch.id}（${branch}）`);
  system.log(`Worktree：${targetWorktree}`);
  system.log('验收入口：http://127.0.0.1:5175/');
  return { batch, restored };
}

export function main(args = process.argv.slice(2), dependencies = {}) {
  const options = parseMicroTaskArgs(args);
  if (options.help) {
    printHelp();
    return;
  }
  return startTask(options, dependencies);
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
