import { spawnSync } from 'node:child_process';

import {
  branchKind,
  DEFAULT_INTEGRATION_BRANCH,
  parseAheadBehind,
  parseWorktreePorcelain,
} from './git-workflow-core.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const requireSynced = args.includes('--require-synced');
const requireIntegrated = args.includes('--require-integrated');

function capture(gitArgs, { allowFailure = false } = {}) {
  const result = spawnSync('git', gitArgs, { encoding: 'utf8' });
  if (result.status === 0) return result.stdout.trim();
  if (allowFailure) return '';
  throw new Error(result.stderr.trim() || `git ${gitArgs.join(' ')} failed`);
}

function refExists(ref) {
  return spawnSync('git', ['show-ref', '--verify', '--quiet', ref]).status === 0;
}

function aheadBehind(localRef, remoteRef) {
  if (!refExists(localRef) || !refExists(remoteRef)) return null;
  return parseAheadBehind(capture(['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`]));
}

function isAncestor(ancestor, descendant) {
  return spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}

try {
  const root = capture(['rev-parse', '--show-toplevel']);
  process.chdir(root);
  const branch = capture(['branch', '--show-current'], { allowFailure: true });
  const head = capture(['rev-parse', 'HEAD']);
  const clean = capture(['status', '--porcelain']) === '';
  const taskRemoteRef = branch ? `refs/remotes/origin/${branch}` : '';
  const taskRemoteExists = Boolean(branch && refExists(taskRemoteRef));
  const taskAheadBehind = taskRemoteExists ? aheadBehind('HEAD', taskRemoteRef) : null;
  const integrationLocalRef = `refs/heads/${DEFAULT_INTEGRATION_BRANCH}`;
  const integrationRemoteRef = `refs/remotes/origin/${DEFAULT_INTEGRATION_BRANCH}`;
  const integrationLocalExists = refExists(integrationLocalRef);
  const integrationRemoteExists = refExists(integrationRemoteRef);
  const integrationAheadBehind = aheadBehind(integrationLocalRef, integrationRemoteRef);
  const worktrees = parseWorktreePorcelain(capture(['worktree', 'list', '--porcelain']));
  const integrationWorktree = worktrees.find((worktree) => worktree.branch === DEFAULT_INTEGRATION_BRANCH) ?? null;
  const integrationContainsTask =
    branchKind(branch) === 'task' && integrationLocalExists ? isAncestor('HEAD', integrationLocalRef) : null;

  const state = {
    root,
    branch,
    branchKind: branchKind(branch),
    head,
    clean,
    taskRemoteExists,
    taskAheadBehind,
    integration: {
      branch: DEFAULT_INTEGRATION_BRANCH,
      localExists: integrationLocalExists,
      remoteExists: integrationRemoteExists,
      aheadBehind: integrationAheadBehind,
      worktreePath: integrationWorktree?.path ?? null,
      containsCurrentTask: integrationContainsTask,
    },
  };

  if (json) console.log(JSON.stringify(state, null, 2));
  else {
    console.log(`当前分支：${branch || '(detached)'} @ ${head.slice(0, 7)}`);
    console.log(`工作区：${clean ? 'clean' : 'dirty'}`);
    console.log(
      `任务远程：${
        taskAheadBehind
          ? `ahead ${taskAheadBehind.ahead}, behind ${taskAheadBehind.behind}`
          : taskRemoteExists
            ? 'unknown'
            : 'missing'
      }`,
    );
    console.log(
      `集成分支：${
        integrationAheadBehind
          ? `ahead ${integrationAheadBehind.ahead}, behind ${integrationAheadBehind.behind}`
          : integrationLocalExists || integrationRemoteExists
            ? 'incomplete'
            : 'missing'
      }`,
    );
    console.log(`集成 Worktree：${integrationWorktree?.path ?? 'missing'}`);
    if (integrationContainsTask !== null) console.log(`已进入集成：${integrationContainsTask ? 'yes' : 'no'}`);
  }

  const failures = [];
  if ((requireSynced || requireIntegrated) && !clean) failures.push('当前工作区存在未提交改动');
  if ((requireSynced || requireIntegrated) && !taskRemoteExists) failures.push(`远程任务分支不存在：origin/${branch}`);
  if ((requireSynced || requireIntegrated) && (taskAheadBehind?.ahead !== 0 || taskAheadBehind?.behind !== 0)) {
    failures.push('当前任务分支本地与远程不一致');
  }
  if (requireIntegrated && !integrationWorktree) failures.push('固定集成 Worktree 不存在');
  if (requireIntegrated && (integrationAheadBehind?.ahead !== 0 || integrationAheadBehind?.behind !== 0)) {
    failures.push('集成分支本地与远程不一致');
  }
  if (requireIntegrated && integrationContainsTask !== true) failures.push('集成分支尚未包含当前任务提交');
  if (failures.length > 0) {
    console.error(failures.map((failure) => `- ${failure}`).join('\n'));
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
