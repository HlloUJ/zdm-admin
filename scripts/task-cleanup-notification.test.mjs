import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  flushCleanupNotifications,
  cleanupNotice,
  cleanupNoticeState,
  claimCleanupNotice,
  acknowledgeCleanupNotice,
  nativeCommentaryCleanupEnvelope,
} from './task-cleanup-notification.mjs';
function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-notice-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const event = { key: 'a'.repeat(64), id: 'event-1', task: 'fixture', reason: 'live reference' };
  const acknowledgements = [],
    sends = [];
  let acknowledged = false,
    failAck = false;
  const queue = {
    base,
    pendingNotifications: () => (acknowledged ? [] : [event]),
    acknowledgeNotification: (r) => {
      if (failAck) throw Error('ack interrupted');
      acknowledgements.push(r);
      acknowledged = true;
    },
  };
  const adapter = {
    destination: 'fixed-channel',
    readThread: async () => ({ thread: { id: 'fixed-channel' } }),
    sendMessage: async (request) => {
      sends.push(request);
      return { messageId: 'message-1' };
    },
    readMessage: async () => ({ messageId: 'message-1', roomId: 'fixed-channel', text: sends[0].text }),
  };
  return {
    queue,
    adapter,
    acknowledgements,
    sends,
    failAck: (value) => {
      failAck = value;
    },
  };
}
test('missing local transport is explicitly unknown and never invents delivered status', async (t) => {
  const f = fixture(t);
  assert.equal((await flushCleanupNotifications(f.queue)).status, 'unknown');
  assert.equal(f.acknowledgements.length, 0);
});
test('send and exact fixed-channel readback produce an ack only after observed delivery', async (t) => {
  const f = fixture(t);
  assert.equal((await flushCleanupNotifications(f.queue, f.adapter)).status, 'delivered');
  assert.equal(f.sends.length, 1);
  assert.equal(f.acknowledgements[0].receipt.messageId, 'message-1');
  assert.equal((await flushCleanupNotifications(f.queue, f.adapter)).status, 'idle');
});
test('unknown send or mismatched readback stays unknown and is never automatically resent', async (t) => {
  const f = fixture(t);
  const adapter = { ...f.adapter, readMessage: async () => ({ roomId: 'other-room', text: 'wrong' }) };
  assert.equal((await flushCleanupNotifications(f.queue, adapter)).status, 'unknown');
  assert.equal((await flushCleanupNotifications(f.queue, f.adapter)).status, 'unknown');
  assert.equal(f.sends.length, 1);
  assert.equal(f.acknowledgements.length, 0);
});
test('a durable successful readback receipt repairs interrupted ack without resending', async (t) => {
  const f = fixture(t);
  f.failAck(true);
  assert.equal((await flushCleanupNotifications(f.queue, f.adapter)).status, 'unknown');
  f.failAck(false);
  assert.equal((await flushCleanupNotifications(f.queue, f.adapter)).status, 'delivered');
  assert.equal(f.sends.length, 1);
  assert.equal(f.acknowledgements.length, 1);
});
function nativeFixture(t) {
  const f = fixture(t),
    event = f.queue.pendingNotifications()[0],
    notice = cleanupNotice(event),
    observation = {
      provider: 'codex-native-read_thread',
      threadId: f.adapter.destination,
      turnId: 'actual-native-turn',
      message: { id: 'actual-native-message', phase: 'commentary', text: notice.text + '\n' },
      observedAt: new Date(2000).toISOString(),
    };
  const claim = claimCleanupNotice(f.queue, event, f.adapter.destination, 1000).delivery;
  return { ...f, event, notice, observation, claim };
}
test('versioned native final-LF adapter confirms an existing claim with original text and observation intact', (t) => {
  const f = nativeFixture(t),
    envelope = nativeCommentaryCleanupEnvelope(f.event, f.observation, f.adapter.destination);
  acknowledgeCleanupNotice(f.queue, f.event, envelope, f.adapter.destination);
  const record = cleanupNoticeState(f.queue, f.event);
  assert.equal(record.status, 'delivered');
  for (const field of ['eventId', 'key', 'notificationId', 'claimedAt', 'attemptedAt', 'text', 'destination'])
    assert.equal(record[field], f.claim[field]);
  assert.deepEqual(record.readback.nativeObservation, f.observation);
  assert.equal(record.readback.text, f.notice.text + '\n');
  assert.equal(record.receipt.messageId, f.observation.message.id);
  assert.equal(record.readback.adaptation.version, 1);
  assert.equal(f.sends.length, 0);
});
for (const suffix of ['', '\n\n', '\r\n', ' \n', '\nextra'])
  test('native adapter refuses every terminator except one exact final LF: ' + JSON.stringify(suffix), (t) => {
    const f = nativeFixture(t);
    f.observation.message.text = f.notice.text + suffix;
    assert.throws(() => nativeCommentaryCleanupEnvelope(f.event, f.observation, f.adapter.destination));
    assert.equal(cleanupNoticeState(f.queue, f.event).status, 'sending');
    assert.equal(f.acknowledgements.length, 0);
    assert.equal(f.sends.length, 0);
  });
for (const difference of ['provider', 'thread', 'phase', 'body', 'event'])
  test('native observation with a different ' + difference + ' stays unacknowledged', (t) => {
    const f = nativeFixture(t);
    if (difference === 'provider') f.observation.provider = 'stdout';
    if (difference === 'thread') f.observation.threadId = 'other-thread';
    if (difference === 'phase') f.observation.message.phase = 'final';
    if (difference === 'body') f.observation.message.text = 'extra\n' + f.observation.message.text;
    if (difference === 'event')
      f.observation.message.text = f.observation.message.text.replace(f.notice.eventId, 'b'.repeat(64));
    assert.throws(() => nativeCommentaryCleanupEnvelope(f.event, f.observation, f.adapter.destination));
    assert.equal(cleanupNoticeState(f.queue, f.event).status, 'sending');
    assert.equal(f.acknowledgements.length, 0);
  });
for (const difference of ['key', 'id', 'eventId', 'messageId', 'rawMessageId', 'rawText', 'version', 'digest', 'time'])
  test('native ack revalidates exact evidence instead of trusting adapter output: ' + difference, (t) => {
    const f = nativeFixture(t),
      envelope = nativeCommentaryCleanupEnvelope(f.event, structuredClone(f.observation), f.adapter.destination);
    if (difference === 'key') envelope.key = 'c'.repeat(64);
    if (difference === 'id') envelope.id = 'other-notification';
    if (difference === 'eventId') envelope.eventId = 'c'.repeat(64);
    if (difference === 'messageId') envelope.readback.messageId = 'other-message';
    if (difference === 'rawMessageId') envelope.readback.nativeObservation.message.id = 'other-message';
    if (difference === 'rawText') envelope.readback.nativeObservation.message.text += '\n';
    if (difference === 'version') envelope.readback.adaptation.version = 2;
    if (difference === 'digest') envelope.readback.adaptation.expectedTextSha256 = 'c'.repeat(64);
    if (difference === 'time') {
      envelope.receipt.deliveredAt = new Date(0).toISOString();
      envelope.readback.nativeObservation.observedAt = envelope.receipt.deliveredAt;
    }
    const before = readFileSync(path.join(f.queue.base, 'notices', f.notice.eventId + '.json'));
    assert.throws(() => acknowledgeCleanupNotice(f.queue, f.event, envelope, f.adapter.destination));
    assert.deepEqual(readFileSync(path.join(f.queue.base, 'notices', f.notice.eventId + '.json')), before);
    assert.equal(f.acknowledgements.length, 0);
  });
test('generic readback still refuses a native final LF without an explicit versioned adapter', (t) => {
  const f = nativeFixture(t),
    envelope = nativeCommentaryCleanupEnvelope(f.event, f.observation, f.adapter.destination);
  envelope.receipt.provider = 'codex-fixed-channel-readback';
  assert.throws(() => acknowledgeCleanupNotice(f.queue, f.event, envelope, f.adapter.destination), /text differs/);
  assert.equal(f.acknowledgements.length, 0);
});
test('oversized raw native observations retain the original claim instead of writing an unreadable receipt', (t) => {
  const f = nativeFixture(t);
  f.observation.extra = 'x'.repeat(32768);
  const envelope = nativeCommentaryCleanupEnvelope(f.event, f.observation, f.adapter.destination),
    before = readFileSync(path.join(f.queue.base, 'notices', f.notice.eventId + '.json'));
  assert.throws(
    () => acknowledgeCleanupNotice(f.queue, f.event, envelope, f.adapter.destination),
    /existing notice record limit/,
  );
  assert.deepEqual(readFileSync(path.join(f.queue.base, 'notices', f.notice.eventId + '.json')), before);
  assert.equal(f.acknowledgements.length, 0);
});
test('durable native observation repairs interrupted queue ack without sending again', async (t) => {
  const f = nativeFixture(t),
    envelope = nativeCommentaryCleanupEnvelope(f.event, f.observation, f.adapter.destination);
  f.failAck(true);
  assert.throws(() => acknowledgeCleanupNotice(f.queue, f.event, envelope, f.adapter.destination), /ack interrupted/);
  f.failAck(false);
  assert.equal((await flushCleanupNotifications(f.queue, f.adapter)).status, 'delivered');
  assert.equal(f.sends.length, 0);
  assert.equal(f.acknowledgements.length, 1);
  assert.deepEqual(cleanupNoticeState(f.queue, f.event).readback.nativeObservation, f.observation);
});
test('native confirmation of a previous unknown send preserves its first failure and never resends', async (t) => {
  const f = fixture(t),
    event = f.queue.pendingNotifications()[0];
  const result = await flushCleanupNotifications(f.queue, {
    ...f.adapter,
    readMessage: async () => ({ roomId: f.adapter.destination, messageId: 'message-1', text: 'not exact' }),
  });
  assert.equal(result.status, 'unknown');
  const before = cleanupNoticeState(f.queue, event),
    observation = {
      provider: 'codex-native-read_thread',
      threadId: f.adapter.destination,
      turnId: 'actual-native-turn',
      message: { id: 'message-1', phase: 'commentary', text: cleanupNotice(event).text + '\n' },
      observedAt: new Date().toISOString(),
    };
  acknowledgeCleanupNotice(
    f.queue,
    event,
    nativeCommentaryCleanupEnvelope(event, observation, f.adapter.destination),
    f.adapter.destination,
  );
  const after = cleanupNoticeState(f.queue, event);
  assert.equal(after.reason, before.reason);
  assert.equal(after.claimedAt, before.claimedAt);
  assert.equal(after.attemptedAt, before.attemptedAt);
  assert.deepEqual(after.readback.nativeObservation, observation);
  assert.equal(f.sends.length, 1);
});
