import { verifyDevelopmentPlacementEvidence } from './task-execution-order-cli.mjs';
import { assertTaskExecutor } from './task-execution-binding.mjs';
import { ensureDeliveryPlacement, recordCompletePlacement } from './task-completion-placement.mjs';
import { readAcceptance } from './accepted-source.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { createProgressHost } from './task-progress-host.mjs';
import {
  authenticatedBoardAdapter,
  createProgressOutbox,
  recoverStaleReceipt,
  recoverTerminalInvalidWithSupersession,
} from './task-progress-outbox.mjs';
import { completionCommand } from './completion-cli.mjs';
import { preserveAssets, checkCompletionRuntime } from './task-completion.mjs';
import { recordToolProgress } from './task-delivery-status-sync.mjs';

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
    developmentEvidence = null,
    invalidSupersessions = [],
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
  const readDevelopmentSource = async () => {
    const current = registry.readTask(task.id),
      order = createExecutionOrder(registry.commonDir);
    const recorded = order
      .read()
      ?.tickets.find(
        (ticket) =>
          ticket.task === task.id &&
          ticket.lane === 'development' &&
          ticket.owner === task.owner &&
          ticket.status === 'completed',
      )?.completion?.evidence;
    return verifyDevelopmentPlacementEvidence(current, developmentEvidence ?? recorded);
  };
  assert.ok(Array.isArray(invalidSupersessions) && invalidSupersessions.length <= 128);
  for (const item of invalidSupersessions)
    await recoverTerminalInvalidWithSupersession(box, adapter, item.receiptId, {
      clientEvidenceFile: item.clientEvidenceFile,
      evidenceBase: item.evidenceBase,
      readRepairSource: readDevelopmentSource,
    });
  const placements = [];
  const host = createProgressHost(adapter, {
    ...hostOptions,
    directory,
    beforeStage: async ({ state, event, transport }) => {
      if (args[0] !== 'deliver' || event.name !== 'prepare') return;
      try {
        assert.equal(state.batch, task.id);
        const current = registry.readTask(task.id);
        const order = createExecutionOrder(registry.commonDir);
        const admitted = order.assertAdmission({
          lane: 'delivery',
          task: task.id,
          owner: assertTaskExecutor(current, completionOptions.owner ?? process.env.CODEX_THREAD_ID),
          admission: process.env.ZDM_EXECUTION_ADMISSION,
        });
        assert.equal(admitted.active, true);
        const acceptance = readAcceptance(root, task.id);
        const result = await ensureDeliveryPlacement(
          {
            directory,
            task: current,
            ticket: admitted.ticket,
            acceptance,
            event,
            readDevelopmentSource,
            drain: () => host.drain(),
          },
          transport,
        );
        placements.push({ kind: 'begin_delivery', ...result, event: event.id });
      } catch (error) {
        placements.push({ kind: 'begin_delivery', state: 'needs-attention', reason: error.message });
        throw Object.assign(new Error('Required board placement not confirmed: ' + error.message, { cause: error }), {
          code: 'PROGRESS_PLACEMENT_BLOCKED',
        });
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
      if (result?.status === 'deferred') {
        assert.equal(result.formalDeliveryComplete, false);
        assert.match(result.main, /^[a-f0-9]{40}$/);
        assert.match(result.runId, /^\d+$/);
        recordToolProgress(directory, task.id, `settlement-deferred:${result.main}:${result.runId}`, {
          observed_at: result.deferredAt,
          event: 'completed',
          action: { id: `main-handoff:${result.main}`, label: '主线验证与运行交接已完成' },
          evidence_refs: [`main:${result.main}`, `main-ci:${result.runId}`],
          next: { kind: 'wait', label: '外部周期验收待完成' },
        });
      }
    } catch (error) {
      failure = error;
    } finally {
      if (['deliver', 'settle'].includes(args[0]) && result?.status !== 'deferred') {
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
