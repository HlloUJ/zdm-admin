import { TASK_THREAD_MODE, taskThreadPolicy, createTaskThreadTitles } from './task-thread-titles.mjs';
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
    const automaticMode = modeFor(input.taskId);
    if (input.threadMode === undefined && automaticMode) input = { ...input, threadMode: automaticMode };
    assert.equal(input.request.roomId, input.rootThreadId);
    assert.equal(input.owner, input.rootThreadId, 'Board intake belongs to the actual coordinator');
    assert.ok(
      input.threadMode === undefined || input.threadMode === TASK_THREAD_MODE,
      'Unknown native task/thread mode',
    );
    const source = await readThread(input.rootThreadId);
    assert.equal(source.thread.id, input.rootThreadId);
    assert.ok(
      source.turns.some((t) => t.items?.some((i) => i.type === 'userMessage' && i.id === input.request.messageId)),
      'Original execution message must be read from native host',
    );
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
      const receipt = {
        version: input.threadMode === TASK_THREAD_MODE ? 2 : 1,
        ...(input.threadMode ? { threadMode: input.threadMode } : {}),
        state: 'accepted',
        taskId: input.taskId,
        owner: input.owner,
        rootThreadId: input.rootThreadId,
        messageId: input.request.messageId,
        number: board.task_number,
        title: board.title,
        revision: board.revision,
        card: 'active',
        observedAt: now,
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
  return { commonDir, modeFor, accept, require };
}
