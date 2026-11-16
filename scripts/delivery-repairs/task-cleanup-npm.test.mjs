import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, linkSync, chmodSync } from 'node:fs';
import path from 'node:path';
import {
  dependencyArchive as archive,
  dependencyAuditFixture as fixture,
} from './test-support/cleanup-npm-fixture.mjs';
import {
  auditPrivateTaskDependencies,
  handoffAuditedDependencies,
  readDependencyCleanupInventory,
} from './task-cleanup-npm.mjs';
import { npmArchiveFiles, npmDigest, verifyNpmPackageTree, npmIntegrityHex } from './task-cleanup-npm-proof.mjs';
import { cleanupIdentity } from '../task-cleanup-queue.mjs';
const safe = { apply: true, verify: async () => ({ ready: true }), unreferenced: async () => {} };
const handoff = (f, extra = {}) =>
  handoffAuditedDependencies({ ...f.parameters, proof: f.proof, assertUnreferenced: async () => {}, ...extra });
test('real archive audit stages only pristine private package and FD consumer survives source worktree removal', async (t) => {
  const f = fixture(t),
    audit = auditPrivateTaskDependencies(f.parameters);
  assert.equal(audit.auditKind, 'independent-archive-audit-v1');
  assert.equal(audit.entries.length, 1);
  assert.ok(audit.protected.some((e) => e.relative === 'node_modules/.bin'));
  const staged = await handoff(f);
  assert.equal(staged.handedOff.length, 1);
  assert.ok(!existsSync(f.source));
  assert.ok(existsSync(f.cache));
  const registration = JSON.parse(readFileSync(audit.entries[0].registration));
  rmSync(f.root, { recursive: true });
  const result = await f.queue.run(safe);
  assert.equal(result.processed[0].state, 'cleaned');
  assert.ok(result.processed[0].deletedLogicalBytes > 0);
  assert.equal(result.processed[0].physicalBytes, null);
  assert.ok(existsSync(registration.audit.archive));
  assert.ok(existsSync(audit.entries[0].registration));
  assert.equal((await handoff(f)).handedOff[0].state, 'cleaned');
});
test('unknown bytes, modes, hardlinks, symlinks and missing files retain original package', async (t) => {
  for (const mutation of ['extra', 'modified', 'mode', 'hardlink', 'symlink', 'missing']) {
    const f = fixture(t);
    auditPrivateTaskDependencies(f.parameters);
    if (mutation === 'extra') writeFileSync(path.join(f.source, 'unique.txt'), 'keep');
    if (mutation === 'modified') writeFileSync(path.join(f.source, 'index.js'), 'unique');
    if (mutation === 'mode') chmodSync(path.join(f.source, 'index.js'), 0o700);
    if (mutation === 'hardlink') linkSync(path.join(f.source, 'index.js'), path.join(f.source, 'shared.js'));
    if (mutation === 'symlink') symlinkSync(f.cache, path.join(f.source, 'linked'));
    if (mutation === 'missing') rmSync(path.join(f.source, 'index.js'));
    assert.throws(
      () => verifyNpmPackageTree(f.source, npmArchiveFiles(f.bytes, f.integrity)),
      undefined,
      mutation + ' independent content proof',
    );
    const result = await handoff(f);
    assert.equal(result.handedOff.length, 0, mutation);
    assert.ok(result.protected.some((e) => e.relative === 'node_modules/example'));
    assert.ok(existsSync(f.source));
  }
});
test('missing private archive, lock mismatch, install scripts and nested packages cannot gain proof', (t) => {
  const absent = fixture(t);
  rmSync(absent.cache);
  assert.equal(auditPrivateTaskDependencies(absent.parameters).entries.length, 0);
  const bad = fixture(t);
  writeFileSync(bad.cache, 'wrong');
  assert.equal(auditPrivateTaskDependencies(bad.parameters).entries.length, 0);
  const scripted = fixture(t, { installScript: true });
  assert.equal(auditPrivateTaskDependencies(scripted.parameters).entries.length, 0);
  const nested = fixture(t, { nested: true });
  const result = auditPrivateTaskDependencies(nested.parameters);
  assert.ok(result.protected.some((e) => e.relative.includes('/node_modules/')));
  const changed = fixture(t);
  writeFileSync(path.join(changed.root, 'package-lock.json'), '{}');
  assert.throws(() => auditPrivateTaskDependencies(changed.parameters), /binding changed/);
});
test('actual installed package with missing lock integrity keeps original bytes and reports the explicit immutable-proof gap', (t) => {
  const f = fixture(t),
    lockFile = path.join(f.root, 'package-lock.json'),
    lock = JSON.parse(readFileSync(lockFile));
  delete lock.packages['node_modules/example'].integrity;
  writeFileSync(lockFile, JSON.stringify(lock));
  const artifact = JSON.parse(readFileSync(f.artifact));
  artifact.lockDigest = npmDigest(readFileSync(lockFile));
  writeFileSync(f.artifact, JSON.stringify(artifact));
  const result = auditPrivateTaskDependencies(f.parameters),
    retained = result.protected.find((e) => e.relative === 'node_modules/example');
  assert.equal(result.entries.length, 0);
  assert.match(retained.reason, /锁未记录不可变SHA-512证明，保留原内容/);
  assert.doesNotMatch(retained.reason, /TypeError|must be of type string/);
  assert.equal(readFileSync(path.join(f.source, 'index.js'), 'utf8'), 'export default 1;');
  assert.deepEqual(readFileSync(f.cache), f.bytes);
  for (const value of [undefined, null, 42, ''])
    assert.throws(() => npmIntegrityHex(value), /锁未记录不可变SHA-512证明，保留原内容/);
});
test('real tar parser rejects traversal, duplicate and linked archive members without extracting', () => {
  for (const files of [
    [{ name: 'package/../unique', text: 'x' }],
    [{ name: '/package/x', text: 'x' }],
    [{ name: 'package/x', link: '../../keep' }],
    [
      { name: 'package/x', text: 'x' },
      { name: 'package/x', text: 'y' },
    ],
    [{ name: 'package/package.json', text: '{"scripts":{"postinstall":"unapproved-command"}}' }],
    [
      { name: 'package/package.json', text: '{}' },
      { name: 'package/binding.gyp', text: '{}' },
    ],
  ]) {
    const bytes = archive(files),
      integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    assert.throws(() => npmArchiveFiles(bytes, integrity));
  }
});
test('changed stable archive or active original references block cleanup without removing source', async (t) => {
  const active = fixture(t);
  auditPrivateTaskDependencies(active.parameters);
  const result = await handoff(active, {
    assertUnreferenced: async (r) => {
      assert.equal(r.path, path.join(active.root, 'node_modules'));
      throw Error('active dependency runtime');
    },
  });
  assert.equal(result.handedOff.length, 0);
  assert.ok(existsSync(active.source));
  const f = fixture(t),
    audit = auditPrivateTaskDependencies(f.parameters);
  await handoff(f);
  const registration = JSON.parse(readFileSync(audit.entries[0].registration));
  writeFileSync(registration.audit.archive, 'changed');
  const consumed = await f.queue.run(safe);
  assert.equal(consumed.processed[0].state, 'blocked');
});
test('queue interruption preserves a single journaled object and resumes idempotently', async (t) => {
  const f = fixture(t);
  auditPrivateTaskDependencies(f.parameters);
  await assert.rejects(
    handoffAuditedDependencies(
      { ...f.parameters, proof: f.proof, assertUnreferenced: async () => {} },
      {
        api: {
          handoff: () => {
            throw Error('isolated queue interruption');
          },
        },
      },
    ),
    /interruption/,
  );
  assert.equal(readDependencyCleanupInventory(f.parameters).artifacts[0].state, 'moving');
  assert.ok(!existsSync(f.source));
  const staged = await handoff(f),
    again = await handoff(f);
  assert.equal(staged.handedOff[0].object, again.handedOff[0].object);
  assert.equal((await f.queue.run(safe)).processed[0].state, 'cleaned');
});
test('independent consumer rejects a faulty metadata-only handoff that seals additional unique bytes', async (t) => {
  const f = fixture(t),
    audit = auditPrivateTaskDependencies(f.parameters);
  writeFileSync(path.join(f.source, 'unique.txt'), 'do not delete');
  const entry = audit.entries[0],
    registration = JSON.parse(readFileSync(entry.registration));
  registration.identity = cleanupIdentity(f.source);
  const bytes = JSON.stringify(registration) + '\n',
    digest = npmDigest(bytes),
    file = path.join(f.common, 'task-cleanup/proofs/created-task', digest + '.json');
  writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
  Object.assign(entry, { registration: file, digest, identity: registration.identity });
  const index = path.join(f.common, 'task-cleanup/npm-audits/created-task/index.json');
  writeFileSync(index, JSON.stringify(audit));
  const staged = await handoff(f);
  assert.equal(staged.handedOff.length, 1);
  const out = await f.queue.run(safe);
  assert.equal(out.processed[0].state, 'blocked');
  const manifest = JSON.parse(readFileSync(staged.handedOff[0].manifest));
  assert.equal(readFileSync(path.join(manifest.path, 'unique.txt'), 'utf8'), 'do not delete');
});
