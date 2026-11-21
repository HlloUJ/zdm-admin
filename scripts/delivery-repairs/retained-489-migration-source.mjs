import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { assertCompletionQuality } from '../completion-ci-evidence.mjs';
import { taskProjectName } from '../dev-task.mjs';
import { withIntegrationResource } from '../integration-resource.mjs';
import { readPreviewResponse } from '../preview-consumers.mjs';
import { createResourceLeases } from '../resource-lease.mjs';
import { withPreviewDataLease } from '../runtime-resource.mjs';
import { previewDataFile, previewDataRoot, readTaskData, rootSql } from '../task-data-environment.mjs';
import { assertTaskExecutor, taskExecutor } from '../task-execution-binding.mjs';
import { createTaskRegistry } from '../task-registry.mjs';
import { taskBackendContainerIdentity, taskBackendSourceIdentity } from '../task-runtime-state.mjs';
import { observedHostMountPath } from './preview-reference-proof-core.mjs';
import { referenceFileStat, referenceHash, regularReferenceFile } from './preview-reference-history.mjs';
import { readReferenceBackendHealth } from './preview-reference-proof.mjs';

const taskId = 'finished-stock-selection-log-copy';
const releaseId = 'retained-489-migration-source-recovery';
const migrationHead = '3c43eeccead07c3d028887aec35d2182870c8363';
const migrationCount = 168;
const migrationPath = 'backend/src/main/resources/db/migration';
const previewPort = 5177;
const backendPort = 8082;
const source = fileURLToPath(import.meta.url);
const loadedSource = referenceHash(regularReferenceFile(source).bytes);
const relativeSource = 'scripts/delivery-repairs/retained-489-migration-source.mjs';
const sha256 = /^[a-f0-9]{64}$/;
const migrationName = /^V(\d+)__[A-Za-z0-9_]+\.sql$/;
const directoryInputs = ['backend/src/main', 'backend/pom.xml', 'backend/.mvn', '.mvn', 'pom.xml'];

function run(command, args, encoding = 'utf8') {
  try {
    return execFileSync(command, args, {
      encoding,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    throw new Error('Cannot verify retained runtime with ' + command);
  }
}
const git = (root, ...args) => run('git', ['--no-optional-locks', '--no-replace-objects', '-C', root, ...args]);
const gitLine = (root, ...args) => git(root, ...args).trim();
const docker = (...args) => run('docker', args).trim();
const jsonHash = (entry) => referenceHash(JSON.stringify(entry));
const file = (entry) => lstatSync(entry, { throwIfNoEntry: false });
const json = (entry) => JSON.parse(regularReferenceFile(entry).bytes);

function directoryIdentity(directory) {
  assert.equal(realpathSync(directory), directory, 'Linked recovery directory');
  const stat = lstatSync(directory, { bigint: true });
  assert.ok(stat.isDirectory() && stat.uid === BigInt(process.getuid()) && (stat.mode & 0o022n) === 0n);
  return [String(stat.dev), String(stat.ino)];
}

function fileIdentity(entry) {
  const { ino, dev, size, ctimeMs, mtimeMs } = referenceFileStat(entry);
  return { ino, dev, size, ctimeMs, mtimeMs };
}

function writeAtomic(destination, bytes, { replace = false, mode = 0o600, staging = path.dirname(destination) } = {}) {
  // Put the temporary file beside the destination for rename, or one level
  // above the bind mount for migration files so MySQL never sees a temp input.
  const temporary = path.join(staging, '.retained-migration-' + randomUUID());
  writeFileSync(temporary, bytes, { flag: 'wx', mode, flush: true });
  try {
    if (replace) renameSync(temporary, destination);
    else linkSync(temporary, destination);
  } finally {
    if (file(temporary)) unlinkSync(temporary);
  }
}
function journal(file, value) {
  writeAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

export function flywayChecksum(bytes) {
  // Flyway reads UTF-8 lines, strips the leading BOM, and stores signed CRC32.
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return crc32(text.replaceAll(/[\r\n]/g, '')) | 0;
}

export function verifiedMigrationCatalog(entries, history, count) {
  assert.equal(entries.length, count, 'Unexpected retained Git migration count');
  const migrations = new Map();
  const versions = new Set();
  for (const { name, bytes } of entries) {
    const match = migrationName.exec(name);
    assert.ok(match && Buffer.isBuffer(bytes), 'Unknown migration input');
    const version = String(BigInt(match[1]));
    assert.ok(!migrations.has(name) && !versions.has(version), 'Duplicate migration version or file');
    versions.add(version);
    migrations.set(name, { bytes, version, digest: referenceHash(bytes), checksum: flywayChecksum(bytes) });
  }
  const applied = history.split('\n');
  assert.equal(applied.length, count, 'Flyway history does not cover the exact migration set');
  const seen = new Set();
  for (const row of applied) {
    const columns = row.split('\t');
    assert.equal(columns.length, 5, 'Unexpected Flyway history row');
    const [version, name, checksum, type, success] = columns;
    const expected = migrations.get(name);
    assert.ok(expected && !seen.has(name), 'Duplicate or unknown applied migration');
    assert.match(version, /^\d+$/);
    assert.equal(String(BigInt(version)), expected.version, 'Applied Flyway version mismatch');
    assert.equal(checksum, String(expected.checksum), 'Applied Flyway checksum mismatch');
    assert.equal(type, 'SQL');
    assert.equal(success, '1');
    seen.add(name);
  }
  return migrations;
}

function readMigrationTree(root) {
  const tree = migrationHead + ':' + migrationPath;
  return git(root, 'ls-tree', '-z', tree)
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/s.exec(entry);
      assert.ok(match && migrationName.test(match[2]), 'Retained migration tree contains an unsupported object');
      return {
        name: match[2],
        bytes: run('git', ['--no-replace-objects', '-C', root, 'cat-file', 'blob', match[1]], 'buffer'),
      };
    });
}

function verifyMigrationDirectory(directory, catalog) {
  const entries = readdirSync(directory).sort();
  for (const name of entries) {
    const expected = catalog.get(name);
    assert.ok(expected, 'Unexpected file in the retained migration mount');
    assert.deepEqual(
      regularReferenceFile(path.join(directory, name)).bytes,
      expected.bytes,
      'Retained migration bytes differ',
    );
  }
  return entries;
}

function restoreMigrationDirectory(directory, identity, catalog) {
  const present = new Set(verifyMigrationDirectory(directory, catalog));
  for (const [name, { bytes }] of catalog) {
    if (present.has(name)) continue;
    assert.deepEqual(directoryIdentity(directory), identity, 'Migration mount was replaced');
    writeAtomic(path.join(directory, name), bytes, { mode: 0o644, staging: path.dirname(directory) });
  }
  assert.equal(verifyMigrationDirectory(directory, catalog).length, catalog.size);
  assert.deepEqual(directoryIdentity(directory), identity, 'Migration mount was replaced');
}

function publication(anchor, common) {
  assert.equal(realpathSync(source), path.join(anchor, relativeSource), 'Use the canonical published recovery entry');
  const main = gitLine(anchor, 'rev-parse', 'HEAD');
  assert.equal(gitLine(anchor, 'branch', '--show-current'), 'main');
  assert.equal(gitLine(anchor, 'rev-parse', 'refs/remotes/origin/main'), main);
  assert.equal(gitLine(anchor, 'ls-remote', '--heads', 'origin', 'refs/heads/main'), main + '\trefs/heads/main');
  assert.equal(gitLine(anchor, 'status', '--porcelain'), '', 'Published main is dirty');
  const session = json(path.join(common, 'task-delivery', releaseId, 'completion-session.json'));
  assert.equal(session.version, 1);
  assert.equal(session.batch, releaseId);
  const merged = session.events.find((event) => event.name === 'merge' && event.status === 'success');
  const released = merged?.result?.sha;
  assert.ok(/^[a-f0-9]{40}$/.test(released ?? ''), 'Recovery publication merge evidence required');
  const attempt = session.events.find(
    (event) => event.name === 'ci' && event.status === 'success' && event.result?.headSha === released,
  );
  assert.equal(attempt?.result?.branch, 'main');
  assert.equal(attempt?.result?.eventName, 'push');
  assertCompletionQuality(attempt.result, released, attempt.result.runId);
  git(anchor, 'merge-base', '--is-ancestor', released, main);
  const blob = gitLine(anchor, 'rev-parse', released + ':' + relativeSource);
  assert.equal(
    gitLine(anchor, 'hash-object', '--no-filters', source),
    blob,
    'Recovery source changed since reviewed publication',
  );
  assert.equal(referenceHash(regularReferenceFile(source).bytes), loadedSource, 'Loaded recovery entry changed');
  return { main, released, blob, runId: String(attempt.result.runId) };
}

function dockerEndpoint() {
  const endpoint =
    process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
      ? process.env.DOCKER_HOST
      : JSON.parse(docker('context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'));
  assert.match(endpoint, /^unix:\/\//, 'Only the existing local Docker socket is supported');
  const socket = realpathSync(endpoint.slice('unix://'.length));
  assert.ok(lstatSync(socket).isSocket());
  return socket;
}

function retainedContainer(project) {
  const ids = docker(
    'ps',
    '-q',
    '--no-trunc',
    '--filter',
    'label=com.docker.compose.project=' + project,
    '--filter',
    'label=com.docker.compose.service=backend',
  ).split('\n');
  assert.equal(ids.length, 1, 'One exact retained Compose backend required');
  assert.match(ids[0], sha256);
  const result = JSON.parse(docker('inspect', '--type', 'container', ids[0]));
  assert.equal(result.length, 1);
  assert.equal(result[0].Id, ids[0]);
  return result[0];
}

function containerInputs(containerId, catalog, names = [...catalog.keys()]) {
  const items = docker(
    'exec',
    containerId,
    'sh',
    '-ec',
    'cd /task-migrations\nfind . -mindepth 1 -maxdepth 1 -print\nfind . -mindepth 1 -maxdepth 1 -exec sha256sum -- {} +',
  )
    .split('\n')
    .filter(Boolean);
  assert.equal(items.length, names.length * 2, 'Mounted migration inventory differs inside container');
  assert.deepEqual(items.slice(0, names.length).sort(), names.map((name) => './' + name).sort());
  assert.deepEqual(
    items.slice(names.length).sort(),
    names.map((name) => catalog.get(name).digest + '  ./' + name).sort(),
  );
}

async function requireHealthy() {
  const frontend = await readPreviewResponse('http://127.0.0.1:' + previewPort + '/__zdm_task_preview__');
  assert.equal(frontend.statusCode, 0);
  assert.equal(frontend.errorCode, 'ECONNREFUSED', 'Original retained frontend is not closed');
  const backend = await readReferenceBackendHealth('http://127.0.0.1:' + backendPort + '/actuator/health');
  assert.equal(backend.statusCode, 200);
  assert.equal(JSON.parse(backend.body).status, 'UP', 'Retained backend is not healthy');
}

async function recover(anchor, registry, task, data, project, release, signal) {
  const root = task.worktree;
  const common = registry.commonDir;
  const runtime = path.join(root, '.task-runtime');
  const registration = path.join(runtime, 'backend-state.json');
  const journalParent = path.join(common, 'task-delivery', taskId);
  const journalDirectory = path.join(journalParent, 'retained-489-migration-recovery');
  const leasePath = path.join(common, 'task-registry/resource-leases', 'temporary-port-' + previewPort, 'owner.json');
  const leases = createResourceLeases(common);
  const endpoint = dockerEndpoint();
  const migrationDirectory = path.join(realpathSync(tmpdir()), 'zdm-task-preview', project, 'migrations');
  directoryIdentity(path.dirname(migrationDirectory));
  directoryIdentity(runtime);
  assert.match(data.database, /^zdm_task_[a-f0-9]{16}$/);
  const dataFile = previewDataFile(root);
  const readHistory = () =>
    rootSql(
      'START TRANSACTION READ ONLY;\n' +
        'SELECT version,script,checksum,type,success FROM `' +
        data.database +
        '`.flyway_schema_history ORDER BY installed_rank;\nCOMMIT;',
    );
  const applied = readHistory();
  const catalog = verifiedMigrationCatalog(readMigrationTree(anchor), applied, migrationCount);
  const catalogDigest = jsonHash(
    [...catalog].map(([name, { version, digest, checksum }]) => [name, version, digest, checksum]),
  );
  const readBinding = () => {
    assert.equal(dockerEndpoint(), endpoint);
    assert.deepEqual(registry.readTask(taskId), task, 'Original task registration changed');
    assert.equal(gitLine(root, 'rev-parse', 'HEAD'), migrationHead);
    assert.equal(gitLine(root, 'branch', '--show-current'), task.branch);
    assert.equal(gitLine(root, 'status', '--porcelain'), '', 'Original task source changed');
    assert.equal(
      gitLine(root, 'status', '--porcelain', '--ignored=matching', '--untracked-files=all', '--', ...directoryInputs),
      '',
      'Untracked backend runtime input',
    );
    assert.equal(file(path.join(previewDataRoot(root), 'update.json')), undefined, 'Task data update is in progress');
    assert.deepEqual(readTaskData(root), data, 'Task data binding changed');
    const lease = leases.inspect('temporary-port-' + previewPort);
    assert.equal(lease?.task, taskId);
    assert.ok(typeof lease.token === 'string' && lease.token && Number.isSafeInteger(lease.pid) && lease.pid > 1);
    assert.throws(() => process.kill(lease.pid, 0), { code: 'ESRCH' }, 'Retained frontend PID is active or reused');
    const container = retainedContainer(project);
    assert.ok(container.Config.Env?.includes('SPRING_FLYWAY_LOCATIONS=filesystem:/task-migrations'));
    const mounts = container.Mounts.filter((m) => m.Destination === '/task-migrations');
    assert.equal(mounts.length, 1);
    const mounted = observedHostMountPath(mounts[0].Source, process.platform);
    assert.ok(!lstatSync(mounted).isSymbolicLink());
    assert.equal(realpathSync(mounted), migrationDirectory);
    const containerIdentity = taskBackendContainerIdentity(container, {
      root,
      project,
      backendPort,
      migrationDirectory,
      database: data.database,
      username: data.username,
      mediaVolume: data.mediaVolume,
    });
    assert.ok(sha256.test(containerIdentity ?? ''), 'Retained backend configuration, mount or port mismatch');
    const mountedVolumes = container.Mounts.filter((m) => m.Type === 'volume')
      .map((m) => m.Name)
      .sort();
    const volumes = JSON.parse(docker('volume', 'inspect', ...mountedVolumes));
    assert.deepEqual(volumes.map((v) => v.Name).sort(), mountedVolumes);
    const backup = fileIdentity(data.backupFile);
    assert.ok(backup.size > 0, 'Original backup is missing or empty');
    return {
      task: taskId,
      executor: taskExecutor(task),
      head: migrationHead,
      registry: jsonHash(task),
      container: container.Id,
      startedAt: container.State.StartedAt,
      containerIdentity,
      endpoint,
      lease: { bytes: referenceHash(regularReferenceFile(leasePath).bytes), identity: fileIdentity(leasePath) },
      migrationDirectory,
      mount: directoryIdentity(migrationDirectory),
      assets: { registration: referenceHash(regularReferenceFile(dataFile).bytes), backup, volumes: jsonHash(volumes) },
      catalog: catalogDigest,
      history: referenceHash(applied),
    };
  };
  const binding = readBinding();
  containerInputs(binding.container, catalog, verifyMigrationDirectory(migrationDirectory, catalog));
  await requireHealthy();
  assert.deepEqual(readBinding(), binding);
  signal.throwIfAborted();
  directoryIdentity(path.dirname(journalParent));
  if (!file(journalParent)) mkdirSync(journalParent, { mode: 0o700 });
  directoryIdentity(journalParent);
  assert.equal(lstatSync(journalParent).mode & 0o077, 0, 'Recovery evidence must be private');

  return recoverMigrationInputs({
    registration,
    journalDirectory,
    binding,
    catalog,
    release,
    signal,
    readSourceIdentity: () => taskBackendSourceIdentity({ root, migrationDirectory }),
    verifyLiveMount: async () => {
      containerInputs(binding.container, catalog);
      await requireHealthy();
      assert.equal(readHistory(), applied, 'Flyway history changed during recovery');
      assert.deepEqual(readBinding(), binding);
      assert.equal(gitLine(anchor, 'rev-parse', 'HEAD'), release.main);
      assert.equal(referenceHash(regularReferenceFile(source).bytes), loadedSource);
    },
  });
}

export async function recoverMigrationInputs({
  registration,
  journalDirectory,
  binding,
  catalog,
  release,
  signal,
  readSourceIdentity,
  verifyLiveMount,
}) {
  const intentFile = path.join(journalDirectory, 'intent.json');
  const nextFile = path.join(journalDirectory, 'registration.json');
  const receiptFile = path.join(journalDirectory, 'receipt.json');
  if (!file(journalDirectory)) mkdirSync(journalDirectory, { mode: 0o700 });
  directoryIdentity(journalDirectory);
  assert.equal(lstatSync(journalDirectory).mode & 0o077, 0, 'Recovery journal must be owner-only');
  const current = regularReferenceFile(registration).bytes;
  const resuming = Boolean(file(intentFile));
  const intent = resuming
    ? json(intentFile)
    : { version: 1, release, binding, originalRegistration: current.toString('base64') };
  assert.equal(intent.version, 1);
  assert.deepEqual(intent.binding, binding, 'Original recovery binding changed');
  const original = Buffer.from(intent.originalRegistration, 'base64');
  const originalState = JSON.parse(original);
  assert.equal(originalState.version, 1);
  assert.equal(originalState.containerIdentity, binding.containerIdentity, 'Retained backend registration differs');
  assert.match(originalState.configurationIdentity, sha256);
  assert.match(originalState.sourceIdentity, sha256);
  if (!resuming) {
    assert.deepEqual(
      verifyMigrationDirectory(binding.migrationDirectory, catalog),
      [],
      'First recovery requires the original empty mount',
    );
    assert.equal(file(nextFile), undefined);
    assert.equal(file(receiptFile), undefined);
    assert.notEqual(
      originalState.sourceIdentity,
      readSourceIdentity(),
      'Missing migration inputs were already recorded',
    );
    journal(intentFile, intent);
  }
  const next = file(nextFile) ? json(nextFile) : null;
  const recordedBytes = next ? Buffer.from(JSON.stringify(next.registration) + '\n') : null;
  assert.ok(
    current.equals(original) || (recordedBytes && current.equals(recordedBytes)),
    'Backend registration changed outside recovery',
  );
  if (next) assert.equal(next.intent, jsonHash(intent));
  if (next || file(receiptFile))
    assert.equal(
      verifyMigrationDirectory(binding.migrationDirectory, catalog).length,
      catalog.size,
      'Previously verified inputs changed',
    );
  else restoreMigrationDirectory(binding.migrationDirectory, binding.mount, catalog);
  const record = { ...originalState, sourceIdentity: readSourceIdentity() };
  await verifyLiveMount();
  assert.equal(readSourceIdentity(), record.sourceIdentity, 'Restored source changed during verification');
  signal.throwIfAborted();

  const planned = { version: 1, intent: jsonHash(intent), registration: record };
  if (next) assert.deepEqual(planned, next, 'Interrupted registration no longer matches verified source');
  else journal(nextFile, planned);
  const value = Buffer.from(JSON.stringify(record) + '\n');
  assert.deepEqual(regularReferenceFile(registration).bytes, current, 'Backend registration changed during recovery');
  if (current.equals(original)) writeAtomic(registration, value, { replace: true });
  assert.deepEqual(regularReferenceFile(registration).bytes, value);
  const result = {
    version: 1,
    task: taskId,
    head: migrationHead,
    frontendPort: previewPort,
    backendPort,
    migrations: catalog.size,
    retainedContainer: binding.container,
    intent: planned.intent,
    registration: referenceHash(value),
  };
  if (file(receiptFile)) assert.deepEqual(json(receiptFile), result, 'Original recovery receipt differs');
  else journal(receiptFile, result);
  return { ...result, receipt: receiptFile };
}

async function main(args, signal) {
  assert.equal(args.length, 0, 'Recovery takes no arguments and only applies to the original 489 runtime');
  const anchor = path.resolve(path.dirname(source), '../..');
  const registry = createTaskRegistry(anchor);
  const task = registry.readTask(taskId);
  assert.ok(task, 'Original 489 task registration required');
  assertTaskExecutor(task);
  assert.equal(task.recordedHead, migrationHead);
  assert.equal(task.resources.dataScope, 'isolated-task');
  assert.ok(!task.frozen && !task.recovery?.runtimeBlocked && task.stage === 'developing');
  assert.equal(realpathSync(task.worktree), task.worktree);
  const release = publication(anchor, registry.commonDir);
  const data = readTaskData(task.worktree);
  assert.equal(data?.status, 'ready');
  const project = taskProjectName({ root: task.worktree, branch: task.branch });
  const leases = createResourceLeases(registry.commonDir);
  const result = await withIntegrationResource(anchor, task.id, () =>
    leases.run('task-preview-' + task.id, task.id, () =>
      withPreviewDataLease(task.worktree, data, project, backendPort, () =>
        recover(anchor, registry, task, data, project, release, signal),
      ),
    ),
  );
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === source) {
  const stop = new AbortController();
  for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => stop.abort(new Error('Recovery interrupted')));
  try {
    await main(process.argv.slice(2), stop.signal);
  } catch (error) {
    console.error('Retained migration recovery failed: ' + error.message);
    process.exitCode = 1;
  }
}
