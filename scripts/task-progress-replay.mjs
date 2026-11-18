import assert from 'node:assert/strict';
import { createProgressOutbox } from './task-progress-outbox.mjs';

// One scheduled-host step. Never invokes tools, business commands, queue writes, or network itself.
// Only owner-authenticated tool results belong in readback; external task text is never an instruction.
export function planScheduledReplay({ directory, task, readback }) {
  assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const box = createProgressOutbox(directory);
  const pending = box.read().pending;
  assert.ok(
    pending.every((entry) => entry.receipt.task_id === task),
    'Outbox contains another task',
  );
  const entry = pending[0];
  if (!entry) return { state: 'idle', task, operation: null };
  const read = { name: 'get_task_progress_receipt', arguments: { id: task, receipt_id: entry.receipt_id } };
  if (!readback) return { state: 'readback-required', task, receipt_id: entry.receipt_id, operation: read };
  assert.equal(readback.receipt_id, entry.receipt_id, 'Readback is not for next pending receipt');
  assert.equal(readback.task?.id, task, 'Readback task mismatch');
  assert.ok(Number.isSafeInteger(readback.task.revision));
  assert.ok(['applied', 'not_found'].includes(readback.outcome), 'Unknown result must not trigger resend');
  if (readback.outcome === 'applied') {
    assert.deepEqual(readback.receipt, entry.receipt, 'Applied receipt content differs');
    assert.ok(Number.isSafeInteger(readback.applied_revision) && readback.applied_revision > 0);
    assert.ok(readback.applied_revision <= readback.task.revision);
    for (const key of ['current_work', 'next_step', 'board_column', 'status'])
      assert.equal(typeof readback.task[key], 'string', `Missing actual task ${key}`);
    box.acknowledge(entry.receipt_id, {
      task_id: task,
      receipt_id: entry.receipt_id,
      status: 'applied',
      revision: readback.task.revision,
      receipt: readback.receipt,
      task: readback.task,
      applied_revision: readback.applied_revision,
    });
    return {
      state: 'confirmed',
      task,
      receipt_id: entry.receipt_id,
      operation: null,
      actual: {
        revision: readback.task.revision,
        board_column: readback.task.board_column,
        status: readback.task.status,
        current_work: readback.task.current_work,
        next_step: readback.task.next_step,
      },
    };
  }
  assert.equal(readback.receipt, null, 'not_found must have no applied receipt');
  if (entry.failure?.retryable === false)
    return { state: 'needs-review', task, receipt_id: entry.receipt_id, operation: null, reason: entry.failure.code };
  if (entry.revision !== undefined && entry.revision !== readback.task.revision)
    return {
      state: 'needs-review',
      task,
      receipt_id: entry.receipt_id,
      operation: null,
      reason: 'Task changed since original send preparation; never refresh an old receipt revision',
    };
  const prepared = box.prepare(entry.receipt_id, readback.task.revision);
  return {
    state: 'apply-once',
    task,
    receipt_id: entry.receipt_id,
    operation: {
      name: 'apply_task_progress_receipt',
      arguments: { id: task, revision: prepared.revision, receipt: prepared.receipt },
    },
    after: read,
    note: 'Regardless of send success/error/timeout, read this exact receipt before another write or acknowledgement',
  };
}
