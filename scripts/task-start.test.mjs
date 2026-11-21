import { createBoardIntake } from './task-board-intake.mjs';
import { collectTaskProgress } from './task-progress-collector.mjs';
import { executionOrderCommand } from './task-execution-order-cli.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startParallelTask, parseTaskStart } from './task-start.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { authorizeTaskCoordinator } from './task-coordination.mjs';
import { randomUUID } from 'node:crypto';
function fixture(t) {
  const priorOwner = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = priorOwner ?? 'isolated-start-fixture';
  t.after(() => {
    if (priorOwner === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = priorOwner;
  });
  const scratch = path.join(process.cwd(), '.task-runtime/start-fixtures');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(path.join(scratch, 'task-')),
    root = path.join(dir, 'main'),
    parent = path.join(dir, 'worktrees'),
    remote = path.join(dir, 'origin.git');
  mkdirSync(root);
  mkdirSync(parent);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cwd, ...args) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{}}}');
  writeFileSync(
    path.join(root, '.gitignore'),
    '.task-runtime/\n.task-verification/\ntest-results/\nplaywright-report/\ncoverage/\ndist/\nbackend/target/\n',
  );
  writeFileSync(path.join(root, 'baseline'), 'base');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(dir, 'init', '--bare', remote);
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  return { dir, root, parent, git, registry: createTaskRegistry(root) };
}
const context = (slug) => ({
  taskNumber: '460',
  taskName: 'isolated fixture',
  taskStableId: slug,
  worker: '/root/fixture',
  rootThreadId: 'fixture-root',
  roomId: 'fixture-room',
  authorizationRef: 'fixture-message',
});
const options = (slug, parent) => ({
  slug,
  kind: 'business',
  owner: process.env.CODEX_THREAD_ID,
  monitorContext: context(slug),
  taskParent: parent,
  resume: false,
});
test('native top-level thread creates real isolated worktree, persists exact monitoring and remains observable', async (t) => {
  const f = fixture(t);
  const owner = '11111111-1111-4111-8111-111111111111';
  process.env.CODEX_THREAD_ID = owner;
  const opts = options('native-task', f.parent);
  opts.owner = owner;
  opts.monitorContext = { ...context('native-task'), executionSurface: 'codex-thread', worker: owner };
  opts.monitorContext.rootThreadId = owner;
  opts.monitorContext.roomId = owner;
  await createBoardIntake(f.registry.commonDir).accept(
    {
      taskId: 'native-task',
      title: opts.monitorContext.taskName,
      owner,
      rootThreadId: owner,
      request: { roomId: owner, messageId: opts.monitorContext.authorizationRef },
    },
    {
      readThread: async () => ({
        thread: { id: owner },
        turns: [{ items: [{ type: 'userMessage', id: opts.monitorContext.authorizationRef }] }],
      }),
      readTask: async () => ({
        id: 'native-task',
        title: opts.monitorContext.taskName,
        task_number: opts.monitorContext.taskNumber,
        status: 'active',
        revision: 1,
      }),
    },
  );
  const result = startParallelTask(opts, { root: f.root });
  assert.equal(result.task.monitoring.executionSurface, 'codex-thread');
  assert.equal(result.task.monitoring.worker, owner);
  assert.equal(f.registry.resolve({ id: 'native-task' }).monitoring.executionSurface, 'codex-thread');
  assert.equal(collectTaskProgress(f.root)[0].monitoring.executionSurface, 'codex-thread');
  assert.equal(result.previewSwitched, false);
  assert.equal(f.git(result.task.worktree, 'branch', '--show-current'), 'codex/native-task');
});
test('consumed development dispatch resumes an enrolled native task with its unchanged expired intake; fresh starts and stale admissions still fail', async (t) => {
  const f = fixture(t),
    owner = '11111111-1111-4111-8111-111111111111';
  process.env.CODEX_THREAD_ID = owner;
  const opts = options('native-continuation', f.parent);
  opts.owner = owner;
  opts.monitorContext = {
    ...context(opts.slug),
    executionSurface: 'codex-thread',
    worker: owner,
    rootThreadId: owner,
    roomId: owner,
  };
  const request = {
    roomId: owner,
    messageId: opts.monitorContext.authorizationRef,
    authorId: 'same-user',
    sequence: 1,
  };
  const readThread = async () => ({
    thread: { id: owner },
    turns: [{ items: [{ type: 'userMessage', id: request.messageId }] }],
  });
  await createBoardIntake(f.registry.commonDir).accept(
    { taskId: opts.slug, title: opts.monitorContext.taskName, owner, rootThreadId: owner, request },
    {
      readThread,
      readTask: async () => ({
        id: opts.slug,
        title: opts.monitorContext.taskName,
        task_number: opts.monitorContext.taskNumber,
        status: 'active',
        revision: 1,
      }),
    },
  );
  const started = startParallelTask(opts, { root: f.root });
  const intakeFile = path.join(f.registry.commonDir, 'task-board-intake', opts.slug + '.json'),
    original = readFileSync(intakeFile);
  const realNow = Date.now,
    priorAdmission = process.env.ZDM_EXECUTION_ADMISSION;
  const later = realNow() + 600001;
  Date.now = () => later;
  t.after(() => {
    Date.now = realNow;
    if (priorAdmission === undefined) delete process.env.ZDM_EXECUTION_ADMISSION;
    else process.env.ZDM_EXECUTION_ADMISSION = priorAdmission;
  });
  assert.throws(() => startParallelTask({ ...opts, resume: true }, { root: f.root }), /Intake readback expired/);
  const coordination = await authorizeTaskCoordinator(
    f.registry.commonDir,
    { rootThreadId: owner, request, expectedRevision: 0 },
    { readThread },
  );
  const queue = createExecutionOrder(f.registry.commonDir);
  queue.initialize(request);
  queue.enqueue({ lane: 'development', task: opts.slug, owner, request });
  const authorityId = randomUUID(),
    grant = { ...request, messageId: 'actual-continuation-delegation', sequence: 2 };
  queue.registerDelegation(
    {
      authorityId,
      request: grant,
      taskIds: [opts.slug],
      expectedQueueRevision: queue.read().revision,
      expectedCoordinationRevision: 1,
    },
    () => ({
      coordinator: owner,
      coordination,
      message: { id: grant.messageId, type: 'userMessage' },
      taskScope: [{ task: opts.slug, owner }],
    }),
  );
  const task = f.registry.readTask(opts.slug),
    input = {
      decisionId: randomUUID(),
      authorityId,
      task: opts.slug,
      owner,
      executor: owner,
      lane: 'development',
      phase: 'development',
      expectedTaskRevision: task.revision,
      expectedQueueRevision: queue.read().revision,
      expectedCoordinationRevision: 1,
      expectedBoardRevision: 1,
    };
  const proof = () => ({
    coordinator: owner,
    coordination,
    task,
    executor: owner,
    actor: owner,
    workerIdle: true,
    dependenciesReady: true,
    bindingRevision: 0,
    boardRevision: 1,
    sourceProof: { digest: 'fixed-enrolled-source' },
    capacity: { limit: 5, activeDevelopment: 0, activeDelivery: 0, activeOther: 0 },
  });
  queue.reserveDecision(input, proof);
  const decision = queue.consumeDecision(
    { decisionId: input.decisionId, expectedQueueRevision: queue.read().revision },
    proof,
  );
  process.env.ZDM_EXECUTION_ADMISSION = decision.admission;
  const resumed = startParallelTask(
    { ...opts, resume: true },
    { root: f.root, git: () => assert.fail('No Git mutation during enrolled continuation') },
  );
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.task.worktree, started.task.worktree);
  assert.deepEqual(readFileSync(intakeFile), original);
  process.env.ZDM_EXECUTION_ADMISSION = 'stale-admission';
  assert.throws(() => startParallelTask({ ...opts, resume: true }, { root: f.root }), /Exact current admission/);
  assert.deepEqual(readFileSync(intakeFile), original);
});
test('two task starts create independent worktrees without switching preview or blocking unfinished A', (t) => {
  const f = fixture(t),
    settings = path.join(f.root, '.git/preview-fixture.json');
  writeFileSync(settings, '{"selected":"unchanged"}');
  const a = startParallelTask(options('a', f.parent), { root: f.root });
  writeFileSync(path.join(a.task.worktree, 'unfinished'), 'A work');
  const b = startParallelTask(options('b', f.parent), { root: f.root });
  assert.equal(a.previewSwitched, false);
  assert.equal(b.previewSwitched, false);
  assert.equal(f.registry.list().length, 2);
  assert.equal(readFileSync(path.join(a.task.worktree, 'unfinished'), 'utf8'), 'A work');
  assert.equal(readFileSync(settings, 'utf8'), '{"selected":"unchanged"}');
  assert.equal(a.task.branch, 'codex/a');
  assert.equal(b.task.branch, 'codex/b');
});
test('new starts use invocation context only when explicit context is omitted', (t) => {
  const f = fixture(t),
    explicit = options('env-task', f.parent),
    { monitorContext, ...input } = explicit,
    prior = process.env.ZDM_TASK_MONITOR_CONTEXT;
  t.after(() => {
    if (prior === undefined) delete process.env.ZDM_TASK_MONITOR_CONTEXT;
    else process.env.ZDM_TASK_MONITOR_CONTEXT = prior;
  });
  const noGit = () => assert.fail('Invalid context must not mutate Git');
  process.env.ZDM_TASK_MONITOR_CONTEXT = '{';
  assert.throws(() => startParallelTask(input, { root: f.root, git: noGit }), SyntaxError);
  process.env.ZDM_TASK_MONITOR_CONTEXT = JSON.stringify(monitorContext);
  assert.throws(
    () => startParallelTask({ ...input, monitorContext: null }, { root: f.root, git: noGit }),
    /Monitoring context must be an object/,
  );
  assert.equal(f.registry.readTask(input.slug), null);
  const created = startParallelTask(input, { root: f.root });
  assert.equal(created.task.monitoring.taskStableId, input.slug);
  assert.equal(created.task.monitoring.authorizationRef, monitorContext.authorizationRef);
  process.env.ZDM_TASK_MONITOR_CONTEXT = '{';
  assert.equal(startParallelTask({ ...input, resume: true }, { root: f.root, git: noGit }).resumed, true);
});

test('exact resume does not fetch or perform a Git mutation', (t) => {
  const f = fixture(t);
  startParallelTask(options('a', f.parent), { root: f.root });
  const result = startParallelTask(
    { ...options('a', f.parent), resume: true },
    { root: f.root, git: () => assert.fail('resume must not fetch, switch or create') },
  );
  assert.equal(result.resumed, true);
  assert.equal(result.remoteFetched, false);
  assert.throws(
    () => startParallelTask({ ...options('a', f.parent), owner: 'other-chat' }, { root: f.root }),
    /Another owner/,
  );
  assert.throws(
    () => startParallelTask({ ...options('missing', f.parent), resume: true }, { root: f.root }),
    /not registered/,
  );
});
test('dirty main, existing path or temporary parent are refused without losing files', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, 'dirty'), 'keep');
  assert.throws(() => startParallelTask(options('a', f.parent), { root: f.root }), /Main anchor is dirty/);
  rmSync(path.join(f.root, 'dirty'));
  const target = path.join(f.parent, 'a');
  mkdirSync(target);
  writeFileSync(path.join(target, 'keep'), 'original');
  assert.throws(() => startParallelTask(options('a', f.parent), { root: f.root }), /already exists/);
  assert.equal(readFileSync(path.join(target, 'keep'), 'utf8'), 'original');
  assert.throws(() => startParallelTask(options('temp', tmpdir()), { root: f.root }), /temporary storage/);
});
test('registration failure after creation leaves recoverable intent and never deletes the new worktree', (t) => {
  const f = fixture(t),
    registry = createTaskRegistry(f.root);
  registry.register = () => {
    throw Error('injected registration failure');
  };
  assert.throws(() => startParallelTask(options('a', f.parent), { root: f.root, registry }), /injected/);
  assert.ok(existsSync(path.join(f.parent, 'a/baseline')));
  const intent = JSON.parse(readFileSync(path.join(registry.directory, 'start-intents/a.json'), 'utf8'));
  assert.equal(intent.state, 'worktree-created');
  assert.equal(f.git(path.join(f.parent, 'a'), 'branch', '--show-current'), 'codex/a');
  assert.throws(() => startParallelTask(options('a', f.parent), { root: f.root }), /already exists/);
});
test('start parser rejects unknown options and never accepts implicit preview switching', () => {
  assert.throws(() => parseTaskStart(['--preview', 'select']), /Unknown/);
  assert.throws(() => parseTaskStart(['--slug', '../other']), /match/);
  assert.equal(parseTaskStart(['--slug', 'a', '--owner', 'chat-a']).slug, 'a');
});
test('new task creation atomically records complete monitoring context without backfilling old tasks', (t) => {
  const f = fixture(t);
  // Test-only fixture identity when the CI host has no agent runtime.
  const prior = process.env.CODEX_THREAD_ID;
  const owner = prior ?? 'isolated-ci-start-fixture';
  process.env.CODEX_THREAD_ID = owner;
  t.after(() => {
    if (prior === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = prior;
  });
  const context = {
    taskNumber: 'fixture-284',
    taskName: '隔离登记验收',
    taskStableId: 'monitored',
    worker: '/root/implement_recovery',
    rootThreadId: 'fixture-root',
    roomId: 'fixture-room',
    authorizationRef: 'fixture-only',
  };
  const result = startParallelTask(
    { ...options('monitored', f.parent), owner, monitorContext: context },
    { root: f.root },
  );
  const saved = f.registry.readTask('monitored');
  assert.equal(saved.monitoring.state, 'registered');
  assert.equal(saved.monitoring.owner, owner);
  assert.equal(saved.monitoring.taskName, context.taskName);
  assert.equal(saved.monitoring.automaticResumptionEnabled, false);
  assert.equal(result.task.monitoring.registeredAt, saved.monitoring.registeredAt);
  assert.equal(
    parseTaskStart(['--slug', 'new', '--monitor-context', JSON.stringify(context)]).monitorContext.roomId,
    'fixture-room',
  );
  assert.throws(
    () =>
      startParallelTask(
        { ...options('bad', f.parent), owner, monitorContext: { ...context, taskStableId: 'bad', roomId: '' } },
        { root: f.root },
      ),
    /Missing monitoring roomId/,
  );
  assert.equal(existsSync(path.join(f.parent, 'bad')), false);
});

test('missing, malformed and mismatched monitoring is refused before worktree or resource effects', (t) => {
  const f = fixture(t);
  const before = f.git(f.root, 'worktree', 'list', '--porcelain');
  for (const monitorContext of [
    undefined,
    null,
    {},
    { ...context('a'), taskStableId: 'other' },
    { ...context('a'), worker: 'invented' },
  ]) {
    assert.throws(() =>
      startParallelTask(
        { ...options('a', f.parent), monitorContext },
        { root: f.root, git: () => assert.fail('no mutation') },
      ),
    );
    assert.equal(f.git(f.root, 'worktree', 'list', '--porcelain'), before);
    assert.equal(existsSync(path.join(f.parent, 'a')), false);
    assert.equal(f.registry.readTask('a'), null);
  }
});
test('formal claim preflight refuses missing context without taking a development slot', (t) => {
  const f = fixture(t);
  const command = (name, input) => executionOrderCommand(f.root, [name, JSON.stringify(input)]);
  const request = (sequence) => ({
    sequence,
    messageId: 'fixture-' + sequence,
    roomId: 'fixture-room',
    authorId: 'fixture-user',
  });
  command('initialize', request(1));
  command('direct', { action: 'resume-all', request: request(2) });
  const input = { lane: 'development', task: 'a', owner: process.env.CODEX_THREAD_ID };
  command('enqueue', { ...input, request: request(3) });
  const before = executionOrderCommand(f.root, ['status']);
  for (const monitorContext of [undefined, { ...context('a'), taskStableId: 'other' }]) {
    assert.throws(() => command('claim', { ...input, monitorContext }), /monitor-context|taskStableId/);
    assert.deepEqual(executionOrderCommand(f.root, ['status']), before);
    assert.equal(existsSync(path.join(f.parent, 'a')), false);
  }
  const validContext = { ...context('a'), authorizationRef: 'fixture-3' };
  for (const monitorContext of [
    { ...validContext, roomId: 'wrong-room' },
    { ...validContext, authorizationRef: 'fixture-2' },
  ]) {
    assert.throws(() => command('claim', { ...input, monitorContext }), /original instruction/);
    assert.deepEqual(executionOrderCommand(f.root, ['status']), before);
  }
  const ticket = command('claim', { ...input, monitorContext: validContext });
  assert.equal(ticket.status, 'running');
  const priorAdmission = process.env.ZDM_EXECUTION_ADMISSION;
  process.env.ZDM_EXECUTION_ADMISSION = ticket.admission;
  t.after(() => {
    if (priorAdmission === undefined) delete process.env.ZDM_EXECUTION_ADMISSION;
    else process.env.ZDM_EXECUTION_ADMISSION = priorAdmission;
  });
  const claimed = executionOrderCommand(f.root, ['status']);
  assert.throws(
    () =>
      startParallelTask(
        { ...options('a', f.parent), monitorContext: { ...validContext, worker: '/root/other' } },
        { root: f.root },
      ),
    /differs from the claimed admission/,
  );
  assert.deepEqual(executionOrderCommand(f.root, ['status']), claimed);
  assert.equal(existsSync(path.join(f.parent, 'a')), false);
  const started = startParallelTask({ ...options('a', f.parent), monitorContext: validContext }, { root: f.root });
  assert.equal(started.task.monitoring.authorizationRef, 'fixture-3');
});
test('successful start is readable by the unchanged progress collector', (t) => {
  const f = fixture(t);
  startParallelTask(options('a', f.parent), { root: f.root });
  const reports = collectTaskProgress(f.root);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].task, 'a');
  assert.equal(reports[0].taskStableId, 'a');
  assert.equal(reports[0].taskNumber, '460');
  assert.notEqual(reports[0].status, 'registration-incomplete');
});
test('readback failure never prepares or replays creation; existing registration is recovered read-only', (t) => {
  const f = fixture(t);
  const read = f.registry.readTask;
  let registered = false,
    writes = 0;
  const register = f.registry.register;
  f.registry.register = (input) => {
    writes++;
    const result = register(input);
    registered = true;
    return result;
  };
  f.registry.readTask = (id) => {
    if (registered) throw Error('injected readback outage');
    return read(id);
  };
  assert.throws(
    () =>
      startParallelTask(options('a', f.parent), {
        root: f.root,
        registry: f.registry,
        prepare: () => assert.fail('must not execute before readback'),
      }),
    /readback outage/,
  );
  assert.equal(writes, 1);
  assert.ok(read('a').monitoring.state === 'registered');
  f.registry.readTask = read;
  const resumed = startParallelTask(options('a', f.parent), {
    root: f.root,
    registry: f.registry,
    git: () => assert.fail('do not replay'),
  });
  assert.equal(resumed.resumed, true);
  assert.equal(writes, 1);
});

test('existing registered carrier preserves its explicit different board stable ID on resume', (t) => {
  const f = fixture(t);
  const result = startParallelTask(options('a', f.parent), { root: f.root });
  const recordFile = path.join(f.registry.directory, 'tasks/a.json');
  const saved = f.registry.readTask('a');
  saved.monitoring.taskStableId = 'original-board-task';
  writeFileSync(recordFile, JSON.stringify(saved)); // Isolated fixture simulates an existing supported binding.
  const resumed = startParallelTask(
    { ...options('a', f.parent), monitorContext: { ...context('a'), taskStableId: 'original-board-task' } },
    { root: f.root, git: () => assert.fail('resume is read-only') },
  );
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.task.worktree, result.task.worktree);
  assert.equal(resumed.task.monitoring.taskStableId, 'original-board-task');
});

test('native missing intake refuses before worktree, branch, registry or artifacts exist', (t) => {
  const f = fixture(t),
    owner = '11111111-1111-4111-8111-111111111111';
  process.env.CODEX_THREAD_ID = owner;
  const opts = options('unregistered-native', f.parent);
  opts.owner = owner;
  opts.monitorContext = { ...context('unregistered-native'), executionSurface: 'codex-thread', worker: owner };
  assert.throws(() => startParallelTask(opts, { root: f.root }), /Board intake missing/);
  assert.equal(existsSync(path.join(f.parent, 'unregistered-native')), false);
  assert.equal(f.registry.readTask('unregistered-native'), null);
  assert.equal(f.git(f.root, 'branch', '--list', 'codex/unregistered-native'), '');
});

test('collaboration surface cannot bypass native board enrollment before creating its carrier', (t) => {
  const f = fixture(t),
    owner = '11111111-1111-4111-8111-111111111111';
  process.env.CODEX_THREAD_ID = owner;
  const opts = options('collaboration-new', f.parent);
  opts.owner = owner;
  opts.monitorContext = {
    ...context('collaboration-new'),
    executionSurface: 'collaboration-agent',
    worker: '/root/delivery_987',
    rootThreadId: owner,
  };
  assert.throws(() => startParallelTask(opts, { root: f.root }), /Board intake missing/);
  assert.equal(existsSync(path.join(f.parent, 'collaboration-new')), false);
  assert.equal(f.registry.readTask('collaboration-new'), null);
  assert.equal(f.git(f.root, 'branch', '--list', 'codex/collaboration-new'), '');
});
