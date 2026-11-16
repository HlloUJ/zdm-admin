import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const npmDigest = (data) => createHash('sha256').update(data).digest('hex');
export function npmPrivatePath(file) {
  assert.ok(path.isAbsolute(file) && path.resolve(file) === file);
  for (let p = file; ; p = path.dirname(p)) {
    const s = lstatSync(p);
    assert.ok(!s.isSymbolicLink(), 'Linked dependency audit path refused');
    if (p === path.dirname(p)) break;
  }
  return lstatSync(file);
}
export function npmPackagePath(relative) {
  assert.match(
    relative,
    /^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i,
    'Only exact top-level lock-indexed package roots are auditable',
  );
  assert.ok(!relative.split('/').some((s) => s === '.' || s === '..' || s === '.bin'));
  return relative;
}
export function npmIntegrityHex(integrity) {
  assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  const bytes = Buffer.from(integrity.slice(7), 'base64');
  assert.equal(bytes.length, 64);
  assert.equal(bytes.toString('base64'), integrity.slice(7));
  return bytes.toString('hex');
}
export function npmArchiveFiles(bytes, integrity) {
  assert.equal(
    createHash('sha512').update(bytes).digest('hex'),
    npmIntegrityHex(integrity),
    'Dependency tarball integrity changed',
  );
  const result = spawnSync(
    'python3',
    ['-I', fileURLToPath(new URL('./task-cleanup-npm-archive.py', import.meta.url))],
    { input: bytes, maxBuffer: 32 * 1024 ** 2, timeout: 30000 },
  );
  assert.ok(
    !result.error && result.status === 0,
    result.stderr?.toString().trim() || 'Dependency archive proof unavailable',
  );
  const inspected = JSON.parse(result.stdout);
  assert.deepEqual(inspected.installScripts, [], 'Archive lifecycle scripts require separate proof');
  return inspected.files;
}
export function verifyNpmPackageTree(directory, expected, { partial = false } = {}) {
  npmPrivatePath(directory);
  const found = [],
    dirs = new Set(['']);
  for (const name of Object.keys(expected)) {
    assert.ok(!path.posix.isAbsolute(name) && path.posix.normalize(name) === name && !name.includes('\\'));
    for (let d = path.posix.dirname(name); d !== '.'; d = path.posix.dirname(d)) dirs.add(d);
  }
  const actualDirs = new Set(['']);
  let count = 0;
  function walk(file, relative) {
    const s = lstatSync(file);
    assert.ok(++count <= 100000 && !s.isSymbolicLink(), 'Linked or oversized dependency tree');
    if (s.isDirectory()) {
      assert.ok(dirs.has(relative), 'Unknown dependency directory; retain original');
      actualDirs.add(relative);
      for (const name of readdirSync(file).sort()) walk(path.join(file, name), relative ? relative + '/' + name : name);
    } else {
      assert.ok(s.isFile() && s.nlink === 1, 'Shared/special dependency content retained');
      const item = expected[relative];
      assert.ok(item, 'Unknown unique dependency file; retain original');
      assert.equal(s.size, item.bytes, 'Modified dependency bytes; retain original');
      assert.equal(npmDigest(readFileSync(file)), item.sha256, 'Modified dependency content; retain original');
      assert.equal(s.mode & 0o7777, item.executable ? 0o755 : 0o644, 'Dependency normalized mode changed');
      found.push(relative);
    }
  }
  walk(directory, '');
  if (!partial) {
    assert.deepEqual(found.sort(), Object.keys(expected).sort(), 'Dependency content set differs');
    assert.deepEqual([...actualDirs].sort(), [...dirs].sort(), 'Dependency directory set differs');
  }
}
function gitBytes(common, head, file) {
  assert.match(head, /^[a-f0-9]{40}$/);
  return execFileSync('git', ['--no-replace-objects', '--git-dir', common, 'show', head + ':' + file], {
    maxBuffer: 32 * 1024 ** 2,
  });
}
export function validateNpmAuditRegistration(record, registration, common, { readArchive = true } = {}) {
  assert.equal(registration.producer, 'npm-archive-audit-v1');
  assert.equal(registration.audit?.kind, 'independent-archive-audit-v1');
  assert.equal(registration.audit.scriptPolicy, 'no-install-scripts-v1');
  assert.match(registration.audit.artifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    npmDigest(gitBytes(common, record.proof.head, 'package.json')),
    registration.audit.manifestDigest,
    'Dependency package input differs from delivered candidate',
  );
  npmPackagePath(registration.relative);
  const lockBytes = gitBytes(common, record.proof.head, 'package-lock.json');
  assert.equal(npmDigest(lockBytes), registration.sourceDigest, 'Dependency lock differs from delivered candidate');
  const lock = JSON.parse(lockBytes),
    item = lock.packages[registration.relative];
  assert.ok(item && !item.link && !item.hasInstallScript, 'Linked/install-script dependency requires separate proof');
  assert.ok(
    !Object.keys(lock.packages).some((p) => p.startsWith(registration.relative + '/node_modules/')),
    'Nested dependency ownership retained',
  );
  assert.equal(item.integrity, registration.audit.integrity);
  assert.equal(
    registration.audit.archive,
    path.join(common, 'task-cleanup/dependency-archives', record.task, npmIntegrityHex(item.integrity) + '.tgz'),
  );
  const s = npmPrivatePath(registration.audit.archive);
  assert.ok(s.isFile() && s.nlink === 1 && !(s.mode & 0o077), 'Private immutable dependency archive required');
  assert.match(registration.audit.filesDigest, /^[a-f0-9]{64}$/);
  if (!readArchive) return null; // Handoff only: no deletion authority; consume independently verifies bytes.
  const files = npmArchiveFiles(readFileSync(registration.audit.archive), item.integrity);
  assert.equal(npmDigest(JSON.stringify(files)), registration.audit.filesDigest, 'Dependency archive file set changed');
  return files;
}
