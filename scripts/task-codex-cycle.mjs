import assert from 'node:assert/strict';
import { createProgressOutbox, authenticatedBoardAdapter, flushProgress } from './task-progress-outbox.mjs';

// One bounded scheduler invocation. It transports durable facts, never runs or resumes tasks.
export async function syncCodexCycle({ task, directories, threadTitles }, call) {
  assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(Array.isArray(directories) && directories.length > 0 && directories.length <= 8);
  assert.equal(new Set(directories).size, directories.length);
  // Validate ALL inputs before the first remote mutation.
  const boxes = directories.map((directory) => {
    const box = createProgressOutbox(directory);
    assert.ok(
      box.read().pending.every((entry) => entry.receipt.task_id === task),
      'Foreign task outbox refused',
    );
    return { directory, box };
  });
  const scopedCall = (operation, args) => {
    assert.equal(args.id, task);
    assert.ok(['get_task_progress_receipt', 'apply_task_progress_receipt'].includes(operation));
    return call(operation, args);
  };
  const result = [];
  for (const { directory, box } of boxes) {
    const receipts = await flushProgress(box, authenticatedBoardAdapter(scopedCall));
    const remaining = box.read().pending.length;
    result.push({ directory, receipts, remaining });
    if (remaining) break; // No overtaking an uncertain or conflicting receipt.
  }
  let title;
  if (threadTitles?.store.get(task)) {
    // Only an already enrolled exact task is inspected; no historical inventory or new thread creation.
    title = await threadTitles.store.sync(task, threadTitles);
  }
  return {
    task,
    status:
      result.some((r) => r.remaining) || (title && title.status !== 'confirmed') ? 'needs-attention' : 'confirmed',
    outboxes: result,
    ...(title ? { threadTitle: title } : {}),
  };
}

// A native plan is a separate proof dimension; never hide unsent progress receipts.
export async function planCycleThreadTitle(result, store, readTask) {
  if (!store.get(result.task)) return result;
  return {
    ...result,
    threadTitle: await store.plan(result.task, readTask),
    status: result.status === 'confirmed' ? 'needs-native-title-readback' : result.status,
  };
}
