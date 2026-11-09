import assert from 'node:assert/strict';
import test from 'node:test';
import { localBackendPlan } from './backend-local.mjs';
test('local Maven commands use the exact task private repository and retain the original checks', () => {
  const a = localBackendPlan('/task A', 'quality', 'codex/a');
  assert.equal(a.cwd, '/task A/backend');
  assert.deepEqual(a.args, [
    '-Dmaven.repo.local=/task A/.task-runtime/maven-local/repository',
    '-B',
    'test',
    'checkstyle:check',
    'spotbugs:check',
    'jacoco:report',
  ]);
  assert.notEqual(a.args[0], localBackendPlan('/task B', 'quality', 'codex/b').args[0]);
  assert.throws(() => localBackendPlan('/task A', 'dev', 'codex/a'), /fixed integration worktree/);
  assert.throws(() => localBackendPlan('/task A', 'unknown', 'main'));
  assert.equal(localBackendPlan('/integration', 'dev', 'codex/integration-current').args[1], 'spring-boot:run');
});
