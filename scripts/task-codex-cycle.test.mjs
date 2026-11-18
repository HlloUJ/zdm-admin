import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createProgressOutbox } from './task-progress-outbox.mjs';
import { syncCodexCycle } from './task-codex-cycle.mjs';

function fixture(t) {
  const parent = path.join(process.cwd(), '.task-runtime/cycle-tests');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(path.join(parent, 'run-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const fact = {
  event: 'completed',
  observed_at: '2026-11-16T08:00:00Z',
  action: { id: 'check', label: '真实检查' },
  evidence_refs: ['fixture:check'],
  next: { kind: 'wait', label: '后续步骤' },
};
test('periodic invocation sends a pending fact, reads back, and the next cycle makes no writes', async (t) => {
  const directory = fixture(t);
  createProgressOutbox(directory).enqueue('native-task', 'real-fact', fact);
  let saved = null,
    writes = 0;
  const call = async (op, args) => {
    if (op === 'apply_task_progress_receipt') {
      writes++;
      saved = args.receipt;
      return {};
    }
    return {
      task: { id: 'native-task', revision: saved ? 2 : 1 },
      receipt_id: args.receipt_id,
      outcome: saved ? 'applied' : 'not_found',
      receipt: saved,
      applied_revision: saved ? 2 : null,
    };
  };
  const config = { task: 'native-task', directories: [directory] };
  assert.equal((await syncCodexCycle(config, call)).status, 'confirmed');
  assert.equal((await syncCodexCycle(config, call)).outboxes[0].receipts.length, 0);
  assert.equal(writes, 1);
});
test('foreign task in a later directory refuses the whole cycle before transport', async (t) => {
  const dir = fixture(t),
    directories = [path.join(dir, 'one'), path.join(dir, 'two')];
  createProgressOutbox(directories[0]).enqueue('native-task', 'first', fact);
  createProgressOutbox(directories[1]).enqueue('other-task', 'second', fact);
  await assert.rejects(
    syncCodexCycle({ task: 'native-task', directories }, () => assert.fail('no transport')),
    /Foreign/,
  );
});
test('uncertain transport retains the original fact and does not overtake it', async (t) => {
  const dir = fixture(t),
    directories = [path.join(dir, 'one'), path.join(dir, 'two')];
  for (const directory of directories) createProgressOutbox(directory).enqueue('native-task', directory, fact);
  const result = await syncCodexCycle({ task: 'native-task', directories }, async () => {
    throw Error('offline');
  });
  assert.equal(result.status, 'needs-attention');
  assert.equal(result.outboxes.length, 1);
  for (const directory of directories) assert.equal(createProgressOutbox(directory).read().pending.length, 1);
});
