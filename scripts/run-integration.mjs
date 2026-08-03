import { spawn, spawnSync } from 'node:child_process';

import { DEFAULT_INTEGRATION_BRANCH, parseWorktreePorcelain } from './git-workflow-core.mjs';

const npmScript = process.argv[2];
if (!npmScript) {
  console.error('Usage: node scripts/run-integration.mjs <npm-script> [args...]');
  process.exit(1);
}

const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (rootResult.status !== 0) {
  console.error('当前目录不是 Git 仓库。');
  process.exit(1);
}
const root = rootResult.stdout.trim();
const worktreeResult = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
const integrationWorktree = parseWorktreePorcelain(worktreeResult.stdout).find(
  (worktree) => worktree.branch === DEFAULT_INTEGRATION_BRANCH,
);
if (!integrationWorktree) {
  console.error(`未找到 ${DEFAULT_INTEGRATION_BRANCH} 对应的固定 Worktree。`);
  process.exit(1);
}

console.log(`在完整集成环境运行：${integrationWorktree.path} (${DEFAULT_INTEGRATION_BRANCH})`);
const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', npmScript, ...process.argv.slice(3)], {
  cwd: integrationWorktree.path,
  env: process.env,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
