import { recordBeginPlacement, recordCompletePlacement } from './task-completion-placement.mjs';
import { readAcceptance } from './accepted-source.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { createProgressHost } from './task-progress-host.mjs';
import { authenticatedBoardAdapter, createProgressOutbox, recoverStaleReceipt } from './task-progress-outbox.mjs';
import { completionCommand } from './completion-cli.mjs';
import { preserveAssets, checkCompletionRuntime } from './task-completion.mjs';

// The host chooses a published entry or an accurately reviewed first-upgrade source.
// This wrapper supplies transport only: completionCommand keeps all authorization/quality/leases.
export async function runCompletionWithProgress(
  {
    root,
    taskId = null,
    anchor = null,
    args,
    call,
    readRejectedOperation,
    staleRejections = [],
    hostOptions = {},
    completionOptions = {},
  },
  { command = completionCommand, registry = createTaskRegistry(anchor ?? root), readClosedSource = null } = {},
) {
  assert.equal(typeof call, 'function');
  const task = registry.resolve({ ...(taskId ? { id: taskId } : {}), worktree: root });
  assert.equal(path.resolve(task.worktree), path.resolve(root), 'Use the exact registered task worktree');
  const directory = path.join(registry.commonDir, 'task-progress', task.id);
  const box = createProgressOutbox(directory);
  assert.ok(
    box.read().pending.every((entry) => entry.receipt.task_id === task.id),
    'Foreign task outbox refused',
  );
  const adapter = authenticatedBoardAdapter(
    (operation, envelope, options) => {
      assert.ok(['get_task_progress_receipt', 'apply_task_progress_receipt', 'task_history'].includes(operation));
      assert.equal(envelope.id, task.id, 'Foreign task transport refused');
      return call(operation, envelope, options);
    },
    { readRejectedOperation },
  );
  assert.ok(Array.isArray(staleRejections) && staleRejections.length <= 128);
  for (const rejected of staleRejections)
    await recoverStaleReceipt(box, adapter, rejected.receiptId, { rejectionRef: rejected.ref });
  const placements = [];
  const host = createProgressHost(adapter, {
    ...hostOptions,
    directory,
    beforeStage: async ({ state, event }) => {
      if (args[0] !== 'deliver' || event.name !== 'prepare') return;
      try {
        assert.equal(state.batch, task.id);
        const current = registry.readTask(task.id);
        const order = createExecutionOrder(registry.commonDir);
        const admitted = order.assertAdmission({
          lane: 'delivery',
          task: task.id,
          owner: completionOptions.owner ?? process.env.CODEX_THREAD_ID,
          admission: process.env.ZDM_EXECUTION_ADMISSION,
        });
        assert.equal(admitted.active, true);
        const acceptance = readAcceptance(root, task.id);
        recordBeginPlacement(directory, task.id, { task: current, ticket: admitted.ticket, acceptance, event });
        placements.push({ kind: 'begin_delivery', state: 'queued', event: event.id });
      } catch (error) {
        placements.push({ kind: 'begin_delivery', state: 'needs-attention', reason: error.message });
      }
    },
  });
  let result, failure;
  await host.run(async () => {
    try {
      result = await command(root, args, {
        preserveAssets,
        checkRuntime: checkCompletionRuntime,
        ...completionOptions,
      });
    } catch (error) {
      failure = error;
    } finally {
      if (['deliver', 'settle'].includes(args[0])) {
        try {
          placements.push({
            kind: 'delivery_complete',
            ...(await recordCompletePlacement(
              {
                directory,
                task: task.id,
                readClosedSource: readClosedSource ?? (() => readClosedProgressFromRegistry(registry, task.id)),
              },
              adapter,
            )),
          });
        } catch (error) {
          placements.push({ kind: 'delivery_complete', state: 'not-proven', reason: error.message });
        }
      }
      host.notify(directory);
      await host.drain();
    }
  });
  const state = box.read();
  const terminal = state.rejected ?? [];
  const progress = {
    task: task.id,
    placements,
    state: placements.some((item) => ['needs-attention', 'not-proven'].includes(item.state))
      ? 'needs-attention'
      : state.pending.length
        ? 'pending'
        : terminal.length
          ? 'settled-with-undelivered-history'
          : state.acknowledged.length
            ? 'confirmed'
            : 'no-pending-receipts',
    pending: state.pending.length,
    confirmed: state.acknowledged.length,
    rejectedNotDelivered: terminal.filter((entry) => entry.state !== 'superseded-without-submission').length,
    supersededWithoutSubmission: terminal.filter((entry) => entry.state === 'superseded-without-submission').length,
  };
  if (failure) {
    failure.progressDelivery = progress;
    throw failure;
  }
  // Completion result and receipt status are distinct: console output never proves receipt delivery.
  return { completion: result, progress };
}

// Uses the retained formal source; no CI rerun, report download, handoff or queue write.
export async function readClosedDeliveryProgressSource(anchor, task) {
  return readClosedProgressFromRegistry(createTaskRegistry(anchor), task);
}
async function readClosedProgressFromRegistry(registry, task) {
  const record = registry.readTask(task);
  const { deliveryStatus } = await import('./completion-status.mjs');
  const result = deliveryStatus(path.join(registry.commonDir, 'task-delivery', task), task, record);
  assert.equal(result.formalDeliveryComplete, true, 'Task is not formally delivered');
  return { ...result, observed_at: new Date().toISOString() };
}
