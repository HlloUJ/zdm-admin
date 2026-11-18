import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
  assertCleanupUnreferenced,
  verifyCleanupDelivery,
  cleanupCommand,
  loadCleanupPolicy,
} from './task-cleanup-cli.mjs';
import { cleanupObjectId } from './task-cleanup-queue.mjs';
test('apply requires explicit bounded production policy and cannot enable an unapproved expiry', (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-policy-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'task-cleanup'), { mode: 0o700 });
  const file = path.join(root, 'task-cleanup/policy.json');
  assert.throws(() => loadCleanupPolicy(root), /ENOENT/);
  const policy = { version: 1, limit: 2, budgetMs: 10000, maxLogicalBytes: 1000000 };
  writeFileSync(file, JSON.stringify(policy), { mode: 0o600 });
  assert.deepEqual(loadCleanupPolicy(root), { limit: 2, budgetMs: 10000, maxLogicalBytes: 1000000 });
  writeFileSync(file, JSON.stringify({ ...policy, retentionDays: 30 }));
  assert.throws(() => loadCleanupPolicy(root));
  writeFileSync(file, JSON.stringify({ ...policy, limit: 101 }));
  assert.throws(() => loadCleanupPolicy(root));
});
for (const native of [false, true])
  test(
    'host CLI confirms one existing notification with exact fixed-room ' +
      (native ? 'native LF' : 'generic') +
      ' readback',
    async (t) => {
      const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-host-cli-')));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const commonDir = path.join(root, 'common'),
        base = path.join(commonDir, 'task-cleanup');
      mkdirSync(base, { recursive: true, mode: 0o700 });
      writeFileSync(
        path.join(base, 'policy.json'),
        JSON.stringify({
          version: 1,
          limit: 2,
          budgetMs: 10000,
          maxLogicalBytes: 1000,
          notification: { destination: 'fixed-room' },
        }),
        { mode: 0o600 },
      );
      const event = {
        key: 'a'.repeat(64),
        id: 'exact-event',
        task: 'other-artifact-owner',
        reason: 'retained live reference',
      };
      let acknowledged = false;
      const queue = {
        base,
        pendingNotifications: () => (acknowledged ? [] : [event]),
        acknowledgeNotification: () => {
          acknowledged = true;
          return { acknowledged: true };
        },
        run: () => {
          throw Error('must not execute cleanup');
        },
      };
      const deps = { queue, registry: { commonDir } };
      const pending = (await cleanupCommand(root, ['pending-notifications'], deps)).notifications[0];
      assert.equal(pending.delivery.status, 'unclaimed');
      assert.equal(pending.task, 'other-artifact-owner');
      const envelope = {
        key: event.key,
        id: event.id,
        eventId: pending.eventId,
        receipt: {
          provider: 'codex-fixed-channel-readback',
          destination: 'fixed-room',
          messageId: 'message-1',
          deliveredAt: new Date().toISOString(),
        },
        readback: { roomId: 'fixed-room', messageId: 'message-1', text: pending.text },
        ...(native
          ? {
              observation: {
                provider: 'codex-native-read_thread',
                threadId: 'fixed-room',
                turnId: 'native-turn',
                message: { id: 'native-message', phase: 'commentary', text: pending.text + '\n' },
                observedAt: new Date().toISOString(),
              },
            }
          : {}),
      };
      const ack = native ? 'ack-native-commentary' : 'ack-notification';
      const file = path.join(root, 'receipt.json');
      writeFileSync(file, JSON.stringify(envelope));
      await assert.rejects(cleanupCommand(root, [ack, file], deps), /never claimed/);
      assert.equal((await cleanupCommand(root, ['claim-notification', file], deps)).status, 'send-once');
      assert.equal((await cleanupCommand(root, ['claim-notification', file], deps)).status, 'delivery-unknown');
      envelope.receipt.deliveredAt = new Date().toISOString();
      if (native) envelope.observation.observedAt = envelope.receipt.deliveredAt;
      writeFileSync(
        file,
        JSON.stringify(
          native
            ? {
                ...envelope,
                observation: {
                  ...envelope.observation,
                  message: { ...envelope.observation.message, text: 'stdout is not delivery' },
                },
              }
            : { ...envelope, readback: { ...envelope.readback, text: 'stdout is not delivery' } },
        ),
      );
      await assert.rejects(cleanupCommand(root, [ack, file], deps), /text differs|final LF/);
      assert.equal(acknowledged, false);
      writeFileSync(file, JSON.stringify(envelope));
      assert.equal((await cleanupCommand(root, [ack, file], deps)).acknowledged, true);
      assert.deepEqual((await cleanupCommand(root, ['pending-notifications'], deps)).notifications, []);
      writeFileSync(path.join(base, 'index.json'), 'corrupt index');
      writeFileSync(path.join(base, 'scheduler-state.json'), JSON.stringify({ version: 1, status: 'failed' }), {
        mode: 0o600,
      });
      assert.equal((await cleanupCommand(root, ['schedule-status'], deps)).schedule.status, 'failed');
    },
  );
const record = () => {
  const r = {
    version: 1,
    task: 'fixture',
    identity: { dev: '1', ino: '2', fingerprint: 'a'.repeat(64), bytes: 9 },
    producer: 'fixture-build',
    proof: { worktree: '/owned/old', head: 'a'.repeat(40), accepted: 'b'.repeat(40), main: 'c'.repeat(40) },
    disposition: 'rebuildable',
    notBefore: '2026-01-01T00:00:00Z',
  };
  r.carrier = path.join('/owned/common/task-cleanup/staging/fixture', cleanupObjectId(r));
  r.path = path.join(r.carrier, 'content');
  return r;
};
const registry = (r, patch = {}) => ({
  commonDir: '/owned/common',
  readTask: () => ({
    id: r.task,
    worktree: r.proof.worktree,
    recordedHead: r.proof.head,
    frozen: { accepted: r.proof.accepted },
    stage: 'closed',
    main: { local: r.proof.main },
    ...patch,
  }),
});
test('consumer independently proves original task, accepted source and full closure', async () => {
  const r = record();
  const options = { readDelivery: () => ({ formalDeliveryComplete: true }) };
  assert.deepEqual(await verifyCleanupDelivery(registry(r), r, options), { ready: true });
  for (const patch of [
    { id: 'foreign' },
    { worktree: '/other' },
    { recordedHead: 'd'.repeat(40) },
    { frozen: { accepted: 'd'.repeat(40) } },
    { main: { local: 'd'.repeat(40) } },
  ])
    await assert.rejects(verifyCleanupDelivery(registry(r, patch), r, options));
  await assert.rejects(
    verifyCleanupDelivery(registry(r), r, { readDelivery: () => ({ formalDeliveryComplete: false }) }),
  );
});
test('preclose handoff waits without turning admission into closure', async () => {
  const r = record();
  assert.equal(
    (
      await verifyCleanupDelivery(registry(r, { stage: 'handoff-verified' }), r, {
        readDelivery: () => assert.fail('not yet closed'),
      })
    ).ready,
    false,
  );
});
test('caller true booleans cannot substitute for actual closure or path binding', async () => {
  const r = record();
  await assert.rejects(
    verifyCleanupDelivery(
      registry(r),
      { ...r, carrier: '/other', safe: true },
      { readDelivery: () => ({ formalDeliveryComplete: true }) },
    ),
  );
});
function observations({
  mounts = [],
  endpoint = 'unix:///local/docker.sock',
  lsof = { status: 1, stdout: '', stderr: '' },
} = {}) {
  return {
    env: {},
    run: () => lsof,
    exec: (_command, args) => {
      if (args[0] === 'context') return JSON.stringify(endpoint);
      if (args[0] === 'ps') {
        assert.deepEqual(args, ['ps', '-aq']);
        return mounts.length ? 'a'.repeat(12) : '';
      }
      if (args[0] === 'inspect') return JSON.stringify([{ Mounts: mounts }]);
      assert.fail('unexpected inventory command');
    },
  };
}
test('local lsof and Docker inventory allow only unreferenced exact staging path', () => {
  const r = record();
  assert.doesNotThrow(() => assertCleanupUnreferenced(r, observations()));
  for (const Source of [r.path, path.dirname(r.path), r.path + '/nested', '/host_mnt' + r.path])
    assert.throws(() => assertCleanupUnreferenced(r, observations({ mounts: [{ Source }] })), /references/);
});
test('unknown inventory, permission errors, remote context and env override refuse deletion', () => {
  const r = record();
  for (const lsof of [
    { status: 0, stdout: '123', stderr: '' },
    { status: 1, stdout: '', stderr: 'permission denied' },
    { error: Error('unavailable') },
  ])
    assert.throws(() => assertCleanupUnreferenced(r, observations({ lsof })));
  assert.throws(() => assertCleanupUnreferenced(r, observations({ endpoint: 'ssh://remote' })));
  assert.throws(() => assertCleanupUnreferenced(r, { ...observations(), env: { DOCKER_HOST: 'tcp://remote' } }));
});
test('CLI does not accept safe=true, custom delete paths, or unregistered operations', async () => {
  const r = record();
  const queue = { run: () => assert.fail('must not run') };
  await assert.rejects(cleanupCommand('/owned', ['run', 'safe=true'], { registry: registry(r), queue }));
  await assert.rejects(cleanupCommand('/owned', ['delete', '/other'], { registry: registry(r), queue }));
});
