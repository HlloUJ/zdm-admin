import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { rebindHistoricalTask, resumeBoundTask } from './task-rebinding.mjs';
import { assertTaskExecutor, taskExecutor, verifyCoordinatorSource } from './task-execution-binding.mjs';
import { createBoardIntake } from './task-board-intake.mjs';
import { checkpointTask } from './task-development.mjs';
import { startParallelTask } from './task-start.mjs';
import { completionCommand } from './completion-cli.mjs';
import { runCompletionWithProgress } from './task-completion-progress.mjs';
import { prepareProgressStage, notifyProgressHost } from './task-progress-host.mjs';
import { collectTaskProgress } from './task-progress-collector.mjs';
import { authorizeTaskCoordinator, readTaskCoordination } from './task-coordination.mjs';

const old = '11111111-1111-4111-8111-111111111111';
const root = '22222222-2222-4222-8222-222222222222';
const worker = '33333333-3333-4333-8333-333333333333';
const source = '44444444-4444-4444-8444-444444444444';
const legacyRoot = '66666666-6666-4666-8666-666666666666';
function delegate(id, from, prompt, title = '') {
  return {
    thread: { id, title, hostId: 'local', status: { type: 'idle' } },
    turns: [
      {
        items: [
          {
            id: 'create-' + id,
            type: 'functionCallOutput',
            name: 'create_thread',
            namespace: 'codex_app',
            output: {
              truncated: false,
              text: `<codex_delegation>\n  <source_thread_id>${from}</source_thread_id>\n  <input>${prompt}</input>\n</codex_delegation>`,
            },
          },
        ],
      },
    ],
  };
}
function fixture(t, { collaboration = false } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'rebinding-fixture-'))),
    main = path.join(dir, 'main'),
    worktree = path.join(dir, 'task');
  mkdirSync(main);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = process.env.CODEX_THREAD_ID,
    admission = process.env.ZDM_EXECUTION_ADMISSION;
  t.after(() => {
    if (env === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = env;
    if (admission === undefined) delete process.env.ZDM_EXECUTION_ADMISSION;
    else process.env.ZDM_EXECUTION_ADMISSION = admission;
  });
  process.env.CODEX_THREAD_ID = root;
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(main, 'base.txt'), 'base');
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'base');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(main, 'worktree', 'add', '-b', 'codex/task', worktree);
  const registry = createTaskRegistry(main);
  process.env.CODEX_THREAD_ID = old;
  const monitorContext = collaboration
    ? {
        worker: '/root/original_worker',
        rootThreadId: legacyRoot,
        roomId: legacyRoot,
        authorizationRef: 'original-authorization',
        taskStableId: 'task',
        taskNumber: '750',
        taskName: 'fixture',
      }
    : undefined;
  const task = registry.register({ id: 'task', worktree, owner: old, kind: 'infrastructure', monitorContext });
  process.env.CODEX_THREAD_ID = root;
  if (collaboration) {
    const dir = path.join(registry.commonDir, 'task-registry/start-intents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'task.json'),
      JSON.stringify({
        task: 'task',
        owner: old,
        worktree,
        branch: task.branch,
        base: task.base,
        state: 'registered',
      }),
    );
  }
  const queue = createExecutionOrder(registry.commonDir);
  const req = (n, roomId = source) => ({ messageId: 'user-' + n, roomId, authorId: 'human', sequence: n });
  queue.initialize(req(1));
  queue.enqueue({ lane: 'development', task: task.id, owner: old, request: req(2) });
  const board = { id: 'task', title: 'fixture', task_number: '750', revision: 1, status: 'active' };
  const input = {
    taskId: 'task',
    owner: worker,
    rootThreadId: root,
    request: req(5),
    expectedRevision: task.revision,
    queueRevision: queue.read().revision,
    boardRevision: 1,
    kind: task.kind,
  };
  const snapshots = new Map([
    [old, { thread: { id: old, hostId: 'local', status: { type: 'idle' } } }],
    [
      source,
      {
        thread: { id: source, hostId: 'local', status: { type: 'idle' } },
        turns: [
          {
            items: [
              { type: 'userMessage', id: input.request.messageId },
              ...(collaboration ? [{ type: 'userMessage', id: 'original-authorization', text: 'Execute task' }] : []),
            ],
          },
        ],
      },
    ],
    [root, delegate(root, source, 'authorized coordinator ' + input.request.messageId)],
    [worker, delegate(worker, root, 'Execute task task', '750｜fixture')],
  ]);
  if (collaboration)
    snapshots.set(legacyRoot, {
      thread: { id: legacyRoot, hostId: 'local', status: { type: 'idle' } },
      turns: [{ items: [{ type: 'userMessage', id: 'original-authorization', text: 'Execute task' }] }],
    });
  const host = {
    readThread: async (id) => snapshots.get(id),
    readTask: async () => board,
    readCapacity: async () => ({ limit: 3, activeDevelopment: 0, activeDelivery: 0, activeOther: 0 }),
    dependenciesReady: () => true,
  };
  const observe = () => ({
    processes: [{ pid: process.pid, ppid: 1, command: 'node bridge' }],
    files: [{ name: '/outside', pid: process.pid }],
    containers: [],
  });
  const bind = (changes = {}, options = {}) =>
    rebindHistoricalTask({ ...input, ...changes }, host, { registry, queue, observe, now: 5000, ...options });
  return { dir, main, worktree, registry, queue, input, host, snapshots, observe, bind, task, board, git };
}

test('native cross-coordinator intake preserves the source room and rejects forged delegation', async (t) => {
  const f = fixture(t),
    intake = createBoardIntake(f.registry.commonDir);
  const input = { ...f.input, taskId: 'new-task', title: 'new', owner: root };
  const board = { ...f.board, id: input.taskId, title: input.title };
  await intake.accept(input, { ...f.host, readTask: async () => board });
  const receipt = JSON.parse(readFileSync(path.join(f.registry.commonDir, 'task-board-intake/new-task.json')));
  assert.equal(receipt.sourceRoomId, source);
  assert.equal(receipt.rootThreadId, root);
  f.snapshots.set(root, delegate(root, old, 'authorized coordinator ' + input.request.messageId));
  await assert.rejects(verifyCoordinatorSource(input, f.host.readThread), /provenance/);
  f.snapshots.set(source, { thread: { id: source }, turns: [] });
  await assert.rejects(verifyCoordinatorSource(input, f.host.readThread), /user execution/);
});

test('legacy collaboration verifies its real root and authorization without inventing a native owner chat', async (t) => {
  const f = fixture(t, { collaboration: true });
  f.snapshots.delete(old);
  const before = f.task.monitoring,
    queue = f.queue.read();
  const result = await f.bind();
  const proof = result.task.executionBindings[0].nativeEvidence.previousExecutor;
  assert.equal(proof.executionSurface, 'collaboration-agent');
  assert.equal(proof.rootThreadId, legacyRoot);
  assert.equal(proof.historicalOwner, old);
  assert.equal(proof.worker, '/root/original_worker');
  assert.equal(Object.hasOwn(proof, 'threadId'), false);
  assert.deepEqual(result.task.monitoring, before);
  assert.deepEqual(f.queue.read(), queue);
});

for (const failure of [
  'root-not-found',
  'root-active',
  'cross-host',
  'original-authorization',
  'start-intent',
  'process',
]) {
  test(`legacy collaboration remains fenced on missing/unsafe evidence: ${failure}`, async (t) => {
    const f = fixture(t, { collaboration: true });
    const adapters = {};
    f.snapshots.delete(old);
    if (failure === 'root-not-found') f.snapshots.delete(legacyRoot);
    if (failure === 'root-active') f.snapshots.get(legacyRoot).thread.status.type = 'active';
    if (failure === 'cross-host') f.snapshots.get(legacyRoot).thread.hostId = 'remote';
    if (failure === 'original-authorization') f.snapshots.get(legacyRoot).turns[0].items = [];
    if (failure === 'start-intent') rmSync(path.join(f.registry.commonDir, 'task-registry/start-intents/task.json'));
    if (failure === 'process')
      adapters.observe = () => ({
        ...f.observe(),
        processes: [...f.observe().processes, { pid: process.pid + 999, ppid: 1, command: 'node ' + f.worktree }],
      });
    const before = f.registry.readTask('task'),
      queue = f.queue.read();
    await assert.rejects(f.bind({}, adapters));
    assert.deepEqual(f.registry.readTask('task'), before);
    assert.deepEqual(f.queue.read(), queue);
  });
}

test('a process-prefixed test report is preserved with UUID journals and original event references', async (t) => {
  const f = fixture(t);
  const reportDir = path.join(f.worktree, '.task-verification/checkpoint');
  mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, 'process-example-checkpoint-report.json');
  const report = JSON.stringify({
    scope: 'isolated tests',
    baseCheckpoint: 'a'.repeat(40),
    tests: { passed: 127, failed: 0, skipped: 0, retries: 0 },
    static: {},
    production: {},
  });
  writeFileSync(reportFile, report);
  const delivery = path.join(f.registry.commonDir, 'task-delivery/task');
  mkdirSync(delivery, { recursive: true });
  const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const journalFile = path.join(delivery, 'process-' + token + '.json');
  const journal = JSON.stringify({ token, host: 'historical-host', pgid: 12345, status: 'quiescent' });
  writeFileSync(journalFile, journal);
  const sessionFile = path.join(delivery, 'completion-session.json');
  const session = JSON.stringify({ events: [{ status: 'failed', processTracking: 1, processes: [{ token }] }] });
  writeFileSync(sessionFile, session);
  await f.bind();
  assert.equal(readFileSync(reportFile, 'utf8'), report);
  assert.equal(readFileSync(journalFile, 'utf8'), journal);
  assert.equal(readFileSync(sessionFile, 'utf8'), session);
});

for (const failure of [
  'unsealed',
  'malformed',
  'token-mismatch',
  'renamed-journal',
  'unknown-report',
  'invalid-json',
  'missing-reference',
  'invalid-reference',
  'orphan-journal',
]) {
  test(`process identity cannot be bypassed by report compatibility: ${failure}`, async (t) => {
    const f = fixture(t);
    const directory = path.join(f.registry.commonDir, 'task-delivery/task');
    mkdirSync(directory, { recursive: true });
    const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    let name = 'process-' + token + '.json';
    let record = { token, host: 'original-host', pgid: 12345, status: 'quiescent' };
    if (failure === 'unsealed') record.status = 'started';
    if (failure === 'malformed') delete record.pgid;
    if (failure === 'token-mismatch') record.token = worker;
    if (failure === 'renamed-journal') name = 'process-renamed.json';
    if (failure === 'unknown-report') {
      name = 'process-unknown.json';
      record = { passed: true };
    }
    writeFileSync(path.join(directory, name), failure === 'invalid-json' ? '{' : JSON.stringify(record));
    if (failure.includes('reference')) {
      if (failure === 'missing-reference') rmSync(path.join(directory, name));
      writeFileSync(
        path.join(directory, 'completion-session.json'),
        JSON.stringify({
          events: [
            {
              status: 'passed',
              processTracking: 1,
              processes: [{ token: failure === 'invalid-reference' ? '../escape' : token }],
            },
          ],
        }),
      );
    }
    if (failure === 'orphan-journal')
      writeFileSync(path.join(directory, 'completion-session.json'), JSON.stringify({ events: [] }));
    const before = f.registry.readTask('task'),
      queue = f.queue.read();
    await assert.rejects(f.bind());
    assert.deepEqual(f.registry.readTask('task'), before);
    assert.deepEqual(f.queue.read(), queue);
  });
}

test('binding is additive, exact replay is read-only and old executor loses access', async (t) => {
  const f = fixture(t),
    beforeQueue = f.queue.read();
  writeFileSync(path.join(f.worktree, 'unfinished.txt'), 'retain');
  const result = await f.bind();
  assert.equal(result.task.owner, old);
  assert.deepEqual(result.task.monitoring, f.task.monitoring);
  assert.equal(taskExecutor(result.task), worker);
  assert.equal(result.resumed, false);
  assert.deepEqual(f.queue.read(), beforeQueue);
  const again = await f.bind({}, { observe: () => assert.fail('replay must not observe or mutate') });
  assert.equal(again.replayed, true);
  assert.deepEqual(again.task, result.task);
  assert.throws(() => assertTaskExecutor(result.task, old), /must own/);
  process.env.CODEX_THREAD_ID = worker;
  assert.doesNotThrow(() => assertTaskExecutor(result.task, worker));
  process.env.CODEX_THREAD_ID = root;
  assert.throws(
    () =>
      f.registry.revise('task', result.task.revision, (r) => {
        r.executionBindings = [];
      }),
    /verified host/,
  );
  assert.throws(
    () =>
      f.registry.revise('task', result.task.revision, (r) => {
        r.monitoring = {};
      }),
    /Historical monitoring/,
  );
  await assert.rejects(f.bind({ owner: source }), /title|Worker|different worker/);
  assert.equal(readFileSync(path.join(f.worktree, 'unfinished.txt'), 'utf8'), 'retain');
});

test('a historical carrier with no original monitoring becomes observable through its additive binding', async (t) => {
  const f = fixture(t);
  f.registry.revise('task', f.task.revision, (record) => {
    delete record.monitoring;
  });
  f.input.expectedRevision = f.registry.readTask('task').revision;
  await f.bind();
  const observations = collectTaskProgress(f.main);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].owner, worker);
  assert.equal(observations[0].historicalOwner, old);
  assert.equal(observations[0].monitoring.worker, worker);
  assert.notEqual(observations[0].status, 'registration-incomplete');
  assert.equal(Object.hasOwn(f.registry.readTask('task'), 'monitoring'), false);
});

for (const failure of [
  'active-old',
  'stale-registry',
  'stale-queue',
  'wrong-title',
  'wrong-user',
  'process',
  'open-file',
  'container',
  'inventory-error',
  'resource-lease',
  'running-session',
  'retained-lock',
]) {
  test(`unsafe rebinding preserves every record: ${failure}`, async (t) => {
    const f = fixture(t);
    const adapters = {};
    if (failure === 'active-old') f.snapshots.get(old).thread.status.type = 'active';
    if (failure === 'stale-registry') f.input.expectedRevision++;
    if (failure === 'stale-queue') f.input.queueRevision++;
    if (failure === 'wrong-title') f.snapshots.get(worker).thread.title = 'other';
    if (failure === 'wrong-user') f.input.request.authorId = 'another';
    if (['process', 'open-file', 'container'].includes(failure))
      adapters.observe = () => {
        const s = f.observe();
        if (failure === 'process') s.processes.push({ pid: process.pid + 999, ppid: 1, command: 'node ' + f.worktree });
        if (failure === 'open-file') s.files.push({ name: f.worktree + '/removed.log (deleted)' });
        if (failure === 'container') s.containers.push({ labels: { task: f.worktree }, mounts: [] });
        return s;
      };
    if (failure === 'inventory-error')
      adapters.observe = () => {
        throw Error('inventory denied');
      };
    if (failure === 'resource-lease') {
      const d = path.join(f.registry.commonDir, 'task-registry/resource-leases/task-delivery-task');
      mkdirSync(d, { recursive: true });
      writeFileSync(
        path.join(d, 'owner.json'),
        JSON.stringify({ task: old, resource: 'task-delivery-task', pid: process.pid, token: 'retained' }),
      );
    }
    if (failure === 'running-session') {
      const d = path.join(f.registry.commonDir, 'task-delivery/task');
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, 'completion-session.json'), JSON.stringify({ events: [{ status: 'running' }] }));
    }
    if (failure === 'retained-lock')
      mkdirSync(path.join(f.worktree, '.task-runtime/unknown.lock'), { recursive: true });
    const before = f.registry.readTask('task'),
      q = f.queue.read();
    await assert.rejects(f.bind({}, adapters));
    assert.deepEqual(f.registry.readTask('task'), before);
    assert.deepEqual(f.queue.read(), q);
  });
}

test('bound worker resumes through admission/start/checkpoint while retaining historical ledger owner', async (t) => {
  const f = fixture(t);
  await f.bind();
  process.env.CODEX_THREAD_ID = worker;
  f.host.start = async ({ owner, monitorContext, admission }) => {
    process.env.ZDM_EXECUTION_ADMISSION = admission;
    return startParallelTask(
      { slug: 'task', owner, kind: 'infrastructure', monitorContext },
      {
        root: f.main,
        registry: f.registry,
        prepare: () => ({}),
        bindTiming: () => ({}),
      },
    );
  };
  const resumed = await resumeBoundTask(
    { ...f.input, taskRevision: f.registry.readTask('task').revision, lane: 'development' },
    f.host,
    { registry: f.registry, queue: f.queue },
  );
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.task.owner, old);
  assert.equal(f.queue.read().tickets[0].owner, old);
  assert.equal(f.queue.read().tickets[0].status, 'running');
  checkpointTask(f.worktree, {
    id: 'task',
    owner: worker,
    commit: f.git(f.worktree, 'rev-parse', 'HEAD'),
    verification: 'fixture source retained',
  });
  await assert.rejects(
    resumeBoundTask(
      {
        ...f.input,
        taskRevision: f.registry.readTask('task').revision,
        queueRevision: f.queue.read().revision,
        lane: 'development',
      },
      f.host,
      { registry: f.registry, queue: f.queue },
    ),
    /never replay/,
  );
  process.env.CODEX_THREAD_ID = old;
  assert.throws(
    () =>
      f.queue.assertAdmission({
        lane: 'development',
        task: 'task',
        owner: old,
        admission: process.env.ZDM_EXECUTION_ADMISSION,
      }),
    /must own/,
  );
  await assert.rejects(completionCommand(f.worktree, ['begin'], { owner: old }), /must own/);
});

test('fenced running delivery keeps its original freeze, session and occupied ticket across rebinding', async (t) => {
  const f = fixture(t),
    req = (n) => ({ messageId: 'user-' + n, roomId: source, authorId: 'human', sequence: n });
  f.queue.enqueue({ lane: 'delivery', task: 'task', owner: old, request: req(2) });
  f.queue.direct({ action: 'resume-only', lane: 'delivery', task: 'task', owner: old, request: req(3) });
  process.env.CODEX_THREAD_ID = old;
  process.env.ZDM_EXECUTION_ADMISSION = f.queue.read().tickets.find((q) => q.lane === 'delivery').admission;
  await completionCommand(f.worktree, ['begin']);
  f.queue.direct({ action: 'pause-all', request: req(4) });
  f.input.expectedRevision = f.registry.readTask('task').revision;
  f.input.queueRevision = f.queue.read().revision;
  const acceptedFile = path.join(f.registry.commonDir, 'task-delivery/task/accepted-source.json');
  const accepted = readFileSync(acceptedFile);
  const sessionFile = path.join(f.registry.commonDir, 'task-delivery/task/completion-session.json');
  const session = readFileSync(sessionFile);
  const originalTicket = f.queue.read().tickets.find((q) => q.lane === 'delivery');
  process.env.CODEX_THREAD_ID = root;
  await f.bind();
  assert.deepEqual(readFileSync(sessionFile), session);
  assert.deepEqual(
    f.queue.read().tickets.find((q) => q.lane === 'delivery'),
    originalTicket,
  );
  process.env.CODEX_THREAD_ID = worker;
  const admitted = await resumeBoundTask(
    { ...f.input, taskRevision: f.registry.readTask('task').revision, lane: 'delivery' },
    f.host,
    { registry: f.registry, queue: f.queue },
  );
  assert.equal(admitted.historicalOwner, old);
  assert.equal(admitted.actor, worker);
  assert.equal(admitted.deliveryStarted, false);
  process.env.ZDM_EXECUTION_ADMISSION = admitted.admission;
  await completionCommand(f.worktree, ['begin']);
  assert.deepEqual(readFileSync(acceptedFile), accepted);
  const currentTicket = f.queue.read().tickets.find((q) => q.lane === 'delivery');
  assert.equal(currentTicket.owner, old);
  assert.equal(currentTicket.order, originalTicket.order);
  assert.deepEqual(currentTicket.request, originalTicket.request);
  assert.notEqual(currentTicket.admission, originalTicket.admission);
  // Protocol fixtures below exercise owner mapping in the real progress wrapper;
  // they are never recorded as evidence for this repository's actual delivery.
  writeFileSync(path.join(f.registry.commonDir, 'info/exclude'), '.task-verification/\n');
  const reports = path.join(f.worktree, '.task-verification');
  mkdirSync(reports);
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const sourceBytes = JSON.stringify({ fixture: true });
  writeFileSync(path.join(reports, 'source.json'), sourceBytes);
  const head = f.git(f.worktree, 'rev-parse', 'HEAD');
  const reportBytes = JSON.stringify({
    version: 1,
    task: 'task',
    head,
    outcome: 'passed',
    tests: 1,
    skipped: 0,
    retries: 0,
    sourceReports: [{ path: '.task-verification/source.json', sha256: hash(sourceBytes) }],
  });
  writeFileSync(path.join(reports, 'report.json'), reportBytes);
  const evidence = {
    task: 'task',
    owner: old,
    head,
    reports: [{ path: '.task-verification/report.json', sha256: hash(reportBytes) }],
    assessment: { task: 'task', owner: old, head, noKnownDefects: true, observedAt: new Date().toISOString() },
  };
  const stored = new Map();
  let revision = 2;
  const result = await runCompletionWithProgress(
    {
      root: f.worktree,
      taskId: 'task',
      args: ['deliver', 'task', head],
      developmentEvidence: evidence,
      call: async (operation, args) => {
        if (operation === 'apply_task_progress_receipt') {
          stored.set(args.receipt.receipt_id, { receipt: args.receipt, revision: ++revision });
          return {};
        }
        const prior = stored.get(args.receipt_id);
        return {
          task: { id: 'task', revision, status: 'merging', board_column: 'merging' },
          receipt_id: args.receipt_id,
          outcome: prior ? 'applied' : 'not_found',
          receipt: prior?.receipt ?? null,
          applied_revision: prior?.revision ?? null,
        };
      },
    },
    {
      registry: f.registry,
      command: async () => {
        notifyProgressHost(path.join(f.registry.commonDir, 'task-progress/task'));
        await prepareProgressStage(
          { batch: 'task' },
          { id: 'fixture-prepare', name: 'prepare', status: 'running', startedAt: Date.now() },
        );
        return { fixture: 'placement' };
      },
    },
  );
  assert.equal(result.progress.placements[0].state, 'current-merging-confirmed-no-write');
  assert.equal(result.progress.pending, 0);
});

test('one genuine restore instruction admits distinct bound developers without changing original FIFO order', async (t) => {
  const f = fixture(t),
    b = path.join(f.dir, 'task-b'),
    second = '55555555-5555-4555-8555-555555555555';
  f.git(f.main, 'worktree', 'add', '-b', 'codex/task-b', b);
  const taskB = f.registry.register({ id: 'task-b', worktree: b, owner: old, kind: 'infrastructure' });
  f.queue.enqueue({
    lane: 'development',
    task: taskB.id,
    owner: old,
    request: { messageId: 'original-b', roomId: source, authorId: 'human', sequence: 3 },
  });
  f.input.queueRevision = f.queue.read().revision;
  await f.bind();
  const boardB = { ...f.board, id: taskB.id, title: 'second' };
  f.snapshots.set(second, delegate(second, root, 'Execute task task-b', '750｜second'));
  f.host.readTask = async (id) => (id === taskB.id ? boardB : f.board);
  const inputB = { ...f.input, taskId: taskB.id, owner: second, expectedRevision: taskB.revision };
  await rebindHistoricalTask(inputB, f.host, { registry: f.registry, queue: f.queue, observe: f.observe });
  const before = f.queue.read().tickets.map(({ task, order, request }) => ({ task, order, request }));
  f.host.start = async ({ taskId }) => ({ task: f.registry.readTask(taskId) });
  for (const input of [f.input, inputB]) {
    process.env.CODEX_THREAD_ID = input.owner;
    await resumeBoundTask(
      {
        ...input,
        taskRevision: f.registry.readTask(input.taskId).revision,
        queueRevision: f.queue.read().revision,
        lane: 'development',
      },
      f.host,
      { registry: f.registry, queue: f.queue },
    );
    f.host.readCapacity = async () => ({ limit: 3, activeDevelopment: 1, activeDelivery: 0, activeOther: 0 });
  }
  assert.deepEqual(
    f.queue.read().tickets.map(({ task, order, request }) => ({ task, order, request })),
    before,
  );
  assert.ok(f.queue.read().tickets.every((ticket) => ticket.status === 'running' && ticket.owner === old));
  assert.equal(f.queue.read().scopedAdmissions.length, 2);
});

test('joint carrier needs both IDs in native provenance and keeps one immutable board mapping', async (t) => {
  const f = fixture(t);
  f.input.boardTaskId = 'primary-card';
  f.board.id = 'primary-card';
  await assert.rejects(f.bind(), /Worker/);
  f.snapshots.set(worker, delegate(worker, root, 'Execute task task for primary-card', '750｜fixture'));
  const result = await f.bind();
  assert.equal(result.task.executionBindings[0].monitoring.taskStableId, 'primary-card');
  await assert.rejects(f.bind({ boardTaskId: 'secondary-card' }), /mapping/);
  assert.equal(result.task.owner, old);
  assert.equal(result.task.id, 'task');
});

test('a later authorized coordinator can retain the existing worker and its original creation provenance', async (t) => {
  const f = fixture(t);
  await f.bind();
  const next = '66666666-6666-4666-8666-666666666666';
  const request = { ...f.input.request, messageId: 'user-6', sequence: 6 };
  f.snapshots.get(source).turns[0].items.push({ type: 'userMessage', id: request.messageId });
  f.snapshots.set(next, delegate(next, source, 'new coordinator authorized by user-6'));
  process.env.CODEX_THREAD_ID = next;
  const input = { ...f.input, rootThreadId: next, request, expectedRevision: f.registry.readTask('task').revision };
  const result = await rebindHistoricalTask(input, f.host, {
    registry: f.registry,
    queue: f.queue,
    observe: f.observe,
  });
  assert.equal(result.task.owner, old);
  assert.equal(taskExecutor(result.task), worker);
  assert.equal(result.task.executionBindings[1].coordinator, next);
  assert.equal(result.task.executionBindings[1].nativeEvidence.worker.sourceRootThreadId, root);
  process.env.CODEX_THREAD_ID = worker;
  f.host.start = async () => ({ task: f.registry.readTask('task') });
  await resumeBoundTask({ ...input, taskRevision: result.task.revision, lane: 'development' }, f.host, {
    registry: f.registry,
    queue: f.queue,
  });
});

test('A to B to C preserves a collaboration origin while changing coordinator then native worker', async (t) => {
  const f = fixture(t, { collaboration: true });
  await authorizeTaskCoordinator(f.registry.commonDir, { ...f.input, expectedRevision: 0 }, f.host);
  const first = (await f.bind()).task.executionBindings[0];
  const b = '77777777-7777-4777-8777-777777777777';
  const c = '88888888-8888-4888-8888-888888888888';
  const nextWorker = '99999999-9999-4999-8999-999999999999';
  const beforeQueue = f.queue.read();
  // The original collaboration root is no longer a required executor after
  // its first fully checked binding; the current native worker is checked.
  f.snapshots.delete(legacyRoot);
  let previousCoordinator = root;
  let latest;
  for (const [index, current] of [b, c].entries()) {
    const request = {
      messageId: 'handoff-' + current,
      roomId: previousCoordinator,
      authorId: 'human',
      sequence: 6 + index,
    };
    f.snapshots.get(previousCoordinator).turns[0].items.push({ type: 'userMessage', id: request.messageId });
    f.snapshots.set(current, delegate(current, previousCoordinator, 'Coordinator from ' + request.messageId));
    process.env.CODEX_THREAD_ID = current;
    const direction = { rootThreadId: current, request, expectedRevision: index + 1 };
    await authorizeTaskCoordinator(f.registry.commonDir, direction, f.host);
    const appointed = readTaskCoordination(f.registry.commonDir);
    assert.deepEqual(await authorizeTaskCoordinator(f.registry.commonDir, direction, f.host), appointed);
    await assert.rejects(
      authorizeTaskCoordinator(f.registry.commonDir, { ...direction, expectedRevision: 0 }, f.host),
      /replay|revision/i,
    );
    await assert.rejects(
      authorizeTaskCoordinator(
        f.registry.commonDir,
        {
          ...direction,
          expectedRevision: appointed.revision,
          request: { ...request, messageId: 'different-user', authorId: 'other', sequence: 20 },
        },
        f.host,
      ),
    );
    if (current === c) f.snapshots.set(nextWorker, delegate(nextWorker, c, 'Execute task task', '750｜fixture'));
    latest = {
      ...f.input,
      rootThreadId: current,
      owner: current === c ? nextWorker : worker,
      request,
      expectedRevision: f.registry.readTask('task').revision,
    };
    const result = await rebindHistoricalTask(latest, f.host, {
      registry: f.registry,
      queue: f.queue,
      observe: f.observe,
    });
    const bound = result.task.executionBindings.at(-1);
    assert.equal(bound.nativeEvidence.worker.sourceRootThreadId, current === c ? c : root);
    assert.deepEqual(result.task.executionBindings[0], first);
    process.env.CODEX_THREAD_ID = previousCoordinator;
    await assert.rejects(
      rebindHistoricalTask({ ...latest, rootThreadId: previousCoordinator }, f.host, {
        registry: f.registry,
        queue: f.queue,
        observe: f.observe,
      }),
      /current authorized coordinator/,
    );
    previousCoordinator = current;
  }
  assert.deepEqual(f.queue.read(), beforeQueue);
  assert.equal(readTaskCoordination(f.registry.commonDir).revision, 3);
  assert.equal(f.registry.readTask('task').executionBindings.length, 3);
  process.env.CODEX_THREAD_ID = nextWorker;
  f.host.start = async () => ({ task: f.registry.readTask('task') });
  const result = await resumeBoundTask(
    { ...latest, taskRevision: f.registry.readTask('task').revision, lane: 'development' },
    f.host,
    {
      registry: f.registry,
      queue: f.queue,
    },
  );
  assert.equal(result.task.owner, old);
  assert.equal(taskExecutor(result.task), nextWorker);
});

for (const status of ['paused', 'done', 'cancelled'])
  test(`bound resume refuses ${status} board state before admission`, async (t) => {
    const f = fixture(t);
    await f.bind();
    f.board.status = status;
    process.env.CODEX_THREAD_ID = worker;
    f.host.start = () => assert.fail('no start');
    const before = f.queue.read();
    await assert.rejects(
      resumeBoundTask({ ...f.input, taskRevision: f.registry.readTask('task').revision, lane: 'development' }, f.host, {
        registry: f.registry,
        queue: f.queue,
      }),
      /cannot resume/,
    );
    assert.deepEqual(f.queue.read(), before);
  });
