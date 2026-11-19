import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  correct039DeliveryPause,
  nativeBoardProof,
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
function boardProofWithAppliedReceipt() {
  const f = boardProof();
  const receipt = {
    action: { id: 'fixture:development', label: 'Development ready' },
    event: 'completed',
    evidence_refs: ['fixture:development-evidence'],
    next: { kind: 'action', label: 'Prepare delivery' },
    observed_at: '2026-01-01T00:00:00.000Z',
    receipt_id: 'fixture-applied-review-receipt',
    sequence: 5,
    stage_fact: {
      conditions: { development_complete: true, no_known_defects: true, verification_passed: true },
      kind: 'development_ready',
      references: { candidate: 'fixture-head', verification: 'fixture-report' },
    },
    task_id: task039,
    version: 1,
  };
  const latest = f.progress.history.at(-1);
  latest.snapshot.progress_receipt = {
    receipt: { version: receipt.version, ...receipt },
    payload: JSON.stringify(receipt),
  };
  f.applied = {
    version: 1,
    receipt_id: receipt.receipt_id,
    outcome: 'applied',
    applied_revision: 6,
    receipt: structuredClone(receipt),
    task: f.board,
  };
  f.progress.readAppliedReceipt = (id) => {
    assert.equal(id, receipt.receipt_id);
    return f.applied;
  };
  return f;
}

test('latest Site progress annotation accepts its exact independent applied receipt', () => {
  const f = boardProofWithAppliedReceipt();
  const original = structuredClone(f.progress.history);
  assert.doesNotThrow(() => validate039Board(f.progress, f.board));
  assert.deepEqual(f.progress.history, original);
});

const nativeCheckedAt = '2026-01-01T00:01:00.000Z';
function nativeObservationsFor(f) {
  const observation = (operation, args, data) => ({
    operation,
    args,
    observedAt: nativeCheckedAt,
    provider: 'codex-native-task-board',
    result: { isError: false, content: [{ type: 'text', text: JSON.stringify(data) }] },
  });
  const args = { id: task039 };
  const history = f.progress.history.map((event) => ({ ...event, snapshot: JSON.stringify(event.snapshot) }));
  const observations = [
    observation('get_task_by_id', args, f.board),
    observation('task_history', args, history),
    ...f.progress.receipts.map((seen) =>
      observation('get_task_progress_receipt', { ...args, receipt_id: seen.receipt_id }, seen),
    ),
  ];
  if (f.applied) {
    const receipt_id = f.progress.history.at(-1).snapshot.progress_receipt.receipt.receipt_id;
    observations.push(observation('get_task_progress_receipt', { ...args, receipt_id }, f.applied));
  }
  return observations;
}

test('published native proof keeps four observations for an ordinary latest revision', () => {
  const f = boardProof();
  const observations = nativeObservationsFor(f);
  assert.deepEqual(nativeBoardProof(observations, nativeCheckedAt), f.board);
  const applied = boardProofWithAppliedReceipt();
  assert.throws(
    () => nativeBoardProof([...observations, nativeObservationsFor(applied).at(-1)], nativeCheckedAt),
    /without an applied receipt/,
  );
});

test('published native proof checks the fifth observation and preserves original history bytes', async (t) => {
  const f = boardProofWithAppliedReceipt();
  const observations = nativeObservationsFor(f);
  const bytes = JSON.stringify(observations);
  assert.deepEqual(nativeBoardProof(observations, nativeCheckedAt), f.board);
  assert.equal(JSON.stringify(observations), bytes);

  for (const [name, change, error] of [
    ['missing readback', (items) => items.pop(), /One exact native board/],
    [
      'foreign task observation',
      (items) => {
        items.at(-1).args.id = 'other-task';
      },
      /One exact native board/,
    ],
    [
      'wrong receipt argument',
      (items) => {
        items.at(-1).args.receipt_id = 'different-id';
      },
      /One exact native board/,
    ],
    [
      'stale native observation',
      (items) => {
        items.at(-1).observedAt = '2025-12-31T23:59:59.999Z';
      },
      /Fresh native board/,
    ],
    [
      'tool failure',
      (items) => {
        items.at(-1).result.isError = true;
      },
      /true !== false/,
    ],
    [
      'duplicate observation',
      (items) => {
        items[3] = structuredClone(items[4]);
      },
      /One exact native board/,
    ],
  ]) {
    await t.test(name, () => {
      const copy = structuredClone(observations);
      change(copy);
      assert.throws(() => nativeBoardProof(copy, nativeCheckedAt), error);
    });
  }
});

test('independent applied receipt must match identity, version, snapshot and original bytes', async (t) => {
  for (const [name, change, error] of [
    [
      'invalid tool version',
      (f) => {
        f.applied.version = 2;
      },
      /2 !== 1/,
    ],
    [
      'wrong returned receipt ID',
      (f) => {
        f.applied.receipt_id = 'different-id';
      },
      /applied receipt identity differs/,
    ],
    [
      'not applied',
      (f) => {
        f.applied.outcome = 'not_found';
      },
      /not_found/,
    ],
    [
      'wrong applied revision',
      (f) => {
        f.applied.applied_revision = 5;
      },
      /different revision/,
    ],
    [
      'changed task projection',
      (f) => {
        f.applied.task = { ...f.board, current_work: 'other work' };
      },
      /exact current board disagree/,
    ],
    [
      'different receipt contents',
      (f) => {
        f.applied.receipt.next.label = 'Changed';
      },
      /receipt differs from history/,
    ],
    [
      'noncanonical raw payload',
      (f) => {
        const record = f.progress.history.at(-1).snapshot.progress_receipt;
        record.payload = JSON.stringify(record.receipt, null, 2);
      },
      /payload bytes differ/,
    ],
    [
      'different raw payload contents',
      (f) => {
        f.progress.history.at(-1).snapshot.progress_receipt.payload = '{"sequence":999}';
      },
      /payload bytes differ/,
    ],
    [
      'changed unrelated snapshot field',
      (f) => {
        f.progress.history.at(-1).snapshot.current_work = 'other work';
      },
      /Full history and exact current board disagree/,
    ],
    [
      'unrecognized annotation data',
      (f) => {
        f.progress.history.at(-1).snapshot.progress_receipt.extra = 'other';
      },
      /payload.*receipt/s,
    ],
  ]) {
    await t.test(name, () => {
      const f = boardProofWithAppliedReceipt();
      change(f);
      assert.throws(() => nativeBoardProof(nativeObservationsFor(f), nativeCheckedAt), error);
    });
  }
});

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
