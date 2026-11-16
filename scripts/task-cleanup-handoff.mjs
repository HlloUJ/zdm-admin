import { readCreatedArtifactInventory } from './task-cleanup-created-artifacts.mjs';
import { buildCloseoutCleanupInventory } from './task-cleanup-inventory.mjs';
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
  readlinkSync,
  readdirSync,
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
  assert.equal(task.version, 1, 'Unknown task-owned artifact registration');
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

// The whole closeout manifest records protected and unsupported types too. This
// is not a deletion permit and does not claim the entire cleanup rollout is done.
export function recordCloseoutCleanupInventory({
  root,
  common,
  task,
  proof,
  preserved,
  distHandoff,
  reportHandoffs = [],
  createdHandoffs = { registered: false, handedOff: [], protected: [] },
}) {
  const expected = path.join(common, 'task-assets', task);
  assert.equal(path.dirname(preserved.manifest), expected, 'Foreign asset preservation manifest');
  canonical(preserved.manifest);
  const bytes = readFileSync(preserved.manifest),
    digest = sha(bytes);
  assert.equal(path.basename(preserved.manifest), 'assets-' + digest + '.json', 'Preservation manifest changed');
  const artifactsFile = path.join(root, '.task-runtime/task-artifacts.json');
  const artifacts = existsSync(artifactsFile) ? JSON.parse(readFileSync(canonical(artifactsFile), 'utf8')) : null;
  const modules = path.join(root, 'node_modules');
  const externalDependencyTarget =
    existsSync(modules) && lstatSync(modules).isSymbolicLink() ? path.resolve(root, readlinkSync(modules)) : null;
  const inventory = buildCloseoutCleanupInventory({
    root,
    common,
    task,
    proof,
    preserved,
    manifestDigest: digest,
    entries: JSON.parse(bytes),
    artifacts,
    distHandoff,
    reportHandoffs,
    createdArtifacts: readCreatedArtifactInventory({ root, common, task }),
    createdHandoffs,
    externalDependencyTarget,
  });
  const content = JSON.stringify(inventory) + '\n';
  const store = directory(path.join(common, 'task-cleanup', 'handoffs', task));
  const file = path.join(store, proof.main + '-' + sha(content) + '.json');
  immutable(file, content);
  return {
    state: 'inventory-handed-off',
    manifest: file,
    resources: inventory.resources.length,
    gaps: inventory.gaps,
    implementationComplete: inventory.implementationComplete,
    spaceReleased: false,
  };
}

// Only extra copies whose whole file closure is already preserved can be handed off.
// Necessary stable blobs, first failures and .task-verification control state stay retained.
export async function handoffPreservedReportCopies(
  { root, common, task, proof, preserved, assertUnreferenced },
  { api } = {},
) {
  root = canonical(path.resolve(root));
  common = canonical(path.resolve(common));
  assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(proof.worktree, root);
  for (const field of ['head', 'accepted', 'main']) assert.match(proof[field] ?? '', /^[a-f0-9]{40}$/);
  assert.equal(path.dirname(preserved.manifest), path.join(common, 'task-assets', task));
  canonical(preserved.manifest);
  const raw = readFileSync(preserved.manifest),
    digest = sha(raw);
  assert.equal(path.basename(preserved.manifest), 'assets-' + digest + '.json');
  const original = JSON.parse(raw);
  assert.ok(Array.isArray(original));
  api ??= await loadConsumer();
  const queue = api.createCleanupQueue(common),
    results = [];
  for (const relative of ['test-results', 'playwright-report', 'coverage']) {
    const source = path.join(root, relative),
      intent = path.join(root, '.task-runtime', 'cleanup-preserved-' + relative + '.json');
    let record;
    if (existsSync(intent)) {
      record = JSON.parse(readFileSync(canonical(intent), 'utf8'));
      assert.equal(record.task, task);
      for (const field of ['worktree', 'head', 'accepted', 'main'])
        assert.equal(record.proof[field], proof[field], 'Interrupted report handoff identity changed');
    } else {
      if (!existsSync(source)) continue;
      canonical(source);
      const identity = api.cleanupIdentity(source),
        files = [];
      const expected = original.filter((entry) => entry.file.startsWith(relative + '/'));
      assert.ok(expected.length, 'Report directory has no complete preservation proof');
      assert.equal(new Set(expected.map((entry) => entry.file)).size, expected.length);
      const walk = (directory) => {
        for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
          const name = directory + '/' + entry.name,
            file = path.join(root, name),
            stat = lstatSync(file);
          assert.ok(
            (!stat.isSymbolicLink() && stat.nlink === 1) || stat.isDirectory(),
            'Linked report copy remains protected',
          );
          if (stat.isDirectory()) walk(name);
          else {
            assert.ok(stat.isFile(), 'Special report copy remains protected');
            const archived = expected.find((item) => item.file === name);
            assert.ok(archived && archived.kind === 'generated-output', 'Unpreserved report member');
            const bytes = readFileSync(file),
              blob = path.join(common, 'task-assets', task, 'blobs', archived.digest);
            canonical(blob);
            assert.ok(lstatSync(blob).isFile() && !lstatSync(blob).isSymbolicLink());
            assert.equal(bytes.length, archived.bytes);
            assert.equal(sha(bytes), archived.digest);
            assert.equal(sha(readFileSync(blob)), archived.digest, 'Preserved report changed');
            files.push({ relative: name, blob, mode: stat.mode, sha256: archived.digest });
          }
        }
      };
      walk(relative);
      files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
      assert.deepEqual(
        files.map((item) => item.relative),
        expected.map((item) => item.file).sort(),
        'Incomplete report preservation closure',
      );
      assert.deepEqual(api.cleanupIdentity(source), identity, 'Report changed during preservation proof');
      await assertUnreferenced();
      assert.deepEqual(api.cleanupIdentity(source), identity, 'Report changed during reference proof');
      const registration = {
        version: 1,
        task,
        worktree: root,
        relative,
        identity,
        sourceDigest: digest,
        producer: 'preserved-report-duplicate-v1',
        preservation: { manifest: preserved.manifest, digest, files },
      };
      const content = JSON.stringify(registration) + '\n',
        base = directory(path.join(common, 'task-cleanup')),
        stable = path.join(directory(path.join(base, 'proofs', task)), sha(content) + '.json');
      immutable(stable, content);
      const candidate = {
        version: 1,
        task,
        identity,
        producer: 'task-completion-handoff-v1',
        proof: { ...proof, rebuild: { kind: 'duplicate-preserved-v1', record: stable, digest: sha(content) } },
        disposition: 'preserved-duplicate',
        notBefore: new Date().toISOString(),
      };
      const carrier = path.join(base, 'staging', task, api.cleanupObjectId(candidate));
      record = { ...candidate, carrier, path: path.join(carrier, 'content') };
      immutable(intent, JSON.stringify(record) + '\n');
    }
    directory(record.carrier);
    immutable(path.join(record.carrier, 'manifest.json'), JSON.stringify(record) + '\n');
    assert.ok(!(existsSync(source) && existsSync(record.path)), 'Ambiguous report handoff; keep both');
    if (existsSync(source)) {
      assert.deepEqual(api.cleanupIdentity(source), record.identity);
      await assertUnreferenced();
      assert.deepEqual(api.cleanupIdentity(source), record.identity);
      renameSync(source, record.path);
    }
    assert.deepEqual(api.cleanupIdentity(record.path), record.identity);
    const accepted = queue.handoff(record);
    results.push({
      relative,
      state: 'handed-off',
      manifest: path.join(record.carrier, 'manifest.json'),
      object: accepted.key,
      cleanupPending: true,
      spaceReleased: false,
    });
  }
  return results;
}
