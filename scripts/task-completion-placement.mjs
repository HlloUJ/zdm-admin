import assert from 'node:assert/strict';
import path from 'node:path';
import {
  createProgressOutbox,
  progressSourceIdentity,
  confirmCurrentBoardProjection,
} from './task-progress-outbox.mjs';
import { recordToolProgress } from './task-delivery-status-sync.mjs';

export function beginDeliveryFact({ task, ticket, acceptance, event, observedAt }) {
  assert.equal(ticket.lane, 'delivery');
  assert.equal(ticket.task, task.id);
  assert.equal(ticket.owner, task.owner);
  assert.equal(ticket.status, 'running');
  assert.ok(ticket.request?.messageId);
  assert.equal(acceptance.batch, task.id);
  assert.equal(task.frozen?.accepted, acceptance.commit);
  assert.match(acceptance.commit, /^[a-f0-9]{40}$/);
  assert.equal(event.name, 'prepare');
  assert.equal(event.status, 'running');
  return {
    observed_at: observedAt ?? new Date(event.startedAt).toISOString(),
    action: { id: 'delivery:' + event.id, label: '正式交付' },
    event: 'started',
    evidence_refs: ['accepted-source:' + acceptance.commit, 'execution-order:' + ticket.request.messageId],
    next: { kind: 'action', label: '执行正式交付' },
    stage_fact: {
      kind: 'begin_delivery',
      delivery_kind: 'project_main',
      conditions: { delivery_authorized: true, delivery_registered: true },
      references: {
        instruction: ticket.request.messageId,
        delivery_registration: 'execution-order:delivery:' + task.id + ':' + ticket.request.messageId,
      },
    },
  };
}
export function completeDeliveryFact(task, source) {
  assert.equal(source.batch, task);
  assert.equal(source.formalDeliveryComplete, true);
  assert.match(source.main ?? '', /^[a-f0-9]{40}$/);
  assert.match(source.sourceReceiptDigest ?? '', /^[a-f0-9]{64}$/);
  const ref = 'completion-receipt:' + source.sourceReceiptDigest;
  return {
    observed_at: source.observed_at,
    action: { id: 'delivery-complete:' + source.sourceReceiptDigest, label: '正式交付完成' },
    event: 'completed',
    evidence_refs: [ref, 'main:' + source.main],
    next: { kind: 'none' },
    stage_fact: {
      kind: 'delivery_complete',
      conditions: { merged: true, main_ci_passed: true, handoff_complete: true, closeout_complete: true },
      references: {
        merge: 'main:' + source.main,
        main_ci: ref + ':ci',
        handoff: ref + ':handoff',
        closeout: ref + ':close',
      },
    },
  };
}
export function recordBeginPlacement(directory, task, sources) {
  return recordToolProgress(directory, task, 'placement:begin:' + sources.event.id, beginDeliveryFact(sources));
}
export async function recordCompletePlacement({ directory, task, readClosedSource }, adapter) {
  const source = await readClosedSource();
  const payload = completeDeliveryFact(task, source),
    key = 'placement:complete:' + source.sourceReceiptDigest;
  const box = createProgressOutbox(directory),
    id = progressSourceIdentity(task, key);
  const existing = [...box.read().pending, ...box.read().acknowledged, ...(box.read().rejected ?? [])].find(
    (entry) => entry.receipt_id === id,
  );
  if (existing) return { state: existing.state, receipt_id: id };
  const seen = await adapter.read(task, id, { signal: AbortSignal.timeout(5000) });
  if (seen.task.status === 'done') {
    assert.equal(seen.task.board_column, 'done');
    return confirmCurrentBoardProjection(
      {
        directory,
        task,
        receiptId: id,
        observeCurrent: async () => ({
          task,
          observed_at: source.observed_at,
          evidence_refs: payload.evidence_refs,
          expected: {
            status: 'done',
            board_column: 'done',
            current_work: seen.task.current_work,
            next_step: seen.task.next_step,
          },
        }),
      },
      adapter,
    );
  }
  assert.equal(seen.task.board_column, 'merging', 'Completed source cannot skip an unrecorded delivery card');
  const record = recordToolProgress(directory, task, key, payload);
  return {
    state: record.state,
    receipt_id: record.receipt_id,
    sourceReceiptDigest: source.sourceReceiptDigest,
    evidence: path.join(directory, 'outbox.json'),
  };
}

export function developmentReadyFact({ task, source, observedAt, event }) {
  assert.equal(source.verified, true);
  assert.equal(source.task, task.id);
  assert.equal(source.owner, task.owner);
  assert.equal(source.assessment.noKnownDefects, true);
  assert.match(source.candidate, /^[a-f0-9]{40}$/);
  assert.match(source.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(observedAt)));
  return {
    observed_at: observedAt,
    action: { id: 'development-ready:' + event.id, label: '开发完成并验证' },
    event: 'completed',
    evidence_refs: [
      'development-evidence:' + source.evidenceDigest,
      'candidate:' + source.candidate,
      'verified-source:' + source.sourceHead,
    ],
    next: { kind: 'action', label: '接续已获授权的正式交付' },
    stage_fact: {
      kind: 'development_ready',
      conditions: { development_complete: true, verification_passed: true, no_known_defects: true },
      references: { candidate: source.candidate, verification: 'development-evidence:' + source.evidenceDigest },
    },
  };
}
function placementEntry(box, task, key) {
  const id = progressSourceIdentity(task, key);
  return [...box.read().pending, ...box.read().acknowledged, ...(box.read().rejected ?? [])].find(
    (entry) => entry.receipt_id === id,
  );
}
async function confirmedPlacement(box, adapter, task, entry, column) {
  const confirmed = box.read().acknowledged.find((record) => record.receipt_id === entry.receipt_id);
  assert.ok(confirmed, 'Placement receipt remains undelivered');
  const read = await adapter.read(task, entry.receipt_id, { signal: AbortSignal.timeout(5000) });
  assert.ok(['applied', 'duplicate'].includes(read.status));
  assert.deepEqual(read.receipt, entry.receipt);
  assert.equal(read.task.id, task);
  assert.equal(read.task.board_column, column);
  assert.equal(read.task.status, column);
  return read;
}
// A real next-card transition is confirmed before the next fact is created.
// No manufactured review, old timestamp refresh, annotation clearing or source execution on failure.
export async function ensureDeliveryPlacement(
  { directory, task, ticket, acceptance, event, readDevelopmentSource, drain, now = Date.now },
  adapter,
) {
  const source = await readDevelopmentSource();
  assert.equal(source.verified, true);
  assert.equal(source.task, task.id);
  assert.equal(source.owner, task.owner);
  assert.equal(source.assessment.noKnownDefects, true);
  beginDeliveryFact({ task, ticket, acceptance, event }); // Validate delivery eligibility before any transport.
  const box = createProgressOutbox(directory);
  const probe = progressSourceIdentity(task.id, 'placement-observe:' + event.id);
  let seen = await adapter.read(task.id, probe, { signal: AbortSignal.timeout(5000) });
  assert.equal(seen.task?.id, task.id);
  assert.ok(!seen.task.deleted_at);
  assert.ok(
    ['active', 'review', 'merging'].includes(seen.task.status),
    'Paused/blocked/done task cannot be moved by delivery host',
  );
  await drain();
  assert.equal(box.read().pending.length, 0, 'Earlier unresolved receipt blocks placement');
  seen = await adapter.read(task.id, probe, { signal: AbortSignal.timeout(5000) });
  assert.equal(seen.task?.id, task.id);
  assert.ok(!seen.task.deleted_at);
  assert.ok(
    ['active', 'review', 'merging'].includes(seen.task.status),
    'Paused/blocked/done task cannot be moved by delivery host',
  );
  if (seen.task.board_column === 'merging')
    return { state: 'current-merging-confirmed-no-write', revision: seen.task.revision };
  if (seen.task.board_column === 'active') {
    const key = 'placement:development-ready:' + event.id + ':' + source.evidenceDigest;
    const entry =
      placementEntry(box, task.id, key) ??
      recordToolProgress(
        directory,
        task.id,
        key,
        developmentReadyFact({ task, source, event, observedAt: new Date(now()).toISOString() }),
      );
    await drain();
    seen = await confirmedPlacement(box, adapter, task.id, entry, 'review');
  }
  assert.equal(seen.task.board_column, 'review', 'Cannot skip the development review card');
  assert.equal(seen.task.status, 'review');
  const key = 'placement:begin:' + event.id;
  const entry =
    placementEntry(box, task.id, key) ??
    recordToolProgress(
      directory,
      task.id,
      key,
      beginDeliveryFact({ task, ticket, acceptance, event, observedAt: new Date(now()).toISOString() }),
    );
  await drain();
  const read = await confirmedPlacement(box, adapter, task.id, entry, 'merging');
  return {
    state: 'confirmed',
    receipt_id: entry.receipt_id,
    revision: read.revision,
    developmentEvidence: source.evidenceDigest,
  };
}
