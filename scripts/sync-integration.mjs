import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDeliveryLauncherFresh, runDeliveryLauncher } from './delivery-launcher.mjs';
import {
  integrationBackendSnapshot,
  integrationProofMatches,
  readIntegrationProof,
} from './integration-handoff-state.mjs';

import {
  branchKind,
  DEFAULT_INTEGRATION_BRANCH,
  integrationPromotionErrors,
  needsBackendReload,
  parseAheadBehind,
  parseWorktreePorcelain,
} from './git-workflow-core.mjs';

function capture(commandArgs, { cwd, allowFailure = false, command = 'git', trim = true } = {}) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8' });
  if (result.status === 0) return trim ? result.stdout.trim() : result.stdout;
  if (allowFailure) return '';
  throw new Error(result.stderr.trim() || `${command} ${commandArgs.join(' ')} failed`);
}

function run(gitArgs, cwd) {
  execFileSync('git', gitArgs, { cwd, stdio: 'inherit' });
}

function refExists(ref, cwd) {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd }).status === 0;
}

function aheadBehind(localRef, remoteRef, cwd) {
  if (!refExists(localRef, cwd) || !refExists(remoteRef, cwd)) return null;
  return parseAheadBehind(capture(['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`], { cwd }));
}

export function syncIntegration(requestedTask = '', { executeHandoff = execFileSync, launcher = null } = {}) {
  const root = capture(['rev-parse', '--show-toplevel']);
  const taskBranch = requestedTask || capture(['branch', '--show-current'], { cwd: root });
  if (branchKind(taskBranch) !== 'task') throw new Error(`只能同步 codex/* 任务分支，当前为：${taskBranch}`);

  run(['fetch', 'origin', '--prune'], root);
  if (launcher) assertDeliveryLauncherFresh(launcher, root);
  const taskLocalRef = `refs/heads/${taskBranch}`;
  const taskRemoteRef = `refs/remotes/origin/${taskBranch}`;
  const integrationLocalRef = `refs/heads/${DEFAULT_INTEGRATION_BRANCH}`;
  const integrationRemoteRef = `refs/remotes/origin/${DEFAULT_INTEGRATION_BRANCH}`;
  const worktrees = parseWorktreePorcelain(capture(['worktree', 'list', '--porcelain'], { cwd: root }));
  const taskWorktree = worktrees.find((worktree) => worktree.branch === taskBranch) ?? null;
  const integrationWorktree = worktrees.find((worktree) => worktree.branch === DEFAULT_INTEGRATION_BRANCH) ?? null;
  const integrationClean = integrationWorktree
    ? capture(['status', '--porcelain'], { cwd: integrationWorktree.path }) === ''
    : false;

  const errors = integrationPromotionErrors({
    taskBranch,
    taskRemoteExists: refExists(taskRemoteRef, root),
    taskAheadBehind: aheadBehind(taskLocalRef, taskRemoteRef, root),
    integrationRemoteExists: refExists(integrationRemoteRef, root),
    integrationAheadBehind: aheadBehind(integrationLocalRef, integrationRemoteRef, root),
    integrationWorktreeExists: Boolean(integrationWorktree),
    integrationWorktreeClean: integrationClean,
  });
  if (errors.length > 0) throw new Error(errors.map((error) => `- ${error}`).join('\n'));
  if (!taskWorktree) throw new Error(`未找到 ${taskBranch} 的任务 Worktree，不能执行完整交接`);

  const alreadyIntegrated =
    spawnSync('git', ['merge-base', '--is-ancestor', taskLocalRef, integrationLocalRef], { cwd: root }).status === 0;
  const integrationHeadBefore = capture(['rev-parse', integrationLocalRef], { cwd: root });
  if (!alreadyIntegrated) {
    try {
      run(['merge', '--no-ff', '--no-edit', taskBranch], integrationWorktree.path);
    } catch (error) {
      const mergeInProgress =
        spawnSync('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: integrationWorktree.path })
          .status === 0;
      if (mergeInProgress) run(['merge', '--abort'], integrationWorktree.path);
      throw new Error(
        `任务分支合入集成分支失败，集成 Worktree 已恢复。请停止并报告冲突，不得手工扩展到任务范围外文件：${error instanceof Error ? error.message : error}`,
        { cause: error },
      );
    }
  }

  run(['push', 'origin', DEFAULT_INTEGRATION_BRANCH], integrationWorktree.path);
  const finalState = aheadBehind(integrationLocalRef, integrationRemoteRef, root);
  if (finalState?.ahead !== 0 || finalState?.behind !== 0) throw new Error('集成分支推送后仍与远程不一致');
  const changedFiles = alreadyIntegrated
    ? []
    : capture(['diff', '--name-only', '-z', `${integrationHeadBefore}..${integrationLocalRef}`], {
        cwd: root,
        trim: false,
      })
        .split('\0')
        .filter(Boolean);
  const integrationHead = capture(['rev-parse', integrationLocalRef], { cwd: root });
  const taskHead = capture(['rev-parse', taskLocalRef], { cwd: root });
  const before = integrationBackendSnapshot(integrationWorktree.path);
  const recreate = needsBackendReload(changedFiles);
  const assertStable = (state, expectedContainer) => {
    if (
      state.sourceIdentity !== before.sourceIdentity ||
      state.configurationIdentity !== before.configurationIdentity ||
      state.containerIdentity !== expectedContainer ||
      capture(['rev-parse', 'HEAD'], { cwd: integrationWorktree.path }) !== integrationHead ||
      capture(['status', '--porcelain'], { cwd: integrationWorktree.path }) !== ''
    )
      throw new Error('集成运行输入或容器身份在交接期间变化，不能登记交接成功');
  };

  executeHandoff(
    process.execPath,
    [
      fileURLToPath(new URL('./dev-task.mjs', import.meta.url)),
      '--handoff',
      '--worktree',
      taskWorktree.path,
      ...(recreate ? ['--force-integration-backend'] : []),
    ],
    { cwd: integrationWorktree.path, stdio: 'inherit' },
  );

  const after = integrationBackendSnapshot(integrationWorktree.path);
  const receipt = readIntegrationProof(integrationWorktree.path);
  if (
    !integrationProofMatches(receipt, after) ||
    receipt.integrationHead !== integrationHead ||
    receipt.taskHead !== taskHead
  )
    throw new Error('集成运行环境不匹配交接成功证明，不能报告交付完成');
  assertStable(after, receipt.containerIdentity);
  if (!after.containerIdentity || (recreate && after.containerIdentity === before.containerIdentity))
    throw new Error('集成后端没有有效的新运行身份，不能登记交接成功');

  console.log(
    alreadyIntegrated
      ? `${taskBranch} 已存在于 ${DEFAULT_INTEGRATION_BRANCH}，本地与远程一致。`
      : `${taskBranch} 已合入并推送 ${DEFAULT_INTEGRATION_BRANCH}。`,
  );
  console.log(`完整集成后端：${receipt.action === 'recreated' ? 'recreated-and-verified' : 'verified-reuse'}`);
  console.log(`任务交接：completed（${taskWorktree.path}）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rawArgs = process.argv.slice(2);
    const taskIndex = rawArgs.indexOf('--task');
    const taskBranch = taskIndex >= 0 ? rawArgs[taskIndex + 1] : capture(['branch', '--show-current']);
    const headIndex = rawArgs.indexOf('--launcher-head');
    const kindIndex = rawArgs.indexOf('--launcher-kind');
    const publishedIndex = rawArgs.indexOf('--published-head');
    if (headIndex < 0 && kindIndex < 0 && publishedIndex < 0) {
      if (rawArgs.some((value, index) => index !== taskIndex && index !== taskIndex + 1))
        throw new Error('不支持的集成同步参数');
      runDeliveryLauncher({ action: 'sync', taskBranch, reviewedCandidate: null, plan: false });
    } else {
      const launcherHead = rawArgs[headIndex + 1];
      const kind = rawArgs[kindIndex + 1];
      const publishedHead = rawArgs[publishedIndex + 1];
      const keys = rawArgs.filter((_, index) => index % 2 === 0);
      if (
        rawArgs.length !== 8 ||
        new Set(keys).size !== 4 ||
        keys.some((key) => !['--task', '--launcher-head', '--launcher-kind', '--published-head'].includes(key)) ||
        headIndex < 0 ||
        kindIndex < 0 ||
        publishedIndex < 0 ||
        !/^[a-f0-9]{40}$/.test(launcherHead) ||
        !/^[a-f0-9]{40}$/.test(publishedHead) ||
        !['published', 'reviewed-candidate'].includes(kind)
      )
        throw new Error('启动器来源参数不完整');
      syncIntegration(taskBranch, {
        launcher: {
          action: 'sync',
          taskBranch,
          launcherHead,
          kind,
          publishedHead,
          launcherRoot: fileURLToPath(new URL('..', import.meta.url)),
        },
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
