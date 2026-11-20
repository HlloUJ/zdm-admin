import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runScheduledCleanup } from './task-cleanup-scheduled-cli.mjs';
function fixture(t, policyPatch = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-cycle-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const commonDir = path.join(root, 'common');
  mkdirSync(path.join(commonDir, 'task-cleanup'), { recursive: true, mode: 0o700 });
  const policy = {
    version: 1,
    ownershipV2: true,
    limit: 2,
    budgetMs: 10000,
    maxLogicalBytes: 1000,
    scheduler: { historyLimit: 3, maxSummaryBytes: 256 },
    ...policyPatch,
  };
  writeFileSync(path.join(commonDir, 'task-cleanup/policy.json'), JSON.stringify(policy), { mode: 0o600 });
  const manifest = { root, commonDir, sourceHead: 'a'.repeat(40) };
  const calls = [];
  const dependencies = {
    verifyRuntime: () => manifest,
    hostTimezone: 'Asia/Shanghai',
    runCleanup: async (...args) => {
      calls.push(args);
      return { processed: [], remaining: 0 };
    },
    notify: async () => ({ status: 'idle' }),
  };
  return {
    root,
    commonDir,
    calls,
    dependencies,
    state: () => JSON.parse(readFileSync(path.join(commonDir, 'task-cleanup/scheduler-state.json'))),
  };
}
test('same slot and clock rollback never rerun; wake-up after days consumes only latest slot', async (t) => {
  const f = fixture(t),
    now = Date.parse('2026-11-16T13:00:00+08:00');
  assert.equal((await runScheduledCleanup(f.root, { ...f.dependencies, now })).status, 'completed');
  assert.equal((await runScheduledCleanup(f.root, { ...f.dependencies, now: now + 30000 })).status, 'already-ran');
  assert.equal((await runScheduledCleanup(f.root, { ...f.dependencies, now: now - 3600000 })).status, 'already-ran');
  await runScheduledCleanup(f.root, { ...f.dependencies, now: now + 3 * 86400000 + 3600000 });
  assert.equal(f.calls.length, 2);
  assert.equal(f.state().recent.length, 2);
});
test('scheduler reports bounded failure history, preserves first failure and disables implicit metadata expiry', async (t) => {
  const f = fixture(t),
    start = Date.parse('2026-11-16T13:00:00+08:00');
  for (let n = 0; n < 8; n++)
    await runScheduledCleanup(f.root, {
      ...f.dependencies,
      now: start + n * 43200000,
      runCleanup: async () => {
        throw Error(String(n) + '错'.repeat(100000));
      },
    });
  const state = f.state();
  assert.equal(state.recent.length, 3);
  assert.equal(state.firstFailure.reason[0], '0');
  assert.ok(Buffer.byteLength(state.firstFailure.reason) <= 256);
  assert.ok(JSON.stringify(state).length < 6000);
  const r = await runScheduledCleanup(f.root, { ...f.dependencies, now: start + 9 * 43200000 });
  assert.equal(r.metadata, 'retained');
});
test('concurrent scheduler keeps original lock; missing policy and timezone drift refuse execution', async (t) => {
  const f = fixture(t);
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const running = runScheduledCleanup(f.root, {
    ...f.dependencies,
    runCleanup: async () => {
      await gate;
      return { processed: [], remaining: 0 };
    },
  });
  await assert.rejects(runScheduledCleanup(f.root, f.dependencies), /EEXIST/);
  assert.ok(existsSync(path.join(f.commonDir, 'task-cleanup/scheduler.lock/owner.json')));
  release();
  await running;
  await assert.rejects(runScheduledCleanup(f.root, { ...f.dependencies, hostTimezone: 'UTC' }), /timezone/);
  const g = fixture(t, { scheduler: undefined });
  await assert.rejects(runScheduledCleanup(g.root, g.dependencies), /Explicit scheduler/);
  assert.equal(g.calls.length, 0);
});
test('missing fixed-channel transport stays notification-unknown rather than complete', async (t) => {
  const f = fixture(t);
  const r = await runScheduledCleanup(f.root, { ...f.dependencies, notify: async () => ({ status: 'unknown' }) });
  assert.equal(r.status, 'notification-unknown');
  assert.equal(f.state().firstFailure.notification, 'unknown');
});
test('a claimed running slot without matching archived ended-owner proof is never blindly replayed', async (t) => {
  const f = fixture(t),
    now = Date.parse('2026-11-17T01:00:00+08:00');
  writeFileSync(
    path.join(f.commonDir, 'task-cleanup/scheduler-state.json'),
    JSON.stringify({
      version: 1,
      slot: new Date(now).toISOString(),
      status: 'running',
      sourceHead: 'a'.repeat(40),
      lockToken: randomUUID(),
      recent: [],
    }),
    { mode: 0o600 },
  );
  const result = await runScheduledCleanup(f.root, { ...f.dependencies, now });
  assert.equal(result.status, 'unknown');
  assert.equal(f.calls.length, 0);
  assert.match(result.reason, /no exact ended-owner/);
  const later = await runScheduledCleanup(f.root, { ...f.dependencies, now: now + 43200000 });
  assert.equal(later.status, 'unknown');
  assert.equal(f.calls.length, 0);
});
