import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  beginDeliveryFact,
  completeDeliveryFact,
  recordCompletePlacement,
  ensureDeliveryPlacement,
} from './task-completion-placement.mjs';
import { createProgressOutbox, authenticatedBoardAdapter, flushProgress } from './task-progress-outbox.mjs';
import { runCompletionWithProgress } from './task-completion-progress.mjs';
const closed = () => ({
  batch: 'fixture',
  formalDeliveryComplete: true,
  main: 'a'.repeat(40),
  sourceReceiptDigest: 'b'.repeat(64),
  closedAt: '2026-11-16T12:00:00.000Z',
  observed_at: new Date().toISOString(),
});
function deliverySources(f) {
  return {
    directory: f.directory,
    task: { id: 'fixture', owner: 'owner', frozen: { accepted: 'a'.repeat(40) } },
    ticket: {
      lane: 'delivery',
      task: 'fixture',
      owner: 'owner',
      status: 'running',
      request: { messageId: 'real-user' },
    },
    acceptance: { batch: 'fixture', commit: 'a'.repeat(40) },
    event: { id: 'readiness', name: 'prepare', status: 'running', startedAt: 1 },
    readDevelopmentSource: async () => ({
      verified: true,
      task: 'fixture',
      owner: 'owner',
      assessment: { noKnownDefects: true },
    }),
  };
}
test('placement drains successive bounded chunks only while original receipts are confirmed in order', async (t) => {
  const f = fixture(t),
    box = createProgressOutbox(f.directory),
    stored = new Map(),
    writes = [];
  for (let i = 0; i < 6; i++) box.enqueue('fixture', 'stage-' + i, { event: 'started' });
  const original = box.read().pending.map((entry) => entry.receipt_id);
  const adapter = authenticatedBoardAdapter(async (operation, args) => {
    if (operation === 'apply_task_progress_receipt') {
      stored.set(args.receipt.receipt_id, structuredClone(args.receipt));
      writes.push(args.receipt.receipt_id);
      return {};
    }
    return {
      task: { id: 'fixture', revision: 1 + stored.size, status: 'merging', board_column: 'merging' },
      receipt_id: args.receipt_id,
      outcome: stored.has(args.receipt_id) ? 'applied' : 'not_found',
      receipt: stored.get(args.receipt_id) ?? null,
      applied_revision: stored.has(args.receipt_id) ? 1 + stored.size : null,
    };
  });
  let chunks = 0;
  const result = await ensureDeliveryPlacement(
    {
      ...deliverySources(f),
      drain: async () => {
        chunks++;
        await flushProgress(box, adapter, { limit: 1 });
      },
    },
    adapter,
  );
  assert.equal(result.state, 'current-merging-confirmed-no-write');
  assert.equal(chunks, 6);
  assert.deepEqual(writes, original);
  assert.equal(box.read().pending.length, 0);
  assert.equal(box.read().acknowledged.length, 6);
});
test('placement stops on unchanged or authenticated nonretryable pending receipts without retrying', async (t) => {
  for (const rejected of [false, true]) {
    const f = fixture(t),
      box = createProgressOutbox(f.directory);
    const first = box.enqueue('fixture', 'pending', { event: 'started' });
    if (rejected) box.fail(first.receipt_id, 'forbidden');
    let drains = 0;
    const adapter = authenticatedBoardAdapter(async (_, args) => ({
      task: { id: 'fixture', revision: 1, status: 'merging', board_column: 'merging' },
      receipt_id: args.receipt_id,
      outcome: 'not_found',
      receipt: null,
    }));
    await assert.rejects(
      ensureDeliveryPlacement(
        {
          ...deliverySources(f),
          drain: async () => {
            drains++;
          },
        },
        adapter,
      ),
      rejected ? /Rejected receipt/ : /Earlier unresolved receipt/,
    );
    assert.equal(drains, 1);
    assert.equal(box.read().pending.length, 1);
    assert.equal(box.read().acknowledged.length, 0);
  }
});
function fixture(t) {
  const common = realpathSync(mkdtempSync(path.join(tmpdir(), 'placement-source-'))),
    root = path.join(common, 'work');
  mkdirSync(root);
  t.after(() => rmSync(common, { recursive: true, force: true }));
  return { common, root, directory: path.join(common, 'task-progress', 'fixture') };
}
test('begin needs exact authorized delivery ticket and immutable acceptance; checkpoint/completed event is insufficient', () => {
  const sources = {
    task: { id: 'fixture', owner: 'owner', frozen: { accepted: 'a'.repeat(40) } },
    ticket: {
      lane: 'delivery',
      task: 'fixture',
      owner: 'owner',
      status: 'running',
      request: { messageId: 'real-user-restore' },
    },
    acceptance: { batch: 'fixture', commit: 'a'.repeat(40) },
    event: { id: 'actual-stage', name: 'prepare', status: 'running', startedAt: 1 },
  };
  assert.equal(beginDeliveryFact(sources).stage_fact.kind, 'begin_delivery');
  for (const mutate of [
    (s) => (s.ticket.status = 'queued'),
    (s) => delete s.task.frozen,
    (s) => (s.ticket.owner = 'other'),
    (s) => (s.event.name = 'checkpoint'),
  ]) {
    const s = structuredClone(sources);
    mutate(s);
    assert.throws(() => beginDeliveryFact(s));
  }
  assert.throws(() => completeDeliveryFact('fixture', { ...closed(), formalDeliveryComplete: false }));
});
test('one formal closeout creates one deterministic placement receipt; incomplete source never moves cards', async (t) => {
  const f = fixture(t),
    adapter = authenticatedBoardAdapter(async (_, args) => ({
      task: { id: 'fixture', revision: 2, status: 'merging', board_column: 'merging' },
      receipt_id: args.receipt_id,
      outcome: 'not_found',
      receipt: null,
    }));
  const input = { directory: f.directory, task: 'fixture', readClosedSource: async () => closed() };
  const first = await recordCompletePlacement(input, adapter),
    second = await recordCompletePlacement(input, adapter);
  assert.equal(first.receipt_id, second.receipt_id);
  assert.equal(createProgressOutbox(f.directory).read().pending.length, 1);
  const fact = createProgressOutbox(f.directory).read().pending[0].receipt;
  assert.equal(fact.stage_fact.kind, 'delivery_complete');
  assert.equal(fact.stage_fact.references.closeout, 'completion-receipt:' + 'b'.repeat(64) + ':close');
  await assert.rejects(
    recordCompletePlacement(
      { ...input, readClosedSource: async () => ({ ...closed(), formalDeliveryComplete: false }) },
      adapter,
    ),
  );
});
test('stable host survives successful removal of its task carrier and confirms exact final placement', async (t) => {
  const f = fixture(t);
  let stored = null,
    reads = 0,
    writes = 0;
  const call = async (operation, args) => {
    if (operation === 'apply_task_progress_receipt') {
      stored = args.receipt;
      writes++;
      return {};
    }
    reads++;
    return {
      task: {
        id: 'fixture',
        revision: stored ? 3 : 2,
        status: stored ? 'done' : 'merging',
        board_column: stored ? 'done' : 'merging',
      },
      receipt_id: args.receipt_id,
      outcome: stored ? 'applied' : 'not_found',
      receipt: stored,
      applied_revision: stored ? 3 : null,
    };
  };
  const result = await runCompletionWithProgress(
    { root: f.root, args: ['settle', 'fixture'], call },
    {
      registry: { commonDir: f.common, resolve: () => ({ id: 'fixture', worktree: f.root }) },
      readClosedSource: async () => closed(),
      command: async () => {
        rmSync(f.root, { recursive: true });
        return { source: 'fully-delivered' };
      },
    },
  );
  assert.equal(result.completion.source, 'fully-delivered');
  assert.equal(result.progress.confirmed, 1);
  assert.equal(result.progress.pending, 0);
  assert.equal(writes, 1);
  assert.ok(reads >= 3);
});
test('already accurate done board is audited without any new receipt or false old acknowledgement', async (t) => {
  const f = fixture(t);
  const result = await recordCompletePlacement(
    { directory: f.directory, task: 'fixture', readClosedSource: async () => closed() },
    authenticatedBoardAdapter(async (_, args) => ({
      task: { id: 'fixture', revision: 4, status: 'done', board_column: 'done', current_work: '已完成', next_step: '' },
      receipt_id: args.receipt_id,
      outcome: 'not_found',
      receipt: null,
    })),
  );
  assert.equal(result.status, 'current-state-confirmed-no-write');
  assert.equal(createProgressOutbox(f.directory).read().pending.length, 0);
  assert.equal(createProgressOutbox(f.directory).read().acknowledged.length, 0);
});
