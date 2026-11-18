import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import {
  handoffCreatedArtifacts,
  beginE2eCleanupCreation,
  resolveCleanupCreationContext,
  readCreatedArtifactInventory,
} from './task-cleanup-created-artifacts.mjs';
import {
  e2eArtifactDigest,
  validateCleanupTypeContent,
  validateCleanupTypeRegistration,
} from './task-cleanup-types.mjs';
import { cleanupIdentity } from './task-cleanup-queue.mjs';
import { prepareApplication, readApplicationProof, APP_DIRECTORY } from './e2e-app.mjs';
import {
  createdCleanupFixture as fixture,
  cleanupFixtureTemplate as template,
} from './test-support/cleanup-created-fixture.mjs';
const unreferenced = async () => {};
const ready = { verify: async () => ({ ready: true }), unreferenced };
test('Git-template fixture is proved at creation, staged before close, consumed only after independent closure', async (t) => {
  const f = fixture(t),
    entry = f.producer.createFixture({ template, seed: 'a'.repeat(32) }),
    original = path.join(f.root, entry.relative);
  const moved = await f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced });
  assert.equal(moved.handedOff.length, 1);
  assert.ok(!existsSync(original));
  const pending = JSON.parse(readFileSync(path.join(f.queue.base, 'pending', moved.handedOff[0].key + '.json')));
  assert.equal(pending.proof.rebuild.kind, 'generated-fixture-v1');
  assert.equal(
    (await f.queue.run({ ...ready, apply: true, verify: async () => ({ ready: false }) })).processed[0].state,
    'deferred',
  );
  const result = await f.queue.run({ ...ready, apply: true, now: Date.now() + 13 * 3600000 });
  assert.equal(result.processed[0].state, 'cleaned');
  assert.ok(result.processed[0].deletedLogicalBytes > 0);
  assert.ok(existsSync(pending.proof.rebuild.record));
  assert.ok(existsSync(path.join(pending.carrier, 'manifest.json')));
});
test('source-copy expected set retains extra unique files and modified tracked bytes', async (t) => {
  const f = fixture(t),
    entry = f.producer.createSourceCopy({ sourceHead: f.proof.head }),
    source = entry.source;
  writeFileSync(path.join(source, 'unique.txt'), 'keep');
  const inventory = readCreatedArtifactInventory({ root: f.root, common: f.common, task: 'created-task' });
  assert.equal(inventory.artifacts[0].source, source);
  assert.ok(source.startsWith(path.join(f.common, 'task-cleanup/created-sources') + path.sep));
  const registration = { ...JSON.parse(readFileSync(entry.registration)), identity: cleanupIdentity(source) };
  const faultyRecord = {
    task: 'created-task',
    identity: registration.identity,
    disposition: 'rebuildable',
    proof: { ...f.proof, rebuild: { kind: 'git-source-copy-v1' } },
  };
  validateCleanupTypeRegistration(faultyRecord, registration, f.common);
  assert.throws(() => validateCleanupTypeContent(faultyRecord, registration, source, f.common), /Unexpected unique/);
  const handoff = await f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced });
  assert.equal(handoff.handedOff.length, 0);
  assert.equal(handoff.protected.length, 1);
  assert.equal(readFileSync(path.join(source, 'unique.txt'), 'utf8'), 'keep');
  const other = f.producer.createSourceCopy({ sourceHead: f.proof.head }),
    target = other.source;
  writeFileSync(path.join(target, 'src/app.ts'), 'unique modified code');
  assert.equal((await f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced })).handedOff.length, 0);
  assert.equal(readFileSync(path.join(target, 'src/app.ts'), 'utf8'), 'unique modified code');
});
test('exact Git source copy is removed without changing the original Git input', async (t) => {
  const f = fixture(t);
  f.producer.createSourceCopy({ sourceHead: f.proof.head });
  assert.equal((await f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced })).handedOff.length, 1);
  assert.equal((await f.queue.run({ ...ready, apply: true })).processed[0].state, 'cleaned');
  assert.equal(readFileSync(path.join(f.root, 'src/app.ts'), 'utf8'), 'export const value = 1;');
});
test('fixture seeds are restricted data and cannot execute task text', (t) => {
  const f = fixture(t);
  assert.throws(() => f.producer.createFixture({ template, seed: 'process.exit();' }));
  assert.equal(f.producer.inventory().length, 0);
  assert.ok(!existsSync(path.join(f.root, '.task-runtime/cleanup-created')));
});
test('existing E2E creator hook preserves proof contract and records a successful stable generation', async (t) => {
  const f = fixture(t);
  let command;
  const proof = prepareApplication(f.root, {
    beginCleanup: (root) => beginE2eCleanupCreation(root, { context: f.context, env: {} }),
    execute: (cmd, args) => {
      command = [cmd, ...args];
      const dir = path.join(f.root, APP_DIRECTORY);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(dir, 'index.html'), 'compiled fixture');
      return { status: 0 };
    },
  });
  assert.equal(command[0], process.execPath);
  assert.deepEqual(command.slice(2), ['build', '--config', 'vite.e2e.config.mjs']);
  assert.deepEqual(readApplicationProof(f.root), proof);
  assert.equal(e2eArtifactDigest(path.join(f.root, APP_DIRECTORY)), proof.artifact);
  assert.equal(f.producer.inventory()[0].kind, 'e2e-test-build-v1');
  assert.equal(f.producer.inventory()[0].state, 'ready');
  assert.equal((await f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced })).handedOff.length, 1);
  assert.equal((await f.queue.run({ ...ready, apply: true })).processed[0].state, 'cleaned');
  assert.ok(existsSync(path.join(f.root, '.task-runtime/e2e-app-proof.json')));
});
test('failed or changing E2E generation remains protected', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      prepareApplication(f.root, {
        beginCleanup: (root) => beginE2eCleanupCreation(root, { context: f.context, env: {} }),
        execute: () => ({ status: 1 }),
      }),
    /build failed/,
  );
  assert.equal(f.producer.inventory()[0].state, 'protected');
  const build = f.producer.beginE2eBuild({});
  mkdirSync(path.join(f.root, APP_DIRECTORY), { recursive: true });
  writeFileSync(path.join(f.root, APP_DIRECTORY, 'index.html'), 'built');
  writeFileSync(path.join(f.root, 'src/app.ts'), 'changed during build');
  assert.equal(
    build.complete({ version: 1, source: 'a'.repeat(64), artifact: 'b'.repeat(64), policy: 'c'.repeat(64) }).state,
    'protected',
  );
  assert.ok(existsSync(path.join(f.root, APP_DIRECTORY, 'index.html')));
});
test('unknown environment, unregistered scope and changed permissions cannot become eligible', async (t) => {
  const f = fixture(t);
  assert.equal(resolveCleanupCreationContext(f.root), null);
  assert.equal(beginE2eCleanupCreation(f.root).complete({}).state, 'protected');
  const session = f.producer.beginE2eBuild({ VITE_PRIVATE_VALUE: 'do-not-store' });
  assert.equal(session.complete({}).state, 'protected');
  assert.ok(!JSON.stringify(f.producer.inventory()).includes('do-not-store'));
  const entry = f.producer.createFixture({ template }),
    original = path.join(f.root, entry.relative);
  chmodSync(path.join(original, 'fixture/config.json'), 0o644);
  assert.equal((await f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced })).handedOff.length, 0);
  assert.ok(existsSync(original));
});
test('producer transfer recovery survives removal of its original task worktree', async (t) => {
  const f = fixture(t);
  f.producer.createFixture({ template });
  const first = await f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced });
  rmSync(f.root, { recursive: true });
  const params = {
    root: f.root,
    common: f.common,
    task: 'created-task',
    proof: f.proof,
    assertUnreferenced: unreferenced,
  };
  assert.equal((await handoffCreatedArtifacts(params)).handedOff[0].key, first.handedOff[0].key);
  assert.equal((await f.queue.run({ ...ready, apply: true })).processed[0].state, 'cleaned');
  assert.equal((await handoffCreatedArtifacts(params)).handedOff[0].state, 'cleaned');
  assert.ok(existsSync(f.common));
});
test('externally created source capsules stay explicitly inventoried when the task carrier disappears', async (t) => {
  const f = fixture(t),
    entry = f.producer.createSourceCopy({ sourceHead: f.proof.head });
  rmSync(f.root, { recursive: true });
  const params = {
    root: f.root,
    common: f.common,
    task: 'created-task',
    proof: f.proof,
    assertUnreferenced: unreferenced,
  };
  assert.equal(readCreatedArtifactInventory(params).artifacts[0].source, entry.source);
  assert.ok(existsSync(entry.source));
  assert.equal((await handoffCreatedArtifacts(params)).handedOff.length, 1);
  assert.equal((await f.queue.run({ ...ready, apply: true })).processed[0].state, 'cleaned');
});
test('concurrent producer transfer preserves the owner lock and referenced content', async (t) => {
  const f = fixture(t);
  f.producer.createFixture({ template });
  let release;
  const gate = new Promise((r) => {
      release = r;
    }),
    running = f.producer.handoff({ proof: f.proof, assertUnreferenced: async () => gate });
  await assert.rejects(f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced }), /EEXIST/);
  release();
  await running;
  assert.equal(readdirSync(path.join(f.common, 'task-cleanup/created/created-task')).includes('handoff.lock'), false);
  const other = f.producer.createFixture({ template }),
    dir = path.join(f.root, other.relative);
  const result = await f.producer.handoff({
    proof: f.proof,
    assertUnreferenced: async () => {
      throw Error('live reference');
    },
  });
  assert.ok(result.protected.some((p) => p.relative === other.relative));
  assert.ok(existsSync(dir));
});
test('failed queue publication keeps the exact moving journal and resumes without making a second copy', async (t) => {
  const f = fixture(t),
    entry = f.producer.createFixture({ template });
  const { createCleanupArtifactProducer } = await import('./task-cleanup-created-artifacts.mjs');
  const failed = createCleanupArtifactProducer(f.root, {
    context: f.context,
    queueApi: {
      handoff: () => {
        throw Error('isolated publish interrupted');
      },
    },
  });
  await assert.rejects(failed.handoff({ proof: f.proof, assertUnreferenced: unreferenced }), /publish interrupted/);
  assert.equal(f.producer.inventory()[0].state, 'moving');
  assert.ok(!existsSync(entry.source));
  const recovered = await f.producer.handoff({ proof: f.proof, assertUnreferenced: unreferenced });
  assert.equal(recovered.handedOff.length, 1);
  assert.equal(f.producer.inventory()[0].state, 'staged');
  assert.equal((await f.queue.run({ ...ready, apply: true })).processed[0].state, 'cleaned');
});
