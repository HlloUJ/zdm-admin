import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoardIntake } from './task-board-intake.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { receiveCodexTask, startIndependentCodexTask } from './task-codex-host.mjs';
import { advanceTaskThread } from './task-thread-host-bridge.mjs';
import { createProgressOutbox } from './task-progress-outbox.mjs';
import { authorizeTaskCoordinator } from './task-coordination.mjs';
import { syncCodexCycle, planCycleThreadTitle } from './task-codex-cycle.mjs';
import {
  verifyNativeCreation,
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
test('native v2 receive and worker start accept proven cross-coordinator source without rewriting its room', async (t) => {
  const f = fixture(t),
    source = '44444444-4444-4444-8444-444444444444';
  f.input.request.roomId = source;
  const originalRead = f.host.readThread;
  f.host.readThread = async (id) => {
    if (id === source)
      return { thread: { id }, turns: [{ items: [{ type: 'userMessage', id: f.input.request.messageId }] }] };
    if (id === coordinator)
      return {
        thread: { id },
        turns: [
          {
            items: [
              {
                id: 'original-coordinator-creation',
                type: 'functionCallOutput',
                namespace: 'codex_app',
                name: 'create_thread',
                output: {
                  truncated: false,
                  text: `<codex_delegation>\n  <source_thread_id>${source}</source_thread_id>\n  <input>authorized coordinator from ${f.input.request.messageId}</input>\n</codex_delegation>`,
                },
              },
            ],
          },
        ],
      };
    return originalRead(id);
  };
  const received = await prepared(f);
  assert.equal(f.queue.read().tickets[0].request.roomId, source);
  process.env.CODEX_THREAD_ID = worker;
  const started = await startIndependentCodexTask(received.workerInput, f.host);
  assert.equal(started.task.monitoring.roomId, source);
  assert.equal(started.task.monitoring.rootThreadId, coordinator);
  assert.equal(started.task.owner, worker);
});

function expireReceipt(f) {
  const file = path.join(f.commonDir, 'task-board-intake', f.input.taskId + '.json');
  const record = JSON.parse(readFileSync(file));
  record.observedAt = Date.now() - 600001;
  record.initialObservedAt = record.observedAt;
  writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  return { file, record, bytes: readFileSync(file) };
}
test('queued worker independently renews a receipt older than five minutes and starts once without root execution', async (t) => {
  const f = fixture(t),
    received = await prepared(f),
    old = expireReceipt(f);
  process.env.CODEX_THREAD_ID = worker;
  const result = await startIndependentCodexTask(received.workerInput, f.host);
  assert.equal(result.task.owner, worker);
  const refreshed = JSON.parse(readFileSync(old.file));
  assert.equal(refreshed.initialObservedAt, old.record.observedAt);
  assert.equal(refreshed.owner, coordinator);
  assert.equal(refreshed.messageId, old.record.messageId);
  assert.equal(refreshed.refreshHistory[0].executor, worker);
  assert.deepEqual(f.counts(), { creates: 1, renames: 0, starts: 1 });
  await assert.rejects(startIndependentCodexTask(received.workerInput, f.host), /Never replay/);
});

test('A to B to C renews queued original authorization through the current appointment, not an invented direct A to C creation', async (t) => {
  const f = fixture(t),
    received = await prepared(f),
    old = expireReceipt(f);
  const b = '77777777-7777-4777-8777-777777777777';
  const c = '88888888-8888-4888-8888-888888888888';
  const originalRead = f.host.readThread;
  const snapshots = new Map([[coordinator, await originalRead(coordinator)]]);
  f.host.readThread = async (id) => snapshots.get(id) ?? originalRead(id);
  process.env.CODEX_THREAD_ID = coordinator;
  await authorizeTaskCoordinator(
    f.commonDir,
    { rootThreadId: coordinator, request: f.input.request, expectedRevision: 0 },
    f.host,
  );
  let previous = coordinator;
  for (const [index, current] of [b, c].entries()) {
    const request = {
      ...f.input.request,
      roomId: previous,
      messageId: 'appointment-' + current,
      sequence: f.input.request.sequence + index + 1,
    };
    snapshots.get(previous).turns[0].items.push({ type: 'userMessage', id: request.messageId });
    snapshots.set(current, {
      thread: { id: current },
      turns: [
        {
          items: [
            {
              id: 'created-' + current,
              type: 'functionCallOutput',
              namespace: 'codex_app',
              name: 'create_thread',
              output: {
                truncated: false,
                text: `<codex_delegation>\n  <source_thread_id>${previous}</source_thread_id>\n  <input>New coordinator from ${request.messageId}</input>\n</codex_delegation>`,
              },
            },
          ],
        },
      ],
    });
    process.env.CODEX_THREAD_ID = current;
    await authorizeTaskCoordinator(
      f.commonDir,
      { rootThreadId: current, request, expectedRevision: index + 1 },
      f.host,
    );
    previous = current;
  }
  const observedAt = new Date().toISOString();
  const observations = await Promise.all(
    [coordinator, b, c, worker].map(async (id) => ({
      provider: 'codex-native-read_thread',
      observedAt,
      snapshot: await f.host.readThread(id),
    })),
  );
  const input = {
    action: 'start',
    task: received.workerInput,
    nativeObservations: observations,
    capacity: { provider: 'codex-native-capacity', observedAt, snapshot: await f.host.readCapacity() },
  };
  const adapters = { commonDir: f.commonDir, readTask: f.host.readTask, start: f.host.start };
  process.env.CODEX_THREAD_ID = coordinator;
  await assert.rejects(
    advanceTaskThread({ ...input, action: 'receive', task: f.input }, adapters),
    /current authorized coordinator/,
  );
  process.env.CODEX_THREAD_ID = worker;
  const before = f.queue.read();
  const forged = structuredClone(input);
  const event = forged.nativeObservations.find((o) => o.snapshot.thread.id === c).snapshot.turns[0].items[0];
  event.output.text = event.output.text.replace(b, coordinator);
  await assert.rejects(advanceTaskThread(forged, adapters), /provenance/);
  assert.deepEqual(f.queue.read(), before);
  assert.deepEqual(readFileSync(old.file), old.bytes);
  const result = await advanceTaskThread(input, adapters);
  assert.equal(result.result.task.monitoring.coordinatorThreadId, c);
  assert.equal(result.result.task.monitoring.rootThreadId, coordinator);
  const receipt = JSON.parse(readFileSync(old.file));
  assert.equal(receipt.messageId, f.input.request.messageId);
  assert.equal(receipt.owner, coordinator);
  assert.equal(receipt.initialObservedAt, old.record.observedAt);
  assert.equal(receipt.refreshHistory.at(-1).coordinator, c);
  assert.equal(receipt.refreshHistory.at(-1).executor, worker);
  assert.deepEqual(f.counts(), { creates: 1, renames: 0, starts: 1 });
  await assert.rejects(advanceTaskThread(input, adapters), /Never replay/);
});
for (const invalid of ['paused-card', 'done-card', 'renumbered', 'during-read-revision', 'network', 'queue-paused']) {
  test(`expired receipt does not claim, receive or recreate when ${invalid}`, async (t) => {
    const f = fixture(t),
      received = await prepared(f),
      old = expireReceipt(f);
    const originalRead = f.host.readTask;
    let reads = 0;
    f.host.readTask = async (id) => {
      const board = await originalRead(id);
      reads++;
      if (invalid === 'paused-card') board.status = 'paused';
      if (invalid === 'done-card') board.status = 'done';
      if (invalid === 'renumbered') board.task_number = '999';
      if (invalid === 'during-read-revision' && reads >= 3) board.revision++;
      if (invalid === 'network' && reads >= 3) throw Error('network unavailable');
      return board;
    };
    if (invalid === 'queue-paused') f.queue.direct({ action: 'pause-all', request: request(4) });
    const before = f.queue.read();
    process.env.CODEX_THREAD_ID = worker;
    await assert.rejects(startIndependentCodexTask(received.workerInput, f.host));
    assert.deepEqual(f.queue.read(), before);
    assert.deepEqual(readFileSync(old.file), old.bytes);
    assert.deepEqual(f.counts(), { creates: 1, renames: 0, starts: 0 });
    if (invalid === 'network') {
      f.host.readTask = originalRead;
      await startIndependentCodexTask(received.workerInput, f.host);
      assert.equal(f.counts().starts, 1);
      assert.equal(f.counts().creates, 1);
    }
  });
}
test('published host routes an expired queued worker to current coordination without invoking or impersonating old root', async (t) => {
  const f = fixture(t),
    received = await prepared(f),
    old = expireReceipt(f);
  const current = '55555555-5555-4555-8555-555555555555',
    originalRead = f.host.readThread;
  f.host.readThread = async (id) =>
    id === current
      ? {
          thread: { id },
          turns: [
            {
              items: [
                {
                  id: 'native-current-coordinator',
                  type: 'functionCallOutput',
                  namespace: 'codex_app',
                  name: 'create_thread',
                  output: {
                    truncated: false,
                    text: `<codex_delegation>\n  <source_thread_id>${coordinator}</source_thread_id>\n  <input>current coordinator authorized by ${f.input.request.messageId}</input>\n</codex_delegation>`,
                  },
                },
              ],
            },
          ],
        }
      : originalRead(id);
  process.env.CODEX_THREAD_ID = current;
  await authorizeTaskCoordinator(
    f.commonDir,
    { rootThreadId: current, request: f.input.request, expectedRevision: 0 },
    f.host,
  );
  process.env.CODEX_THREAD_ID = worker;
  const observedAt = new Date().toISOString();
  const nativeObservations = await Promise.all(
    [coordinator, current, worker].map(async (id) => ({
      provider: 'codex-native-read_thread',
      observedAt,
      snapshot: await f.host.readThread(id),
    })),
  );
  const result = await advanceTaskThread(
    {
      action: 'start',
      task: received.workerInput,
      nativeObservations,
      capacity: { provider: 'codex-native-capacity', observedAt, snapshot: await f.host.readCapacity() },
    },
    { commonDir: f.commonDir, readTask: f.host.readTask, start: f.host.start },
  );
  assert.equal(result.result.task.monitoring.coordinatorThreadId, current);
  assert.equal(result.result.task.monitoring.rootThreadId, coordinator);
  const receipt = JSON.parse(readFileSync(old.file));
  assert.equal(receipt.owner, coordinator);
  assert.equal(receipt.refreshHistory[0].coordinator, current);
  process.env.CODEX_THREAD_ID = current;
  const directory = path.join(f.commonDir, 'current-coordinator-outbox');
  createProgressOutbox(directory).enqueue(f.input.taskId, 'verified-current-start', {
    event: 'started',
    observed_at: new Date().toISOString(),
    action: { id: 'start', label: 'started' },
    evidence_refs: ['fixture:actual-start'],
    next: { kind: 'wait', label: 'wait' },
  });
  let saved = null,
    writes = 0;
  const call = async (operation, args) => {
    if (operation === 'apply_task_progress_receipt') {
      writes++;
      saved = args.receipt;
      return {};
    }
    return {
      task: { id: f.input.taskId, revision: saved ? 2 : 1 },
      receipt_id: args.receipt_id,
      outcome: saved ? 'applied' : 'not_found',
      receipt: saved,
      applied_revision: saved ? 2 : null,
    };
  };
  const config = { task: f.input.taskId, directories: [directory] };
  assert.equal((await syncCodexCycle(config, call)).status, 'confirmed');
  assert.equal((await syncCodexCycle(config, call)).status, 'confirmed');
  assert.equal(writes, 1);
  await assert.rejects(
    advanceTaskThread({ action: 'receive', task: f.input }, { commonDir: f.commonDir }),
    /current authorized coordinator/,
  );
  assert.deepEqual(f.counts(), { creates: 1, renames: 0, starts: 1 });
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

function nativeCreation(record) {
  return {
    thread: { id: record.threadId },
    turns: [
      {
        items: [
          {
            type: 'functionCallOutput',
            id: 'fco-real-create',
            namespace: 'codex_app',
            name: 'create_thread',
            output: {
              text: `<codex_delegation>\n  <source_thread_id>${record.rootThreadId}</source_thread_id>\n  <input>${record.creationPrompt}</input>\n</codex_delegation>`,
              truncated: false,
            },
          },
        ],
      },
    ],
  };
}
test('native create delegation binds and starts through the existing host flow, preserving raw provenance', async (t) => {
  const f = fixture(t);
  const create = f.host.createThread;
  f.host.createThread = async (plan) => {
    const result = await create(plan);
    f.actual().turns = nativeCreation({
      threadId: worker,
      rootThreadId: coordinator,
      creationPrompt: plan.prompt,
    }).turns;
    return result;
  };
  const result = await prepared(f);
  const record = f.store.get(f.input.taskId);
  assert.deepEqual(record.creationObservation, f.actual().turns[0].items[0]);
  assert.equal(record.creationObservation.type, 'functionCallOutput');
  assert.equal(record.creationMessageId, 'fco-real-create');
  process.env.CODEX_THREAD_ID = worker;
  assert.equal((await startIndependentCodexTask(result.workerInput, f.host)).task.owner, worker);
  assert.deepEqual(f.counts(), { creates: 1, renames: 0, starts: 1 });
});
test('native creation verification rejects wrong identity, missing marker, nonce, truncation and dispatch-only events', () => {
  const record = {
    threadId: worker,
    rootThreadId: coordinator,
    createRequestId: 'original-nonce',
    creationPrompt: 'exact original\n创建标识：original-nonce\nwait',
  };
  const actual = nativeCreation(record);
  assert.equal(verifyNativeCreation(record, actual), actual.turns[0].items[0]);
  const mutations = [
    (x) => {
      x.thread.id = coordinator;
    },
    (x) => {
      x.turns[0].items[0].namespace = 'other';
    },
    (x) => {
      x.turns[0].items[0].name = 'send_message_to_thread';
    },
    (x) => {
      x.turns[0].items[0].output.truncated = true;
    },
    (x) => {
      delete x.turns[0].items[0].output.truncated;
    },
    (x) => {
      x.turns[0].items[0].output.text = record.creationPrompt;
    },
    (x) => {
      x.turns[0].items[0].output.text = x.turns[0].items[0].output.text.replace(coordinator, worker);
    },
    (x) => {
      x.turns[0].items[0].output.text = x.turns[0].items[0].output.text.replace('original-nonce', 'foreign-nonce');
    },
    (x) => {
      x.turns[0].items[0].output.text = x.turns[0].items[0].output.text.replace('创建标识：original-nonce', '');
    },
    (x) => {
      x.turns[0].items[0].output.text += '\n';
    },
    (x) => {
      x.turns[0].items = [];
      x.thread.preview = record.creationPrompt;
    },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(actual);
    mutate(bad);
    assert.throws(() => verifyNativeCreation(record, bad));
  }
  assert.throws(() => verifyNativeCreation({ ...record, createRequestId: 'foreign-nonce' }, actual));
});
