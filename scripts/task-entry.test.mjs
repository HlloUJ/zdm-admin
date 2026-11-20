import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry, parallelTaskMode } from './task-registry.mjs';
import { registerBatch } from './task-batch.mjs';
import { main as legacyStart } from './start-micro-task.mjs';
function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'task-entry-'))),
    main = path.join(dir, 'main');
  mkdirSync(path.join(main, 'scripts'), { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'test@example.invalid');
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const name of [
    'task-entry.mjs',
    'task-registry.mjs',
    'task-action-dependencies.mjs',
    'parallel-task-timing.mjs',
    'batch-timing-core.mjs',
    'task-monitor-registration.mjs',
    'task-board-intake.mjs',
    'task-thread-titles.mjs',
    'task-execution-binding.mjs',
    'task-coordination.mjs',
    'task-network.mjs',
  ])
    copyFileSync(path.join(here, name), path.join(main, 'scripts', name));
  mkdirSync(path.join(main, '.codex'));
  writeFileSync(path.join(main, '.codex/zdm-project-workflow.yaml'), 'batch:\n  mode: parallel-independent\n');
  git('add', '.');
  git('commit', '-m', 'published entries');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const a = path.join(dir, 'a');
  git('worktree', 'add', '-b', 'codex/a', a);
  const run = (script = path.join(main, 'scripts/task-entry.mjs'), ...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: a,
      encoding: 'utf8',
      // These dependency-free Git/entry fixtures never access a network. The
      // actual proxy-enabled Node 22/24 chain is covered by task-network tests.
      env: { ...process.env, NODE_USE_ENV_PROXY: '0', ZDM_TASK_MONITOR_CONTEXT: '' },
    });
  return { main, a, git, run };
}
test('published main entry reads exact old-task context without copying source over it', (t) => {
  const f = fixture(t),
    registry = createTaskRegistry(f.main);
  registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' });
  writeFileSync(path.join(f.a, 'unfinished.txt'), 'preserve');
  const result = f.run(undefined, 'registry', 'resolve', '--task', 'a');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).worktree, f.a);
  assert.equal(readFileSync(path.join(f.a, 'unfinished.txt'), 'utf8'), 'preserve');
  const candidate = f.run(path.join(f.a, 'scripts/task-entry.mjs'), 'registry', 'list', '--json');
  assert.notEqual(candidate.status, 0);
  assert.match(candidate.stderr, /main anchor entry/);
  writeFileSync(path.join(f.main, 'unpublished.txt'), 'dirty main');
  const dirty = f.run(undefined, 'registry', 'list', '--json');
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /main source is dirty/);
});
test('the published parallel mode disables old singleton creation even before the first v2 task', (t) => {
  const f = fixture(t);
  assert.equal(parallelTaskMode(f.a), true);
  assert.throws(() => registerBatch(f.a, { id: 'old-shared' }), /独立任务入口|task:start/);
  assert.throws(() => legacyStart({ slug: 'old-shared' }, { cwd: f.a }), /旧共享任务入口已停用/);
  assert.equal(createTaskRegistry(f.main).legacy(), null);
});
test('existing registry restoration receives only the already verified worktree', (t) => {
  const f = fixture(t);
  createTaskRegistry(f.main).register({ id: 'a', worktree: f.a, owner: 'chat-a' });
  const result = f.run(undefined, '--worktree', f.a, 'registry', 'register', '--task', 'a', '--owner', 'chat-a');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).worktree, realpathSync(f.a));
  assert.equal(createTaskRegistry(f.main).readTask('a').owner, 'chat-a');
});
test('forwarded or repeated worktree flags cannot change the already verified task identity', (t) => {
  const f = fixture(t);
  createTaskRegistry(f.main).register({ id: 'a', worktree: f.a, owner: 'chat-a' });
  const unchanged = f.git('status', '--porcelain');
  for (const command of ['check', 'temporary', 'preview', 'complete', 'registry']) {
    for (const override of [['--worktree', f.main], ['--worktree=' + f.main]]) {
      const result = f.run(undefined, '--worktree', f.a, command, ...override);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /forwarded task identity cannot override/);
    }
  }
  const valid = f.run(undefined, '--worktree', f.a, 'registry', 'resolve', '--task', 'a');
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).worktree, f.a);
  assert.equal(f.git('status', '--porcelain'), unchanged);
});

test('retired scheduler entry cannot launch work', (t) => {
  const f = fixture(t);
  const result = f.run(undefined, 'schedule', '--task', 'a');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /task:entry/);
});

test('canonical entry refuses missing new-task monitoring before starting a subprocess', (t) => {
  const f = fixture(t);
  copyFileSync(new URL('./task-start.mjs', import.meta.url), path.join(f.main, 'scripts/task-start.mjs'));
  f.git('add', '.');
  f.git('commit', '-m', 'published start');
  f.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const before = f.git('worktree', 'list', '--porcelain');
  const result = f.run(undefined, 'start', '--slug', 'new-task', '--owner', 'fixture-owner');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires --monitor-context/);
  assert.equal(f.git('worktree', 'list', '--porcelain'), before);
});

test('raw register cannot create a new task outside the enrolled start path', (t) => {
  const f = fixture(t);
  const result = f.run(undefined, '--worktree', f.a, 'registry', 'register', '--task', 'a', '--owner', 'chat-a');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /raw register is restore-only/);
  assert.equal(createTaskRegistry(f.main).readTask('a'), null);
});

for (const surface of ['codex-thread', 'collaboration-agent'])
  test(`canonical ${surface} start blocks missing intake before any child process is spawned`, (t) => {
    const f = fixture(t),
      owner = '11111111-1111-4111-8111-111111111111';
    writeFileSync(
      path.join(f.main, 'scripts/task-start.mjs'),
      "import {writeFileSync} from 'node:fs';writeFileSync('child-started','unsafe');",
    );
    f.git('add', '.');
    f.git('commit', '-m', 'isolated start marker');
    f.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const context = {
      executionSurface: surface,
      taskNumber: '638',
      taskName: 'isolated native',
      taskStableId: 'native-new',
      worker: surface === 'codex-thread' ? owner : '/root/delivery_987',
      rootThreadId: owner,
      roomId: owner,
      authorizationRef: 'fixture-execute',
    };
    const before = f.git('worktree', 'list', '--porcelain');
    const result = spawnSync(
      process.execPath,
      [
        path.join(f.main, 'scripts/task-entry.mjs'),
        'start',
        '--slug',
        'native-new',
        '--owner',
        owner,
        ...(surface === 'codex-thread' ? [] : ['--monitor-context', JSON.stringify(context)]),
      ],
      {
        cwd: f.a,
        env: {
          ...process.env,
          CODEX_THREAD_ID: owner,
          ZDM_TASK_MONITOR_CONTEXT: surface === 'codex-thread' ? JSON.stringify(context) : 'not valid JSON',
        },
        encoding: 'utf8',
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Board intake missing/);
    assert.equal(f.git('worktree', 'list', '--porcelain'), before);
    assert.throws(() => readFileSync(path.join(f.a, 'child-started')), { code: 'ENOENT' });
  });

test('published dependency registration requires the actual worktree owner and exact task revision', (t) => {
  const f = fixture(t);
  const registry = createTaskRegistry(f.main);
  registry.register({ id: 'a', worktree: f.a, owner: 'fixture-owner' });
  const b = path.join(path.dirname(f.a), 'b');
  f.git('worktree', 'add', '-b', 'codex/b', b);
  registry.register({ id: 'b', worktree: b, owner: 'peer' });
  const invoke = (owner, revision) =>
    spawnSync(
      process.execPath,
      [
        path.join(f.main, 'scripts/task-entry.mjs'),
        '--worktree',
        f.a,
        'registry',
        'action-dependencies',
        '--task',
        'a',
        '--expected-revision',
        String(revision),
        '--requirements',
        JSON.stringify([{ task: 'b', actions: ['final'], evidence: 'delivery' }]),
      ],
      { cwd: f.main, encoding: 'utf8', env: { ...process.env, CODEX_THREAD_ID: owner } },
    );
  assert.match(invoke('foreign-owner', 1).stderr, /must own this exact task/);
  const result = invoke('fixture-owner', 1);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(registry.readTask('a').actionDependencies, [
    { task: 'b', actions: ['final'], evidence: 'delivery' },
  ]);
  assert.match(invoke('fixture-owner', 1).stderr, /Task revision changed/);
  assert.deepEqual(registry.readTask('a').dependsOn, []);
});
