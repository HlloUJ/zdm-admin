import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoardIntake } from './task-board-intake.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { receiveCodexTask, startIndependentCodexTask } from './task-codex-host.mjs';
import { advanceTaskThread } from './task-thread-host-bridge.mjs';
import { createProgressOutbox } from './task-progress-outbox.mjs';
import { syncCodexCycle, planCycleThreadTitle } from './task-codex-cycle.mjs';
import {
  TASK_THREAD_MODE,
  threadTitle,
  taskThreadPolicy,
  enableTaskThreadPolicy,
  activatePublishedTaskThreads,
  createTaskThreadTitles,
} from './task-thread-titles.mjs';
const coordinator = '11111111-1111-4111-8111-111111111111';
const worker = '22222222-2222-4222-8222-222222222222';
const request = (sequence) => ({
  messageId: 'user-' + sequence,
  roomId: coordinator,
  authorId: 'fixture-user',
  sequence,
});
function fixture(t, { enabled = true, paused = false, suffix = '' } = {}) {
  const commonDir = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'task-title-'));
  t.after(() => rmSync(commonDir, { recursive: true, force: true }));
  const previous = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = coordinator;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previous;
  });
  if (enabled) enableTaskThreadPolicy(commonDir, { sourceHead: 'a'.repeat(40) });
  const intake = createBoardIntake(commonDir),
    queue = createExecutionOrder(commonDir),
    store = createTaskThreadTitles(commonDir);
  queue.initialize(request(1));
  if (!paused) queue.direct({ action: 'resume-all', request: request(2) });
  const input = {
    taskId: 'fixture-title',
    title: '用户指定名称',
    owner: coordinator,
    rootThreadId: coordinator,
    kind: 'infrastructure',
    request: request(3),
    ...(paused ? { startWhilePaused: true } : {}),
  };
  let board = { id: input.taskId, title: input.title, task_number: '387', revision: 1, status: 'active' };
  let actual,
    creates = 0,
    renames = 0,
    starts = 0;
  const host = {
    intake,
    queue,
    readTask: async (id) => {
      assert.equal(id, input.taskId);
      return { ...board };
    },
    readThread: async (id) =>
      id === coordinator
        ? { thread: { id }, turns: [{ items: [3, 4].map((n) => ({ type: 'userMessage', id: request(n).messageId })) }] }
        : structuredClone(actual),
    createThread: async ({ title, prompt }) => {
      creates++;
      actual = {
        thread: { id: worker, title },
        turns: [
          {
            items: [
              { type: 'userMessage', id: 'created-real-message', content: [{ type: 'text', text: prompt + suffix }] },
            ],
          },
        ],
      };
      return { threadId: worker };
    },
    renameThread: async ({ threadId, title }) => {
      assert.equal(threadId, worker);
      renames++;
      actual.thread.title = title;
    },
    renameTask: async ({ taskId, title }) => {
      assert.equal(taskId, input.taskId);
      board.title = title;
      board.revision++;
    },
    readCapacity: async () => ({ limit: 4, activeDevelopment: 0, activeDelivery: 0, activeOther: 0 }),
    start: async ({ taskId, owner, monitorContext, admission }) => {
      starts++;
      assert.equal(process.env.CODEX_THREAD_ID, owner);
      assert.equal(queue.assertAdmission({ lane: 'development', task: taskId, owner, admission }).active, true);
      return { task: { id: taskId, owner, monitoring: monitorContext } };
    },
  };
  return {
    commonDir,
    intake,
    queue,
    store,
    input,
    host,
    board,
    counts: () => ({ creates, renames, starts }),
    actual: () => actual,
  };
}
async function prepared(f) {
  const result = await receiveCodexTask(f.input, f.host);
  assert.equal(result.status, 'awaiting-worker-start');
  return result;
}
test('policy is opt-in, activation requires clean published main and exact latest CI/handoff', (t) => {
  const f = fixture(t, { enabled: false });
  assert.equal(taskThreadPolicy(f.commonDir).enabled, false);
  const head = 'b'.repeat(40),
    proof = {
      head,
      remoteHead: head,
      branch: 'main',
      clean: true,
      completion: {
        batch: 'codex-task-title-sync',
        events: [
          { name: 'ci', key: 'main-ci', status: 'success', result: { branch: 'main', headSha: head } },
          { name: 'handoff', key: head + ':final', status: 'success' },
        ],
      },
    };
  assert.throws(() => activatePublishedTaskThreads(f.commonDir, { ...proof, branch: 'codex/fixture' }));
  assert.throws(() => activatePublishedTaskThreads(f.commonDir, { ...proof, remoteHead: 'c'.repeat(40) }));
  assert.throws(() =>
    activatePublishedTaskThreads(f.commonDir, {
      ...proof,
      completion: { ...proof.completion, events: [...proof.completion.events, { name: 'ci', status: 'failure' }] },
    }),
  );
  assert.equal(activatePublishedTaskThreads(f.commonDir, proof).enabled, true);
});
test('enabled official entry automatically enrolls v2, binds real child and preserves original FIFO/request', async (t) => {
  const f = fixture(t);
  const result = await prepared(f);
  const receipt = JSON.parse(readFileSync(path.join(f.commonDir, 'task-board-intake/fixture-title.json')));
  assert.equal(receipt.version, 2);
  assert.equal(receipt.owner, coordinator);
  const ticket = f.queue.read().tickets[0];
  assert.equal(ticket.owner, worker);
  assert.equal(ticket.order, 3);
  assert.deepEqual(ticket.request, f.input.request);
  assert.equal(ticket.status, 'queued');
  assert.equal(ticket.admission, null);
  assert.equal(f.actual().thread.title, '387｜用户指定名称');
  assert.equal(f.counts().starts, 0);
  await assert.rejects(startIndependentCodexTask(result.workerInput, f.host), /runtime|owner|thread/i);
  process.env.CODEX_THREAD_ID = worker;
  assert.equal((await startIndependentCodexTask(result.workerInput, f.host)).task.owner, worker);
  assert.equal(f.counts().starts, 1);
  await assert.rejects(startIndependentCodexTask(result.workerInput, f.host), /Never replay/);
});
test('one proven native LF boundary is accepted and raw provenance retained', async (t) => {
  const f = fixture(t, { suffix: '\n' });
  await prepared(f);
  assert.ok(f.store.get(f.input.taskId).creationObservation.content[0].text.endsWith('\n'));
});
for (const suffix of ['\r\n', '\n\n', ' changed'])
  test('creation readback refuses altered native body ' + JSON.stringify(suffix), async (t) => {
    const f = fixture(t, { suffix });
    await assert.rejects(receiveCodexTask(f.input, f.host), /exact task creation instruction/);
    assert.equal(f.queue.read().tickets[0].awaitingNativeWorker, true);
    assert.equal(f.queue.read().tickets[0].admission, null);
  });
test('unknown create result is retained; subsequent receive never creates another child', async (t) => {
  const f = fixture(t);
  let calls = 0;
  f.host.createThread = async () => {
    calls++;
    throw Error('unknown network');
  };
  assert.equal((await receiveCodexTask(f.input, f.host)).status, 'waiting-thread-identity');
  assert.equal((await receiveCodexTask(f.input, f.host)).status, 'waiting-thread-identity');
  assert.equal(calls, 1);
  assert.equal(f.store.get(f.input.taskId).state, 'creation-unknown');
});
test('missing capacity and delivery reservation leave the FIFO ticket queued without creating a chat', async (t) => {
  const f = fixture(t);
  f.host.readCapacity = undefined;
  assert.equal((await receiveCodexTask(f.input, f.host)).status, 'queued');
  f.host.readCapacity = async () => ({ limit: 4, activeDevelopment: 3, activeDelivery: 0, activeOther: 0 });
  assert.equal((await receiveCodexTask(f.input, f.host)).status, 'queued');
  assert.equal(f.counts().creates, 0);
  assert.equal(f.queue.read().tickets[0].order, 3);
  assert.throws(() => f.queue.claim({ lane: 'development', task: f.input.taskId, owner: coordinator }), /not bound/);
});
test('native title write success without exact readback stays pending and cannot start', async (t) => {
  const f = fixture(t);
  const create = f.host.createThread;
  f.host.createThread = async (args) => {
    const result = await create(args);
    f.actual().thread.title = 'wrong';
    return result;
  };
  f.host.renameThread = async () => {};
  const result = await receiveCodexTask(f.input, f.host);
  assert.equal(result.status, 'title-sync-pending');
  assert.equal(f.queue.read().tickets[0].owner, coordinator);
  f.host.renameThread = async ({ title }) => {
    f.actual().thread.title = title;
  };
  await prepared(f);
  assert.equal(f.counts().creates, 1);
});
test('legacy owner/started tasks cannot convert or bind, original v1 remains compatible', async (t) => {
  const f = fixture(t, { enabled: false });
  await f.intake.accept(f.input, f.host);
  f.queue.enqueue({ lane: 'development', task: f.input.taskId, owner: coordinator, request: f.input.request });
  enableTaskThreadPolicy(f.commonDir, { sourceHead: 'a'.repeat(40) });
  await assert.rejects(f.intake.accept({ ...f.input, threadMode: TASK_THREAD_MODE }, f.host), /Legacy intake/);
  assert.equal(f.intake.modeFor(f.input.taskId), undefined);
  assert.throws(
    () =>
      f.queue.enqueue({
        lane: 'development',
        task: f.input.taskId,
        owner: coordinator,
        request: f.input.request,
        awaitingNativeWorker: true,
      }),
    /future native intake/,
  );
  assert.equal(f.counts().creates, 0);
});
test('new task scoped start preserves global pause and untouched historical tickets', async (t) => {
  const f = fixture(t, { paused: true });
  f.queue.enqueue({
    lane: 'development',
    task: 'old-paused',
    owner: 'old-owner',
    request: { ...request(2), messageId: 'old-source' },
  });
  const old = f.queue.read().tickets[0];
  const result = await prepared(f);
  process.env.CODEX_THREAD_ID = worker;
  await startIndependentCodexTask(result.workerInput, f.host);
  assert.equal(f.queue.read().paused, true);
  assert.deepEqual(f.queue.read().tickets[0], old);
  assert.equal(f.queue.read().scopedAdmissions.length, 1);
});
test('official rename changes board then exact child readback, completed number remains historical', async (t) => {
  const f = fixture(t);
  await prepared(f);
  assert.equal(
    (
      await f.store.rename(
        f.input.taskId,
        { title: '新的用户名称', rootThreadId: coordinator, request: request(4) },
        f.host,
      )
    ).status,
    'confirmed',
  );
  assert.equal(f.board.title, '新的用户名称');
  assert.equal(f.actual().thread.title, '387｜新的用户名称');
  f.board.status = 'done';
  f.board.historical_task_number = '387';
  f.board.task_number = null;
  await f.store.sync(f.input.taskId, f.host);
  assert.equal(f.actual().thread.title, '387｜新的用户名称');
  assert.equal(
    threadTitle({ id: 'another-task', title: 'another', status: 'active', task_number: '387' }),
    '387｜another',
  );
});
test('unknown official rename never repeats board write or creates another chat', async (t) => {
  const f = fixture(t);
  await prepared(f);
  let writes = 0;
  f.host.renameTask = async () => {
    writes++;
    throw Error('unknown');
  };
  const args = { title: '新名', rootThreadId: coordinator, request: request(4) };
  assert.equal((await f.store.rename(f.input.taskId, args, f.host)).status, 'board-rename-pending');
  assert.equal((await f.store.rename(f.input.taskId, args, f.host)).status, 'board-rename-pending');
  assert.equal(writes, 1);
  assert.equal(f.counts().creates, 1);
});
test('unknown dispatch is durable and never blindly resent', async (t) => {
  const f = fixture(t);
  let sends = 0;
  f.host.dispatchWorker = async () => {
    sends++;
    throw Error('unknown delivery');
  };
  assert.equal((await receiveCodexTask(f.input, f.host)).status, 'dispatch-unknown');
  assert.equal((await receiveCodexTask(f.input, f.host)).status, 'dispatch-unknown');
  assert.equal(sends, 1);
});
test('existing cycle syncs only enrolled binding; confirmation rejects stale, foreign or old-name observations', async (t) => {
  const f = fixture(t);
  await prepared(f);
  const directory = path.join(f.commonDir, 'outbox');
  const cycle = () =>
    syncCodexCycle(
      { task: f.input.taskId, directories: [directory], threadTitles: { store: f.store, ...f.host } },
      () => assert.fail('empty progress needs no transport'),
    );
  f.actual().thread.title = 'drift';
  assert.equal((await cycle()).threadTitle.status, 'confirmed');
  const observation = {
    provider: 'codex-native-read_thread',
    thread: { id: worker, title: f.actual().thread.title },
    observedAt: new Date().toISOString(),
  };
  await f.store.confirm(f.input.taskId, observation, f.host.readTask);
  await assert.rejects(
    f.store.confirm(
      f.input.taskId,
      { ...observation, thread: { ...observation.thread, id: coordinator } },
      f.host.readTask,
    ),
  );
  await assert.rejects(
    f.store.confirm(
      f.input.taskId,
      { ...observation, observedAt: new Date(Date.now() - 61000).toISOString() },
      f.host.readTask,
    ),
    /Fresh/,
  );
  f.board.title = 'changed';
  await assert.rejects(f.store.confirm(f.input.taskId, observation, f.host.readTask), /differs/);
  assert.deepEqual(
    f.store.enrolled().map((r) => r.taskId),
    [f.input.taskId],
  );
  const unused = { store: f.store, readTask: () => assert.fail('no historical reads') };
  assert.equal(
    (
      await syncCodexCycle(
        { task: 'old-task', directories: [path.join(f.commonDir, 'old')], threadTitles: unused },
        () => assert.fail(),
      )
    ).status,
    'confirmed',
  );
});

test('private host bridge advances real tool plans in separate steps without pretending native calls ran', async (t) => {
  const f = fixture(t);
  const observations = async (child = false) => [
    {
      provider: 'codex-native-read_thread',
      observedAt: new Date().toISOString(),
      snapshot: await f.host.readThread(coordinator),
    },
    ...(child
      ? [
          {
            provider: 'codex-native-read_thread',
            observedAt: new Date().toISOString(),
            snapshot: await f.host.readThread(worker),
          },
        ]
      : []),
  ];
  const config = {
    action: 'receive',
    task: f.input,
    capacity: {
      provider: 'codex-native-capacity',
      observedAt: new Date().toISOString(),
      snapshot: await f.host.readCapacity(),
    },
  };
  const adapters = { commonDir: f.commonDir, readTask: f.host.readTask, start: f.host.start };
  const first = await advanceTaskThread({ ...config, nativeObservations: await observations() }, adapters);
  assert.equal(first.result.status, 'waiting-thread-identity');
  assert.equal(f.counts().creates, 0);
  assert.equal(first.nativeActions.length, 1);
  assert.equal(first.nativeActions[0].tool, 'create_thread');
  const requestId = first.nativeActions[0].requestId;
  const uncertain = await advanceTaskThread({ ...config, nativeObservations: await observations() }, adapters);
  assert.equal(uncertain.nativeActions.length, 0); // An unknown creation is never recreated.
  await f.host.createThread(first.nativeActions[0]);
  const bound = await advanceTaskThread(
    { ...config, creationResult: { requestId, threadId: worker }, nativeObservations: await observations(true) },
    adapters,
  );
  assert.equal(bound.result.status, 'awaiting-worker-start');
  assert.equal(bound.nativeActions.length, 0);
  process.env.CODEX_THREAD_ID = worker;
  const actual = await advanceTaskThread(
    {
      action: 'start',
      task: bound.result.workerInput,
      capacity: config.capacity,
      nativeObservations: await observations(true),
    },
    adapters,
  );
  assert.equal(actual.result.task.owner, worker);
  assert.equal(f.counts().starts, 1);
});
test('private host bridge refuses stale native observations before queue or creation', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    advanceTaskThread(
      {
        action: 'receive',
        task: f.input,
        nativeObservations: [
          {
            provider: 'codex-native-read_thread',
            observedAt: new Date(Date.now() - 61000).toISOString(),
            snapshot: await f.host.readThread(coordinator),
          },
        ],
      },
      { commonDir: f.commonDir, readTask: f.host.readTask },
    ),
    /Fresh native/,
  );
  assert.deepEqual(f.queue.read().tickets, []);
  assert.equal(f.counts().creates, 0);
});

test('policy activation never enrolls an existing unreceipted historical queue task', async (t) => {
  const f = fixture(t);
  f.queue.enqueue({ lane: 'development', task: f.input.taskId, owner: coordinator, request: f.input.request });
  await assert.rejects(receiveCodexTask(f.input, f.host), /Historical queued task/);
  assert.equal(f.counts().creates, 0);
  assert.equal(f.store.get(f.input.taskId), null);
});

test('native title plan never hides an unsent receipt or reports cycle confirmation', async (t) => {
  const f = fixture(t);
  await prepared(f);
  const directory = path.join(f.commonDir, 'unsent');
  createProgressOutbox(directory).enqueue(f.input.taskId, 'fixture-fact', {
    event: 'completed',
    observed_at: new Date().toISOString(),
    action: { id: 'check', label: 'fixture check' },
    evidence_refs: ['fixture:check'],
    next: { kind: 'wait', label: 'wait' },
  });
  const progress = await syncCodexCycle({ task: f.input.taskId, directories: [directory] }, async () => {
    throw Error('offline');
  });
  assert.equal(progress.status, 'needs-attention');
  const planned = await planCycleThreadTitle(progress, f.store, f.host.readTask);
  assert.equal(planned.status, 'needs-attention');
  assert.equal(planned.threadTitle.status, 'native-readback-required');
  assert.equal(planned.outboxes[0].remaining, 1);
  assert.equal(createProgressOutbox(directory).read().pending.length, 1);
});
