import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createTaskRegistry } from '../task-registry.mjs';
import { taskProjectName } from '../dev-task.mjs';
import { assertTaskExecutor, taskExecutor } from '../task-execution-binding.mjs';
import { createExecutionOrder } from '../task-execution-order.mjs';
import { collectRetainedDockerDirectories } from './preview-docker-directories.mjs';
import { readAcceptance } from '../accepted-source.mjs';
import {
  assertMaintenanceNeighbor,
  readMaintenanceBackend,
  readValidationMaintenance,
  recoveryReceiptFile,
} from './validation-maintenance-lineage.mjs';
import { privateJson } from './validation-recovery-evidence.mjs';
import { captureReassignedClosedPeer } from './validation-closed-peer.mjs';
import { parseWorktreePorcelain } from '../git-workflow-core.mjs';
import {
  assertStoppedPreviewIdentity,
  assertStoppedPreviewRound,
  assertStoppedPreviewPair,
  referenceBackendConsumers,
  observedHostMountPath,
} from './preview-reference-proof-core.mjs';
import {
  readNativePreviewHistory,
  referenceHash,
  regularReferenceFile,
  referenceFileStat,
  verifyPublishedReferenceSnapshot,
} from './preview-reference-history.mjs';
import {
  referenceLoadedFiles,
  referenceCollectorPublication,
  assertReferenceCollectorPublication,
  referencePublishedBaseline,
  assertReferenceHistoricalBaseline,
  assertReferenceConsumerCandidate,
  referenceConsumerSnapshot,
} from './preview-reference-source.mjs';

const VARIABLE = 'ZDM_CLOSED_PREVIEW_REFERENCE';
const contract = 'native-history-live-readonly-preview-reference-v2';
const hash = (value) => referenceHash(JSON.stringify(value));
const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024 * 1024 }).trim();
const git = (root, ...args) => run('git', ['--no-optional-locks', '-C', root, ...args]);
const docker = (...args) => run('docker', args);
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loadedCollectorFiles = referenceLoadedFiles(moduleRoot);
const publishedFiles = [
  'scripts/task-cancellation-proof.mjs',
  'scripts/task-runtime-state.mjs',
  'scripts/task-data-environment.mjs',
  'scripts/dev-task.mjs',
  'scripts/preview-consumers.mjs',
  'scripts/accepted-source.mjs',
];

// Write each obtained observation before checking it. A rejected proof is still
// evidence; its raw rounds must not disappear with the exception. No event is
// overwritten and only the consumer's private namespace is selected below.
export function createReferenceEvidenceJournal(directory) {
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  let sequence = 0;
  return (kind, value) => {
    assert.match(kind, /^[a-z][a-z0-9-]*$/);
    const file = path.join(directory, String(++sequence).padStart(3, '0') + '-' + kind + '.json');
    writeFileSync(file, JSON.stringify({ observedAt: Date.now(), kind, value }, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    return file;
  };
}

// A completed body is not a closed socket. Wait for the actual client socket
// close before the next synchronous OS inventory; do not exempt our own client.
export function readReferenceBackendHealth(url) {
  return new Promise((resolve) => {
    let result;
    const request = http.get(url, { agent: false, timeout: 3000 }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          result = { statusCode: 0, body: '', errorCode: 'RESPONSE_TOO_LARGE' };
          request.destroy();
        } else chunks.push(chunk);
      });
      response.once('end', () => {
        result ??= { statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') };
        request.destroy();
      });
      response.once('error', (error) => {
        result ??= { statusCode: 0, body: '', errorCode: error.code ?? 'RESPONSE_ERROR' };
        request.destroy();
      });
    });
    request.once('socket', (socket) =>
      socket.once('close', () =>
        resolve(result ?? { statusCode: 0, body: '', errorCode: 'SOCKET_CLOSED_WITHOUT_RESPONSE' }),
      ),
    );
    request.once('timeout', () => {
      result ??= { statusCode: 0, body: '', errorCode: 'ETIMEDOUT' };
      request.destroy();
    });
    request.once('error', (error) => {
      result ??= { statusCode: 0, body: '', errorCode: error.code ?? 'NETWORK_ERROR' };
    });
  });
}

export function referenceConsumerAnchor(root, common) {
  const mains = parseWorktreePorcelain(git(root, 'worktree', 'list', '--porcelain')).filter((w) => w.branch === 'main');
  assert.equal(mains.length, 1, 'Exact registered main anchor required');
  const anchor = mains[0].path;
  assert.equal(path.resolve(anchor, git(anchor, 'rev-parse', '--git-common-dir')), common);
  return anchor;
}

function consumerScope(root, id = null, effect = 'final') {
  assert.ok(['preparation', 'final'].includes(effect), 'Exact delivery effect required');
  return frozenConsumerScope(root, id, (registry, task) => {
    const admission = createExecutionOrder(registry.commonDir).assertAdmission({
      lane: 'delivery',
      task: task.id,
      owner: task.owner,
      admission: process.env.ZDM_EXECUTION_ADMISSION,
      effect,
    });
    assert.equal(admission.active, true, 'Read-only reference selection requires an active delivery scope');
  });
}

function frozenConsumerScope(root, id, authorize) {
  const registry = createTaskRegistry(root);
  const task = id ? registry.readTask(id) : registry.resolve({ worktree: root });
  assertTaskExecutor(task, process.env.CODEX_THREAD_ID);
  authorize?.(registry, task);
  assert.ok(task.frozen?.accepted, 'Reference proof requires an existing formal business freeze');
  const accepted = readAcceptance(root, task.id);
  assert.equal(task.frozen.accepted, accepted?.commit, 'Original acceptance ref required');
  assert.equal(task.frozen.tree, accepted.tree, 'Original frozen tree required');
  assert.equal(task.frozen.businessDigest, accepted.businessDigest, 'Original frozen business digest required');
  const anchor = referenceConsumerAnchor(root, registry.commonDir);
  return { registry, task, accepted, anchor };
}

function currentCollector(scope, candidate) {
  return referenceCollectorPublication({
    anchor: scope.anchor,
    common: scope.registry.commonDir,
    task: scope.task,
    candidate,
    moduleRoot,
    loadedFiles: loadedCollectorFiles,
  });
}

async function publishedCore(scope, baseline) {
  const { anchor, registry, task } = scope;
  const directory = path.join(registry.commonDir, 'task-delivery', task.id, 'published-observer', baseline);
  assert.ok(
    existsSync(directory),
    'Host must prepare the exact previously published read-only observer snapshot: ' + directory,
  );
  const observerSource = verifyPublishedReferenceSnapshot(anchor, directory, baseline);
  assert.deepEqual(
    regularReferenceFile(path.join(anchor, 'package-lock.json')).bytes,
    execFileSync('git', ['-C', anchor, 'show', `${baseline}:package-lock.json`]),
    'Published observer dependency contract changed',
  );
  const modules = {};
  for (const file of publishedFiles) {
    modules[file] = await import(pathToFileURL(path.join(directory, file)).href);
  }
  assert.deepEqual(verifyPublishedReferenceSnapshot(anchor, directory, baseline), observerSource);
  modules.observerSource = observerSource;
  return modules;
}

function leaseRecord(common, port) {
  const file = path.join(common, 'task-registry/resource-leases', 'temporary-port-' + port, 'owner.json');
  const { bytes, stat, exactStat } = regularReferenceFile(file);
  return {
    lease: JSON.parse(bytes),
    leaseFile: {
      file,
      digest: referenceHash(bytes),
      inode: String(stat.ino),
      birthtimeMs: stat.birthtimeMs,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      mtimeNs: String(exactStat.mtimeNs),
      ctimeNs: String(exactStat.ctimeNs),
    },
  };
}

async function captureIdentity(scope, selector, core, record, maintenance) {
  const { registry, task: consumer, anchor } = scope;
  const task = registry.readTask(selector.foreignTask);
  assert.notEqual(task.id, consumer.id, 'Stopped-foreign proof cannot replace own shutdown protocol');
  assert.equal(task.resources.dataScope, 'isolated-task');
  assert.ok(!task.recovery?.runtimeBlocked, 'Foreign runtime has unresolved historical ownership');
  assert.equal(git(task.worktree, 'status', '--porcelain'), '', 'Foreign source is not clean');
  const head = git(task.worktree, 'rev-parse', 'HEAD');
  assert.equal(head, task.recordedHead);
  assert.equal(git(task.worktree, 'branch', '--show-current'), task.branch);
  const index = path.resolve(task.worktree, git(task.worktree, 'rev-parse', '--git-path', 'index'));
  assert.ok(!existsSync(index + '.lock'), 'Foreign source index is locked');
  const previews = core['scripts/preview-consumers.mjs'];
  const leases = previews.temporaryPreviewLeases(registry.commonDir).filter((l) => l.task === task.id);
  assert.equal(leases.length, 1, 'One exact historical frontend lease required');
  const port = leases[0].port;
  const retained = leaseRecord(registry.commonDir, port);
  const runtime = core['scripts/task-runtime-state.mjs'];
  const data = core['scripts/task-data-environment.mjs'];
  const profile = data.readTaskData(task.worktree);
  assert.ok(
    profile && !existsSync(path.join(data.previewDataRoot(task.worktree), 'update.json')),
    'Data is missing or protected by an update',
  );
  const project = core['scripts/dev-task.mjs'].taskProjectName({ root: task.worktree, branch: task.branch });
  const ids = docker(
    'ps',
    '-q',
    '--no-trunc',
    '--filter',
    'label=com.docker.compose.project=' + project,
    '--filter',
    'label=com.docker.compose.service=backend',
  )
    .split(/\s+/)
    .filter(Boolean);
  assert.equal(ids.length, 1, 'One exact retained backend required');
  const container = JSON.parse(docker('inspect', ids[0]))[0];
  const migration = container.Mounts.find((m) => m.Destination === '/task-migrations');
  assert.ok(migration?.Source);
  const observedMigrationPath = observedHostMountPath(migration.Source, process.platform);
  assert.ok(existsSync(observedMigrationPath), 'Actual host migration directory is missing');
  const observedMigrationStat = lstatSync(observedMigrationPath, { bigint: true });
  assert.ok(
    observedMigrationStat.isDirectory() && !observedMigrationStat.isSymbolicLink(),
    'Unknown host migration source',
  );
  const migrationDirectory = realpathSync(observedMigrationPath);
  const physicalMigrationStat = lstatSync(migrationDirectory, { bigint: true });
  assert.equal(physicalMigrationStat.dev, observedMigrationStat.dev);
  assert.equal(physicalMigrationStat.ino, observedMigrationStat.ino);
  const bindings = container.HostConfig.PortBindings?.['8080/tcp'];
  assert.equal(bindings?.length, 1);
  const backendPort = Number(bindings[0].HostPort);
  assert.ok(backendPort >= 8081 && backendPort <= 8099 && bindings[0].HostIp === '127.0.0.1');
  const containerIdentity = runtime.taskBackendContainerIdentity(container, {
    root: task.worktree,
    project,
    backendPort,
    migrationDirectory,
    database: profile.database,
    username: profile.username,
    mediaVolume: profile.mediaVolume,
  });
  const backendRecord = regularReferenceFile(path.join(task.worktree, '.task-runtime/backend-state.json'));
  const previous = JSON.parse(backendRecord.bytes);
  record('backend-source-binding', {
    container: { id: container.Id, labels: container.Config.Labels, mounts: container.Mounts },
    mountedMigrationSource: migration.Source,
    observedMigrationPath,
    migrationDirectory,
    recordedContainerIdentity: previous.containerIdentity,
    observedContainerIdentity: containerIdentity,
    recordedSourceIdentity: previous.sourceIdentity,
    observedSourceIdentity: runtime.taskBackendSourceIdentity({ root: task.worktree, migrationDirectory }),
  });
  assert.ok(containerIdentity && previous.version === 1, 'Retained backend identity mismatch');
  if (maintenance) {
    assert.equal(maintenance.backend.containerIdentity, containerIdentity);
    assert.equal(maintenance.backend.recordDigest, referenceHash(backendRecord.bytes));
  } else assert.equal(previous.containerIdentity, containerIdentity, 'Retained backend identity mismatch');
  assert.equal(
    previous.sourceIdentity,
    runtime.taskBackendSourceIdentity({ root: task.worktree, migrationDirectory }),
    'Retained backend source changed',
  );
  const count = data.rootSql(
    `SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='${profile.database}';`,
  );
  const volumes = JSON.parse(docker('volume', 'inspect', profile.mediaVolume));
  const backup = referenceFileStat(profile.backupFile);
  const endpoint =
    process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
      ? process.env.DOCKER_HOST
      : JSON.parse(docker('context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'));
  assert.match(endpoint, /^unix:\/\//);
  const history = readNativePreviewHistory(selector.historyFile, {
    task,
    worker: taskExecutor(task),
    port,
    backendPort,
    anchor: anchor,
    head,
  });
  history.publishedMain = assertReferenceHistoricalBaseline(anchor, selector.publishedBaseline, history.checkedAt);
  const identity = {
    task: task.id,
    executor: taskExecutor(task),
    host: os.hostname(),
    worktree: task.worktree,
    branch: task.branch,
    head,
    registryDigest: hash(task),
    observerSource: core.observerSource,
    indexDigest: referenceHash(regularReferenceFile(index).bytes),
    dockerEndpoint: endpoint,
    port,
    ...retained,
    backendPort,
    history,
    data: {
      status: profile.status,
      database: profile.database,
      mediaVolume: profile.mediaVolume,
      databaseExists: count === '1',
      mediaExists: volumes.length === 1 && volumes[0].Name === profile.mediaVolume,
      backupExists: existsSync(profile.backupFile),
      registrationDigest: referenceHash(regularReferenceFile(data.previewDataFile(task.worktree)).bytes),
      assetDigest: hash(volumes),
      backupIdentity: {
        file: profile.backupFile,
        inode: String(backup.ino),
        size: backup.size,
        mtimeMs: backup.mtimeMs,
        ctimeMs: backup.ctimeMs,
      },
    },
    backend: {
      id: container.Id,
      recordDigest: referenceHash(backendRecord.bytes),
      containerIdentity,
      mountedMigrationSource: migration.Source,
      observedMigrationPath,
      hostMigrationDirectory: migrationDirectory,
      hostMigrationIdentity: {
        device: String(physicalMigrationStat.dev),
        inode: String(physicalMigrationStat.ino),
        mtimeNs: String(physicalMigrationStat.mtimeNs),
        ctimeNs: String(physicalMigrationStat.ctimeNs),
      },
      inventory: { id: container.Id, labels: container.Config.Labels, mounts: container.Mounts },
    },
  };
  record('identity', identity);
  assertStoppedPreviewIdentity(identity);
  return identity;
}

async function observe(identity, scope, core, record, ownClosures, reassignedPeer) {
  const observedAt = Date.now();
  // Mandatory original published implementation, with no exec/env test adapter.
  const inventory = core['scripts/task-cancellation-proof.mjs'].observeCancellationHost();
  record('host-inventory', inventory);
  const retainedDirectoryReferences = collectRetainedDockerDirectories(identity, inventory, record);
  const previews = core['scripts/preview-consumers.mjs'];
  const leases = previews.temporaryPreviewLeases(scope.registry.commonDir);
  const ports = [5175, 5176, ...Array.from({ length: 23 }, (_, i) => 5177 + i)];
  const responses = await Promise.all(
    ports.map(async (port) => ({
      port,
      response: await previews.readPreviewResponse(`http://127.0.0.1:${port}/__zdm_task_preview__`),
    })),
  );
  record('frontend-observations', { leases, responses });
  assert.deepEqual(
    previews.temporaryPreviewLeases(scope.registry.commonDir),
    leases,
    'Preview leases changed during observation',
  );
  const ordinaryResponses = reassignedPeer ? responses.filter((r) => r.port !== reassignedPeer.port) : responses;
  const backendConsumers = referenceBackendConsumers(ordinaryResponses, leases, identity, scope.task.id, ownClosures);
  let reassignedClosed;
  if (reassignedPeer) {
    const { port, ...lease } = leases.find((item) => item.port === reassignedPeer.port) ?? {};
    assert.equal(port, reassignedPeer.port);
    assert.deepEqual(lease, reassignedPeer.lease);
    const { response } = responses.find((r) => r.port === port);
    const health = await readReferenceBackendHealth(`http://127.0.0.1:${reassignedPeer.backendPort}/actuator/health`);
    const status = health.statusCode === 200 ? JSON.parse(health.body).status : null;
    const retained = collectRetainedDockerDirectories(reassignedPeer, inventory, record);
    const reassignedRound = {
      ...inventory,
      host: os.hostname(),
      observedAt,
      observerPid: process.pid,
      wrapperAncestors: [],
      retainedDirectoryReferences: retained,
      frontend: { statusCode: response.statusCode, errorCode: response.errorCode },
      backendHealth: { statusCode: health.statusCode, status },
      backendConsumers: referenceBackendConsumers(
        ordinaryResponses.filter((r) => r.port !== identity.port),
        leases,
        reassignedPeer,
        scope.task.id,
        ownClosures,
      ),
    };
    assertStoppedPreviewRound(reassignedRound, reassignedPeer, Date.now());
    record('reassigned-preview-round', reassignedRound);
    reassignedClosed = { port, lease, retained };
  }
  const response = responses.find((r) => r.port === identity.port).response;
  const health = await readReferenceBackendHealth(`http://127.0.0.1:${identity.backendPort}/actuator/health`);
  let status;
  try {
    status = JSON.parse(health.body).status;
  } catch {
    /* Strict check in core. */
  }
  return {
    ...inventory,
    host: os.hostname(),
    observedAt,
    observerPid: process.pid,
    wrapperAncestors: [],
    retainedDirectoryReferences,
    frontend: { statusCode: response.statusCode, errorCode: response.errorCode },
    backendHealth: { statusCode: health.statusCode, status },
    backendConsumers,
    previewLeases: leases,
    frontendObservations: responses,
    ...(reassignedClosed ? { reassignedClosed } : {}),
  };
}

async function liveProof(scope, selector, expected = null, ownClosures = [], maintenance = null) {
  const parent = path.join(scope.registry.commonDir, 'task-delivery', scope.task.id, 'reference-proofs');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const evidenceDirectory = path.join(parent, 'observation-' + randomUUID());
  const record = createReferenceEvidenceJournal(evidenceDirectory);
  record('started', { selector, consumerTask: scope.task.id, observerPid: process.pid, ownClosures });
  try {
    const core = await publishedCore(scope, selector.publishedBaseline);
    const identity = await captureIdentity(scope, selector, core, record, maintenance);
    if (maintenance?.historicalExpected) assertMaintenanceNeighbor(expected, identity, maintenance);
    else if (expected)
      assert.deepEqual(identity, expected, 'Original lease/registry/source/history/data binding changed');
    const captureReassigned = async () => {
      if (!maintenance?.reassigned) return null;
      const peer = maintenance.reassigned;
      const preview = core['scripts/preview-consumers.mjs'];
      if (!preview.temporaryPreviewLeases(scope.registry.commonDir).some((lease) => lease.port === peer.port))
        return null;
      const response = await preview.readPreviewResponse(`http://127.0.0.1:${peer.port}/__zdm_task_preview__`);
      if (response.statusCode !== 0 || response.errorCode !== 'ECONNREFUSED') return null;
      return captureReassignedClosedPeer(scope, peer, docker);
    };
    const reassigned = await captureReassigned();
    if (reassigned) record('reassigned-preview-identity', reassigned);
    const first = await observe(identity, scope, core, record, ownClosures, reassigned);
    record('round', first);
    assertStoppedPreviewRound(first, identity, Date.now());
    const afterFirst = await captureIdentity(scope, selector, core, record, maintenance);
    assert.deepEqual(afterFirst, identity, 'Identity changed after first full observation');
    assert.deepEqual(await captureReassigned(), reassigned, 'Reassigned preview identity changed');
    const second = await observe(identity, scope, core, record, ownClosures, reassigned);
    record('round', second);
    assertStoppedPreviewRound(second, identity, Date.now());
    const afterSecond = await captureIdentity(scope, selector, core, record, maintenance);
    assertStoppedPreviewPair({ identity, afterFirst, afterSecond, first, second }, Date.now());
    assert.deepEqual(await captureReassigned(), reassigned, 'Reassigned preview identity changed');
    assert.deepEqual(first.reassignedClosed, second.reassignedClosed, 'Reassigned preview observation changed');
    record('accepted', { finishedAt: Date.now() });
    return { identity, rounds: [first, second], finishedAt: Date.now(), evidenceDirectory };
  } catch (error) {
    record('rejected', { name: error.name, message: error.message, stack: error.stack });
    error.message += '\nRead-only observation evidence: ' + evidenceDirectory;
    throw error;
  }
}

// Scope is always created by the ordinary active delivery admission checks.
function stoppedValidationContinuation(scope, foreignTask) {
  const { task, registry, accepted, anchor } = scope;
  const receiptFile = recoveryReceiptFile(registry.commonDir, task);
  if (!existsSync(receiptFile)) return null;
  const { value: receipt } = privateJson(receiptFile);
  const e = receipt.evidence;
  assert.equal(e.task, task.id);
  assert.equal(e.accepted, accepted.commit);
  if (e.foreign.task !== foreignTask) return null;
  assert.equal(e.worker, taskExecutor(task));
  assert.match(e.head, /^[a-f0-9]{40}$/);
  git(anchor, 'merge-base', '--is-ancestor', e.head, task.recordedHead);
  assert.equal(path.dirname(e.archive), path.dirname(path.dirname(receiptFile)));
  assert.equal(privateJson(path.join(e.archive, 'manifest.json')).hash, e.manifestHash);
  const maintenance = readValidationMaintenance(registry.commonDir, task, e);
  assert.equal(receipt.maintenance, maintenance.selectorDigest);
  assert.equal(receipt.startedAt, maintenance.own.live.startedAt);
  assert.equal(receipt.containerRetained, true);
  assert.ok(Date.parse(receipt.stoppedAt) >= Date.parse(receipt.startedAt));
  const observation = path.join(path.dirname(receiptFile), 'observation');
  assert.equal(path.dirname(receipt.intent), observation);
  const intent = privateJson(receipt.intent).value;
  assert.equal(intent.kind, 'stop-intent');
  for (const key of ['evidence', 'maintenance', 'startedAt', 'containerIdentity', 'assets'])
    assert.deepEqual(intent.value[key], receipt[key]);
  const events = readdirSync(observation).filter((file) => /^\d+-stopped\.json$/.test(file));
  assert.equal(events.length, 1, 'Exact stopped validation receipt required');
  const stopped = privateJson(path.join(observation, events[0])).value;
  assert.equal(stopped.kind, 'stopped');
  assert.deepEqual(stopped.value, receipt);

  const neighbor = registry.readTask(foreignTask);
  const containers = JSON.parse(docker('inspect', e.foreign.containerId));
  assert.equal(containers.length, 1);
  const backend = readMaintenanceBackend(containers[0], maintenance.foreign, {
    root: neighbor.worktree,
    project: taskProjectName({ root: neighbor.worktree, branch: neighbor.branch }),
    port: e.foreign.backendPort,
  });
  return { proof: maintenance.foreign, backend, reassigned: maintenance.reassigned };
}

export async function collectPreviewReferenceProof(root, foreignTask, historyFile, options = {}) {
  assert.ok(
    Object.keys(options).every((key) => ['publishedBaseline', 'effect'].includes(key)),
    'No collector/observation adapters',
  );
  const { effect = 'final' } = options;
  const scope = consumerScope(root, null, effect);
  const consumerSource = referenceConsumerSnapshot(scope.task.worktree);
  const candidate = consumerSource.candidate;
  if (effect === 'preparation')
    assert.equal(candidate, scope.task.recordedHead, 'Preparation requires the exact registered candidate');
  assert.equal(
    git(scope.task.worktree, 'status', '--porcelain'),
    '',
    'Commit the complete reviewed collector candidate first',
  );
  const collector = currentCollector(scope, candidate);
  const selector = {
    foreignTask,
    historyFile: path.resolve(historyFile),
    publishedBaseline: referencePublishedBaseline(scope.anchor, options.publishedBaseline),
    collectorCandidate: collector.commit,
  };
  const trusted = await publishedCore(scope, selector.publishedBaseline);
  trusted['scripts/accepted-source.mjs'].assertAcceptedSource(scope.task.worktree, scope.task.id, candidate);
  const maintenance = stoppedValidationContinuation(scope, foreignTask);
  const live = await liveProof(scope, selector, null, [], maintenance);
  assert.deepEqual(stoppedValidationContinuation(scope, foreignTask), maintenance);
  const current = consumerScope(root, scope.task.id, effect);
  assert.deepEqual(current.task, scope.task, 'Consumer registration changed during real observation');
  assert.deepEqual(current.accepted, scope.accepted, 'Frozen source changed during real observation');
  assertReferenceConsumerCandidate(scope.task.worktree, candidate, consumerSource.tree);
  assert.deepEqual(currentCollector(current, candidate), collector, 'Collector source changed during real observation');
  const packet = {
    version: 2,
    contract,
    collector,
    consumer: {
      task: scope.task.id,
      executor: taskExecutor(scope.task),
      worktree: scope.task.worktree,
      common: scope.registry.commonDir,
      candidate,
      recordedHeadAtCapture: scope.task.recordedHead,
      tree: consumerSource.tree,
      accepted: scope.accepted.commit,
    },
    selector,
    ...live,
    observedHost: os.hostname(),
    collectorPid: process.pid,
    mutation: 'none; evidence files in the current delivery namespace only',
  };
  const directory = path.join(
    scope.registry.commonDir,
    'task-delivery',
    scope.task.id,
    'reference-proofs',
    randomUUID(),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'proof.json'),
    bytes = Buffer.from(JSON.stringify(packet, null, 2) + '\n');
  writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return {
    task: scope.task.id,
    candidate,
    foreignTask,
    file,
    digest: referenceHash(bytes),
    rounds: 2,
    counts: live.rounds.map((r) => ({
      processes: r.processes.length,
      files: r.files.length,
      containers: r.containers.length,
    })),
    leasesChanged: false,
    runtimeRecovered: false,
    formalDeliveryComplete: false,
  };
}

function loadSelection(root, file, { task, effect }, resolveScope = consumerScope) {
  const { bytes, stat } = regularReferenceFile(file);
  assert.equal(stat.mode & 0o077, 0, 'Proof must be private');
  const packet = JSON.parse(bytes);
  assert.deepEqual(Object.keys(packet).sort(), [
    'collector',
    'collectorPid',
    'consumer',
    'contract',
    'evidenceDirectory',
    'finishedAt',
    'identity',
    'mutation',
    'observedHost',
    'rounds',
    'selector',
    'version',
  ]);
  assert.equal(packet.version, 2);
  assert.equal(packet.contract, contract);
  assert.deepEqual(Object.keys(packet.consumer).sort(), [
    'accepted',
    'candidate',
    'common',
    'executor',
    'recordedHeadAtCapture',
    'task',
    'tree',
    'worktree',
  ]);
  assert.deepEqual(Object.keys(packet.selector).sort(), [
    'collectorCandidate',
    'foreignTask',
    'historyFile',
    'publishedBaseline',
  ]);
  assert.equal(packet.selector.collectorCandidate, packet.collector.commit);
  assertStoppedPreviewIdentity(packet.identity);
  assert.ok(Number.isFinite(packet.finishedAt) && packet.finishedAt <= Date.now());
  assert.equal(packet.observedHost, os.hostname());
  assert.equal(packet.rounds.length, 2);
  for (const round of packet.rounds) {
    assert.equal(round.observerPid, packet.collectorPid);
    assertStoppedPreviewRound(round, packet.identity, packet.finishedAt);
  }
  assert.equal(packet.consumer.task, task, 'Reference proof belongs to a different task');
  const scope = resolveScope(root, task, effect);
  assertReferenceCollectorPublication(scope.anchor, packet.consumer, packet.collector);
  assert.equal(packet.consumer.executor, taskExecutor(scope.task));
  assert.equal(packet.consumer.common, scope.registry.commonDir);
  assert.equal(packet.consumer.worktree, scope.task.worktree);
  assert.equal(packet.consumer.accepted, scope.accepted.commit);
  assert.ok(
    [packet.consumer.candidate, packet.consumer.recordedHeadAtCapture].includes(scope.task.recordedHead),
    'Consumer recorded source changed',
  );
  if (effect === 'preparation')
    assert.equal(
      packet.consumer.candidate,
      scope.task.recordedHead,
      'Reference proof requires the current registered candidate',
    );
  if (existsSync(scope.task.worktree)) {
    assertReferenceConsumerCandidate(scope.task.worktree, packet.consumer.candidate, packet.consumer.tree);
  }
  assert.equal(git(root, 'rev-parse', packet.consumer.candidate + '^{tree}'), packet.consumer.tree);
  assert.ok(
    path
      .resolve(file)
      .startsWith(path.join(scope.registry.commonDir, 'task-delivery', scope.task.id, 'reference-proofs') + path.sep),
  );
  const collector = currentCollector(scope, packet.consumer.candidate);
  return { scope, packet, collector, digest: referenceHash(bytes), file: path.resolve(file) };
}

// Evidence only. The recovery command supplies the exact preserved packet;
// a caller never receives an activation selector or a general delivery effect.
export async function observeInterruptedValidationReferences(root, task, file, digest, maintenance) {
  const scope = frozenConsumerScope(root, task);
  assert.equal(root, scope.task.worktree);
  const resolveScope = (worktree, id) => frozenConsumerScope(worktree, id);
  const loaded = loadSelection(root, file, { task }, resolveScope);
  assert.equal(loaded.collector.kind, 'published-main');
  assert.equal(loaded.digest, digest);
  assert.equal(loaded.packet.consumer.candidate, scope.task.recordedHead);
  assert.ok(maintenance);
  const live = await liveProof(loaded.scope, loaded.packet.selector, loaded.packet.identity, [], {
    ...maintenance,
    historicalExpected: true,
  });
  const after = loadSelection(root, file, { task }, resolveScope);
  assert.equal(after.digest, loaded.digest);
  assert.deepEqual(after.collector, loaded.collector);
  assert.deepEqual(after.scope.task, loaded.scope.task);
  return live;
}

// Composition may change a candidate, never the meaning of its old packet.
// Refuse before merge; the same public collector creates a distinct new proof
// for the new HEAD, after which the caller resumes the existing delivery.
export function assertReferenceProofCurrent(root, effect = 'final') {
  if (!process.env[VARIABLE]) return null;
  const selection = JSON.parse(process.env[VARIABLE]);
  if (path.resolve(root) !== selection.consumerWorktree) return null;
  assert.match(selection.consumerCandidate ?? '', /^[a-f0-9]{40}$/);
  assertReferenceConsumerCandidate(
    root,
    selection.consumerCandidate,
    git(root, 'rev-parse', selection.consumerCandidate + '^{tree}'),
  );
  const loaded = loadSelection(root, selection.file, { task: selection.consumerTask, effect });
  assert.equal(loaded.digest, selection.digest);
  assert.equal(loaded.scope.task.id, selection.consumerTask);
  return { candidate: loaded.packet.consumer.candidate, collector: loaded.collector };
}

// The environment contains a selector, not a safe flag or caller observations.
// Direct children still execute both complete production host observations.
export async function withPreviewReferenceProof(root, file, { task, effect }, action) {
  const loaded = loadSelection(root, file, { task, effect }),
    previous = process.env[VARIABLE];
  assert.equal(previous, undefined, 'Nested reference-proof selection refused');
  process.env[VARIABLE] = JSON.stringify({
    file: loaded.file,
    digest: loaded.digest,
    consumerTask: loaded.scope.task.id,
    consumerWorktree: loaded.scope.task.worktree,
    consumerCandidate: loaded.packet.consumer.candidate,
    foreignTask: loaded.packet.selector.foreignTask,
  });
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env[VARIABLE];
    else process.env[VARIABLE] = previous;
  }
}

export async function verifyClosedPreviewReference({ worktree, taskId, lease, effect = 'final', ownClosures = [] }) {
  if (!process.env[VARIABLE]) return null;
  const selection = JSON.parse(process.env[VARIABLE]);
  assert.deepEqual(Object.keys(selection).sort(), [
    'consumerCandidate',
    'consumerTask',
    'consumerWorktree',
    'digest',
    'file',
    'foreignTask',
  ]);
  // An inherited selector is not a general exception for other tasks or test
  // repositories. Returning null preserves their original unknown rejection.
  if (
    path.resolve(worktree) !== selection.consumerWorktree ||
    (taskId !== undefined && taskId !== selection.consumerTask)
  )
    return null;
  const secondary = lease.task !== selection.foreignTask;
  if (secondary) {
    const registry = createTaskRegistry(worktree);
    const task = registry.readTask(selection.consumerTask);
    if (!task || !existsSync(recoveryReceiptFile(registry.commonDir, task))) return null;
  }
  const context = { task: selection.consumerTask, effect };
  const loaded = loadSelection(worktree, selection.file, context);
  assert.equal(loaded.digest, selection.digest, 'Reference selector changed');
  assert.equal(loaded.scope.task.id, selection.consumerTask);
  assert.equal(loaded.packet.consumer.candidate, selection.consumerCandidate);
  assert.equal(path.resolve(worktree), loaded.scope.task.worktree, 'Foreign proof consumer');
  if (taskId !== undefined) assert.equal(taskId, loaded.scope.task.id);
  assert.equal(selection.foreignTask, loaded.packet.selector.foreignTask);
  const maintenance = stoppedValidationContinuation(loaded.scope, selection.foreignTask);
  const { port, ...original } = lease;
  if (secondary) {
    if (lease.task !== maintenance?.reassigned?.task || port !== maintenance.reassigned.port) return null;
  } else {
    assert.equal(port, loaded.packet.identity.port);
    assert.deepEqual(original, loaded.packet.identity.lease);
  }
  const live = await liveProof(loaded.scope, loaded.packet.selector, loaded.packet.identity, ownClosures, maintenance);
  if (secondary) {
    for (const round of live.rounds) {
      assert.equal(round.reassignedClosed?.port, port);
      assert.deepEqual(round.reassignedClosed.lease, original);
    }
  }
  assert.deepEqual(stoppedValidationContinuation(loaded.scope, selection.foreignTask), maintenance);
  const after = loadSelection(worktree, selection.file, context);
  assert.equal(after.digest, loaded.digest, 'Selection changed during live proof');
  assert.deepEqual(after.collector, loaded.collector, 'Actual collector changed during live proof');
  const evidence = path.join(path.dirname(loaded.file), 'live-' + randomUUID() + '.json');
  writeFileSync(
    evidence,
    JSON.stringify(
      {
        contract,
        consumer: loaded.packet.consumer,
        collector: loaded.collector,
        selectionDigest: loaded.digest,
        ...live,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return {
    kind: contract,
    task: lease.task,
    port,
    leaseDigest: hash(original),
    observationDigests: live.rounds.map(hash),
    observedAt: live.finishedAt,
    evidence,
    leaseRetained: true,
  };
}
