import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boardId, boundPolicy, runBound672, runtimeId } from './bound-672-progress.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const actor = 'fixture-coordinator';
const owner = 'fixture-owner';
const sequence = (number) => ({ authorId: 'fixture-user', sequence: number });
const capturedAt = '2026-01-02T00:00:00.000Z';
const queueRevision = 148;
function fixture(t) {
  const commonDir = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'bound-progress-'));
  t.after(() => rmSync(commonDir, { recursive: true, force: true }));
  const directory = path.join(commonDir, 'task-progress', runtimeId);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'outbox.json');
  const id = hash(JSON.stringify([runtimeId, 'queue:148:delivery']));
  const block = { action: 'block', task: runtimeId, lane: 'delivery', reason: 'fixture blocker' };
  const entries = Array.from({ length: 57 }, (_, i) => {
    const receipt_id = i === 56 ? id : hash('fixture-' + i);
    const receipt = {
      version: 1,
      task_id: runtimeId,
      receipt_id,
      sequence: i + 1,
      observed_at: capturedAt,
      action: { id: i === 56 ? 'queue:delivery' : 'prepare', label: i === 56 ? 'delivery' : 'prepare' },
      event: i === 56 ? 'paused' : 'started',
      next: { kind: 'wait', label: i === 56 ? '等待恢复指令' : 'fixture' },
      evidence_refs: [i === 56 ? 'execution-order:148:delivery:' + runtimeId : 'fixture:' + i],
      ...(i === 56 ? { reason: block.reason } : {}),
    };
    return { receipt_id, receipt, payload_hash: hash(JSON.stringify(receipt)), state: 'pending' };
  });
  const raw = JSON.stringify({ version: 1, pending: entries, acknowledged: [], tasks: { [runtimeId]: 57 } }) + '\n';
  writeFileSync(file, raw, { mode: 0o600 });
  const binding = { revision: 1, boardTaskId: boardId, monitoring: { taskStableId: boardId } };
  const registered = {
    id: runtimeId,
    owner,
    revision: 1,
    frozen: { accepted: 'a'.repeat(40) },
    executionBindings: [binding],
  };
  const ticket = {
    task: runtimeId,
    status: 'blocked',
    lane: 'delivery',
    owner,
    admission: 'prior',
    dynamicDecisionId: 'decision',
    reason: block.reason,
  };
  const state = {
    revision: queueRevision,
    paused: true,
    tickets: [ticket],
    events: [
      { action: 'pause-all', request: sequence(1) },
      { action: 'dispatch-applied', task: runtimeId, decisionId: 'decision', admission: 'prior', request: sequence(2) },
      block,
    ],
    dynamicDecisions: [
      {
        id: 'decision',
        status: 'consumed',
        admission: 'prior',
        bindingRevision: 1,
        input: { task: runtimeId, owner, phase: 'final', authorityId: 'authority' },
      },
    ],
    dynamicAuthorities: [{ id: 'authority', request: sequence(2), source: { tasks: [{ task: runtimeId, owner }] } }],
  };
  const policy = boundPolicy(binding, entries.slice(0, 56));
  const decisions = {
    allow: true,
    breakAfterApply: false,
    loseFirstReply: false,
    policy: true,
    manualAt: '2026-01-01T00:00:00.000Z',
  };
  const outline = {
    id: boardId,
    status: 'merging',
    deleted_at: null,
    revision: 60,
    created_at: '2026-01-01T00:00:00.000Z',
  };
  const history = Array.from({ length: 60 }, (_, i) => ({ ...outline, revision: i + 1 }));
  const applied = new Map();
  let writeCount = 0;
  const ctx = {
    registry: { commonDir, readTask: () => structuredClone(registered) },
    queue: { commonDir, read: () => structuredClone(state), guard: (work) => work() },
    readCoordination: () => ({ current: { rootThreadId: actor, request: sequence(3) } }),
    dependenciesReady: (target) => {
      assert.deepEqual(target.dependsOn, ['task-delivery-status-sync']);
      return decisions.allow;
    },
    async call(operation, args) {
      assert.equal(args.id, boardId);
      const task = {
        ...outline,
        revision: history.length,
        updated_at: history.at(-1).updated_at ?? decisions.manualAt,
      };
      if (operation === 'get_task_progress_receipt') {
        if (decisions.breakAfterApply && applied.size === 1) throw Error('fixture read interrupted');
        const seen = applied.get(args.receipt_id);
        return {
          version: 1,
          receipt_id: args.receipt_id,
          outcome: seen ? 'applied' : 'not_found',
          applied_revision: seen?.revision ?? null,
          receipt: seen?.receipt ?? null,
          task: { ...task, board_column: 'merging' },
          ...(decisions.policy && args.receipt_id !== id ? { receipt_source_binding: policy } : {}),
        };
      }
      if (operation === 'task_history')
        return history.map((entry) => ({
          task_id: boardId,
          snapshot: JSON.stringify({ updated_at: decisions.manualAt, ...entry }),
        }));
      assert.equal(operation, 'apply_task_progress_receipt');
      assert.equal(args.revision, history.length);
      assert.equal(args.receipt.sequence, applied.size + 1);
      assert.deepEqual(args.receipt, entries[applied.size].receipt);
      assert.ok(!applied.has(args.receipt.receipt_id));
      const revision = history.length + 1;
      const receipt = structuredClone(args.receipt);
      applied.set(receipt.receipt_id, { receipt, revision });
      history.push({ ...task, revision, progress_receipt: { receipt } });
      writeCount++;
      if (decisions.loseFirstReply && writeCount === 1) throw Error('fixture lost transport response');
      return { outcome: 'applied' };
    },
  };
  const archive = {
    action: 'archive',
    actor,
    attestation: {
      coordinator: actor,
      sourceRevision: 148,
      receiptId: id,
      blockSha256: hash(JSON.stringify(block)),
      outboxSha256: hash(raw),
      outcome: 'never-prepared-no-unknown-write',
    },
  };
  return {
    commonDir,
    ctx,
    file,
    raw,
    state,
    registered,
    decisions,
    entries,
    history,
    archive,
    archivePath: path.join(directory, 'retired-q148-seq57.json'),
    writes: () => writeCount,
    read: () => JSON.parse(readFileSync(file)),
    replay: () => runBound672({ action: 'replay', actor }, ctx),
  };
}

test('archives only the original false pause and sends all 56 unchanged in order', async (t) => {
  const f = fixture(t);
  await runBound672(f.archive, f.ctx);
  assert.equal(f.writes(), 0);
  assert.deepEqual(f.read().pending, f.entries.slice(0, 56));
  assert.deepEqual(f.read().acknowledged, []);
  const durable = JSON.parse(readFileSync(f.archivePath));
  assert.equal(Buffer.from(durable.originalBytes, 'base64').toString(), f.raw);
  assert.deepEqual(durable.entry, f.entries.at(-1));
  assert.equal((await runBound672(f.archive, f.ctx)).replay, true);
  f.decisions.loseFirstReply = true;
  assert.equal((await f.replay()).count, 56);
  assert.equal(f.writes(), 56);
  assert.equal((await f.replay()).count, 56);
  assert.equal(f.writes(), 56);
  assert.deepEqual(
    f.read().acknowledged.map((entry) => entry.receipt),
    f.entries.slice(0, 56).map((entry) => entry.receipt),
  );
  assert.equal(f.read().retired[0].receipt.sequence, 57);
});

test('restarts with a durable read of the original prepared packet before sending its successor', async (t) => {
  const f = fixture(t);
  await runBound672(f.archive, f.ctx);
  f.decisions.breakAfterApply = true;
  await assert.rejects(f.replay(), /fixture read interrupted/);
  assert.equal(f.writes(), 1);
  assert.equal(f.read().pending[0].revision, 60);
  f.decisions.breakAfterApply = false;
  assert.equal((await f.replay()).count, 56);
  assert.equal(f.writes(), 56);
});

for (const [label, change] of [
  [
    'missing formal source',
    (f) => {
      f.decisions.allow = false;
    },
  ],
  [
    'changed Site policy',
    (f) => {
      f.decisions.policy = false;
    },
  ],
  [
    'wrong coordinator',
    (f) => {
      f.archive.actor = 'previous';
    },
  ],
  [
    'wrong fixed binding',
    (f) => {
      f.registered.executionBindings[0].boardTaskId = 'other';
    },
  ],
  [
    'later user pause',
    (f) => {
      f.state.events.push({ action: 'pause-all', request: sequence(4) });
    },
  ],
  [
    'prepared erroneous receipt',
    (f) => {
      const state = f.read();
      state.pending.at(-1).revision = 60;
      writeFileSync(f.file, JSON.stringify(state));
    },
  ],
  [
    'gapped history',
    (f) => {
      f.history[3].revision = 10;
    },
  ],
]) {
  test('refuses ' + label + ' without changing the outbox', async (t) => {
    const f = fixture(t);
    change(f);
    const initial = readFileSync(f.file);
    await assert.rejects(runBound672(f.archive, f.ctx));
    assert.deepEqual(readFileSync(f.file), initial);
    assert.equal(f.writes(), 0);
  });
}

test('manual freshness and original bytes gate replay before preparing a write', async (t) => {
  const f = fixture(t);
  await runBound672(f.archive, f.ctx);
  f.decisions.manualAt = '2026-01-03T00:00:00.000Z';
  const before = readFileSync(f.file);
  await assert.rejects(f.replay(), /later manual board update/);
  assert.deepEqual(readFileSync(f.file), before);
  assert.equal(f.writes(), 0);
});
