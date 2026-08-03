import { execFileSync } from 'node:child_process';

import { branchKind, isManagedCommitBlocked } from './git-workflow-core.mjs';

function readGitValue(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const branch = readGitValue(['branch', '--show-current']);
const kind = branchKind(branch);
const mergeInProgress = Boolean(readGitValue(['rev-parse', '--verify', 'MERGE_HEAD']));
const acceptanceOverride = process.env.ZDM_ALLOW_ACCEPTANCE_INTEGRATION_COMMIT === '1';

if (isManagedCommitBlocked({ branch, mergeInProgress, acceptanceOverride })) {
  const guidance = {
    main: '请先在任务分支完成修改、验证和推送，再按授权流程合并 main。',
    integration: '请先在任务分支完成修改、验证和推送，再通过 git merge 汇入集成分支。',
    acceptance: '请从验收使用的准确提交创建修复分支，再将修复分支合入联合验收分支。',
  };
  console.error([`禁止直接在受管分支 ${branch} 提交普通改动。`, guidance[kind]].join('\n'));
  process.exit(1);
}
