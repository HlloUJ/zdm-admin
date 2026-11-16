import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flushCleanupNotifications } from './task-cleanup-notification.mjs';
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
