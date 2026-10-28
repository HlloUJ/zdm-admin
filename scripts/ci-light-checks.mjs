import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { revisionIdentity, verifyScope } from './ci-quality-evidence.mjs';
import { earlyReadinessTasks } from './verification-policy.mjs';

const git = (...args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, 'Light-check source identity unavailable');
  return result.stdout.trim();
};
try {
  const root = process.cwd();
  const candidate = git('rev-parse', 'HEAD');
  if (process.env.GITHUB_SHA) assert.equal(candidate, process.env.GITHUB_SHA);
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH)) : {};
  const identity = revisionIdentity(event, candidate, git('rev-parse', 'HEAD^{tree}'));
  const scope = JSON.parse(
    readFileSync(path.join(process.env.CI_EVIDENCE_DIR ?? 'coverage/ci-evidence', 'scope.json')),
  );
  verifyScope(scope, identity);
  const files = scope.proof === 'verified' ? scope.files : git('ls-files', '-z').split('\0').filter(Boolean);
  for (const task of earlyReadinessTasks(root, files, process.env)) {
    console.log(`Early check: ${task.command} ${task.args.join(' ')}`);
    const result = spawnSync(task.command, task.args, { cwd: root, env: task.env, stdio: 'inherit' });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
