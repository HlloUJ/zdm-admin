import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProgressOutbox } from './task-progress-outbox.mjs';
import { deliverySyncCommand } from './task-delivery-status-sync-cli.mjs';
const task = 'isolated-replay-task';
function fixture(t) {
  const directory = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'scheduled-replay-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const box = createProgressOutbox(directory);
  const receipt = box.enqueue(task, 'tool-action-1', {
    observed_at: new Date().toISOString(),
    action: { id: 'one', label: '验证' },
    event: 'completed',
    evidence_refs: ['fixture/result'],
    next: { kind: 'wait', label: '下一步确认' },
  }).receipt;
  const record = {
    id: task,
    revision: 3,
    status: 'active',
    board_column: 'active',
    current_work: '进行中',
    next_step: '验证',
  };
  return {
    box,
    receipt,
    record,
    plan: (readback) => deliverySyncCommand('replay-plan', { directory, task, readback }),
    directory,
  };
}
test('scheduled host starts with authoritative readback then persists exact send envelope', (t) => {
  const f = fixture(t);
  assert.equal(f.plan().operation.name, 'get_task_progress_receipt');
  const p = f.plan({ receipt_id: f.receipt.receipt_id, outcome: 'not_found', receipt: null, task: f.record });
  assert.equal(p.state, 'apply-once');
  assert.equal(p.operation.arguments.revision, 3);
  assert.deepEqual(p.operation.arguments.receipt, f.receipt);
  assert.equal(p.after.name, 'get_task_progress_receipt');
  assert.equal(f.box.read().pending[0].revision, 3);
});
test('unknown/absent readback cannot ack or cause blind resend; exact success reconciles', (t) => {
  const f = fixture(t);
  assert.throws(() => f.plan({ receipt_id: f.receipt.receipt_id, outcome: 'unknown', task: f.record }));
  assert.equal(f.plan().state, 'readback-required');
  assert.throws(() =>
    f.plan({
      receipt_id: f.receipt.receipt_id,
      outcome: 'applied',
      task: f.record,
      applied_revision: 3,
      receipt: { ...f.receipt, event: 'started' },
    }),
  );
  const result = f.plan({
    receipt_id: f.receipt.receipt_id,
    outcome: 'applied',
    task: { ...f.record, revision: 4 },
    applied_revision: 4,
    receipt: f.receipt,
  });
  assert.equal(result.state, 'confirmed');
  assert.equal(f.box.read().pending.length, 0);
  assert.equal(f.plan().state, 'idle');
});
test('new scheduler turn keeps old revision and does not overtake pending receipt', (t) => {
  const f = fixture(t);
  f.plan({ receipt_id: f.receipt.receipt_id, outcome: 'not_found', receipt: null, task: f.record });
  const later = f.box.enqueue(task, 'two', { ...f.receipt, event: 'started', action: { id: 'two', label: '下一步' } });
  assert.equal(f.plan().receipt_id, f.receipt.receipt_id);
  assert.notEqual(later.receipt_id, f.receipt.receipt_id);
  assert.equal(
    f.plan({
      receipt_id: f.receipt.receipt_id,
      outcome: 'not_found',
      receipt: null,
      task: { ...f.record, revision: 9 },
    }).state,
    'needs-review',
  );
  assert.equal(f.box.read().pending[0].revision, 3);
  assert.equal(f.box.read().pending.length, 2);
});
test('another task/outcome with missing actual fields remains pending', (t) => {
  const f = fixture(t);
  assert.throws(() =>
    f.plan({
      receipt_id: f.receipt.receipt_id,
      outcome: 'not_found',
      receipt: null,
      task: { ...f.record, id: 'different' },
    }),
  );
  assert.throws(() =>
    f.plan({
      receipt_id: f.receipt.receipt_id,
      outcome: 'applied',
      receipt: f.receipt,
      applied_revision: 4,
      task: { id: task, revision: 4 },
    }),
  );
  assert.equal(f.box.read().pending.length, 1);
});
test('permanent apply rejection is durable and stops blind periodic resend', (t) => {
  const f = fixture(t);
  f.plan({ receipt_id: f.receipt.receipt_id, outcome: 'not_found', receipt: null, task: f.record });
  const failed = deliverySyncCommand('replay-error', {
    directory: f.directory,
    task,
    receipt_id: f.receipt.receipt_id,
    code: 'task_paused',
  });
  assert.equal(failed.state, 'readback-required');
  assert.equal(
    f.plan({ receipt_id: f.receipt.receipt_id, outcome: 'not_found', receipt: null, task: f.record }).state,
    'needs-review',
  );
  assert.equal(f.box.read().pending[0].failure.code, 'task_paused');
  assert.equal(f.box.read().pending.length, 1);
});
