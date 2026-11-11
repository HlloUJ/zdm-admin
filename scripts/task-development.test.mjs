import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { checkpointTask, taskWorkStatus, taskWorkCommand } from './task-development.mjs';

function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'task-development-'))),
    main = path.join(dir, 'main');
  mkdirSync(main);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(path.join(main, '.gitignore'), '.task-runtime/\n.task-verification/\n');
  writeFileSync(path.join(main, 'source.js'), 'export const value = 1;');
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'base');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const a = path.join(dir, 'a'),
    b = path.join(dir, 'b');
  git(main, 'worktree', 'add', '-b', 'codex/a', a);
  git(main, 'worktree', 'add', '-b', 'codex/b', b);
  const registry = createTaskRegistry(main);
  registry.register({ id: 'a', worktree: a, owner: 'chat-a' });
  registry.register({ id: 'b', worktree: b, owner: 'chat-b' });
  writeFileSync(path.join(a, 'source.js'), 'export const value = 2;');
  const commit = () => {
    git(a, 'add', 'source.js');
    git(a, 'commit', '-m', 'WIP own task');
    return git(a, 'rev-parse', 'HEAD');
  };
  return { a, b, main, git, registry, commit };
}

test('status reports actual source and lifecycle without requiring or claiming a development review', (t) => {
  const f = fixture(t),
    before = f.registry.readTask('a'),
    other = f.registry.readTask('b');
  const status = taskWorkStatus(f.a, { id: 'a', owner: 'chat-a' });
  assert.equal(status.stage, 'developing');
  assert.equal(status.clean, false);
  assert.equal(status.currentHead, before.recordedHead);
  assert.equal(status.recordedHeadMatches, true);
  assert.equal(status.frozen, false);
  assert.equal(status.verificationProven, false);
  assert.equal(status.formalDeliveryComplete, false);
  assert.equal(Object.hasOwn(status, 'developmentComplete'), false);
  assert.deepEqual(f.registry.readTask('a'), before);
  assert.deepEqual(f.registry.readTask('b'), other);
  assert.throws(() => taskWorkStatus(f.a, { id: 'a', owner: 'chat-b' }), /must own/);
  assert.throws(() => taskWorkStatus(f.a, { id: 'b', owner: 'chat-a' }));
});

test('a successful status CLI query exits zero while the task is still developing', (t) => {
  const f = fixture(t);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./task-development.mjs', import.meta.url)), 'status', 'a'],
    { cwd: f.a, env: { ...process.env, CODEX_THREAD_ID: 'chat-a' }, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).stage, 'developing');
  assert.equal(JSON.parse(result.stdout).formalDeliveryComplete, false);
});

test('a WIP checkpoint records the exact owner only and does not certify checks or publish', (t) => {
  const f = fixture(t),
    other = f.registry.readTask('b'),
    commit = f.commit();
  assert.equal(taskWorkStatus(f.a, { id: 'a', owner: 'chat-a' }).recordedHeadMatches, false);
  const record = checkpointTask(f.a, { id: 'a', owner: 'chat-a', commit, verification: 'WIP, not validated' });
  assert.equal(record.stage, 'developing');
  assert.equal(record.recordedHead, commit);
  assert.equal(record.checkpoints[0].commit, commit);
  assert.equal(record.development, undefined);
  const status = taskWorkStatus(f.a, { id: 'a', owner: 'chat-a' });
  assert.equal(status.clean, true);
  assert.equal(status.recordedHeadMatches, true);
  assert.equal(status.verificationProven, false);
  assert.equal(status.formalDeliveryComplete, false);
  assert.deepEqual(f.registry.readTask('b'), other);
  assert.equal(f.git(f.main, 'status', '--porcelain'), '');
});

test('checkpoint refuses another owner, missing notes and a foreign commit without changing task state', (t) => {
  const f = fixture(t),
    commit = f.commit(),
    args = { id: 'a', owner: 'chat-a', commit, verification: 'WIP' },
    before = f.registry.readTask('a'),
    other = f.registry.readTask('b');
  assert.throws(() => checkpointTask(f.a, { ...args, owner: 'chat-b' }), /must own/);
  assert.throws(() => checkpointTask(f.a, { ...args, verification: '' }), /notes required/);
  assert.throws(() => checkpointTask(f.a, { ...args, commit: 'bad' }));
  writeFileSync(path.join(f.b, 'source.js'), 'foreign B commit');
  f.git(f.b, 'add', 'source.js');
  f.git(f.b, 'commit', '-m', 'other task');
  assert.throws(() => checkpointTask(f.a, { ...args, commit: f.git(f.b, 'rev-parse', 'HEAD') }));
  assert.deepEqual(f.registry.readTask('a'), before);
  assert.deepEqual(f.registry.readTask('b'), other);
});

test('checkpoint retains the original accepted-source freeze', (t) => {
  const f = fixture(t),
    commit = f.commit(),
    before = f.registry.readTask('a'),
    directory = path.join(f.registry.commonDir, 'task-delivery/a');
  mkdirSync(directory, { recursive: true });
  const frozen = path.join(directory, 'accepted-source.json');
  writeFileSync(frozen, '{"fixture":"original accepted source"}');
  assert.throws(
    () => checkpointTask(f.a, { id: 'a', owner: 'chat-a', commit, verification: 'WIP' }),
    /Accepted source already exists/,
  );
  assert.deepEqual(f.registry.readTask('a'), before);
  assert.equal(readFileSync(frozen, 'utf8'), '{"fixture":"original accepted source"}');
});

test('old review files and metadata remain historical through status and a new checkpoint', (t) => {
  const f = fixture(t),
    task = f.registry.readTask('a');
  f.registry.revise('a', task.revision, (record) => {
    record.stage = 'dev-validated';
    record.development = { reviewed: true, reviewVersion: 2, sourceDigest: 'old' };
    record.reviewScope = { file: '.task-runtime/missing-scope.json' };
    record.reviewPasses = [{ file: '.task-runtime/missing-review.json' }];
  });
  const before = f.registry.readTask('a');
  assert.equal(taskWorkStatus(f.a, { id: 'a', owner: 'chat-a' }).verificationProven, false);
  assert.deepEqual(f.registry.readTask('a'), before);
  const result = checkpointTask(f.a, { id: 'a', owner: 'chat-a', commit: f.commit(), verification: 'WIP' });
  assert.equal(result.stage, 'developing');
  assert.deepEqual(result.development, before.development);
  assert.deepEqual(result.reviewScope, before.reviewScope);
  assert.deepEqual(result.reviewPasses, before.reviewPasses);
});

test('retired workflow commands and extra arguments are rejected without touching the registry', (t) => {
  const f = fixture(t),
    before = f.registry.readTask('a');
  for (const command of ['scope', 'review', 'ready'])
    assert.throws(() => taskWorkCommand(f.a, [command, 'a', '.task-runtime/old.json'], 'chat-a'), /task:work/);
  for (const args of [
    ['status'],
    ['status', 'a', 'extra'],
    ['checkpoint', 'a'],
    ['checkpoint', 'a', 'x', 'WIP', 'extra'],
  ])
    assert.throws(() => taskWorkCommand(f.a, args, 'chat-a'), /task:work/);
  assert.equal(taskWorkCommand(f.a, ['status', 'a'], 'chat-a').stage, 'developing');
  assert.deepEqual(f.registry.readTask('a'), before);
});
