import { runFixtureQueue } from './delivery-repairs/test-support/task-cleanup-scope-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  renameSync,
  existsSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { preserveAssets } from './task-completion.mjs';
import { cleanupIdentity, cleanupObjectId } from './task-cleanup-queue.mjs';
import { cleanupDataDigest } from './task-cleanup-types.mjs';
import { createdCleanupFixture } from './test-support/cleanup-created-fixture.mjs';

function fixture(t, { extra = false, omit = false, disposition = 'preserved-duplicate' } = {}) {
  const f = createdCleanupFixture(t),
    relative = 'test-results',
    original = path.join(f.root, relative);
  mkdirSync(path.join(original, 'case'), { recursive: true });
  const name = 'test-results/case/result.json',
    bytes = Buffer.from('{"original":"required first-run evidence"}');
  writeFileSync(path.join(f.root, name), bytes);
  const destination = path.join(f.common, 'task-assets', f.context.task.id);
  const preserved = preserveAssets(f.root, destination, [
    { file: name, kind: 'generated-output', bytes: bytes.length },
  ]);
  const raw = readFileSync(preserved.manifest),
    digest = cleanupDataDigest(raw),
    sha256 = cleanupDataDigest(bytes);
  if (extra) writeFileSync(path.join(original, 'unique.txt'), 'keep unique');
  const registration = {
    version: 1,
    task: f.context.task.id,
    worktree: f.root,
    relative,
    identity: cleanupIdentity(original),
    sourceDigest: digest,
    producer: 'preserved-report-duplicate-v1',
    preservation: {
      manifest: preserved.manifest,
      digest,
      files: omit
        ? []
        : [
            {
              relative: name,
              blob: path.join(destination, 'blobs', sha256),
              mode: lstatSync(path.join(f.root, name)).mode,
              sha256,
            },
          ],
    },
  };
  const registrationBytes = JSON.stringify(registration) + '\n',
    proofDigest = cleanupDataDigest(registrationBytes);
  const proofFile = path.join(f.common, 'task-cleanup/proofs', f.context.task.id, proofDigest + '.json');
  mkdirSync(path.dirname(proofFile), { recursive: true, mode: 0o700 });
  writeFileSync(proofFile, registrationBytes, { mode: 0o600, flag: 'wx' });
  const record = {
    version: 1,
    task: f.context.task.id,
    disposition,
    producer: 'task-completion-handoff-v1',
    identity: registration.identity,
    proof: { ...f.proof, rebuild: { kind: 'duplicate-preserved-v1', record: proofFile, digest: proofDigest } },
    notBefore: new Date(0).toISOString(),
  };
  const key = cleanupObjectId(record),
    carrier = path.join(f.common, 'task-cleanup/staging', record.task, key);
  Object.assign(record, { carrier, path: path.join(carrier, 'content') });
  mkdirSync(carrier, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(carrier, 'manifest.json'), JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  renameSync(original, record.path);
  return { ...f, record, registration, preserved, blob: path.join(destination, 'blobs', sha256), originalBytes: bytes };
}
const ready = { apply: true, verify: async () => ({ ready: true }), unreferenced: async () => {} };
test('actual preserveAssets proof permits only the extra staged copy; original manifest/blob survive deletion', async (t) => {
  const f = fixture(t);
  f.queue.handoff(f.record);
  const out = await runFixtureQueue(f, ready);
  assert.equal(out.processed[0].state, 'cleaned');
  assert.deepEqual(readFileSync(f.blob), f.originalBytes);
  assert.ok(existsSync(f.preserved.manifest));
  assert.equal(out.processed[0].deletedLogicalBytes, f.originalBytes.length);
  assert.equal(out.processed[0].physicalBytes, null);
});
test('a faulty producer cannot omit preserved members or include an additional unique file', (t) => {
  const omitted = fixture(t, { omit: true });
  assert.throws(() => omitted.queue.handoff(omitted.record));
  const extra = fixture(t, { extra: true });
  assert.throws(() => extra.queue.handoff(extra.record), /Unexpected unique/);
  assert.equal(readFileSync(path.join(extra.record.path, 'unique.txt'), 'utf8'), 'keep unique');
});
test('missing, changed or linked canonical preservation sources retain the extra report copy', async (t) => {
  for (const change of ['missing', 'changed', 'linked']) {
    const f = fixture(t);
    f.queue.handoff(f.record);
    if (change === 'missing') unlinkSync(f.blob);
    if (change === 'changed') writeFileSync(f.blob, 'corrupted canonical source');
    if (change === 'linked') {
      const other = f.blob + '-retained';
      renameSync(f.blob, other);
      symlinkSync(other, f.blob);
    }
    assert.equal((await runFixtureQueue(f, ready)).processed[0].state, 'blocked');
    assert.ok(existsSync(f.record.path));
  }
});
test('report duplicate proof cannot authorize regenerated data types or a stale reference', async (t) => {
  const mislabeled = fixture(t, { disposition: 'rebuildable' });
  assert.throws(() => mislabeled.queue.handoff(mislabeled.record), /disposition/);
  const f = fixture(t);
  f.queue.handoff(f.record);
  const out = await runFixtureQueue(f, {
    ...ready,
    unreferenced: async () => {
      throw Error('current report reader');
    },
  });
  assert.equal(out.processed[0].state, 'blocked');
  assert.ok(existsSync(f.record.path));
  assert.deepEqual(readFileSync(f.blob), f.originalBytes);
});
