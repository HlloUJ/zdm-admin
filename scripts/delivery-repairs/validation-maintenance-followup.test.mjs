import assert from 'node:assert/strict';
import test from 'node:test';
import {
  linkMaintenanceWindows,
  needsFollowingMaintenance,
  readFollowingMaintenance,
} from './validation-maintenance-followup.mjs';

const owner = 'execution-efficiency-dynamic-orchestration',
  foreign = 'finished-stock-selection-log-copy';
test('only the stopped owner and the same foreign task select the additional boot', () => {
  assert.ok(needsFollowingMaintenance(owner, foreign, 'first', 'second'));
  assert.equal(needsFollowingMaintenance(owner, foreign, 'first', 'first'), false);
  assert.equal(needsFollowingMaintenance('trusted-add-add-conflict-review-749', foreign, 'first', 'second'), false);
  assert.equal(needsFollowingMaintenance(owner, 'another-peer', 'first', 'second'), false);
  assert.throws(
    () =>
      readFollowingMaintenance({
        scope: { task: { id: owner } },
        receipt: { evidence: { foreign: { task: foreign } } },
        receiptDigest: 'other stop receipt',
        maintenance: {},
      }),
    { code: 'ERR_ASSERTION' },
  );
});
function fixture() {
  const boot = '2026-11-20T02:23:11.308871088Z',
    nextBoot = '2026-11-20T14:19:04.02248438Z';
  const previous = {
    live: { id: 'same', startedAt: boot },
    finalAt: '2026-11-20T02:26:00Z',
    before: {
      imageDigest: 'image',
      configSha256: 'config',
      hostConfigSha256: 'host',
      orderedMountsSha256: 'mounts',
      withoutStartedAtSha256: 'body',
    },
    binding: { task: foreign, port: 8082, environmentSha256: 'env', backup: { sha256: 'backup', bytes: '123' } },
  };
  const next = {
    before: {
      id: 'same',
      startedAt: boot,
      image: 'image',
      config: 'config',
      host: 'host',
      orderedMounts: 'mounts',
      withoutStartedAtSha256: 'body',
    },
    live: { id: 'same', priorStartedAt: boot, startedAt: nextBoot },
    binding: {
      id: 'same',
      task: foreign,
      port: 8082,
      registeredSha256: 'old-bytes',
      environmentSha256: 'env',
      backup: { sha256: 'backup', bytes: 123 },
    },
  };
  return { previous, next };
}
test('maps verified original evidence without rewriting either window', () => {
  const { previous, next } = fixture();
  const saved = structuredClone({ previous, next });
  const linked = linkMaintenanceWindows(previous, next);
  assert.equal(linked.before.imageDigest, previous.before.imageDigest);
  assert.equal(linked.binding.recordedBackendStateSha256, next.binding.registeredSha256);
  assert.equal(linked.binding.backup.bytes, '123');
  assert.deepEqual({ previous, next }, saved);
});
for (const [label, change] of Object.entries({
  'different before boot': (n) => {
    n.before.startedAt = '2026-11-20T02:23:12Z';
  },
  'mismatched prior boot': (n) => {
    n.live.priorStartedAt = '2026-11-20T02:23:12Z';
  },
  'overlapping windows': (n) => {
    n.live.startedAt = '2026-11-20T02:25:59Z';
  },
  'another instance': (n) => {
    n.live.id = 'different';
  },
  'another owner': (n) => {
    n.binding.task = 'different';
  },
  'another port': (n) => {
    n.binding.port = 8083;
  },
  'unmatched image': (n) => {
    n.before.image = 'new';
  },
  'changed application configuration': (n) => {
    n.before.config = 'new';
  },
  'changed host configuration': (n) => {
    n.before.host = 'new';
  },
  'reordered mounts': (n) => {
    n.before.orderedMounts = 'new';
  },
  'unmatched input digest': (n) => {
    n.before.withoutStartedAtSha256 = 'new';
  },
  'another data registration': (n) => {
    n.binding.environmentSha256 = 'new';
  },
  'changed backup': (n) => {
    n.binding.backup.sha256 = 'other';
  },
  'changed backup length': (n) => {
    n.binding.backup.bytes = 124;
  },
  'ambiguous backup size': (n) => {
    n.binding.backup.bytes = '123';
  },
})) {
  test('refuses ' + label, () => {
    const { previous, next } = fixture();
    change(next);
    assert.throws(() => linkMaintenanceWindows(previous, next));
  });
}
