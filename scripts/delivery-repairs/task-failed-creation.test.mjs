import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from '../task-registry.mjs';
import { createBoardIntake } from '../task-board-intake.mjs';
import { createExecutionOrder } from '../task-execution-order.mjs';
import { createTaskThreadTitles, enableTaskThreadPolicy } from '../task-thread-titles.mjs';
import { receiveCodexTask } from '../task-codex-host.mjs';
import { authorizeTaskCoordinator } from '../task-coordination.mjs';
import { advanceTaskThread } from '../task-thread-host-bridge.mjs';

const rootId = '11111111-1111-4111-8111-111111111111',
  oldWorker = '22222222-2222-4222-8222-222222222222',
  newWorker = '33333333-3333-4333-8333-333333333333';
async function fixture(t) {
  const prior = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = rootId;
  const base = path.join(process.cwd(), '.task-runtime/failed-creation-fixtures');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(path.join(base, 'known-')),
    root = path.join(directory, 'main'),
    parent = path.join(directory, 'worktrees');
  mkdirSync(root);
  mkdirSync(parent);
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
    if (prior === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = prior;
  });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'base'), 'preserve');
  git('add', '.');
  git('commit', '-m', 'base');
  git('worktree', 'add', '-b', 'codex/integration-current', path.join(parent, 'integration-current'));
  const registry = createTaskRegistry(root),
    commonDir = registry.commonDir;
  const intake = createBoardIntake(commonDir),
    queue = createExecutionOrder(commonDir),
    store = createTaskThreadTitles(commonDir);
  const request = (sequence) => ({
    sequence,
    messageId: 'actual-user-' + sequence,
    roomId: rootId,
    authorId: 'same-user',
  });
  queue.initialize(request(1));
  queue.direct({ action: 'resume-all', request: request(2) });
  enableTaskThreadPolicy(commonDir, { sourceHead: git('rev-parse', 'HEAD') });
  const input = {
    taskId: 'known-failed-create',
    title: '受信维护',
    kind: 'infrastructure',
    owner: rootId,
    rootThreadId: rootId,
    request: request(3),
  };
  const board = { id: input.taskId, title: input.title, task_number: '344', status: 'active', revision: 1 };
  const snapshots = new Map([
    [
      rootId,
      {
        thread: { id: rootId, hostId: 'local', status: { type: 'active' } },
        turns: [{ items: [3, 4].map((n) => ({ type: 'userMessage', id: request(n).messageId })) }],
      },
    ],
  ]);
  let creates = 0;
  const host = {
    intake,
    queue,
    readTask: async () => structuredClone(board),
    readThread: async (id) => structuredClone(snapshots.get(id)),
    readCapacity: async () => ({ limit: 5, activeDevelopment: 0, activeDelivery: 0, activeOther: 1 }),
    createThread: async (plan) => {
      const id = ++creates === 1 ? oldWorker : newWorker;
      const text = `<codex_delegation>\n  <source_thread_id>${rootId}</source_thread_id>\n  <input>${plan.prompt}${creates === 1 ? '\nAdditional safety instruction' : ''}</input>\n</codex_delegation>`;
      snapshots.set(id, {
        thread: { id, title: plan.title, hostId: 'local', status: { type: 'idle' } },
        turns: [
          {
            items: [
              {
                id: 'native-create-' + creates,
                type: 'functionCallOutput',
                namespace: 'codex_app',
                name: 'create_thread',
                output: { truncated: false, text },
              },
            ],
          },
        ],
      });
      return { threadId: id };
    },
  };
  await assert.rejects(receiveCodexTask(input, host), /exact task creation instruction/);
  await authorizeTaskCoordinator(commonDir, { rootThreadId: rootId, request: request(4), expectedRevision: 0 }, host);
  const original = store.get(input.taskId),
    originalBytes = readFileSync(path.join(store.base, 'tasks', input.taskId + '.json'));
  const retry = {
    ...input,
    coordinatorThreadId: rootId,
    decisionId: randomUUID(),
    retryRequest: request(4),
    originalRequestId: original.createRequestId,
    threadId: oldWorker,
    expectedQueueRevision: queue.read().revision,
    expectedCoordinationRevision: 1,
    expectedBoardRevision: 1,
  };
  const observation = {
    processes: [{ pid: process.pid, ppid: 1, command: 'node isolated-test' }],
    files: [{ pid: process.pid, name: root, type: 'DIR', descriptor: 'cwd' }],
    containers: [],
  };
  const recover = () => store.retryCreation(retry, host, { registry, observe: () => structuredClone(observation) });
  return {
    registry,
    commonDir,
    queue,
    store,
    input,
    retry,
    original,
    originalBytes,
    snapshots,
    host,
    board,
    git,
    parent,
    observation,
    recover,
    creates: () => creates,
  };
}
test('known complete appended-input failure is archived byte-for-byte and replaced once; the next attempt still requires exact native creation', async (t) => {
  const f = await fixture(t),
    q = f.queue.read(),
    old = structuredClone(f.snapshots.get(oldWorker));
  const result = await f.recover();
  assert.equal(result.status, 'replacement-creation-result-pending');
  const next = f.store.get(f.input.taskId);
  assert.notEqual(next.createRequestId, f.original.createRequestId);
  assert.equal(next.threadId, newWorker);
  assert.equal(
    next.creationPrompt,
    f.original.creationPrompt.replace(f.original.createRequestId, next.createRequestId),
  );
  const archive = JSON.parse(readFileSync(path.join(f.store.base, next.recovery.archive)));
  assert.equal(archive.originalBytes, f.originalBytes.toString());
  assert.deepEqual(archive.original, f.original);
  assert.deepEqual(archive.native, old);
  assert.equal(archive.actualInput, f.original.creationPrompt + '\nAdditional safety instruction');
  assert.deepEqual(f.queue.read(), q);
  assert.equal(f.creates(), 2);
  await f.recover();
  assert.equal(f.creates(), 2);
  assert.deepEqual(f.store.get(f.input.taskId), next);
  const result2 = await receiveCodexTask(f.input, f.host);
  assert.equal(result2.status, 'awaiting-worker-start');
  assert.equal(result2.workerInput.owner, newWorker);
  assert.equal(f.registry.readTask(f.input.taskId), null);
  assert.equal(f.creates(), 2);
  await f.recover();
  assert.equal(f.creates(), 2);
});
for (const scenario of [
  'unknown',
  'not-loaded',
  'active',
  'permission',
  'bound',
  'start-intent',
  'worktree',
  'branch',
  'data',
  'process',
  'container',
  'old-coordinator',
  'wrong-task',
  'wrong-nonce',
  'wrong-source',
  'truncated',
  'wrong-prompt',
  'exact-success',
  'capacity',
  'wrong-user',
  'stale-queue',
])
  test(
    'failed creation recovery refuses ' +
      scenario +
      ' without overwriting its original attempt or issuing a new create',
    async (t) => {
      const f = await fixture(t),
        worker = f.snapshots.get(oldWorker),
        target = path.join(f.parent, f.input.taskId);
      if (scenario === 'unknown') f.retry.threadId = null;
      if (scenario === 'not-loaded') worker.thread.status.type = 'notLoaded';
      if (scenario === 'active') worker.thread.status.type = 'active';
      if (scenario === 'permission')
        f.host.readThread = async () => {
          throw Error('Permission denied');
        };
      if (scenario === 'bound') {
        const dir = path.join(f.store.base, 'threads');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, oldWorker + '.json'), '{}');
      }
      if (scenario === 'start-intent') {
        const dir = path.join(f.commonDir, 'task-registry/start-intents');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, f.input.taskId + '.json'), '{}');
      }
      if (scenario === 'worktree') mkdirSync(target);
      if (scenario === 'branch') f.git('branch', 'codex/' + f.input.taskId);
      if (scenario === 'data')
        mkdirSync(path.join(f.commonDir, 'task-environments', f.input.taskId), { recursive: true });
      if (scenario === 'process')
        f.observation.processes.push({ pid: 90001, ppid: 1, command: 'node ' + target + '/writer.mjs' });
      if (scenario === 'container') f.observation.containers.push({ labels: { task: f.input.taskId }, mounts: [] });
      if (scenario === 'old-coordinator') process.env.CODEX_THREAD_ID = oldWorker;
      if (scenario === 'wrong-task') f.retry.taskId = 'another-task';
      if (scenario === 'wrong-nonce') f.retry.originalRequestId = randomUUID();
      if (scenario === 'wrong-source')
        worker.turns[0].items[0].output.text = worker.turns[0].items[0].output.text.replace(
          `<source_thread_id>${rootId}`,
          `<source_thread_id>${newWorker}`,
        );
      if (scenario === 'truncated') worker.turns[0].items[0].output.truncated = true;
      if (scenario === 'wrong-prompt')
        worker.turns[0].items[0].output.text = worker.turns[0].items[0].output.text.replace(
          '任务 ' + f.input.taskId,
          '任务 another-task',
        );
      if (scenario === 'exact-success')
        worker.turns[0].items[0].output.text = worker.turns[0].items[0].output.text.replace(
          '\nAdditional safety instruction',
          '',
        );
      if (scenario === 'capacity')
        f.host.readCapacity = async () => ({ limit: 2, activeDevelopment: 1, activeDelivery: 0, activeOther: 1 });
      if (scenario === 'wrong-user') f.retry.retryRequest.authorId = 'another-user';
      if (scenario === 'stale-queue') f.retry.expectedQueueRevision--;
      const q = f.queue.read();
      await assert.rejects(f.recover());
      assert.deepEqual(readFileSync(path.join(f.store.base, 'tasks', f.input.taskId + '.json')), f.originalBytes);
      assert.deepEqual(f.queue.read(), q);
      assert.equal(f.creates(), 1);
    },
  );
test('replacement unknown result and a second decision preserve the new attempt and never retry native creation', async (t) => {
  const f = await fixture(t);
  f.host.createThread = async () => {
    throw Error('Known transport failure, native result unknown');
  };
  await assert.rejects(f.recover(), /unknown/);
  const next = f.store.get(f.input.taskId);
  assert.equal(next.threadId, undefined);
  await f.recover();
  assert.equal(f.store.get(f.input.taskId).createRequestId, next.createRequestId);
  f.retry.decisionId = randomUUID();
  await assert.rejects(f.recover(), /replacement attempt/);
  assert.deepEqual(f.store.get(f.input.taskId), next);
  assert.ok(existsSync(path.join(f.store.base, next.recovery.archive)));
});
test('published host protocol emits one replacement plan, then requires a fresh exact native result through ordinary receive', async (t) => {
  const f = await fixture(t);
  const observations = () =>
    [...f.snapshots.values()].map((snapshot) => ({
      provider: 'codex-native-read_thread',
      observedAt: new Date().toISOString(),
      snapshot: structuredClone(snapshot),
    }));
  const capacity = {
    provider: 'codex-native-capacity',
    observedAt: new Date().toISOString(),
    snapshot: await f.host.readCapacity(),
  };
  const call = (input) =>
    advanceTaskThread(
      { ...input, nativeObservations: observations(), capacity },
      {
        commonDir: f.commonDir,
        registry: f.registry,
        readTask: f.host.readTask,
        observe: () => structuredClone(f.observation),
      },
    );
  const input = { action: 'retry-creation', task: f.retry };
  const first = await call(input);
  assert.equal(first.nativeActions.length, 1);
  const plan = first.nativeActions[0];
  assert.equal(plan.tool, 'create_thread');
  assert.notEqual(plan.requestId, f.original.createRequestId);
  assert.equal(plan.prompt, f.store.get(f.input.taskId).creationPrompt);
  const replay = await call(input);
  assert.deepEqual(replay.nativeActions, []);
  const unknown = await call({ action: 'receive', task: f.input });
  assert.deepEqual(unknown.nativeActions, []);
  assert.equal(unknown.result.status, 'waiting-thread-identity');
  f.snapshots.set(newWorker, {
    thread: { id: newWorker, title: plan.title, hostId: 'local', status: { type: 'idle' } },
    turns: [
      {
        items: [
          {
            id: 'actual-new-creation',
            type: 'functionCallOutput',
            namespace: 'codex_app',
            name: 'create_thread',
            output: {
              truncated: false,
              text: `<codex_delegation>\n  <source_thread_id>${rootId}</source_thread_id>\n  <input>${plan.prompt}</input>\n</codex_delegation>`,
            },
          },
        ],
      },
    ],
  });
  const ready = await call({
    action: 'receive',
    task: f.input,
    creationResult: { requestId: plan.requestId, threadId: newWorker },
  });
  assert.equal(ready.result.status, 'awaiting-worker-start');
  assert.equal(ready.result.workerInput.owner, newWorker);
  assert.equal(f.registry.readTask(f.input.taskId), null);
});
