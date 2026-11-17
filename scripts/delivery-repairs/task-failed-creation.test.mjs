import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
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
import { createProgressOutbox } from '../task-progress-outbox.mjs';
import { readClosedCreationAttempt } from './task-creation-progress.mjs';

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
    readCreationProgress: async (taskId, ids) => ({
      history: [{ task_id: taskId, snapshot: structuredClone(board) }],
      receipts: ids.map((receipt_id) => ({
        version: 1,
        receipt_id,
        outcome: 'not_found',
        applied_revision: null,
        receipt: null,
        task: structuredClone(board),
      })),
    }),
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
  const originalOutboxFile = path.join(commonDir, 'task-progress', input.taskId, 'outbox.json');
  retry.progressWriteAssessment = {
    coordinatorThreadId: rootId,
    originalRequestId: original.createRequestId,
    outboxSha256: createHash('sha256').update(readFileSync(originalOutboxFile)).digest('hex'),
    receiptIds: JSON.parse(readFileSync(originalOutboxFile)).pending.map((entry) => entry.receipt_id),
    outcome: 'never-prepared-no-unknown-write',
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
    box: createProgressOutbox(path.join(commonDir, 'task-progress', input.taskId)),
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
  assert.equal(archive.retiredProgress.kind, 'never-submitted-failed-creation-projections');
  assert.equal(readClosedCreationAttempt(path.join(f.store.base, next.recovery.archive)).state, 'closed-known-failed');
  assert.throws(
    () => f.box.retireCreationAttempt({ closedAttempt: archive.closedAttempt }),
    /Trusted sealed attempt archive reader/,
  );
  assert.equal(f.box.read().acknowledged.length, 0);
  assert.equal(f.box.read().retired[0].state, 'retired-attempt-not-delivered');
  assert.deepEqual(f.box.read().retired[0].receipt, archive.retiredProgress.entries[0].receipt);
  assert.equal(f.box.read().pending[0].receipt.event, 'queued');
  assert.equal(f.box.read().pending[0].receipt.sequence, archive.retiredProgress.lastSequence + 1);
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
test('the formal closed-attempt reader rejects a creation-unknown source instead of treating its JSON shape as closure', async (t) => {
  const f = await fixture(t);
  await f.recover();
  const file = path.join(f.store.base, f.store.get(f.input.taskId).recovery.archive),
    archive = JSON.parse(readFileSync(file));
  archive.closedAttempt.state = 'creation-unknown';
  writeFileSync(file, JSON.stringify(archive));
  assert.throws(() => readClosedCreationAttempt(file), /Unknown creation is not a closed failure/);
});
test('two legacy unsent queue/pause projections retire as immutable never-delivered facts; only a new truthful queued receipt is pending', async (t) => {
  const f = await fixture(t),
    file = path.join(f.box.directory, 'outbox.json');
  const state = f.box.read(),
    entry = state.pending[0];
  entry.receipt.event = 'paused';
  entry.receipt.next.label = '等待恢复指令';
  const payload = (receipt) => {
    const value = { ...receipt };
    for (const field of ['version', 'task_id', 'receipt_id', 'sequence']) delete value[field];
    return value;
  };
  entry.payload_hash = createHash('sha256')
    .update(JSON.stringify(payload(entry.receipt)))
    .digest('hex');
  writeFileSync(file, JSON.stringify(state) + '\n');
  f.box.enqueue(f.input.taskId, 'original-native-readiness', {
    event: 'queued',
    observed_at: f.original.createdAt,
    action: { id: 'receive', label: '原生创建／绑定仍在等待核验' },
    evidence_refs: [`published-native-host:receive:${f.input.taskId}:${f.original.messageId}`],
    next: { kind: 'action', label: 'native-create-result-unknown' },
  });
  const original = readFileSync(file),
    oldEntries = f.box.read().pending;
  f.retry.progressReviewEvidence = {
    provider: 'codex-auto-review',
    outcome: 'rejected-before-submission',
    nativeCallId: 'fixture-native-auto-review-denial',
    originalResult:
      'Tool execution rejected by automatic approval review before provider submission; not an HTTP/server response',
  };
  f.retry.progressWriteAssessment.outboxSha256 = createHash('sha256').update(original).digest('hex');
  f.retry.progressWriteAssessment.receiptIds = oldEntries.map((entry) => entry.receipt_id);
  await f.recover();
  const after = f.box.read(),
    archive = JSON.parse(readFileSync(path.join(f.store.base, f.store.get(f.input.taskId).recovery.archive)));
  assert.deepEqual(Buffer.from(archive.retiredProgress.bytes, 'base64'), original);
  assert.deepEqual(
    after.retired.map((item) => item.receipt),
    oldEntries.map((item) => item.receipt),
  );
  assert.ok(
    after.retired.every(
      (item) => item.state === 'retired-attempt-not-delivered' && !item.failure && item.revision === undefined,
    ),
  );
  assert.equal(after.acknowledged.length, 0);
  assert.equal(after.pending.length, 1);
  assert.equal(after.pending[0].receipt.sequence, 3);
  assert.equal(after.pending[0].receipt.event, 'queued');
  assert.equal(archive.progressReviewEvidence.classification, 'client-review-evidence-not-a-server-rejection');
  const sourceRevision = oldEntries[0].receipt.evidence_refs[0].split(':')[1];
  const replay = f.box.enqueue(f.input.taskId, `queue:${sourceRevision}:development`, payload(oldEntries[0].receipt));
  assert.equal(replay.state, 'retired-attempt-not-delivered');
  assert.deepEqual(f.box.read(), after);
  await f.recover();
  assert.deepEqual(f.box.read(), after);
});
for (const scenario of [
  'prepared',
  'failed',
  'unknown-write-marker',
  'unknown-manual-write',
  'missing-write-assessment',
  'already-applied',
  'history-applied',
  'history-work-started',
  'history-gap',
  'missing-readback',
  'third-projection',
  'explicit-later-pause',
  'wrong-original-source',
])
  test('creation progress retirement refuses ' + scenario + ' and preserves all original delivery facts', async (t) => {
    const f = await fixture(t),
      originalReader = f.host.readCreationProgress;
    const first = f.box.read().pending[0];
    if (scenario === 'prepared') f.box.prepare(first.receipt_id, 1);
    if (scenario === 'failed') f.box.fail(first.receipt_id, 'network_error');
    if (scenario === 'unknown-write-marker') {
      const state = f.box.read();
      state.pending[0].unknown_write = true;
      writeFileSync(path.join(f.box.directory, 'outbox.json'), JSON.stringify(state));
    }
    if (scenario === 'unknown-manual-write') f.retry.progressWriteAssessment.outcome = 'unknown-manual-write';
    if (scenario === 'missing-write-assessment') delete f.retry.progressWriteAssessment;
    if (scenario === 'third-projection')
      for (let n = 0; n < 2; n++)
        f.box.enqueue(f.input.taskId, 'extra-' + n, {
          event: 'queued',
          observed_at: f.original.createdAt,
          action: { id: 'receive' },
          evidence_refs: ['unknown'],
          next: { kind: 'wait', label: 'unknown' },
        });
    if (scenario === 'explicit-later-pause')
      f.queue.direct({
        action: 'pause-all',
        request: { ...f.retry.retryRequest, messageId: 'actual-later-pause', sequence: 5 },
      });
    if (scenario === 'wrong-original-source') {
      const value = f.box.read();
      value.pending[0].receipt.evidence_refs[0] = 'execution-order:1:development:other-task';
      writeFileSync(path.join(f.box.directory, 'outbox.json'), JSON.stringify(value));
    }
    f.host.readCreationProgress = async (...args) => {
      const proof = await originalReader(...args);
      if (scenario === 'already-applied') proof.receipts[0].outcome = 'applied';
      if (scenario === 'history-applied') proof.history[0].snapshot.progress_receipt = { receipt: first.receipt };
      if (scenario === 'history-work-started')
        proof.history[0].snapshot.progress_receipt = { receipt: { receipt_id: 'another-receipt', event: 'started' } };
      if (scenario === 'history-gap') proof.history[0].snapshot.revision = 2;
      if (scenario === 'missing-readback') proof.receipts = [];
      return proof;
    };
    const before = readFileSync(path.join(f.box.directory, 'outbox.json')),
      queue = f.queue.read();
    await assert.rejects(f.recover());
    assert.deepEqual(readFileSync(path.join(f.box.directory, 'outbox.json')), before);
    assert.deepEqual(f.store.get(f.input.taskId), f.original);
    assert.deepEqual(f.queue.read(), queue);
    assert.equal(f.creates(), 1);
  });
test('interrupted local retirement retains the first archive and nonce; the same decision revalidates and emits exactly one new plan', async (t) => {
  const f = await fixture(t),
    lock = path.join(f.box.directory, 'outbox.lock');
  writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  await assert.rejects(f.recover(), /EEXIST/);
  assert.deepEqual(f.store.get(f.input.taskId), f.original);
  assert.equal(f.creates(), 1);
  const archiveFile = path.join(f.store.base, 'failed-creations', f.input.taskId, f.retry.decisionId + '.json');
  const originalArchive = readFileSync(archiveFile),
    next = JSON.parse(originalArchive).next;
  rmSync(lock);
  await f.recover();
  assert.equal(f.store.get(f.input.taskId).createRequestId, next.createRequestId);
  assert.deepEqual(readFileSync(archiveFile), originalArchive);
  assert.equal(f.creates(), 2);
  await f.recover();
  assert.equal(f.creates(), 2);
});
for (const prepared of [false, true])
  test(`durable retired transaction prefix resumes only with known unsubmitted replacement progress: prepared=${prepared}`, async (t) => {
    const f = await fixture(t),
      lock = path.join(f.box.directory, 'outbox.lock');
    writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
    await assert.rejects(f.recover(), /EEXIST/);
    rmSync(lock);
    const archiveFile = path.join(f.store.base, 'failed-creations', f.input.taskId, f.retry.decisionId + '.json');
    const bytes = readFileSync(archiveFile),
      archive = JSON.parse(bytes);
    // Execute the real local transaction prefix, stopping before the active
    // attempt index and before any new native plan is exposed.
    f.box.retireCreationAttempt({
      archiveFile,
      archiveDigest: createHash('sha256').update(JSON.stringify(archive)).digest('hex'),
    });
    assert.deepEqual(f.store.get(f.input.taskId), f.original);
    assert.equal(f.creates(), 1);
    if (prepared) {
      f.box.prepare(f.box.read().pending[0].receipt_id, 1);
      await assert.rejects(f.recover(), /Prepared replacement progress/);
      assert.deepEqual(f.store.get(f.input.taskId), f.original);
      assert.equal(f.box.read().pending[0].revision, 1);
      assert.equal(f.creates(), 1);
    } else {
      await f.recover();
      assert.equal(f.store.get(f.input.taskId).createRequestId, archive.next.createRequestId);
      assert.equal(f.creates(), 2);
      assert.equal(f.box.read().pending.length, 1);
      await f.recover();
      assert.equal(f.creates(), 2);
    }
    assert.deepEqual(readFileSync(archiveFile), bytes);
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
  const progress = async () => {
    const ids = f.box.read().pending.map((entry) => entry.receipt_id),
      proof = await f.host.readCreationProgress(f.input.taskId, ids);
    const raw = (value) => ({
      content: [{ type: 'text', text: JSON.stringify(value) }],
      structuredContent: null,
      isError: false,
    });
    return [
      {
        provider: 'codex-native-task-board',
        operation: 'task_history',
        args: { id: f.input.taskId },
        observedAt: new Date().toISOString(),
        result: raw(proof.history),
      },
      ...proof.receipts.map((result) => ({
        provider: 'codex-native-task-board',
        operation: 'get_task_progress_receipt',
        args: { id: f.input.taskId, receipt_id: result.receipt_id },
        observedAt: new Date().toISOString(),
        result: raw(result),
      })),
    ];
  };
  const call = async (input) =>
    advanceTaskThread(
      {
        ...input,
        nativeObservations: observations(),
        capacity,
        progressNativeObservations: input.progressNativeObservations ?? (await progress()),
      },
      {
        commonDir: f.commonDir,
        registry: f.registry,
        readTask: f.host.readTask,
        observe: () => structuredClone(f.observation),
      },
    );
  const input = { action: 'retry-creation', task: f.retry };
  const stale = await progress();
  stale[0].observedAt = '2000-01-01T00:00:00.000Z';
  await assert.rejects(call({ ...input, progressNativeObservations: stale }), /Fresh native progress evidence/);
  assert.deepEqual(f.store.get(f.input.taskId), f.original);
  assert.equal(f.creates(), 1);
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
