import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import path from 'node:path';
import { captureSource } from './verification-evidence.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (file) => {
  assert.equal(path.resolve(file), file, 'Canonical absolute path required');
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked handoff path refused');
    if (cursor === path.dirname(cursor)) break;
  }
  return file;
};
function directory(file) {
  canonical(file);
  if (!existsSync(file)) {
    if (!existsSync(path.dirname(file))) directory(path.dirname(file));
    mkdirSync(file, { mode: 0o700 });
  }
  assert.ok(lstatSync(file).isDirectory() && (lstatSync(file).mode & 0o077) === 0, 'Handoff store must be owner-only');
  return file;
}
function immutable(file, content) {
  canonical(file);
  if (existsSync(file)) {
    assert.ok(lstatSync(file).isFile() && (lstatSync(file).mode & 0o077) === 0, 'Unsafe handoff record');
    assert.equal(readFileSync(file, 'utf8'), content, 'Immutable handoff record changed');
  } else {
    const fd = openSync(file, 'wx', 0o600);
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
const loadConsumer = () => import('./task-cleanup-queue.mjs');
const registrationFile = (root) => path.join(root, '.task-runtime/cleanup-dist.json');

// Called only by the Vite wrapper after a successful real build and unchanged inputs.
// An ordinary directory name or a user-supplied safe flag can never register an object.
export async function registerBuiltDist(root, sourceDigest, { api, capture = captureSource } = {}) {
  root = realpathSync(root);
  const artifact = path.join(root, '.task-runtime/task-artifacts.json');
  if (!existsSync(artifact)) return { state: 'retained', reason: 'No task-owned artifact registration' };
  canonical(artifact);
  const task = JSON.parse(readFileSync(artifact, 'utf8'));
  assert.equal(task.ready, true);
  assert.equal(task.worktree, root);
  assert.match(task.task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(capture(root).digest, sourceDigest, 'Build inputs changed; retain original outputs');
  api ??= await loadConsumer();
  const identity = api.cleanupIdentity(path.join(root, 'dist'));
  const record = {
    version: 1,
    task: task.task,
    worktree: root,
    relative: 'dist',
    identity,
    sourceDigest,
    producer: 'vite-build-success-v1',
    command: ['npm', 'run', 'build:app'],
    exitCode: 0,
  };
  const file = registrationFile(root);
  canonical(file);
  // This is the latest generated-object index. Each accepted copy is later made immutable.
  const temporary = file + '.' + randomUUID();
  immutable(temporary, JSON.stringify(record) + '\n');
  renameSync(temporary, file);
  return { state: 'registered', file, record };
}

export async function handoffBuiltDist(
  { root, common, task, proof, assertUnreferenced },
  { api, capture = captureSource } = {},
) {
  root = canonical(path.resolve(root));
  common = canonical(path.resolve(common));
  assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  for (const field of ['head', 'accepted', 'main']) assert.match(proof[field] ?? '', /^[a-f0-9]{40}$/);
  assert.equal(proof.worktree, root);
  assert.equal(typeof assertUnreferenced, 'function');
  const file = registrationFile(root),
    intent = path.join(root, '.task-runtime/cleanup-dist-handoff.json');
  if (!existsSync(file) && !existsSync(intent))
    return { state: 'retained', reason: 'No creation-time rebuild proof; existing preservation applies' };
  api ??= await loadConsumer();
  const queue = api.createCleanupQueue(common);
  let record;
  if (existsSync(intent)) {
    canonical(intent);
    record = JSON.parse(readFileSync(intent, 'utf8'));
    assert.equal(record.task, task);
    assert.equal(record.proof.worktree, root);
    for (const field of ['head', 'accepted', 'main'])
      assert.equal(record.proof[field], proof[field], 'Interrupted handoff delivery identity changed');
  } else {
    canonical(file);
    const content = readFileSync(file, 'utf8'),
      registration = JSON.parse(content);
    assert.equal(registration.version, 1);
    assert.equal(registration.task, task);
    assert.equal(registration.worktree, root);
    assert.equal(registration.relative, 'dist');
    assert.equal(registration.producer, 'vite-build-success-v1');
    assert.deepEqual(registration.command, ['npm', 'run', 'build:app']);
    assert.equal(registration.exitCode, 0);
    if (capture(root).digest !== registration.sourceDigest)
      return { state: 'retained', reason: 'Build source changed; preserve output and registration' };
    assert.deepEqual(
      api.cleanupIdentity(path.join(root, 'dist')),
      registration.identity,
      'Build output changed after creation; retain',
    );
    await assertUnreferenced();
    assert.deepEqual(
      api.cleanupIdentity(path.join(root, 'dist')),
      registration.identity,
      'Build output changed during reference check',
    );
    const base = directory(path.join(common, 'task-cleanup'));
    const proofs = directory(path.join(base, 'proofs', task));
    const stable = path.join(proofs, sha(content) + '.json');
    immutable(stable, content);
    const candidate = {
      version: 1,
      task,
      identity: registration.identity,
      producer: 'task-completion-handoff-v1',
      proof: { ...proof, rebuild: { kind: 'vite-dist-v1', record: stable, digest: sha(content) } },
      disposition: 'rebuildable',
      notBefore: new Date().toISOString(),
    };
    const carrier = path.join(base, 'staging', task, api.cleanupObjectId(candidate));
    record = { ...candidate, carrier, path: path.join(carrier, 'content') };
    immutable(intent, JSON.stringify(record) + '\n');
  }
  directory(record.carrier);
  immutable(path.join(record.carrier, 'manifest.json'), JSON.stringify(record) + '\n');
  const source = path.join(root, 'dist');
  canonical(record.proof.rebuild.record);
  const rebuild = JSON.parse(readFileSync(record.proof.rebuild.record, 'utf8'));
  assert.equal(capture(root).digest, rebuild.sourceDigest, 'Source changed after build registration');
  assert.ok(!(existsSync(source) && existsSync(record.path)), 'Ambiguous handoff objects; retain both');
  if (existsSync(source)) {
    assert.deepEqual(api.cleanupIdentity(source), record.identity, 'Output changed before move');
    await assertUnreferenced();
    assert.equal(capture(root).digest, rebuild.sourceDigest, 'Source changed during reference check');
    assert.deepEqual(api.cleanupIdentity(source), record.identity, 'Output changed during reference check');
    renameSync(source, record.path);
  }
  assert.deepEqual(api.cleanupIdentity(record.path), record.identity, 'Moved object identity changed');
  const accepted = queue.handoff(record);
  return {
    state: 'handed-off',
    manifest: path.join(record.carrier, 'manifest.json'),
    object: accepted.key,
    cleanupPending: true,
  };
}
