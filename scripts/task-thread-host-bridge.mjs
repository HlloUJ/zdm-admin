import assert from 'node:assert/strict';
import { createBoardIntake } from './task-board-intake.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { createTaskThreadTitles } from './task-thread-titles.mjs';
import { receiveCodexTask, startIndependentCodexTask } from './task-codex-host.mjs';
import { rebindHistoricalTask, resumeBoundTask } from './task-rebinding.mjs';
import { authorizeTaskCoordinator, readTaskCoordination, requireTaskCoordinator } from './task-coordination.mjs';

export function taskHandoffFailure(error) {
  const reason = error.message;
  let readiness = 'blocked',
    next = '保留原资产，按错误所指的准确来源或资源恢复；不重新受理、不删除锁或重建冻结';
  if (
    /Reserve delivery executor|Actual executor capacity|Actual capacity required|Invalid capacity snapshot/.test(reason)
  ) {
    readiness = 'waiting-capacity';
    next = '读回原调用结果及新鲜真实容量并保留交付位；核实未启动后使用同一任务、绑定和原指令续接';
  } else if (/Waiting for formally delivered task dependencies|Declared dependency/.test(reason)) {
    readiness = 'waiting-dependencies';
    next = '等待已登记依赖的正式关闭回执和主线祖先证明，不自动恢复其他任务';
  } else if (/never replay|Never replay|running task|different worker|already belongs/.test(reason)) {
    next = '先读回原执行、当前绑定及原调用结果；未知时保持现场，禁止重放启动或另建任务';
  } else if (/revision changed|review changed|source changed|Source changed/i.test(reason)) {
    next = '保留原摘要和失败，重新读取准确状态并运行只读rebind-plan；不得自动改写原基准';
  }
  return {
    status: 'failed',
    readiness,
    reason,
    next,
    executionState: 'unknown-until-readback',
    completionClaimed: false,
  };
}

// A single bounded desktop-host step. The host supplies actual native tool observations.
// This is a handoff contract, not an independent security boundary against its local owner.
export async function advanceTaskThread(
  input,
  { commonDir, readTask, start, registry, dependenciesReady, observe, now = Date.now() },
) {
  assert.ok(['receive', 'start', 'rename', 'rebind', 'rebind-plan', 'resume', 'coordinate'].includes(input.action));
  const coordination = readTaskCoordination(commonDir);
  if (input.action === 'start' && coordination)
    input = { ...input, task: { ...input.task, coordinatorThreadId: coordination.current.rootThreadId } };
  if (['receive', 'rename', 'rebind', 'rebind-plan', 'resume'].includes(input.action))
    requireTaskCoordinator(commonDir, input.task.rootThreadId);
  const actions = [];
  const beganAt = Date.now();
  const observationNow = () => now + Math.max(0, Date.now() - beganAt);
  const host = {
    intake: createBoardIntake(commonDir),
    queue: createExecutionOrder(commonDir),
    readTask,
    start,
    dependenciesReady,
    readUnavailableThread: async (id) => {
      // Preserve the actual native error. This is absence of a readable chat,
      // never an idle observation or permission to skip resource checks.
      const observation = input.unavailableNativeObservations?.find((item) => item.threadId === id);
      if (!observation) return null;
      assert.equal(observation.provider, 'codex-native-read_thread');
      const at = Date.parse(observation.observedAt),
        current = observationNow();
      assert.ok(
        Number.isFinite(at) && at <= current && current - at <= 60000,
        'Fresh native unavailable observation required',
      );
      assert.ok(
        !input.nativeObservations?.some((item) => item.snapshot?.thread?.id === id),
        'Conflicting native availability',
      );
      assert.deepEqual(
        observation.result?.content?.map((item) => item.type),
        ['text'],
      );
      assert.equal(
        observation.result.content[0].text,
        `No Codex thread found for threadId: ${id}. Hosts without a readable match: local`,
      );
      return observation;
    },
    readThread: async (id) => {
      const observation = input.nativeObservations?.find((item) => item.snapshot?.thread?.id === id);
      assert.equal(observation?.provider, 'codex-native-read_thread', 'Actual native read_thread observation required');
      const at = Date.parse(observation.observedAt);
      const current = observationNow();
      assert.ok(
        Number.isFinite(at) && at <= current && current - at <= 60000,
        'Fresh native host observation required',
      );
      return observation.snapshot;
    },
    readCapacity: async () => {
      assert.equal(input.capacity?.provider, 'codex-native-capacity', 'Actual executor capacity observation required');
      const at = Date.parse(input.capacity.observedAt);
      const current = observationNow();
      assert.ok(Number.isFinite(at) && at <= current && current - at <= 60000, 'Fresh native capacity required');
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
  if (input.action === 'coordinate') result = await authorizeTaskCoordinator(commonDir, input.task, host);
  else if (['rebind', 'rebind-plan', 'resume'].includes(input.action)) {
    assert.ok(registry && registry.commonDir === commonDir, 'Actual published registry required');
    const adapters = { registry, queue: host.queue, now, ...(observe ? { observe } : {}) };
    result =
      input.action !== 'resume'
        ? await rebindHistoricalTask(input.task, host, { ...adapters, planOnly: input.action === 'rebind-plan' })
        : await resumeBoundTask(input.task, host, adapters);
  } else if (input.action === 'receive') result = await receiveCodexTask(input.task, host);
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
