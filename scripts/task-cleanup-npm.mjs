import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  realpathSync,
  readdirSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import { cleanupIdentity, cleanupObjectId, createCleanupQueue, safePath } from './task-cleanup-queue.mjs';
import {
  npmDigest,
  npmPackagePath,
  npmIntegrityHex,
  npmPrivatePath,
  npmArchiveFiles,
  verifyNpmPackageTree,
  validateNpmAuditRegistration,
} from './task-cleanup-npm-proof.mjs';

function read(file) {
  const s = npmPrivatePath(file);
  assert.ok(s.isFile() && s.nlink === 1 && !(s.mode & 0o077), 'Private audit metadata required');
  return JSON.parse(readFileSync(file));
}
function saveBytes(file, bytes, immutable = false) {
  safePath(file);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (immutable && existsSync(file)) {
    assert.deepEqual(readFileSync(file), bytes, 'Immutable dependency proof differs');
    return;
  }
  const target = immutable ? file : file + '.' + randomUUID();
  const fd = openSync(target, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!immutable) renameSync(target, file);
}
const save = (file, value, immutable = false) => saveBytes(file, Buffer.from(JSON.stringify(value) + '\n'), immutable);
function store(common, task) {
  assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const base = path.join(common, 'task-cleanup/npm-audits', task);
  safePath(base);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  assert.equal(lstatSync(base).mode & 0o077, 0);
  return { base, index: path.join(base, 'index.json') };
}
function exclusive(base, operation) {
  const lock = path.join(base, 'audit.lock');
  safePath(lock);
  mkdirSync(lock, { mode: 0o700 });
  const owner = { pid: process.pid, token: randomUUID() };
  save(path.join(lock, 'owner.json'), owner);
  const release = () => {
    assert.deepEqual(read(path.join(lock, 'owner.json')), owner);
    unlinkSync(path.join(lock, 'owner.json'));
    rmdirSync(lock);
  };
  try {
    const value = operation();
    if (value?.then) return value.finally(release);
    release();
    return value;
  } catch (error) {
    release();
    throw error;
  }
}
function taskBinding(root, task) {
  root = realpathSync(root);
  const file = path.join(root, '.task-runtime/task-artifacts.json'),
    artifact = read(file);
  assert.equal(artifact.version, 1);
  assert.equal(artifact.ready, true);
  assert.equal(artifact.task, task);
  assert.equal(artifact.worktree, root);
  assert.equal(artifact.dependencies?.status, 'private-validated');
  assert.equal(artifact.dependencies.modules, path.join(root, 'node_modules'));
  const s = npmPrivatePath(artifact.dependencies.modules);
  assert.ok(s.isDirectory());
  const lock = readFileSync(path.join(root, 'package-lock.json'));
  assert.equal(npmDigest(lock), artifact.lockDigest, 'Task dependency lock binding changed');
  return {
    root,
    artifact,
    artifactDigest: npmDigest(readFileSync(file)),
    lock,
    sourceDigest: npmDigest(lock),
    manifestDigest: npmDigest(readFileSync(path.join(root, 'package.json'))),
  };
}
export function dependencyAuditSummary(audit) {
  return {
    auditedPristinePackages: audit.entries?.length ?? 0,
    auditedLogicalBytes: (audit.entries ?? []).reduce((n, e) => n + e.identity.bytes, 0),
    protectedRecords: audit.protected?.length ?? 0,
    protectedLockPackages: (audit.protected ?? []).filter((e) => e.category === 'locked-package').length,
    physicalBytes: null,
  };
}

// Audit existing bytes against a lock-addressed private-cache archive. This is NOT a creation-time receipt.
export function auditPrivateTaskDependencies({ root, common, task }) {
  const binding = taskBinding(root, task),
    { base, index } = store(common, task);
  assert.equal(root, binding.root, 'Canonical task worktree required');
  return exclusive(base, () => {
    const previous = existsSync(index) ? read(index) : null;
    if (previous) {
      assert.equal(previous.task, task);
      assert.equal(previous.worktree, root);
      if (previous.entries.some((e) => ['moving', 'staged'].includes(e.state))) return previous;
    }
    const output = {
      version: 1,
      task,
      worktree: root,
      auditedAt: new Date().toISOString(),
      auditKind: 'independent-archive-audit-v1',
      entries: [],
      protected: [
        {
          relative: 'node_modules/.bin',
          state: 'protected',
          reason: 'Unproved link set retained; no global symlink relaxation',
        },
        {
          relative: '.task-runtime/npm-cache',
          state: 'protected',
          reason: 'Original private cache retained; stable archive evidence is additional',
        },
      ],
    };
    const lock = JSON.parse(binding.lock);
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (name.startsWith('@') && lstatSync(path.join(root, 'node_modules', name)).isDirectory()) {
        for (const child of readdirSync(path.join(root, 'node_modules', name))) {
          const relative = 'node_modules/' + name + '/' + child;
          if (!lock.packages[relative])
            output.protected.push({
              relative,
              state: 'protected',
              reason: 'Unknown member outside exact lock; retained',
            });
        }
      } else if (name !== '.bin' && !lock.packages['node_modules/' + name])
        output.protected.push({
          relative: 'node_modules/' + name,
          state: 'protected',
          reason: 'Root metadata/cache/unknown member retained',
        });
    }
    for (const [relative, item] of Object.entries(lock.packages ?? {})) {
      if (!relative) continue;
      try {
        npmPackagePath(relative);
        assert.ok(!item.link && !item.hasInstallScript, 'Linked/install-script package requires separate proof');
        assert.ok(
          !Object.keys(lock.packages).some((p) => p.startsWith(relative + '/node_modules/')),
          'Nested dependency ownership retained',
        );
        const hex = npmIntegrityHex(item.integrity),
          source = path.join(root, relative);
        const cache = path.join(
          root,
          '.task-runtime/npm-cache/_cacache/content-v2/sha512',
          hex.slice(0, 2),
          hex.slice(2, 4),
          hex.slice(4),
        );
        const stat = npmPrivatePath(cache);
        assert.ok(
          stat.isFile() && stat.nlink === 1 && stat.size <= 64 * 1024 ** 2,
          'Private cache archive missing or shared',
        );
        const bytes = readFileSync(cache),
          files = npmArchiveFiles(bytes, item.integrity);
        const before = cleanupIdentity(source);
        verifyNpmPackageTree(source, files);
        assert.deepEqual(cleanupIdentity(source), before, 'Package changed during independent audit');
        const archive = path.join(common, 'task-cleanup/dependency-archives', task, hex + '.tgz');
        saveBytes(archive, bytes, true);
        const registration = {
          version: 1,
          task,
          worktree: root,
          relative,
          identity: before,
          sourceDigest: binding.sourceDigest,
          producer: 'npm-archive-audit-v1',
          audit: {
            kind: 'independent-archive-audit-v1',
            archive,
            integrity: item.integrity,
            filesDigest: npmDigest(JSON.stringify(files)),
            artifactDigest: binding.artifactDigest,
            manifestDigest: binding.manifestDigest,
            scriptPolicy: 'no-install-scripts-v1',
          },
        };
        const digest = npmDigest(JSON.stringify(registration) + '\n'),
          record = path.join(common, 'task-cleanup/proofs', task, digest + '.json');
        save(record, registration, true);
        output.entries.push({ relative, source, registration: record, digest, state: 'ready', identity: before });
      } catch (error) {
        output.protected.push({
          relative,
          category: 'locked-package',
          state: 'protected',
          reason: String(error.message).slice(0, 4096),
        });
      }
    }
    assert.equal(
      npmDigest(readFileSync(path.join(root, 'package-lock.json'))),
      binding.sourceDigest,
      'Lock changed during independent audit',
    );
    assert.equal(
      npmDigest(readFileSync(path.join(root, '.task-runtime/task-artifacts.json'))),
      binding.artifactDigest,
      'Private task binding changed during audit',
    );
    assert.equal(
      npmDigest(readFileSync(path.join(root, 'package.json'))),
      binding.manifestDigest,
      'Dependency manifest changed during audit',
    );
    Object.assign(output, { summary: dependencyAuditSummary(output) });
    save(index, output);
    return output;
  });
}
// Installer hook: lack of a Git/task context must not infer ownership or alter successful installation semantics.
export function auditInstalledTaskDependencies(task) {
  try {
    const root = task.worktree;
    const common = realpathSync(
      path.resolve(
        root,
        execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim(),
      ),
    );
    return auditPrivateTaskDependencies({ root, common, task: task.id });
  } catch (error) {
    return { state: 'protected', reason: String(error.message).slice(0, 4096) };
  }
}
export function readDependencyCleanupInventory({ root, common, task }) {
  assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const file = path.join(common, 'task-cleanup/npm-audits', task, 'index.json');
  safePath(file);
  if (!existsSync(file))
    return {
      registered: false,
      artifacts: [],
      protected: [{ relative: 'node_modules', state: 'protected', reason: 'No independent package audit registered' }],
    };
  const index = read(file);
  assert.equal(index.version, 1);
  assert.equal(index.task, task);
  assert.equal(index.worktree, root);
  return {
    registered: true,
    index: file,
    artifacts: index.entries.map((entry) => ({
      ...entry,
      ...(entry.lastProtection ? { state: 'protected', reason: entry.lastProtection } : {}),
      existence: 'not-probed',
    })),
    protected: index.protected,
    summary: index.summary,
  };
}
export async function handoffAuditedDependencies({ root, common, task, proof, assertUnreferenced }, { api } = {}) {
  assert.equal(proof.worktree, root);
  assert.equal(typeof assertUnreferenced, 'function');
  const inventory = readDependencyCleanupInventory({ root, common, task });
  if (!inventory.registered) return { ...inventory, handedOff: [] };
  const { base, index } = store(common, task);
  return exclusive(base, async () => {
    const state = read(index),
      handedOff = [],
      retained = [...state.protected];
    for (const entry of state.entries) {
      npmPackagePath(entry.relative);
      assert.equal(entry.source, path.join(root, entry.relative));
      const registration = read(entry.registration);
      assert.equal(npmDigest(readFileSync(entry.registration)), entry.digest);
      assert.equal(registration.relative, entry.relative);
      const record = entry.record ?? {
        version: 1,
        task,
        producer: 'task-completion-handoff-v1',
        disposition: 'rebuildable',
        identity: registration.identity,
        notBefore: state.auditedAt,
        proof: {
          ...proof,
          rebuild: { kind: 'npm-pristine-package-v1', record: entry.registration, digest: entry.digest },
        },
      };
      assert.deepEqual(
        record.proof,
        { ...proof, rebuild: record.proof.rebuild },
        'Dependency delivery identity changed',
      );
      const object = cleanupObjectId(record),
        carrier = path.join(common, 'task-cleanup/staging', task, object);
      Object.assign(record, { carrier, path: path.join(carrier, 'content') });
      try {
        validateNpmAuditRegistration(record, registration, common, { readArchive: false });
        if (entry.state !== 'staged') {
          if (existsSync(entry.source)) {
            assert.ok(!existsSync(record.path), 'Ambiguous dependency source/staging');
            const binding = taskBinding(root, task);
            assert.equal(binding.artifactDigest, registration.audit.artifactDigest);
            assert.equal(
              binding.manifestDigest,
              registration.audit.manifestDigest,
              'Dependency manifest changed after audit',
            );
            assert.deepEqual(
              cleanupIdentity(entry.source),
              registration.identity,
              'Dependency identity changed; retain original',
            );
            await assertUnreferenced({ ...record, path: path.join(root, 'node_modules') });
            assert.deepEqual(
              cleanupIdentity(entry.source),
              registration.identity,
              'Dependency changed during reference probe',
            );
            safePath(carrier);
            mkdirSync(carrier, { recursive: true, mode: 0o700 });
            save(path.join(carrier, 'manifest.json'), record, true);
            delete entry.lastProtection;
            Object.assign(entry, { state: 'moving', record });
            save(index, state);
            renameSync(entry.source, record.path);
          } else assert.ok(existsSync(record.path), 'Missing dependency is not reclaimed space');
        }
        const result = (api ?? createCleanupQueue(common)).handoff(record);
        delete entry.lastProtection;
        Object.assign(entry, { state: 'staged', record });
        save(index, state);
        handedOff.push({
          relative: entry.relative,
          source: entry.source,
          kind: 'npm-pristine-package-v1',
          object,
          manifest: path.join(carrier, 'manifest.json'),
          state: result.state,
        });
      } catch (error) {
        if (entry.state === 'ready' && existsSync(entry.source)) {
          entry.lastProtection = String(error.message).slice(0, 4096);
          save(index, state);
          retained.push({ relative: entry.relative, state: 'protected', reason: error.message });
          continue;
        }
        throw error;
      }
    }
    return {
      registered: true,
      handedOff,
      protected: retained,
      summary: {
        stagedPackages: handedOff.length,
        stagedLogicalBytes: state.entries.filter((e) => e.state === 'staged').reduce((n, e) => n + e.identity.bytes, 0),
        protectedRecords: retained.length,
        physicalBytes: null,
      },
    };
  });
}
