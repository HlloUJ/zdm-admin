import assert from 'node:assert/strict';
import { createBoardIntake } from './task-board-intake.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { createTaskThreadTitles } from './task-thread-titles.mjs';
import { receiveCodexTask, startIndependentCodexTask } from './task-codex-host.mjs';

// A single bounded desktop-host step. The host supplies actual native tool observations.
// This is a handoff contract, not an independent security boundary against its local owner.
export async function advanceTaskThread(input, { commonDir, readTask, start, now = Date.now() }) {
  assert.ok(['receive', 'start', 'rename'].includes(input.action));
  const actions = [];
  const host = {
    intake: createBoardIntake(commonDir),
    queue: createExecutionOrder(commonDir),
    readTask,
    start,
    readThread: async (id) => {
      const observation = input.nativeObservations?.find((item) => item.snapshot?.thread?.id === id);
      assert.equal(observation?.provider, 'codex-native-read_thread', 'Actual native read_thread observation required');
      const at = Date.parse(observation.observedAt);
      assert.ok(Number.isFinite(at) && at <= now && now - at <= 60000, 'Fresh native host observation required');
      return observation.snapshot;
    },
    readCapacity: async () => {
      assert.equal(input.capacity?.provider, 'codex-native-capacity', 'Actual executor capacity observation required');
      const at = Date.parse(input.capacity.observedAt);
      assert.ok(Number.isFinite(at) && at <= now && now - at <= 60000, 'Fresh native capacity required');
      return input.capacity.snapshot;
    },
    createThread: async (plan) => {
      actions.push({ tool: 'create_thread', ...plan });
      return {};
    },
    resolveThreadCreation: async ({ requestId }) => {
      if (!input.creationResult) return null;
      assert.equal(input.creationResult.requestId, requestId, 'Exact durable native create intent required');
      assert.ok(input.creationResult.threadId, 'Ready native thread ID required; client setup ID is insufficient');
      return { threadId: input.creationResult.threadId };
    },
    renameThread: async (plan) => {
      actions.push({ tool: 'set_thread_title', ...plan });
    },
  };
  let result;
  if (input.action === 'receive') result = await receiveCodexTask(input.task, host);
  else if (input.action === 'start') {
    assert.equal(typeof start, 'function', 'Published task entry adapter required');
    result = await startIndependentCodexTask(input.task, host);
  } else {
    // Board rename is performed by the authenticated host first, then independently read here.
    const store = createTaskThreadTitles(commonDir),
      record = store.get(input.task.taskId);
    assert.ok(record?.state === 'bound');
    assert.equal(process.env.CODEX_THREAD_ID, record.rootThreadId, 'Actual coordinator runtime required');
    const source = await host.readThread(record.rootThreadId);
    assert.ok(
      source.turns?.some((turn) =>
        turn.items?.some((item) => item.type === 'userMessage' && item.id === input.task.request.messageId),
      ),
    );
    const official = await readTask(input.task.taskId);
    assert.equal(
      official.title,
      input.task.title,
      'Read back the explicit official rename before syncing native title',
    );
    result = await store.sync(input.task.taskId, host);
  }
  return { result, nativeActions: actions }; // Never describes a plan as a completed native action.
}
