import assert from 'node:assert/strict';
import test from 'node:test';

import {
  branchKind,
  integrationPromotionErrors,
  isManagedCommitBlocked,
  needsBackendReload,
  parseAheadBehind,
  parseWorktreePorcelain,
} from './git-workflow-core.mjs';
import { normalizeDockerMountPath } from './backend-runtime.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';

test('classifies task, integration, and main branches', () => {
  assert.equal(branchKind('codex/fix-product-category'), 'task');
  assert.equal(branchKind('codex/integration-current'), 'integration');
  assert.equal(branchKind('main'), 'main');
});

test('blocks direct commits on managed branches while allowing merges', () => {
  for (const branch of ['main', 'codex/integration-current']) {
    assert.equal(isManagedCommitBlocked({ branch, mergeInProgress: false }), true);
    assert.equal(isManagedCommitBlocked({ branch, mergeInProgress: true }), false);
  }
  assert.equal(isManagedCommitBlocked({ branch: 'codex/fix-product-category', mergeInProgress: false }), false);
});

test('parses ahead and behind counts', () => {
  assert.deepEqual(parseAheadBehind('2\t3\n'), { ahead: 2, behind: 3 });
});

test('parses linked worktrees', () => {
  const worktrees = parseWorktreePorcelain(`worktree /repo
HEAD aaaa
branch refs/heads/main

worktree /repo-integration
HEAD bbbb
branch refs/heads/codex/integration-current

`);

  assert.deepEqual(worktrees, [
    { path: '/repo', branch: 'main', head: 'aaaa', detached: false },
    { path: '/repo-integration', branch: 'codex/integration-current', head: 'bbbb', detached: false },
  ]);
});

test('requires synced task and integration branches before promotion', () => {
  const errors = integrationPromotionErrors({
    taskBranch: 'codex/fix-product-category',
    taskRemoteExists: true,
    taskAheadBehind: { ahead: 1, behind: 0 },
    integrationRemoteExists: true,
    integrationAheadBehind: { ahead: 0, behind: 0 },
    integrationWorktreeExists: true,
    integrationWorktreeClean: true,
  });

  assert.deepEqual(errors, ['任务分支本地与远程不一致：ahead 1, behind 0']);
});

test('detects changes that require an integration backend reload', () => {
  assert.equal(needsBackendReload(['src/pages/product/category/index.vue']), false);
  assert.equal(needsBackendReload(['backend/src/main/java/example/Service.java']), true);
  assert.equal(needsBackendReload(['docker-compose.yml']), true);
  for (const file of [
    'backend/src/test/java/example/ServiceTest.java',
    'backend/src/test/resources/application.yml',
    'package.json',
    'package-lock.json',
    'scripts/backend-test-evidence.mjs',
  ])
    assert.equal(needsBackendReload([file]), false, file);
  for (const file of [
    'backend/pom.xml',
    'pom.xml',
    '.env.local',
    '.mvn/jvm.config',
    'backend/src/main/resources/db/migration/V9__test.sql',
    'scripts/sync-integration.mjs',
    'scripts/task-runtime-state.mjs',
    'docker-compose.task.yml',
  ])
    assert.equal(needsBackendReload([file]), true, file);
  const unknown = ['unknown-runtime.bin'];
  assert.equal(needsBackendReload(unknown), classifyChangedFiles(unknown).runtime);
  assert.equal(classifyChangedFiles(unknown).full, true, 'Unknown impact still requires full quality checks');
});

test('normalizes Docker Desktop bind mount paths before comparing worktrees', () => {
  const mountPath = '/host_mnt/Users/example/project';
  const expected = process.platform === 'darwin' ? '/Users/example/project' : mountPath;
  assert.equal(normalizeDockerMountPath(mountPath), expected);
});
