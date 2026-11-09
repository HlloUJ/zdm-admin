import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withIntegrationResource } from './integration-resource.mjs';

export function localBackendPlan(root, action, branch) {
  const commands = {
    dev: ['spring-boot:run'],
    test: ['-B', 'test'],
    quality: ['-B', 'test', 'checkstyle:check', 'spotbugs:check', 'jacoco:report'],
  };
  assert.ok(Object.hasOwn(commands, action), 'backend-local <dev|test|quality>');
  if (action === 'dev')
    assert.equal(
      branch,
      'codex/integration-current',
      'Local shared runtime requires the fixed integration worktree; use the task full-stack preview for business tasks',
    );
  return {
    cwd: path.join(root, 'backend'),
    args: ['-Dmaven.repo.local=' + path.join(root, '.task-runtime/maven-local/repository'), ...commands[action]],
  };
}
export function main(root = process.cwd(), args = process.argv.slice(2)) {
  assert.equal(args.length, 1, 'backend-local <dev|test|quality>');
  const branch = execFileSync('git', ['-C', root, 'branch', '--show-current'], {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
  const plan = localBackendPlan(path.resolve(root), args[0], branch);
  const execute = () => {
    const result = spawnSync('mvn', plan.args, { cwd: plan.cwd, stdio: 'inherit' });
    assert.equal(result.status, 0, result.error?.message ?? 'Original Maven command failed');
  };
  return args[0] === 'dev' ? withIntegrationResource(root, 'local-integration-backend', execute) : execute();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
