import assert from 'node:assert/strict';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { previewDataFile, readTaskData } from '../task-data-environment.mjs';
import { taskBackendContainerIdentity, taskBackendSourceIdentity } from '../task-runtime-state.mjs';
import { observedHostMountPath } from './preview-reference-proof-core.mjs';
import { referenceHash, regularReferenceFile } from './preview-reference-history.mjs';
import { privateJson } from './validation-recovery-evidence.mjs';

const hash = (value) => referenceHash(JSON.stringify(value));
const dnsFields = ['Dns', 'DnsOptions', 'DnsSearch'];
const exactOne = (rows, predicate) => {
  const matches = rows.filter(predicate);
  assert.equal(matches.length, 1, 'Missing or ambiguous Docker maintenance evidence');
  return matches[0];
};
function time(value) {
  assert.ok(typeof value === 'string' && value.endsWith('Z'), 'Missing UTC maintenance timestamp');
  const result = Date.parse(value);
  assert.ok(Number.isFinite(result), 'Invalid Docker maintenance timestamp');
  return result;
}

export function assertMaintenanceHistory(
  { baseline, restart, recovery, bindings, baselineHash },
  { task, port, id, startedAt },
) {
  assert.equal(baseline.version, 1);
  assert.equal(bindings.version, 1);
  assert.equal(bindings.baselineSha256, baselineHash);
  assert.equal(restart.phase, 'restart');
  assert.equal(recovery.phase, 'recover');
  assert.equal(restart.task, baseline.task);
  assert.equal(recovery.task, restart.task);

  const before = exactOne(baseline.active, (row) => row.ports.includes(port));
  const original = exactOne(baseline.taskBackends, (row) => row.port === port);
  const binding = exactOne(bindings.rows, (row) => row.port === port);
  assert.equal(before.id, id);
  assert.equal(original.id, id);
  assert.equal(binding.id, id);
  assert.equal(binding.task, task);
  assert.equal(before.startedAt, original.startedAt);
  if (startedAt) assert.equal(before.startedAt, startedAt);
  assert.equal(binding.identity, original.rawExactFormulaSha256);
  assert.equal(binding.withoutStartedAtSha256, before.withoutStartedAtSha256);
  assert.equal(original.withoutStartedAtSha256, before.withoutStartedAtSha256);
  if (original.task === null) {
    // The baseline first captured Docker objects independently of task resolution.
    // The separately captured owner binding must identify those same exact bytes.
    assert.equal(original.profileReady, false);
    assert.equal(original.sourceMatched, null);
    assert.equal(original.recordedIdentityMatches, false);
  } else {
    assert.equal(original.task, task);
    assert.equal(original.sourceMatched, true);
    assert.equal(original.recordedIdentityMatches, true);
  }
  assert.equal(binding.recordedIdentityMatches, true);
  assert.equal(binding.sourceMatches, true);
  assert.equal(binding.profileStatus, 'ready');
  assert.equal(binding.matchedFull, true);
  assert.equal(binding.startedAtUnchanged, true);
  assert.equal(binding.backup.present, true);
  assert.equal(binding.backup.stable, true);

  const restarted = exactOne(restart.run, (event) => event.step === 'desktop-restart-requested');
  const preflight = restart.run.filter((event) => event.step === 'preflight').at(-1);
  assert.deepEqual(preflight.SQL, [0, 0]);
  assert.ok(preflight.dockerSessionId);
  const cli = exactOne(restart.run, (event) => event.step === 'desktop-restart-cli');
  assert.equal(cli.status, 0);
  const first = exactOne(restart.run, (event) => event.step === 'recovery-readback');
  const final = exactOne(recovery.run, (event) => event.step === 'recovery-readback');
  assert.equal(
    recovery.run.some((event) => event.step === 'failure'),
    false,
  );
  assert.equal(final.diagnosticPreserved, true);
  const live = exactOne(final.rows, (row) => row.id === id);
  const starts = [...restart.run, ...recovery.run];
  const start = exactOne(starts, (event) => event.step === 'start-existing' && event.id === id);
  assert.equal(start.name, before.name);
  assert.equal(live.name, before.name);
  assert.equal(live.running, true);
  assert.ok(['exact', 'empty-dns-fields-null-to-empty-array'].includes(live.comparison));
  assert.equal(start.comparison ?? 'exact', live.comparison);
  const firstRead = exactOne(first.rows, (row) => row.id === id);
  assert.equal(firstRead.running, true);
  assert.equal(firstRead.startedAt, live.startedAt);
  assert.equal(firstRead.noChangeExceptStart, live.comparison === 'exact');
  if (!firstRead.noChangeExceptStart) {
    assert.ok(
      restart.run.some((event) => event.step === 'failure'),
      'Original failed comparison must be retained',
    );
    assert.ok(recovery.run.includes(start));
  }
  assert.equal(exactOne(final.health, (row) => row.port === port).ready, true);
  assert.ok(time(before.startedAt) < time(baseline.observedAt));
  assert.ok(time(baseline.observedAt) <= time(preflight.at) && time(preflight.at) <= time(restarted.at));
  assert.ok(time(restarted.at) <= time(cli.at) && time(cli.at) <= time(live.startedAt));
  assert.ok(time(live.startedAt) <= time(start.at) && time(start.at) - time(live.startedAt) <= 60_000);
  assert.ok(time(start.at) <= time(final.at) && time(final.at) >= time(first.at));
  return { before, binding, live, finalAt: final.at };
}

export const recoveryReceiptFile = (common, task) =>
  path.join(common, 'task-delivery', task.id, 'validation-backend-recovery/receipt.json');

export const validationMaintenanceSelector = (common, task) =>
  path.join(common, 'task-delivery', task.id, 'validation-docker-maintenance.json');

// Only the task's own historical delivery namespace can select the original read-only records.
export function readValidationMaintenance(common, task, evidence) {
  const file = validationMaintenanceSelector(common, task);
  const { value, hash: selectorDigest } = privateJson(file);
  assert.equal(value.version, 1);
  assert.equal(value.task, task.id);
  assert.equal(value.owner, task.owner);
  assert.equal(value.head, evidence.head);
  assert.equal(value.accepted, task.frozen.accepted);
  assert.equal(value.archiveManifest, evidence.manifestHash);
  const artifacts = {};
  const names = ['baseline', 'restart', 'recovery', 'bindings'];
  if (value.reassignedPeer) names.push('previewLeases');
  for (const name of names) {
    const input = value.records[name];
    assert.ok(path.isAbsolute(input.file) && realpathSync(input.file) === input.file);
    assert.match(input.sha256, /^[a-f0-9]{64}$/);
    const { bytes } = regularReferenceFile(input.file);
    assert.equal(referenceHash(bytes), input.sha256, 'Docker maintenance record changed');
    artifacts[name] = JSON.parse(bytes);
  }
  artifacts.baselineHash = value.records.baseline.sha256;
  const peer = value.reassignedPeer;
  let reassigned;
  if (peer) {
    assert.equal(peer.port, evidence.formerPort);
    assert.notEqual(peer.task, task.id);
    assert.notEqual(peer.task, evidence.foreign.task);
    assert.notEqual(peer.backendPort, evidence.backend.port);
    assert.notEqual(peer.backendPort, evidence.foreign.backendPort);
    const observed = exactOne(artifacts.previewLeases.leases, (row) => row.port === peer.port);
    assert.equal(artifacts.previewLeases.task, artifacts.baseline.task);
    assert.equal(observed.leaseOwner, peer.task);
    assert.equal(observed.leaseOwnerLive, false);
    assert.equal(observed.listenerCount, 0);
    assert.equal(observed.metadataOwner, null);
    assert.equal(observed.leaseOwnerRegistered, true);
    assert.equal(observed.preservationRequired, true);
    reassigned = {
      ...peer,
      observed,
      boot: assertMaintenanceHistory(artifacts, { task: peer.task, port: peer.backendPort, id: peer.containerId }),
    };
  }
  return {
    selectorDigest,
    ...(reassigned ? { reassigned } : {}),
    own: assertMaintenanceHistory(artifacts, { ...evidence.backend, task: task.id }),
    foreign: assertMaintenanceHistory(artifacts, {
      task: evidence.foreign.task,
      port: evidence.foreign.backendPort,
      id: evidence.foreign.containerId,
    }),
  };
}

// Compare the ordered inspect values. Only the three explicitly observed empty DNS lists
// are translated, and solely for reconstructing the original pre-restart digest.
export function assertMaintenanceInspect(container, proof) {
  const { before, binding, live } = proof;
  assert.equal(container.Id, before.id);
  assert.equal(container.Name, '/' + before.name);
  assert.equal(container.State.Running, true);
  assert.equal(container.State.StartedAt, live.startedAt);
  assert.equal(container.Image, before.imageDigest);
  assert.equal(hash(container.Config), before.configSha256);
  assert.equal(hash(container.Mounts), before.orderedMountsSha256);
  const host = { ...container.HostConfig };
  if (live.comparison === 'empty-dns-fields-null-to-empty-array') {
    for (const field of dnsFields) {
      assert.deepEqual(host[field], [], 'Docker DNS configuration changed');
      host[field] = null;
    }
  } else assert.equal(live.comparison, 'exact');
  assert.equal(hash(host), before.hostConfigSha256);
  const { Id: id, Image: image, Config: config, Mounts: mounts } = container;
  assert.equal(hash({ id, image, config, host, mounts }), before.withoutStartedAtSha256);
  assert.equal(hash({ id, startedAt: before.startedAt, image, config, host, mounts }), binding.identity);
}

export function assertMaintenanceStartup(logs, proof) {
  const startup = logs.split('\n').filter((line) => /\bStarted \w*Application in \d/.test(line));
  const line = exactOne(startup, () => true);
  const startedAt = time(line.split(' ', 1)[0]);
  assert.ok(startedAt >= time(proof.live.startedAt) && startedAt <= time(proof.finalAt));
}

export function readMaintenanceBackend(container, proof, { root, project, port }) {
  assertMaintenanceInspect(container, proof);
  const data = readTaskData(root);
  assert.equal(data.status, 'ready');
  assert.equal(referenceHash(regularReferenceFile(previewDataFile(root)).bytes), proof.binding.environmentSha256);
  const backup = lstatSync(data.backupFile);
  assert.ok(backup.isFile() && !backup.isSymbolicLink() && backup.size > 0);
  assert.equal(String(backup.size), proof.binding.backup.bytes, 'Original task backup changed');
  const migration = exactOne(container.Mounts, (mount) => mount.Destination === '/task-migrations');
  const migrationDirectory = realpathSync(observedHostMountPath(migration.Source, process.platform));
  const containerIdentity = taskBackendContainerIdentity(container, {
    root,
    project,
    backendPort: port,
    migrationDirectory,
    database: data.database,
    username: data.username,
    mediaVolume: data.mediaVolume,
  });
  assert.ok(containerIdentity, 'Restarted container is not bound to the registered task environment');
  const record = regularReferenceFile(path.join(root, '.task-runtime/backend-state.json'));
  const current = JSON.parse(record.bytes);
  assert.equal(current.version, 1);
  const recordDigest = referenceHash(record.bytes);
  if (current.containerIdentity !== containerIdentity) {
    assert.equal(current.containerIdentity, proof.binding.identity, 'Unproven pre-maintenance backend identity');
    assert.equal(
      recordDigest,
      proof.binding.recordedBackendStateSha256,
      'Original owner-specific backend record changed',
    );
  }
  assert.equal(current.sourceIdentity, taskBackendSourceIdentity({ root, migrationDirectory }));
  return { containerIdentity, recordDigest };
}

export function assertMaintenanceNeighbor(previous, current, { proof, backend }) {
  assert.equal(previous.backend.id, proof.before.id);
  assert.equal(previous.backend.containerIdentity, proof.binding.identity);
  assert.equal(previous.backend.recordDigest, proof.binding.recordedBackendStateSha256);
  assert.equal(current.backend.containerIdentity, backend.containerIdentity);
  assert.equal(current.backend.recordDigest, backend.recordDigest);
  assert.deepEqual(
    {
      ...current,
      backend: {
        ...current.backend,
        containerIdentity: previous.backend.containerIdentity,
        recordDigest: previous.backend.recordDigest,
      },
    },
    previous,
    'Historical preview ownership, source, mounts or data changed',
  );
}
