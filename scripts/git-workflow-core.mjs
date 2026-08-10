export const DEFAULT_INTEGRATION_BRANCH = 'codex/integration-current';

export function branchKind(branch) {
  if (!branch) return 'detached';
  if (branch === 'main') return 'main';
  if (branch === DEFAULT_INTEGRATION_BRANCH) return 'integration';
  if (branch.startsWith('codex/')) return 'task';
  return 'other';
}

export function isManagedCommitBlocked({ branch, mergeInProgress }) {
  const kind = branchKind(branch);
  return ['main', 'integration'].includes(kind) && !mergeInProgress;
}

export function parseAheadBehind(value) {
  const [aheadText = '', behindText = ''] = value.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadText, 10);
  const behind = Number.parseInt(behindText, 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

export function parseWorktreePorcelain(value) {
  const worktrees = [];
  let current = null;

  for (const line of `${value}\n`.split(/\r?\n/)) {
    if (!line) {
      if (current) worktrees.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const fieldValue = rest.join(' ');
    if (key === 'worktree') current = { path: fieldValue, branch: null, head: null, detached: false };
    else if (!current) continue;
    else if (key === 'HEAD') current.head = fieldValue;
    else if (key === 'branch') current.branch = fieldValue.replace(/^refs\/heads\//, '');
    else if (key === 'detached') current.detached = true;
  }

  return worktrees;
}

export function integrationPromotionErrors({
  taskBranch,
  taskRemoteExists,
  taskAheadBehind,
  integrationRemoteExists,
  integrationAheadBehind,
  integrationWorktreeExists,
  integrationWorktreeClean,
}) {
  const errors = [];
  if (branchKind(taskBranch) !== 'task') errors.push(`不是可集成的任务分支：${taskBranch || '(detached)'}`);
  if (!taskRemoteExists) errors.push(`远程任务分支不存在：origin/${taskBranch}`);
  if (taskAheadBehind?.ahead !== 0 || taskAheadBehind?.behind !== 0) {
    errors.push(`任务分支本地与远程不一致：ahead ${taskAheadBehind?.ahead}, behind ${taskAheadBehind?.behind}`);
  }
  if (!integrationRemoteExists) errors.push(`远程集成分支不存在：origin/${DEFAULT_INTEGRATION_BRANCH}`);
  if (integrationAheadBehind?.ahead !== 0 || integrationAheadBehind?.behind !== 0) {
    errors.push(
      `集成分支本地与远程不一致：ahead ${integrationAheadBehind?.ahead}, behind ${integrationAheadBehind?.behind}`,
    );
  }
  if (!integrationWorktreeExists) errors.push(`未找到 ${DEFAULT_INTEGRATION_BRANCH} 对应的 Worktree`);
  if (!integrationWorktreeClean) errors.push('集成 Worktree 存在未提交改动');
  return errors;
}

export function needsBackendReload(files) {
  return files.some(
    (file) =>
      file === 'docker-compose.yml' || file === 'pom.xml' || file === 'package.json' || file.startsWith('backend/'),
  );
}
