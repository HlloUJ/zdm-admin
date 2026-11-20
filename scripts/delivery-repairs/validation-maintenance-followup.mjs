import assert from 'node:assert/strict';
import path from 'node:path';
import { referenceHash, regularReferenceFile } from './preview-reference-history.mjs';
import {
  assertMaintenanceHistory,
  assertMaintenanceStartup,
  readMaintenanceBackend,
} from './validation-maintenance-lineage.mjs';
import { validationRuntimeHash } from './validation-recovery-evidence.mjs';

// This reviewed continuation links one stopped owner's original receipt to one independent maintenance.
// Another boot, registration or maintenance window requires its own evidence.
const owner = 'execution-efficiency-dynamic-orchestration';
const neighbor = 'finished-stock-selection-log-copy';
const maintenanceTask = 'trusted-add-add-conflict-review-749';
const authorization = '01a1f946-21b7-76c1-b8e4-8cbf990d97c3';
const references = {
  stop: '4e33241411f5505e029090b94e1437591ad7bdfa5de5e9810b570c5fe51b1587',
  selector: '9c789adc072675bc7dc06dd3c8228146fe747464d5d4d92cdba2d5aa3dcef294',
  window: 'edf631e45853276dde8ab4eeea1dcb46f3c0bd9c45c8685f1c1a6ce26280aa91',
  earlierPacket: '89fcc719109aa5518024395344069ca4d6e891c4e99a9e5dda64981e152e8480',
  registration: '7e5f304d3beb2894ec63398aba00d2a6b6322d1a53512a0fbce05205a52f16b7',
};

function verifiedBytes(file, expected) {
  const { bytes } = regularReferenceFile(file);
  assert.equal(referenceHash(bytes), expected, 'Reviewed maintenance evidence changed: ' + path.basename(file));
  return bytes;
}

// Adapts the two preserved on-disk formats only after the boots, ordered Docker inputs and owned data agree.
export function linkMaintenanceWindows(previous, next) {
  const { before, live, binding } = next;
  assert.equal(before.id, previous.live.id);
  assert.equal(live.id, before.id);
  assert.equal(binding.id, before.id);
  assert.equal(binding.task, previous.binding.task);
  assert.equal(binding.port, previous.binding.port);
  assert.equal(before.startedAt, previous.live.startedAt);
  assert.equal(live.priorStartedAt, previous.live.startedAt);
  assert.ok(Date.parse(previous.finalAt) < Date.parse(live.startedAt));
  assert.equal(before.withoutStartedAtSha256, previous.before.withoutStartedAtSha256);
  for (const [key, original] of Object.entries({
    image: 'imageDigest',
    config: 'configSha256',
    host: 'hostConfigSha256',
    orderedMounts: 'orderedMountsSha256',
  }))
    assert.equal(before[key], previous.before[original]);
  assert.equal(binding.environmentSha256, previous.binding.environmentSha256);
  assert.equal(binding.backup.sha256, previous.binding.backup.sha256);
  assert.ok(Number.isSafeInteger(binding.backup.bytes) && binding.backup.bytes > 0);
  assert.equal(String(binding.backup.bytes), previous.binding.backup.bytes);
  return {
    ...next,
    before: {
      ...before,
      imageDigest: before.image,
      configSha256: before.config,
      hostConfigSha256: before.host,
      orderedMountsSha256: before.orderedMounts,
    },
    binding: {
      ...binding,
      backup: { ...binding.backup, bytes: String(binding.backup.bytes) },
      recordedBackendStateSha256: binding.registeredSha256,
    },
  };
}

export function needsFollowingMaintenance(task, foreign, firstBoot, currentBoot) {
  return task === owner && foreign === neighbor && firstBoot !== currentBoot;
}

export function readFollowingMaintenance({ scope, receipt, receiptDigest, maintenance, container, runtime, stopped }) {
  assert.equal(scope.task.id, owner);
  assert.equal(receipt.evidence.foreign.task, neighbor);
  assert.equal(receiptDigest, references.stop);
  assert.equal(maintenance.selectorDigest, references.selector);
  const folder = path.join(scope.anchor, '.task-runtime/800-shared-docker-maintenance-20261120');
  const summary = JSON.parse(verifiedBytes(path.join(folder, 'maintenance-receipt.json'), references.window));
  const original = (entry) => {
    assert.equal(path.dirname(entry.path), folder, 'Maintenance record outside reviewed window');
    const bytes = verifiedBytes(entry.path, entry.sha256);
    assert.equal(bytes.length, entry.bytes);
    return bytes;
  };
  assert.equal(summary.task, maintenanceTask);
  assert.equal(summary.authorization, authorization);
  assert.equal(summary.status, 'restored-and-verified');
  assert.equal(summary.restartCount, 1);
  assert.equal(summary.stopped410, receipt.evidence.backend.id);
  assert.equal(stopped.Id, summary.stopped410);
  assert.equal(stopped.State.Running, false);
  assert.equal(stopped.State.StartedAt, receipt.startedAt);
  assert.equal(stopped.State.FinishedAt, receipt.stoppedAt);
  assert.equal(validationRuntimeHash(stopped), receipt.containerIdentity);

  const records = summary.originalRecords;
  const artifacts = Object.fromEntries(
    ['baseline', 'restart', 'recovery', 'bindings'].map((k) => [k, JSON.parse(original(records[k]))]),
  );
  artifacts.baselineHash = records.baseline.sha256;
  const previous = maintenance.foreign;
  const next = assertMaintenanceHistory(artifacts, {
    task: neighbor,
    port: receipt.evidence.foreign.backendPort,
    id: previous.live.id,
    startedAt: previous.live.startedAt,
  });
  const proof = linkMaintenanceWindows(previous, next);
  const packetFile = path.join(
    scope.registry.commonDir,
    'task-delivery',
    owner,
    'reference-proofs/754f72e0-f48a-463a-b609-c61b2eaa3cc4/proof.json',
  );
  const packet = JSON.parse(verifiedBytes(packetFile, references.earlierPacket));
  assert.equal(packet.consumer.task, owner);
  assert.equal(packet.consumer.accepted, receipt.evidence.accepted);
  assert.equal(packet.identity.task, neighbor);
  assert.equal(packet.identity.backend.id, container.Id);
  const beforeBytes = original(summary.maintenance489.rawRegistration);
  const old = JSON.parse(beforeBytes);
  assert.equal(referenceHash(beforeBytes), packet.identity.backend.recordDigest);
  assert.equal(referenceHash(beforeBytes), next.binding.registeredSha256);
  assert.equal(old.containerIdentity, packet.identity.backend.containerIdentity);
  assert.equal(old.containerIdentity, next.binding.identity);
  assert.equal(old.sourceIdentity, next.binding.sourceIdentity);
  assert.equal(old.configurationIdentity, next.binding.configurationIdentity);
  const readback = artifacts.recovery.run.find((row) => row.step === 'recovery-readback');
  const restored = readback.ownership489;
  for (const key of [
    'id',
    'environmentSha256',
    'sourceIdentity',
    'configurationIdentity',
    'migrationManifest',
    'database',
    'mediaVolume',
    'taskAccountDigest',
    'lease5177',
    'mounts',
    'backup',
  ]) {
    assert.deepEqual(restored[key], next.binding[key]);
  }
  assert.equal(next.binding.lease5177.task, neighbor);
  assert.equal(next.binding.lease5177.port, receipt.evidence.foreign.port);
  assert.equal(next.binding.lease5177.sha256, packet.identity.leaseFile.digest);
  const actualLease = path.join(
    scope.registry.commonDir,
    'task-registry/resource-leases',
    'temporary-port-' + next.binding.lease5177.port,
    'owner.json',
  );
  const { exactStat: leaseStat } = regularReferenceFile(actualLease);
  assert.equal(String(leaseStat.ino), packet.identity.leaseFile.inode);
  assert.equal(String(leaseStat.mtimeNs), packet.identity.leaseFile.mtimeNs);
  assert.equal(String(leaseStat.ctimeNs), packet.identity.leaseFile.ctimeNs);
  assert.deepEqual(JSON.parse(verifiedBytes(actualLease, next.binding.lease5177.sha256)), packet.identity.lease);
  const boot = readback.bootAndHealth489;
  assert.equal(boot.id, container.Id);
  assert.equal(boot.startedAt, proof.live.startedAt);
  assert.equal(JSON.parse(original(boot.health)).status, 'UP');
  assertMaintenanceStartup(boot.slices.map((row) => original(row).toString('utf8')).join('\n'), proof);
  for (const entry of [...summary.journals, ...Object.values(summary.originalRestartOutput)]) original(entry);
  assert.equal(verifiedBytes(next.binding.backup.path, next.binding.backup.sha256).length, next.binding.backup.bytes);
  const registrationFile = path.join(
    runtime.root,
    '.task-runtime',
    '489-backend-reregistration-' + authorization,
    'complete.json',
  );
  const registration = JSON.parse(verifiedBytes(registrationFile, references.registration));
  assert.equal(registration.task, neighbor);
  assert.equal(registration.authority.userMessage, authorization);
  assert.equal(registration.previousRecordSha256, next.binding.registeredSha256);
  assert.equal(registration.previousIdentity, next.binding.identity);
  const observed = readMaintenanceBackend(container, proof, runtime);
  assert.equal(observed.recordDigest, registration.newRecordSha256);
  assert.equal(observed.containerIdentity, registration.newIdentity);
  assert.equal(observed.containerIdentity, restored.identity);
  const current = JSON.parse(
    verifiedBytes(path.join(runtime.root, '.task-runtime/backend-state.json'), observed.recordDigest),
  );
  assert.deepEqual(current, { ...old, containerIdentity: observed.containerIdentity });
  return { proof, backend: observed };
}
