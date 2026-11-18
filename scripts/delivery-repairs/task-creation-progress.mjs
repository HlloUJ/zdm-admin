import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { verifyNativeCreation } from '../task-thread-titles.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value) => hash(JSON.stringify(value));
export function readClosedCreationAttempt(file) {
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked closed-attempt source refused');
    if (cursor === path.dirname(cursor)) break;
  }
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= 131072);
  const archive = JSON.parse(readFileSync(file)),
    source = archive.closedAttempt;
  assert.equal(source?.contract, 'known-failed-native-intake-unsubmitted-v1');
  assert.equal(source.state, 'closed-known-failed', 'Unknown creation is not a closed failure');
  assert.equal(source.attemptId, archive.original.createRequestId);
  assert.equal(source.task, archive.original.taskId);
  assert.equal(source.failedNativeThread, archive.original.threadId);
  assert.equal(source.native.requestId, source.attemptId);
  assert.equal(source.native.outcome, 'known-failed');
  assert.equal(source.native.evidenceDigest, archive.nativeDigest);
  assert.equal(archive.originalDigest, jsonHash(archive.original));
  assert.equal(archive.nativeDigest, jsonHash(archive.native));
  assert.equal(hash(archive.originalBytes), archive.originalBytesSha256);
  assert.deepEqual(JSON.parse(archive.originalBytes), archive.original);
  assert.equal(archive.native.thread.id, source.failedNativeThread);
  assert.equal(archive.native.thread.status?.type, 'idle');
  assert.equal(archive.input.originalRequestId, source.attemptId);
  assert.equal(archive.input.threadId, source.failedNativeThread);
  assert.equal(archive.input.coordinatorThreadId, archive.coordination.current.rootThreadId);
  const events = archive.native.turns
    .flatMap((turn) => turn.items ?? [])
    .filter(
      (item) =>
        item.type === 'functionCallOutput' &&
        item.namespace === 'codex_app' &&
        item.name === 'create_thread' &&
        item.output?.truncated === false,
    );
  assert.equal(events.length, 1);
  const actual = events[0].output.text.match(
    /^<codex_delegation>\n {2}<source_thread_id>([^<]+)<\/source_thread_id>\n {2}<input>([\s\S]*)<\/input>\n<\/codex_delegation>$/,
  );
  assert.equal(actual?.[1], archive.original.creationRootThreadId ?? archive.original.rootThreadId);
  assert.equal(actual[2], archive.actualInput);
  assert.equal(hash(actual[2]), archive.actualInputSha256);
  assert.ok(
    actual[2].startsWith(archive.original.creationPrompt + '\n') &&
      actual[2].slice(archive.original.creationPrompt.length).trim(),
  );
  assert.equal(actual[2].split(`创建标识：${source.attemptId}\n`).length, 2);
  let failure;
  try {
    verifyNativeCreation(archive.original, archive.native);
  } catch (error) {
    failure = error.message;
  }
  assert.equal(failure, 'Native thread must read back this exact task creation instruction');
  assert.equal(archive.failure, failure);
  assert.equal(source.worker, null);
  assert.equal(source.registry, null);
  assert.equal(source.worktree, null);
  assert.equal(source.executionStarted, false);
  assert.equal(source.queue.task, source.task);
  assert.equal(source.queue.status, 'queued');
  assert.equal(source.queue.awaitingNativeWorker, true);
  assert.equal(source.queue.admission, null);
  assert.deepEqual(source.queue.request, source.request);
  assert.equal(source.queue.owner, archive.original.rootThreadId);
  assert.deepEqual(source.request, archive.input.request);
  const common = path.dirname(path.dirname(path.dirname(path.dirname(file))));
  assert.equal(source.outboxDirectory, path.join(common, 'task-progress', source.task));
  assert.ok(Number.isFinite(Date.parse(source.closedAt)));
  assert.deepEqual(
    source.receipts,
    (archive.retiredProgress?.entries ?? []).map((entry) => ({
      receipt_id: entry.receipt_id,
      entryDigest: jsonHash(entry),
    })),
  );
  assert.ok(
    (archive.retiredProgress?.entries ?? []).every(
      (entry) => Date.parse(entry.receipt.observed_at) <= Date.parse(source.closedAt),
    ),
  );
  const { evidenceDigest, ...facts } = source;
  assert.equal(
    evidenceDigest,
    jsonHash({
      facts,
      originalDigest: archive.originalDigest,
      nativeDigest: archive.nativeDigest,
      actualInputSha256: archive.actualInputSha256,
      observationsDigest: archive.observationsDigest,
    }),
  );
  return structuredClone(source);
}
export async function proveUnsubmittedCreationProgress(commonDir, task, record, board, host) {
  const file = path.join(commonDir, 'task-progress', task, 'outbox.json');
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked original attempt progress refused');
    if (cursor === path.dirname(cursor)) break;
  }
  if (!existsSync(file)) return null;
  assert.ok(lstatSync(file).isFile() && (lstatSync(file).mode & 0o077) === 0);
  const bytes = readFileSync(file),
    state = JSON.parse(bytes);
  assert.equal(state.version, 1);
  assert.deepEqual(
    Object.keys(state).sort(),
    ['acknowledged', 'pending', 'tasks', 'version'],
    'Only the sealed initial outbox schema may retire',
  );
  assert.equal(state.acknowledged.length, 0, 'Applied progress requires ordinary reconciliation');
  assert.equal(
    (state.rejected ?? []).length + (state.retired ?? []).length,
    0,
    'Existing outcome needs its original recovery',
  );
  assert.ok(
    state.pending.length >= 1 && state.pending.length <= 2,
    'Only original initial queue/readiness projections may retire',
  );
  assert.deepEqual(Object.keys(state.tasks), [task]);
  assert.equal(state.tasks[task], state.pending.length);
  const actions = new Set();
  for (const [index, entry] of state.pending.entries()) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ['payload_hash', 'receipt', 'receipt_id', 'state'],
      'Unknown write metadata must remain blocking',
    );
    assert.equal(entry.state, 'pending');
    assert.equal(entry.revision, undefined, 'Prepared or unknown writes cannot retire');
    assert.equal(entry.failure, undefined, 'Failed or unknown writes cannot retire');
    const receipt = entry.receipt;
    assert.deepEqual(
      Object.keys(receipt).sort(),
      ['action', 'event', 'evidence_refs', 'next', 'observed_at', 'receipt_id', 'sequence', 'task_id', 'version'],
      'Only original initial progress payloads may retire',
    );
    assert.equal(receipt.version, 1);
    assert.equal(receipt.task_id, task);
    assert.equal(receipt.receipt_id, entry.receipt_id);
    assert.equal(receipt.sequence, index + 1);
    assert.equal(receipt.stage_fact, undefined);
    assert.ok(['queued', 'paused'].includes(receipt.event));
    const action = receipt.action?.id;
    assert.ok(!actions.has(action));
    actions.add(action);
    let source;
    if (action === 'queue:development') {
      assert.deepEqual(receipt.action, { id: 'queue:development', label: 'development' });
      assert.equal(receipt.evidence_refs?.length, 1);
      const match = receipt.evidence_refs[0].match(/^execution-order:([1-9][0-9]*):development:([a-z0-9-]+)$/);
      assert.equal(match?.[2], task);
      source = `queue:${match[1]}:development`;
    } else {
      assert.equal(action, 'receive');
      assert.deepEqual(receipt.action, { id: 'receive', label: '原生创建／绑定仍在等待核验' });
      assert.equal(receipt.event, 'queued');
      assert.deepEqual(receipt.evidence_refs, [`published-native-host:receive:${task}:${record.messageId}`]);
      // The initial receive source key includes the read-back status/reason.
      // Preserve its sealed identity; it cannot authorize any new fact.
    }
    if (source) assert.equal(entry.receipt_id, jsonHash([task, source]));
    const payload = { ...receipt };
    for (const field of ['version', 'task_id', 'receipt_id', 'sequence']) delete payload[field];
    assert.equal(entry.payload_hash, jsonHash(payload), 'Original receipt payload changed');
  }
  assert.equal(
    typeof host.readCreationProgress,
    'function',
    'Fresh native per-receipt readback and full history required',
  );
  const observations = await host.readCreationProgress(
    task,
    state.pending.map((entry) => entry.receipt_id),
  );
  validateUnsubmittedCreationObservations(task, state.pending, board, observations);
  assert.equal(hash(readFileSync(file)), hash(bytes), 'Progress changed during native observation');
  return {
    version: 1,
    kind: 'never-submitted-failed-creation-projections',
    task,
    originalAttempt: record.createRequestId,
    bytes: bytes.toString('base64'),
    sha256: hash(bytes),
    entries: state.pending,
    lastSequence: state.tasks[task],
    observations,
  };
}
export function validateUnsubmittedCreationObservations(task, entries, board, observations) {
  assert.equal(observations.receipts.length, entries.length);
  assert.ok(
    Array.isArray(observations.history) && observations.history.length === board.revision,
    'Complete actual board history required',
  );
  const snapshots = observations.history
    .map((event) => {
      assert.equal(event.task_id, task);
      return typeof event.snapshot === 'string' ? JSON.parse(event.snapshot) : event.snapshot;
    })
    .sort((a, b) => a.revision - b.revision);
  snapshots.forEach((snapshot, index) => {
    assert.equal(snapshot.id, task);
    assert.equal(snapshot.revision, index + 1);
    assert.equal(snapshot.status, 'active', 'Historical business stage prevents unstarted-attempt closure');
    assert.ok(
      !snapshot.deleted_at && !snapshot.completed_at && [undefined, null, 'active'].includes(snapshot.card_stage),
    );
    const receipt = snapshot.progress_receipt?.receipt;
    assert.ok(
      !receipt || (['queued', 'paused'].includes(receipt.event) && !Object.hasOwn(receipt, 'stage_fact')),
      'Work progress already exists in native history',
    );
  });
  assert.equal(board.status, 'active');
  for (const field of ['id', 'revision', 'status', 'created_at', 'updated_at', 'current_work', 'next_step'])
    assert.deepEqual(snapshots.at(-1)[field], board[field], 'Native history and current board differ');
  for (const entry of entries) {
    const seen = observations.receipts.find((result) => result.receipt_id === entry.receipt_id);
    assert.equal(seen?.version, 1);
    assert.equal(seen.outcome, 'not_found');
    assert.equal(seen.receipt, null);
    assert.equal(seen.applied_revision, null);
    for (const field of ['id', 'revision', 'status', 'created_at', 'updated_at', 'current_work', 'next_step'])
      assert.deepEqual(seen.task[field], board[field]);
    assert.ok(
      snapshots.every(
        (snapshot) =>
          snapshot.progress_receipt?.receipt?.receipt_id !== entry.receipt_id &&
          snapshot.progress_receipt?.receipt_id !== entry.receipt_id,
      ),
      'Original receipt was applied',
    );
  }
}
