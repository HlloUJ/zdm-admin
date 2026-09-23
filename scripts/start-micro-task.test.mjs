import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  main,
  gitOperationInProgress,
  newTaskSetupErrors,
  microTaskGitCommands,
  parseMicroTaskArgs,
  previewConflictError,
  taskBranchForSlug,
  taskWorktreeForSlug,
} from './start-micro-task.mjs';
import { readActiveBatch, recordBatchCheckpoint, registerBatch, upsertBatchModule } from './task-batch.mjs';

test('parses a new or resumed task and explicit batch boundaries', () => {
  assert.deepEqual(parseMicroTaskArgs(['--slug', 'status-copy']), {
    slug: 'status-copy',
    kind: 'business',
    resume: false,
    independent: false,
    help: false,
  });
  assert.equal(parseMicroTaskArgs(['--slug', 'status-copy', '--resume']).resume, true);
  assert.equal(parseMicroTaskArgs(['--help']).help, true);
  assert.equal(parseMicroTaskArgs([]).slug, '');
  assert.equal(parseMicroTaskArgs(['--kind', 'infrastructure']).kind, 'infrastructure');
  assert.equal(parseMicroTaskArgs(['--kind', 'maintenance']).kind, 'maintenance');
  assert.equal(parseMicroTaskArgs(['--slug', 'separate', '--independent']).independent, true);
  assert.throws(() => parseMicroTaskArgs(['--slug']), /需要参数值/);
  assert.throws(() => parseMicroTaskArgs(['--kind', 'unknown']), /--kind 只能/);
  assert.throws(() => parseMicroTaskArgs(['--resume']), /--resume 需要 --slug/);
  assert.throws(() => parseMicroTaskArgs(['--slug', 'one', '--resume', '--independent']), /不能同时使用/);
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

function fixture({ active = null, cwd = '/repo', preview = null, existing = [] } = {}) {
  const events = [];
  const output = [];
  const state = {
    active,
    // Both kinds of unpushed work must survive restoration without status/reset/checkout mutations.
    taskFiles: { 'src/first-module.vue': 'uncommitted work' },
    unpushedCommits: ['first-module-checkpoint'],
  };
  const dependencies = {
    cwd,
    captureGit(root, args) {
      events.push(['captureGit', root, args]);
      if (args.join(' ') === 'rev-parse --show-toplevel') return cwd;
      if (args.join(' ') === 'status --porcelain') return '';
      throw new Error(`Unexpected Git read: ${args.join(' ')}`);
    },
    assertBatchIdAvailable(root, id) {
      events.push(['available', root, id]);
      return id;
    },
    readActiveBatch(root) {
      events.push(['read', root]);
      return state.active;
    },
    validateActiveBatch(root, batch) {
      events.push(['validate', root, batch]);
      return batch;
    },
    registerBatch(root, { id, kind }) {
      events.push(['register', root, { id, kind }]);
      assert.equal(state.active, null, 'never replace an active batch');
      state.active = { id, kind, branch: taskBranchForSlug(id), worktree: root };
      return state.active;
    },
    findManagedWorktrees(root) {
      events.push(['managed', root]);
      return {
        main: { path: '/repo', branch: 'main' },
        integration: { path: '/repo-worktrees/integration', branch: 'codex/integration-current' },
        worktrees: existing,
      };
    },
    assertSafeDirectory(root) {
      events.push(['directory', root]);
    },
    queryPreviewStatus(service, root) {
      events.push(['previewStatus', service, root]);
      return { worktree: preview };
    },
    gitOperationInProgress: () => false,
    refsAreSynced: () => true,
    gitRefExists: () => false,
    pathEntryExists: () => false,
    run(command, args, options) {
      events.push(['run', command, args, options.cwd]);
    },
    log(message) {
      output.push(message);
    },
  };
  return { dependencies, events, output, state };
}

const businessBatch = {
  id: 'first-module',
  kind: 'business',
  branch: 'codex/first-module',
  worktree: '/repo-worktrees/first-module',
};

function commands(events) {
  return events.filter(([event]) => event === 'run').map(([, command, args, cwd]) => ({ command, args, cwd }));
}

test('new module restores the same unpushed batch from another worktree without fetching or Git writes', () => {
  const f = fixture({ active: businessBatch, cwd: '/repo-worktrees/another-task', preview: businessBatch.worktree });
  const before = structuredClone(f.state);
  const result = main(['--slug', 'second-module'], f.dependencies);
  assert.deepEqual(result, { batch: businessBatch, restored: true });
  assert.deepEqual(f.state, before);
  assert.deepEqual(
    commands(f.events).map(({ args }) => args),
    [['/repo-worktrees/another-task/scripts/dev-task.mjs', '--check', '--worktree', businessBatch.worktree]],
  );
  assert.match(f.output.join('\n'), /复用现有运行环境/);
  assert.equal(f.events.filter(([event]) => event === 'captureGit').length, 1);
  assert.equal(
    f.events.some(([event]) => ['register', 'managed'].includes(event)),
    false,
  );
  assert.match(f.output.join('\n'), /second-module 将在原批次继续，不新建分支/);
});

test('active batch resumes with no slug and requires explicit matching kind', () => {
  const f = fixture({ active: { ...businessBatch, kind: 'infrastructure' } });
  assert.throws(() => main([], f.dependencies), /显式使用 --kind infrastructure/);
  assert.equal(commands(f.events).length, 0);
  assert.equal(main(['--kind', 'infrastructure'], f.dependencies).restored, true);
});

test('explicit independent request cannot replace active batch or its preview', () => {
  const f = fixture({ active: businessBatch });
  assert.throws(
    () => main(['--slug', 'separate', '--independent'], f.dependencies),
    /先安排该批次交接或另行配置独立运行资源/,
  );
  assert.equal(commands(f.events).length, 0);
  assert.equal(
    f.events.some(([event]) => event === 'register'),
    false,
  );
});

test('without active batch creation fetches current main, creates the worktree and registers before preview', () => {
  const f = fixture();
  const result = main(['--slug', 'new-task', '--kind', 'maintenance'], f.dependencies);
  assert.equal(result.restored, false);
  assert.deepEqual(result.batch, {
    id: 'new-task',
    kind: 'maintenance',
    branch: 'codex/new-task',
    worktree: '/repo-worktrees/new-task',
  });
  assert.deepEqual(commands(f.events).slice(0, 3), [
    { command: 'git', args: ['fetch', 'origin', '--prune'], cwd: '/repo' },
    { command: 'git', args: ['merge', '--ff-only', 'origin/main'], cwd: '/repo' },
    {
      command: 'git',
      args: ['worktree', 'add', '-b', 'codex/new-task', '/repo-worktrees/new-task', 'origin/main'],
      cwd: '/repo',
    },
  ]);
  const registration = f.events.findIndex(([event]) => event === 'register');
  const creation = f.events.findIndex(
    ([event, command, args]) => event === 'run' && command === 'git' && args[0] === 'worktree',
  );
  const preview = f.events.findIndex(([event, , args]) => event === 'run' && args[1] === 'switch');
  assert.ok(creation < registration && registration < preview);
});

test('missing slug without a batch fails before network or preview operations', () => {
  const f = fixture();
  assert.throws(() => main([], f.dependencies), /新建任务需要 --slug/);
  assert.equal(commands(f.events).length, 0);
});

test('corrupt or invalid active state fails closed without creating or switching anything', () => {
  for (const method of ['readActiveBatch', 'validateActiveBatch']) {
    const f = fixture({ active: businessBatch });
    f.dependencies[method] = () => {
      throw new Error('invalid active batch fixture');
    };
    assert.throws(() => main(['--slug', 'next'], f.dependencies), /invalid active batch fixture/);
    assert.equal(commands(f.events).length, 0);
    assert.equal(
      f.events.some(([event]) => event === 'register'),
      false,
    );
  }
});

test('legacy resume registers only the exact real worktree when no active batch exists', () => {
  const f = fixture({ existing: [{ path: businessBatch.worktree, branch: businessBatch.branch }] });
  const result = main(['--slug', businessBatch.id, '--resume'], f.dependencies);
  assert.equal(result.batch.worktree, businessBatch.worktree);
  assert.equal(
    commands(f.events).some(({ command }) => command === 'git'),
    false,
  );
  assert.ok(f.events.some(([event, root]) => event === 'directory' && root === businessBatch.worktree));
  assert.ok(f.events.some(([event, root]) => event === 'register' && root === businessBatch.worktree));
  for (const existing of [
    [],
    [{ path: '/repo-worktrees/different', branch: businessBatch.branch }],
    [{ path: businessBatch.worktree, branch: 'codex/wrong' }],
  ]) {
    const bad = fixture({ existing });
    assert.throws(() => main(['--slug', businessBatch.id, '--resume'], bad.dependencies), /未找到可恢复/);
    assert.equal(commands(bad.events).length, 0);
    assert.equal(
      bad.events.some(([event]) => event === 'register'),
      false,
    );
  }
});

test('legacy resume with active batch accepts exactly that worktree and rejects a different slug or path', () => {
  const f = fixture({ active: businessBatch });
  assert.equal(main(['--slug', businessBatch.id, '--resume'], f.dependencies).restored, true);
  for (const [batch, slug] of [
    [businessBatch, 'other'],
    [{ ...businessBatch, worktree: '/other/first-module' }, businessBatch.id],
  ]) {
    const bad = fixture({ active: batch });
    assert.throws(() => main(['--slug', slug, '--resume'], bad.dependencies), /与活动批次 .* 不同/);
    assert.equal(commands(bad.events).length, 0);
  }
});

test('another preview owner blocks both active recovery and new batch creation', () => {
  for (const active of [null, businessBatch]) {
    const f = fixture({ active, preview: '/repo-worktrees/other-live-task' });
    assert.throws(() => main(['--slug', 'next'], f.dependencies), /其他未交接任务/);
    assert.equal(commands(f.events).length, 0);
    assert.equal(
      f.events.some(([event]) => event === 'register'),
      false,
    );
  }
});

test('registration failure never switches preview and a failed preview keeps the registered batch recoverable', () => {
  const registrationFailure = fixture();
  registrationFailure.dependencies.registerBatch = () => {
    throw new Error('registry changed');
  };
  assert.throws(() => main(['--slug', 'next'], registrationFailure.dependencies), /registry changed/);
  assert.equal(
    commands(registrationFailure.events).some(({ command }) => command !== 'git'),
    false,
  );
  const previewFailure = fixture();
  previewFailure.dependencies.run = (command) => {
    if (command !== 'git') throw new Error('preview unavailable');
  };
  assert.throws(() => main(['--slug', 'next'], previewFailure.dependencies), /preview unavailable/);
  assert.equal(previewFailure.state.active.id, 'next');
});

test('same-batch unhealthy preview uses the protected switch path once, then rechecks', () => {
  const f = fixture({ active: businessBatch, preview: businessBatch.worktree });
  const run = f.dependencies.run;
  let checks = 0;
  f.dependencies.run = (command, args, options) => {
    run(command, args, options);
    if (args[1] === '--check' && ++checks === 1) throw new Error('API health unavailable');
  };
  assert.equal(main(['--slug', 'next'], f.dependencies).restored, true);
  assert.deepEqual(
    commands(f.events).map(({ args }) => args.slice(1)),
    [
      ['--check', '--worktree', businessBatch.worktree],
      ['switch', '--worktree', businessBatch.worktree],
      ['--check', '--worktree', businessBatch.worktree],
    ],
  );
  assert.match(f.output.join('\n'), /正常启动保护流程恢复：API health unavailable/);
});

test('offline preview cannot cause a new batch or an unknown-owner switch', () => {
  for (const active of [null, businessBatch]) {
    for (const status of [
      { phase: 'offline', selectionKnown: false, worktree: null },
      { phase: 'offline', selectionKnown: true, worktree: null },
      { phase: 'offline', selectionKnown: true, worktree: '/repo/other-task' },
    ]) {
      const f = fixture({ active });
      f.dependencies.queryPreviewStatus = () => status;
      assert.throws(() => main(['--slug', 'next'], f.dependencies), /预览服务离线/);
      assert.deepEqual(commands(f.events), []);
      assert.equal(
        f.events.some(([event]) => event === 'register'),
        false,
      );
    }
  }
});

test('registered same-worktree offline preview explicitly restores then checks without Git changes', () => {
  const f = fixture({ active: businessBatch });
  f.dependencies.queryPreviewStatus = () => ({
    phase: 'offline',
    selectionKnown: true,
    worktree: businessBatch.worktree,
  });
  assert.equal(main(['--slug', 'next'], f.dependencies).restored, true);
  assert.deepEqual(
    commands(f.events).map(({ args }) => args.slice(1)),
    [
      ['switch', '--worktree', businessBatch.worktree],
      ['--check', '--worktree', businessBatch.worktree],
    ],
  );
  assert.equal(
    f.events.some(([event]) => event === 'register'),
    false,
  );
});

function realBatchFixture(t, { registered = true } = {}) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'zdm-start-batch-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const anchor = path.join(directory, 'repo');
  const task = path.join(directory, 'module-a');
  const other = path.join(directory, 'other-task');
  mkdirSync(anchor);
  const git = (root, ...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git(anchor, 'init', '--initial-branch=main');
  git(anchor, 'config', 'user.name', 'Start batch fixture');
  git(anchor, 'config', 'user.email', 'start-batch@example.invalid');
  git(anchor, 'config', 'core.hooksPath', '/dev/null');
  git(anchor, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(anchor, 'baseline.txt'), 'main baseline\n');
  git(anchor, 'add', '.');
  git(anchor, 'commit', '-m', 'baseline');
  git(anchor, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(anchor, 'worktree', 'add', '-b', 'codex/module-a', task, 'main');
  git(anchor, 'worktree', 'add', '-b', 'codex/other-task', other, 'main');
  if (registered) {
    registerBatch(task, { id: 'module-a' });
    upsertBatchModule(task, { id: 'module-a', title: 'Module A' });
  }
  writeFileSync(path.join(task, 'module-a.txt'), 'local commit content\n');
  git(task, 'add', 'module-a.txt');
  git(task, 'commit', '-m', 'module A local checkpoint');
  const checkpoint = git(task, 'rev-parse', 'HEAD');
  if (registered)
    recordBatchCheckpoint(task, {
      moduleId: 'module-a',
      commit: checkpoint,
      verification: 'Fixture note; no CI evidence claimed',
    });
  writeFileSync(path.join(task, 'module-a.txt'), 'local commit content\nuncommitted continuation\n');
  writeFileSync(path.join(task, 'baseline.txt'), 'staged continuation\n');
  git(task, 'add', 'baseline.txt');
  writeFileSync(path.join(task, 'untracked.txt'), 'untracked module A continuation\n');
  const recordPath = path.join(anchor, '.git', 'task-batches', 'active.json');
  const snapshot = () => ({
    head: git(task, 'rev-parse', 'HEAD'),
    refs: git(anchor, 'show-ref'),
    worktrees: git(anchor, 'worktree', 'list', '--porcelain'),
    status: git(task, 'status', '--porcelain=v1', '--untracked-files=all'),
    unstaged: git(task, 'diff', '--binary'),
    staged: git(task, 'diff', '--cached', '--binary'),
    untracked: readFileSync(path.join(task, 'untracked.txt'), 'utf8'),
    moduleCode: readFileSync(path.join(task, 'module-a.txt'), 'utf8'),
    otherHead: git(other, 'rev-parse', 'HEAD'),
    otherCode: readFileSync(path.join(other, 'baseline.txt'), 'utf8'),
    batch: readFileSync(recordPath, 'utf8'),
  });
  return { anchor, task, other, git, checkpoint, recordPath, snapshot };
}

test('real registered batch resumes across worktrees and preserves an unpushed commit, staged, unstaged and untracked work', (t) => {
  const f = realBatchFixture(t);
  assert.equal(f.git(f.task, 'rev-list', '--count', 'origin/main..HEAD'), '1');
  assert.equal(f.git(f.anchor, 'remote'), '', 'fixture has no network remote');
  const before = f.snapshot();
  const calls = [];
  const output = [];
  const result = main(['--slug', 'module-b'], {
    cwd: f.other,
    queryPreviewStatus: () => ({ worktree: f.task }),
    run(command, args) {
      assert.equal(command, process.execPath, 'restoring a real batch must never execute Git writes or fetch');
      calls.push(args);
    },
    log: (message) => output.push(message),
  });
  assert.equal(result.restored, true);
  assert.equal(result.batch.worktree, f.task);
  assert.equal(result.batch.branch, 'codex/module-a');
  assert.equal(result.batch.recordedHead, f.checkpoint);
  assert.equal(result.batch.modules[0].checkpoints[0].commit, f.checkpoint);
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(readActiveBatch(f.other), result.batch);
  assert.deepEqual(calls, [[path.join(f.other, 'scripts/dev-task.mjs'), '--check', '--worktree', f.task]]);
  assert.match(output.join('\n'), /module-b 将在原批次继续，不新建分支/);
});

test('real corrupt or stale batch state blocks the starter before any preview or Git mutation', (t) => {
  const f = realBatchFixture(t);
  const original = readFileSync(f.recordPath, 'utf8');
  const dependencies = {
    cwd: f.other,
    queryPreviewStatus: () => assert.fail('invalid record must fail before preview lookup'),
    run: () => assert.fail('invalid record must never execute commands'),
    log: () => {},
  };
  writeFileSync(f.recordPath, '{broken');
  assert.throws(() => main(['--slug', 'module-b'], dependencies), /Invalid batch record/);
  writeFileSync(f.recordPath, original);
  f.git(f.task, 'checkout', '-b', 'codex/unexpected-branch');
  assert.throws(() => main(['--slug', 'module-b'], dependencies), /changed branch/);
  assert.equal(readFileSync(f.recordPath, 'utf8'), original);
  assert.equal(f.git(f.task, 'rev-parse', 'HEAD'), f.checkpoint);
});

test('new-batch ID availability is checked before preview lookup, fetch, or worktree creation', () => {
  const f = fixture();
  f.dependencies.assertBatchIdAvailable = () => {
    throw new Error('batch ID unavailable');
  };
  assert.throws(() => main(['--slug', 'archived'], f.dependencies), /batch ID unavailable/);
  assert.equal(
    f.events.some(([event]) => ['managed', 'previewStatus', 'run', 'register'].includes(event)),
    false,
  );
  const active = fixture({ active: businessBatch });
  active.dependencies.assertBatchIdAvailable = () => assert.fail('active recovery must retain its existing batch ID');
  assert.equal(main(['--slug', 'archived-module'], active.dependencies).restored, true);
});

test('real batch ID validation rejects oversized or archived IDs before starter side effects', (t) => {
  const f = realBatchFixture(t, { registered: false });
  const archive = path.join(f.anchor, '.git', 'task-batches', 'archive');
  mkdirSync(archive, { recursive: true });
  // Occupied archive paths are never reused, including incomplete records requiring manual inspection.
  writeFileSync(path.join(archive, 'archived.json'), '{}\n');
  const beforeRefs = f.git(f.anchor, 'show-ref');
  const beforeWorktrees = f.git(f.anchor, 'worktree', 'list', '--porcelain');
  const dependencies = {
    cwd: f.other,
    findManagedWorktrees: () => assert.fail('ID validation must precede new-worktree preparation'),
    queryPreviewStatus: () => assert.fail('invalid ID must fail before preview lookup'),
    run: () => assert.fail('invalid ID must never execute network or preview commands'),
    log: () => {},
  };
  assert.throws(() => main(['--slug', 'a'.repeat(65)], dependencies), /Invalid batch id/);
  assert.throws(() => main(['--slug', 'archived'], dependencies), /already archived/);
  assert.equal(readActiveBatch(f.anchor), null);
  assert.equal(f.git(f.anchor, 'show-ref'), beforeRefs);
  assert.equal(f.git(f.anchor, 'worktree', 'list', '--porcelain'), beforeWorktrees);
  assert.equal(readFileSync(path.join(archive, 'archived.json'), 'utf8'), '{}\n');
});

test('batched Git marker query still detects every in-progress operation relative to its worktree', (t) => {
  const f = realBatchFixture(t, { registered: false });
  assert.equal(gitOperationInProgress(f.anchor), false);
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    const file = path.resolve(f.anchor, f.git(f.anchor, 'rev-parse', '--git-path', marker));
    writeFileSync(file, 'fixture operation');
    assert.equal(gitOperationInProgress(f.anchor), true, marker);
    rmSync(file);
  }
  assert.equal(gitOperationInProgress(f.anchor), false);
});
