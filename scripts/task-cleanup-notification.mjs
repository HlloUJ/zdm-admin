import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { safePath } from './task-cleanup-queue.mjs';

export function cleanupNotice(event) {
  const eventId = createHash('sha256')
    .update(event.key + ':' + event.id)
    .digest('hex');
  return { ...event, eventId, text: `任务清理受阻｜${event.task}\n${event.reason.slice(0, 4000)}\n事件：${eventId}` };
}
export function cleanupNoticeState(queue, event) {
  const notice = cleanupNotice(event),
    file = path.join(queue.base, 'notices', notice.eventId + '.json');
  safePath(file);
  if (!existsSync(file)) return { status: 'unclaimed' };
  const s = lstatSync(file);
  assert.ok(s.isFile() && !(s.mode & 0o077) && s.size <= 32768);
  const record = JSON.parse(readFileSync(file));
  assert.equal(record.eventId, notice.eventId);
  assert.equal(record.key, event.key);
  assert.equal(record.notificationId, event.id);
  assert.equal(record.text, notice.text);
  return record;
}
export function claimCleanupNotice(queue, event, destination, now = Date.now()) {
  assert.ok(typeof destination === 'string' && destination.trim());
  const notice = cleanupNotice(event),
    old = cleanupNoticeState(queue, event);
  if (old.status !== 'unclaimed') {
    assert.equal(old.destination, destination);
    return { status: old.status === 'delivered' ? 'already-delivered' : 'delivery-unknown', notice, delivery: old };
  }
  const directory = path.join(queue.base, 'notices');
  safePath(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.equal(lstatSync(directory).mode & 0o077, 0);
  const record = {
    version: 1,
    eventId: notice.eventId,
    key: event.key,
    notificationId: event.id,
    destination,
    text: notice.text,
    status: 'sending',
    attemptedAt: new Date(now).toISOString(),
    claimedAt: new Date(now).toISOString(),
  };
  try {
    writeFileSync(path.join(directory, notice.eventId + '.json'), JSON.stringify(record) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { status: 'delivery-unknown', notice };
  }
  return { status: 'send-once', notice, delivery: record };
}
export function acknowledgeCleanupNotice(queue, event, envelope, destination) {
  const notice = cleanupNotice(event),
    record = cleanupNoticeState(queue, event);
  assert.ok(['sending', 'unknown', 'delivered'].includes(record.status), 'Notification never claimed');
  assert.equal(envelope.key, event.key);
  assert.equal(envelope.id, event.id);
  assert.equal(envelope.eventId, notice.eventId);
  assert.equal(record.destination, destination);
  assert.equal(envelope.receipt?.provider, 'codex-fixed-channel-readback');
  assert.equal(envelope.receipt.destination, destination);
  assert.ok(typeof envelope.receipt.messageId === 'string' && envelope.receipt.messageId);
  assert.ok(Number.isFinite(Date.parse(envelope.receipt.deliveredAt)));
  assert.ok(
    Date.parse(envelope.receipt.deliveredAt) >= Date.parse(record.claimedAt ?? record.attemptedAt),
    'Readback predates the notification claim',
  );
  assert.equal(envelope.readback?.roomId, destination);
  assert.equal(envelope.readback.messageId, envelope.receipt.messageId);
  assert.equal(envelope.readback.text, notice.text, 'Notification readback text differs');
  const file = path.join(queue.base, 'notices', notice.eventId + '.json'),
    temp = file + '.' + randomUUID();
  safePath(file);
  writeFileSync(
    temp,
    JSON.stringify({ ...record, status: 'delivered', receipt: envelope.receipt, readback: envelope.readback }) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  renameSync(temp, file);
  return queue.acknowledgeNotification(envelope);
}

// Adapter contract follows the existing Codex host's read/send/readback boundary.
// There is deliberately no subprocess, invented HTTP endpoint or per-run chat fallback.
export async function flushCleanupNotifications(
  queue,
  { destination, readThread, sendMessage, readMessage, now = Date.now() } = {},
) {
  const events = queue.pendingNotifications();
  if (!events.length) return { status: 'idle', events: [] };
  if (!destination || ![readThread, sendMessage, readMessage].every((f) => typeof f === 'function'))
    return { status: 'unknown', reason: 'No callable fixed-channel notification transport', pending: events.length };
  const directory = path.join(queue.base, 'notices');
  safePath(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.equal(lstatSync(directory).mode & 0o077, 0);
  const read = (file) => {
    safePath(file);
    const s = lstatSync(file);
    assert.ok(s.isFile() && !(s.mode & 0o077));
    return JSON.parse(readFileSync(file));
  };
  const save = (file, record, first = false) => {
    safePath(file);
    if (first) return writeFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' });
    const temp = file + '.' + randomUUID();
    writeFileSync(temp, JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temp, file);
  };
  const results = [];
  for (const event of events) {
    const { eventId, text } = cleanupNotice(event);
    const file = path.join(directory, eventId + '.json');
    if (existsSync(file)) {
      const old = cleanupNoticeState(queue, event);
      assert.equal(old.eventId, eventId);
      assert.equal(old.destination, destination);
      if (old.status === 'delivered') {
        acknowledgeCleanupNotice(
          queue,
          event,
          { ...event, eventId, receipt: old.receipt, readback: old.readback },
          destination,
        );
        results.push({ eventId, status: 'already-delivered' });
      } else
        results.push({
          eventId,
          status: 'unknown',
          reason: 'Previous send may have reached target; automatic resend prohibited',
        });
      continue;
    }
    // Read target before claiming. A missing channel is safe to repair and try later.
    const target = await readThread(destination);
    assert.equal(target?.thread?.id, destination, 'Fixed notification channel identity differs');
    const claimed = claimCleanupNotice(queue, event, destination, now),
      claim = claimed.delivery;
    if (claimed.status !== 'send-once') {
      results.push({ eventId, status: 'unknown' });
      continue;
    }
    try {
      const sent = await sendMessage({ threadId: destination, text, eventId });
      assert.ok(typeof sent?.messageId === 'string' && sent.messageId);
      const back = await readMessage(destination, sent.messageId);
      assert.equal(back?.roomId, destination);
      assert.equal(back.messageId, sent.messageId);
      assert.equal(back.text, text);
      const receipt = {
        provider: 'codex-fixed-channel-readback',
        destination,
        messageId: sent.messageId,
        deliveredAt: new Date(now).toISOString(),
      };
      acknowledgeCleanupNotice(queue, event, { ...event, eventId, receipt, readback: back }, destination);
      results.push({ eventId, status: 'delivered' });
    } catch (error) {
      if (read(file).status !== 'delivered')
        save(file, { ...claim, status: 'unknown', reason: String(error.message).slice(0, 4000) });
      results.push({ eventId, status: 'unknown', reason: String(error.message).slice(0, 4000) });
    }
  }
  return { status: results.some((r) => r.status === 'unknown') ? 'unknown' : 'delivered', events: results };
}
