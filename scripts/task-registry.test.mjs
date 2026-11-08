import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'parallel-registry-')),
    root = path.join(dir, 'main');
  mkdirSync(root);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cwd, ...args) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  writeFileSync(path.join(root, 'base.txt'), 'base');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const a = path.join(dir, 'task-a'),
    b = path.join(dir, 'task-b');
  git(root, 'worktree', 'add', '-b', 'codex/a', a);
  git(root, 'worktree', 'add', '-b', 'codex/b', b);
  return { dir, root, a, b, git, registry: createTaskRegistry(root) };
}
test('two dirty independent tasks register together and resolve only exact context', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.a, 'a.txt'), 'unfinished A');
  writeFileSync(path.join(f.b, 'b.txt'), 'unfinished B');
  const a = f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' });
  const b = f.registry.register({ id: 'b', worktree: f.b, owner: 'chat-b' });
  assert.equal(f.registry.list().length, 2);
  assert.equal(f.registry.resolve({ id: 'a', worktree: f.a }).id, 'a');
  assert.equal(f.registry.resolve({ worktree: f.b }).id, 'b');
  assert.throws(() => f.registry.resolve({}), /Explicit task/);
  assert.throws(() => f.registry.resolve({ id: 'a', worktree: f.b }), /differ/);
  assert.equal(readFileSync(path.join(f.a, 'a.txt'), 'utf8'), 'unfinished A');
  assert.equal(readFileSync(path.join(f.b, 'b.txt'), 'utf8'), 'unfinished B');
  assert.equal(a.remoteFreshnessProven, false);
  assert.equal(b.stage, 'developing');
});
test('duplicate owner, branch, id, and main cannot silently take over', (t) => {
  const f = fixture(t);
  f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' });
  assert.throws(() => f.registry.register({ id: 'a', worktree: f.b, owner: 'chat-a' }), /another worktree/);
  assert.throws(() => f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-b' }), /another owner/);
  assert.throws(() => f.registry.register({ id: 'other', worktree: f.a, owner: 'chat-a' }), /already belongs/);
  assert.throws(() => f.registry.register({ id: 'main', worktree: f.root, owner: 'chat' }), /main/);
  assert.equal(f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' }).revision, 1);
});
test('legacy frozen identity is read-only and cannot be overwritten by registration', (t) => {
  const f = fixture(t),
    directory = path.join(f.root, '.git/task-batches');
  mkdirSync(directory);
  const file = path.join(directory, 'active.json'),
    original = JSON.stringify({
      version: 1,
      id: 'legacy',
      worktree: f.a,
      branch: 'codex/a',
      repository: { commonDir: path.join(f.root, '.git') },
    });
  writeFileSync(file, original);
  assert.throws(() => f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' }), /Legacy task identity/);
  f.registry.register({ id: 'b', worktree: f.b, owner: 'chat-b' });
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(f.registry.legacy().id, 'legacy');
});
test('a changed branch or missing worktree remains an error instead of an absent task', (t) => {
  const f = fixture(t);
  f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' });
  f.git(f.a, 'switch', '-c', 'codex/replaced');
  assert.throws(() => f.registry.resolve({ id: 'a' }), /branch changed/);
  rmSync(f.a, { recursive: true, force: true });
  assert.ok(f.registry.readTask('a'));
  assert.throws(() => f.registry.resolve({ id: 'a' }), /missing/);
});
test('linked registry, existing lock, corrupt record and unknown dependency fail closed', (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a', dependsOn: ['unknown'] }),
    /Unknown task dependency/,
  );
  const lock = path.join(f.registry.directory, 'write.lock');
  mkdirSync(lock);
  assert.throws(() => f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' }), /locked/);
  rmSync(lock, { recursive: true });
  f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' });
  const file = path.join(f.registry.directory, 'tasks/a.json');
  writeFileSync(file, '{');
  assert.throws(() => f.registry.readTask('a'));
  rmSync(file);
  symlinkSync(path.join(f.root, 'base.txt'), file);
  assert.throws(() => f.registry.readTask('a'), /symlink/);
});

test('CLI lists read-only and registers/resolves the exact selected task', (t) => {
  const f = fixture(t),
    script = fileURLToPath(new URL('./task-registry.mjs', import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { cwd: f.root, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(run('list', '--json')), { version: 2, tasks: [], legacy: null });
  const registered = JSON.parse(run('register', '--task', 'a', '--worktree', f.a, '--owner', 'chat-a'));
  assert.equal(registered.id, 'a');
  assert.equal(JSON.parse(run('resolve', '--task', 'a', '--worktree', f.a)).branch, 'codex/a');
  assert.throws(() => run('resolve'), /Explicit task/);
});
test('restoration cannot silently redefine kind or dependencies', (t) => {
  const f = fixture(t);
  f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a' });
  assert.throws(() => f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a', kind: 'infrastructure' }), /kind/);
  assert.throws(
    () => f.registry.register({ id: 'a', worktree: f.a, owner: 'chat-a', dependsOn: ['other'] }),
    /dependencies/,
  );
});

test('legacy preservation keeps frozen record and failure receipt byte-for-byte and refuses new-style delivery', (t) => {
  const f = fixture(t),
    parent = path.join(f.root, '.git/task-batches'),
    delivery = path.join(f.root, '.git/task-delivery/legacy');
  mkdirSync(parent);
  mkdirSync(delivery, { recursive: true });
  const head = f.git(f.a, 'rev-parse', 'HEAD');
  const record = {
    version: 1,
    id: 'legacy',
    kind: 'business',
    owner: null,
    worktree: f.a,
    branch: 'codex/a',
    repository: { commonDir: path.join(f.root, '.git') },
    originMain: head,
    base: head,
    startHead: head,
    recordedHead: head,
    modules: [],
  };
  const activeFile = path.join(parent, 'active.json'),
    acceptance = path.join(delivery, 'accepted-source.json'),
    failure = path.join(delivery, 'completion-session.json');
  writeFileSync(activeFile, JSON.stringify(record));
  writeFileSync(acceptance, '{"immutable":"fixture"}');
  writeFileSync(failure, '{"merge":"failure"}');
  const before = [activeFile, acceptance, failure].map((file) => readFileSync(file));
  const proof = f.registry.inspectLegacy();
  assert.throws(
    () =>
      f.registry.preserveLegacy({
        expectedRecordDigest: '0'.repeat(64),
        expectedAcceptanceDigest: proof.acceptanceDigest,
      }),
    /changed since review/,
  );
  assert.throws(() => f.registry.preserveLegacy({ expectedRecordDigest: proof.recordDigest }), /frozen source changed/);
  const preserved = f.registry.preserveLegacy({
    expectedRecordDigest: proof.recordDigest,
    expectedAcceptanceDigest: proof.acceptanceDigest,
  });
  assert.equal(preserved.stage, 'frozen');
  assert.equal(preserved.compatibility.ownerBinding, 'not-inferred');
  assert.throws(() => f.registry.resolve({ id: 'legacy' }), /read-only/);
  [activeFile, acceptance, failure].forEach((file, index) => assert.deepEqual(readFileSync(file), before[index]));
  assert.equal(
    f.registry.preserveLegacy({
      expectedRecordDigest: proof.recordDigest,
      expectedAcceptanceDigest: proof.acceptanceDigest,
    }).revision,
    1,
  );
});
