import { execFileSync, spawnSync } from 'node:child_process';

import {
  branchKind,
  DEFAULT_INTEGRATION_BRANCH,
  integrationPromotionErrors,
  needsBackendReload,
  parseAheadBehind,
  parseWorktreePorcelain,
} from './git-workflow-core.mjs';

const rawArgs = process.argv.slice(2);
const taskIndex = rawArgs.indexOf('--task');
const requestedTask = taskIndex >= 0 ? rawArgs[taskIndex + 1] : '';

function capture(commandArgs, { cwd, allowFailure = false, command = 'git' } = {}) {
  const result = spawnSync(command, commandArgs, { cwd, encoding: 'utf8' });
  if (result.status === 0) return result.stdout.trim();
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

try {
  const root = capture(['rev-parse', '--show-toplevel']);
  const taskBranch = requestedTask || capture(['branch', '--show-current'], { cwd: root });
  if (branchKind(taskBranch) !== 'task') throw new Error(`只能同步 codex/* 任务分支，当前为：${taskBranch}`);

  run(['fetch', 'origin', '--prune'], root);
  const taskLocalRef = `refs/heads/${taskBranch}`;
  const taskRemoteRef = `refs/remotes/origin/${taskBranch}`;
  const integrationLocalRef = `refs/heads/${DEFAULT_INTEGRATION_BRANCH}`;
  const integrationRemoteRef = `refs/remotes/origin/${DEFAULT_INTEGRATION_BRANCH}`;
  const worktrees = parseWorktreePorcelain(capture(['worktree', 'list', '--porcelain'], { cwd: root }));
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
        `任务分支合入集成分支失败，集成 Worktree 已恢复：${error instanceof Error ? error.message : error}`,
        { cause: error },
      );
    }
  }

  run(['push', 'origin', DEFAULT_INTEGRATION_BRANCH], integrationWorktree.path);
  const finalState = aheadBehind(integrationLocalRef, integrationRemoteRef, root);
  if (finalState?.ahead !== 0 || finalState?.behind !== 0) throw new Error('集成分支推送后仍与远程不一致');
  const changedFiles = alreadyIntegrated
    ? []
    : capture(['diff', '--name-only', `${integrationHeadBefore}..${integrationLocalRef}`], { cwd: root })
        .split(/\r?\n/)
        .filter(Boolean);
  let backendReload = 'not-needed';
  if (needsBackendReload(changedFiles)) {
    const mountedWorkspace = capture(
      [
        'inspect',
        '--format',
        '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}',
        'zdm-platform-backend',
      ],
      { cwd: integrationWorktree.path, allowFailure: true, command: 'docker' },
    );
    const running = capture(['inspect', '--format', '{{.State.Running}}', 'zdm-platform-backend'], {
      cwd: integrationWorktree.path,
      allowFailure: true,
      command: 'docker',
    });
    if (mountedWorkspace === integrationWorktree.path && running === 'true') {
      const reload = spawnSync('docker', ['compose', 'restart', 'backend'], {
        cwd: integrationWorktree.path,
        stdio: 'inherit',
      });
      backendReload = reload.status === 0 ? 'restarted' : 'failed';
    } else {
      backendReload = 'deferred-until-integration-dev';
    }
  }

  console.log(
    alreadyIntegrated
      ? `${taskBranch} 已存在于 ${DEFAULT_INTEGRATION_BRANCH}，本地与远程一致。`
      : `${taskBranch} 已合入并推送 ${DEFAULT_INTEGRATION_BRANCH}。`,
  );
  console.log(`完整集成后端：${backendReload}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
