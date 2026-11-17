import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import path from 'node:path';
import { readTaskCoordination, requireTaskCoordinator, verifyTaskAuthorization } from '../task-coordination.mjs';
import { verifyCoordinatorSource } from '../task-execution-binding.mjs';
import { registeredTaskWorktrees } from '../task-registry.mjs';
import { assertHostIdle, observeCancellationHost } from '../task-cancellation-proof.mjs';
import {
  proveUnsubmittedCreationProgress,
  validateUnsubmittedCreationObservations,
} from './task-creation-progress.mjs';
import { createProgressOutbox } from '../task-progress-outbox.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mismatch = 'Native thread must read back this exact task creation instruction';
function seal(file) {
  for (const target of [file, path.dirname(file)]) {
    const fd = openSync(target, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
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
    if (existsSync(path.dirname(archiveFile)))
      assert.ok(
        readdirSync(path.dirname(archiveFile)).every((name) => name === input.decisionId + '.json'),
        'A replacement attempt recovery decision is already retained; do not create another attempt',
      );
    let retainedArchive;
    if (existsSync(archiveFile)) {
      const archive = store.privateRead(archiveFile);
      assert.equal(archive.inputDigest, digest(input), 'Recovery decision replay changed');
      assert.equal(archive.originalDigest, digest(archive.original));
      assert.equal(archive.nativeDigest, digest(archive.native));
      if (!record.recovery) {
        assert.deepEqual(record, archive.original, 'Interrupted recovery source changed; preserve its attempt');
        retainedArchive = archive;
      } else {
        assert.equal(record.recovery.archiveDigest, digest(archive), 'Original failure archive changed');
        assert.equal(
          record.recovery.decisionId,
          input.decisionId,
          'Interrupted recovery retained; do not create again',
        );
        assert.equal(record.createRequestId, archive.next.createRequestId);
        if (archive.retiredProgress)
          createProgressOutbox(path.join(commonDir, 'task-progress', record.taskId)).retireCreationAttempt({
            archiveFile,
            archiveDigest: digest(archive),
          });
        return {
          status: 'known-failure-recovery-already-recorded',
          replay: true,
          taskId: record.taskId,
          requestId: record.createRequestId,
          threadId: record.threadId ?? null,
        };
      }
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
    assert.ok(
      input.retryRequest.sequence >
        Math.max(
          0,
          ...queue.events.filter((event) => event.action === 'pause-all').map((event) => event.request.sequence),
        ),
      'A later explicit pause fences creation recovery',
    );
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
    const progressBox = createProgressOutbox(path.join(commonDir, 'task-progress', record.taskId));
    const retiredMarker =
      retainedArchive && progressBox.read().retiredAttempts?.find((item) => item.decisionId === input.decisionId);
    let retiredProgress;
    if (retiredMarker) {
      assert.equal(retiredMarker.archiveDigest, digest(retainedArchive));
      retiredProgress = retainedArchive.retiredProgress;
      assert.ok(retiredProgress);
      const current = progressBox.read();
      assert.equal(current.acknowledged.length, 0, 'Unknown replacement progress outcome remains blocking');
      assert.equal(current.pending.length, 1);
      assert.equal(current.pending[0].receipt_id, retiredMarker.queuedReceiptId);
      assert.equal(current.pending[0].revision, undefined, 'Prepared replacement progress outcome remains blocking');
      assert.equal(current.pending[0].failure, undefined);
      assert.deepEqual(
        Object.keys(current.pending[0]).sort(),
        ['payload_hash', 'receipt', 'receipt_id', 'state'],
        'Unknown replacement progress write metadata',
      );
      progressBox.retireCreationAttempt({ archiveFile, archiveDigest: digest(retainedArchive) });
      const observed = await host.readCreationProgress(
        input.taskId,
        retiredProgress.entries.map((entry) => entry.receipt_id),
      );
      validateUnsubmittedCreationObservations(input.taskId, retiredProgress.entries, board, observed);
    } else {
      retiredProgress = await proveUnsubmittedCreationProgress(commonDir, input.taskId, record, board, host);
      if (retainedArchive)
        assert.equal(
          retiredProgress?.sha256 ?? null,
          retainedArchive.retiredProgress?.sha256 ?? null,
          'Original attempt progress changed before recovery continuation',
        );
    }
    if (retiredProgress) {
      const assessment = input.progressWriteAssessment;
      assert.equal(
        assessment?.coordinatorThreadId,
        input.coordinatorThreadId,
        'Actual coordinator must account for non-outbox/manual writes',
      );
      assert.equal(assessment.originalRequestId, record.createRequestId);
      assert.equal(assessment.outboxSha256, retiredProgress.sha256);
      assert.deepEqual(
        assessment.receiptIds,
        retiredProgress.entries.map((entry) => entry.receipt_id),
      );
      assert.equal(assessment.outcome, 'never-prepared-no-unknown-write', 'Unknown client writes remain blocking');
      if (retiredProgress.entries.some((entry) => entry.receipt.event === 'paused')) {
        const review = input.progressReviewEvidence;
        assert.equal(review?.provider, 'codex-auto-review');
        assert.equal(review.outcome, 'rejected-before-submission');
        assert.ok(typeof review.nativeCallId === 'string' && review.nativeCallId);
        assert.ok(
          typeof review.originalResult === 'string' && /reject|denied|拒绝|审批/i.test(review.originalResult),
          'Original client approval rejection required; never fabricate a server rejection',
        );
        assert.equal(review.serverResponse, undefined);
      }
    }
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
    assert.deepEqual(await host.readTask(input.taskId), board, 'Board changed during native progress observation');
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
    let next = {
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
    if (retainedArchive) next = structuredClone(retainedArchive.next);
    const source = {
      thread: authority.thread,
      message: authority.turns
        .flatMap((turn) => turn.items ?? [])
        .find((item) => item.type === 'userMessage' && item.id === input.retryRequest.messageId),
    };
    const archive = retainedArchive ?? {
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
      retiredProgress,
      ...(input.progressReviewEvidence
        ? {
            progressReviewEvidence: {
              classification: 'client-review-evidence-not-a-server-rejection',
              original: input.progressReviewEvidence,
            },
          }
        : {}),
      next,
    };
    if (!retainedArchive) {
      const closed = {
        contract: 'known-failed-native-intake-unsubmitted-v1',
        state: 'closed-known-failed',
        attemptId: record.createRequestId,
        task: record.taskId,
        outboxDirectory: progressBox.directory,
        closedAt: next.createdAt,
        native: { requestId: record.createRequestId, outcome: 'known-failed', evidenceDigest: archive.nativeDigest },
        failedNativeThread: record.threadId,
        worker: null,
        registry: null,
        worktree: null,
        executionStarted: false,
        request: structuredClone(input.request),
        queue: structuredClone(queue.tickets.find((ticket) => ticket.task === record.taskId)),
        receipts: (retiredProgress?.entries ?? []).map((entry) => ({
          receipt_id: entry.receipt_id,
          entryDigest: digest(entry),
        })),
      };
      archive.closedAttempt = {
        ...closed,
        evidenceDigest: digest({
          facts: closed,
          originalDigest: archive.originalDigest,
          nativeDigest: archive.nativeDigest,
          actualInputSha256: archive.actualInputSha256,
          observationsDigest: archive.observationsDigest,
        }),
      };
    }
    assert.ok(
      Buffer.byteLength(JSON.stringify(archive, null, 2) + '\n') <= 131072,
      'Full failure archive exceeds the existing private record bound; preserve without retry',
    );
    const archiveDigest = digest(archive);
    if (!retainedArchive) store.save(archiveFile, archive, true);
    seal(archiveFile);
    next.recovery.archiveDigest = archiveDigest;
    if (retiredProgress)
      createProgressOutbox(path.join(commonDir, 'task-progress', record.taskId)).retireCreationAttempt({
        archiveFile,
        archiveDigest,
      });
    store.save(store.file(input.taskId), next);
    seal(store.file(input.taskId));
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
    seal(store.file(input.taskId));
    return {
      status: 'replacement-creation-result-pending',
      taskId: next.taskId,
      requestId: next.createRequestId,
      threadId: next.threadId ?? null,
      archiveDigest,
    };
  });
}
