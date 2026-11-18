import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  correct039DeliveryPause,
  receipts039,
  sha256,
  task039,
  task417,
  validate039Board,
  validate039Packets,
  verify039ClientTransport,
} from './archive-039-delivery-pause.mjs';
const hash = (object) => sha256(JSON.stringify(object));
function boardProof() {
  const card = { id: task039, revision: 6, status: 'review', deleted_at: null };
  const board = { ...card, board_column: 'review' };
  const history = Array.from({ length: 6 }, (_, i) => ({ task_id: task039, snapshot: { ...card, revision: i + 1 } }));
  const receipts = receipts039.map(({ id }) => ({
    receipt_id: id,
    outcome: 'not_found',
    receipt: null,
    applied_revision: null,
    task: board,
  }));
  return { board, progress: { history, receipts } };
}
test('only full same-revision history and two exact not_found results qualify', () => {
  const f = boardProof();
  validate039Board(f.progress, f.board);
  for (const mutate of [
    (p) => p.history.shift(),
    (p) => {
      p.history[0].snapshot.revision = 2;
    },
    (p) => {
      p.history[1].snapshot.progress_receipt = { receipt: { receipt_id: receipts039[0].id } };
    },
    (p) => {
      p.receipts[1].receipt_id = receipts039[0].id;
    },
    (p) => {
      p.receipts[0].outcome = 'applied';
    },
    (p) => {
      p.receipts[1].task = { ...p.receipts[1].task, revision: 7 };
    },
  ]) {
    const x = boardProof();
    mutate(x.progress);
    assert.throws(() => validate039Board(x.progress, x.board));
  }
});
function originalPacket(i) {
  const revision = i ? 139 : 135;
  const { id, sequence } = receipts039[i];
  const payload = {
    observed_at: i ? '2026-11-18T06:53:52.749Z' : '2026-11-18T06:43:33.636Z',
    action: { id: 'queue:delivery', label: 'delivery' },
    event: 'paused',
    evidence_refs: [`execution-order:${revision}:delivery:${task039}`],
    next: { kind: 'wait', label: '等待恢复指令' },
  };
  assert.equal(hash([task039, `queue:${revision}:delivery`]), id);
  return {
    receipt_id: id,
    payload_hash: hash(payload),
    receipt: { ...payload, version: 1, task_id: task039, receipt_id: id, sequence },
    state: 'pending',
  };
}
test('exact unprepared packets qualify while submitted, changed or missing facts stay pending', () => {
  const state = {
    version: 1,
    acknowledged: [],
    pending: [
      originalPacket(0),
      ...Array.from({ length: 12 }, (_, i) => ({
        receipt: { sequence: i + 7, task_id: task039, event: 'started' },
      })),
      originalPacket(1),
    ],
  };
  assert.deepEqual(validate039Packets(state), [originalPacket(0), originalPacket(1)]);
  const raw = Buffer.from(JSON.stringify(state));
  verify039ClientTransport(raw, {
    outcome: 'never-prepared-no-unknown-write',
    outboxSha256: sha256(raw),
    receiptIds: receipts039.map(({ id }) => id),
  });
  assert.throws(() => verify039ClientTransport(raw, { outcome: 'unknown-write' }));
  for (const mutate of [
    (s) => {
      s.pending[0].revision = 6;
    },
    (s) => {
      s.pending.at(-1).failure = { code: 'write_result_unknown' };
    },
    (s) => {
      s.pending[0].receipt.observed_at = new Date().toISOString();
    },
    (s) => {
      s.pending.splice(3, 1);
    },
    (s) => {
      s.acknowledged.push(originalPacket(0));
    },
  ]) {
    const copy = structuredClone(state);
    mutate(copy);
    assert.throws(() => validate039Packets(copy));
  }
});
test('formal 417 closure is checked before any 039 operation', async (t) => {
  const commonDir = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'delivery-pause-dependency-'));
  t.after(() => rmSync(commonDir, { recursive: true, force: true }));
  const before = process.env.CODEX_THREAD_ID;
  const coordinatorThreadId = 'c5209de7-66df-4ea9-9e01-56b4bc2853bd';
  process.env.CODEX_THREAD_ID = coordinatorThreadId;
  t.after(() => {
    if (before === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = before;
  });
  const current = {
    expectedRevision: 0,
    rootThreadId: coordinatorThreadId,
    request: { messageId: 'fixture', authorId: 'user', sequence: 1 },
  };
  mkdirSync(path.join(commonDir, 'task-coordination'));
  writeFileSync(
    path.join(commonDir, 'task-coordination/current.json'),
    JSON.stringify({ version: 1, revision: 1, current, history: [current] }),
    { mode: 0o600 },
  );
  await assert.rejects(
    correct039DeliveryPause(
      { coordinatorThreadId, taskId: task039 },
      {
        registry: { commonDir },
        queue: { commonDir },
        dependenciesReady: ({ dependsOn }) => {
          assert.deepEqual(dependsOn, [task417]);
          return false;
        },
      },
    ),
    /417 formal closure required/,
  );
});
