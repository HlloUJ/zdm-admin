import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handoffPreservedReportCopies } from './task-cleanup-handoff.mjs';
import { cleanupIdentity, cleanupObjectId } from './task-cleanup-queue.mjs';
const sha = (value) => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'report-producer-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'work'),
    common = path.join(base, 'common'),
    task = 'fixture';
  for (const dir of [
    root,
    common,
    path.join(root, '.task-runtime'),
    path.join(root, 'test-results'),
    path.join(common, 'task-assets', task, 'blobs'),
  ])
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  const bytes = 'original first failure';
  writeFileSync(path.join(root, 'test-results/failure.json'), bytes);
  const digest = sha(bytes),
    blob = path.join(common, 'task-assets', task, 'blobs', digest);
  writeFileSync(blob, bytes, { mode: 0o600 });
  const content =
      JSON.stringify([
        { file: 'test-results/failure.json', kind: 'generated-output', bytes: Buffer.byteLength(bytes), digest },
      ]) + '\n',
    manifest = path.join(common, 'task-assets', task, 'assets-' + sha(content) + '.json');
  writeFileSync(manifest, content, { mode: 0o600 });
  let failed = false;
  const api = {
    cleanupIdentity,
    cleanupObjectId,
    createCleanupQueue: () => ({
      handoff: (record) => {
        if (failed) throw Error('queue unavailable');
        assert.equal(record.disposition, 'preserved-duplicate');
        assert.equal(record.proof.rebuild.kind, 'duplicate-preserved-v1');
        assert.deepEqual(JSON.parse(readFileSync(path.join(record.carrier, 'manifest.json'))), record);
        return { key: cleanupObjectId(record) };
      },
    }),
  };
  const input = {
    root,
    common,
    task,
    proof: { worktree: root, head: 'a'.repeat(40), accepted: 'b'.repeat(40), main: 'c'.repeat(40) },
    preserved: { manifest },
    assertUnreferenced: async () => {},
  };
  return { root, blob, manifest, input, api, fail: () => (failed = true), recover: () => (failed = false) };
}
function withoutReportPreservation(f) {
  const content = '[]\n',
    manifest = path.join(path.dirname(f.manifest), 'assets-' + sha(content) + '.json');
  writeFileSync(manifest, content, { mode: 0o600 });
  f.input.preserved = { manifest };
}
test('genuinely empty report directories stay untouched without claiming preserved copies or released space', async (t) => {
  const f = fixture(t);
  rmSync(path.join(f.root, 'test-results/failure.json'));
  withoutReportPreservation(f);
  const directories = ['test-results', 'playwright-report', 'coverage'];
  for (const relative of directories.slice(1)) mkdirSync(path.join(f.root, relative), { mode: 0o700 });
  const before = directories.map((relative) => cleanupIdentity(path.join(f.root, relative)));
  f.api.createCleanupQueue = () => ({ handoff: () => assert.fail('Empty directory cannot enter cleanup queue') });
  f.input.assertUnreferenced = async () => assert.fail('Empty retained directory needs no mutation reference check');
  assert.deepEqual(await handoffPreservedReportCopies(f.input, { api: f.api }), []);
  assert.deepEqual(
    directories.map((relative) => cleanupIdentity(path.join(f.root, relative))),
    before,
  );
  for (const relative of directories)
    assert.equal(existsSync(path.join(f.root, '.task-runtime', 'cleanup-preserved-' + relative + '.json')), false);
  assert.ok(existsSync(f.blob));
});
for (const member of ['file', 'empty-child-directory'])
  test('nonempty report directory without preservation stays protected: ' + member, async (t) => {
    const f = fixture(t);
    withoutReportPreservation(f);
    if (member === 'empty-child-directory') {
      rmSync(path.join(f.root, 'test-results/failure.json'));
      mkdirSync(path.join(f.root, 'test-results/child'));
    }
    const before = cleanupIdentity(path.join(f.root, 'test-results'));
    await assert.rejects(handoffPreservedReportCopies(f.input, { api: f.api }), /no complete preservation proof/);
    assert.deepEqual(cleanupIdentity(path.join(f.root, 'test-results')), before);
    assert.ok(existsSync(f.blob));
  });
for (const link of ['report-root', 'report-member'])
  test('linked report cannot be treated as an empty unpreserved directory: ' + link, async (t) => {
    const f = fixture(t),
      source = path.join(f.root, 'test-results'),
      target = path.join(f.root, 'retained-target');
    rmSync(path.join(source, 'failure.json'));
    mkdirSync(target);
    withoutReportPreservation(f);
    if (link === 'report-root') {
      rmSync(source, { recursive: true });
      symlinkSync(target, source);
    } else symlinkSync(target, path.join(source, 'linked'));
    await assert.rejects(handoffPreservedReportCopies(f.input, { api: f.api }), /Linked|linked/);
    assert.ok(existsSync(source));
    assert.ok(existsSync(target));
    assert.ok(existsSync(f.blob));
  });
test('complete preserved report copy moves once and keeps immutable original blob and failure bytes', async (t) => {
  const f = fixture(t),
    before = readFileSync(f.blob),
    result = await handoffPreservedReportCopies(f.input, { api: f.api });
  assert.equal(result[0].state, 'handed-off');
  assert.equal(existsSync(path.join(f.root, 'test-results')), false);
  assert.deepEqual(readFileSync(f.blob), before);
  const record = JSON.parse(readFileSync(result[0].manifest));
  assert.deepEqual(readFileSync(path.join(record.path, 'failure.json')), before);
  assert.deepEqual(await handoffPreservedReportCopies(f.input, { api: f.api }), result);
});
test('changed, additional or missing report members retain original and never admit inferred deletion', async (t) => {
  for (const mutate of [
    (f) => writeFileSync(path.join(f.root, 'test-results/failure.json'), 'changed'),
    (f) => writeFileSync(path.join(f.root, 'test-results/unique.json'), 'unique'),
    (f) => rmSync(path.join(f.root, 'test-results/failure.json')),
  ]) {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(handoffPreservedReportCopies(f.input, { api: f.api }));
    assert.ok(existsSync(path.join(f.root, 'test-results')));
    assert.ok(existsSync(f.blob));
  }
});
test('interrupted queue handoff resumes original carrier without deleting original preserved evidence', async (t) => {
  const f = fixture(t);
  f.fail();
  await assert.rejects(handoffPreservedReportCopies(f.input, { api: f.api }), /queue unavailable/);
  f.recover();
  assert.equal((await handoffPreservedReportCopies(f.input, { api: f.api }))[0].state, 'handed-off');
  assert.ok(existsSync(f.blob));
  assert.ok(existsSync(f.manifest));
});
