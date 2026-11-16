import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createdCleanupFixture, cleanupFixtureTemplate } from './test-support/cleanup-created-fixture.mjs';
import { preserveAssets } from './task-completion.mjs';
import { handoffPreservedReportCopies, recordCloseoutCleanupInventory } from './task-cleanup-handoff.mjs';
import { handoffCreatedArtifacts } from './task-cleanup-created-artifacts.mjs';
const unreferenced = async () => {};
test('actual987 duplicate producer is accepted and consumed by actual683 queue only after closure; stable raw evidence survives', async (t) => {
  const f = createdCleanupFixture(t),
    task = f.context.task.id;
  mkdirSync(path.join(f.root, '.task-runtime'), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(f.root, 'test-results'));
  const file = 'test-results/first-failure.json',
    bytes = 'retained original first failure';
  writeFileSync(path.join(f.root, file), bytes);
  const preserved = preserveAssets(f.root, path.join(f.common, 'task-assets', task), [
    { file, kind: 'generated-output' },
  ]);
  const result = await handoffPreservedReportCopies({
    root: f.root,
    common: f.common,
    task,
    proof: f.proof,
    preserved,
    assertUnreferenced: unreferenced,
  });
  assert.equal(result.length, 1);
  const record = JSON.parse(readFileSync(result[0].manifest));
  assert.equal(record.proof.rebuild.kind, 'duplicate-preserved-v1');
  const deferred = await f.queue.run({ apply: true, verify: async () => ({ ready: false }), unreferenced });
  assert.equal(deferred.processed[0].state, 'deferred');
  assert.ok(existsSync(record.path));
  const consumed = await f.queue.run({
    apply: true,
    verify: async () => ({ ready: true }),
    unreferenced,
    now: Date.now() + 13 * 3600000,
  });
  assert.equal(consumed.processed[0].state, 'cleaned');
  assert.equal(existsSync(record.path), false);
  const entries = JSON.parse(readFileSync(preserved.manifest));
  assert.equal(readFileSync(path.join(f.common, 'task-assets', task, 'blobs', entries[0].digest), 'utf8'), bytes);
  assert.ok(existsSync(record.proof.rebuild.record));
});
test('created fixture and external source carrier appear in total closeout inventory, including protected unique contents', async (t) => {
  const f = createdCleanupFixture(t),
    task = f.context.task.id;
  const fixture = f.producer.createFixture({ template: cleanupFixtureTemplate, seed: 'a'.repeat(32) }),
    copy = f.producer.createSourceCopy({ sourceHead: f.proof.head });
  writeFileSync(path.join(copy.source, 'unique.txt'), 'unique value remains protected');
  writeFileSync(
    path.join(f.root, '.task-runtime/task-artifacts.json'),
    JSON.stringify({ version: 1, ready: true, task, worktree: f.root, directories: {} }),
  );
  const moved = await handoffCreatedArtifacts({
    root: f.root,
    common: f.common,
    task,
    proof: f.proof,
    assertUnreferenced: unreferenced,
  });
  assert.equal(moved.handedOff.length, 1);
  assert.equal(moved.protected.length, 1);
  const preserved = preserveAssets(f.root, path.join(f.common, 'task-assets', task), []);
  const inventory = recordCloseoutCleanupInventory({
    root: f.root,
    common: f.common,
    task,
    proof: f.proof,
    preserved,
    distHandoff: { state: 'retained' },
    createdHandoffs: moved,
  });
  const raw = JSON.parse(readFileSync(inventory.manifest));
  assert.equal(raw.createdArtifacts.resources, 2);
  assert.equal(raw.resources.find((resource) => resource.kind === fixture.kind).disposition, 'pending-cleanup');
  const retained = raw.resources.find((resource) => resource.kind === copy.kind);
  assert.equal(retained.disposition, 'protected-retention');
  assert.deepEqual(retained.sourceLocations, [copy.source]);
  assert.match(retained.reason, /unique|changed|Unexpected/);
  assert.equal(readFileSync(path.join(copy.source, 'unique.txt'), 'utf8'), 'unique value remains protected');
  assert.equal(raw.spaceReleased, false);
});
