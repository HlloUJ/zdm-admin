import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { readTaskCoordination } from '../task-coordination.mjs';
import { scopedAdmissions } from '../task-execution-scope.mjs';

export const task039 = 'unsubmitted-paused-progress-correction';
export const task417 = 'task-delivery-status-sync';
export const retirement039 = 'retired-delivery-pause-not-delivered';
export const receipts039 = Object.freeze([
  Object.freeze({
    id: 'c035a429935291a9149e41996bda3102edd18702804f6e78dbdb28fa7eea870d',
    sequence: 6,
    digest: '39221bf9f460e3464a180982a2f6e1930839b46723da515226aa1420a0af3e8e',
    event: 'delivery-phase-enrolled',
    eventDigest: '4a71a81599bfacb790bda5640649fb0411add26092a0a4cd1ba8442004ab8135',
  }),
  Object.freeze({
    id: '252563e7532ef958635bcae48437c17e140ed4789698f9ce64bea322b5605c26',
    sequence: 19,
    digest: '13ff04310b6ba9eac2865e7fa6b3f4f58d8fde41fadbc340a56cd9b497c8075f',
    event: 'preparation-finished',
    eventDigest: 'ab00af32117d74f0873b134da087e7299f7b5520d51f3339ce4fa67e23624b18',
  }),
]);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hash = (value) => sha256(JSON.stringify(value));
const phaseId = 'c542f2c0-b170-40f0-b820-c7cc774276cb';
const decisionId = '70409e47-c11f-498e-ba07-311eaf6c42c7';
const sourceHead = '98cf1b8a707fdf1181259a5e0f2260fdf5d43f10';
const taskHead = '89250f58bb268e0a7748a6b423f60b5965407423';
export function readPrivate039(file) {
  for (let parent = file; ; parent = path.dirname(parent)) {
    if (existsSync(parent)) assert.ok(!lstatSync(parent).isSymbolicLink(), 'Linked 039 evidence refused');
    if (parent === path.dirname(parent)) break;
  }
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= 16 * 1024 * 1024);
  return readFileSync(file);
}
export function validate039Packets(state) {
  assert.equal(state.version, 1);
  const entries = receipts039.map(({ id, digest }) => {
    assert.ok(
      ![...state.acknowledged, ...(state.rejected ?? []), ...(state.retired ?? [])].some((e) => e.receipt_id === id),
    );
    const matches = state.pending.filter((e) => e.receipt_id === id);
    assert.equal(matches.length, 1, 'Exact pending 039 packet required');
    const [entry] = matches;
    assert.ok(
      !Object.hasOwn(entry, 'revision') && !Object.hasOwn(entry, 'failure'),
      'Prepared or uncertain writes stay pending',
    );
    assert.equal(hash(entry), digest, 'Original 039 packet changed');
    return entry;
  });
  assert.equal(state.pending[0].receipt_id, receipts039[0].id);
  const end = state.pending.findIndex((e) => e.receipt_id === receipts039[1].id);
  assert.deepEqual(
    state.pending.slice(1, end).map((e) => e.receipt.sequence),
    Array.from({ length: 12 }, (_, i) => i + 7),
  );
  assert.ok(
    state.pending
      .slice(1, end)
      .every((e) => e.receipt.task_id === task039 && ['started', 'completed'].includes(e.receipt.event)),
  );
  return entries;
}
export function collect039Source(commonDir, coordinatorThreadId, queue, registry) {
  const ledger = queue.read();
  assert.ok(ledger.revision >= 139 && ledger.paused);
  assert.ok(
    !scopedAdmissions(ledger).some((scope) => scope.task === task039),
    '039 must be between preparation and final',
  );
  assert.ok(
    !ledger.dynamicDecisions.some((d) => d.input.task === task039 && d.status === 'reserved'),
    '039 has a reserved dispatch',
  );
  const events = receipts039.map(({ event, eventDigest }) => {
    const matches = ledger.events.filter((e) => e.action === event && e.task === task039 && hash(e) === eventDigest);
    assert.equal(matches.length, 1, 'Original 039 queue event missing');
    return matches[0];
  });
  const [enrolled, finished] = events;
  const ticket = ledger.tickets.find((t) => t.task === task039 && t.lane === 'delivery');
  const development = ledger.tickets.find((t) => t.task === task039 && t.lane === 'development');
  const phase = ticket?.phaseOrigin;
  assert.equal(ticket?.status, 'queued');
  assert.equal(ticket.admission, null);
  assert.equal(phase?.phaseId, phaseId);
  assert.equal(phase.input.expectedQueueRevision, 134);
  assert.equal(phase.input.expectedBoardRevision, 6);
  assert.equal(phase.sourceProof.development.ownership.originMain, sourceHead);
  assert.equal(hash(phase), enrolled.phaseDigest);
  assert.equal(hash(development), phase.developmentTicketDigest);
  assert.equal(development.status, 'completed');
  assert.equal(development.completion.digest, phase.developmentEvidenceDigest);
  const decision = ledger.dynamicDecisions.find((d) => d.id === decisionId);
  assert.equal(finished.decisionId, decisionId);
  assert.equal(decision?.status, 'finished');
  assert.equal(decision.input.phase, 'preparation');
  assert.equal(decision.input.authorityId, phase.authorityId);
  assert.deepEqual(decision.ticketBefore, ticket);
  assert.equal(decision.prepared.head, taskHead);
  const authority = ledger.dynamicAuthorities.find((a) => a.id === phase.authorityId);
  assert.ok(authority?.source?.tasks?.some((t) => t.task === task039 && t.owner === ticket.owner));
  assert.deepEqual(authority.request, enrolled.request);
  assert.deepEqual(authority.request, finished.request);
  assert.equal(authority.request.authorId, ticket.request.authorId);
  const fence = ledger.events.findLast((e) => ['initialize', 'pause-all'].includes(e.action));
  assert.equal(fence.request.authorId, authority.request.authorId);
  assert.ok(fence.request.sequence < authority.request.sequence, 'A later user pause requires separate handling');
  const task = registry.readTask(task039);
  assert.equal(task.id, task039);
  assert.equal(task.owner, ticket.owner);
  assert.equal(task.recordedHead, taskHead);
  assert.equal(task.frozen?.accepted, decision.prepared.accepted);
  const current = readTaskCoordination(commonDir);
  assert.equal(current?.current.rootThreadId, coordinatorThreadId);
  assert.equal(current.current.request.authorId, authority.request.authorId);
  return { task, ticket, development, events, decision, authority, fence, coordinator: current.current };
}

// Match the released Site's canonical receipt payload byte for byte.
function canonicalReceiptPayload(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalReceiptPayload).join(',') + ']';
  if (value && typeof value === 'object') {
    const fields = Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalReceiptPayload(value[key]));
    return '{' + fields.join(',') + '}';
  }
  return JSON.stringify(value);
}

export function validate039Board({ history, receipts, readAppliedReceipt }, board) {
  assert.equal(board?.id, task039);
  assert.equal(board.status, 'review');
  assert.equal(board.board_column, 'review');
  assert.equal(board.deleted_at, null);
  assert.ok(Number.isSafeInteger(board.revision) && board.revision >= 6);
  assert.equal(history.length, board.revision, 'Complete native board history required');
  const rows = history
    .map((event) => {
      assert.equal(event.task_id, task039);
      const row = typeof event.snapshot === 'string' ? JSON.parse(event.snapshot) : event.snapshot;
      assert.equal(row.id, task039);
      assert.ok(
        !receipts039.some(({ id }) => id === row.progress_receipt?.receipt?.receipt_id),
        '039 packet was applied',
      );
      return row;
    })
    .sort((a, b) => a.revision - b.revision);
  rows.forEach((row, i) => assert.equal(row.revision, i + 1, 'Native history gap or duplicate'));
  assert.equal(rows[5].status, 'review');
  const overview = { ...board };
  delete overview.board_column;
  const latest = rows.at(-1);
  const snapshot = { ...latest };
  let appliedReceiptId = null;
  if (Object.hasOwn(latest, 'progress_receipt')) {
    const record = latest.progress_receipt;
    assert.ok(record && typeof record === 'object' && !Array.isArray(record), 'Malformed historical receipt record');
    assert.deepEqual(Object.keys(record).sort(), ['payload', 'receipt']);
    const { payload, receipt } = record;
    assert.equal(receipt?.task_id, task039);
    assert.equal(receipt.version, 1);
    assert.ok(typeof receipt.receipt_id === 'string' && receipt.receipt_id.trim());
    assert.equal(typeof readAppliedReceipt, 'function', 'Independent applied receipt observation required');
    const applied = readAppliedReceipt(receipt.receipt_id);
    assert.equal(applied?.version, 1);
    assert.equal(applied.receipt_id, receipt.receipt_id, 'Independent applied receipt identity differs');
    assert.equal(applied.outcome, 'applied');
    assert.equal(applied.applied_revision, latest.revision, 'Historical receipt was applied at a different revision');
    assert.deepEqual(applied.task, board, 'Applied receipt and exact current board disagree');
    assert.deepEqual(applied.receipt, receipt, 'Independent applied receipt differs from history');
    assert.equal(payload, canonicalReceiptPayload(applied.receipt), 'Original historical receipt payload bytes differ');
    appliedReceiptId = receipt.receipt_id;
    delete snapshot.progress_receipt;
  }
  assert.deepEqual(snapshot, overview, 'Full history and exact current board disagree');
  assert.equal(receipts.length, receipts039.length);
  receipts.forEach((seen, i) => {
    assert.equal(seen.receipt_id, receipts039[i].id);
    assert.equal(seen.outcome, 'not_found');
    assert.equal(seen.receipt, null);
    assert.equal(seen.applied_revision, null);
    assert.deepEqual(seen.task, board);
  });
  return appliedReceiptId;
}
export function verify039ClientTransport(raw, input) {
  assert.deepEqual(
    input,
    {
      outcome: 'never-prepared-no-unknown-write',
      outboxSha256: sha256(raw),
      receiptIds: receipts039.map(({ id }) => id),
    },
    'Exact current coordinator transport assessment required',
  );
}

const receiptIds = receipts039.map(({ id }) => id);
const isTarget = (entry) => receiptIds.includes(entry.receipt_id);

function readRetirement(file, state) {
  const records = (state.retired ?? []).filter(isTarget);
  if (!records.length) return null;
  assert.equal(records.length, receiptIds.length, 'Partial 039 retirement refused');
  assert.ok(![...state.pending, ...state.acknowledged, ...(state.rejected ?? [])].some(isTarget));
  const bytes = readPrivate039(file);
  const digest = sha256(bytes),
    audit = JSON.parse(bytes);
  assert.equal(audit.status, retirement039);
  const raw = Buffer.from(audit.originalOutbox.bytes, 'base64');
  assert.equal(sha256(raw), audit.originalOutbox.sha256);
  assert.deepEqual(audit.entries, validate039Packets(JSON.parse(raw)));
  assert.deepEqual(records, retirementRecords(audit.entries, file, digest));
  return { status: retirement039, records, auditDigest: digest, replay: true };
}
function retirementRecords(entries, file, digest) {
  return entries.map((entry) => ({ ...entry, state: retirement039, audit: file, auditDigest: digest }));
}
function writeDurable(directory, file, content) {
  const pending = file + '.' + randomUUID() + '.tmp';
  const fd = openSync(pending, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(content) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(pending, file);
  const parent = openSync(directory, 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
function exactObservation(native, operation, args, checkedAt) {
  const matches = native.filter(
    (value) =>
      value.operation === operation &&
      Object.keys(value.args ?? {}).length === Object.keys(args).length &&
      Object.entries(args).every(([key, val]) => value.args[key] === val),
  );
  assert.equal(matches.length, 1, 'One exact native board observation required');
  const { provider, observedAt, result } = matches[0];
  const age = Date.parse(checkedAt) - Date.parse(observedAt);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= 60_000, 'Fresh native board observation required');
  assert.equal(provider, 'codex-native-task-board');
  assert.equal(result.isError ?? false, false);
  assert.equal(result.content?.length, 1);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}
export function nativeBoardProof(observations, checkedAt) {
  assert.ok([4, 5].includes(observations?.length), 'Unexpected native observation count');
  const args = { id: task039 };
  const board = exactObservation(observations, 'get_task_by_id', args, checkedAt);
  const history = exactObservation(observations, 'task_history', args, checkedAt);
  const receipts = receiptIds.map((receipt_id) =>
    exactObservation(observations, 'get_task_progress_receipt', { ...args, receipt_id }, checkedAt),
  );
  const appliedReceiptId = validate039Board(
    {
      history,
      receipts,
      readAppliedReceipt: (receipt_id) =>
        exactObservation(observations, 'get_task_progress_receipt', { ...args, receipt_id }, checkedAt),
    },
    board,
  );
  assert.equal(
    observations.length,
    appliedReceiptId === null ? 4 : 5,
    'Unexpected observation for a revision without an applied receipt',
  );
  return board;
}

// This case-specific transaction uses the same exclusive lock as the regular
// outbox publisher. No generic archive or server operation is exposed.
export async function correct039DeliveryPause(input, { registry, queue, dependenciesReady, now = Date.now }) {
  const { coordinatorThreadId, taskId, clientTransport, nativeObservations, coordinatorObservation, ...extra } = input;
  assert.deepEqual(extra, {});
  assert.equal(taskId, task039);
  assert.equal(process.env.CODEX_THREAD_ID, coordinatorThreadId, 'Actual current coordinator required');
  const { commonDir } = registry;
  assert.equal(queue.commonDir, commonDir);
  assert.equal(readTaskCoordination(commonDir)?.current.rootThreadId, coordinatorThreadId);
  assert.equal(await dependenciesReady({ dependsOn: [task417] }), true, '417 formal closure required');
  assert.equal(coordinatorObservation.provider, 'codex-native-read_thread');
  assert.equal(coordinatorObservation.snapshot.thread.id, coordinatorThreadId);
  assert.equal(coordinatorObservation.snapshot.thread.hostId, 'local');
  const time = now(),
    checkedAt = new Date(time).toISOString();
  const age = time - Date.parse(coordinatorObservation.observedAt);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= 60_000, 'Fresh native coordinator required');
  const directory = path.join(commonDir, 'task-progress', task039);
  const file = path.join(directory, 'outbox.json');
  const auditFile = path.join(directory, 'delivery-pause-039-q135-q139.json');
  const raw = readPrivate039(file);
  const prior = readRetirement(auditFile, JSON.parse(raw));
  if (prior) return prior;
  verify039ClientTransport(raw, clientTransport);
  const entries = validate039Packets(JSON.parse(raw));
  const source = collect039Source(commonDir, coordinatorThreadId, queue, registry);
  const board = nativeBoardProof(nativeObservations, checkedAt);
  const originalOutbox = { bytes: raw.toString('base64'), sha256: sha256(raw) };
  return queue.guard(() => {
    const lock = path.join(directory, 'outbox.lock');
    writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
    try {
      const current = readPrivate039(file),
        state = JSON.parse(current);
      const replay = readRetirement(auditFile, state);
      if (replay) return replay;
      assert.deepEqual(current, raw, '039 outbox changed during observation');
      assert.deepEqual(
        collect039Source(commonDir, coordinatorThreadId, queue, registry),
        source,
        '039 source changed during observation',
      );
      const archive = {
        version: 1,
        status: retirement039,
        entries,
        originalOutbox,
        source,
        board,
        nativeObservations,
        checkedAt,
        clientTransport,
        coordinatorObservation,
      };
      if (!existsSync(auditFile)) writeDurable(directory, auditFile, archive);
      const auditBytes = readPrivate039(auditFile),
        retained = JSON.parse(auditBytes);
      assert.equal(retained.status, retirement039);
      assert.deepEqual(retained.originalOutbox, originalOutbox, 'Interrupted archive belongs to different bytes');
      assert.deepEqual(retained.entries, entries);
      assert.deepEqual(retained.source, source);
      assert.deepEqual(nativeBoardProof(retained.nativeObservations, retained.checkedAt), retained.board);
      verify039ClientTransport(raw, retained.clientTransport);
      const digest = sha256(auditBytes);
      const records = retirementRecords(entries, auditFile, digest);
      (state.retired ??= []).push(...records);
      state.pending = state.pending.filter((entry) => !isTarget(entry));
      writeDurable(directory, file, state);
      return { status: retirement039, records, auditDigest: digest, replay: false };
    } finally {
      unlinkSync(lock);
    }
  });
}
