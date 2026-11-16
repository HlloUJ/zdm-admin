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
