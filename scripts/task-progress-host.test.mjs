import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProgressHost, holdProgressTransport, notifyProgressHost } from './task-progress-host.mjs';
import { createProgressOutbox } from './task-progress-outbox.mjs';
import { openCompletion, completionStage, saveCompletion } from './completion-session.mjs';
import { runCompletionWithProgress } from './task-completion-progress.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'progress-host-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'task-progress', 'fixture');
  return { root, directory };
}
function transport() {
  let stored = null;
  const sent = [];
  return {
    sent,
    read: async (task, id) =>
      stored?.receipt_id === id
        ? { task_id: task, receipt_id: id, status: 'applied', revision: 2, applied_revision: 2, receipt: stored }
        : { task_id: task, receipt_id: id, status: 'not_found', revision: 1 },
    apply: async (request) => {
      stored = request.receipt;
      sent.push(stored);
    },
  };
}
test('one-receipt bounded native chunks finish readback before starting the next original fact', async (t) => {
  const f = fixture(t),
    adapter = transport(),
    box = createProgressOutbox(f.directory);
  const host = createProgressHost(adapter, { directory: f.directory, drainLimit: 1, drainTimeoutMs: 30000 });
  const original = ['one', 'two', 'three'].map((key) => box.enqueue('fixture', key, { event: 'started' }).receipt_id);
  await host.run(async () => {
    host.notify(f.directory);
    for (let i = 0; i < original.length; i++) {
      await host.drain();
      assert.deepEqual(
        adapter.sent.map((receipt) => receipt.receipt_id),
        original.slice(0, i + 1),
      );
      assert.equal(box.read().acknowledged.length, i + 1);
      assert.equal(box.read().pending.length, original.length - i - 1);
    }
  });
  for (const drainLimit of [0, -1, 1.5, 129]) assert.throws(() => createProgressHost(adapter, { drainLimit }));
  assert.throws(() => createProgressHost(adapter, { drainLimit: 1, drainTimeoutMs: 30001 }));
});
test('injected stage drains started before synchronous work, preserving ordinary no-host operation', async (t) => {
  const f = fixture(t),
    adapter = transport(),
    host = createProgressHost(adapter, { directory: f.directory }),
    session = path.join(f.root, 'task-delivery', 'fixture'),
    state = openCompletion(session, 'fixture');
  await host.run(() =>
    completionStage(
      state,
      'push',
      'candidate',
      () => {
        assert.equal(adapter.sent[0].event, 'started');
        return { ok: true };
      },
      { save: (s) => saveCompletion(session, s) },
    ),
  );
  await host.drain();
  assert.equal(adapter.sent.length, 2);
  assert.equal(createProgressOutbox(f.directory).read().pending.length, 0);
});
test('bounded unavailable transport keeps original receipt and stage error; protected holds never send', async (t) => {
  const f = fixture(t),
    box = createProgressOutbox(f.directory),
    host = createProgressHost(
      { read: () => new Promise(() => {}), apply: () => assert.fail('no write') },
      { directory: f.directory, drainTimeoutMs: 20 },
    );
  box.enqueue('fixture', 'one', { event: 'started' });
  await host.run(async () => {
    notifyProgressHost(f.directory);
    const before = Date.now();
    await host.drain();
    assert.ok(Date.now() - before < 1000);
    assert.equal(box.read().pending.length, 1);
    const release = holdProgressTransport();
    assert.equal((await host.drain()).state, 'deferred-protected');
    release();
  });
  assert.equal(box.read().pending.length, 1);
});
test('one-task completion wrapper reports receipt status independently and rejects foreign directories', async (t) => {
  const f = fixture(t);
  mkdirSync(f.root, { recursive: true });
  const registry = { commonDir: f.root, resolve: () => ({ id: 'fixture', worktree: f.root }) };
  const result = await runCompletionWithProgress(
    {
      root: f.root,
      args: ['status'],
      call: async () => {
        throw Error('offline');
      },
    },
    {
      registry,
      command: async () => {
        createProgressOutbox(f.directory).enqueue('fixture', 'fact', { event: 'completed' });
        notifyProgressHost(f.directory);
        return { source: 'delivered' };
      },
    },
  );
  assert.deepEqual(result.completion, { source: 'delivered' });
  assert.equal(result.progress.state, 'pending');
  assert.equal(result.progress.pending, 1);
  const host = createProgressHost(transport(), { directory: f.directory });
  assert.throws(() => host.notify(path.join(f.root, 'other')), /another task/);
  await assert.rejects(
    runCompletionWithProgress(
      { root: f.root, args: ['deliver'], call: async () => {} },
      {
        registry,
        command: async () => {
          throw Error('real gate failed');
        },
      },
    ),
    (error) => error.message === 'real gate failed' && error.progressDelivery.pending === 1,
  );
});
test('explicit drain consumes its scheduled kick and never self-retries a failed unchanged fact', async (t) => {
  const f = fixture(t);
  let reads = 0;
  const host = createProgressHost(
    {
      read: async () => {
        reads++;
        throw Error('offline');
      },
      apply: () => assert.fail('no write'),
    },
    { directory: f.directory },
  );
  await host.run(async () => {
    createProgressOutbox(f.directory).enqueue('fixture', 'one', { event: 'started' });
    notifyProgressHost(f.directory);
    await host.drain();
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.equal(createProgressOutbox(f.directory).read().pending.length, 1);
});
test('deferred completion emits only a wait receipt and never requests or submits delivery_complete', async (t) => {
  const f = fixture(t),
    registry = { commonDir: f.root, resolve: () => ({ id: 'fixture', worktree: f.root }) };
  let completedReads = 0;
  const result = await runCompletionWithProgress(
    {
      root: f.root,
      args: ['deliver', 'fixture', 'a'.repeat(40)],
      completionOptions: { deferSettle: true },
      call: async () => {
        throw Error('isolated transport unavailable');
      },
    },
    {
      registry,
      readClosedSource: () => {
        completedReads++;
        throw Error('must not request completed source');
      },
      command: async (_root, _args, options) => {
        assert.equal(options.deferSettle, true);
        return {
          status: 'deferred',
          formalDeliveryComplete: false,
          main: 'b'.repeat(40),
          runId: '42',
          deferredAt: new Date().toISOString(),
        };
      },
    },
  );
  assert.equal(result.completion.formalDeliveryComplete, false);
  assert.equal(completedReads, 0);
  const receipts = createProgressOutbox(f.directory)
    .read()
    .pending.map((e) => e.receipt);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].next.kind, 'wait');
  assert.equal(receipts[0].next.label, '外部周期验收待完成');
  assert.ok(receipts.every((r) => r.stage_fact?.kind !== 'delivery_complete'));
  assert.ok(!result.progress.placements.some((p) => p.kind === 'delivery_complete'));
});
