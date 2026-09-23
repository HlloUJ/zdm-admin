import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { branchKind, parseWorktreePorcelain } from './git-workflow-core.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';

export const DELIVERY_LAUNCHER_PROTOCOL = 1;
const SHA = /^[a-f0-9]{40}$/;
const launchers = {
  sync: 'scripts/sync-integration.mjs',
  handoff: 'scripts/dev-task.mjs',
};
const launcherHelpers = new Set([
  'scripts/git-workflow-core.mjs',
  'scripts/verification-impact.mjs',
  'scripts/task-dependencies.mjs',
]);

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `无法核验 Git：${args.join(' ')}`);
  return result.stdout.trim();
}

function clean(root) {
  if (git(root, ['status', '--porcelain'])) throw new Error(`启动器 Worktree 不干净：${root}`);
}

function trackedHead(root, ref) {
  try {
    return git(root, ['rev-parse', '--verify', ref]);
  } catch (error) {
    throw new Error(`缺少远程跟踪分支 ${ref}，不能证明发布来源；本命令未查询远程`, { cause: error });
  }
}

function assertProtocol(root) {
  for (const relative of [
    'scripts/delivery-launcher.mjs',
    ...Object.values(launchers),
    'scripts/ensure-backend.mjs',
    'scripts/integration-handoff-state.mjs',
  ]) {
    try {
      const stat = lstatSync(path.join(root, relative));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    } catch {
      throw new Error(
        `启动器缺少兼容协议 ${DELIVERY_LAUNCHER_PROTOCOL} 的入口：${relative}；仅已审查的基建首次升级可显式选择准确候选 SHA`,
      );
    }
  }
  const source = readFileSync(path.join(root, 'scripts/delivery-launcher.mjs'), 'utf8');
  if (!source.includes(`export const DELIVERY_LAUNCHER_PROTOCOL = ${DELIVERY_LAUNCHER_PROTOCOL};`))
    throw new Error('启动器协议不兼容，不回落到旧脚本');
}

export function parseDeliveryLauncherArgs(args) {
  const [action, ...rest] = args;
  if (!Object.hasOwn(launchers, action))
    throw new Error(
      'Usage: delivery-launcher <sync|handoff> --task <branch> [--reviewed-candidate <full-sha>] [--plan]',
    );
  const result = { action, taskBranch: '', reviewedCandidate: null, plan: false };
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--plan' && !result.plan) {
      result.plan = true;
      continue;
    }
    const key = flag === '--task' ? 'taskBranch' : flag === '--reviewed-candidate' ? 'reviewedCandidate' : null;
    if (!key || result[key] || !rest[index + 1] || rest[index + 1].startsWith('--'))
      throw new Error(`参数不明确：${flag}`);
    result[key] = rest[++index];
  }
  if (branchKind(result.taskBranch) !== 'task') throw new Error('需要准确的 codex/* 任务分支');
  if (result.reviewedCandidate && !SHA.test(result.reviewedCandidate))
    throw new Error('已审查候选必须使用准确的 40 位 SHA');
  return result;
}

// Selection is local and read-only. The existing sync fetch checks freshness before its first merge.
export function selectDeliveryLauncher(options, cwd = process.cwd()) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const worktrees = parseWorktreePorcelain(git(root, ['worktree', 'list', '--porcelain']));
  const main = worktrees.find((entry) => entry.branch === 'main');
  const task = worktrees.find((entry) => entry.branch === options.taskBranch);
  if (!main || !task) throw new Error('未找到准确的 main 或任务 Worktree，不猜测启动器目录');
  const publishedHead = trackedHead(root, 'refs/remotes/origin/main');
  if (git(main.path, ['rev-parse', 'HEAD']) !== publishedHead)
    throw new Error('本地 main 与 origin/main 跟踪引用不一致，请先完成主线核验；未实时查询远程');
  clean(main.path);
  const candidate = Boolean(options.reviewedCandidate);
  const taskHead = git(task.path, ['rev-parse', 'HEAD']);
  const taskBase = git(root, ['merge-base', publishedHead, taskHead]);
  const launcherChanges = git(root, ['diff', '--name-only', '-z', `${taskBase}..${taskHead}`])
    .split('\0')
    .filter(
      (file) =>
        launcherHelpers.has(file) ||
        ((file.startsWith('scripts/') || file === '.codex/zdm-project-workflow.yaml') &&
          classifyChangedFiles([file]).runtime),
    );
  if (!candidate && launcherChanges.length)
    throw new Error('本任务包含启动器变更，不能先运行旧实现完成自升级；完成审查和推送后使用准确 SHA 的候选入口');
  if (candidate && !launcherChanges.length)
    throw new Error('当前任务没有启动器升级，不使用候选入口；普通交付使用已发布启动器');
  const selected = candidate ? task : main;
  const head = git(selected.path, ['rev-parse', 'HEAD']);
  clean(selected.path);
  if (candidate) {
    if (head !== options.reviewedCandidate) throw new Error('候选 HEAD 已变化，不再是已审查的准确 SHA');
    if (trackedHead(root, `refs/remotes/origin/${options.taskBranch}`) !== head)
      throw new Error('已审查候选尚未与同名远程跟踪分支一致，不能用于正式交接');
    if (git(root, ['merge-base', publishedHead, head]) !== publishedHead)
      throw new Error('已审查候选未包含当前 origin/main，先完成候选更新和适用验证');
  }
  assertProtocol(selected.path);
  return {
    action: options.action,
    kind: candidate ? 'reviewed-candidate' : 'published',
    launcherRoot: selected.path,
    launcherHead: head,
    publishedHead,
    taskBranch: options.taskBranch,
    taskWorktree: task.path,
    launcherChanges,
    entrypoint: path.join(selected.path, launchers[options.action]),
    remoteEvidence: 'local-tracking-reference-only',
  };
}

export function assertDeliveryLauncherFresh(selection, cwd = process.cwd()) {
  const current = selectDeliveryLauncher(
    {
      action: selection.action,
      taskBranch: selection.taskBranch,
      reviewedCandidate: selection.kind === 'reviewed-candidate' ? selection.launcherHead : null,
    },
    cwd,
  );
  if (
    current.launcherHead !== selection.launcherHead ||
    current.publishedHead !== selection.publishedHead ||
    path.resolve(current.launcherRoot) !== path.resolve(selection.launcherRoot)
  )
    throw new Error('启动器或发布基线已变化，不能继续使用先前选择的实现');
  return current;
}

export function runDeliveryLauncher(options, { cwd = process.cwd(), execute = spawnSync } = {}) {
  const selection = selectDeliveryLauncher(options, cwd);
  if (options.plan) return selection;
  const args =
    selection.action === 'sync'
      ? [
          selection.entrypoint,
          '--task',
          selection.taskBranch,
          '--launcher-head',
          selection.launcherHead,
          '--launcher-kind',
          selection.kind,
          '--published-head',
          selection.publishedHead,
        ]
      : [selection.entrypoint, '--handoff', '--worktree', selection.taskWorktree];
  const result = execute(process.execPath, args, { cwd: selection.launcherRoot, stdio: 'inherit' });
  if (result.status !== 0)
    throw new Error(`选定启动器执行失败：${result.status ?? result.error?.message ?? 'unknown'}`);
  return selection;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const selection = runDeliveryLauncher(parseDeliveryLauncherArgs(process.argv.slice(2)));
    console.log(JSON.stringify(selection, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
