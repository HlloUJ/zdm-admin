import assert from 'node:assert/strict';
import { requireTaskCoordinator, readTaskCoordination } from './task-coordination.mjs';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const TASK_THREAD_MODE = 'task-thread-title-v1';
const TASK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THREAD_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
function safe(file) {
  for (let cursor = path.resolve(file); ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked task/thread state refused');
    if (cursor === path.dirname(cursor)) break;
  }
}
function save(file, value, first = false) {
  safe(file);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (first) return writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  const temp = file + '.' + randomUUID();
  writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
  renameSync(temp, file);
}
function privateRead(file) {
  safe(file);
  const stat = lstatSync(file);
  assert.ok(
    stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= 131072,
    'Private bounded task/thread record required',
  );
  return read(file);
}
export function threadTitle(board) {
  assert.ok(board && TASK_ID.test(board.id) && !board.deleted_at, 'Live exact board identity required');
  assert.ok(text(board.title), 'User-specified task name required');
  const number = board.status === 'done' ? board.historical_task_number : board.task_number;
  assert.match(number ?? '', /^\d{3}$/, 'Board-generated current or historical number required');
  return `${number}｜${board.title}`;
}
// Validate the original native creation event without rewriting it as a user message.
export function verifyNativeCreation(record, actual) {
  assert.match(record.threadId, THREAD_ID);
  assert.match(record.rootThreadId, THREAD_ID);
  assert.notEqual(record.threadId, record.rootThreadId);
  assert.equal(actual.thread.id, record.threadId, 'Exact native creation thread required');
  assert.ok(text(record.creationPrompt) && text(record.createRequestId));
  assert.ok(
    record.creationPrompt.includes(`创建标识：${record.createRequestId}\n`),
    'Durable creation nonce must match the original prompt',
  );
  const provenance = actual.turns
    ?.flatMap((turn) => turn.items ?? [])
    .find((item) => {
      if (!item.id) return false;
      if (item.type === 'userMessage' && !record.creationRootThreadId)
        return item.content?.some(
          (part) =>
            part.type === 'text' && (part.text === record.creationPrompt || part.text === record.creationPrompt + '\n'),
        );
      if (
        item.type !== 'functionCallOutput' ||
        item.namespace !== 'codex_app' ||
        item.name !== 'create_thread' ||
        item.output?.truncated !== false ||
        typeof item.output.text !== 'string'
      )
        return false;
      const delegation = item.output.text.match(
        /^<codex_delegation>\n {2}<source_thread_id>([^<]+)<\/source_thread_id>\n {2}<input>([\s\S]*)<\/input>\n<\/codex_delegation>$/,
      );
      return (
        delegation?.[1] === (record.creationRootThreadId ?? record.rootThreadId) &&
        delegation[2] === record.creationPrompt
      );
    });
  assert.ok(provenance?.id, 'Native thread must read back this exact task creation instruction');
  return provenance;
}
export function taskThreadPolicy(commonDir) {
  const file = path.join(commonDir, 'task-thread-titles', 'policy.json');
  safe(file);
  if (!existsSync(file)) return { enabled: false, mode: TASK_THREAD_MODE };
  const policy = privateRead(file);
  assert.equal(policy.version, 1);
  assert.equal(policy.mode, TASK_THREAD_MODE);
  assert.equal(typeof policy.enabled, 'boolean');
  assert.match(policy.sourceHead, /^[a-f0-9]{40}$/);
  assert.ok(Number.isFinite(Date.parse(policy.enabledAt)));
  return policy;
}
// Deployment invokes this only from verified published main. No import activates the policy.
export function enableTaskThreadPolicy(commonDir, { sourceHead, now = Date.now() }) {
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  const current = taskThreadPolicy(commonDir);
  if (current.enabled) return current;
  const file = path.join(commonDir, 'task-thread-titles', 'policy.json');
  assert.equal(existsSync(file), false, 'Existing disabled/foreign policy needs an explicit reviewed transition');
  const policy = {
    version: 1,
    mode: TASK_THREAD_MODE,
    enabled: true,
    sourceHead,
    enabledAt: new Date(now).toISOString(),
  };
  save(file, policy, true);
  return policy;
}
export function activatePublishedTaskThreads(commonDir, { head, remoteHead, branch, clean, completion }) {
  assert.equal(branch, 'main', 'Activate only from the published main anchor');
  assert.equal(head, remoteHead, 'Published origin/main must match');
  assert.equal(clean, true, 'Published anchor must be clean');
  assert.ok(
    completion?.events && completion.batch === 'codex-task-title-sync',
    'Exact title-sync delivery evidence required',
  );
  const ci = [...completion.events].reverse().find((e) => e.name === 'ci');
  assert.ok(
    ci?.status === 'success' && ci.result?.branch === 'main' && ci.result?.headSha === head,
    'Latest exact-main CI success required',
  );
  assert.ok(
    completion.events.some(
      (e) => e.name === 'handoff' && e.status === 'success' && (e.key === ci.key || e.key === head + ':final'),
    ),
    'Actual published runtime handoff required',
  );
  return enableTaskThreadPolicy(commonDir, { sourceHead: head });
}
export function requireNativeIntake(commonDir, { taskId, rootThreadId, request, coordinatorThreadId }) {
  requireTaskCoordinator(commonDir, coordinatorThreadId ?? rootThreadId);
  if (coordinatorThreadId) {
    assert.equal(process.env.CODEX_THREAD_ID, coordinatorThreadId, 'Actual current intake coordinator required');
    assert.equal(
      readTaskCoordination(commonDir)?.current.request.authorId,
      request.authorId,
      'Original intake authorization user differs',
    );
  }
  assert.match(taskId, TASK_ID);
  assert.match(rootThreadId, THREAD_ID);
  const receipt = privateRead(path.join(commonDir, 'task-board-intake', taskId + '.json'));
  assert.equal(receipt.version, 2, 'Only future native intake may reserve or bind a worker');
  assert.equal(receipt.threadMode, TASK_THREAD_MODE);
  assert.equal(receipt.state, 'accepted');
  assert.equal(receipt.taskId, taskId);
  assert.equal(receipt.owner, rootThreadId);
  assert.equal(receipt.rootThreadId, rootThreadId);
  assert.equal(receipt.messageId, request.messageId);
  assert.equal(request.roomId, receipt.sourceRoomId ?? rootThreadId);
  return receipt;
}
export function createTaskThreadTitles(commonDir) {
  const base = path.join(commonDir, 'task-thread-titles');
  function file(taskId) {
    assert.match(taskId, TASK_ID);
    return path.join(base, 'tasks', taskId + '.json');
  }
  function get(taskId) {
    const target = file(taskId);
    safe(target);
    if (!existsSync(target)) return null;
    const record = privateRead(target);
    assert.equal(record.version, 1);
    assert.equal(record.mode, TASK_THREAD_MODE);
    assert.equal(record.taskId, taskId);
    assert.match(record.rootThreadId, THREAD_ID);
    assert.ok(text(record.messageId) && text(record.createRequestId));
    assert.ok(['creation-intent', 'creation-unknown', 'bound'].includes(record.state));
    if (record.threadId !== undefined) assert.match(record.threadId, THREAD_ID);
    return record;
  }
  async function exclusive(taskId, action) {
    const target = file(taskId);
    safe(target);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const lock = target + '.lock',
      token = randomUUID();
    mkdirSync(lock, { mode: 0o700 }); // Interrupted/live ownership is retained, never stolen by age.
    const owner = path.join(lock, 'owner.json');
    writeFileSync(owner, JSON.stringify({ token, pid: process.pid }), { mode: 0o600, flag: 'wx' });
    try {
      return await action();
    } finally {
      assert.equal(privateRead(owner).token, token, 'Task/thread writer changed');
      unlinkSync(owner);
      rmdirSync(lock);
    }
  }
  function existingExecution(taskId) {
    const registry = path.join(commonDir, 'task-registry', 'tasks', taskId + '.json');
    safe(registry);
    if (existsSync(registry)) return { registered: true, task: privateRead(registry) };
    const queueFile = path.join(commonDir, 'task-registry', 'execution-order', 'state.json');
    safe(queueFile);
    if (existsSync(queueFile)) {
      const queue = read(queueFile);
      assert.ok(Array.isArray(queue.tickets), 'Unknown execution queue; preserve state');
      const ticket = queue.tickets.find((entry) => entry.task === taskId);
      if (ticket) return { queued: true, ticket };
    }
    return null;
  }
  function assertPending(input, execution) {
    assert.ok(execution?.queued && !execution.registered, 'Exact unstarted pending-native FIFO ticket required');
    const ticket = execution.ticket;
    assert.equal(ticket.awaitingNativeWorker, true, 'Existing ordinary task cannot be converted');
    assert.equal(ticket.status, 'queued');
    assert.equal(ticket.admission, null);
    assert.equal(ticket.owner, input.rootThreadId);
    assert.deepEqual(ticket.request, input.request);
  }
  function assertReceipt(taskId, rootThreadId, messageId) {
    const receipt = privateRead(path.join(commonDir, 'task-board-intake', taskId + '.json'));
    assert.equal(receipt.version, 2, 'Only explicitly enrolled future tasks may bind native threads');
    assert.equal(receipt.threadMode, TASK_THREAD_MODE);
    assert.equal(receipt.state, 'accepted');
    assert.equal(receipt.taskId, taskId);
    assert.equal(receipt.owner, rootThreadId, 'Original coordinator intake owner required');
    assert.equal(receipt.rootThreadId, rootThreadId);
    assert.equal(receipt.messageId, messageId);
    return receipt;
  }
  function checkBacklink(record, create = false) {
    assert.match(record.threadId, THREAD_ID);
    const target = path.join(base, 'threads', record.threadId + '.json');
    safe(target);
    const identity = {
      version: 1,
      mode: TASK_THREAD_MODE,
      threadId: record.threadId,
      taskId: record.taskId,
      rootThreadId: record.rootThreadId,
      ...(record.creationRootThreadId ? { creationRootThreadId: record.creationRootThreadId } : {}),
      messageId: record.messageId,
      createRequestId: record.createRequestId,
    };
    if (existsSync(target)) assert.deepEqual(privateRead(target), identity, 'Native thread belongs to another task');
    else {
      assert.equal(create, true, 'Native thread backlink missing; preserve original binding');
      save(target, identity, true);
    }
  }
  async function ensure(input, host) {
    assert.equal(taskThreadPolicy(commonDir).enabled, true, 'Native task-thread naming is not enabled');
    assert.equal(input.owner, input.rootThreadId, 'Coordinator receives; the real worker starts later');
    assert.match(input.rootThreadId, THREAD_ID);
    assertReceipt(input.taskId, input.rootThreadId, input.request.messageId);
    return exclusive(input.taskId, async () => {
      let record = get(input.taskId);
      if (!record) {
        assertPending(input, existingExecution(input.taskId));
        const board = await host.readTask(input.taskId);
        assert.equal(board.id, input.taskId);
        const expectedTitle = threadTitle(board);
        assert.notEqual(board.status, 'done');
        assert.equal(typeof host.createThread, 'function', 'Authenticated native create adapter required');
        record = {
          version: 1,
          mode: TASK_THREAD_MODE,
          taskId: input.taskId,
          rootThreadId: input.rootThreadId,
          ...(input.coordinatorThreadId && input.coordinatorThreadId !== input.rootThreadId
            ? { creationRootThreadId: input.coordinatorThreadId }
            : {}),
          messageId: input.request.messageId,
          createRequestId: randomUUID(),
          state: 'creation-intent',
          initialTitle: expectedTitle,
          createdAt: new Date().toISOString(),
        };
        record.creationPrompt = `任务 ${record.taskId} 的独立执行对话。正式标题：${expectedTitle}。\n受理指令：${record.messageId}\n创建标识：${record.createRequestId}\n仅等待总协调完成真实对话身份绑定和开发准入；绑定前不要读工程、创建工作区或运行任务。`;
        save(file(input.taskId), record, true);
        assert.equal(typeof host.createThread, 'function', 'Authenticated native create adapter required');
        // The durable intent is sealed as unknown BEFORE the network call. An interrupted
        // process can never infer that the call did not create a thread.
        record.state = 'creation-unknown';
        save(file(input.taskId), record);
        try {
          const created = await host.createThread({
            requestId: record.createRequestId,
            taskId: record.taskId,
            title: record.initialTitle,
            prompt: record.creationPrompt,
          });
          if (created?.clientThreadId) record.clientThreadId = created.clientThreadId;
          if (created?.threadId) record.threadId = created.threadId;
          save(file(input.taskId), record);
        } catch {
          return { status: 'waiting-thread-identity', taskId: input.taskId, reason: 'native-create-result-unknown' };
        }
      } else {
        assert.equal(record.rootThreadId, input.rootThreadId);
        assert.equal(record.messageId, input.request.messageId, 'Another instruction cannot adopt a thread');
      }
      if (!record.threadId && typeof host.resolveThreadCreation === 'function') {
        const resolved = await host.resolveThreadCreation({
          taskId: record.taskId,
          requestId: record.createRequestId,
          clientThreadId: record.clientThreadId ?? null,
        });
        if (resolved?.threadId) {
          record.threadId = resolved.threadId;
          save(file(input.taskId), record);
        }
      }
      if (!record.threadId)
        return { status: 'waiting-thread-identity', taskId: input.taskId, reason: 'native-create-result-unknown' };
      assert.match(
        record.threadId,
        THREAD_ID,
        'Actual ready native thread ID required; a client setup ID is not an owner',
      );
      assert.notEqual(record.threadId, record.rootThreadId, 'Task cannot rename or adopt the coordinator');
      const actual = await host.readThread(record.threadId);
      const provenance = verifyNativeCreation(record, actual);
      const execution = existingExecution(input.taskId);
      if (execution?.ticket?.awaitingNativeWorker) assertPending(input, execution);
      else if (execution) {
        assert.equal(record.state, 'bound', 'Existing execution cannot be adopted during binding');
        assert.equal(
          execution.task?.owner ?? execution.ticket?.owner,
          record.threadId,
          'Existing execution owner differs',
        );
      }
      checkBacklink(record, true);
      record.state = 'bound';
      record.creationMessageId = provenance.id;
      record.creationObservation = provenance;
      save(file(input.taskId), record);
      return sync(input.taskId, host, record);
    });
  }
  async function sync(taskId, host, lockedRecord = null) {
    const action = async () => {
      const record = lockedRecord ?? get(taskId);
      if (!record) return { status: 'not-applicable', taskId }; // No historical discovery/backfill.
      assert.equal(record.state, 'bound', 'Native task thread binding is incomplete');
      checkBacklink(record);
      const board = await host.readTask(taskId);
      assert.equal(board.id, taskId);
      const expectedTitle = threadTitle(board);
      record.titleSync = {
        state: 'pending',
        number: board.status === 'done' ? board.historical_task_number : board.task_number,
        name: board.title,
        expectedTitle,
        boardRevision: board.revision,
        observedAt: new Date().toISOString(),
      };
      save(file(taskId), record);
      try {
        let actual = await host.readThread(record.threadId);
        assert.equal(actual.thread.id, record.threadId);
        if (actual.thread.title !== expectedTitle) {
          assert.equal(typeof host.renameThread, 'function', 'Native rename adapter unavailable');
          await host.renameThread({ threadId: record.threadId, title: expectedTitle });
          actual = await host.readThread(record.threadId); // Rename response never proves success.
        }
        assert.equal(actual.thread.id, record.threadId);
        assert.equal(actual.thread.title, expectedTitle, 'Native title readback differs');
        record.titleSync.state = 'confirmed';
        record.titleSync.confirmedAt = new Date().toISOString();
        save(file(taskId), record);
        return { status: 'confirmed', taskId, threadId: record.threadId, expectedTitle, boardRevision: board.revision };
      } catch {
        return {
          status: 'title-sync-pending',
          taskId,
          threadId: record.threadId,
          expectedTitle,
          reason: 'native-title-write-or-readback-unconfirmed',
        };
      }
    };
    if (!lockedRecord && !get(taskId)) return { status: 'not-applicable', taskId };
    return lockedRecord ? action() : exclusive(taskId, action);
  }
  function enrolled() {
    const directory = path.join(base, 'tasks');
    safe(directory);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const record = get(name.slice(0, -5));
        return {
          taskId: record.taskId,
          threadId: record.threadId ?? null,
          state: record.state,
          titleState: record.titleSync?.state ?? 'pending',
        };
      });
  }
  async function rename(taskId, { title, rootThreadId, request }, host) {
    assert.ok(text(title));
    assert.equal(request.roomId, rootThreadId);
    const actual = await host.readThread(rootThreadId);
    assert.equal(actual.thread.id, rootThreadId);
    assert.ok(
      actual.turns?.some((turn) =>
        turn.items?.some((item) => item.type === 'userMessage' && item.id === request.messageId),
      ),
      'Actual user rename instruction required',
    );
    return exclusive(taskId, async () => {
      const record = get(taskId);
      assert.ok(record?.state === 'bound');
      assert.equal(record.rootThreadId, rootThreadId);
      checkBacklink(record);
      let board = await host.readTask(taskId);
      assert.equal(board.id, taskId);
      if (!record.rename || record.rename.messageId !== request.messageId) {
        record.rename = { messageId: request.messageId, title, state: 'intent' };
        save(file(taskId), record);
      }
      assert.equal(record.rename.title, title, 'One rename instruction has one exact title');
      if (board.title !== title) {
        if (record.rename.state !== 'intent') return { status: 'board-rename-pending', taskId };
        assert.equal(typeof host.renameTask, 'function', 'Authenticated official-name update adapter required');
        record.rename.state = 'write-unknown';
        save(file(taskId), record);
        try {
          await host.renameTask({ taskId, title });
        } catch {
          return { status: 'board-rename-pending', taskId };
        }
        board = await host.readTask(taskId);
        assert.equal(board.id, taskId);
        if (board.title !== title) return { status: 'board-rename-pending', taskId };
      }
      record.rename.state = 'board-confirmed';
      save(file(taskId), record);
      return sync(taskId, host, record);
    });
  }
  async function dispatch(taskId, workerInput, host) {
    return exclusive(taskId, async () => {
      const record = get(taskId);
      assert.ok(record?.state === 'bound' && record.titleSync?.state === 'confirmed');
      assert.equal(workerInput.owner, record.threadId);
      assert.equal(workerInput.request.messageId, record.messageId);
      if (record.dispatch) return { status: record.dispatch.state, taskId, threadId: record.threadId };
      assert.equal(typeof host.dispatchWorker, 'function', 'Authenticated native worker dispatch adapter required');
      record.dispatch = {
        state: 'dispatch-unknown',
        inputDigest: digest(workerInput),
        dispatchedAt: new Date().toISOString(),
      };
      save(file(taskId), record); // An uncertain send must never be replayed automatically.
      try {
        await host.dispatchWorker({ threadId: record.threadId, input: workerInput });
        record.dispatch.state = 'dispatched';
        save(file(taskId), record);
      } catch {
        /* Preserve unknown delivery for actual native inspection. */
      }
      return { status: record.dispatch.state, taskId, threadId: record.threadId };
    });
  }
  function requireBinding(context, taskId, owner) {
    requireTaskCoordinator(commonDir, context.coordinatorThreadId ?? context.rootThreadId);
    const record = get(taskId);
    assert.ok(record, 'New task native thread binding missing');
    assert.equal(record.state, 'bound');
    assert.equal(record.rootThreadId, context.rootThreadId);
    assert.equal(record.messageId, context.authorizationRef);
    assert.equal(record.threadId, owner, 'Only the actual bound native worker may start');
    assert.equal(context.worker, owner);
    assert.equal(record.titleSync?.state, 'confirmed', 'Task title readback must be confirmed before start');
    assert.equal(record.titleSync.number, context.taskNumber);
    assert.equal(record.titleSync.name, context.taskName);
    checkBacklink(record);
    return record;
  }
  async function plan(taskId, readTask) {
    const record = get(taskId);
    if (!record) return { status: 'not-applicable', taskId };
    assert.equal(record.state, 'bound');
    const board = await readTask(taskId);
    assert.equal(board.id, taskId);
    const expectedTitle = threadTitle(board);
    return {
      status: 'native-readback-required',
      taskId,
      threadId: record.threadId,
      expectedTitle,
      boardRevision: board.revision,
      source: {
        number: board.status === 'done' ? board.historical_task_number : board.task_number,
        title: board.title,
      },
      plannedAt: new Date().toISOString(),
    };
  }
  async function confirm(taskId, observation, readTask, now = Date.now()) {
    return exclusive(taskId, async () => {
      const record = get(taskId);
      assert.ok(record && record.state === 'bound');
      checkBacklink(record);
      assert.equal(observation?.provider, 'codex-native-read_thread');
      assert.equal(observation.thread?.id, record.threadId);
      assert.ok(
        Number.isFinite(Date.parse(observation.observedAt)) &&
          Date.parse(observation.observedAt) <= now &&
          now - Date.parse(observation.observedAt) <= 60000,
        'Fresh actual native title observation required',
      );
      const board = await readTask(taskId);
      assert.equal(board.id, taskId);
      const expectedTitle = threadTitle(board);
      assert.equal(observation.thread.title, expectedTitle, 'Native title differs from current official task');
      record.titleSync = {
        state: 'confirmed',
        number: board.status === 'done' ? board.historical_task_number : board.task_number,
        name: board.title,
        expectedTitle,
        boardRevision: board.revision,
        observedAt: observation.observedAt,
        confirmedAt: new Date(now).toISOString(),
        nativeObservation: observation,
      };
      save(file(taskId), record);
      return { status: 'confirmed', taskId, threadId: record.threadId, expectedTitle, boardRevision: board.revision };
    });
  }
  return { get, enrolled, ensure, sync, rename, dispatch, requireBinding, plan, confirm, base, digest };
}
