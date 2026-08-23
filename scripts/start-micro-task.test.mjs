import assert from 'node:assert/strict';
import test from 'node:test';

import {
  newTaskSetupErrors,
  microTaskGitCommands,
  parseMicroTaskArgs,
  previewConflictError,
  taskBranchForSlug,
  taskWorktreeForSlug,
} from './start-micro-task.mjs';

test('parses a new or resumed micro task', () => {
  assert.deepEqual(parseMicroTaskArgs(['--slug', 'status-copy']), {
    slug: 'status-copy',
    resume: false,
    help: false,
  });
  assert.equal(parseMicroTaskArgs(['--slug', 'status-copy', '--resume']).resume, true);
  assert.equal(parseMicroTaskArgs(['--help']).help, true);
  assert.throws(() => parseMicroTaskArgs(['--slug', '../unsafe']), /只能使用小写字母/);
  assert.throws(() => parseMicroTaskArgs(['--slug', 'StatusCopy']), /只能使用小写字母/);
});

test('derives the managed branch and worktree from a safe slug', () => {
  assert.equal(taskBranchForSlug('status-copy'), 'codex/status-copy');
  assert.equal(taskWorktreeForSlug('/repo-worktrees', 'status-copy'), '/repo-worktrees/status-copy');
  assert.deepEqual(
    microTaskGitCommands({ branch: 'codex/status-copy', targetWorktree: '/repo-worktrees/status-copy' }),
    {
      fetch: ['fetch', 'origin', '--prune'],
      fastForwardMain: ['merge', '--ff-only', 'origin/main'],
      addWorktree: ['worktree', 'add', '-b', 'codex/status-copy', '/repo-worktrees/status-copy', 'origin/main'],
    },
  );
});

test('allows an idle or same-task preview without replacing another task', () => {
  const values = {
    targetWorktree: '/repo-worktrees/status-copy',
  };
  assert.equal(previewConflictError({ ...values, currentWorktree: null }), null);
  assert.equal(previewConflictError({ ...values, currentWorktree: values.targetWorktree }), null);
  assert.match(previewConflictError({ ...values, currentWorktree: '/repo-worktrees/another-task' }), /其他未交接任务/);
});

test('stops new-task setup when managed Git state is not safe', () => {
  assert.deepEqual(
    newTaskSetupErrors({
      mainClean: false,
      integrationClean: false,
      integrationSynced: false,
      localBranchExists: true,
      remoteBranchExists: true,
      targetPathExists: true,
    }),
    [
      'main Worktree 存在未提交改动或未完成的 Git 操作',
      '集成 Worktree 存在未提交改动',
      '集成分支本地与远程不一致',
      '本地任务分支已存在，如需继续请使用 --resume',
      '远程任务分支已存在，不自动覆盖或重建',
      '目标 Worktree 目录已存在，不自动复用来源不明的目录',
    ],
  );
});
