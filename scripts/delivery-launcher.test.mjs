import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertDeliveryLauncherFresh,
  parseDeliveryLauncherArgs,
  runDeliveryLauncher,
  selectDeliveryLauncher,
} from './delivery-launcher.mjs';

const cli = fileURLToPath(new URL('./delivery-launcher.mjs', import.meta.url));
const entries = [
  'delivery-launcher.mjs',
  'sync-integration.mjs',
  'dev-task.mjs',
  'ensure-backend.mjs',
  'integration-handoff-state.mjs',
];
function fixture(t, { legacy = false } = {}) {
  const temporary = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'zdm-delivery-launcher-')));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const main = path.join(temporary, 'main');
  const task = path.join(temporary, 'task');
  mkdirSync(path.join(main, 'scripts'), { recursive: true });
  const git = (args, cwd = main) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Launcher Test']);
  git(['config', 'user.email', 'launcher@example.invalid']);
  git(['config', 'commit.gpgSign', 'false']);
  git(['config', 'core.hooksPath', '/dev/null']);
  const source = (root) => {
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    for (const entry of entries)
      writeFileSync(
        path.join(root, 'scripts', entry),
        entry === 'delivery-launcher.mjs' ? 'export const DELIVERY_LAUNCHER_PROTOCOL = 1;\n' : '// launcher fixture\n',
      );
  };
  if (legacy) writeFileSync(path.join(main, 'README.md'), 'legacy released baseline');
  else source(main);
  const commit = (root, message = 'checkpoint') => {
    git(['add', '.'], root);
    git(['commit', '-m', message], root);
    return git(['rev-parse', 'HEAD'], root);
  };
  const published = commit(main, 'published');
  git(['update-ref', 'refs/remotes/origin/main', published]);
  git(['worktree', 'add', '-b', 'codex/task', task]);
  return {
    main,
    task,
    git,
    commit,
    source,
    published,
    publishTask: () => git(['update-ref', 'refs/remotes/origin/codex/task', git(['rev-parse', 'HEAD'], task)]),
    options: { action: 'sync', taskBranch: 'codex/task', reviewedCandidate: null, plan: true },
  };
}

test('requires unambiguous task and full reviewed SHA without treating the flag as authorization', () => {
  assert.deepEqual(parseDeliveryLauncherArgs(['sync', '--task', 'codex/task', '--plan']), {
    action: 'sync',
    taskBranch: 'codex/task',
    reviewedCandidate: null,
    plan: true,
  });
  for (const args of [
    ['sync', '--task', 'main'],
    ['sync', '--task', 'codex/task', '--reviewed-candidate', 'abc'],
    ['sync', '--task', 'codex/task', '--task', 'codex/other'],
  ])
    assert.throws(() => parseDeliveryLauncherArgs(args));
});

test('an old business worktree uses the newer published launcher instead of its own scripts', (t) => {
  const value = fixture(t);
  writeFileSync(path.join(value.main, 'scripts/dev-task.mjs'), '// newer published implementation\n');
  const latest = value.commit(value.main);
  value.git(['update-ref', 'refs/remotes/origin/main', latest]);
  writeFileSync(path.join(value.task, 'business.txt'), 'business only');
  value.commit(value.task);
  const plan = selectDeliveryLauncher(value.options, value.task);
  assert.equal(plan.kind, 'published');
  assert.equal(plan.launcherRoot, value.main);
  assert.equal(plan.launcherHead, latest);
  assert.equal(plan.remoteEvidence, 'local-tracking-reference-only');
});

test('first reviewed self-upgrade runs the candidate while the released tree lacks the new selector', (t) => {
  const value = fixture(t, { legacy: true });
  value.source(value.task);
  const head = value.commit(value.task);
  value.publishTask();
  assert.throws(() => selectDeliveryLauncher(value.options, value.task), /不能先运行旧实现/);
  const options = { ...value.options, plan: false, reviewedCandidate: head };
  const calls = [];
  const plan = runDeliveryLauncher(options, {
    cwd: value.task,
    execute: (command, args, execution) => {
      calls.push({ command, args, execution });
      return { status: 0 };
    },
  });
  assert.equal(plan.kind, 'reviewed-candidate');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[0].args[0], path.join(value.task, 'scripts/sync-integration.mjs'));
  assert.equal(calls[0].execution.cwd, value.task);
  assert.ok(calls[0].args.includes(head));
  assert.ok(calls[0].args.includes(value.published));
});

test('changed launcher tasks require explicit reviewed selection even when main supports the protocol', (t) => {
  const value = fixture(t);
  writeFileSync(path.join(value.task, 'scripts/dev-task.mjs'), '// candidate change\n');
  const head = value.commit(value.task);
  value.publishTask();
  assert.throws(() => selectDeliveryLauncher(value.options, value.task), /自升级/);
  assert.equal(
    selectDeliveryLauncher({ ...value.options, reviewedCandidate: head }, value.task).launcherRoot,
    value.task,
  );
});

test('ordinary backend business and launcher test edits keep the published path without extra approval', (t) => {
  const value = fixture(t);
  mkdirSync(path.join(value.task, 'backend/src/main/java/example'), { recursive: true });
  writeFileSync(path.join(value.task, 'backend/src/main/java/example/Service.java'), 'class Service {}');
  writeFileSync(path.join(value.task, 'scripts/dev-task.test.mjs'), '// regression test only');
  value.commit(value.task);
  const plan = selectDeliveryLauncher(value.options, value.task);
  assert.equal(plan.kind, 'published');
  assert.deepEqual(plan.launcherChanges, []);
});

test('candidate changes, dirty state, unpushed references and main drift block selection', (t) => {
  const value = fixture(t);
  writeFileSync(path.join(value.task, 'scripts/dev-task.mjs'), '// candidate\n');
  const head = value.commit(value.task);
  const options = { ...value.options, reviewedCandidate: head };
  assert.throws(() => selectDeliveryLauncher(options, value.task), /远程跟踪分支/);
  value.publishTask();
  writeFileSync(path.join(value.task, 'uncommitted.txt'), 'dirty');
  assert.throws(() => selectDeliveryLauncher(options, value.task), /不干净/);
  value.commit(value.task);
  assert.throws(() => selectDeliveryLauncher(options, value.task), /HEAD 已变化/);
  writeFileSync(path.join(value.main, 'published.txt'), 'new baseline');
  value.commit(value.main);
  assert.throws(() => selectDeliveryLauncher(options, value.task), /main 与 origin\/main/);
});

test('plan CLI performs only local reads without invoking delivery or touching refs', (t) => {
  const value = fixture(t);
  const before = value.git(['show-ref']);
  const result = spawnSync(process.execPath, [cli, 'sync', '--task', 'codex/task', '--plan'], {
    cwd: value.task,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.launcherHead, value.published);
  assert.equal(value.git(['show-ref']), before);
  assert.equal(value.git(['status', '--porcelain']), '');
  assert.equal(value.git(['status', '--porcelain'], value.task), '');
});

test('published handoff selects the same release tree and targets the exact old task worktree', (t) => {
  const value = fixture(t);
  let called;
  runDeliveryLauncher(
    { ...value.options, action: 'handoff', plan: false },
    {
      cwd: value.task,
      execute: (_, args, execution) => {
        called = { args, execution };
        return { status: 0 };
      },
    },
  );
  assert.deepEqual(called.args, [path.join(value.main, 'scripts/dev-task.mjs'), '--handoff', '--worktree', value.task]);
  assert.equal(called.execution.cwd, value.main);
});

test('the existing sync fetch freshness check rejects a moved release before merge', (t) => {
  const value = fixture(t);
  const plan = selectDeliveryLauncher(value.options, value.task);
  writeFileSync(path.join(value.main, 'main-change.txt'), 'remote moved');
  const next = value.commit(value.main);
  value.git(['update-ref', 'refs/remotes/origin/main', next]);
  assert.throws(() => assertDeliveryLauncherFresh(plan, value.task), /发布基线已变化/);
  const source = readFileSync(fileURLToPath(new URL('./sync-integration.mjs', import.meta.url)), 'utf8');
  assert.ok(
    source.indexOf('assertDeliveryLauncherFresh(launcher, root)') >
      source.indexOf("run(['fetch', 'origin', '--prune']"),
  );
  assert.ok(source.indexOf('assertDeliveryLauncherFresh(launcher, root)') < source.indexOf("run(['merge', '--no-ff'"));
});

test('unsupported release protocol does not silently fall back to task scripts', (t) => {
  const value = fixture(t);
  writeFileSync(
    path.join(value.main, 'scripts/delivery-launcher.mjs'),
    'export const DELIVERY_LAUNCHER_PROTOCOL = 9;\n',
  );
  const head = value.commit(value.main);
  value.git(['update-ref', 'refs/remotes/origin/main', head]);
  assert.throws(() => selectDeliveryLauncher(value.options, value.task), /协议不兼容/);
});
