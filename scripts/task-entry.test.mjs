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
  for (const name of ['task-entry.mjs', 'task-registry.mjs'])
    copyFileSync(path.join(here, name), path.join(main, 'scripts', name));
  writeFileSync(path.join(main, 'scripts/dev-task.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  mkdirSync(path.join(main, '.codex'));
  writeFileSync(path.join(main, '.codex/zdm-project-workflow.yaml'), 'batch:\n  mode: parallel-independent\n');
  git('add', '.');
  git('commit', '-m', 'published entries');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const a = path.join(dir, 'a');
  git('worktree', 'add', '-b', 'codex/a', a);
  const run = (script = path.join(main, 'scripts/task-entry.mjs'), ...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: a, encoding: 'utf8' });
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
test('published preview aliases reject a second target and operation changes before dispatch', (t) => {
  const f = fixture(t);
  for (const command of ['check', 'temporary']) {
    for (const rest of [
      ['--worktree', f.main],
      ['--stop'],
      ['--pause'],
      ['--handoff'],
      ['--validation-candidate', 'a'.repeat(40)],
    ]) {
      const result = f.run(undefined, '--worktree', f.a, command, ...rest);
      assert.notEqual(result.status, 0, command + ': ' + rest.join(' '));
      assert.match(result.stderr, /Unsupported .* option/);
      assert.equal(result.stdout, '', 'The downstream entry must not run');
    }
  }
  assert.equal(f.git('status', '--porcelain'), '');
});
test('published preview aliases preserve their exact target and supported downstream options', (t) => {
  const f = fixture(t);
  const cases = [
    ['check', ['--port', '5177'], ['--check', '--worktree', f.a, '--port', '5177']],
    [
      'temporary',
      ['--mode', 'full', '--backend-port', '8082', '--database-risk'],
      ['--worktree', f.a, '--temporary', '--mode', 'full', '--backend-port', '8082', '--database-risk'],
    ],
    [
      'temporary',
      ['--mode', 'frontend', '--api', 'http://127.0.0.1:8082'],
      ['--worktree', f.a, '--temporary', '--mode', 'frontend', '--api', 'http://127.0.0.1:8082'],
    ],
  ];
  for (const [command, rest, expected] of cases) {
    const result = f.run(undefined, '--worktree', f.a, command, ...rest);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  }
});
test('published preview aliases reject duplicate options and missing option values', (t) => {
  const f = fixture(t);
  for (const [command, rest] of [
    ['check', ['--port', '5177', '--port', '5178']],
    ['temporary', ['--mode', 'full', '--mode', 'frontend']],
    ['temporary', ['--database-risk', '--database-risk']],
    ['temporary', ['--api']],
    ['temporary', ['--mode', '--api', 'http://127.0.0.1:8082']],
  ]) {
    const result = f.run(undefined, '--worktree', f.a, command, ...rest);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Duplicate|Missing value/);
    assert.equal(result.stdout, '');
  }
});
