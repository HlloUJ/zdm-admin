import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
  openSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const immutable = (r) => ({
  version: r.version,
  task: r.task,
  carrier: r.carrier,
  path: r.path,
  identity: r.identity,
  producer: r.producer,
  proof: r.proof,
  disposition: r.disposition,
  notBefore: r.notBefore,
});
const pendingIndex = (r) => ({
  nextCheck: r.nextCheck,
  state: r.state,
  ...(r.notification?.state === 'pending' ? { notification: r.notification.id } : {}),
});
export const cleanupObjectId = (r) =>
  hash({ task: r.task, identity: r.identity, producer: r.producer, proof: r.proof });
export function safePath(file) {
  assert.ok(path.isAbsolute(file) && path.resolve(file) === file, 'Canonical absolute path required');
  for (let p = file; ; p = path.dirname(p)) {
    try {
      assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked cleanup path refused');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (p === path.dirname(p)) break;
  }
}
function snapshot(directory) {
  safePath(directory);
  const entries = [];
  let bytes = 0;
  const visit = (file, relative) => {
    assert.ok(entries.length < 100000, 'Object exceeds bounded metadata inventory; retain');
    const s = lstatSync(file, { bigint: true });
    assert.ok(
      !s.isSymbolicLink() && (s.isDirectory() || (s.isFile() && s.nlink === 1n)),
      'Linked, shared or special cleanup member refused',
    );
    const kind = s.isDirectory() ? 'directory' : 'file';
    const entry = {
      path: relative,
      kind,
      dev: String(s.dev),
      ino: String(s.ino),
      size: Number(s.size),
      mtimeNs: String(s.mtimeNs),
      ctimeNs: relative ? String(s.ctimeNs) : null,
      mode: Number(s.mode),
    };
    assert.ok(Number.isSafeInteger(entry.size), 'Cleanup member exceeds measurable range');
    entries.push(entry);
    if (kind === 'directory')
      for (const name of readdirSync(file).sort())
        visit(path.join(file, name), relative ? relative + '/' + name : name);
    else bytes += entry.size;
  };
  visit(directory, '');
  assert.equal(entries[0].kind, 'directory', 'Cleanup target must be a directory');
  return { identity: { dev: entries[0].dev, ino: entries[0].ino, fingerprint: hash(entries), bytes }, entries };
}
// Metadata identity detects path/content mutations without rereading all file bytes.
// ctime cannot be restored through ordinary utimes; the producer separately proves rebuildability.
export const cleanupIdentity = (directory) => snapshot(directory).identity;
function removeSealed(directory, entries) {
  const result = spawnSync('python3', ['-I', fileURLToPath(new URL('./task-cleanup-delete.py', import.meta.url))], {
    input: JSON.stringify({ path: directory, entries }),
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  assert.ok(
    !result.error && result.status === 0,
    result.stderr?.trim() || 'Descriptor deletion interrupted; retain journal',
  );
  return JSON.parse(result.stdout);
}
export function createCleanupQueue(commonDir) {
  commonDir = path.resolve(commonDir);
  safePath(commonDir);
  const base = path.join(commonDir, 'task-cleanup');
  safePath(base);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  assert.equal(lstatSync(base).mode & 0o077, 0, 'Cleanup store must be owner-only');
  const folders = Object.fromEntries(
    ['pending', 'results', 'inventories', 'failures', 'system-notices', 'notifications', 'audit'].map((name) => {
      const p = path.join(base, name);
      safePath(p);
      mkdirSync(p, { recursive: true, mode: 0o700 });
      assert.equal(lstatSync(p).mode & 0o077, 0, 'Cleanup journals must be owner-only');
      return [name, p];
    }),
  );
  const indexFile = path.join(base, 'index.json');
  const auditFile = (key) => path.join(folders.audit, key.slice(0, 2), key + '.json');
  const read = (file) => {
    safePath(file);
    assert.ok(lstatSync(file).isFile(), 'Regular cleanup journal required');
    assert.equal(lstatSync(file).mode & 0o077, 0, 'Cleanup journal must be owner-only');
    return JSON.parse(readFileSync(file, 'utf8'));
  };
  function save(file, value) {
    safePath(file);
    const temporary = file + '.' + randomUUID();
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(value) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
  }
  function index() {
    if (!existsSync(indexFile)) return { version: 1, objects: {}, results: {}, summary: {} };
    const i = read(indexFile);
    assert.equal(i.version, 1);
    assert.ok(i.objects && typeof i.objects === 'object' && !Array.isArray(i.objects));
    i.results ??= {};
    i.summary ??= {};
    i.integrity ??= {};
    i.notifications ??= {};
    return i;
  }
  function lock() {
    const p = path.join(base, 'run.lock');
    mkdirSync(p, { mode: 0o700 });
    const owner = { pid: process.pid, token: randomUUID() };
    save(path.join(p, 'owner.json'), owner);
    return () => {
      assert.deepEqual(read(path.join(p, 'owner.json')), owner, 'Cleanup lock owner changed; retain');
      unlinkSync(path.join(p, 'owner.json'));
      rmdirSync(p);
    };
  }
  function validate(r) {
    assert.equal(r.version, 1);
    assert.match(r.task, ID);
    assert.equal(r.disposition, 'rebuildable');
    assert.equal(r.producer, 'task-completion-handoff-v1', 'Unknown cleanup producer');
    for (const name of ['head', 'accepted', 'main'])
      assert.match(r.proof?.[name] ?? '', /^[a-f0-9]{40}$/, 'Missing delivery identity ' + name);
    assert.ok(path.isAbsolute(r.proof.worktree));
    assert.ok(Number.isFinite(Date.parse(r.notBefore)));
    assert.ok(r.identity && typeof r.identity.dev === 'string' && typeof r.identity.ino === 'string');
    assert.match(r.identity.fingerprint, HEX);
    assert.ok(Number.isSafeInteger(r.identity.bytes) && r.identity.bytes >= 0);
    const object = cleanupObjectId(r);
    assert.equal(r.carrier, path.join(base, 'staging', r.task, object), 'Carrier not bound to task/manifest identity');
    assert.equal(r.path, path.join(r.carrier, 'content'), 'Cleanup target must be its exact sealed content');
    safePath(r.carrier);
    assert.deepEqual(immutable(read(path.join(r.carrier, 'manifest.json'))), immutable(r), 'Producer manifest differs');
    const rebuild = r.proof.rebuild;
    assert.equal(rebuild?.kind, 'vite-dist-v1', 'No supported rebuild registration');
    assert.match(rebuild.digest, HEX);
    assert.equal(rebuild.record, path.join(base, 'proofs', r.task, rebuild.digest + '.json'), 'Foreign rebuild proof');
    const registration = read(rebuild.record),
      bytes = readFileSync(rebuild.record);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), rebuild.digest, 'Rebuild proof bytes changed');
    assert.equal(registration.version, 1);
    assert.equal(registration.task, r.task);
    assert.equal(registration.worktree, r.proof.worktree);
    assert.equal(registration.relative, 'dist');
    assert.deepEqual(registration.identity, r.identity);
    assert.match(registration.sourceDigest, HEX);
    assert.equal(registration.producer, 'vite-build-success-v1');
    assert.deepEqual(registration.command, ['npm', 'run', 'build:app']);
    assert.equal(registration.exitCode, 0);
    return object;
  }
  function handoff(record) {
    const key = validate(record),
      release = lock();
    try {
      const i = index(),
        file = path.join(folders.pending, key + '.json'),
        done = path.join(folders.results, key + '.json');
      if (existsSync(done)) return read(done); // Never requeue a completed identity.
      if (existsSync(auditFile(key))) {
        const receipt = read(auditFile(key));
        assert.equal(receipt.key, key);
        assert.equal(receipt.task, record.task);
        assert.equal(receipt.identityDigest, record.identity.fingerprint);
        return { ...receipt, state: receipt.result };
      }
      if (existsSync(file)) {
        const old = read(file);
        assert.deepEqual(immutable(old), immutable(record), 'Handoff identity reused with changed facts');
        i.objects[key] = pendingIndex(old);
        save(indexFile, i);
        return old;
      }
      assert.deepEqual(cleanupIdentity(record.path), record.identity, 'Handoff object changed');
      const r = { ...immutable(record), key, state: 'pending', attempts: 0, nextCheck: record.notBefore };
      save(file, r);
      i.objects[key] = pendingIndex(r);
      save(indexFile, i);
      return r;
    } finally {
      release();
    }
  }
  async function run({
    verify,
    unreferenced,
    now = Date.now(),
    limit = 20,
    budgetMs = 60000,
    maxLogicalBytes = 1024 ** 3,
    apply = false,
    remove = removeSealed,
  }) {
    assert.equal(typeof verify, 'function');
    assert.equal(typeof unreferenced, 'function');
    assert.equal(typeof remove, 'function');
    assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 100);
    assert.ok(Number.isFinite(budgetMs) && budgetMs > 0 && budgetMs <= 300000);
    assert.ok(Number.isSafeInteger(maxLogicalBytes) && maxLogicalBytes > 0);
    const release = lock();
    try {
      const i = index(),
        result = {
          version: 1,
          runId: randomUUID(),
          startedAt: new Date(now).toISOString(),
          apply,
          processed: [],
          remaining: 0,
        };
      const start = Date.now();
      let selectedBytes = 0;
      const due = Object.entries(i.objects)
        .filter(([key, v]) => {
          assert.match(key, HEX);
          assert.ok(Number.isFinite(Date.parse(v.nextCheck)));
          return Date.parse(v.nextCheck) <= now;
        })
        .sort((a, b) => Date.parse(a[1].nextCheck) - Date.parse(b[1].nextCheck) || a[0].localeCompare(b[0]));
      for (const [key] of due) {
        if (result.processed.length >= limit || Date.now() - start >= budgetMs) break;
        const file = path.join(folders.pending, key + '.json'),
          done = path.join(folders.results, key + '.json');
        if (existsSync(done)) {
          const completed = read(done);
          i.results[key] = { finishedAt: completed.finishedAt };
          delete i.objects[key];
          if (existsSync(file)) unlinkSync(file);
          save(indexFile, i);
          continue;
        }
        let r,
          trusted = false;
        try {
          r = read(file);
          assert.equal(validate(r), key);
          assert.equal(r.key, key);
          assert.ok(['pending', 'moving', 'quarantined', 'deleting'].includes(r.state));
          trusted = true;
          if (selectedBytes + r.identity.bytes > maxLogicalBytes && result.processed.length) break;
          assert.ok(r.identity.bytes <= maxLogicalBytes, 'Object exceeds configured cleanup byte budget; retain');
          selectedBytes += r.identity.bytes;
          const verdict = await verify(r);
          assert.ok(verdict?.ready === true || verdict?.ready === false, 'Formal delivery proof unavailable');
          if (verdict?.ready === false) {
            if (apply) {
              r.nextCheck = new Date(now + 12 * 3600000).toISOString();
              save(file, r);
              i.objects[key] = pendingIndex(r);
              save(indexFile, i);
            }
            result.processed.push({
              key,
              task: r.task,
              state: 'deferred',
              reason: verdict.reason ?? 'Waiting for formal closure',
            });
            continue;
          }
          const quarantine = path.join(r.carrier, 'deleting');
          safePath(r.path);
          safePath(quarantine);
          let absent = false,
            deletedLogicalBytes = 0;
          if (r.state === 'pending') {
            assert.ok(!existsSync(quarantine), 'Unjournaled quarantine; retain');
            if (!existsSync(r.path)) absent = true;
            else {
              assert.deepEqual(cleanupIdentity(r.path), r.identity, 'Object changed since handoff');
              await unreferenced(r);
              assert.deepEqual(cleanupIdentity(r.path), r.identity, 'Object changed during reference check');
              if (apply) {
                r = { ...r, state: 'moving' };
                save(file, r);
                renameSync(r.path, quarantine);
                r = { ...r, state: 'quarantined' };
                save(file, r);
              }
            }
          }
          if (r.state === 'moving') {
            assert.ok(!(existsSync(r.path) && existsSync(quarantine)), 'Ambiguous interrupted move');
            if (existsSync(r.path)) {
              assert.deepEqual(cleanupIdentity(r.path), r.identity);
              await unreferenced(r);
              if (apply) renameSync(r.path, quarantine);
            } else assert.ok(existsSync(quarantine), 'Interrupted move lost both objects');
            if (apply) {
              r = { ...r, state: 'quarantined' };
              save(file, r);
            }
          }
          if (['quarantined', 'deleting'].includes(r.state)) {
            assert.ok(!existsSync(r.path), 'Original content path reused; retain both objects');
            if (existsSync(quarantine)) {
              await unreferenced({ ...r, path: quarantine });
              if (r.state === 'quarantined') {
                const sealed = snapshot(quarantine);
                assert.deepEqual(sealed.identity, r.identity, 'Quarantined object changed');
                if (apply) {
                  save(path.join(folders.inventories, key + '.json'), sealed.entries);
                  r = { ...r, state: 'deleting', inventoryDigest: hash(sealed.entries) };
                  save(file, r);
                }
              }
              if (apply) {
                const entries = read(path.join(folders.inventories, key + '.json'));
                assert.equal(hash(entries), r.inventoryDigest, 'Deletion inventory changed');
                const deleted = await remove(quarantine, entries);
                assert.ok(!existsSync(quarantine), 'Deletion did not finish');
                deletedLogicalBytes = deleted.deletedLogicalBytes;
              }
            } else absent = true;
          }
          const item = {
            key,
            task: r.task,
            state: apply ? (absent ? 'already-absent' : 'cleaned') : 'eligible',
            deletedLogicalBytes: apply ? deletedLogicalBytes : 0,
            physicalBytes: null,
            identityDigest: r.identity.fingerprint,
            hadException: Boolean(r.firstError),
            finishedAt: new Date().toISOString(),
            ...(r.notification ? { notification: r.notification } : {}),
            ...(r.firstError ? { firstFailure: path.join(folders.failures, key + '.json') } : {}),
          };
          if (apply) {
            save(done, item);
            i.results[key] = { finishedAt: item.finishedAt };
            delete i.objects[key];
            save(indexFile, i);
            unlinkSync(file);
            const inventory = path.join(folders.inventories, key + '.json');
            if (existsSync(inventory)) unlinkSync(inventory);
          }
          result.processed.push(item);
        } catch (error) {
          if (r && trusted && apply) {
            const current = read(file);
            const attempts = (current.attempts ?? 0) + 1;
            const message = String(error.message);
            const firstFile = path.join(folders.failures, key + '.json');
            if (!existsSync(firstFile))
              save(firstFile, {
                version: 1,
                key,
                task: current.task,
                identity: current.identity,
                sourceManifest: path.join(current.carrier, 'manifest.json'),
                firstError: current.firstError ?? { message, occurredAt: new Date(now).toISOString() },
              });
            const first = read(firstFile);
            assert.equal(first.key, key);
            assert.equal(first.task, current.task);
            assert.deepEqual(first.identity, current.identity);
            const delay = Math.min(7 * 24, 12 * 2 ** Math.min(attempts - 1, 4)) * 3600000;
            let notification =
              current.lastError === message && current.notification
                ? current.notification
                : { state: 'pending', id: randomUUID(), occurredAt: new Date(now).toISOString() };
            const notificationFile = path.join(folders.notifications, notification.id + '.json');
            if (existsSync(notificationFile)) {
              const stored = read(notificationFile);
              assert.equal(stored.key, key);
              assert.equal(stored.id, notification.id);
              if (stored.state === 'acknowledged')
                notification = { ...notification, state: 'acknowledged', receipt: stored.receipt };
            }
            const blocked = {
              ...current,
              attempts,
              nextCheck: new Date(now + delay).toISOString(),
              lastError: message,
              firstError: first.firstError,
              notification,
            };
            if (notification.state === 'pending') {
              save(notificationFile, {
                key,
                task: current.task,
                id: notification.id,
                state: 'pending',
                occurredAt: notification.occurredAt,
                attempts,
                reason: message,
                nextCheck: blocked.nextCheck,
              });
              i.notifications ??= {};
              i.notifications[notification.id] = key;
            }
            save(file, blocked);
            i.objects[key] = { ...pendingIndex(blocked), exception: attempts >= 3 };
            save(indexFile, i);
          }
          if (!trusted && apply) {
            i.integrity ??= {};
            const noticeFile = path.join(folders['system-notices'], key + '.json'),
              reason = String(error.message);
            const old = existsSync(noticeFile) ? read(noticeFile) : null;
            if (old) assert.equal(old.key, key);
            const notice =
              old?.reason === reason
                ? old
                : {
                    key,
                    id: randomUUID(),
                    task: 'cleanup-integrity',
                    reason,
                    state: 'pending',
                    occurredAt: new Date(now).toISOString(),
                  };
            const firstFile = path.join(folders.failures, 'integrity-' + key + '.json');
            if (!existsSync(firstFile)) save(firstFile, { ...notice, sourcePending: file });
            save(noticeFile, notice);
            if (i.objects[key]) delete i.objects[key].notification;
            if (notice.state === 'pending') i.integrity[key] = notice.id;
            save(indexFile, i);
          }
          result.processed.push({
            key,
            task: trusted ? r?.task : null,
            state: 'blocked',
            reason: String(error.message),
          });
        }
      }
      result.remaining = Object.keys(i.objects).length;
      result.finishedAt = new Date().toISOString();
      save(path.join(base, 'last-run.json'), result);
      return result;
    } finally {
      release();
    }
  }
  function pendingNotifications({ limit = 20 } = {}) {
    assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 100);
    const release = lock();
    try {
      const i = index(),
        events = [];
      for (const [id, key] of Object.entries(i.notifications ?? {}).slice(0, limit)) {
        assert.match(id, UUID);
        assert.match(key, HEX);
        const notice = read(path.join(folders.notifications, id + '.json'));
        assert.equal(notice.key, key);
        assert.equal(notice.id, id);
        if (notice.state === 'acknowledged') {
          delete i.notifications[id];
          save(indexFile, i);
          continue;
        }
        assert.equal(notice.state, 'pending');
        events.push(notice);
      }
      for (const [key, id] of Object.entries(i.integrity ?? {})) {
        if (events.length >= limit) break;
        assert.match(key, HEX);
        const notice = read(path.join(folders['system-notices'], key + '.json'));
        assert.equal(notice.key, key);
        assert.equal(notice.id, id);
        if (notice.state === 'acknowledged') {
          delete i.integrity[key];
          save(indexFile, i);
          continue;
        }
        assert.equal(notice.state, 'pending');
        events.push({ key, id, task: 'cleanup-integrity', reason: notice.reason, occurredAt: notice.occurredAt });
      }
      return events;
    } finally {
      release();
    }
  }
  // This records a trusted delivery adapter's receipt; a shaped receipt alone is not proof of delivery.
  function acknowledgeNotification({ key, id, receipt }) {
    assert.match(key, HEX);
    assert.ok(typeof id === 'string' && id);
    for (const field of ['provider', 'destination', 'messageId'])
      assert.ok(typeof receipt?.[field] === 'string' && receipt[field].trim());
    assert.ok(Number.isFinite(Date.parse(receipt.deliveredAt)));
    const release = lock();
    try {
      const i = index(),
        file = path.join(folders.pending, key + '.json');
      if (i.notifications?.[id] === key) {
        assert.match(id, UUID);
        const noticeFile = path.join(folders.notifications, id + '.json'),
          notice = read(noticeFile);
        assert.equal(notice.key, key);
        assert.equal(notice.id, id);
        assert.equal(notice.state, 'pending');
        save(noticeFile, { ...notice, state: 'acknowledged', receipt });
        delete i.notifications[id];
        if (existsSync(file)) {
          try {
            const current = read(file);
            if (current.notification?.id === id) {
              current.notification = { ...current.notification, state: 'acknowledged', receipt };
              save(file, current);
              if (i.objects[key]) i.objects[key] = { ...pendingIndex(current), exception: current.attempts >= 3 };
            }
          } catch {
            /* The independent receipt remains durable; never rewrite a corrupt object journal. */
          }
        }
        save(indexFile, i);
        return { acknowledged: true, key, id };
      }
      if (i.integrity?.[key] === id) {
        const noticeFile = path.join(folders['system-notices'], key + '.json'),
          notice = read(noticeFile);
        assert.equal(notice.key, key);
        assert.equal(notice.id, id);
        assert.equal(notice.state, 'pending');
        save(noticeFile, { ...notice, state: 'acknowledged', receipt });
        delete i.integrity[key];
        save(indexFile, i);
        return { acknowledged: true, key, id };
      }
      if (!i.objects[key] || !existsSync(file)) return { acknowledged: false, reason: 'Object no longer pending' };
      const r = read(file);
      if (r.notification?.state !== 'pending' || r.notification.id !== id)
        return { acknowledged: false, reason: 'Stale notification receipt' };
      r.notification = { ...r.notification, state: 'acknowledged', receipt };
      save(file, r);
      i.objects[key] = { ...pendingIndex(r), exception: r.attempts >= 3 };
      save(indexFile, i);
      return { acknowledged: true, key, id };
    } finally {
      release();
    }
  }
  // Metadata-only compaction. No default expiry is enabled: callers must supply the approved cutoff.
  function compact({ detailsBefore, keepLatest, limit = 100 }) {
    const cutoff = Date.parse(detailsBefore);
    assert.ok(Number.isFinite(cutoff));
    assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000);
    assert.ok(keepLatest === undefined || (Number.isSafeInteger(keepLatest) && keepLatest >= 0));
    const release = lock();
    try {
      const i = index(),
        removed = [];
      const ordered = Object.entries(i.results).sort(
        (a, b) => a[1].finishedAt.localeCompare(b[1].finishedAt) || a[0].localeCompare(b[0]),
      );
      const excess = keepLatest === undefined ? 0 : Math.max(0, ordered.length - keepLatest);
      for (const [position, [key, entry]] of ordered.entries()) {
        if (removed.length >= limit) break;
        assert.match(key, HEX);
        assert.ok(Number.isFinite(Date.parse(entry.finishedAt)));
        if (Date.parse(entry.finishedAt) >= cutoff && position >= excess) continue;
        assert.ok(!i.objects[key], 'Pending object cannot lose its detail');
        const file = path.join(folders.results, key + '.json');
        if (entry.compacted && !existsSync(file)) {
          const audit = read(auditFile(key));
          assert.equal(audit.key, key);
          assert.equal(audit.finishedAt, entry.finishedAt);
          assert.ok(['cleaned', 'already-absent'].includes(audit.result));
          assert.equal(hash(audit), entry.auditDigest, 'Interrupted compact audit changed; retain index');
          delete i.results[key];
          save(indexFile, i);
          removed.push(key);
          continue;
        }
        const record = read(file);
        assert.equal(record.key, key);
        assert.ok(['cleaned', 'already-absent'].includes(record.state));
        assert.equal(record.finishedAt, entry.finishedAt);
        const receipt = {
          version: 1,
          key,
          task: record.task,
          objectDigest: key,
          identityDigest: record.identityDigest,
          finishedAt: record.finishedAt,
          result: record.state,
          deletedLogicalBytes: record.deletedLogicalBytes,
          physicalBytes: record.physicalBytes,
          hadException: record.hadException,
          ...(record.firstFailure ? { firstFailure: record.firstFailure } : {}),
          ...(record.notification ? { notification: record.notification } : {}),
        };
        assert.match(receipt.task, ID);
        assert.match(receipt.identityDigest, HEX);
        assert.ok(Number.isSafeInteger(receipt.deletedLogicalBytes) && receipt.deletedLogicalBytes >= 0);
        assert.equal(receipt.physicalBytes, null);
        const minimal = auditFile(key);
        safePath(path.dirname(minimal));
        mkdirSync(path.dirname(minimal), { recursive: true, mode: 0o700 });
        if (existsSync(minimal))
          assert.deepEqual(read(minimal), receipt, 'Compact audit identity differs; retain details');
        else save(minimal, receipt);
        const month = record.finishedAt.slice(0, 7),
          sum = i.summary[month] ?? { objects: 0, deletedLogicalBytes: 0, physicalBytes: null };
        if (!entry.compacted) {
          sum.objects++;
          sum.deletedLogicalBytes += record.deletedLogicalBytes;
          i.summary[month] = sum;
          i.results[key] = { ...entry, compacted: true, auditDigest: hash(receipt) };
          save(indexFile, i);
        }
        // A compacted marker makes interrupted detail removal safe to resume without double counting.
        unlinkSync(file);
        delete i.results[key];
        save(indexFile, i);
        removed.push(key);
      }
      return { removed: removed.length, summary: i.summary };
    } finally {
      release();
    }
  }
  return { handoff, run, compact, pendingNotifications, acknowledgeNotification, base };
}
