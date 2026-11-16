import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { cleanupIdentity, cleanupObjectId, createCleanupQueue, safePath } from './task-cleanup-queue.mjs';
import {
  E2E_CLEANUP_DIRECTORY,
  CREATED_CLEANUP_DIRECTORY,
  FIXTURE_TEMPLATE_DIRECTORY,
  cleanupDataDigest,
  cleanupJsonDigest,
  cleanupRelative,
  cleanupGitTree,
  cleanupRegularSources,
  gitBlobDigest,
  e2eCleanupInput,
  renderCleanupFixture,
  validateCleanupTypeRegistration,
  validateCleanupTypeContent,
  validateCleanupExpectedTree,
  e2eArtifactDigest,
} from './task-cleanup-types.mjs';

const read = (file) => {
  safePath(file);
  const s = lstatSync(file);
  assert.ok(s.isFile() && s.nlink === 1 && !(s.mode & 0o077));
  return JSON.parse(readFileSync(file));
};
const save = (file, value, immutable = false) => {
  safePath(file);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const bytes = JSON.stringify(value) + '\n';
  if (immutable) {
    if (existsSync(file)) {
      assert.equal(readFileSync(file, 'utf8'), bytes, 'Immutable artifact record differs');
      return;
    }
    const fd = openSync(file, 'wx', 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return;
  }
  const temp = file + '.' + randomUUID();
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
};
export function resolveCleanupCreationContext(root) {
  root = realpathSync(root);
  const file = path.join(root, '.task-runtime/task-artifacts.json');
  if (!existsSync(file)) return null; // No inferred task, preview owner or historical directory discovery.
  const artifact = read(file);
  assert.equal(artifact.version, 1);
  assert.equal(artifact.ready, true);
  assert.equal(artifact.worktree, root);
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id: artifact.task });
  assert.equal(task.worktree, root);
  assert.equal(task.branch, artifact.branch);
  if (task.stage === 'closed') return null;
  return { root, common: registry.commonDir, task };
}
function captureE2eInputs(root) {
  const result = execFileSync('git', [
    '--no-replace-objects',
    '-C',
    root,
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  const files = result.toString().split('\0').filter(Boolean);
  for (const name of readdirSync(root)) if (/^\.env(?:\.|$)/.test(name)) files.push(name);
  return [...new Set(files)]
    .filter(e2eCleanupInput)
    .filter((file) => existsSync(path.join(root, file)))
    .map((file) => {
      cleanupRelative(file);
      const target = path.join(root, file);
      safePath(target);
      const s = lstatSync(target);
      assert.ok(s.isFile() && s.nlink === 1, 'Build source is not a private regular file');
      return { path: file, mode: s.mode & 0o111 ? '100755' : '100644', blob: gitBlobDigest(readFileSync(target)) };
    })
    .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
}
function boundedSourceCopy(common, inputs, target) {
  const request = Buffer.from(inputs.map((e) => e.blob).join('\n') + '\n');
  const checked = execFileSync('git', ['--no-replace-objects', '--git-dir', common, 'cat-file', '--batch-check'], {
    input: request,
    maxBuffer: 16 * 1024 ** 2,
  });
  const rows = checked.toString().trim().split('\n');
  assert.equal(rows.length, inputs.length);
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const [oid, type, size] = rows[i].split(' ');
    assert.equal(oid, inputs[i].blob);
    assert.equal(type, 'blob');
    assert.ok(Number.isSafeInteger(Number(size)));
    total += Number(size);
  }
  assert.ok(total <= 128 * 1024 ** 2, 'Source copy exceeds bounded known-content creator; retain rather than truncate');
  const output = execFileSync('git', ['--no-replace-objects', '--git-dir', common, 'cat-file', '--batch'], {
    input: request,
    maxBuffer: 192 * 1024 ** 2,
  });
  let offset = 0;
  for (const entry of inputs) {
    const end = output.indexOf(10, offset);
    assert.ok(end >= offset);
    const [oid, type, length] = output.subarray(offset, end).toString().split(' '),
      size = Number(length);
    assert.equal(oid, entry.blob);
    assert.equal(type, 'blob');
    assert.ok(Number.isSafeInteger(size));
    offset = end + 1;
    const bytes = output.subarray(offset, offset + size);
    assert.equal(bytes.length, size);
    const file = path.join(target, entry.path);
    safePath(path.dirname(file));
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, bytes, { mode: entry.mode === '100755' ? 0o700 : 0o600, flag: 'wx' });
    offset += size;
    assert.equal(output[offset++], 10);
  }
  assert.equal(offset, output.length);
}

export function createCleanupArtifactProducer(root, { context, queueApi, recoveryOnly = false } = {}) {
  if (context === undefined) context = resolveCleanupCreationContext(root);
  assert.ok(context, 'Explicit task-owned artifact preparation required');
  root = recoveryOnly ? path.resolve(root) : realpathSync(root);
  assert.equal(context.root, root);
  assert.equal(context.task.worktree, root);
  assert.match(context.task.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const { common, task } = context,
    base = path.join(common, 'task-cleanup/created', task.id),
    indexFile = path.join(base, 'index.json');
  safePath(base);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  assert.equal(lstatSync(base).mode & 0o077, 0);
  function locked(operation) {
    const lock = path.join(base, 'write.lock');
    safePath(lock);
    mkdirSync(lock, { mode: 0o700 });
    const owner = { pid: process.pid, token: randomUUID() };
    save(path.join(lock, 'owner.json'), owner);
    try {
      const index = existsSync(indexFile) ? read(indexFile) : { version: 1, task: task.id, entries: {} };
      assert.equal(index.version, 1);
      assert.equal(index.task, task.id);
      return operation(index);
    } finally {
      assert.deepEqual(read(path.join(lock, 'owner.json')), owner);
      unlinkSync(path.join(lock, 'owner.json'));
      rmdirSync(lock);
    }
  }
  function intent(kind, relative, source = path.join(root, relative)) {
    assert.equal(recoveryOnly, false, 'Recovered producer cannot create or reclassify assets');
    cleanupRelative(relative);
    const id = randomUUID();
    locked((index) => {
      for (const entry of Object.values(index.entries))
        if (entry.relative === relative) {
          assert.ok(
            !['creating', 'moving'].includes(entry.state),
            'An exact artifact creation/transfer is still in progress',
          );
          if (entry.state === 'ready')
            Object.assign(entry, {
              state: 'superseded',
              reason: 'Superseded by a later explicit generation; no deletion claimed',
            });
        }
      index.entries[id] = { id, kind, relative, source, state: 'creating', createdAt: new Date().toISOString() };
      save(indexFile, index);
    });
    return id;
  }
  function protect(id, reason) {
    return locked((index) => {
      const entry = index.entries[id];
      assert.ok(entry);
      assert.ok(!['moving', 'staged'].includes(entry.state));
      Object.assign(entry, { state: 'protected', reason: String(reason).slice(0, 4096) });
      save(indexFile, index);
      return { ...entry };
    });
  }
  function finish(id, registration) {
    const bytes = JSON.stringify(registration) + '\n',
      digest = cleanupDataDigest(bytes),
      file = path.join(common, 'task-cleanup/proofs', task.id, digest + '.json');
    save(file, registration, true);
    return locked((index) => {
      const entry = index.entries[id];
      assert.equal(entry.state, 'creating');
      Object.assign(entry, { state: 'ready', registration: file, digest });
      save(indexFile, index);
      return { ...entry };
    });
  }
  const commonRegistration = (relative, identity, sourceInputs, producer) => ({
    version: 1,
    task: task.id,
    worktree: root,
    relative,
    identity,
    sourceInputs,
    sourceDigest: cleanupJsonDigest(sourceInputs),
    producer,
  });
  function createFixture({ template, seed = randomBytes(16).toString('hex') }) {
    assert.ok(template.startsWith(FIXTURE_TEMPLATE_DIRECTORY));
    cleanupRelative(template);
    const source = path.join(root, template);
    safePath(source);
    const s = lstatSync(source);
    assert.ok(s.isFile() && s.nlink === 1 && s.size <= 1024 ** 2);
    const bytes = readFileSync(source),
      files = renderCleanupFixture(JSON.parse(bytes), seed),
      relative = CREATED_CLEANUP_DIRECTORY + '/fixture/' + randomUUID(),
      id = intent('generated-fixture-v1', relative);
    const target = path.join(root, relative);
    try {
      safePath(target);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      mkdirSync(target, { mode: 0o700 });
      for (const [name, entry] of files) {
        const file = path.join(target, name);
        safePath(path.dirname(file));
        mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(file, entry.bytes, { mode: 0o600, flag: 'wx' });
      }
      validateCleanupExpectedTree(files, target);
      assert.equal(
        gitBlobDigest(readFileSync(source)),
        gitBlobDigest(bytes),
        'Fixture template changed during creation',
      );
      return finish(id, {
        ...commonRegistration(
          relative,
          cleanupIdentity(target),
          [{ path: template, mode: s.mode & 0o111 ? '100755' : '100644', blob: gitBlobDigest(bytes) }],
          'explicit-fixture-creator-v1',
        ),
        recipe: { version: 1, template, templateBlob: gitBlobDigest(bytes), seed },
      });
    } catch (error) {
      protect(id, error.message);
      throw error;
    }
  }
  function createSourceCopy({ sourceHead }) {
    const inputs = cleanupRegularSources(cleanupGitTree(common, sourceHead));
    assert.ok(inputs.length > 0 && inputs.length < 100000);
    const nonce = randomUUID(),
      relative = CREATED_CLEANUP_DIRECTORY + '/source/' + nonce,
      target = path.join(common, 'task-cleanup/created-sources', task.id, nonce, 'content'),
      id = intent('git-source-copy-v1', relative, target);
    try {
      safePath(target);
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      mkdirSync(target, { mode: 0o700 });
      boundedSourceCopy(common, inputs, target);
      validateCleanupExpectedTree(new Map(inputs.map((e) => [e.path, e])), target);
      return finish(id, {
        ...commonRegistration(relative, cleanupIdentity(target), inputs, 'exact-git-copy-creator-v1'),
        externalSource: target,
        recipe: { version: 1, sourceHead },
      });
    } catch (error) {
      protect(id, error.message);
      throw error;
    }
  }
  function beginE2eBuild(env = process.env) {
    const id = intent('e2e-test-build-v1', E2E_CLEANUP_DIRECTORY);
    let inputs, unsafe;
    try {
      assert.ok(
        !Object.keys(env).some((key) => key.startsWith('VITE_') && env[key]),
        'Unrecorded VITE environment input; preserve output',
      );
      assert.ok(
        !env.NODE_OPTIONS && !env.ZDM_TASK_PREVIEW && (!env.NODE_ENV || env.NODE_ENV === 'production'),
        'Unproven build environment; preserve output',
      );
      inputs = captureE2eInputs(root);
    } catch (error) {
      unsafe = String(error.message);
      protect(id, unsafe);
    }
    return {
      fail: (reason) => {
        if (!unsafe) return protect(id, reason);
      },
      complete: (proof) => {
        if (unsafe) return { state: 'protected', reason: unsafe };
        try {
          assert.deepEqual(captureE2eInputs(root), inputs, 'Build inputs changed during generation');
          assert.equal(
            e2eArtifactDigest(path.join(root, E2E_CLEANUP_DIRECTORY)),
            proof.artifact,
            'Build proof no longer matches exact artifact',
          );
          return finish(id, {
            ...commonRegistration(
              E2E_CLEANUP_DIRECTORY,
              cleanupIdentity(path.join(root, E2E_CLEANUP_DIRECTORY)),
              inputs,
              'e2e-build-success-v1',
            ),
            command: ['node', 'node_modules/vite/bin/vite.js', 'build', '--config', 'vite.e2e.config.mjs'],
            exitCode: 0,
            buildProof: proof,
          });
        } catch (error) {
          return protect(id, error.message);
        }
      },
    };
  }
  function inventory() {
    return locked((index) => structuredClone(Object.values(index.entries)));
  }
  async function handoff({ proof, assertUnreferenced }) {
    assert.equal(proof.worktree, root);
    assert.equal(typeof assertUnreferenced, 'function');
    const lock = path.join(base, 'handoff.lock');
    safePath(lock);
    mkdirSync(lock, { mode: 0o700 });
    const owner = { pid: process.pid, token: randomUUID() };
    save(path.join(lock, 'owner.json'), owner);
    try {
      const handedOff = [],
        retained = [];
      for (const entry of inventory()) {
        if (!['ready', 'moving', 'staged'].includes(entry.state)) {
          retained.push({
            relative: entry.relative,
            source: entry.source,
            kind: entry.kind,
            state: entry.state,
            reason: entry.reason ?? entry.state,
          });
          continue;
        }
        const registration = read(entry.registration),
          bytes = readFileSync(entry.registration);
        assert.equal(cleanupDataDigest(bytes), entry.digest);
        assert.equal(registration.task, task.id);
        assert.equal(registration.worktree, root);
        const record = entry.record ?? {
          version: 1,
          task: task.id,
          identity: registration.identity,
          producer: 'task-completion-handoff-v1',
          disposition: 'rebuildable',
          notBefore: entry.createdAt,
          proof: {
            ...proof,
            rebuild: {
              kind: entry.kind,
              record: path.join(common, 'task-cleanup/proofs', task.id, entry.digest + '.json'),
              digest: entry.digest,
            },
          },
        };
        assert.deepEqual(record.proof, { ...proof, rebuild: record.proof.rebuild }, 'Frozen handoff proof changed');
        const key = cleanupObjectId(record),
          carrier = path.join(common, 'task-cleanup/staging', task.id, key),
          source = registration.externalSource ?? path.join(root, registration.relative);
        assert.equal(entry.source, source, 'Creator index source differs from its immutable proof');
        Object.assign(record, { carrier, path: path.join(carrier, 'content') });
        try {
          validateCleanupTypeRegistration(record, registration, common);
          if (entry.state === 'staged') {
            const result = (queueApi ?? createCleanupQueue(common)).handoff(record);
            handedOff.push({
              id: entry.id,
              key,
              object: key,
              kind: entry.kind,
              relative: entry.relative,
              source,
              manifest: path.join(carrier, 'manifest.json'),
              registration: entry.registration,
              state: result.state,
            });
            continue;
          }
          if (existsSync(source)) {
            assert.ok(!existsSync(record.path), 'Ambiguous artifact source and staging');
            assert.deepEqual(cleanupIdentity(source), registration.identity);
            validateCleanupTypeContent(record, registration, source, common);
            await assertUnreferenced({ ...record, path: source });
            assert.deepEqual(cleanupIdentity(source), registration.identity);
            save(record.proof.rebuild.record, registration, true);
            safePath(carrier);
            mkdirSync(carrier, { recursive: true, mode: 0o700 });
            save(path.join(carrier, 'manifest.json'), record, true);
            locked((index) => {
              index.entries[entry.id] = { ...index.entries[entry.id], state: 'moving', record };
              save(indexFile, index);
            });
            renameSync(source, record.path);
          } else assert.ok(existsSync(record.path), 'No proven artifact remains; absence is not reclaimed space');
          const result = (queueApi ?? createCleanupQueue(common)).handoff(record);
          locked((index) => {
            index.entries[entry.id] = { ...index.entries[entry.id], state: 'staged', record };
            save(indexFile, index);
          });
          handedOff.push({
            id: entry.id,
            key,
            object: key,
            kind: entry.kind,
            relative: entry.relative,
            source,
            manifest: path.join(carrier, 'manifest.json'),
            registration: entry.registration,
            state: result.state,
          });
        } catch (error) {
          const current = locked((index) => structuredClone(index.entries[entry.id]));
          if (current.state === 'ready' && existsSync(source)) {
            retained.push({
              relative: entry.relative,
              source,
              kind: entry.kind,
              state: 'protected',
              reason: error.message,
            });
            continue;
          }
          throw error; // Interrupted move remains journaled; do not close over an uncertain transfer.
        }
      }
      return { registered: true, handedOff, protected: retained };
    } finally {
      assert.deepEqual(read(path.join(lock, 'owner.json')), owner);
      unlinkSync(path.join(lock, 'owner.json'));
      rmdirSync(lock);
    }
  }
  return { createFixture, createSourceCopy, beginE2eBuild, inventory, handoff, protect };
}
export async function handoffCreatedArtifacts({ root, common, task, proof, assertUnreferenced }, { api } = {}) {
  const taskId = typeof task === 'string' ? task : task.id;
  assert.match(taskId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const index = path.join(common, 'task-cleanup/created', taskId, 'index.json');
  safePath(index);
  if (!existsSync(index)) return { registered: false, handedOff: [], protected: [] };
  return createCleanupArtifactProducer(root, {
    context: { root, common, task: { id: taskId, worktree: root } },
    queueApi: api,
    recoveryOnly: true,
  }).handoff({ proof, assertUnreferenced });
}
export function readCreatedArtifactInventory({ root, common, task }) {
  const taskId = typeof task === 'string' ? task : task.id;
  assert.match(taskId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const file = path.join(common, 'task-cleanup/created', taskId, 'index.json');
  safePath(file);
  if (!existsSync(file)) return { registered: false, index: file, artifacts: [] };
  const index = read(file);
  assert.equal(index.version, 1);
  assert.equal(index.task, taskId);
  const artifacts = Object.values(index.entries).map((entry) => {
    cleanupRelative(entry.relative);
    assert.ok(['e2e-test-build-v1', 'generated-fixture-v1', 'git-source-copy-v1'].includes(entry.kind));
    const expected =
      entry.kind === 'git-source-copy-v1'
        ? path.join(common, 'task-cleanup/created-sources', taskId, path.posix.basename(entry.relative), 'content')
        : path.join(root, entry.relative);
    assert.equal(entry.source, expected, 'Foreign creator inventory path');
    const object = entry.record ? cleanupObjectId(entry.record) : null;
    return {
      id: entry.id,
      kind: entry.kind,
      relative: entry.relative,
      source: entry.source,
      state: entry.state,
      registration: entry.registration ?? null,
      object,
      manifest: object ? path.join(common, 'task-cleanup/staging', taskId, object, 'manifest.json') : null,
      ...(entry.reason ? { reason: entry.reason } : {}),
      existence: 'not-probed',
    };
  });
  return { registered: true, index: file, artifacts };
}
export function beginE2eCleanupCreation(root, { context, env = process.env } = {}) {
  if (context === undefined) context = resolveCleanupCreationContext(root);
  if (!context)
    return { complete: () => ({ state: 'protected', reason: 'No exact task-owned creation context' }), fail: () => {} };
  return createCleanupArtifactProducer(root, { context }).beginE2eBuild(env);
}
