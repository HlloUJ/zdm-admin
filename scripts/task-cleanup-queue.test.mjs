import { runFixtureQueue } from './delivery-repairs/test-support/task-cleanup-scope-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  symlinkSync,
  renameSync,
  linkSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCleanupQueue, cleanupIdentity, cleanupObjectId } from './task-cleanup-queue.mjs';
import { flushCleanupNotifications } from './task-cleanup-notification.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const common = path.join(root, 'common'),
    source = path.join(root, 'source');
  mkdirSync(common);
  mkdirSync(source);
  writeFileSync(path.join(source, 'app.js'), 'generated');
  const record = {
    version: 1,
    task: 'fixture-task',
    identity: cleanupIdentity(source),
    producer: 'task-completion-handoff-v1',
    proof: {
      worktree: path.join(root, 'old-worktree'),
      head: 'a'.repeat(40),
      accepted: 'b'.repeat(40),
      main: 'c'.repeat(40),
    },
    disposition: 'rebuildable',
    notBefore: new Date(0).toISOString(),
  };
  const registration =
    JSON.stringify({
      version: 1,
      task: record.task,
      worktree: record.proof.worktree,
      relative: 'dist',
      identity: record.identity,
      sourceDigest: 'd'.repeat(64),
      producer: 'vite-build-success-v1',
      command: ['npm', 'run', 'build:app'],
      exitCode: 0,
    }) + '\n';
  const digest = createHash('sha256').update(registration).digest('hex');
  const proofPath = path.join(common, 'task-cleanup', 'proofs', record.task, digest + '.json');
  mkdirSync(path.dirname(proofPath), { recursive: true, mode: 0o700 });
  writeFileSync(proofPath, registration, { flag: 'wx', mode: 0o600 });
  record.proof.rebuild = { kind: 'vite-dist-v1', record: proofPath, digest };
  const key = cleanupObjectId(record),
    carrier = path.join(common, 'task-cleanup/staging', record.task, key);
  mkdirSync(carrier, { recursive: true, mode: 0o700 });
  const target = path.join(carrier, 'content');
  renameSync(source, target);
  Object.assign(record, { carrier, path: target });
  writeFileSync(path.join(carrier, 'manifest.json'), JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  const q = createCleanupQueue(common);
  return { root, common, target, q, queue: q, record, key, carrier };
}
const checks = { verify: async () => ({ ready: true }), unreferenced: async () => {} };
const readPending = (f) => JSON.parse(readFileSync(path.join(f.q.base, 'pending', f.key + '.json')));
test('stable staging identity survives producer rename; plan does not mutate pending state', async (t) => {
  const f = fixture(t);
  assert.deepEqual(cleanupIdentity(f.target), f.record.identity);
  f.q.handoff(f.record);
  const before = readPending(f);
  const r = await runFixtureQueue(f, { ...checks });
  assert.equal(r.processed[0].state, 'eligible');
  assert.ok(existsSync(f.target));
  assert.deepEqual(readPending(f), before);
});
test('descriptor deletion drains exact staged content and never claims physical disk bytes', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  const r = await runFixtureQueue(f, { ...checks, apply: true });
  assert.equal(r.remaining, 0);
  assert.equal(r.processed[0].state, 'cleaned');
  assert.equal(r.processed[0].deletedLogicalBytes, 9);
  assert.equal(r.processed[0].physicalBytes, null);
  assert.ok(!existsSync(f.target));
  assert.equal((await runFixtureQueue(f, { ...checks, apply: true })).processed.length, 0);
  assert.equal(f.q.handoff(f.record).state, 'cleaned');
});
test('missing content is already-absent with zero deletion, not real deletion acceptance', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  rmSync(f.target, { recursive: true });
  const r = await runFixtureQueue(f, { ...checks, apply: true });
  assert.equal(r.processed[0].state, 'already-absent');
  assert.equal(r.processed[0].deletedLogicalBytes, 0);
});
test('changed or newly unique content is retained', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  writeFileSync(path.join(f.target, 'unique.txt'), 'keep');
  const r = await runFixtureQueue(f, { ...checks, apply: true });
  assert.equal(r.processed[0].state, 'blocked');
  assert.ok(existsSync(f.target));
});
test('unchanged repeated failure preserves first evidence and does not create another notice', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  const failure = {
    ...checks,
    apply: true,
    unreferenced: async () => {
      throw Error('same reference');
    },
  };
  await runFixtureQueue(f, failure);
  const first = readPending(f);
  const receipt = {
    provider: 'isolated',
    destination: 'fixture',
    messageId: '1',
    deliveredAt: new Date().toISOString(),
  };
  f.q.acknowledgeNotification({ key: f.key, id: first.notification.id, receipt });
  await runFixtureQueue(f, { ...failure, now: Date.now() + 13 * 3600000 });
  const second = readPending(f);
  assert.deepEqual(second.firstError, first.firstError);
  assert.equal(second.notification.id, first.notification.id);
  assert.deepEqual(f.q.pendingNotifications(), []);
  assert.ok(existsSync(f.target));
  await runFixtureQueue(f, { ...checks, apply: true, now: Date.now() + 39 * 3600000 });
  assert.equal(f.q.compact({ detailsBefore: '2099-01-01T00:00:00Z' }).removed, 1);
  assert.equal(
    JSON.parse(readFileSync(path.join(f.q.base, 'failures', f.key + '.json'))).firstError.message,
    'same reference',
  );
});
test('explicit detail capacity can compact recent successes while retaining provenance files', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  await runFixtureQueue(f, { ...checks, apply: true });
  assert.equal(f.q.compact({ detailsBefore: '1970-01-01T00:00:00Z', keepLatest: 0 }).removed, 1);
  assert.ok(existsSync(path.join(f.carrier, 'manifest.json')));
  assert.ok(existsSync(f.record.proof.rebuild.record));
});
test('success and detail compaction retain an unacknowledged notice until exact delivery readback ack', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  await runFixtureQueue(f, {
    ...checks,
    apply: true,
    unreferenced: async () => {
      throw Error('original failure');
    },
  });
  const first = f.q.pendingNotifications()[0];
  await runFixtureQueue(f, { ...checks, apply: true, now: Date.now() + 13 * 3600000 });
  assert.equal(readFileSync(path.join(f.q.base, 'index.json'), 'utf8').includes(first.id), true);
  assert.equal(f.q.pendingNotifications()[0].id, first.id);
  f.q.compact({ detailsBefore: '2099-01-01T00:00:00Z' });
  const auditFile = path.join(f.q.base, 'audit', f.key.slice(0, 2), f.key + '.json');
  const audit = JSON.parse(readFileSync(auditFile));
  assert.equal(audit.task, f.record.task);
  assert.equal(audit.key, f.key);
  assert.equal(audit.objectDigest, f.key);
  assert.equal(audit.result, 'cleaned');
  assert.ok(Number.isFinite(Date.parse(audit.finishedAt)));
  assert.equal(audit.deletedLogicalBytes, 9);
  assert.equal(audit.physicalBytes, null);
  assert.equal(audit.hadException, true);
  assert.equal(f.q.handoff(f.record).state, 'cleaned');
  assert.equal(createCleanupQueue(f.common).pendingNotifications()[0].id, first.id);
  let text;
  const delivery = await flushCleanupNotifications(f.q, {
    destination: 'isolated-room',
    readThread: async () => ({ thread: { id: 'isolated-room' } }),
    sendMessage: async (r) => {
      text = r.text;
      return { messageId: 'observed-message' };
    },
    readMessage: async () => ({ roomId: 'isolated-room', messageId: 'observed-message', text }),
  });
  assert.equal(delivery.status, 'delivered');
  assert.deepEqual(f.q.pendingNotifications(), []);
  assert.deepEqual(JSON.parse(readFileSync(auditFile)), audit);
});
test('interrupted compaction retains exact per-object audit and never double-counts recovery', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  await runFixtureQueue(f, { ...checks, apply: true });
  f.q.compact({ detailsBefore: '2099-01-01T00:00:00Z' });
  const auditFile = path.join(f.q.base, 'audit', f.key.slice(0, 2), f.key + '.json'),
    audit = JSON.parse(readFileSync(auditFile));
  const indexFile = path.join(f.q.base, 'index.json'),
    index = JSON.parse(readFileSync(indexFile));
  index.results[f.key] = {
    finishedAt: audit.finishedAt,
    compacted: true,
    auditDigest: createHash('sha256').update(JSON.stringify(audit)).digest('hex'),
  };
  writeFileSync(indexFile, JSON.stringify(index));
  assert.equal(f.q.compact({ detailsBefore: '2099-01-01T00:00:00Z' }).removed, 1);
  assert.equal(JSON.parse(readFileSync(indexFile)).summary[audit.finishedAt.slice(0, 7)].objects, 1);
  assert.deepEqual(JSON.parse(readFileSync(auditFile)), audit);
});
test('notification outbox persists exact events and refuses stale or boolean acknowledgements', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  const failed = {
    ...checks,
    apply: true,
    unreferenced: async () => {
      throw Error('live reference');
    },
  };
  await runFixtureQueue(f, failed);
  const first = f.q.pendingNotifications()[0];
  assert.equal(first.reason, 'live reference');
  assert.deepEqual(createCleanupQueue(f.common).pendingNotifications(), [first]);
  assert.throws(() => f.q.acknowledgeNotification({ key: f.key, id: first.id, receipt: true }));
  const receipt = {
    provider: 'isolated-adapter',
    destination: 'test-channel',
    messageId: 'test-1',
    deliveredAt: new Date().toISOString(),
  };
  assert.equal(f.q.acknowledgeNotification({ key: f.key, id: 'stale', receipt }).acknowledged, false);
  await runFixtureQueue(f, {
    ...failed,
    now: Date.now() + 13 * 3600000,
    unreferenced: async () => {
      throw Error('different live reference');
    },
  });
  const second = f.q.pendingNotifications().find((n) => n.id !== first.id);
  assert.notEqual(first.id, second.id);
  assert.equal(f.q.acknowledgeNotification({ key: f.key, id: first.id, receipt }).acknowledged, true);
  assert.equal(f.q.pendingNotifications()[0].id, second.id);
  assert.equal(f.q.acknowledgeNotification({ key: f.key, id: second.id, receipt }).acknowledged, true);
  assert.deepEqual(f.q.pendingNotifications(), []);
  const indexFile = path.join(f.q.base, 'index.json');
  const index = JSON.parse(readFileSync(indexFile));
  index.notifications[second.id] = f.key; // Interrupted ack after durable receipt, before index update.
  writeFileSync(indexFile, JSON.stringify(index));
  assert.deepEqual(createCleanupQueue(f.common).pendingNotifications(), []);
  assert.equal(JSON.parse(readFileSync(indexFile)).notifications[second.id], undefined);
  assert.ok(existsSync(f.target));
});
test('unclosed task is deferred while proof failure is blocked', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  const r = await runFixtureQueue(f, {
    ...checks,
    apply: true,
    verify: async () => ({ ready: false, reason: 'not closed' }),
  });
  assert.equal(r.processed[0].state, 'deferred');
  assert.equal(readPending(f).attempts, 0);
  const later = await runFixtureQueue(f, {
    ...checks,
    now: Date.now() + 13 * 3600000,
    apply: true,
    verify: async () => {
      throw Error('foreign proof');
    },
  });
  assert.equal(later.processed[0].state, 'blocked');
  assert.ok(existsSync(f.target));
});
test('symlinks, hardlinks, foreign carrier and altered manifest identity are refused', (t) => {
  const f = fixture(t);
  assert.throws(() => f.q.handoff({ ...f.record, carrier: f.root }), /Carrier/);
  symlinkSync('/tmp', path.join(f.target, 'linked'));
  assert.throws(() => f.q.handoff(f.record), /Linked/);
  unlinkSync(path.join(f.target, 'linked'));
  linkSync(path.join(f.target, 'app.js'), path.join(f.root, 'linked-file'));
  assert.throws(() => f.q.handoff(f.record), /shared/);
});
test('future work is indexed and not read or processed', async (t) => {
  const f = fixture(t);
  f.record.notBefore = '2099-01-01T00:00:00Z';
  writeFileSync(path.join(f.carrier, 'manifest.json'), JSON.stringify(f.record));
  f.q.handoff(f.record);
  writeFileSync(path.join(f.q.base, 'pending', f.key + '.json'), 'invalid json');
  assert.equal((await runFixtureQueue(f, { ...checks, apply: true })).processed.length, 0);
});
test('pending JSON cannot change producer ownership or timing beyond its sealed source manifest', async (t) => {
  const f = fixture(t);
  assert.throws(() => f.q.handoff({ ...f.record, producer: 'safe=true' }), /producer/);
  assert.throws(() => f.q.handoff({ ...f.record, notBefore: '2099-01-01T00:00:00Z' }), /manifest differs/);
  f.q.handoff(f.record);
  const record = readPending(f);
  record.notBefore = '2099-01-01T00:00:00Z';
  writeFileSync(path.join(f.q.base, 'pending', f.key + '.json'), JSON.stringify(record));
  const r = await runFixtureQueue(f, { ...checks, apply: true });
  assert.equal(r.processed[0].state, 'blocked');
  assert.ok(existsSync(f.target));
});
test('concurrent run or handoff retains existing owner lock', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const a = runFixtureQueue(f, { ...checks, verify: () => gate });
  await assert.rejects(runFixtureQueue(f, checks), /EEXIST/);
  assert.throws(() => f.q.handoff(f.record), /Interrupted cleanup source differs/);
  release();
  await a;
});
test('reference failure after rename preserves quarantine, and exact recovery resumes', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  let calls = 0;
  let r = await runFixtureQueue(f, {
    ...checks,
    apply: true,
    unreferenced: async () => {
      if (++calls === 2) throw Error('probe interrupted');
    },
  });
  assert.equal(r.processed[0].state, 'blocked');
  assert.ok(!existsSync(f.target));
  assert.ok(existsSync(path.join(f.carrier, 'deleting')));
  r = await runFixtureQueue(f, { ...checks, apply: true, now: Date.now() + 13 * 3600000 });
  assert.equal(r.processed[0].state, 'cleaned');
  assert.equal(r.remaining, 0);
});
test('partial deletion journal accepts missing old members, rejects any new member', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  let r = await runFixtureQueue(f, {
    ...checks,
    apply: true,
    remove: async (directory) => {
      unlinkSync(path.join(directory, 'app.js'));
      throw Error('interrupted deletion');
    },
  });
  assert.equal(r.processed[0].state, 'blocked');
  const quarantined = path.join(f.carrier, 'deleting');
  writeFileSync(path.join(quarantined, 'new-unique'), 'keep');
  r = await runFixtureQueue(f, { ...checks, apply: true, now: Date.now() + 13 * 3600000 });
  assert.equal(r.processed[0].state, 'blocked');
  assert.equal(readFileSync(path.join(quarantined, 'new-unique'), 'utf8'), 'keep');
});
test('partial deletion without new content can resume safely with truthful remaining-byte count', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  await runFixtureQueue(f, {
    ...checks,
    apply: true,
    remove: async (directory) => {
      unlinkSync(path.join(directory, 'app.js'));
      throw Error('interrupted deletion');
    },
  });
  const r = await runFixtureQueue(f, { ...checks, apply: true, now: Date.now() + 13 * 3600000 });
  assert.equal(r.processed[0].state, 'cleaned');
  assert.equal(r.processed[0].deletedLogicalBytes, 0);
});
test('parent replacement after reference probe never follows a link to foreign files', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  const victim = path.join(f.root, 'victim');
  mkdirSync(victim);
  writeFileSync(path.join(victim, 'unique'), 'keep');
  const r = await runFixtureQueue(f, {
    ...checks,
    apply: true,
    unreferenced: async () => {
      renameSync(f.carrier, f.carrier + '-original');
      symlinkSync(victim, f.carrier);
    },
  });
  assert.equal(r.processed[0].state, 'blocked');
  assert.equal(readFileSync(path.join(victim, 'unique'), 'utf8'), 'keep');
});
test('queue tampering cannot redirect to another task or object', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  const file = path.join(f.q.base, 'pending', f.key + '.json');
  const r = readPending(f);
  r.task = 'another-task';
  writeFileSync(file, JSON.stringify(r));
  const result = await runFixtureQueue(f, { ...checks, apply: true });
  assert.equal(result.processed[0].state, 'blocked');
  assert.ok(existsSync(f.target));
});
test('corrupt pending journal is preserved and emits a separate integrity notice without trusting forged ownership', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  await runFixtureQueue(f, {
    ...checks,
    apply: true,
    unreferenced: async () => {
      throw Error('live reference');
    },
  });
  const file = path.join(f.q.base, 'pending', f.key + '.json');
  writeFileSync(file, 'corrupt original journal');
  const r = await runFixtureQueue(f, { ...checks, apply: true, now: Date.now() + 13 * 3600000 });
  assert.equal(r.processed[0].state, 'blocked');
  assert.equal(r.processed[0].task, null);
  assert.equal(readFileSync(file, 'utf8'), 'corrupt original journal');
  assert.ok(existsSync(f.target));
  const notices = f.q.pendingNotifications(),
    notice = notices.find((n) => n.task === 'cleanup-integrity');
  assert.equal(notice.task, 'cleanup-integrity');
  for (const item of notices)
    f.q.acknowledgeNotification({
      key: item.key,
      id: item.id,
      receipt: { provider: 'isolated', destination: 'fixture', messageId: '1', deliveredAt: new Date().toISOString() },
    });
  await runFixtureQueue(f, { ...checks, apply: true, now: Date.now() + 39 * 3600000 });
  assert.deepEqual(f.q.pendingNotifications(), []);
  assert.ok(existsSync(path.join(f.q.base, 'failures', 'integrity-' + f.key + '.json')));
});
test('oversized objects stay pending and explicit detail compaction never removes pending records', async (t) => {
  const f = fixture(t);
  f.q.handoff(f.record);
  let r = await runFixtureQueue(f, { ...checks, apply: true, maxLogicalBytes: 1 });
  assert.equal(r.processed[0].state, 'blocked');
  assert.equal(f.q.compact({ detailsBefore: '2099-01-01T00:00:00Z' }).removed, 0);
  r = await runFixtureQueue(f, { ...checks, apply: true, now: Date.now() + 13 * 3600000 });
  assert.equal(r.processed[0].state, 'cleaned');
  assert.equal(f.q.compact({ detailsBefore: '2099-01-01T00:00:00Z' }).removed, 1);
  assert.equal(readdirSync(path.join(f.q.base, 'results')).length, 0);
  assert.equal(f.q.compact({ detailsBefore: '2099-01-01T00:00:00Z' }).removed, 0);
  assert.throws(() => f.q.compact({}), /assert/);
});
