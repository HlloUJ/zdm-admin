import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { verifyNativeCreation } from '../task-thread-titles.mjs';

export const task410 = 'execution-efficiency-dynamic-orchestration';
export const correctionTask = 'unsubmitted-paused-progress-correction';
export const coordinator410 = '01a1e8b9-dcd7-7980-a0f3-e8398c7daf95';
export const worker410 = '01a1ec93-5392-72d0-b16a-f717ee64e2e0';
export const originalRequest = '01a1ec91-ae8f-7262-bda1-abd62292163a';
export const priorityRequest = '01a1ec97-3c8a-7012-9099-d1456a749246';
export const receiptIds410 = [
  'a7e0ad857d59341ed698b033d9f5d64652bc9204aee74193c4d2e19c8cfc99c0',
  '377f7484625c3943c54042144aa158b7151bee147342b351ce7b35014b489269',
  '4dee2715d5965fab221fefef4eb095846862ec384dbf7576839c0f9295578032',
  'e162b5557ce9fe0eeccfb5fd7d298c84fb329f16c5fd635fceb04c4913468569',
];
export const initialPauseReceipt = receiptIds410[0];
export const retiredInitialPause = 'retired-initial-pause-not-delivered';
const title410 = '优化方案与任务执行顺序方案统一落地';
const sourceHead = '153a19047034c1d1feead7fce97c65b1dfa7ee94';
const sourceRevision = 121;
const originalObservedAt = '2026-11-18T02:53:31.771Z';
const originalPayloadHash = '14035fa48c6ec18820d330e36c85cc795893fab20d2eb4cd49f1147983376fdd';
const originalRequestSequence = 1794970386445;
const creationId = '5fefa2cc-0735-4926-9785-1acc0a893734';
const authorizationText = {
  [originalRequest]: '目前是由你进行调度的并行开发模式，但要确保410优先执行\n',
  [priorityRequest]: '继续推进，优先完成410，完成后立即按新机制接续所有未完成任务，直到全部完成。\n',
};

export const correctionHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonHash = (value) => correctionHash(JSON.stringify(value));

export function readPrivateCorrectionFile(file, limit = 262144) {
  for (let cursor = file; cursor !== path.dirname(cursor); cursor = path.dirname(cursor))
    assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked correction evidence refused');
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= limit, 'Private correction evidence required');
  return readFileSync(file);
}

export function validateInitialPauseOutbox(state) {
  assert.deepEqual(Object.keys(state).sort(), ['acknowledged', 'pending', 'tasks', 'version']);
  assert.equal(state.version, 1);
  assert.deepEqual(state.tasks, { [task410]: receiptIds410.length });
  assert.deepEqual(state.acknowledged, [], 'Acknowledged receipts require ordinary reconciliation');
  assert.deepEqual(
    state.pending.map((entry) => entry.receipt_id),
    receiptIds410,
    'Original order changed',
  );
  for (const [index, entry] of state.pending.entries()) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ['payload_hash', 'receipt', 'receipt_id', 'state'],
      'Prepared, failed or unknown transport must retain its original reconciliation path',
    );
    const { version, task_id, receipt_id, sequence, ...payload } = entry.receipt;
    assert.equal(entry.state, 'pending');
    assert.equal(version, 1);
    assert.equal(task_id, task410);
    assert.equal(receipt_id, entry.receipt_id);
    assert.equal(sequence, index + 1);
    assert.equal(entry.payload_hash, jsonHash(payload), 'Original packet digest differs');
    assert.equal(payload.event, index === 0 ? 'paused' : 'queued');
    assert.equal(payload.stage_fact, undefined);
    assert.ok(Number.isFinite(Date.parse(payload.observed_at)));
  }
  const [entry] = state.pending;
  assert.equal(entry.payload_hash, originalPayloadHash);
  assert.equal(entry.receipt.observed_at, originalObservedAt);
  assert.deepEqual(entry.receipt.evidence_refs, [`execution-order:${sourceRevision}:development:${task410}`]);
  return entry;
}

function assertTaskFields(record, fields) {
  for (const [key, value] of Object.entries(fields))
    assert.deepEqual(record?.[key], value, '410 evidence field: ' + key);
}

export function validateInitialPauseSource(source, commonDir) {
  const { coordinator, root, worker, intake, binding, registry, start, queue } = source;
  assert.equal(coordinator.current.rootThreadId, coordinator410);
  assertTaskFields(root.thread, { id: coordinator410, hostId: 'local' });
  assertTaskFields(worker.thread, { id: worker410, title: '410｜' + title410, hostId: 'local' });
  for (const [id, text] of Object.entries(authorizationText)) {
    const items = root.turns.flatMap((turn) => turn.items ?? []).filter((item) => item.id === id);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'userMessage');
    assert.deepEqual(items[0].content, [{ type: 'text', text }], 'Exact original user authorization required');
  }
  assertTaskFields(intake, {
    version: 2,
    state: 'accepted',
    taskId: task410,
    owner: coordinator410,
    rootThreadId: coordinator410,
    messageId: originalRequest,
    number: '410',
    title: title410,
    kind: 'infrastructure',
    card: 'active',
  });
  assertTaskFields(intake.refreshHistory?.at(-1), { executor: worker410, coordinator: coordinator410 });
  assertTaskFields(binding, {
    state: 'bound',
    taskId: task410,
    rootThreadId: coordinator410,
    messageId: originalRequest,
    threadId: worker410,
    createRequestId: creationId,
    initialTitle: worker.thread.title,
  });
  assert.equal(binding.titleSync?.state, 'confirmed');
  const create = verifyNativeCreation(binding, worker);
  assert.equal(create.type, 'functionCallOutput');
  assert.equal(create.id, binding.creationMessageId);
  assert.deepEqual(create, binding.creationObservation);

  assertTaskFields(registry, {
    id: task410,
    owner: worker410,
    base: sourceHead,
    branch: 'codex/' + task410,
    kind: 'infrastructure',
    stage: 'developing',
    repository: { commonDir },
  });
  assert.equal(registry.executionBindings?.length ?? 0, 0);
  assert.equal(registry.runtimeBlocked, undefined);
  assertTaskFields(registry.monitoring, {
    worker: worker410,
    owner: worker410,
    rootThreadId: coordinator410,
    coordinatorThreadId: coordinator410,
    authorizationRef: originalRequest,
    taskStableId: task410,
    taskNumber: '410',
    taskName: title410,
    executionSurface: 'codex-thread',
    runtimeOwnerVerified: true,
    paused: false,
  });
  assertTaskFields(start, {
    task: task410,
    owner: worker410,
    branch: registry.branch,
    worktree: registry.worktree,
    base: sourceHead,
    state: 'registered',
  });
  assert.ok(Date.parse(registry.createdAt) > Date.parse(originalObservedAt));
  assert.ok(path.isAbsolute(start.worktree) && path.basename(start.worktree) === task410);

  const { ticket, scope, pauseFences, bindingEvent, direction } = queue;
  assert.ok(Number.isSafeInteger(queue.revision) && queue.revision > sourceRevision && queue.paused === true);
  assertTaskFields(ticket, {
    task: task410,
    lane: 'development',
    owner: worker410,
    nativeCoordinatorOwner: coordinator410,
    executionKind: 'infrastructure',
    nativeLaunchReserved: true,
    status: 'running',
  });
  assert.ok(ticket.admission && !ticket.awaitingNativeWorker && !ticket.failure && !ticket.reason);
  assertTaskFields(ticket.request, {
    messageId: originalRequest,
    roomId: coordinator410,
    sequence: originalRequestSequence,
    authorId: coordinator.current.request.authorId,
  });
  assertTaskFields(scope, {
    task: task410,
    lane: 'development',
    owner: worker410,
    admission: ticket.admission,
    request: ticket.request,
  });
  assertTaskFields(bindingEvent, {
    action: 'bind-native-worker',
    task: task410,
    workerOwner: worker410,
    coordinatorOwner: coordinator410,
  });
  assertTaskFields(direction, { action: 'resume-selected', request: ticket.request });
  assert.ok(
    direction.members.some(
      (member) => member.task === task410 && member.owner === worker410 && member.admission === ticket.admission,
    ),
  );
  assert.ok(
    pauseFences.length > 0 &&
      pauseFences.every(
        (event) =>
          ['initialize', 'pause-all'].includes(event.action) &&
          Number.isSafeInteger(event.request?.sequence) &&
          event.request.sequence < ticket.request.sequence,
      ),
    'A pause at or after the original instruction requires its own recovery',
  );
}

function readBoardObservation(observations, operation, args, checkedAt) {
  const matches = observations.filter(
    (item) =>
      item.operation === operation &&
      Object.keys(item.args ?? {}).length === Object.keys(args).length &&
      Object.entries(args).every(([key, value]) => item.args[key] === value),
  );
  assert.equal(matches.length, 1, 'Exact native board observation required');
  const { observedAt, provider, result } = matches[0];
  const at = Date.parse(observedAt);
  assert.ok(
    Number.isFinite(at) && at <= checkedAt && checkedAt - at <= 60000,
    'Fresh native board observation required',
  );
  assert.equal(provider, 'codex-native-task-board');
  assert.equal(result?.isError, false);
  assert.equal(result.content?.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

export function validateInitialPauseBoard(observations, board, checkedAt) {
  assert.equal(observations?.length, receiptIds410.length + 1);
  const history = readBoardObservation(observations, 'task_history', { id: task410 }, checkedAt);
  assertTaskFields(board, {
    id: task410,
    task_number: '410',
    title: title410,
    status: 'active',
    board_column: 'active',
    deleted_at: null,
    completed_at: null,
  });
  assert.ok(Number.isSafeInteger(board.revision) && board.revision >= 2);
  assert.equal(history.length, board.revision, 'Complete board revision history required');
  const snapshots = history
    .map((event) => {
      assert.equal(event.task_id, task410);
      const row = typeof event.snapshot === 'string' ? JSON.parse(event.snapshot) : event.snapshot;
      assertTaskFields(row, { id: task410, status: 'active', deleted_at: null });
      assert.ok(row.completed_at == null, 'Completed task requires ordinary reconciliation');
      assert.ok(
        !row.progress_receipt && !row.card_stage,
        'Prior task progress, stage or pause requires ordinary reconciliation',
      );
      return row;
    })
    .sort((a, b) => a.revision - b.revision);
  snapshots.forEach((row, index) => assert.equal(row.revision, index + 1, 'Board revision gap or duplicate'));
  const overview = { ...board };
  delete overview.board_column;
  assert.deepEqual(snapshots.at(-1), overview, 'History and fresh board readback differ');
  for (const receipt_id of receiptIds410) {
    const seen = readBoardObservation(
      observations,
      'get_task_progress_receipt',
      { id: task410, receipt_id },
      checkedAt,
    );
    assertTaskFields(seen, {
      version: 1,
      receipt_id,
      outcome: 'not_found',
      receipt: null,
      applied_revision: null,
      task: board,
    });
  }
}

export function validate410ClientTransport(raw, clientTransport) {
  assert.deepEqual(
    clientTransport,
    {
      outcome: 'never-prepared-no-unknown-write',
      outboxSha256: correctionHash(raw),
    },
    'Exact coordinator client transport assessment required',
  );
}

export function createInitialPauseArchive(raw, facts, directory) {
  const checkedAt = Date.parse(facts.checkedAt);
  assert.ok(Number.isFinite(checkedAt) && checkedAt >= Date.parse(originalObservedAt));
  const entry = validateInitialPauseOutbox(JSON.parse(raw));
  validate410ClientTransport(raw, facts.clientTransport);
  validateInitialPauseSource(facts.source, path.dirname(path.dirname(directory)));
  validateInitialPauseBoard(facts.observations, facts.board, checkedAt);
  return {
    version: 1,
    status: retiredInitialPause,
    firstError: { kind: 'incorrect-global-pause-projection', sourceHead, queueRevision: sourceRevision },
    entry,
    originalOutbox: { bytes: raw.toString('base64'), sha256: correctionHash(raw) },
    clientTransport: facts.clientTransport,
    source: facts.source,
    board: facts.board,
    observations: facts.observations,
    checkedAt: facts.checkedAt,
  };
}

export function readClosedInitialPause(file, directory, expectedDigest) {
  assert.equal(directory, path.join(path.dirname(path.dirname(directory)), 'task-progress', task410));
  assert.equal(file, path.join(directory, 'initial-pause-' + initialPauseReceipt + '.json'));
  const bytes = readPrivateCorrectionFile(file);
  const digest = correctionHash(bytes);
  if (expectedDigest !== undefined) assert.equal(digest, expectedDigest, 'Closed initial-pause archive changed');
  const archive = JSON.parse(bytes);
  const raw = Buffer.from(archive.originalOutbox.bytes, 'base64');
  const { clientTransport, source, board, observations, checkedAt } = archive;
  assert.deepEqual(
    archive,
    createInitialPauseArchive(raw, { clientTransport, source, board, observations, checkedAt }, directory),
  );
  return { archive, digest };
}
