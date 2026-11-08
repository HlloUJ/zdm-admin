import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startParallelTask, parseTaskStart } from './task-start.mjs';
import { createTaskRegistry } from './task-registry.mjs';
function fixture(t) {
  const scratch = path.join(process.cwd(), '.task-runtime/start-fixtures');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(path.join(scratch, 'task-')),
    root = path.join(dir, 'main'),
    parent = path.join(dir, 'worktrees'),
    remote = path.join(dir, 'origin.git');
  mkdirSync(root);
  mkdirSync(parent);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cwd, ...args) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{}}}');
  writeFileSync(
    path.join(root, '.gitignore'),
    '.task-runtime/\n.task-verification/\ntest-results/\nplaywright-report/\ncoverage/\ndist/\nbackend/target/\n',
  );
  writeFileSync(path.join(root, 'baseline'), 'base');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(dir, 'init', '--bare', remote);
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  return { dir, root, parent, git, registry: createTaskRegistry(root) };
}
const options = (slug, parent) => ({
  slug,
  kind: 'business',
  owner: 'chat-' + slug,
  taskParent: parent,
  resume: false,
});
test('two task starts create independent worktrees without switching preview or blocking unfinished A', (t) => {
  const f = fixture(t),
    settings = path.join(f.root, '.git/preview-fixture.json');
  writeFileSync(settings, '{"selected":"unchanged"}');
  const a = startParallelTask(options('a', f.parent), { root: f.root });
  writeFileSync(path.join(a.task.worktree, 'unfinished'), 'A work');
  const b = startParallelTask(options('b', f.parent), { root: f.root });
  assert.equal(a.previewSwitched, false);
  assert.equal(b.previewSwitched, false);
  assert.equal(f.registry.list().length, 2);
  assert.equal(readFileSync(path.join(a.task.worktree, 'unfinished'), 'utf8'), 'A work');
  assert.equal(readFileSync(settings, 'utf8'), '{"selected":"unchanged"}');
  assert.equal(a.task.branch, 'codex/a');
  assert.equal(b.task.branch, 'codex/b');
});
test('exact resume does not fetch or perform a Git mutation', (t) => {
  const f = fixture(t);
  startParallelTask(options('a', f.parent), { root: f.root });
  const result = startParallelTask(
    { ...options('a', f.parent), resume: true },
    { root: f.root, git: () => assert.fail('resume must not fetch, switch or create') },
  );
  assert.equal(result.resumed, true);
  assert.equal(result.remoteFetched, false);
  assert.throws(
    () => startParallelTask({ ...options('a', f.parent), owner: 'other-chat' }, { root: f.root }),
    /Another owner/,
  );
  assert.throws(
    () => startParallelTask({ ...options('missing', f.parent), resume: true }, { root: f.root }),
    /not registered/,
  );
});
test('dirty main, existing path or temporary parent are refused without losing files', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'dirty'), 'keep');
  assert.throws(() => startParallelTask(options('a', f.parent), { root: f.root }), /Main anchor is dirty/);
  rmSync(path.join(f.root, 'dirty'));
  const target = path.join(f.parent, 'a');
  mkdirSync(target);
  writeFileSync(path.join(target, 'keep'), 'original');
  assert.throws(() => startParallelTask(options('a', f.parent), { root: f.root }), /already exists/);
  assert.equal(readFileSync(path.join(target, 'keep'), 'utf8'), 'original');
  assert.throws(() => startParallelTask(options('temp', tmpdir()), { root: f.root }), /temporary storage/);
});
test('registration failure after creation leaves recoverable intent and never deletes the new worktree', (t) => {
  const f = fixture(t),
    registry = createTaskRegistry(f.root);
  registry.register = () => {
    throw Error('injected registration failure');
  };
  assert.throws(() => startParallelTask(options('a', f.parent), { root: f.root, registry }), /injected/);
  assert.ok(existsSync(path.join(f.parent, 'a/baseline')));
  const intent = JSON.parse(readFileSync(path.join(registry.directory, 'start-intents/a.json'), 'utf8'));
  assert.equal(intent.state, 'worktree-created');
  assert.equal(f.git(path.join(f.parent, 'a'), 'branch', '--show-current'), 'codex/a');
  assert.throws(() => startParallelTask(options('a', f.parent), { root: f.root }), /already exists/);
});
test('start parser rejects unknown options and never accepts implicit preview switching', () => {
  assert.throws(() => parseTaskStart(['--preview', 'select']), /Unknown/);
  assert.throws(() => parseTaskStart(['--slug', '../other']), /match/);
  assert.equal(parseTaskStart(['--slug', 'a', '--owner', 'chat-a']).slug, 'a');
});
