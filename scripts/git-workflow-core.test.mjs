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

test('classifies task, integration, acceptance, and main branches', () => {
  assert.equal(branchKind('codex/fix-product-category'), 'task');
  assert.equal(branchKind('codex/integration-current'), 'integration');
  assert.equal(branchKind('codex/acceptance-2026-08-03'), 'acceptance');
  assert.equal(branchKind('main'), 'main');
});

test('blocks direct commits on managed branches while allowing merges', () => {
  for (const branch of ['main', 'codex/integration-current', 'codex/acceptance-2026-08-03']) {
    assert.equal(isManagedCommitBlocked({ branch, mergeInProgress: false, acceptanceOverride: false }), true);
    assert.equal(isManagedCommitBlocked({ branch, mergeInProgress: true, acceptanceOverride: false }), false);
  }
  assert.equal(
    isManagedCommitBlocked({
      branch: 'codex/acceptance-2026-08-03',
      mergeInProgress: false,
      acceptanceOverride: true,
    }),
    false,
  );
  assert.equal(
    isManagedCommitBlocked({ branch: 'codex/fix-product-category', mergeInProgress: false, acceptanceOverride: false }),
    false,
  );
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
});
