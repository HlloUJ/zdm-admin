import {
  TASK_THREAD_MODE,
  taskThreadPolicy,
  createTaskThreadTitles,
  verifyNativeCreation,
} from './task-thread-titles.mjs';
import { verifyCoordinatorSource } from './task-execution-binding.mjs';
import { requireTaskCoordinator } from './task-coordination.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function safe(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if (existsSync(p)) assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked intake store refused');
    if (p === path.dirname(p)) break;
  }
}
function validate(board, input) {
  assert.equal(board?.id, input.taskId, 'Wrong board task');
  assert.equal(board.title, input.title, 'Wrong task title');
  assert.match(board.task_number ?? '', /^\d{3}$/, 'Missing current task number');
  assert.equal(board.status, 'active', 'Only active development registration may be accepted');
  assert.ok(
    !board.deleted_at && (!board.board_column || board.board_column === 'active'),
    'Task archived or in another card',
  );
  assert.ok(Number.isSafeInteger(board.revision) && board.revision > 0, 'Board revision required');
}
export function createBoardIntake(commonDir) {
  const directory = path.join(commonDir, 'task-board-intake');
  function file(task) {
    assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    return path.join(directory, task + '.json');
  }
  function save(target, record) {
    safe(target);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temp = target + '.' + randomUUID();
    writeFileSync(temp, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temp, target);
  }
  function modeFor(task) {
    const target = file(task);
    safe(target);
    if (existsSync(target)) {
      const previous = JSON.parse(readFileSync(target, 'utf8'));
      assert.ok([1, 2].includes(previous.version), 'Unknown existing intake cannot be converted');
      return previous.version === 2 ? TASK_THREAD_MODE : undefined;
    }
    return taskThreadPolicy(commonDir).enabled ? TASK_THREAD_MODE : undefined;
  }
  async function accept(input, { readTask, createTask, readThread, now = Date.now() }) {
    requireTaskCoordinator(commonDir, input.rootThreadId);
    const automaticMode = modeFor(input.taskId);
    if (input.threadMode === undefined && automaticMode) input = { ...input, threadMode: automaticMode };
    assert.equal(input.owner, input.rootThreadId, 'Board intake belongs to the actual coordinator');
    assert.ok(
      input.threadMode === undefined || input.threadMode === TASK_THREAD_MODE,
      'Unknown native task/thread mode',
    );
    await verifyCoordinatorSource(input, readThread);
    const target = file(input.taskId);
    safe(target);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lock = target + '.lock';
    mkdirSync(lock, { mode: 0o700 });
    try {
      let board = await readTask(input.taskId); // Only explicit null means absent; transport errors must propagate.
      const previous = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null;
      if (!previous && taskThreadPolicy(commonDir).enabled)
        assert.equal(
          input.threadMode,
          TASK_THREAD_MODE,
          'New tasks require the enabled independent native thread flow',
        );
      if (input.threadMode === TASK_THREAD_MODE) {
        assert.equal(taskThreadPolicy(commonDir).enabled, true, 'Independent native task/thread policy is not enabled');
        if (!previous) {
          const registered = path.join(commonDir, 'task-registry', 'tasks', input.taskId + '.json');
          safe(registered);
          assert.equal(existsSync(registered), false, 'Historical registered task cannot enroll as a new native task');
          const queueFile = path.join(commonDir, 'task-registry', 'execution-order', 'state.json');
          safe(queueFile);
          if (existsSync(queueFile)) {
            const queue = JSON.parse(readFileSync(queueFile, 'utf8'));
            assert.ok(Array.isArray(queue.tickets), 'Unknown queue state; preserve original identity');
            assert.equal(
              queue.tickets.some((entry) => entry.task === input.taskId),
              false,
              'Historical queued task cannot enroll as a new native task',
            );
          }
        }
        assert.ok(!previous || previous.version === 2, 'Legacy intake cannot be converted or its owner transferred');
      } else assert.ok(!previous || previous.version === 1, 'Independent intake cannot downgrade to the legacy flow');
      if (previous) {
        assert.equal(previous.taskId, input.taskId);
        assert.equal(previous.owner, input.owner);
        assert.equal(previous.messageId, input.request.messageId, 'Different instruction cannot overwrite intake');
      }
      if (board === null) {
        assert.ok(
          !previous || previous.state === 'intent',
          'Previously accepted task disappeared; inspect original state',
        );
        save(target, {
          version: input.threadMode === TASK_THREAD_MODE ? 2 : 1,
          ...(input.threadMode ? { threadMode: input.threadMode } : {}),
          state: 'intent',
          taskId: input.taskId,
          owner: input.owner,
          messageId: input.request.messageId,
        });
        assert.equal(typeof createTask, 'function', 'Task absent; authenticated create adapter required');
        await createTask({
          id: input.taskId,
          title: input.title,
          status: 'active',
          current_work: '等待执行：登记读回后才可开工',
          evidence: JSON.stringify({
            task_id: input.taskId,
            action: 'register_development',
            conditions: { execution_requested: true },
            references: { instruction: input.request.messageId, registration: input.taskId },
          }),
        });
      } else validate(board, input);
      board = await readTask(input.taskId); // Mandatory independent readback, never trust create response.
      validate(board, input);
      if (previous?.state === 'accepted')
        assert.equal(board.task_number, previous.number, 'Original task number changed');
      const receipt = {
        version: input.threadMode === TASK_THREAD_MODE ? 2 : 1,
        ...(input.threadMode ? { threadMode: input.threadMode } : {}),
        state: 'accepted',
        taskId: input.taskId,
        owner: input.owner,
        rootThreadId: input.rootThreadId,
        sourceRoomId: input.request.roomId,
        messageId: input.request.messageId,
        number: board.task_number,
        title: board.title,
        revision: board.revision,
        card: 'active',
        observedAt: now,
        initialObservedAt: previous?.initialObservedAt ?? previous?.observedAt ?? now,
        ...(previous?.refreshHistory ? { refreshHistory: previous.refreshHistory } : {}),
      };
      save(target, receipt);
      const bytes = readFileSync(target, 'utf8');
      assert.deepEqual(JSON.parse(bytes), receipt);
      return { receipt, digest: hash(receipt) };
    } finally {
      rmdirSync(lock);
    }
  }
  function require(context, task, owner, { now = Date.now(), fresh = true } = {}) {
    requireTaskCoordinator(commonDir, context.coordinatorThreadId ?? context.rootThreadId);
    const target = file(task);
    safe(target);
    assert.ok(existsSync(target), 'Board intake missing: register and read back before investigation or start');
    const r = JSON.parse(readFileSync(target, 'utf8'));
    assert.ok([1, 2].includes(r.version), 'Unknown board intake version');
    assert.equal(r.state, 'accepted');
    assert.equal(r.taskId, task);
    if (r.version === 1) assert.equal(r.owner, owner);
    else {
      assert.equal(r.threadMode, TASK_THREAD_MODE);
      assert.equal(r.owner, r.rootThreadId, 'Coordinator intake identity cannot be replaced');
      createTaskThreadTitles(commonDir).requireBinding(context, task, owner);
    }
    assert.equal(r.rootThreadId, context.rootThreadId);
    if (r.sourceRoomId && r.sourceRoomId !== r.rootThreadId) assert.equal(r.sourceRoomId, context.roomId);
    assert.equal(r.messageId, context.authorizationRef);
    if (r.version === 1) {
      assert.equal(r.number, context.taskNumber);
      assert.equal(r.title, context.taskName);
    }
    assert.equal(r.card, 'active');
    assert.ok(Number.isSafeInteger(r.revision) && r.revision > 0);
    assert.ok(Number.isFinite(r.observedAt) && r.observedAt <= now);
    if (fresh) assert.ok(now - r.observedAt <= 300000, 'Intake readback expired; re-read exact task, do not recreate');
    return r;
  }
  async function refreshForStart(input, { readTask, readThread, verifyQueued, now = Date.now() }) {
    requireTaskCoordinator(commonDir, input.coordinatorThreadId ?? input.rootThreadId);
    assert.equal(process.env.CODEX_THREAD_ID, input.owner, 'Actual worker runtime required for intake refresh');
    assert.equal(typeof verifyQueued, 'function', 'Exact queued instruction must be independently checked');
    verifyQueued();
    await verifyCoordinatorSource(
      { ...input, rootThreadId: input.coordinatorThreadId ?? input.rootThreadId },
      readThread,
    );
    const target = file(input.taskId);
    safe(target);
    assert.ok(existsSync(target), 'Only an existing accepted receipt may refresh; never receive or create here');
    const lock = target + '.lock';
    mkdirSync(lock, { mode: 0o700 });
    try {
      const previous = JSON.parse(readFileSync(target, 'utf8'));
      assert.ok(
        [1, 2].includes(previous.version) && previous.state === 'accepted',
        'Accepted original receipt required',
      );
      assert.equal(previous.taskId, input.taskId);
      assert.equal(previous.rootThreadId, input.rootThreadId, 'Original intake coordinator is provenance');
      assert.equal(previous.messageId, input.request.messageId);
      assert.equal(previous.sourceRoomId ?? previous.rootThreadId, input.request.roomId);
      assert.equal(previous.owner, previous.version === 2 ? input.rootThreadId : input.owner);
      const first = await readTask(input.taskId);
      validate(first, input);
      assert.equal(first.task_number, previous.number, 'Original task number changed');
      assert.equal(first.title, previous.title, 'Original task identity changed');
      if (previous.version === 2) {
        const titles = createTaskThreadTitles(commonDir),
          binding = titles.get(input.taskId);
        assert.ok(binding?.state === 'bound', 'Original native binding required');
        const context = {
          rootThreadId: input.rootThreadId,
          authorizationRef: input.request.messageId,
          worker: input.owner,
          taskNumber: first.task_number,
          taskName: first.title,
          ...(input.coordinatorThreadId ? { coordinatorThreadId: input.coordinatorThreadId } : {}),
        };
        titles.requireBinding(context, input.taskId, input.owner);
        verifyNativeCreation(binding, await readThread(input.owner));
      } else {
        assert.equal(input.owner, input.rootThreadId, 'Legacy refresh cannot transfer executors');
        assert.equal(
          input.coordinatorThreadId ?? input.rootThreadId,
          input.rootThreadId,
          'Legacy refresh needs a formal historical binding',
        );
      }
      const second = await readTask(input.taskId);
      validate(second, input);
      assert.deepEqual(second, first, 'Board changed during independent refresh; re-read without rebasing');
      verifyQueued();
      if (previous.revision === second.revision && now >= previous.observedAt && now - previous.observedAt <= 300000)
        return previous;
      assert.ok(Number.isFinite(previous.observedAt) && previous.observedAt <= now, 'Invalid original receipt clock');
      const receipt = {
        ...previous,
        revision: second.revision,
        observedAt: now,
        initialObservedAt: previous.initialObservedAt ?? previous.observedAt,
        refreshHistory: [
          ...(previous.refreshHistory ?? []),
          {
            previousDigest: hash(previous),
            observedAt: now,
            executor: input.owner,
            coordinator: input.coordinatorThreadId ?? input.rootThreadId,
            boardRevision: second.revision,
          },
        ],
      };
      save(target, receipt);
      assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), receipt);
      return receipt;
    } finally {
      rmdirSync(lock);
    }
  }
  return { commonDir, modeFor, accept, require, refreshForStart };
}
