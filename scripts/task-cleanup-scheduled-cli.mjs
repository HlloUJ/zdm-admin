import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupCommand, loadCleanupPolicy } from './task-cleanup-cli.mjs';
import { loadExactCleanupScope } from './delivery-repairs/task-cleanup-exact-scope.mjs';
import { cleanupSlot, CLEANUP_TIMEZONE } from './task-cleanup-schedule.mjs';
import { createCleanupQueue, safePath } from './task-cleanup-queue.mjs';
import { verifyCleanupRuntime } from './task-cleanup-runtime.mjs';
import { flushCleanupNotifications } from './task-cleanup-notification.mjs';
import { acquireCleanupLock, readRecoveredCleanupLock } from './task-cleanup-lock.mjs';

const save = (file, record) => {
  safePath(file);
  const temp = file + '.' + randomUUID();
  writeFileSync(temp, JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
};
const read = (file) => {
  safePath(file);
  const s = lstatSync(file);
  assert.ok(s.isFile() && !(s.mode & 0o077) && s.size <= 2 * 1024 ** 2, 'Scheduler journal unsafe or oversized');
  return JSON.parse(readFileSync(file));
};
const boundedText = (value, bytes) => {
  let text = Buffer.from(String(value)).subarray(0, bytes).toString('utf8');
  while (Buffer.byteLength(text) > bytes) text = text.slice(0, -1);
  return text;
};
export async function runScheduledCleanup(
  directory,
  {
    now = Date.now(),
    verifyRuntime = verifyCleanupRuntime,
    runCleanup = cleanupCommand,
    notify = flushCleanupNotifications,
    adapter,
    scopeOnly = false,
    hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  } = {},
) {
  const manifest = verifyRuntime(directory);
  assert.equal(hostTimezone, CLEANUP_TIMEZONE, 'Host timezone changed; scheduled deletion refused');
  const policy = loadCleanupPolicy(manifest.commonDir);
  if (scopeOnly) assert.ok(policy.scope && !policy.ownershipV2, 'This schedule requires exact scope');
  assert.ok(policy.scheduler, 'Explicit scheduler history and summary budgets required');
  const queue = createCleanupQueue(manifest.commonDir),
    base = queue.base;
  const scope = policy.ownershipV2 ? null : loadExactCleanupScope(manifest.commonDir, policy);
  const lockSource = (sourceHead) =>
    scope
      ? createHash('sha256')
          .update(JSON.stringify({ source: sourceHead, scope: scope.identity }))
          .digest('hex')
      : sourceHead;
  const lease = acquireCleanupLock(base, 'scheduler.lock', { source: lockSource(manifest.sourceHead) });
  const file = path.join(base, 'scheduler-state.json'),
    slot = cleanupSlot(now).scheduledAt;
  try {
    const state = existsSync(file) ? read(file) : { version: 1, recent: [] };
    assert.equal(state.version, 1);
    assert.ok(Array.isArray(state.recent));
    if (state.slot) {
      assert.ok(
        Number.isFinite(Date.parse(state.slot)) && new Date(state.slot).toISOString() === state.slot,
        'Invalid prior scheduler slot; preserve journal',
      );
      assert.ok(
        ['running', 'completed', 'blocked', 'failed', 'notification-unknown'].includes(state.status),
        'Unknown prior scheduler state',
      );
    }
    if (state.cleanupScope || (scope && state.status === 'running')) {
      assert.ok(scope, 'Scoped scheduler journal cannot enter whole-task ownership');
      scope.assertResume(state.cleanupScope);
    }
    let recovered = null;
    if (state.status === 'running' && state.lockToken) {
      recovered = readRecoveredCleanupLock(base, 'scheduler.lock', state.lockToken, lockSource(state.sourceHead));
      if (recovered) {
        const original = path.join(recovered.archive, 'scheduler-state.interrupted.json');
        if (existsSync(original)) assert.deepEqual(read(original), state, 'Interrupted scheduler state differs');
        else save(original, state);
        state.firstFailure ??= {
          slot: state.slot,
          sourceHead: state.sourceHead,
          status: 'interrupted',
          startedAt: state.startedAt,
          observedAt: new Date(now).toISOString(),
          evidence: recovered.archive,
        };
      }
    }
    if (
      state.slot &&
      ((state.status === 'running' && !recovered) ||
        Date.parse(state.slot) > Date.parse(slot) ||
        (state.slot === slot && !recovered))
    )
      return {
        status: state.status === 'running' ? 'unknown' : 'already-ran',
        slot,
        reason:
          state.status === 'running'
            ? 'Claimed slot has no exact ended-owner recovery proof; preserve unknown state'
            : 'Latest slot already claimed; no duplicate or historical backlog execution',
      };
    const started = {
      ...(scope ? { cleanupScope: scope.identity } : {}),
      slot,
      sourceHead: manifest.sourceHead,
      startedAt: new Date(now).toISOString(),
      lockToken: lease.owner.token,
      ...(recovered ? { recoveredFrom: recovered.archive, interruptedStartedAt: state.startedAt } : {}),
    };
    save(file, { ...state, ...started, status: 'running' });
    let summary;
    try {
      const result = await lease.scope(() =>
        scope
          ? runCleanup(manifest.root, ['run'], { expectedScope: scope.identity })
          : runCleanup(manifest.root, ['run-ownership']),
      );
      if (scope) scope.assertResume(result.cleanupScope);
      const notificationQueue = scope
        ? {
            ...queue,
            pendingNotifications: (options) => queue.pendingNotifications({ ...options, scope }),
          }
        : queue;
      const notices = await notify(notificationQueue, { ...adapter, destination: policy.notification?.destination });
      const metadata =
        scope || !policy.metadata
          ? { status: 'retained' }
          : queue.compact({
              detailsBefore: new Date(now - policy.metadata.retentionMs).toISOString(),
              keepLatest: policy.metadata.maxDetails,
              limit: policy.metadata.compactLimit,
            });
      summary = {
        ...started,
        status: result.processed.some((r) => r.state === 'blocked')
          ? 'blocked'
          : notices.status === 'unknown'
            ? 'notification-unknown'
            : 'completed',
        processed: result.processed.map((r) => ({ key: r.key, state: r.state })),
        remaining: result.remaining,
        ...(scope ? { observedMissing: result.observedMissing.length } : {}),
        notification: notices.status,
        metadata: metadata.removed ?? metadata.status,
      };
    } catch (error) {
      summary = {
        ...started,
        status: 'failed',
        reason: boundedText(error.message, policy.scheduler.maxSummaryBytes),
      };
    }
    summary.finishedAt = new Date().toISOString();
    const recent = [...state.recent, summary].slice(-policy.scheduler.historyLimit);
    const next = {
      version: 1,
      slot,
      status: summary.status,
      sourceHead: manifest.sourceHead,
      ...(scope ? { cleanupScope: scope.identity } : {}),
      recent,
      firstFailure:
        state.firstFailure ?? (['failed', 'blocked', 'notification-unknown'].includes(summary.status) ? summary : null),
    };
    assert.ok(
      Buffer.byteLength(JSON.stringify(next)) <= 2 * 1024 ** 2,
      'Bounded scheduler journal exceeds hard safety cap',
    );
    save(file, next);
    return summary;
  } finally {
    lease.release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const scopeOnly = process.argv[3] === '--exact-scope';
    assert.equal(process.argv.length, scopeOnly ? 4 : 3, 'scheduled cleanup requires its exact runtime directory');
    const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    assert.equal(process.argv[2], directory, 'Foreign runtime directory refused');
    const result = await runScheduledCleanup(directory, { scopeOnly });
    if (['failed', 'blocked', 'unknown', 'notification-unknown'].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    // Bounded replacement journal if JS started; an OS/Node launch failure still needs launchd observation.
    try {
      const ownDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
        base = path.dirname(path.dirname(ownDirectory));
      if (path.basename(base) === 'task-cleanup' && /^[a-f0-9]{40}$/.test(path.basename(ownDirectory))) {
        safePath(base);
        assert.equal(lstatSync(base).mode & 0o077, 0);
        save(path.join(base, 'scheduler-startup-error.json'), {
          version: 1,
          observedAt: new Date().toISOString(),
          sourceHead: path.basename(ownDirectory),
          reason: boundedText(error.message, 8192),
        });
      }
    } catch {
      /* Keep original nonzero exit; do not write through unsafe paths. */
    }
    console.error(String(error.message).slice(0, 8192));
    process.exitCode = 1;
  }
}
