import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import path from 'node:path';
import { inspectProcess } from './verification-process-identity.mjs';
import { completionDirectory, processScope, assertProcessesGone } from './completion-process.mjs';

const names = new Set(['scheduler.lock', 'run.lock']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sourceIdentity = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function safe(file) {
  assert.ok(path.isAbsolute(file) && path.resolve(file) === file, 'Canonical cleanup lock path required');
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    try {
      assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked cleanup lock refused');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (cursor === path.dirname(cursor)) break;
  }
}
function read(file) {
  safe(file);
  const s = lstatSync(file);
  assert.ok(s.isFile() && s.nlink === 1 && !(s.mode & 0o077) && s.size <= 2 * 1024 ** 2, 'Unsafe cleanup owner proof');
  return JSON.parse(readFileSync(file));
}
function save(file, value) {
  safe(file);
  const temporary = file + '.' + randomUUID(),
    fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}
function location(base, name) {
  assert.equal(path.basename(base), 'task-cleanup');
  assert.ok(names.has(name));
  safe(base);
  assert.ok(lstatSync(base).isDirectory() && !(lstatSync(base).mode & 0o077));
  return path.join(base, name);
}
function validate(owner, base, name) {
  assert.equal(owner.version, 2, 'Legacy cleanup lock lacks exact owner/subprocess proof; preserve it');
  assert.equal(owner.kind, 'task-cleanup-owner-v2');
  assert.equal(owner.base, base);
  assert.equal(owner.name, name);
  assert.equal(owner.host, hostname(), 'Foreign-host cleanup owner; retain');
  assert.match(owner.token, uuid);
  assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 1 && owner.process?.pid === owner.pid);
  assert.ok(
    Number.isSafeInteger(owner.process.pgid) &&
      owner.process.pgid > 1 &&
      typeof owner.process.startTime === 'string' &&
      owner.process.startTime.trim(),
  );
  assert.equal(owner.event?.processTracking, 1);
  assert.ok(Array.isArray(owner.event.processes));
  assert.match(owner.source, sourceIdentity);
}
function originalGone(owner, inspect) {
  const actual = inspect(owner.pid);
  assert.ok(
    !actual,
    actual?.startTime === owner.process.startTime
      ? 'EEXIST: Original cleanup owner is alive; preserve lock'
      : 'EEXIST: Cleanup owner PID is reused or unknown; preserve lock',
  );
}
function history(base, name, token) {
  assert.match(token, uuid);
  return path.join(base, 'lock-history', name, token);
}
export function readRecoveredCleanupLock(base, name, token, source) {
  location(base, name);
  const target = history(base, name, token);
  safe(target);
  if (!existsSync(target)) return null;
  const file = path.join(target, 'owner.json'),
    owner = read(file);
  validate(owner, base, name);
  assert.equal(owner.token, token);
  assert.equal(owner.source, source, 'Interrupted cleanup source differs; retain original execution');
  const recovery = read(path.join(target, 'recovered.json'));
  assert.equal(recovery.version, 1);
  assert.equal(recovery.name, name);
  assert.equal(recovery.token, token);
  assert.equal(recovery.ownerDigest, digest(readFileSync(file)));
  assert.equal(recovery.status, 'owner-and-groups-ended');
  return { archive: target, owner, recovery };
}
// Only this cleanup family's v2 locks are recoverable. No timeout, signal or PID-only takeover.
export function recoverEndedCleanupLock(
  base,
  name,
  { inspect = inspectProcess, assertGone = assertProcessesGone, source } = {},
) {
  const lock = location(base, name);
  if (!existsSync(lock)) return null;
  const stamp = lstatSync(lock);
  assert.ok(stamp.isDirectory() && !(stamp.mode & 0o077));
  const file = path.join(lock, 'owner.json');
  assert.ok(existsSync(file), 'Legacy/incomplete cleanup lock has no owner proof; preserve it');
  const bytes = readFileSync(file),
    owner = read(file);
  validate(owner, base, name);
  if (source) assert.equal(owner.source, source, 'Interrupted cleanup source differs; retain original execution');
  originalGone(owner, inspect);
  // A scheduler must not be reclaimed around a still-running deletion supervisor.
  if (name === 'scheduler.lock' && existsSync(location(base, 'run.lock')))
    recoverEndedCleanupLock(base, 'run.lock', { inspect, assertGone });
  assertGone(owner.event, lock);
  const claimant = { version: 1, host: hostname(), process: inspect(process.pid), token: randomUUID() };
  assert.ok(claimant.process?.startTime, 'Recovery owner identity unavailable');
  const guard = path.join(lock, 'recovering');
  try {
    mkdirSync(guard, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST')
      throw Error('EEXIST: Cleanup recovery is owned or interrupted; preserve its transition proof', { cause: error });
    throw error;
  }
  save(path.join(guard, 'owner.json'), claimant);
  const current = lstatSync(lock);
  assert.ok(current.dev === stamp.dev && current.ino === stamp.ino, 'Cleanup lock path changed during recovery');
  assert.deepEqual(readFileSync(file), bytes, 'Cleanup owner changed during observation');
  originalGone(owner, inspect);
  assertGone(owner.event, lock);
  const recovery = {
    version: 1,
    name,
    token: owner.token,
    status: 'owner-and-groups-ended',
    ownerDigest: digest(bytes),
    observedAt: new Date().toISOString(),
    observer: claimant,
  };
  save(path.join(lock, 'recovered.json'), recovery);
  const target = history(base, name, owner.token);
  safe(target);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  assert.ok(!existsSync(target), 'Original cleanup owner archive already exists; retain conflicting lock');
  renameSync(lock, target);
  return { archive: target, owner, recovery };
}
export function acquireCleanupLock(
  base,
  name,
  { source, inspect = inspectProcess, assertGone = assertProcessesGone } = {},
) {
  const lock = location(base, name);
  assert.match(source, sourceIdentity);
  let recovered = null;
  const identity = inspect(process.pid);
  assert.ok(identity?.startTime, 'Cleanup owner identity unavailable; no new lock acquired');
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    recovered = recoverEndedCleanupLock(base, name, { inspect, assertGone, source });
    mkdirSync(lock, { mode: 0o700 });
  }
  const event = { processTracking: 1, processes: [] },
    owner = {
      version: 2,
      kind: 'task-cleanup-owner-v2',
      base,
      name,
      host: hostname(),
      pid: process.pid,
      process: identity,
      source,
      token: randomUUID(),
      event,
    };
  const file = path.join(lock, 'owner.json'),
    state = { [completionDirectory]: lock },
    saveOwner = () => save(file, owner);
  saveOwner();
  return {
    owner,
    recovered,
    scope: (work) => processScope(state, event, saveOwner, work),
    release() {
      assert.deepEqual(read(file), owner, 'Cleanup lock owner changed; retain');
      assertGone(event, lock);
      const expected = new Set(['owner.json', ...event.processes.map((child) => 'process-' + child.token + '.json')]);
      assert.ok(
        readdirSync(lock).every((file) => expected.has(file)),
        'Unknown cleanup lock contents retained',
      );
      if (event.processes.length) {
        const target = history(base, name, owner.token);
        safe(target);
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        assert.ok(!existsSync(target), 'Cleanup process proof archive conflicts');
        renameSync(lock, target);
      } else {
        unlinkSync(file);
        rmdirSync(lock);
      }
    },
  };
}
