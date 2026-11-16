import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildCloseoutCleanupInventory } from './task-cleanup-inventory.mjs';
import { recordCloseoutCleanupInventory } from './task-cleanup-handoff.mjs';
const sha = (v) => createHash('sha256').update(v).digest('hex');
function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'total-cleanup-handoff-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'task'),
    common = path.join(base, 'common'),
    task = 'cleanup-fixture';
  mkdirSync(root);
  mkdirSync(common);
  mkdirSync(path.join(root, '.task-runtime'), { mode: 0o700 });
  const proof = { worktree: root, head: 'a'.repeat(40), accepted: 'b'.repeat(40), main: 'c'.repeat(40) };
  return { root, common, task, proof };
}
const entries = [
  { file: 'node_modules', kind: 'private-dependencies-retained', digest: 'd'.repeat(64) },
  { file: 'test-results/report.json', kind: 'generated-output', digest: 'e'.repeat(64) },
  { file: '.task-verification/attempts/first-failure.json', kind: 'generated-output', digest: 'f'.repeat(64) },
  { file: '.task-runtime/e2e-app/index.html', kind: 'generated-output', digest: 'a'.repeat(64) },
  { file: '.task-runtime/custom/unique.bin', kind: 'generated-output', digest: 'b'.repeat(64) },
];
function input(f) {
  return {
    ...f,
    manifestDigest: 'd'.repeat(64),
    entries,
    preserved: { manifest: path.join(f.common, 'task-assets', f.task, 'assets-' + 'd'.repeat(64) + '.json') },
    artifacts: {
      version: 1,
      task: f.task,
      worktree: f.root,
      ready: true,
      directories: { dist: path.join(f.root, 'dist'), 'test-results': path.join(f.root, 'test-results') },
    },
    distHandoff: { state: 'retained', reason: 'no creation proof' },
  };
}
test('total inventory classifies dependencies, tests, evidence and unknown owned output without claiming automatic deletion', (t) => {
  const f = fixture(t),
    result = buildCloseoutCleanupInventory(input(f));
  assert.equal(result.spaceReleased, false);
  assert.equal(result.implementationComplete, false);
  assert.ok(result.gaps.some((g) => g.type === 'temporary-source-copy'));
  assert.ok(result.gaps.some((g) => g.type === 'expired-duplicate-report'));
  assert.equal(result.resources.find((r) => r.type === 'private-dependencies').disposition, 'protected-retention');
  assert.equal(
    result.resources.find((r) => r.type === 'private-dependencies').preserved.location.path,
    path.join(f.common, 'task-assets', f.task, 'private-dependencies'),
  );
  assert.equal(result.resources.find((r) => r.type === 'necessary-evidence').disposition, 'protected-retention');
  assert.equal(result.resources.find((r) => r.type === 'unclassified-owned-output').disposition, 'needs-review');
  assert.ok(!result.resources.some((r) => r.disposition === 'pending-cleanup'));
  for (const resource of result.resources) assert.ok(resource.preserved?.manifest || resource.evidence);
});
test('only accepted sealed dist is pending cleanup; protected objects reference stable preserved carriers', (t) => {
  const f = fixture(t),
    data = input(f);
  data.distHandoff = {
    state: 'handed-off',
    manifest: path.join(f.common, 'task-cleanup/staging/accepted/manifest.json'),
    object: 'd'.repeat(64),
  };
  const result = buildCloseoutCleanupInventory(data);
  assert.equal(result.resources.filter((r) => r.disposition === 'pending-cleanup').length, 1);
  assert.equal(result.resources.find((r) => r.disposition === 'pending-cleanup').type, 'application-build');
  assert.equal(result.registered.find((r) => r.relative === 'dist').classification, 'handed-off');
});
test('foreign ownership, creation paths and traversal cannot enter a successful total inventory', (t) => {
  const f = fixture(t);
  for (const mutate of [
    (i) => (i.artifacts.task = 'other'),
    (i) => (i.artifacts.directories.dist = '/other/task/dist'),
    (i) => (i.entries = [{ file: '../foreign', kind: 'generated-output' }]),
    (i) => (i.preserved.manifest = '/other/manifest.json'),
  ]) {
    const data = structuredClone(input(f));
    mutate(data);
    assert.throws(() => buildCloseoutCleanupInventory(data));
  }
});
test('whole inventory is immutable and idempotent in a stable owner-only store; a corrupt preservation proof fails', (t) => {
  const f = fixture(t),
    data = input(f),
    directory = path.join(f.common, 'task-assets', f.task);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const content = JSON.stringify(entries) + '\n',
    manifest = path.join(directory, 'assets-' + sha(content) + '.json');
  writeFileSync(manifest, content);
  writeFileSync(path.join(f.root, '.task-runtime/task-artifacts.json'), JSON.stringify(data.artifacts));
  const inputRecord = { ...f, preserved: { manifest }, distHandoff: data.distHandoff };
  const result = recordCloseoutCleanupInventory(inputRecord);
  assert.equal(result.state, 'inventory-handed-off');
  assert.ok(result.gaps.length);
  assert.equal(result.spaceReleased, false);
  assert.deepEqual(recordCloseoutCleanupInventory(inputRecord), result);
  assert.equal(JSON.parse(readFileSync(result.manifest, 'utf8')).resources.length, 5);
  writeFileSync(manifest, '[]');
  assert.throws(() => recordCloseoutCleanupInventory(inputRecord), /manifest changed/);
});
