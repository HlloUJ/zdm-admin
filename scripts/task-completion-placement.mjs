import assert from 'node:assert/strict';
import path from 'node:path';
import {
  createProgressOutbox,
  progressSourceIdentity,
  confirmCurrentBoardProjection,
} from './task-progress-outbox.mjs';
import { recordToolProgress } from './task-delivery-status-sync.mjs';

export function beginDeliveryFact({ task, ticket, acceptance, event }) {
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
    observed_at: new Date(event.startedAt).toISOString(),
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
