import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  dependencyTreeDigest,
  retainTaskDependencies,
  verifyRetainedDependencies,
} from './task-dependency-retention.mjs';
import { execFileSync } from 'node:child_process';
import { createTaskRegistry } from './task-registry.mjs';
import { inventoryAssets, preserveAssets } from './task-completion.mjs';
import { verifyPreservation } from './completion-cli.mjs';

test('private dependency retention preserves all bytes and links, is repeatable and detects later damage', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'dependency-retention-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'a'),
    destination = path.join(dir, 'retained'),
    modules = path.join(root, 'node_modules');
  mkdirSync(modules, { recursive: true });
  mkdirSync(destination, { mode: 0o700 });
  writeFileSync(path.join(modules, 'unknown-package-local.txt'), 'must not be deleted');
  const external = path.join(dir, 'b-external-file');
  writeFileSync(external, 'untouched B');
  symlinkSync(external, path.join(modules, 'external-link'));
  const before = dependencyTreeDigest(modules),
    entry = retainTaskDependencies(root, destination);
  assert.equal(entry.digest, before);
  assert.equal(existsSync(modules), false);
  assert.deepEqual(retainTaskDependencies(root, destination), entry);
  verifyRetainedDependencies(entry, destination);
  assert.deepEqual(retainTaskDependencies(root, destination), entry);
  assert.equal(readFileSync(external, 'utf8'), 'untouched B');
  writeFileSync(path.join(destination, 'private-dependencies/unknown-package-local.txt'), 'changed');
  assert.throws(() => verifyRetainedDependencies(entry, destination), /Retained dependencies changed/);
});

test('retention refuses public destination or an unrelated preexisting dependency archive', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'dependency-retention-refuse-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'a'),
    destination = path.join(dir, 'retained');
  mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  mkdirSync(destination, { mode: 0o755 });
  assert.throws(() => retainTaskDependencies(root, destination), /owner-only/);
  rmSync(destination, { recursive: true });
  mkdirSync(destination, { mode: 0o700 });
  mkdirSync(path.join(destination, 'private-dependencies'));
  assert.throws(() => retainTaskDependencies(root, destination), /do not replace/);
});
test('the actual v2 inventory/preservation path retains only A dependencies and still blocks private inputs', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'dependency-retention-git-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const main = path.join(dir, 'main'),
    a = path.join(dir, 'a'),
    b = path.join(dir, 'b');
  mkdirSync(main);
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(path.join(main, '.gitignore'), 'node_modules/\n.env\n');
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'base');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const [id, root] of [
    ['a', a],
    ['b', b],
  ])
    git(main, 'worktree', 'add', '-b', 'codex/' + id, root);
  const registry = createTaskRegistry(main);
  registry.register({ id: 'a', worktree: a, owner: 'chat-a' });
  registry.register({ id: 'b', worktree: b, owner: 'chat-b' });
  for (const root of [a, b]) {
    mkdirSync(path.join(root, 'node_modules'));
    writeFileSync(path.join(root, 'node_modules/package.txt'), root);
  }
  const destination = path.join(registry.commonDir, 'task-assets/a');
  writeFileSync(path.join(a, '.env'), 'private input');
  assert.throws(() => preserveAssets(a, destination), /private input/);
  assert.equal(readFileSync(path.join(b, 'node_modules/package.txt'), 'utf8'), b);
  unlinkSync(path.join(a, '.env'));
  assert.deepEqual(
    inventoryAssets(a).map((item) => item.kind),
    ['private-dependencies-to-retain'],
  );
  const result = preserveAssets(a, destination);
  verifyPreservation(result.manifest, destination);
  assert.equal(preserveAssets(a, destination).manifest, result.manifest);
  git(main, 'worktree', 'remove', a);
  verifyPreservation(result.manifest, destination);
  assert.equal(readFileSync(path.join(b, 'node_modules/package.txt'), 'utf8'), b);
});
