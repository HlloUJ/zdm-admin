import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerBuiltDist, handoffBuiltDist } from './task-cleanup-handoff.mjs';
import { buildTaskApp } from './build-task-app.mjs';
const sha = (value) => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'producer-handoff-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'task'),
    common = path.join(base, 'common');
  mkdirSync(root);
  mkdirSync(common);
  mkdirSync(path.join(root, '.task-runtime'), { mode: 0o700 });
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist/app.js'), 'generated');
  const task = 'fixture-task',
    proof = { worktree: root, head: 'a'.repeat(40), accepted: 'b'.repeat(40), main: 'c'.repeat(40) };
  writeFileSync(
    path.join(root, '.task-runtime/task-artifacts.json'),
    JSON.stringify({ ready: true, task, worktree: root }),
  );
  let source = 'd'.repeat(64),
    fail = false,
    calls = 0;
  const capture = () => ({ digest: source });
  // A small injected consumer exercises producer state transitions. Full identity/deletion
  // safety belongs to task-cleanup-queue tests and the composed integration suite.
  const api = {
    cleanupIdentity: (file) => {
      const stat = lstatSync(file);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      return {
        dev: String(stat.dev),
        ino: String(stat.ino),
        fingerprint: sha(readFileSync(path.join(file, 'app.js'))),
        bytes: readFileSync(path.join(file, 'app.js')).length,
      };
    },
    cleanupObjectId: (r) =>
      sha(JSON.stringify({ task: r.task, identity: r.identity, producer: r.producer, proof: r.proof })),
    createCleanupQueue: () => ({
      handoff: (r) => {
        calls++;
        if (fail) throw Error('fixture queue unavailable');
        assert.deepEqual(JSON.parse(readFileSync(path.join(r.carrier, 'manifest.json'), 'utf8')), r);
        return { ...r, key: api.cleanupObjectId(r), state: 'pending' };
      },
    }),
  };
  return {
    root,
    common,
    task,
    proof,
    api,
    capture,
    source,
    register: () => registerBuiltDist(root, source, { api, capture }),
    handoff: (assertUnreferenced = async () => {}) =>
      handoffBuiltDist({ root, common, task, proof, assertUnreferenced }, { api, capture }),
    changeSource: () => (source = 'e'.repeat(64)),
    failQueue: () => (fail = true),
    recoverQueue: () => (fail = false),
    calls: () => calls,
  };
}
test('creation-time proof seals a known successful build and never adopts an arbitrary directory', async (t) => {
  const f = fixture(t);
  assert.equal((await f.handoff()).state, 'retained');
  assert.equal(f.calls(), 0);
  const registered = await f.register();
  assert.equal(registered.state, 'registered');
  assert.equal(registered.record.relative, 'dist');
  f.changeSource();
  await assert.rejects(registerBuiltDist(f.root, f.source, { api: f.api, capture: f.capture }), /Build inputs changed/);
  assert.equal((await f.handoff()).state, 'retained');
  assert.ok(existsSync(path.join(f.root, 'dist/app.js')));
});
test('unchanged output is durably moved to exact stable carrier and immutable handoff replays', async (t) => {
  const f = fixture(t);
  await f.register();
  const result = await f.handoff();
  assert.equal(result.state, 'handed-off');
  assert.equal(existsSync(path.join(f.root, 'dist')), false);
  const record = JSON.parse(readFileSync(result.manifest, 'utf8'));
  assert.equal(record.path, path.join(record.carrier, 'content'));
  assert.equal(readFileSync(path.join(record.path, 'app.js'), 'utf8'), 'generated');
  assert.equal(lstatSync(record.carrier).mode & 0o077, 0);
  assert.equal(sha(readFileSync(record.proof.rebuild.record)), record.proof.rebuild.digest);
  assert.deepEqual(await f.handoff(), result);
});
test('changed outputs, changed source during references and active references retain originals', async (t) => {
  const f = fixture(t);
  await f.register();
  await assert.rejects(
    f.handoff(async () => {
      throw Error('still referenced');
    }),
    /still referenced/,
  );
  assert.ok(existsSync(path.join(f.root, 'dist/app.js')));
  await assert.rejects(
    f.handoff(async () => f.changeSource()),
    /Source changed/,
  );
  assert.ok(existsSync(path.join(f.root, 'dist/app.js')));
  const g = fixture(t);
  await g.register();
  writeFileSync(path.join(g.root, 'dist/app.js'), 'unique changed content');
  await assert.rejects(g.handoff(), /output changed/);
  assert.ok(existsSync(path.join(g.root, 'dist/app.js')));
});
test('queue failure preserves stable object and intent; resume completes exact original handoff', async (t) => {
  const f = fixture(t);
  await f.register();
  f.failQueue();
  await assert.rejects(f.handoff(), /queue unavailable/);
  assert.equal(existsSync(path.join(f.root, 'dist')), false);
  const record = JSON.parse(readFileSync(path.join(f.root, '.task-runtime/cleanup-dist-handoff.json'), 'utf8'));
  assert.ok(existsSync(record.path));
  f.recoverQueue();
  assert.equal((await f.handoff()).state, 'handed-off');
  assert.ok(existsSync(record.path));
  f.proof.main = 'f'.repeat(40);
  await assert.rejects(f.handoff(), /delivery identity changed/);
});
test('build wrapper propagates real failure and only registers unchanged successful output', async () => {
  let registered = 0;
  for (const code of [1, 0]) {
    let invoked = false;
    assert.equal(
      await buildTaskApp('/fixture', {
        hasTaskArtifacts: () => true,
        capture: () => ({ digest: 'same' }),
        execute: (command, args) => {
          invoked = true;
          assert.equal(command, process.execPath);
          assert.deepEqual(args.slice(1), ['build', '--configLoader', 'runner']);
          return { status: code };
        },
        register: () => registered++,
      }),
      code,
    );
    assert.ok(invoked);
  }
  assert.equal(registered, 1);
  let captures = 0;
  await assert.rejects(
    buildTaskApp('/fixture', {
      hasTaskArtifacts: () => true,
      capture: () => ({ digest: String(captures++) }),
      execute: () => ({ status: 0 }),
      register: () => assert.fail('changed build cannot register'),
    }),
    /Build inputs changed/,
  );
});

test('CI or retained checkout without task registration builds without Git identity or cleanup imports', async () => {
  assert.equal(
    await buildTaskApp('/fixture', {
      execute: () => ({ status: 0 }),
      hasTaskArtifacts: () => false,
      capture: () => assert.fail('ordinary CI build must retain shallow checkout behavior'),
      register: () => assert.fail('unowned output cannot register'),
    }),
    0,
  );
});
