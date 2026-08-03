import { execFileSync } from 'node:child_process';

export const isAcceptanceBranchCommitBlocked = ({ branch, mergeInProgress, integrationOverride }) =>
  branch.startsWith('codex/acceptance-') && !mergeInProgress && !integrationOverride;

const readGitValue = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const branch = readGitValue(['branch', '--show-current']);
const mergeInProgress = Boolean(readGitValue(['rev-parse', '--verify', 'MERGE_HEAD']));
const integrationOverride = process.env.ZDM_ALLOW_ACCEPTANCE_INTEGRATION_COMMIT === '1';

if (isAcceptanceBranchCommitBlocked({ branch, mergeInProgress, integrationOverride })) {
  console.error(
    [
      `禁止直接在联合验收分支 ${branch} 提交业务改动。`,
      '请先在所属任务分支完成修改、验证和推送，再通过 git merge 合入联合验收分支。',
      '仅联合冲突修复可显式使用 ZDM_ALLOW_ACCEPTANCE_INTEGRATION_COMMIT=1 放行。',
    ].join('\n'),
  );
  process.exit(1);
}
