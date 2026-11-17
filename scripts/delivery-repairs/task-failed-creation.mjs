import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readTaskCoordination, requireTaskCoordinator, verifyTaskAuthorization } from '../task-coordination.mjs';
import { verifyCoordinatorSource } from '../task-execution-binding.mjs';
import { registeredTaskWorktrees } from '../task-registry.mjs';
import { assertHostIdle, observeCancellationHost } from '../task-cancellation-proof.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mismatch = 'Native thread must read back this exact task creation instruction';
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

// This creates a separate attempt. It never makes the rejected native input
// eligible for binding and never weakens the ordinary exact-creation verifier.
export async function recoverFailedCreation(
  commonDir,
  input,
  host,
  store,
  { registry, observe = observeCancellationHost },
) {
  const coordination = readTaskCoordination(commonDir);
  assert.ok(coordination, 'Published coordinator route required');
  requireTaskCoordinator(commonDir, input.coordinatorThreadId);
  assert.equal(input.owner, input.rootThreadId, 'Original intake coordinator owner required');
  assert.equal(process.env.CODEX_THREAD_ID, input.coordinatorThreadId, 'Actual current coordinator runtime required');
  assert.match(input.decisionId ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(input.expectedCoordinationRevision, coordination.revision);
  assert.equal(input.retryRequest.authorId, coordination.current.request.authorId);
  assert.equal(input.retryRequest.authorId, input.request.authorId);
  assert.ok(
    input.retryRequest.sequence >= input.request.sequence,
    'Retry must use actual applicable user authorization',
  );
  const coordinator = await host.readThread(input.coordinatorThreadId);
  assert.equal(coordinator.thread.id, input.coordinatorThreadId);
  assert.equal(coordinator.thread.hostId, 'local');
  await verifyTaskAuthorization(commonDir, { ...input, rootThreadId: input.rootThreadId }, host.readThread);
  const authority = await verifyCoordinatorSource(
    { rootThreadId: input.coordinatorThreadId, request: input.retryRequest },
    host.readThread,
  );
  return store.exclusive(input.taskId, async () => {
    const record = store.get(input.taskId);
    assert.ok(record, 'Original durable creation attempt required');
    const archiveFile = path.join(store.base, 'failed-creations', input.taskId, input.decisionId + '.json');
    if (existsSync(archiveFile)) {
      const archive = store.privateRead(archiveFile);
      assert.equal(archive.inputDigest, digest(input), 'Recovery decision replay changed');
      assert.equal(record.recovery?.archiveDigest, digest(archive), 'Original failure archive changed');
      assert.equal(archive.originalDigest, digest(archive.original));
      assert.equal(archive.nativeDigest, digest(archive.native));
      assert.equal(record.recovery?.decisionId, input.decisionId, 'Interrupted recovery retained; do not create again');
      assert.equal(record.createRequestId, archive.next.createRequestId);
      return {
        status: 'known-failure-recovery-already-recorded',
        replay: true,
        taskId: record.taskId,
        requestId: record.createRequestId,
        threadId: record.threadId ?? null,
      };
    }
    assert.ok(!record.recovery, 'A replacement attempt already exists; preserve its actual or unknown result');
    assert.equal(record.state, 'creation-unknown');
    assert.equal(record.rootThreadId, input.rootThreadId);
    assert.equal(record.messageId, input.request.messageId);
    assert.equal(record.createRequestId, input.originalRequestId);
    assert.equal(record.threadId, input.threadId, 'Known ready native result required');
    assert.ok(record.threadId, 'Unknown creation cannot be retried');
    store.assertReceipt(input.taskId, input.rootThreadId, input.request.messageId);
    const queue = host.queue.read();
    assert.equal(queue.revision, input.expectedQueueRevision);
    store.assertPending(input, store.existingExecution(input.taskId));
    assert.equal(
      queue.tickets.filter((ticket) => ticket.task === input.taskId).length,
      1,
      'Task has another lane or execution',
    );
    assert.ok(!registry.readTask(input.taskId), 'Already registered task cannot replace its worker');
    assert.ok(!existsSync(path.join(store.base, 'threads', record.threadId + '.json')), 'Native worker already bound');
    for (const relative of [
      'task-registry/start-intents/' + input.taskId + '.json',
      'task-environments/' + input.taskId,
      'task-delivery/' + input.taskId,
    ])
      assert.ok(!existsSync(path.join(commonDir, relative)), 'Task start/data/delivery assets already exist');
    const entries = registeredTaskWorktrees(registry.root);
    const main = entries.filter((entry) => entry.branch === 'main'),
      integration = entries.filter((entry) => entry.branch === 'codex/integration-current');
    assert.equal(main.length, 1);
    assert.equal(integration.length, 1, 'Original permanent task parent required');
    const target = {
      id: input.taskId,
      branch: 'codex/' + input.taskId,
      worktree: path.join(path.dirname(integration[0].worktree), input.taskId),
    };
    assert.ok(
      !existsSync(target.worktree) &&
        !entries.some((entry) => entry.branch === target.branch || entry.worktree === target.worktree),
      'Task Git carrier already exists',
    );
    assert.equal(git(registry.root, 'branch', '--list', target.branch), '', 'Task branch already exists');
    const actual = await host.readThread(record.threadId);
    assert.equal(actual.thread.id, record.threadId);
    assert.equal(actual.thread.hostId, coordinator.thread.hostId);
    assert.equal(actual.thread.title, record.initialTitle);
    assert.equal(actual.thread.status?.type, 'idle', 'Failed creation worker must be actually idle');
    let failure;
    try {
      store.verifyNativeCreation(record, actual);
    } catch (error) {
      failure = error.message;
    }
    assert.equal(failure, mismatch, 'Only the actual reviewed exact-input mismatch may be retried');
    const candidates = actual.turns
      ?.flatMap((turn) => turn.items ?? [])
      .filter(
        (item) =>
          item.id &&
          item.type === 'functionCallOutput' &&
          item.namespace === 'codex_app' &&
          item.name === 'create_thread' &&
          item.output?.truncated === false &&
          typeof item.output.text === 'string',
      );
    assert.equal(candidates?.length, 1, 'One complete original native creation event required');
    const creation = candidates[0];
    const parsed = creation.output.text.match(
      /^<codex_delegation>\n {2}<source_thread_id>([^<]+)<\/source_thread_id>\n {2}<input>([\s\S]*)<\/input>\n<\/codex_delegation>$/,
    );
    assert.equal(parsed?.[1], record.creationRootThreadId ?? record.rootThreadId, 'Original creation source differs');
    const actualInput = parsed[2];
    assert.ok(
      actualInput.startsWith(record.creationPrompt + '\n') && actualInput.slice(record.creationPrompt.length).trim(),
      'Only the known appended-input creation failure is supported',
    );
    assert.equal(
      actualInput.split(`创建标识：${record.createRequestId}\n`).length,
      2,
      'Ambiguous original creation nonce',
    );
    const board = await host.readTask(input.taskId);
    assert.equal(board.id, input.taskId);
    assert.equal(board.status, 'active');
    assert.equal(store.threadTitle(board), record.initialTitle);
    assert.equal(board.revision, input.expectedBoardRevision);
    const capacity = await host.readCapacity();
    for (const key of ['limit', 'activeDevelopment', 'activeDelivery', 'activeOther'])
      assert.ok(Number.isSafeInteger(capacity[key]) && capacity[key] >= 0);
    const preparation = capacity.activePreparation ?? 0;
    assert.ok(
      capacity.limit > 0 && capacity.activeDelivery <= 1 && Number.isSafeInteger(preparation) && preparation >= 0,
    );
    const pending = queue.tickets.filter((ticket) => ticket.status === 'queued' && ticket.nativeLaunchReserved).length;
    const decisions = (queue.dynamicDecisions ?? []).filter((decision) => decision.status === 'reserved');
    const reservedFinal =
      capacity.activeDelivery || decisions.some((decision) => decision.input.phase === 'final') ? 0 : 1;
    const ownReserved = queue.tickets.some((ticket) => ticket.task === input.taskId && ticket.nativeLaunchReserved);
    assert.ok(
      capacity.activeDevelopment +
        capacity.activeDelivery +
        preparation +
        capacity.activeOther +
        pending +
        decisions.length +
        (ownReserved ? 0 : 1) +
        reservedFinal <=
        capacity.limit,
      'Reserve actual capacity for replacement creation',
    );
    const first = observe(),
      second = observe();
    assertHostIdle(first, target);
    assertHostIdle(second, target);
    assert.deepEqual(readTaskCoordination(commonDir), coordination);
    assert.deepEqual(host.queue.read(), queue, 'Queue changed before recovery');
    assert.deepEqual(store.get(input.taskId), record, 'Creation changed before recovery');
    assert.ok(!registry.readTask(input.taskId));
    assert.ok(!existsSync(target.worktree));
    assert.equal(git(registry.root, 'branch', '--list', target.branch), '');
    for (const relative of [
      'task-registry/start-intents/' + input.taskId + '.json',
      'task-environments/' + input.taskId,
      'task-delivery/' + input.taskId,
    ])
      assert.ok(!existsSync(path.join(commonDir, relative)), 'Task assets appeared during observation');
    assert.equal(typeof host.createThread, 'function', 'Authenticated exact native create adapter required');
    const next = {
      ...record,
      createRequestId: randomUUID(),
      state: 'creation-unknown',
      createdAt: new Date().toISOString(),
      ...(input.coordinatorThreadId !== record.rootThreadId ? { creationRootThreadId: input.coordinatorThreadId } : {}),
    };
    delete next.threadId;
    delete next.clientThreadId;
    delete next.creationRootThreadId;
    if (input.coordinatorThreadId !== record.rootThreadId) next.creationRootThreadId = input.coordinatorThreadId;
    next.creationPrompt = record.creationPrompt.replace(
      `创建标识：${record.createRequestId}\n`,
      `创建标识：${next.createRequestId}\n`,
    );
    next.recovery = {
      decisionId: input.decisionId,
      archive: path.relative(store.base, archiveFile),
      originalRequestId: record.createRequestId,
      threadId: record.threadId,
    };
    const source = {
      thread: authority.thread,
      message: authority.turns
        .flatMap((turn) => turn.items ?? [])
        .find((item) => item.type === 'userMessage' && item.id === input.retryRequest.messageId),
    };
    const archive = {
      version: 1,
      input: structuredClone(input),
      inputDigest: digest(input),
      original: record,
      originalBytes: readFileSync(store.file(input.taskId), 'utf8'),
      originalBytesSha256: createHash('sha256')
        .update(readFileSync(store.file(input.taskId)))
        .digest('hex'),
      originalDigest: digest(record),
      native: actual,
      nativeDigest: digest(actual),
      actualInput,
      actualInputSha256: createHash('sha256').update(actualInput).digest('hex'),
      failure,
      authority: source,
      coordination,
      capacity,
      observationsDigest: digest({ first, second }),
      next,
    };
    assert.ok(
      Buffer.byteLength(JSON.stringify(archive, null, 2) + '\n') <= 131072,
      'Full failure archive exceeds the existing private record bound; preserve without retry',
    );
    const archiveDigest = digest(archive);
    store.save(archiveFile, archive, true);
    next.recovery.archiveDigest = archiveDigest;
    store.save(store.file(input.taskId), next);
    // Persist unknown before exposing the new plan. Replays never issue it again.
    const created = await host.createThread({
      requestId: next.createRequestId,
      taskId: next.taskId,
      title: next.initialTitle,
      prompt: next.creationPrompt,
    });
    if (created?.threadId) next.threadId = created.threadId;
    if (created?.clientThreadId) next.clientThreadId = created.clientThreadId;
    store.save(store.file(input.taskId), next);
    return {
      status: 'replacement-creation-result-pending',
      taskId: next.taskId,
      requestId: next.createRequestId,
      threadId: next.threadId ?? null,
      archiveDigest,
    };
  });
}
