import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createExecutionOrder } from './task-execution-order.mjs';
import { monitoringRegistration } from './task-monitor-registration.mjs';
import { openCompletion, completionStage, saveCompletion } from './completion-session.mjs';
import { createProgressOutbox } from './task-progress-outbox.mjs';
import {
  codexMonitoringContext,
  startCodexTask,
  observeCodexTask,
  notifyCodexObservation,
  recordCodexProgress,
  syncCodexProgress,
} from './task-codex-host.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const request = (sequence) => ({
  sequence,
  messageId: `fixture-user-${sequence}`,
  roomId: owner,
  authorId: 'fixture-user',
});
const snapshot = (status = 'active', turns = []) => ({ thread: { id: owner, status: { type: status } }, turns });
const source = () => snapshot('active', [{ items: [{ type: 'userMessage', id: request(3).messageId }] }]);
const board = () => ({ id: 'native-task', task_number: '337', title: 'isolated task', status: 'active' });
const input = () => ({ taskId: 'native-task', owner, rootThreadId: owner, request: request(3) });
const context = () => ({
  executionSurface: 'codex-thread',
  worker: owner,
  rootThreadId: owner,
  roomId: owner,
  authorizationRef: request(3).messageId,
  taskStableId: 'native-task',
  taskNumber: '337',
  taskName: 'isolated task',
});
function fixture(t) {
  const parent = path.join(process.cwd(), '.task-runtime/codex-host-tests');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, 'fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const previous = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = owner;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previous;
  });
  return directory;
}
test('native monitoring uses real owner UUID without weakening legacy worker checks', () => {
  assert.equal(monitoringRegistration(owner, context(), owner).executionSurface, 'codex-thread');
  assert.throws(
    () => monitoringRegistration(owner, { ...context(), worker: '22222222-2222-4222-8222-222222222222' }, owner),
    /actual execution owner/,
  );
  assert.throws(() => monitoringRegistration(owner, { ...context(), executionSurface: undefined }, owner));
  assert.throws(() => monitoringRegistration(owner, { ...context(), executionSurface: 'invented' }, owner));
  assert.throws(() => monitoringRegistration(owner, context(), 'other'), /Real runtime owner/);
});
test('registration and actual user message must be read back before any claim or launch', async (t) => {
  fixture(t);
  assert.deepEqual(
    await codexMonitoringContext(input(), { readTask: async () => board(), readThread: async () => source() }),
    context(),
  );
  await assert.rejects(
    codexMonitoringContext(input(), {
      readTask: async () => ({ ...board(), id: 'other' }),
      readThread: async () => source(),
    }),
    /Exact task/,
  );
  await assert.rejects(
    codexMonitoringContext(input(), { readTask: async () => board(), readThread: async () => snapshot() }),
    /Actual user/,
  );
  await assert.rejects(
    codexMonitoringContext(input(), {
      readTask: async () => ({ ...board(), status: 'done' }),
      readThread: async () => source(),
    }),
    /unfinished/,
  );
});
test('real isolated FIFO remains paused and unchanged when native start is refused', async (t) => {
  const dir = fixture(t),
    queue = createExecutionOrder(dir);
  queue.initialize(request(1));
  queue.enqueue({ lane: 'development', task: 'native-task', owner, request: request(3) });
  const before = JSON.stringify(queue.read());
  await assert.rejects(
    startCodexTask(input(), {
      queue,
      readTask: async () => board(),
      readThread: async () => source(),
      start: () => assert.fail('must not launch'),
    }),
    /pause/,
  );
  assert.equal(JSON.stringify(queue.read()), before);
});
test('native dispatch starts only FIFO head, refuses duplicate dispatch, and claim is not started progress', async (t) => {
  const dir = fixture(t),
    queue = createExecutionOrder(dir);
  queue.initialize(request(1));
  queue.direct({ action: 'resume-all', request: request(2) });
  queue.enqueue({ lane: 'development', task: 'native-task', owner, request: request(3) });
  let count = 0;
  const host = {
    queue,
    readTask: async () => board(),
    readThread: async () => source(),
    start: async (x) => {
      count++;
      return { task: { id: x.taskId, owner, monitoring: monitoringRegistration(owner, x.monitorContext, owner) } };
    },
  };
  await startCodexTask(input(), host);
  await assert.rejects(startCodexTask(input(), host), /do not replay/);
  assert.equal(count, 1);
  const receipts = createProgressOutbox(path.join(dir, 'task-progress/native-task')).read().pending;
  assert.deepEqual(
    receipts.map((r) => r.receipt.event),
    ['queued'],
  );
});
test('launch failure retains occupied slot and never retries or dispatches another task', async (t) => {
  const queue = createExecutionOrder(fixture(t));
  queue.initialize(request(1));
  queue.direct({ action: 'resume-all', request: request(2) });
  queue.enqueue({ lane: 'development', task: 'native-task', owner, request: request(3) });
  const host = {
    queue,
    readTask: async () => board(),
    readThread: async () => source(),
    start: async () => {
      throw Error('fixture launch failed');
    },
  };
  await assert.rejects(startCodexTask(input(), host), /launch failed/);
  assert.equal(queue.read().tickets[0].status, 'running');
  await assert.rejects(startCodexTask(input(), host), /do not replay/);
});
test('native observation distinguishes active, paused, unavailable, idle and explicit failed turn', async () => {
  const task = { id: 'native-task', owner, monitoring: { ...context(), state: 'registered' } };
  const observe = (readThread, paused = false) => observeCodexTask(task, { readThread, paused, now: 2000 });
  assert.equal((await observe(async () => snapshot())).status, 'running');
  assert.equal((await observe(() => assert.fail('paused must not query'), true)).status, 'paused');
  assert.equal((await observe(async () => snapshot('idle'))).status, 'unknown');
  assert.equal(
    (
      await observe(async () => {
        throw Error('offline');
      })
    ).status,
    'unknown',
  );
  assert.equal(
    (await observe(async () => snapshot('idle', [{ id: 'turn', error: { message: 'failure' }, completedAt: 1 }])))
      .status,
    'blocked',
  );
  assert.equal((await observe(async () => ({ thread: { id: 'wrong', status: 'idle' } }))).status, 'unknown');
});
test('a main-attached native chat requires its latest real command to bind the exact task worktree', async () => {
  const task = {
    id: 'native-task',
    owner,
    worktree: '/fixture/task',
    monitoring: { ...context(), state: 'registered' },
  };
  const read = (items) => async () => ({
    thread: { id: owner, cwd: '/fixture/main', status: 'active' },
    turns: [{ items }],
  });
  const command = (cwd) => ({ type: 'commandExecution', cwd });
  assert.equal(
    (await observeCodexTask(task, { paused: false, readThread: read([command('/fixture/task')]) })).status,
    'running',
  );
  assert.equal(
    (
      await observeCodexTask(task, {
        paused: false,
        readThread: read([command('/fixture/task'), command('/fixture/other-task')]),
      })
    ).status,
    'unknown',
  );
  assert.equal((await observeCodexTask(task, { paused: false, readThread: read([]) })).status, 'unknown');
});
test('notice delivery is read back and deduplicated; unknown delivery is never resent', async (t) => {
  const dir = fixture(t),
    task = { id: 'native-task', monitoring: { ...context(), owner, mode: 'confirmed-interruption-notice-only' } };
  const observation = {
    task: task.id,
    observedAt: 2000,
    status: 'blocked',
    failureEvent: { id: 'event', name: 'fixture', status: 'failure', finishedAt: 1 },
  };
  let sends = 0,
    text;
  const host = {
    directory: dir,
    paused: false,
    now: 2000,
    readThread: async () => snapshot(),
    sendMessage: async (x) => {
      sends++;
      text = x.text;
      return { messageId: 'fixture-sent' };
    },
    readMessage: async () => ({ roomId: owner, text }),
  };
  assert.equal((await notifyCodexObservation(task, observation, host)).status, 'delivered');
  assert.equal((await notifyCodexObservation(task, observation, host)).status, 'already-delivered');
  assert.equal(sends, 1);
  const unknown = {
    ...host,
    directory: path.join(dir, 'unknown'),
    sendMessage: async () => {
      sends++;
      throw Error('unknown send');
    },
  };
  assert.equal((await notifyCodexObservation(task, observation, unknown)).status, 'delivery-unknown');
  assert.equal((await notifyCodexObservation(task, observation, unknown)).status, 'delivery-unknown');
  assert.equal(sends, 2);
  assert.equal((await notifyCodexObservation(task, observation, { ...host, paused: true })).status, 'silent');
  assert.equal((await notifyCodexObservation(task, observation, { ...host, now: 100000 })).status, 'stale-observation');
});
test('real completion stage emits durable started/completed facts without repeating original action', async (t) => {
  const dir = fixture(t),
    state = openCompletion(dir, 'native-task');
  let runs = 0;
  await completionStage(
    state,
    'evidence',
    'fixture',
    async () => {
      runs++;
      return { passed: true };
    },
    { save: (s) => saveCompletion(dir, s) },
  );
  const pending = createProgressOutbox(path.join(dir, 'progress')).read().pending;
  assert.deepEqual(
    pending.map((r) => r.receipt.event),
    ['started', 'completed'],
  );
  assert.equal(runs, 1);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'completion-session.json'))).events[0].status, 'success');
});
test('417 receipt transport preserves unknown writes, reads back before retry and never reexecutes task', async (t) => {
  const dir = fixture(t);
  let saved,
    writes = 0;
  recordCodexProgress(dir, 'native-task', 'actual-action-1', {
    observed_at: new Date(1000).toISOString(),
    event: 'completed',
    action: { id: 'actual-action-1', label: '验证' },
    evidence_refs: ['fixture:actual-test-report'],
    next: { kind: 'wait', label: '等待交付' },
  });
  const call = async (method, value) => {
    if (method === 'apply_task_progress_receipt') {
      writes++;
      saved = value.receipt;
      throw Error('response lost after write');
    }
    return {
      task: { id: 'native-task', revision: saved ? 2 : 1 },
      receipt_id: value.receipt_id,
      outcome: saved ? 'applied' : 'not_found',
      applied_revision: saved ? 2 : undefined,
      receipt: saved,
    };
  };
  assert.equal((await syncCodexProgress(dir, call))[0].status, 'confirmed');
  assert.deepEqual(await syncCodexProgress(dir, call), []);
  assert.equal(writes, 1);
});
test('unsupported live receipt capability retains outbox and cannot claim synchronization', async (t) => {
  const dir = fixture(t);
  recordCodexProgress(dir, 'native-task', 'event', {
    observed_at: new Date(1000).toISOString(),
    event: 'blocked',
    action: { id: 'event', label: '验证失败' },
    evidence_refs: ['fixture:failed-report'],
    next: { kind: 'wait', label: '核对原失败' },
  });
  assert.equal(
    (
      await syncCodexProgress(dir, async () => {
        throw Error('receipt capability unavailable');
      })
    )[0].status,
    'pending',
  );
  assert.equal(createProgressOutbox(dir).read().pending.length, 1);
});
