import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function safeTimingPath(file) {
  try {
    assert.ok(!fs.lstatSync(file).isSymbolicLink(), 'Linked timing source');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
function regular(file) {
  safeTimingPath(file);
  assert.ok(fs.lstatSync(file).isFile(), 'Timing source is not a regular file');
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function stage(file, bytes) {
  const temp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  assert.deepEqual(fs.readFileSync(temp), bytes, 'Incomplete timing write');
  return temp;
}
export function atomicTimingJson(file, value) {
  safeTimingPath(file);
  if (fs.existsSync(file)) regular(file);
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const temp = stage(file, bytes);
  fs.renameSync(temp, file);
  syncDirectory(path.dirname(file));
}
export function preserveTimingSnapshot(file, bytes) {
  bytes = Buffer.from(bytes);
  if (!fs.existsSync(file)) {
    const temp = stage(file, bytes);
    try {
      fs.linkSync(temp, file);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    // This is only our newly created staging name; failed staging files remain as evidence.
    fs.unlinkSync(temp);
  }
  regular(file);
  assert.deepEqual(fs.readFileSync(file), bytes, 'Existing timing snapshot differs from original');
  const fd = fs.openSync(file, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDirectory(path.dirname(file));
}
function exitedOwner(file) {
  regular(file);
  const bytes = fs.readFileSync(file),
    owner = JSON.parse(bytes);
  assert.equal(owner.host, os.hostname(), 'Foreign timing writer; preserve owner');
  assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0, 'Unknown timing writer; preserve owner');
  try {
    process.kill(owner.pid, 0);
    return null;
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  return { bytes, identity: fs.lstatSync(file) };
}
function exitedOwnerIfPresent(file) {
  try {
    return exitedOwner(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function recoverExitedWriter(directory, file) {
  if (!exitedOwnerIfPresent(file)) return false;
  // OS-backed transaction serializes recovery only. Normal and legacy writers still share writer.lock.
  // A killed recovery process releases this lock automatically; no timeout ever proves an owner dead.
  const dbFile = path.join(directory, 'writer-recovery.sqlite');
  safeTimingPath(dbFile);
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(dbFile);
  let transaction = false;
  try {
    fs.chmodSync(dbFile, 0o600);
    db.exec('PRAGMA busy_timeout=0');
    try {
      db.exec('BEGIN IMMEDIATE');
      transaction = true;
    } catch (error) {
      if (error.errcode === 5 || error.errcode === 6) return false;
      throw error;
    }
    if (fs.existsSync(file)) {
      const prior = exitedOwnerIfPresent(file);
      if (!prior) return false;
      // Retain the exact exited lease before removing only this proven dead writer's lock.
      preserveTimingSnapshot(path.join(directory, 'exited-writer-' + digest(prior.bytes) + '.json'), prior.bytes);
      const current = fs.lstatSync(file);
      assert.equal(current.dev, prior.identity.dev);
      assert.equal(current.ino, prior.identity.ino);
      assert.deepEqual(fs.readFileSync(file), prior.bytes);
      fs.unlinkSync(file);
      syncDirectory(directory);
    }
    db.exec('COMMIT');
    transaction = false;
    return true;
  } finally {
    if (transaction) db.exec('ROLLBACK');
    db.close();
  }
}
export function timingWriterLock(directory, run) {
  safeTimingPath(path.dirname(directory));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  safeTimingPath(directory);
  assert.ok(fs.lstatSync(directory).isDirectory());
  assert.equal(fs.lstatSync(directory).mode & 0o077, 0);
  const file = path.join(directory, 'writer.lock');
  const token = randomUUID(),
    owner = Buffer.from(JSON.stringify({ pid: process.pid, host: os.hostname(), token }));
  const lease = stage(path.join(directory, 'writer-owner'), owner);
  let held = false;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        fs.linkSync(lease, file);
        held = true;
        syncDirectory(directory);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        recoverExitedWriter(directory, file);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    assert.ok(held, 'Timing writer busy; preserve owner');
    return run();
  } finally {
    if (held) {
      regular(file);
      assert.deepEqual(fs.readFileSync(file), owner, 'Timing writer ownership changed');
      fs.unlinkSync(file);
      syncDirectory(directory);
    }
    // Our private lease has no shared-name ownership and is safe to remove on an ordinary return.
    if (fs.existsSync(lease)) fs.unlinkSync(lease);
  }
}
