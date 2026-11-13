import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const executeAsync = promisify(execFile);
const statuses = {
  queued: '等待资源',
  starting: '准备执行',
  running: '执行中',
  stopping: '正在暂停',
  'resource-paused': '因资源暂停',
  blocked: '受阻',
  done: '阶段完成',
};
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function schedulingNotice(event, { taskLabel = event.task, timeZone = 'Asia/Shanghai' } = {}) {
  const eventId = fingerprint({
    id: event.id,
    job: event.job,
    task: event.task,
    from: event.from,
    to: event.to,
    at: event.at,
  });
  assert.ok(event.task && event.reason && Number.isFinite(event.at));
  return {
    eventId,
    task: event.task,
    taskLabel,
    ...(event.taskStableId ? { taskStableId: event.taskStableId } : {}),
    ...(Number.isInteger(event.parallelBefore) && Number.isInteger(event.parallelAfter)
      ? { parallelBefore: event.parallelBefore, parallelAfter: event.parallelAfter }
      : {}),
    stage: event.stage,
    from: event.from,
    to: event.to,
    reason: event.reason,
    at: event.at,
    title: '装点猫任务调度',
    body: `任务 ${taskLabel}：${statuses[event.from] ?? event.from} → ${statuses[event.to] ?? event.to}\n${event.reason}${Number.isInteger(event.parallelBefore) && Number.isInteger(event.parallelAfter) ? `\n并行组数：${event.parallelBefore} → ${event.parallelAfter}` : ''}\n${new Date(event.at).toLocaleString('zh-CN', { timeZone, hour12: false })}`,
  };
}
// Never interprets a successful osascript exit as a visible/read notification.
export async function submitMacNotification(notice, { execute = executeAsync } = {}) {
  const script = 'on run argv\n display notification (item 2 of argv) with title (item 1 of argv)\nend run';
  try {
    await execute('/usr/bin/osascript', ['-e', script, '--', notice.title, notice.body], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 65536,
    });
    return {
      status: 'submitted',
      transport: 'macOS-display-notification',
      eventId: notice.eventId,
      visibility: 'unverified',
    };
  } catch (error) {
    return { status: 'unknown', eventId: notice.eventId, error: error.code ?? error.message };
  }
}
// Independent channel outbox: scheduling never awaits this pump. Caller must catch pump/storage errors
// and retain safety scheduling, while exposing notification health separately.
export function createNotificationOutbox({ store, mac, board, now = Date.now, maxAttempts = 3 }) {
  assert.equal(typeof mac, 'function');
  assert.ok(board === undefined || typeof board === 'function');
  let state = store.read();
  state.notices ??= {};
  let busy = false;
  const save = (next) => {
    store.write(next);
    state = next;
  };
  // A process may have submitted a notification just before dying. Do not create duplicate popups blindly.
  const restored = structuredClone(state);
  let changed = false;
  // Local-only mode does not require or fabricate an online dashboard receipt.
  if (!board) {
    for (const record of Object.values(restored.notices)) {
      if (record.board && record.board.status !== 'disabled') {
        record.board = { ...record.board, previousStatus: record.board.status, status: 'disabled' };
        changed = true;
      }
    }
  }
  for (const record of Object.values(restored.notices))
    for (const channel of ['mac', 'board'])
      if (record[channel].status === 'sending') {
        record[channel].status = 'unknown';
        record[channel].error = 'Sender restarted before confirmed receipt';
        changed = true;
      }
  if (changed) save(restored);
  return {
    enqueue(notice) {
      assert.ok(notice.eventId && notice.task && notice.reason);
      if (state.notices[notice.eventId]) {
        assert.equal(
          fingerprint(state.notices[notice.eventId].notice),
          fingerprint(notice),
          'Event identity collision',
        );
        return false;
      }
      const next = structuredClone(state);
      next.notices[notice.eventId] = {
        notice: structuredClone(notice),
        mac: { status: 'pending', attempts: 0, nextAt: 0 },
        board: { status: board ? 'pending' : 'disabled', attempts: 0, nextAt: 0 },
      };
      save(next);
      return true;
    },
    async pump() {
      if (busy) return;
      busy = true;
      try {
        for (const id of Object.keys(state.notices))
          for (const [channel, transport] of [
            ['mac', mac],
            ['board', board],
          ]) {
            if (!transport) continue;
            let entry = state.notices[id][channel];
            if (entry.status !== 'pending' || entry.nextAt > now()) continue;
            let next = structuredClone(state);
            entry = next.notices[id][channel];
            entry.status = 'sending';
            entry.attempts++;
            save(next);
            let result;
            try {
              result = await transport(structuredClone(state.notices[id].notice));
            } catch (error) {
              result = { status: 'unknown', error: error.message };
            }
            next = structuredClone(state);
            entry = next.notices[id][channel];
            if (
              result?.eventId === id &&
              ((channel === 'mac' && result.status === 'submitted') ||
                (channel === 'board' && result.status === 'recorded' && result.receipt))
            ) {
              entry.status = result.status;
              entry.receipt = result;
            } else if (result?.status === 'not-submitted') {
              entry.status = entry.attempts >= maxAttempts ? 'failed' : 'pending';
              entry.nextAt = now() + Math.min(60000, 1000 * 2 ** entry.attempts);
              entry.error = result.error;
            } else {
              entry.status = 'unknown';
              entry.error = result?.error ?? 'Missing or mismatched transport receipt';
            }
            save(next);
          }
      } finally {
        busy = false;
      }
    },
    snapshot() {
      return structuredClone(state.notices);
    },
  };
}
