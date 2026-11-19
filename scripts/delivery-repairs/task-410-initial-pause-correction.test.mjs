import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProgressOutbox, flushProgress } from '../task-progress-outbox.mjs';
import { correct410InitialPause } from './task-410-initial-pause-correction.mjs';
import {
  coordinator410,
  correctionHash,
  correctionTask,
  initialPauseReceipt,
  originalRequest,
  priorityRequest,
  receiptIds410,
  retiredInitialPause,
  task410,
  worker410,
  readClosedInitialPause,
} from './task-410-initial-pause-evidence.mjs';

const name = '优化方案与任务执行顺序方案统一落地';
const checkedAt = '2026-11-18T06:00:00.000Z';
const pausedAt = '2026-11-18T02:53:31.771Z';
const base = '153a19047034c1d1feead7fce97c65b1dfa7ee94';
const createRequestId = '5fefa2cc-0735-4926-9785-1acc0a893734';
const callInput = { taskId: task410, receiptId: initialPauseReceipt };

function fixture(t) {
  const commonDir = mkdtempSync(path.join(realpathSync(os.tmpdir()), '410-initial-pause-'));
  t.after(() => rmSync(commonDir, { force: true, recursive: true }));
  const previous = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = coordinator410;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = previous;
  });
  const directory = path.join(commonDir, 'task-progress', task410);
  const file = path.join(directory, 'outbox.json');
  const box = createProgressOutbox(directory);
  const save = (rel, data) => {
    const target = path.join(commonDir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(data) + '\n', { mode: 0o600 });
    return target;
  };
  const request = {
    messageId: originalRequest,
    roomId: coordinator410,
    sequence: 1794970386445,
    authorId: 'fixture-user',
  };
  const appointment = { rootThreadId: coordinator410, request: { ...request, sequence: 50 }, expectedRevision: 0 };
  save('task-coordination/current.json', { version: 1, revision: 1, current: appointment, history: [appointment] });
  const title = '410｜' + name;
  const creationPrompt = `任务 ${task410}\n创建标识：${createRequestId}\n`;
  const creationObservation = {
    id: 'creation-event',
    type: 'functionCallOutput',
    name: 'create_thread',
    namespace: 'codex_app',
    output: {
      truncated: false,
      text: `<codex_delegation>\n  <source_thread_id>${coordinator410}</source_thread_id>\n  <input>${creationPrompt}</input>\n</codex_delegation>`,
    },
  };
  const binding = {
    state: 'bound',
    taskId: task410,
    rootThreadId: coordinator410,
    messageId: originalRequest,
    threadId: worker410,
    initialTitle: title,
    createRequestId,
    creationPrompt,
    titleSync: { state: 'confirmed' },
    creationObservation,
    creationMessageId: creationObservation.id,
  };
  save('task-thread-titles/tasks/' + task410 + '.json', binding);
  save('task-board-intake/' + task410 + '.json', {
    version: 2,
    state: 'accepted',
    taskId: task410,
    owner: coordinator410,
    rootThreadId: coordinator410,
    messageId: originalRequest,
    number: '410',
    title: name,
    kind: 'infrastructure',
    card: 'active',
    refreshHistory: [{ executor: worker410, coordinator: coordinator410 }],
  });
  const monitoring = {
    worker: worker410,
    owner: worker410,
    rootThreadId: coordinator410,
    coordinatorThreadId: coordinator410,
    authorizationRef: originalRequest,
    taskStableId: task410,
    taskNumber: '410',
    taskName: name,
    executionSurface: 'codex-thread',
    runtimeOwnerVerified: true,
    paused: false,
  };
  const registered = {
    id: task410,
    owner: worker410,
    base,
    branch: 'codex/' + task410,
    worktree: path.join(commonDir, task410),
    kind: 'infrastructure',
    stage: 'developing',
    repository: { commonDir },
    createdAt: checkedAt,
    monitoring,
  };
  save('task-registry/start-intents/' + task410 + '.json', {
    task: task410,
    owner: worker410,
    base,
    branch: registered.branch,
    worktree: registered.worktree,
    state: 'registered',
  });
  const scope = { task: task410, lane: 'development', owner: worker410, request, admission: 'original' };
  const state = {
    revision: 129,
    paused: true,
    scopedAdmissions: [scope],
    tickets: [
      {
        ...scope,
        status: 'running',
        nativeCoordinatorOwner: coordinator410,
        executionKind: 'infrastructure',
        nativeLaunchReserved: true,
      },
    ],
    events: [
      { action: 'initialize', request: { sequence: 35 } },
      { action: 'bind-native-worker', task: task410, workerOwner: worker410, coordinatorOwner: coordinator410 },
      { action: 'resume-selected', request, members: [scope] },
    ],
  };
  box.enqueue(task410, 'queue:121:development', {
    observed_at: pausedAt,
    action: { id: 'queue:development', label: 'development' },
    event: 'paused',
    evidence_refs: ['execution-order:121:development:' + task410],
    next: { kind: 'wait', label: '等待恢复指令' },
  });
  const initial = box.read();
  for (const [index, receipt_id] of receiptIds410.slice(1).entries()) {
    const packet = { observed_at: checkedAt, event: 'queued' };
    initial.pending.push({
      receipt_id,
      payload_hash: correctionHash(JSON.stringify(packet)),
      receipt: { ...packet, version: 1, task_id: task410, receipt_id, sequence: index + 2 },
      state: 'pending',
    });
  }
  initial.tasks[task410] = 4;
  save('task-progress/' + task410 + '/outbox.json', initial);
  const message = (id, text) => ({ id, type: 'userMessage', content: [{ type: 'text', text }] });
  const root = {
    thread: { id: coordinator410, hostId: 'local', title: '总协调', status: { type: 'active' }, cwd: commonDir },
    turns: [
      {
        items: [
          message(originalRequest, '目前是由你进行调度的并行开发模式，但要确保410优先执行\n'),
          message(priorityRequest, '继续推进，优先完成410，完成后立即按新机制接续所有未完成任务，直到全部完成。\n'),
        ],
      },
    ],
  };
  const worker = {
    thread: { id: worker410, hostId: 'local', title, status: { type: 'idle' }, cwd: commonDir },
    turns: [{ items: [creationObservation] }],
  };
  const row = { id: task410, task_number: '410', title: name, status: 'active', deleted_at: null, completed_at: null };
  const board = { ...row, board_column: 'active', revision: 2 };
  const record = (operation, args, data) => ({
    provider: 'codex-native-task-board',
    observedAt: checkedAt,
    operation,
    args,
    result: { isError: false, content: [{ type: 'text', text: JSON.stringify(data) }] },
  });
  const history = (rows) =>
    record(
      'task_history',
      { id: task410 },
      rows.map((snapshot) => ({ task_id: task410, snapshot })),
    );
  const observations = [
    history([
      { ...row, revision: 1 },
      { ...row, revision: 2 },
    ]),
    ...receiptIds410.map((receipt_id) =>
      record(
        'get_task_progress_receipt',
        { id: task410, receipt_id },
        {
          version: 1,
          receipt_id,
          outcome: 'not_found',
          applied_revision: null,
          receipt: null,
          task: board,
        },
      ),
    ),
  ];
  const host = {
    queue: { commonDir, read: () => structuredClone(state), guard: (work) => work() },
    readTask: async () => structuredClone(board),
    readThread: async (id) => (id === coordinator410 ? root : worker),
    dependenciesReady: async (batch) => {
      assert.deepEqual(batch.dependsOn, [correctionTask]);
      return true;
    },
    readCreationProgress: async (id, receiptIds) => {
      assert.equal(id, task410);
      assert.deepEqual(receiptIds, receiptIds410);
      return { nativeObservations: observations };
    },
  };
  const registry = { commonDir, resolve: ({ id }) => (assert.equal(id, task410), structuredClone(registered)) };
  return {
    box,
    file,
    directory,
    initial,
    state,
    registered,
    host,
    board,
    row,
    history,
    observations,
    worker,
    run: (input = callInput) =>
      correct410InitialPause(
        {
          clientTransport: {
            outcome: 'never-prepared-no-unknown-write',
            outboxSha256: correctionHash(readFileSync(file)),
          },
          ...input,
        },
        host,
        registry,
        { now: () => Date.parse(checkedAt) },
      ),
  };
}

test('seals the original bytes and first error, preserves the other packets, and reads back an identical retirement', async (t) => {
  const f = fixture(t),
    original = readFileSync(f.file);
  const result = await f.run();
  assert.equal(result.state, retiredInitialPause);
  assert.equal(result.receipt.sequence, 1);
  assert.equal(result.receipt.observed_at, pausedAt);
  const { archive } = readClosedInitialPause(result.audit, f.directory, result.auditDigest);
  assert.equal(archive.firstError.queueRevision, 121);
  assert.equal(archive.firstError.sourceHead, base);
  assert.deepEqual(Buffer.from(archive.originalOutbox.bytes, 'base64'), original);
  assert.deepEqual(archive.entry, f.initial.pending[0]);
  assert.deepEqual(f.box.read(), {
    ...f.initial,
    pending: f.initial.pending.slice(1),
    retired: [result],
  });
  f.host.readTask = async () => assert.fail('Replay reads its original sealed outcome');
  assert.deepEqual(await f.run(), { ...result, replay: true });
  const event = f.initial.pending[0].receipt;
  const payload = { ...event };
  for (const key of ['task_id', 'receipt_id', 'version', 'sequence']) delete payload[key];
  assert.deepEqual(f.box.enqueue(task410, 'queue:121:development', payload), result);
  assert.deepEqual(f.box.read().pending, f.initial.pending.slice(1));
  const old = await flushProgress(
    { ...f.box, read: () => f.initial },
    {
      read: async () => ({ status: 'not_found', revision: 2 }),
      apply: async () => assert.fail('A stale worker must fail prepare before sending the retired packet'),
    },
  );
  assert.equal(old[0].status, 'pending');
  assert.deepEqual(f.box.read().pending, f.initial.pending.slice(1));
  writeFileSync(
    result.audit,
    readFileSync(result.audit, 'utf8').replace('incorrect-global-pause-projection', 'tampered'),
  );
  await assert.rejects(f.run(), /archive changed/);
});

function completeDevelopment(f) {
  const { worktree } = f.registered;
  mkdirSync(worktree);
  const git = (...args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Isolated 410');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(worktree, '.gitignore'), '.task-verification/\n');
  writeFileSync(path.join(worktree, 'source.txt'), 'completed source\n');
  git('add', '.gitignore', 'source.txt');
  git('commit', '-m', 'Complete isolated development');
  const head = git('rev-parse', 'HEAD');
  f.registered.recordedHead = head;
  const sourcePath = '.task-verification/run.json';
  const reportPath = '.task-verification/development.json';
  const source = Buffer.from('{"tests":1,"passed":1}\n');
  mkdirSync(path.join(worktree, '.task-verification'));
  writeFileSync(path.join(worktree, sourcePath), source);
  const report = Buffer.from(
    JSON.stringify({
      version: 1,
      task: task410,
      head,
      outcome: 'passed',
      tests: 1,
      skipped: 0,
      retries: 0,
      sourceReports: [{ path: sourcePath, sha256: correctionHash(source) }],
    }),
  );
  writeFileSync(path.join(worktree, reportPath), report);
  const ticket = f.state.tickets[0];
  const evidence = {
    task: task410,
    owner: worker410,
    head,
    reports: [{ path: reportPath, sha256: correctionHash(report) }],
  };
  const digest = correctionHash(JSON.stringify(evidence));
  ticket.status = 'completed';
  ticket.completion = { digest, evidence };
  f.state.scopedAdmissions = [];
  const event = { action: 'complete', lane: 'development', task: task410, evidenceDigest: digest };
  f.state.events.push(event);
  return { ticket, event, sourcePath: path.join(worktree, sourcePath) };
}

test('corrects the same completed development ticket with original evidence and no live occupancy', async (t) => {
  const f = fixture(t);
  const { ticket, event } = completeDevelopment(f);
  const queueBefore = structuredClone(f.state);
  const result = await f.run();
  const { archive } = readClosedInitialPause(result.audit, f.directory, result.auditDigest);
  assert.equal(result.state, retiredInitialPause);
  assert.deepEqual(f.state, queueBefore);
  assert.deepEqual(archive.source.queue.ticket, ticket);
  assert.deepEqual(archive.source.queue.completed.history.at(-1), event);
  assert.deepEqual(f.box.read().pending, f.initial.pending.slice(1));
  assert.deepEqual(await f.run(), { ...result, replay: true });
});

test('keeps the original packet when completion evidence or the released slot cannot be proved', async (t) => {
  for (const [name, change, error] of [
    [
      'false completion digest',
      (_f, p) => {
        p.ticket.completion.digest = '0'.repeat(64);
      },
      /completion digest/i,
    ],
    [
      'missing original event',
      (f) => {
        f.state.events.pop();
      },
      /original development history/i,
    ],
    [
      'completion event does not match',
      (_f, p) => {
        p.event.evidenceDigest = '0'.repeat(64);
      },
      /evidenceDigest/,
    ],
    [
      'unrelated completed candidate',
      (_f, p) => {
        const completion = p.ticket.completion;
        completion.evidence.head = '0'.repeat(40);
        completion.digest = correctionHash(JSON.stringify(completion.evidence));
        p.event.evidenceDigest = completion.digest;
      },
      /410 evidence field: head/,
    ],
    [
      'actual source report changed',
      (_f, p) => {
        writeFileSync(p.sourcePath, 'changed report');
      },
      /Expected values/,
    ],
    [
      'remaining development scope',
      (f, p) => {
        f.state.scopedAdmissions.push({
          lane: 'development',
          task: task410,
          owner: worker410,
          admission: p.ticket.admission,
        });
      },
      /released all task scopes/,
    ],
    [
      'another ticket occupies the task',
      (f) => {
        f.state.tickets.push({ lane: 'delivery', task: task410, owner: worker410, status: 'queued' });
      },
      /other ticket/,
    ],
    [
      'new reserved decision',
      (f) => {
        f.state.dynamicDecisions = [{ input: { task: task410 }, status: 'reserved' }];
      },
      /dispatch decision/,
    ],
    [
      'later user pause',
      (f, p) => {
        f.state.events.push({ action: 'pause-all', request: { sequence: p.ticket.request.sequence + 1 } });
      },
      /requires its own recovery/,
    ],
  ]) {
    await t.test(name, async (st) => {
      const f = fixture(st);
      const proof = completeDevelopment(f);
      const raw = readFileSync(f.file);
      change(f, proof);
      await assert.rejects(f.run(), error);
      assert.deepEqual(readFileSync(f.file), raw);
    });
  }
});

test('fails closed for another identity, missing formal release, mismatched native source, or an actual pause', async (t) => {
  for (const [name, modify, error] of [
    ['wrong receipt', () => {}, /Expected values/],
    [
      'wrong runtime',
      () => {
        process.env.CODEX_THREAD_ID = worker410;
      },
      /coordinator runtime/,
    ],
    [
      'release incomplete',
      (f) => {
        f.host.dependenciesReady = async () => false;
      },
      /formal closure/,
    ],
    [
      'creation mismatch',
      (f) => {
        f.worker.turns[0].items[0].output.truncated = true;
      },
      /exact task creation/,
    ],
    [
      'later real pause',
      (f) => {
        f.state.events.push({ action: 'pause-all', request: { sequence: 1794970386445 } });
      },
      /requires its own recovery/,
    ],
  ])
    await t.test(name, async (st) => {
      const f = fixture(st),
        raw = readFileSync(f.file);
      modify(f);
      await assert.rejects(
        f.run(name === 'wrong receipt' ? { ...callInput, receiptId: receiptIds410[1] } : callInput),
        error,
      );
      assert.deepEqual(readFileSync(f.file), raw);
    });
});

test('requires an explicit coordinator assessment of native or manual client writes', async (t) => {
  const f = fixture(t),
    bytes = readFileSync(f.file);
  await assert.rejects(f.run({ ...callInput, clientTransport: { outcome: 'unknown' } }), /transport assessment/);
  await assert.rejects(
    f.run({ ...callInput, clientTransport: { outcome: 'never-prepared-no-unknown-write', outboxSha256: 'stale' } }),
    /transport assessment/,
  );
  assert.deepEqual(readFileSync(f.file), bytes);
});

test('keeps original transport and current evidence when the readback is unsafe', async (t) => {
  for (const [name, modify, error] of [
    ['prepared', (f) => f.box.prepare(initialPauseReceipt, 2), /unknown transport/],
    ['failed without revision', (f) => f.box.fail(initialPauseReceipt, 'write_result_unknown'), /unknown transport/],
    [
      'applied readback',
      (f) => {
        const data = JSON.parse(f.observations[1].result.content[0].text);
        data.outcome = 'applied';
        f.observations[1].result.content[0].text = JSON.stringify(data);
      },
      /outcome/,
    ],
    [
      'revision gap',
      (f) => {
        f.observations[0] = f.history([
          { ...f.row, revision: 2 },
          { ...f.row, revision: 2 },
        ]);
      },
      /revision gap/,
    ],
    [
      'stale observation',
      (f) => {
        f.observations[2].observedAt = pausedAt;
      },
      /Fresh native board/,
    ],
    [
      'changed task',
      (f) => {
        f.board.revision = 3;
      },
      /Complete board/,
    ],
    [
      'historical pause',
      (f) => {
        f.observations[0] = f.history([
          { ...f.row, revision: 1, status: 'paused' },
          { ...f.row, revision: 2 },
        ]);
      },
      /status/,
    ],
  ])
    await t.test(name, async (st) => {
      const f = fixture(st);
      modify(f);
      const raw = readFileSync(f.file);
      await assert.rejects(f.run(), error);
      assert.deepEqual(readFileSync(f.file), raw);
    });
});

test('rechecks concurrent source changes and preserves a sealed audit across an interrupted retirement', async (t) => {
  const f = fixture(t),
    original = readFileSync(f.file),
    readTask = f.host.readTask;
  f.host.readTask = async () => {
    f.state.revision++;
    return readTask();
  };
  await assert.rejects(f.run(), /source changed/);
  assert.deepEqual(readFileSync(f.file), original);
  f.host.readTask = readTask;
  const guard = f.host.queue.guard,
    readState = f.host.queue.read;
  f.host.queue.guard = (operation) => {
    let reads = 0;
    f.host.queue.read = () => {
      if (++reads === 2) f.state.revision++;
      return readState();
    };
    try {
      return operation();
    } finally {
      f.host.queue.read = readState;
    }
  };
  await assert.rejects(f.run(), /source changed/);
  assert.deepEqual(readFileSync(f.file), original);
  const audit = path.join(f.directory, 'initial-pause-' + initialPauseReceipt + '.json');
  const first = readFileSync(audit);
  f.host.queue.guard = guard;
  f.host.readTask = async () => {
    f.box.prepare(initialPauseReceipt, 2);
    return readTask();
  };
  await assert.rejects(f.run(), /outbox changed/);
  assert.equal(f.box.read().pending[0].revision, 2);
  writeFileSync(f.file, original);
  f.host.readTask = readTask;
  assert.equal((await f.run()).state, retiredInitialPause);
  assert.deepEqual(readFileSync(audit), first);
});
