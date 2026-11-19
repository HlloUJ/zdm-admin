import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  realpathSync,
  symlinkSync,
  readlinkSync,
} from 'node:fs';
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
import { createProgressOutbox } from './task-progress-outbox.mjs';
import { authorizeTaskCoordinator, readTaskCoordination } from './task-coordination.mjs';
import { advanceTaskThread, taskHandoffFailure } from './task-thread-host-bridge.mjs';
import { dynamicHostAction } from './delivery-repairs/task-dynamic-host.mjs';
import { freezeAcceptedSource } from './accepted-source.mjs';
import { readActiveBatch } from './task-batch.mjs';
import { openCompletion, saveCompletion } from './completion-session.mjs';
import { verifyDevelopmentCompletion } from './task-execution-order-cli.mjs';

const old = '11111111-1111-4111-8111-111111111111';
const root = '22222222-2222-4222-8222-222222222222';
const worker = '33333333-3333-4333-8333-333333333333';
const source = '44444444-4444-4444-8444-444444444444';
const legacyRoot = '66666666-6666-4666-8666-666666666666';

test('handoff readback distinguishes capacity/dependency waits and unknown blockers without claiming execution or completion', () => {
  for (const [reason, readiness] of [
    ['Reserve delivery executor', 'waiting-capacity'],
    ['Waiting for formally delivered task dependencies', 'waiting-dependencies'],
    ['Original project source changed during observation', 'blocked'],
    ['Unsealed original process journal', 'blocked'],
    ['Only a fenced historical task may resume; never replay a running task', 'blocked'],
  ]) {
    const result = taskHandoffFailure(new Error(reason));
    assert.equal(result.readiness, readiness);
    assert.equal(result.reason, reason);
    assert.equal(result.executionState, 'unknown-until-readback');
    assert.equal(result.completionClaimed, false);
    assert.ok(result.next);
  }
});
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
  host.observe = observe;
  const bind = (changes = {}, options = {}) =>
    rebindHistoricalTask({ ...input, ...changes }, host, { registry, queue, observe, now: 5000, ...options });
  return { dir, main, worktree, registry, queue, input, host, snapshots, observe, bind, task, board, git };
}

async function dynamicFrozenFixture(t, { previousPause = false, originalStatus = 'blocked' } = {}) {
  const f = fixture(t, { collaboration: true });
  process.env.CODEX_THREAD_ID = old;
  const accepted = freezeAcceptedSource(f.worktree, readActiveBatch(f.worktree));
  f.registry.revise('task', f.registry.readTask('task').revision, (record) => {
    record.frozen = { accepted: accepted.commit, tree: accepted.tree, businessDigest: accepted.businessDigest };
    record.stage = 'frozen';
  });
  f.queue.enqueue({
    lane: 'delivery',
    task: 'task',
    owner: old,
    request: { ...f.input.request, messageId: 'original-delivery', sequence: 3 },
  });
  if (previousPause)
    f.queue.direct({
      action: 'pause-all',
      request: { ...f.input.request, messageId: 'older-fence', sequence: 4 },
    });
  f.input.expectedRevision = f.registry.readTask('task').revision;
  f.input.queueRevision = f.queue.read().revision;
  f.board.status = 'merging';
  f.snapshots.get(legacyRoot).thread.status = { type: 'notLoaded' };
  process.env.CODEX_THREAD_ID = root;
  await authorizeTaskCoordinator(
    f.registry.commonDir,
    { rootThreadId: root, request: f.input.request, expectedRevision: 0 },
    f.host,
  );
  const plan = await f.bind({ historicalRecovery: { mode: 'preserved-project-state' } }, { planOnly: true });
  await f.bind({ historicalRecovery: { mode: 'preserved-project-state', digest: plan.historicalRecoveryDigest } });
  if (originalStatus === 'blocked') {
    process.env.CODEX_THREAD_ID = worker;
    await resumeBoundTask(
      {
        ...f.input,
        taskRevision: f.registry.readTask('task').revision,
        queueRevision: f.queue.read().revision,
        lane: 'delivery',
      },
      f.host,
      { registry: f.registry, queue: f.queue },
    );
    f.queue.block({
      lane: 'delivery',
      task: 'task',
      owner: old,
      reason: 'Original 683-compatible exact failure retained',
    });
  }
  const request = { messageId: 'actual-standing-delegation', roomId: root, authorId: 'human', sequence: 20 };
  f.snapshots.get(root).turns[0].items.push({
    type: 'userMessage',
    id: request.messageId,
    content: [
      { type: 'text', text: 'Dynamically coordinate this task list, prepare in parallel and serialize final main' },
    ],
  });
  const authorityId = randomUUID();
  process.env.CODEX_THREAD_ID = root;
  const call = (action, input) =>
    dynamicHostAction(action, input, f.host, {
      commonDir: f.registry.commonDir,
      registry: f.registry,
      queue: f.queue,
      observe: f.observe,
    });
  await call('delegate', {
    coordinatorThreadId: root,
    authorityId,
    request,
    taskIds: ['task'],
    expectedQueueRevision: f.queue.read().revision,
    expectedCoordinationRevision: 1,
  });
  const decision = (phase = 'final') => ({
    coordinatorThreadId: root,
    authorityId,
    decisionId: randomUUID(),
    task: 'task',
    owner: old,
    executor: worker,
    lane: 'delivery',
    phase,
    expectedTaskRevision: f.registry.readTask('task').revision,
    expectedQueueRevision: f.queue.read().revision,
    expectedCoordinationRevision: 1,
    expectedBoardRevision: f.board.revision,
  });
  return { ...f, accepted, call, decision, authorityId };
}
async function dynamicCheckpointFixture(t) {
  const f = fixture(t, { collaboration: true });
  f.snapshots.get(legacyRoot).thread.status = { type: 'notLoaded' };
  await authorizeTaskCoordinator(
    f.registry.commonDir,
    { rootThreadId: root, request: f.input.request, expectedRevision: 0 },
    f.host,
  );
  const plan = await f.bind({ historicalRecovery: { mode: 'preserved-project-state' } }, { planOnly: true });
  await f.bind({ historicalRecovery: { mode: 'preserved-project-state', digest: plan.historicalRecoveryDigest } });
  process.env.CODEX_THREAD_ID = worker;
  f.host.start = async () => ({ task: f.registry.readTask('task') });
  await resumeBoundTask(
    {
      ...f.input,
      taskRevision: f.registry.readTask('task').revision,
      queueRevision: f.queue.read().revision,
      lane: 'development',
    },
    f.host,
    { registry: f.registry, queue: f.queue },
  );
  const checkpoint = (text) => {
    writeFileSync(path.join(f.worktree, 'base.txt'), text);
    f.git(f.worktree, 'add', 'base.txt');
    f.git(f.worktree, 'commit', '-m', 'Owned checkpoint ' + text);
    const head = f.git(f.worktree, 'rev-parse', 'HEAD');
    checkpointTask(f.worktree, {
      id: 'task',
      owner: worker,
      commit: head,
      verification: 'WIP: exact task-owned checkpoint; dependency delivery pending',
    });
    return head;
  };
  const head = checkpoint('133-shaped owned change');
  f.queue.block({ lane: 'development', task: 'task', owner: old, reason: 'Original missing dependency retained' });
  const request = { messageId: 'actual-checkpoint-standing-delegation', roomId: root, authorId: 'human', sequence: 20 };
  f.snapshots.get(root).turns[0].items.push({ type: 'userMessage', id: request.messageId });
  const authorityId = randomUUID();
  const call = (action, input) =>
    dynamicHostAction(action, input, f.host, {
      commonDir: f.registry.commonDir,
      registry: f.registry,
      queue: f.queue,
      observe: f.observe,
    });
  process.env.CODEX_THREAD_ID = root;
  await call('delegate', {
    coordinatorThreadId: root,
    authorityId,
    request,
    taskIds: ['task'],
    expectedQueueRevision: f.queue.read().revision,
    expectedCoordinationRevision: 1,
  });
  const decision = () => ({
    coordinatorThreadId: root,
    authorityId,
    decisionId: randomUUID(),
    task: 'task',
    owner: old,
    executor: worker,
    lane: 'development',
    phase: 'development',
    expectedTaskRevision: f.registry.readTask('task').revision,
    expectedQueueRevision: f.queue.read().revision,
    expectedCoordinationRevision: 1,
    expectedBoardRevision: f.board.revision,
  });
  return { ...f, checkpoint, head, call, decision };
}
test('133-shaped bound task resumes after legal registered checkpoints and blocking, without rewriting its binding or adopting unknown source', async (t) => {
  const f = await dynamicCheckpointFixture(t),
    originalBinding = structuredClone(f.registry.readTask('task').executionBindings);
  for (let attempt = 0; attempt < 2; attempt++) {
    process.env.CODEX_THREAD_ID = root;
    const input = f.decision(),
      reserved = await f.call('dispatch', input);
    assert.equal(reserved.decision.sourceProof.checkpoint.head, f.registry.readTask('task').recordedHead);
    assert.deepEqual(reserved.decision.sourceProof.checkpoint.ownership.missing, []);
    process.env.CODEX_THREAD_ID = worker;
    const started = await f.call('dispatch-start', {
      ...reserved.workerInput,
      expectedQueueRevision: f.queue.read().revision,
    });
    assert.equal(started.decision.startAuthorized, true);
    assert.match(started.decision.ticketBefore.reason, /dependency/);
    assert.deepEqual(f.registry.readTask('task').executionBindings, originalBinding);
    if (attempt === 0) f.checkpoint('Next owned checkpoint under consumed dynamic admission');
    f.queue.block({ lane: 'development', task: 'task', owner: old, reason: 'Exact dependency still pending' });
  }
});
async function completedPhaseFixture(t) {
  const f = await dynamicCheckpointFixture(t);
  const reserved = await f.call('dispatch', f.decision());
  process.env.CODEX_THREAD_ID = worker;
  const started = await f.call('dispatch-start', {
    ...reserved.workerInput,
    expectedQueueRevision: f.queue.read().revision,
  });
  const reportDirectory = path.join(f.worktree, '.task-runtime');
  mkdirSync(reportDirectory, { recursive: true });
  const exclude = path.join(f.registry.commonDir, 'info/exclude');
  writeFileSync(exclude, readFileSync(exclude, 'utf8') + '\n.task-runtime/\n');
  const reportPath = '.task-runtime/original-development-fixture.json',
    sourcePath = '.task-runtime/original-development-fixture.log';
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  writeFileSync(path.join(f.worktree, sourcePath), 'isolated development evidence fixture\n');
  writeFileSync(
    path.join(f.worktree, reportPath),
    JSON.stringify({
      version: 1,
      task: 'task',
      head: f.head,
      outcome: 'passed',
      tests: 1,
      skipped: 0,
      retries: 0,
      sourceReports: [{ path: sourcePath, sha256: hash(readFileSync(path.join(f.worktree, sourcePath))) }],
    }),
  );
  const evidence = {
    task: 'task',
    owner: old,
    head: f.head,
    reports: [{ path: reportPath, sha256: hash(readFileSync(path.join(f.worktree, reportPath))) }],
  };
  f.queue.complete(
    { lane: 'development', task: 'task', owner: old, admission: started.decision.admission, evidence },
    () => verifyDevelopmentCompletion(f.registry.readTask('task'), evidence),
  );
  f.board.status = 'review';
  process.env.CODEX_THREAD_ID = root;
  const phase = () => ({
    coordinatorThreadId: root,
    authorityId: f.decision().authorityId,
    phaseId: randomUUID(),
    task: 'task',
    owner: old,
    executor: worker,
    expectedTaskRevision: f.registry.readTask('task').revision,
    expectedQueueRevision: f.queue.read().revision,
    expectedCoordinationRevision: 1,
    expectedBoardRevision: f.board.revision,
    developmentEvidenceDigest: f.queue.read().tickets.find((t) => t.lane === 'development').completion.digest,
  });
  const delivery = (phase = 'preparation') => ({ ...f.decision(), lane: 'delivery', phase });
  return { ...f, phase, delivery, reportPath, sourcePath };
}
test('completed original development with no delivery ticket enters preparation through the public native host route', async (t) => {
  const f = await completedPhaseFixture(t),
    input = f.phase(),
    before = f.queue.read();
  const binding = structuredClone(f.registry.readTask('task').executionBindings);
  const result = await advanceTaskThread(
    {
      action: 'delivery-enroll',
      task: input,
      nativeObservations: [...f.snapshots.values()].map((snapshot) => ({
        provider: 'codex-native-read_thread',
        observedAt: new Date().toISOString(),
        snapshot,
      })),
    },
    {
      commonDir: f.registry.commonDir,
      registry: f.registry,
      readTask: f.host.readTask,
      dependenciesReady: f.host.dependenciesReady,
      observe: () => {
        throw Error('Phase enrollment must not stop or claim runtime resources');
      },
    },
  );
  assert.equal(result.result.startAuthorized, false);
  const ticket = f.queue.read().tickets.find((ticket) => ticket.lane === 'delivery');
  assert.equal(ticket.status, 'queued');
  assert.equal(ticket.admission, null);
  const outbox = createProgressOutbox(path.join(f.registry.commonDir, 'task-progress/task'));
  const receipts = outbox
    .read()
    .pending.map(({ receipt }) => receipt)
    .filter((receipt) => receipt.evidence_refs.includes(`execution-order:${f.queue.read().revision}:delivery:task`));
  assert.deepEqual(
    receipts.map(({ event }) => event),
    ['queued'],
  );
  assert.equal(Object.hasOwn(receipts[0], 'stage_fact'), false);
  assert.equal(f.board.status, 'review');
  assert.deepEqual(
    f.queue.read().tickets.find((t) => t.lane === 'development'),
    before.tickets.find((t) => t.lane === 'development'),
  );
  assert.equal(f.queue.read().scopedAdmissions?.length ?? 0, 0);
  assert.deepEqual(f.registry.readTask('task').executionBindings, binding);
  assert.equal(f.registry.readTask('task').frozen, undefined);
  const prepared = await f.call('dispatch', f.delivery());
  assert.equal(prepared.decision.sourceProof.checkpoint.head, f.head);
  process.env.CODEX_THREAD_ID = worker;
  const consumed = await f.call('dispatch-start', {
    ...prepared.workerInput,
    expectedQueueRevision: f.queue.read().revision,
  });
  assert.doesNotThrow(() =>
    f.queue.assertAdmission({
      lane: 'delivery',
      task: 'task',
      owner: old,
      admission: consumed.decision.admission,
      effect: 'preparation',
    }),
  );
  assert.throws(() =>
    f.queue.assertAdmission({
      lane: 'delivery',
      task: 'task',
      owner: old,
      admission: consumed.decision.admission,
      effect: 'final',
    }),
  );
});
for (const scenario of [
  'dirty',
  'report-changed',
  'source-report-changed',
  'unknown-commit',
  'completed-head-changed',
  'paused-board',
  'old-coordinator',
])
  test(
    'completed phase native host rejects ' + scenario + ' and preserves original development and queue',
    async (t) => {
      const f = await completedPhaseFixture(t),
        input = f.phase();
      if (scenario === 'dirty') writeFileSync(path.join(f.worktree, 'base.txt'), 'uncommitted drift');
      if (scenario === 'report-changed') writeFileSync(path.join(f.worktree, f.reportPath), '{}');
      if (scenario === 'source-report-changed')
        writeFileSync(path.join(f.worktree, f.sourcePath), 'changed original output');
      if (['unknown-commit', 'completed-head-changed'].includes(scenario)) {
        writeFileSync(path.join(f.worktree, 'base.txt'), 'unverified later commit');
        f.git(f.worktree, 'add', 'base.txt');
        f.git(f.worktree, 'commit', '-m', 'Unverified later commit');
        if (scenario === 'completed-head-changed')
          f.registry.revise('task', f.registry.readTask('task').revision, (r) => {
            r.recordedHead = f.git(f.worktree, 'rev-parse', 'HEAD');
          });
      }
      if (scenario === 'paused-board') f.board.status = 'paused';
      if (scenario === 'old-coordinator') process.env.CODEX_THREAD_ID = old;
      const before = f.queue.read(),
        task = f.registry.readTask('task');
      await assert.rejects(f.call('delivery-enroll', input));
      assert.deepEqual(f.queue.read(), before);
      assert.deepEqual(f.registry.readTask('task'), task);
    },
  );
for (const scenario of [
  'unregistered-head',
  'dirty',
  'unassigned-checkpoint',
  'missing-admission',
  'source-after-decision',
  'old-actor',
])
  test('checkpoint continuation refuses ' + scenario + ' and preserves queue and binding', async (t) => {
    const f = await dynamicCheckpointFixture(t);
    if (['unregistered-head', 'dirty', 'unassigned-checkpoint'].includes(scenario))
      writeFileSync(path.join(f.worktree, 'base.txt'), 'Unknown source drift');
    if (['unregistered-head', 'unassigned-checkpoint'].includes(scenario)) {
      f.git(f.worktree, 'add', 'base.txt');
      f.git(f.worktree, 'commit', '-m', 'Unregistered source');
    }
    if (scenario === 'unassigned-checkpoint')
      f.registry.revise('task', f.registry.readTask('task').revision, (record) => {
        record.recordedHead = f.git(f.worktree, 'rev-parse', 'HEAD');
      });
    if (scenario === 'missing-admission') {
      const state = f.queue.read();
      delete state.events.find((event) => event.action === 'resume-selected').bindingRef;
      writeFileSync(path.join(f.registry.commonDir, 'task-registry/execution-order/state.json'), JSON.stringify(state));
    }
    let reserved;
    if (['source-after-decision', 'old-actor'].includes(scenario)) reserved = await f.call('dispatch', f.decision());
    if (scenario === 'source-after-decision')
      writeFileSync(path.join(f.worktree, 'base.txt'), 'Changed after reserved exact source');
    const q = f.queue.read(),
      task = f.registry.readTask('task');
    if (reserved) {
      process.env.CODEX_THREAD_ID = scenario === 'old-actor' ? old : worker;
      await assert.rejects(f.call('dispatch-start', { ...reserved.workerInput, expectedQueueRevision: q.revision }));
    } else await assert.rejects(f.call('dispatch', f.decision()));
    assert.deepEqual(f.queue.read(), q);
    assert.deepEqual(f.registry.readTask('task'), task);
  });
test('metadata phase enrollment does not turn retained or unknown runtime references into execution clearance', async (t) => {
  const f = await completedPhaseFixture(t);
  await f.call('delivery-enroll', f.phase());
  const before = f.queue.read();
  await assert.rejects(
    dynamicHostAction('dispatch', f.delivery(), f.host, {
      commonDir: f.registry.commonDir,
      registry: f.registry,
      queue: f.queue,
      observe: () => ({
        processes: [{ pid: process.pid, ppid: 1, command: 'native proof' }],
        files: [{ pid: 123, name: f.worktree + '/backend', type: 'DIR' }],
        containers: [],
      }),
    }),
    /Task files\/cwd remain open/,
  );
  assert.deepEqual(f.queue.read(), before);
  assert.equal(f.registry.readTask('task').frozen, undefined);
});
for (const route of ['generic-claim', 'generic-resume'])
  test('derived queued phase rejects ' + route + ' without a new dispatch decision', async (t) => {
    const f = await completedPhaseFixture(t);
    await f.call('delivery-enroll', f.phase());
    process.env.CODEX_THREAD_ID = worker;
    const request = {
      messageId: 'actual-later-fixture-user-event',
      roomId: f.registry.readTask('task').executionBindings.at(-1).request.roomId,
      authorId: 'human',
      sequence: 30,
    };
    if (route === 'generic-claim') f.queue.direct({ action: 'resume-all', request });
    const before = f.queue.read();
    if (route === 'generic-claim')
      assert.throws(
        () => f.queue.claim({ lane: 'delivery', task: 'task', owner: old }, () => true),
        /verified dispatch/,
      );
    else
      assert.throws(
        () => f.queue.direct({ action: 'resume-only', lane: 'delivery', task: 'task', owner: old, request }),
        /verified dispatch/,
      );
    assert.deepEqual(f.queue.read(), before);
  });
test('683-shaped frozen carrier safely resumes after binding was already consumed and blocked, using multiple decisions under one real delegation', async (t) => {
  const f = await dynamicFrozenFixture(t);
  const before = f.registry.readTask('task'),
    original = f.queue.read().tickets.find((ticket) => ticket.lane === 'delivery');
  for (let iteration = 0; iteration < 2; iteration++) {
    process.env.CODEX_THREAD_ID = root;
    const input = f.decision();
    const grant = await f.call('dispatch', input);
    process.env.CODEX_THREAD_ID = worker;
    const started = await f.call('dispatch-start', {
      ...grant.workerInput,
      expectedQueueRevision: f.queue.read().revision,
    });
    assert.equal(started.status, 'admitted-work-not-started');
    assert.doesNotThrow(() =>
      f.queue.assertAdmission({ task: 'task', lane: 'delivery', owner: old, admission: started.decision.admission }),
    );
    const unchanged = f.queue.read();
    const replay = await f.call('dispatch-start', { ...grant.workerInput, expectedQueueRevision: unchanged.revision });
    assert.equal(replay.decision.startAuthorized, false);
    assert.deepEqual(f.queue.read(), unchanged);
    f.queue.block({ task: 'task', lane: 'delivery', owner: old, reason: 'Preserved blocked stage ' + iteration });
  }
  const state = f.queue.read();
  assert.equal(state.dynamicDecisions.length, 2);
  assert.ok(state.dynamicDecisions.every((item) => item.input.authorityId === f.authorityId));
  assert.ok(state.events.some((event) => event.bindingRef?.revision === 1));
  const final = state.tickets.find((ticket) => ticket.lane === 'delivery');
  for (const key of ['task', 'owner', 'request', 'order']) assert.deepEqual(final[key], original[key]);
  assert.deepEqual(f.registry.readTask('task'), before);
  assert.equal(before.frozen.accepted, f.accepted.commit);
  assert.ok(state.dynamicDecisions.every((item) => item.ticketBefore.reason));
});
async function verifyPreparationProjection(t, originalStatus) {
  const f = await dynamicFrozenFixture(t, { previousPause: true, originalStatus });
  const head = f.git(f.worktree, 'rev-parse', 'HEAD');
  f.registry.revise('task', f.registry.readTask('task').revision, (record) => {
    record.recordedHead = head;
  });
  const original = structuredClone(f.queue.read().tickets.find((ticket) => ticket.lane === 'delivery'));
  const input = f.decision('preparation');
  await f.call('dispatch', input);
  process.env.CODEX_THREAD_ID = worker;
  await f.call('dispatch-start', {
    decisionId: input.decisionId,
    coordinatorThreadId: root,
    task: 'task',
    owner: old,
    executor: worker,
    expectedQueueRevision: f.queue.read().revision,
  });
  const directory = path.join(f.registry.commonDir, 'task-delivery/task');
  const state = openCompletion(directory, 'task');
  const prepared = {
    version: 1,
    task: 'task',
    head,
    accepted: f.accepted.commit,
    runId: '42',
    pullRequest: 7,
    url: 'https://example.invalid/pull/7',
  };
  state.preparedCandidates = [prepared];
  state.events.push({
    name: 'ci',
    status: 'success',
    result: {
      runId: 42,
      headSha: head,
      eventName: 'pull_request',
      branch: f.task.branch,
      attempt: 1,
      conclusion: 'success',
      jobs: ['Frontend quality', 'Backend quality'].map((name) => ({
        name,
        status: 'completed',
        conclusion: 'success',
      })),
    },
  });
  saveCompletion(directory, state);
  const finish = () =>
    f.call('preparation-finish', {
      decisionId: input.decisionId,
      coordinatorThreadId: root,
      task: 'task',
      expectedQueueRevision: f.queue.read().revision,
    });
  state.events[0].result.branch = 'main';
  saveCompletion(directory, state);
  await assert.rejects(finish());
  state.events[0].result.branch = f.task.branch;
  saveCompletion(directory, state);
  const result = await finish();
  assert.equal(result.status, 'finished');
  assert.deepEqual(result.prepared, prepared);
  assert.deepEqual(
    f.queue.read().tickets.find((ticket) => ticket.lane === 'delivery'),
    original,
  );
  const before = f.queue.read();
  const box = createProgressOutbox(path.join(f.registry.commonDir, 'task-progress/task'));
  const receiptFor = (revision) =>
    box
      .read()
      .pending.find(({ receipt }) => receipt.evidence_refs.includes(`execution-order:${revision}:delivery:task`))
      ?.receipt;
  assert.equal(receiptFor(before.revision)?.event, originalStatus);
  assert.equal(receiptFor(before.revision)?.reason, original.reason);
  await finish();
  assert.deepEqual(f.queue.read(), before);
  process.env.CODEX_THREAD_ID = root;
  f.queue.direct({
    action: 'pause-all',
    request: { ...f.input.request, messageId: 'next-explicit-pause', sequence: 30 },
  });
  assert.equal(receiptFor(f.queue.read().revision)?.event, 'paused');
  assert.deepEqual(
    f.queue.read().tickets.find((ticket) => ticket.lane === 'delivery'),
    original,
  );
}
for (const originalStatus of ['queued', 'blocked'])
  test(`preparation finish verifies original PR CI and restores the historical ${originalStatus} projection`, (t) =>
    verifyPreparationProjection(t, originalStatus));
test('preparation admission rejects final commands and generic measured shell effects before any session or main mutation', async (t) => {
  const f = await dynamicFrozenFixture(t),
    before = f.registry.readTask('task');
  const grant = await f.call('dispatch', f.decision('preparation'));
  process.env.CODEX_THREAD_ID = worker;
  const started = await f.call('dispatch-start', {
    ...grant.workerInput,
    expectedQueueRevision: f.queue.read().revision,
  });
  process.env.ZDM_EXECUTION_ADMISSION = started.decision.admission;
  const head = f.git(f.worktree, 'rev-parse', 'HEAD');
  const entry = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./task-completion.mjs', import.meta.url)), 'prepare'],
    { cwd: f.worktree, env: process.env, encoding: 'utf8' },
  );
  assert.notEqual(entry.status, 0);
  assert.match(
    entry.stderr,
    /Unexpected completion arguments/,
    'The public prepare entry must route to the protected completion controller before validating its arguments',
  );
  for (const args of [
    ['deliver', 'task', head],
    ['final-handoff', head],
    ['settle', 'task', head, '42'],
    ['measure', 'merge', '--', 'git', 'status'],
    ['measure', 'prepare', '--', 'gh', 'pr', 'merge'],
    ['wait', 'main', head],
    ['wait', '42', head],
    ['recover'],
  ])
    await assert.rejects(completionCommand(f.worktree, args), /Preparation admission/);
  const queueBefore = f.queue.read();
  assert.throws(
    () =>
      f.queue.complete(
        { task: 'task', lane: 'delivery', owner: old, admission: started.decision.admission, evidence: {} },
        () => assert.fail('Preparation must not reach final completion verifier'),
      ),
    /Preparation admission/,
  );
  assert.deepEqual(f.queue.read(), queueBefore);
  assert.deepEqual(f.registry.readTask('task'), before);
  assert.equal(f.git(f.main, 'rev-parse', 'HEAD'), before.base);
});
test('dynamic dispatch preserves the frozen carrier and refuses changed source, missing dependencies and an old runtime actor', async (t) => {
  const f = await dynamicFrozenFixture(t);
  const before = f.queue.read();
  f.host.dependenciesReady = () => false;
  await assert.rejects(f.call('dispatch', f.decision()), /dependencies/);
  f.host.dependenciesReady = () => true;
  process.env.CODEX_THREAD_ID = old;
  await assert.rejects(f.call('dispatch', f.decision()), /Actual current coordinator/);
  process.env.CODEX_THREAD_ID = root;
  writeFileSync(path.join(f.worktree, 'base.txt'), 'Unapproved frozen business change');
  await assert.rejects(f.call('dispatch', f.decision()), /uncommitted|source changed|Source/);
  assert.deepEqual(f.queue.read(), before);
});

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

function unavailable(id) {
  return {
    provider: 'codex-native-read_thread',
    threadId: id,
    observedAt: new Date().toISOString(),
    result: {
      content: [
        { type: 'text', text: `No Codex thread found for threadId: ${id}. Hosts without a readable match: local` },
      ],
      isError: false,
    },
  };
}

function originalIntent(f) {
  const directory = path.join(f.registry.commonDir, 'task-registry/start-intents');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'task.json'),
    JSON.stringify({
      task: 'task',
      owner: old,
      branch: f.task.branch,
      worktree: f.worktree,
      base: f.task.base,
      state: 'registered',
    }),
  );
}

for (const collaboration of [false, true])
  test(`notLoaded ${collaboration ? 'collaboration root' : 'native executor'} needs explicit full project review, not idle substitution`, async (t) => {
    const f = fixture(t, { collaboration });
    originalIntent(f);
    const target = collaboration ? legacyRoot : old;
    f.snapshots.get(target).thread.status = { type: 'notLoaded' };
    f.snapshots.get(worker).thread.status = { type: 'notLoaded' };
    f.snapshots.get(target).turns ??= [];
    f.snapshots.get(target).turns.push({ status: 'completed', items: [] });
    await assert.rejects(f.bind(), /active or unobservable/);
    const before = f.registry.readTask('task'),
      queue = f.queue.read();
    const input = { historicalRecovery: { mode: 'preserved-project-state' } };
    const plan = await f.bind(input, { planOnly: true });
    assert.equal(plan.historicalAvailability, 'native-not-loaded');
    assert.match(plan.historicalRecoveryDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(f.registry.readTask('task'), before);
    assert.deepEqual(f.queue.read(), queue);
    await assert.rejects(f.bind(input), /review changed/);
    const result = await f.bind({
      historicalRecovery: { ...input.historicalRecovery, digest: plan.historicalRecoveryDigest },
    });
    const binding = result.task.executionBindings[0];
    assert.equal(binding.nativeEvidence.previousExecutor.status.type, 'notLoaded');
    assert.equal(binding.nativeEvidence.previousExecutor.availability, 'native-not-loaded');
    assert.match(binding.nativeEvidence.previousExecutor.nativeObservationDigest, /^[a-f0-9]{64}$/);
    assert.equal(result.task.owner, old);
    assert.deepEqual(result.task.monitoring, before.monitoring);
    assert.deepEqual(f.queue.read(), queue);
    assert.equal(result.resumed, false);
  });

test('notLoaded reviewed binding cannot silently downgrade after native availability changes', async (t) => {
  const f = fixture(t);
  originalIntent(f);
  f.snapshots.get(old).thread.status = { type: 'notLoaded' };
  const input = { historicalRecovery: { mode: 'preserved-project-state' } };
  const plan = await f.bind(input, { planOnly: true });
  f.snapshots.get(old).thread.status = { type: 'idle' };
  const before = f.registry.readTask('task');
  await assert.rejects(
    f.bind({ historicalRecovery: { ...input.historicalRecovery, digest: plan.historicalRecoveryDigest } }),
    /availability changed/,
  );
  assert.deepEqual(f.registry.readTask('task'), before);
});

for (const failure of [
  'active',
  'unknown',
  'foreign-host',
  'runtime-flags',
  'active-turn',
  'unknown-turn',
  'old-process',
  'source-change',
  'missing-carrier',
])
  test(`notLoaded project recovery preserves protection for ${failure}`, async (t) => {
    const f = fixture(t);
    originalIntent(f);
    const snapshot = f.snapshots.get(old);
    snapshot.thread.status = { type: 'notLoaded' };
    if (failure === 'active' || failure === 'unknown') snapshot.thread.status.type = failure;
    if (failure === 'foreign-host') snapshot.thread.hostId = 'remote';
    if (failure === 'runtime-flags') snapshot.thread.status.activeFlags = ['waitingOnApproval'];
    if (failure === 'active-turn' || failure === 'unknown-turn')
      snapshot.turns = [{ status: failure === 'active-turn' ? 'inProgress' : 'unknown' }];
    if (failure === 'missing-carrier') rmSync(path.join(f.registry.commonDir, 'task-registry/start-intents/task.json'));
    let rounds = 0;
    const observe = () => {
      const result = f.observe();
      if (failure === 'old-process')
        result.processes.push({ pid: process.pid + 200, ppid: 1, command: `old-executor ${old}` });
      if (failure === 'source-change' && ++rounds === 2)
        writeFileSync(path.join(f.worktree, 'base.txt'), 'concurrent write');
      return result;
    };
    const before = f.registry.readTask('task'),
      queue = f.queue.read();
    await assert.rejects(
      f.bind({ historicalRecovery: { mode: 'preserved-project-state' } }, { planOnly: true, observe }),
    );
    assert.deepEqual(f.registry.readTask('task'), before);
    assert.deepEqual(f.queue.read(), queue);
  });

test('missing historical monitoring uses exact registered carrier/queue provenance without inventing a root or surface', async (t) => {
  const f = fixture(t);
  originalIntent(f);
  f.registry.revise('task', f.task.revision, (record) => {
    delete record.monitoring;
  });
  f.input.expectedRevision = f.registry.readTask('task').revision;
  f.snapshots.delete(old);
  f.host.readUnavailableThread = async (id) => (id === old ? unavailable(id) : null);
  const input = { historicalRecovery: { mode: 'preserved-project-state' } };
  const plan = await f.bind(input, { planOnly: true });
  const bound = await f.bind({
    historicalRecovery: { ...input.historicalRecovery, digest: plan.historicalRecoveryDigest },
  });
  const evidence = bound.task.executionBindings[0].nativeEvidence.previousExecutor;
  assert.equal(evidence.executionSurface, 'historical-unclassified');
  assert.equal(evidence.historicalMonitoring, null);
  assert.equal(evidence.rootThreadId, undefined);
});

test('published recovery plan and binding use raw unavailable observations and do not call the unreadable old root', async (t) => {
  const f = fixture(t, { collaboration: true });
  f.snapshots.delete(legacyRoot);
  const observedAt = new Date().toISOString();
  const input = {
    action: 'rebind-plan',
    task: { ...f.input, historicalRecovery: { mode: 'preserved-project-state' } },
    nativeObservations: [...f.snapshots.values()].map((snapshot) => ({
      provider: 'codex-native-read_thread',
      observedAt,
      snapshot,
    })),
    unavailableNativeObservations: [unavailable(legacyRoot)],
  };
  const adapters = {
    commonDir: f.registry.commonDir,
    registry: f.registry,
    readTask: f.host.readTask,
    observe: f.observe,
  };
  const plan = await advanceTaskThread(input, adapters);
  assert.equal(plan.result.readyFor, 'binding-only');
  const result = await advanceTaskThread(
    {
      ...input,
      action: 'rebind',
      task: {
        ...input.task,
        historicalRecovery: { ...input.task.historicalRecovery, digest: plan.result.historicalRecoveryDigest },
      },
    },
    adapters,
  );
  assert.equal(result.result.status, 'bound');
  assert.equal(result.result.resumed, false);
  assert.equal(f.queue.read().tickets[0].status, 'queued');
});

test('published bridge uses real readable notLoaded observations only through full project-state planning', async (t) => {
  const f = fixture(t, { collaboration: true });
  f.snapshots.get(legacyRoot).thread.status = { type: 'notLoaded' };
  f.snapshots.get(worker).thread.status = { type: 'notLoaded' };
  const input = {
    action: 'rebind-plan',
    task: { ...f.input, historicalRecovery: { mode: 'preserved-project-state' } },
    nativeObservations: [...f.snapshots.values()].map((snapshot) => ({
      provider: 'codex-native-read_thread',
      observedAt: new Date().toISOString(),
      snapshot,
    })),
  };
  const adapters = {
    commonDir: f.registry.commonDir,
    registry: f.registry,
    readTask: f.host.readTask,
    observe: f.observe,
  };
  const plan = await advanceTaskThread(input, adapters);
  assert.equal(plan.result.historicalAvailability, 'native-not-loaded');
  assert.equal(plan.result.resumed, false);
  const result = await advanceTaskThread(
    {
      ...input,
      action: 'rebind',
      task: {
        ...input.task,
        historicalRecovery: { ...input.task.historicalRecovery, digest: plan.result.historicalRecoveryDigest },
      },
    },
    adapters,
  );
  assert.equal(result.result.status, 'bound');
  assert.equal(result.result.resumed, false);
  assert.equal(f.queue.read().tickets[0].status, 'queued');
});

test('binding one fenced task preserves an unrelated active delivery admission', async (t) => {
  const f = fixture(t);
  const request = (n) => ({ ...f.input.request, messageId: 'unrelated-' + n, sequence: n });
  f.queue.enqueue({ lane: 'delivery', task: 'another-delivery', owner: old, request: request(3) });
  f.queue.direct({
    action: 'resume-only',
    lane: 'delivery',
    task: 'another-delivery',
    owner: old,
    request: request(4),
  });
  f.input.queueRevision = f.queue.read().revision;
  const before = f.queue.read();
  await f.bind();
  assert.deepEqual(f.queue.read(), before);
  assert.equal(f.queue.read().scopedAdmission.task, 'another-delivery');
});

test('a subsequent lost native worker can be rebound under new authority from the same permanent project state', async (t) => {
  const f = fixture(t, { collaboration: true });
  await f.bind();
  const first = f.registry.readTask('task').executionBindings[0];
  const next = '77777777-7777-4777-8777-777777777777',
    second = '88888888-8888-4888-8888-888888888888';
  const request = { ...f.input.request, messageId: 'next-takeover', sequence: 6 };
  f.snapshots.get(source).turns[0].items.push({ type: 'userMessage', id: request.messageId });
  f.snapshots.set(next, delegate(next, source, 'Coordinator from next-takeover'));
  f.snapshots.set(second, delegate(second, next, 'Execute task task', '750｜fixture'));
  f.snapshots.delete(worker);
  f.snapshots.delete(legacyRoot);
  f.host.readUnavailableThread = async (id) => (id === worker ? unavailable(id) : null);
  process.env.CODEX_THREAD_ID = next;
  const input = {
    ...f.input,
    owner: second,
    rootThreadId: next,
    request,
    expectedRevision: f.registry.readTask('task').revision,
    historicalRecovery: { mode: 'preserved-project-state' },
  };
  const options = { registry: f.registry, queue: f.queue, observe: f.observe };
  const plan = await rebindHistoricalTask(input, f.host, { ...options, planOnly: true });
  const result = await rebindHistoricalTask(
    { ...input, historicalRecovery: { ...input.historicalRecovery, digest: plan.historicalRecoveryDigest } },
    f.host,
    options,
  );
  assert.deepEqual(result.task.executionBindings[0], first);
  assert.equal(result.task.executionBindings[1].previousExecutor, worker);
  assert.equal(result.task.executionBindings[1].nativeEvidence.previousExecutor.unavailableThreadId, worker);
  assert.equal(taskExecutor(result.task), second);
});

test('legacy excluded dependency links are retained without traversal while unknown runtime links still refuse', async (t) => {
  const f = fixture(t),
    directory = path.join(f.worktree, '.task-runtime/dependency');
  mkdirSync(directory, { recursive: true });
  const target = path.join(f.dir, 'dependencies');
  mkdirSync(target);
  writeFileSync(path.join(target, 'process-not-a-task-journal.json'), 'dependency fixture');
  const link = path.join(directory, 'node_modules');
  symlinkSync(target, link, 'dir');
  const plan = await f.bind({}, { planOnly: true });
  assert.equal(plan.status, 'ready-to-bind');
  assert.equal(readlinkSync(link), target);
  symlinkSync(target, path.join(directory, 'unknown-link'), 'dir');
  await assert.rejects(f.bind({}, { planOnly: true }), /Linked/);
  assert.equal(readFileSync(path.join(target, 'process-not-a-task-journal.json'), 'utf8'), 'dependency fixture');
});

test('frozen carrier without a start intent recovers from its original accepted object without rebuilding freeze/session', async (t) => {
  const f = fixture(t);
  const req = (n) => ({ ...f.input.request, sequence: n, messageId: 'user-' + n });
  f.queue.enqueue({ lane: 'delivery', task: 'task', owner: old, request: req(2) });
  f.queue.direct({ action: 'resume-only', lane: 'delivery', task: 'task', owner: old, request: req(3) });
  process.env.CODEX_THREAD_ID = old;
  process.env.ZDM_EXECUTION_ADMISSION = f.queue.read().tickets.find((t) => t.lane === 'delivery').admission;
  await completionCommand(f.worktree, ['begin']);
  f.queue.direct({ action: 'pause-all', request: req(4) });
  process.env.CODEX_THREAD_ID = root;
  f.input.expectedRevision = f.registry.readTask('task').revision;
  f.input.queueRevision = f.queue.read().revision;
  f.snapshots.delete(old);
  f.host.readUnavailableThread = async (id) => (id === old ? unavailable(id) : null);
  const directory = path.join(f.registry.commonDir, 'task-delivery/task');
  const source = readFileSync(path.join(directory, 'accepted-source.json'));
  const session = readFileSync(path.join(directory, 'completion-session.json'));
  const plan = await f.bind({ historicalRecovery: { mode: 'preserved-project-state' } }, { planOnly: true });
  await f.bind({ historicalRecovery: { mode: 'preserved-project-state', digest: plan.historicalRecoveryDigest } });
  assert.deepEqual(readFileSync(path.join(directory, 'accepted-source.json')), source);
  assert.deepEqual(readFileSync(path.join(directory, 'completion-session.json')), session);
});

for (const failure of ['stale', 'wrong-id', 'network-error', 'active-conflict']) {
  test(`native unavailability bridge refuses ${failure} instead of treating it as idle`, async (t) => {
    const f = fixture(t, { collaboration: true });
    f.snapshots.delete(legacyRoot);
    const observedAt = new Date().toISOString();
    const absent = unavailable(legacyRoot);
    if (failure === 'stale') absent.observedAt = new Date(Date.now() - 60001).toISOString();
    if (failure === 'wrong-id') absent.result.content[0].text = unavailable(old).result.content[0].text;
    if (failure === 'network-error') absent.result.content[0].text = 'Native read transport unavailable';
    const nativeObservations = [...f.snapshots.values()].map((snapshot) => ({
      provider: 'codex-native-read_thread',
      observedAt,
      snapshot,
    }));
    if (failure === 'active-conflict')
      nativeObservations.push({
        provider: 'codex-native-read_thread',
        observedAt,
        snapshot: { thread: { id: legacyRoot, hostId: 'local', status: { type: 'active' } } },
      });
    const before = f.registry.readTask('task'),
      queue = f.queue.read();
    await assert.rejects(
      advanceTaskThread(
        {
          action: 'rebind-plan',
          task: { ...f.input, historicalRecovery: { mode: 'preserved-project-state' } },
          nativeObservations,
          unavailableNativeObservations: [absent],
        },
        { commonDir: f.registry.commonDir, registry: f.registry, readTask: f.host.readTask, observe: f.observe },
      ),
    );
    assert.deepEqual(f.registry.readTask('task'), before);
    assert.deepEqual(f.queue.read(), queue);
  });
}

test('unreadable historical collaboration recovers from preserved project provenance and a new explicit authority without the old root', async (t) => {
  const f = fixture(t, { collaboration: true });
  f.snapshots.delete(old);
  f.snapshots.delete(legacyRoot);
  f.host.readUnavailableThread = async (id) => (id === legacyRoot ? unavailable(id) : null);
  const input = { historicalRecovery: { mode: 'preserved-project-state' } };
  const before = f.registry.readTask('task'),
    queue = f.queue.read();
  writeFileSync(path.join(f.worktree, 'unfinished.txt'), 'original uncommitted work');
  const plan = await f.bind(input, { planOnly: true });
  assert.equal(plan.status, 'ready-to-bind');
  assert.match(plan.historicalRecoveryDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.registry.readTask('task'), before);
  assert.deepEqual(f.queue.read(), queue);
  const result = await f.bind({
    historicalRecovery: { ...input.historicalRecovery, digest: plan.historicalRecoveryDigest },
  });
  const evidence = result.task.executionBindings[0];
  assert.equal(evidence.nativeEvidence.previousExecutor.availability, 'native-not-found');
  assert.equal(Object.hasOwn(evidence.nativeEvidence.previousExecutor, 'status'), false);
  assert.equal(evidence.nativeEvidence.previousExecutor.historicalMonitoring.rootThreadId, legacyRoot);
  assert.equal(evidence.projectSourceDigest, plan.historicalRecoveryDigest);
  assert.deepEqual(result.task.monitoring, before.monitoring);
  assert.deepEqual(f.queue.read(), queue);
  assert.equal(readFileSync(path.join(f.worktree, 'unfinished.txt'), 'utf8'), 'original uncommitted work');
  const replay = await f.bind(
    { historicalRecovery: { ...input.historicalRecovery, digest: plan.historicalRecoveryDigest } },
    { observe: () => assert.fail('no replay') },
  );
  assert.equal(replay.replayed, true);
  process.env.CODEX_THREAD_ID = worker;
  f.host.start = async () => ({ task: f.registry.readTask('task') });
  const resumed = await resumeBoundTask(
    { ...f.input, taskRevision: result.task.revision, lane: 'development' },
    f.host,
    {
      registry: f.registry,
      queue: f.queue,
    },
  );
  assert.equal(taskExecutor(resumed.task), worker);
});

for (const failure of ['source-change', 'live-process', 'capacity', 'dependency', 'unknown-inventory']) {
  test(`delayed recovered worker rechecks ${failure} before acquiring admission`, async (t) => {
    const f = fixture(t, { collaboration: true });
    f.snapshots.delete(legacyRoot);
    f.host.readUnavailableThread = async (id) => (id === legacyRoot ? unavailable(id) : null);
    if (failure === 'dependency') {
      f.registry.revise('task', f.task.revision, (record) => {
        record.dependsOn = ['required-task'];
      });
      f.input.expectedRevision = f.registry.readTask('task').revision;
    }
    const plan = await f.bind({ historicalRecovery: { mode: 'preserved-project-state' } }, { planOnly: true });
    const result = await f.bind({
      historicalRecovery: { mode: 'preserved-project-state', digest: plan.historicalRecoveryDigest },
    });
    let observations = 0;
    if (failure === 'source-change') writeFileSync(path.join(f.worktree, 'base.txt'), 'changed after binding');
    f.host.observe = () => {
      observations++;
      if (failure === 'unknown-inventory') throw Error('inventory unavailable');
      const value = f.observe();
      if (failure === 'live-process')
        value.processes.push({ pid: process.pid + 99, ppid: 1, command: 'node ' + f.worktree });
      return value;
    };
    if (failure === 'capacity')
      f.host.readCapacity = async () => ({ limit: 1, activeDevelopment: 0, activeDelivery: 0, activeOther: 0 });
    if (failure === 'dependency') f.host.dependenciesReady = () => false;
    f.host.start = () => assert.fail('unsafe delayed worker must not start');
    process.env.CODEX_THREAD_ID = worker;
    const before = f.queue.read();
    await assert.rejects(
      resumeBoundTask({ ...f.input, taskRevision: result.task.revision, lane: 'development' }, f.host, {
        registry: f.registry,
        queue: f.queue,
      }),
    );
    assert.deepEqual(f.queue.read(), before);
    if (['capacity', 'dependency'].includes(failure)) assert.equal(observations, 0);
  });
}

for (const failure of [
  'missing-review',
  'source-changed',
  'missing-carrier',
  'wrong-user',
  'live-process',
  'open-file',
  'resource-lease',
  'unknown-unavailability',
]) {
  test(`project-state recovery refuses unsafe historical absence: ${failure}`, async (t) => {
    const f = fixture(t, { collaboration: true });
    f.snapshots.delete(legacyRoot);
    f.host.readUnavailableThread = async (id) => (failure === 'unknown-unavailability' ? null : unavailable(id));
    const input = { historicalRecovery: { mode: 'preserved-project-state' } };
    if (failure === 'unknown-unavailability') {
      await assert.rejects(f.bind(input, { planOnly: true }));
      return;
    }
    const plan = await f.bind(input, { planOnly: true });
    input.historicalRecovery.digest = plan.historicalRecoveryDigest;
    const options = {};
    if (failure === 'missing-review') delete input.historicalRecovery.digest;
    if (failure === 'source-changed') writeFileSync(path.join(f.worktree, 'base.txt'), 'changed after read-only plan');
    if (failure === 'missing-carrier') rmSync(path.join(f.registry.commonDir, 'task-registry/start-intents/task.json'));
    if (failure === 'wrong-user') input.request = { ...f.input.request, authorId: 'different' };
    if (['live-process', 'open-file'].includes(failure))
      options.observe = () => {
        const value = f.observe();
        if (failure === 'live-process')
          value.processes.push({ pid: process.pid + 999, ppid: 1, command: 'node ' + f.worktree });
        else value.files.push({ name: f.worktree + '/deleted.log (deleted)' });
        return value;
      };
    if (failure === 'resource-lease') {
      const d = path.join(f.registry.commonDir, 'task-registry/resource-leases/task-resource');
      mkdirSync(d, { recursive: true });
      writeFileSync(
        path.join(d, 'owner.json'),
        JSON.stringify({ resource: 'task-resource', task: old, token: 'retained', pid: process.pid }),
      );
    }
    const before = f.registry.readTask('task'),
      queue = f.queue.read();
    await assert.rejects(f.bind(input, options));
    assert.deepEqual(f.registry.readTask('task'), before);
    assert.deepEqual(f.queue.read(), queue);
  });
}

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

for (const laterPause of [false, true]) {
  test(`bound task authority survives unrelated later intake/directions but not a newer pause: pause=${laterPause}`, async (t) => {
    const f = fixture(t);
    f.queue.enqueue({
      lane: 'delivery',
      task: 'task',
      owner: old,
      request: { ...f.input.request, sequence: 2, messageId: 'original-delivery' },
    });
    f.input.queueRevision = f.queue.read().revision;
    const result = await f.bind();
    f.queue.enqueue({ lane: 'development', task: 'unrelated-new-task', owner: root, request: f.input.request });
    f.queue.direct({
      action: 'set-limits',
      request: { ...f.input.request, sequence: 6, messageId: 'later-limits' },
      limits: { development: null, delivery: 1 },
    });
    if (laterPause)
      f.queue.direct({ action: 'pause-all', request: { ...f.input.request, sequence: 7, messageId: 'later-pause' } });
    process.env.CODEX_THREAD_ID = worker;
    const input = {
      ...f.input,
      taskRevision: result.task.revision,
      queueRevision: f.queue.read().revision,
      lane: 'delivery',
    };
    const before = f.queue.read();
    if (laterPause) {
      await assert.rejects(resumeBoundTask(input, f.host, { registry: f.registry, queue: f.queue }), /later pause/);
      assert.deepEqual(f.queue.read(), before);
    } else {
      const resumed = await resumeBoundTask(input, f.host, { registry: f.registry, queue: f.queue });
      assert.equal(resumed.status, 'admitted');
      assert.equal(f.queue.read().tickets.find((t) => t.task === 'unrelated-new-task').status, 'queued');
    }
  });
}

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

test('accepted current appointment authorizes binding/replay/resume after its old source room disappears', async (t) => {
  const f = fixture(t),
    current = '77777777-7777-4777-8777-777777777777',
    executor = '88888888-8888-4888-8888-888888888888';
  await authorizeTaskCoordinator(f.registry.commonDir, { ...f.input, expectedRevision: 0 }, f.host);
  const request = { ...f.input.request, roomId: root, messageId: 'current-handoff', sequence: 6 };
  f.snapshots.get(root).turns[0].items.push({ type: 'userMessage', id: request.messageId });
  f.snapshots.set(current, delegate(current, root, 'Coordinator from current-handoff'));
  f.snapshots.set(executor, delegate(executor, current, 'Execute task task', '750｜fixture'));
  process.env.CODEX_THREAD_ID = current;
  await authorizeTaskCoordinator(f.registry.commonDir, { rootThreadId: current, request, expectedRevision: 1 }, f.host);
  f.snapshots.delete(root);
  f.host.readUnavailableThread = async (id) => (id === root ? unavailable(id) : null);
  const input = { ...f.input, owner: executor, rootThreadId: current, request };
  const options = { registry: f.registry, queue: f.queue, observe: f.observe };
  const result = await rebindHistoricalTask(input, f.host, options);
  const replay = await rebindHistoricalTask(input, f.host, {
    ...options,
    observe: () => assert.fail('read-only replay'),
  });
  assert.equal(replay.replayed, true);
  assert.equal(result.task.owner, old);
  process.env.CODEX_THREAD_ID = executor;
  f.host.start = async () => ({ task: f.registry.readTask('task') });
  const resumed = await resumeBoundTask(
    { ...input, taskRevision: result.task.revision, lane: 'development' },
    f.host,
    options,
  );
  assert.equal(taskExecutor(resumed.task), executor);
});

test('first handoff can retain a worker created by a later coordinator while preserving original intake ownership', async (t) => {
  const f = fixture(t),
    creator = '77777777-7777-4777-8777-777777777777';
  const dir = path.join(f.registry.commonDir, 'task-thread-titles/tasks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'task.json'),
    JSON.stringify({
      version: 1,
      mode: 'task-thread-title-v1',
      taskId: 'task',
      rootThreadId: legacyRoot,
      creationRootThreadId: creator,
      messageId: 'original',
      createRequestId: 'original-create',
      threadId: old,
      state: 'bound',
    }),
    { mode: 0o600 },
  );
  f.snapshots.set(old, delegate(old, creator, 'Execute task task', '750｜fixture'));
  const result = await f.bind({ owner: old });
  assert.equal(result.task.executionBindings[0].nativeEvidence.worker.sourceRootThreadId, creator);
  assert.equal(result.task.executionBindings[0].coordinator, root);
  assert.equal(result.task.owner, old);
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
  // Both old coordination rooms may disappear after their verified records
  // were published. The current worker resumes from the permanent binding.
  for (const id of [root, b, source]) f.snapshots.delete(id);
  f.host.readUnavailableThread = async (id) => (id === b ? unavailable(id) : null);
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
