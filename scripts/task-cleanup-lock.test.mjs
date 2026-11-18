import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireCleanupLock, recoverEndedCleanupLock, readRecoveredCleanupLock } from './task-cleanup-lock.mjs';
const source = 'a'.repeat(64),
  current = { pid: process.pid, pgid: process.pid, startTime: 'exact-current-start' };
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-lock-'))),
    base = path.join(root, 'task-cleanup');
  mkdirSync(base, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, base };
}
const inspect = (pid) => (pid === process.pid ? current : null);
const noop = () => {};
function ended(f, name = 'run.lock') {
  const lease = acquireCleanupLock(f.base, name, { source, inspect, assertGone: noop }),
    file = path.join(f.base, name, 'owner.json'),
    owner = JSON.parse(readFileSync(file));
  owner.pid = 424242;
  owner.process = { pid: 424242, pgid: 424242, startTime: 'exact-old-start' };
  writeFileSync(file, JSON.stringify(owner));
  return { owner, file, lease };
}
test('exact exited owner proof is archived; current owner, reused PID and unobservable identity refuse takeover', (t) => {
  const f = fixture(t),
    lease = acquireCleanupLock(f.base, 'run.lock', { source, inspect, assertGone: noop });
  assert.throws(() => acquireCleanupLock(f.base, 'run.lock', { source, inspect, assertGone: noop }), /owner is alive/);
  lease.release();
  const old = ended(f);
  for (const probe of [
    () => ({ ...old.owner.process, startTime: 'reused-process' }),
    () => {
      throw Error('process EPERM');
    },
  ]) {
    assert.throws(
      () => recoverEndedCleanupLock(f.base, 'run.lock', { source, inspect: probe, assertGone: noop }),
      /reused|EPERM/,
    );
    assert.ok(existsSync(old.file));
  }
  const recovered = recoverEndedCleanupLock(f.base, 'run.lock', { source, inspect, assertGone: noop });
  assert.ok(existsSync(path.join(recovered.archive, 'owner.json')));
  assert.ok(!existsSync(path.dirname(old.file)));
  assert.equal(readRecoveredCleanupLock(f.base, 'run.lock', old.owner.token, source).owner.token, old.owner.token);
});
test('live or unknown deletion groups and legacy incomplete locks are preserved', (t) => {
  const f = fixture(t),
    old = ended(f);
  old.owner.event.processes = [{ token: randomUUID() }];
  writeFileSync(old.file, JSON.stringify(old.owner));
  assert.throws(
    () =>
      recoverEndedCleanupLock(f.base, 'run.lock', {
        source,
        inspect,
        assertGone: () => {
          throw Error('deletion group remains');
        },
      }),
    /group remains/,
  );
  assert.ok(existsSync(old.file));
  assert.throws(() => recoverEndedCleanupLock(f.base, 'run.lock', { source, inspect }), /Missing child journal/);
  assert.ok(existsSync(old.file));
  const g = fixture(t);
  mkdirSync(path.join(g.base, 'run.lock'), { mode: 0o700 });
  writeFileSync(path.join(g.base, 'run.lock/owner.json'), JSON.stringify({ pid: 424242, token: randomUUID() }), {
    mode: 0o600,
  });
  assert.throws(() => acquireCleanupLock(g.base, 'run.lock', { source, inspect }), /Legacy/);
  assert.ok(existsSync(path.join(g.base, 'run.lock/owner.json')));
});
test('outer scheduler recovery cannot bypass a live inner run owner and retains unknown recovery transitions', (t) => {
  const f = fixture(t),
    outer = ended(f, 'scheduler.lock'),
    inner = acquireCleanupLock(f.base, 'run.lock', { source, inspect, assertGone: noop });
  assert.throws(
    () => recoverEndedCleanupLock(f.base, 'scheduler.lock', { source, inspect, assertGone: noop }),
    /owner is alive/,
  );
  assert.ok(existsSync(outer.file));
  inner.release();
  const guard = path.join(f.base, 'scheduler.lock/recovering');
  mkdirSync(guard, { mode: 0o700 });
  assert.throws(
    () => recoverEndedCleanupLock(f.base, 'scheduler.lock', { source, inspect, assertGone: noop }),
    /recovery is owned or interrupted/,
  );
  assert.ok(existsSync(guard));
});
test('missing source or current process proof refuses before creating a new lock', (t) => {
  const f = fixture(t);
  assert.throws(() => acquireCleanupLock(f.base, 'run.lock', { source, inspect: () => null }), /identity unavailable/);
  assert.ok(!existsSync(path.join(f.base, 'run.lock')));
  const old = ended(f);
  assert.throws(
    () => recoverEndedCleanupLock(f.base, 'run.lock', { source: 'b'.repeat(64), inspect, assertGone: noop }),
    /source differs/,
  );
  assert.ok(existsSync(old.file));
});
