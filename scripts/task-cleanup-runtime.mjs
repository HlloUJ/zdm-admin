import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { safePath } from './task-cleanup-queue.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    maxBuffer: 64 * 1024 ** 2,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
const text = (root, ...args) =>
  git(root, ...args)
    .toString()
    .trim();
export function verifyCleanupRuntime(directory) {
  safePath(directory);
  const file = path.join(directory, 'runtime.json');
  safePath(file);
  assert.ok(lstatSync(file).isFile() && !(lstatSync(file).mode & 0o077));
  const manifest = JSON.parse(readFileSync(file));
  assert.equal(manifest.version, 1);
  assert.match(manifest.sourceHead, /^[a-f0-9]{40}$/);
  for (const p of [manifest.root, manifest.commonDir, manifest.node]) safePath(p);
  assert.equal(
    directory,
    path.join(manifest.commonDir, 'task-cleanup/runtime', manifest.sourceHead),
    'Runtime must survive removal of task worktrees',
  );
  assert.equal(digest(readFileSync(manifest.node)), manifest.nodeDigest, 'Node executable changed; republish runtime');
  assert.ok(Object.keys(manifest.files).length > 0 && Object.keys(manifest.files).length <= 5000);
  for (const [relative, fingerprint] of Object.entries(manifest.files)) {
    assert.ok(
      relative.startsWith('scripts/') && path.posix.normalize(relative) === relative && !relative.includes('..'),
    );
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    const target = path.join(directory, relative);
    safePath(target);
    const stat = lstatSync(target);
    assert.ok(stat.isFile() && !(stat.mode & 0o077));
    assert.equal(digest(readFileSync(target)), fingerprint, 'Runtime input changed: ' + relative);
  }
  for (const name of [
    'task-cleanup-scheduled-cli.mjs',
    'task-cleanup-cli.mjs',
    'task-cleanup-queue.mjs',
    'task-cleanup-delete.py',
  ])
    assert.ok(manifest.files['scripts/' + name], 'Runtime helper closure missing: ' + name);
  return manifest;
}

// Publishing is an explicit deployment operation. Merely importing this module does nothing.
// Take all tracked scripts from the exact Git object, including non-JS subprocess helpers.
export function publishCleanupRuntime(root, { expectedHead, node = process.execPath } = {}) {
  assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/);
  root = realpathSync(root);
  node = realpathSync(node);
  assert.equal(text(root, 'branch', '--show-current'), 'main', 'Only published main can supply cleanup runtime');
  assert.equal(text(root, 'rev-parse', 'HEAD'), expectedHead);
  assert.equal(
    text(root, 'rev-parse', 'refs/remotes/origin/main'),
    expectedHead,
    'Main tracking identity differs; no remote freshness claim',
  );
  assert.equal(text(root, 'status', '--porcelain'), '', 'Main source must be clean');
  const commonDir = realpathSync(path.resolve(root, text(root, 'rev-parse', '--git-common-dir')));
  const parent = path.join(commonDir, 'task-cleanup/runtime');
  safePath(parent);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assert.equal(lstatSync(parent).mode & 0o077, 0);
  const directory = path.join(parent, expectedHead);
  if (existsSync(directory)) return { directory, manifest: verifyCleanupRuntime(directory), reused: true };
  const staging = path.join(parent, '.building-' + randomUUID());
  mkdirSync(staging, { mode: 0o700 });
  const files = {};
  for (const entry of git(root, 'ls-tree', '-r', '-z', expectedHead, '--', 'scripts')
    .toString()
    .split('\0')
    .filter(Boolean)) {
    const [, mode, object, relative] = /^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(entry) ?? [];
    assert.ok(['100644', '100755'].includes(mode), 'Linked or unknown runtime source refused');
    assert.ok(
      relative.startsWith('scripts/') && path.posix.normalize(relative) === relative && !relative.includes('..'),
    );
    const bytes = git(root, 'cat-file', 'blob', object),
      target = path.join(staging, relative);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { mode: mode === '100755' ? 0o700 : 0o600, flag: 'wx' });
    files[relative] = digest(bytes);
  }
  const manifest = {
    version: 1,
    sourceHead: expectedHead,
    root,
    commonDir,
    node,
    nodeDigest: digest(readFileSync(node)),
    files,
  };
  writeFileSync(path.join(staging, 'runtime.json'), JSON.stringify(manifest) + '\n', { mode: 0o600, flag: 'wx' });
  assert.ok(!existsSync(directory), 'Concurrent runtime publisher; preserve both sources');
  renameSync(staging, directory);
  return { directory, manifest: verifyCleanupRuntime(directory), reused: false };
}
