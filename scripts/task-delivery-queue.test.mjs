import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskDeliveryQueue } from './task-delivery-queue.mjs';
function fixture(t, dependencies = {}) {
  const common = mkdtempSync(path.join(tmpdir(), 'task-delivery-queue-'));
  t.after(() => rmSync(common, { recursive: true, force: true }));
  return createTaskDeliveryQueue(common, { notify: () => {}, ...dependencies });
}
const source = (task) => ({ task, owner: 'chat-' + task, accepted: 'a'.repeat(40), head: 'b'.repeat(40) });
test('independent tasks queue FIFO while development takes no main lease', async (t) => {
  let releaseWait;
  const queue = fixture(t, {
    tick: () =>
      new Promise((resolve) => {
        releaseWait = resolve;
      }),
  });
  const a = await queue.enqueue(source('a')),
    b = await queue.enqueue(source('b'));
  const runningA = await queue.wait(a);
  await queue.markMainMutation(runningA);
  let bStarted = false;
  const pendingB = queue.wait(b).then((turn) => {
    bStarted = true;
    return turn;
  });
  await Promise.resolve();
  assert.equal(bStarted, false);
  assert.equal(queue.inspect().tickets[0].task, 'a');
  await queue.finish(runningA, { success: true });
  releaseWait();
  const runningB = await pendingB;
  assert.equal(bStarted, true);
  await queue.finish(runningB, { success: true });
  assert.equal(queue.inspect().tickets.length, 0);
});
test('pre-merge failure releases the queue but a partial main mutation stays protected for owned recovery', async (t) => {
  const queue = fixture(t),
    a = await queue.enqueue(source('a'));
  let turn = await queue.wait(a);
  await queue.finish(turn, { success: false, error: Error('preflight failed') });
  assert.equal(queue.inspect().tickets.length, 0);
  const again = await queue.enqueue(source('a'));
  turn = await queue.wait(again);
  await queue.markMainMutation(turn);
  await queue.finish(turn, { success: false, error: Error('main handoff incomplete') });
  assert.equal(queue.inspect().tickets[0].status, 'blocked');
  const resumed = await queue.wait(await queue.enqueue(source('a')));
  assert.equal(resumed.accepted, again.accepted);
  assert.equal(resumed.mainMutationStarted, true);
  await queue.finish(resumed, { success: true });
  assert.equal(queue.inspect().tickets.length, 0);
});
test('queue cannot replace the frozen task, finish another ticket or release a changed lease', async (t) => {
  const queue = fixture(t),
    a = await queue.enqueue(source('a')),
    running = await queue.wait(a);
  await assert.rejects(() => queue.enqueue({ ...source('a'), accepted: 'c'.repeat(40) }), /original accepted/);
  await assert.rejects(() => queue.markMainMutation({ ...running, owner: 'other' }), /ticket changed/);
  await assert.rejects(
    () => queue.finish({ ...running, lease: { ...running.lease, token: 'stale' } }, { success: true }),
    /lease changed/,
  );
  await queue.finish(running, { success: true });
});
