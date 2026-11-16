import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupCommand, loadCleanupPolicy } from './task-cleanup-cli.mjs';
import { cleanupSlot, CLEANUP_TIMEZONE } from './task-cleanup-schedule.mjs';
import { createCleanupQueue, safePath } from './task-cleanup-queue.mjs';
import { verifyCleanupRuntime } from './task-cleanup-runtime.mjs';
import { flushCleanupNotifications } from './task-cleanup-notification.mjs';

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
    hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  } = {},
) {
  const manifest = verifyRuntime(directory);
  assert.equal(hostTimezone, CLEANUP_TIMEZONE, 'Host timezone changed; scheduled deletion refused');
  const policy = loadCleanupPolicy(manifest.commonDir);
  assert.ok(policy.scheduler, 'Explicit scheduler history and summary budgets required');
  const queue = createCleanupQueue(manifest.commonDir),
    base = queue.base;
  const lock = path.join(base, 'scheduler.lock');
  safePath(lock);
  mkdirSync(lock, { mode: 0o700 });
  const owner = { pid: process.pid, token: randomUUID() };
  save(path.join(lock, 'owner.json'), owner);
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
    if (state.slot && Date.parse(state.slot) >= Date.parse(slot))
      return {
        status: state.status === 'running' ? 'unknown' : 'already-ran',
        slot,
        reason: 'Latest slot already claimed; no duplicate or historical backlog execution',
      };
    const started = { slot, sourceHead: manifest.sourceHead, startedAt: new Date(now).toISOString() };
    save(file, { ...state, ...started, status: 'running' });
    let summary;
    try {
      const result = await runCleanup(manifest.root, ['run']);
      const notices = await notify(queue, { ...adapter, destination: policy.notification?.destination });
      const metadata = policy.metadata
        ? queue.compact({
            detailsBefore: new Date(now - policy.metadata.retentionMs).toISOString(),
            keepLatest: policy.metadata.maxDetails,
            limit: policy.metadata.compactLimit,
          })
        : { status: 'retained', reason: 'No explicit metadata expiry policy' };
      summary = {
        ...started,
        status: result.processed.some((r) => r.state === 'blocked')
          ? 'blocked'
          : notices.status === 'unknown'
            ? 'notification-unknown'
            : 'completed',
        processed: result.processed.map((r) => ({ key: r.key, state: r.state })),
        remaining: result.remaining,
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
    assert.deepEqual(read(path.join(lock, 'owner.json')), owner, 'Scheduler lock owner changed; retain');
    unlinkSync(path.join(lock, 'owner.json'));
    rmdirSync(lock);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'scheduled cleanup requires its exact runtime directory');
    const directory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    assert.equal(process.argv[2], directory, 'Foreign runtime directory refused');
    const result = await runScheduledCleanup(directory);
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
