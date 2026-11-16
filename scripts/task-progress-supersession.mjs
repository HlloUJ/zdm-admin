import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// Exact published417 v35 contract: full task_history (no LIMIT), numeric revisions,
// receipt snapshots do not form manualBarrier. This is not a generic error-policy override.
export const STALE_PROTOCOL = '417-v35-stale-code-terminal-v1';
export function validateProgressHistory(entry, evidence) {
  assert.equal(evidence.contract, STALE_PROTOCOL);
  assert.equal(evidence.operation, 'task_history');
  assert.equal(evidence.task, entry.receipt.task_id);
  const seen = evidence.current;
  assert.equal(seen.task_id, entry.receipt.task_id);
  assert.equal(seen.receipt_id, entry.receipt_id);
  assert.equal(seen.status, 'not_found');
  assert.equal(seen.receipt, null);
  assert.equal(seen.task.id, seen.task_id);
  assert.ok(Number.isSafeInteger(seen.revision) && seen.revision > 0);
  assert.equal(seen.task.revision, seen.revision);
  assert.ok(
    Array.isArray(evidence.events) && evidence.events.length === seen.revision,
    'Complete revision history required',
  );
  const snapshots = evidence.events
    .map((event) => {
      assert.equal(event.task_id, seen.task_id);
      const snapshot = typeof event.snapshot === 'string' ? JSON.parse(event.snapshot) : event.snapshot;
      assert.equal(snapshot.id, seen.task_id);
      return snapshot;
    })
    .sort((a, b) => a.revision - b.revision);
  snapshots.forEach((snapshot, index) => assert.equal(snapshot.revision, index + 1, 'History revision gap/duplicate'));
  const latest = snapshots.at(-1);
  for (const field of ['id', 'revision', 'status', 'updated_at', 'created_at', 'current_work', 'next_step'])
    assert.deepEqual(latest[field], seen.task[field], 'History and current task differ: ' + field);
  const records = snapshots.map((snapshot) => snapshot.progress_receipt).filter(Boolean);
  assert.ok(
    records.every((record) => record.receipt?.receipt_id !== entry.receipt_id),
    'Old receipt was applied; reconcile exact acknowledgement instead',
  );
  const times = snapshots
    .filter((snapshot) => !snapshot.progress_receipt)
    .map((snapshot) => Date.parse(snapshot.updated_at))
    .filter(Number.isFinite);
  const manualBarrier = Math.max(
    ...times,
    Date.parse(seen.task.created_at) || 0,
    records.length ? 0 : Date.parse(seen.task.updated_at) || 0,
  );
  const observed = Date.parse(entry.receipt.observed_at);
  assert.ok(Number.isFinite(observed));
  assert.ok(observed < manualBarrier, 'Receipt is not superseded by a newer manual observation');
  return { revision: seen.revision, manualBarrier, observed, applied: false };
}
export function validateClosedSupersession(entry, proof) {
  assert.equal(entry.revision, undefined, 'Prepared unknown writes are not unsubmitted facts');
  assert.equal(entry.failure, undefined, 'Failed/unknown writes stay blocking');
  const source = proof.closedSource;
  assert.equal(source.batch, entry.receipt.task_id);
  assert.equal(source.formalDeliveryComplete, true);
  assert.match(source.main ?? '', /^[a-f0-9]{40}$/);
  assert.match(source.sourceReceiptDigest ?? '', /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(source.closedAt)));
  assert.ok(Number.isFinite(Date.parse(source.observed_at)), 'Fresh formal source observation required');
  const result = validateProgressHistory(entry, proof.historyEvidence);
  assert.equal(
    proof.historyEvidence.current.task.status,
    'done',
    'Only formal done projection supersedes unsubmitted closeout facts',
  );
  assert.deepEqual(proof.readback, proof.historyEvidence.current);
  return result;
}
export function validateRecordedClientStale(entry, proof) {
  assert.equal(entry.failure?.code, 'stale_receipt');
  assert.equal(entry.failure.retryable, false);
  assert.ok(Number.isSafeInteger(entry.revision) && entry.revision > 0);
  assert.equal(proof.clientEvidence.contract, 'published-progress-outbox-terminal-v1');
  const bytes = Buffer.from(proof.clientEvidence.bytes, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), proof.clientEvidence.digest);
  const report = proof.clientEvidence.report;
  assert.deepEqual(JSON.parse(bytes), report);
  assert.equal(proof.clientEvidence.originalProviderResponse, 'not-retained');
  assert.equal(report.task, entry.receipt.task_id);
  assert.equal(report.status, 'needs-attention');
  assert.ok(typeof report.runId === 'string' && Number.isFinite(Date.parse(report.checkedAt)));
  assert.ok(
    report.outboxes.some(
      (box) =>
        box.directory === proof.clientEvidence.outboxDirectory &&
        box.receipts.some((receipt) => receipt.receipt_id === entry.receipt_id && receipt.status === 'pending'),
    ),
    'Recorded host did not retain this pending receipt',
  );
  validateProgressHistory(entry, proof.historyEvidence);
  assert.deepEqual(proof.readback, proof.historyEvidence.current);
}

// One explicit repair case. Invalid is not stale and is never acknowledged or retried as the old packet.
export function validateTerminalInvalidSupersession(entry, proof) {
  assert.equal(proof.kind, 'terminal-invalid-with-supersession');
  assert.equal(entry.failure?.code, 'invalid_receipt');
  assert.equal(entry.failure.retryable, false);
  assert.ok(Number.isSafeInteger(entry.revision) && entry.revision > 0);
  assert.equal(entry.receipt.stage_fact?.kind, 'begin_delivery');
  assert.equal(entry.receipt.event, 'started');
  const client = proof.clientEvidence,
    bytes = Buffer.from(client.bytes, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), client.digest);
  assert.deepEqual(JSON.parse(bytes), client.report);
  assert.equal(client.report.task, entry.receipt.task_id);
  assert.equal(client.report.sourceKind, 'recorded-client-terminal-invalid');
  assert.equal(client.report.originalProviderResponse, 'not-retained');
  assert.deepEqual(client.report.entry, entry, 'Original invalid packet/client failure changed');
  assert.ok(Date.parse(client.report.observedAt) >= Date.parse(entry.receipt.observed_at));
  validateProgressHistory(entry, proof.historyEvidence);
  assert.deepEqual(proof.readback, proof.historyEvidence.current);
  assert.ok(proof.readback.revision >= entry.revision);
  const original = proof.historyEvidence.events
    .map((event) => (typeof event.snapshot === 'string' ? JSON.parse(event.snapshot) : event.snapshot))
    .find((snapshot) => snapshot.revision === entry.revision);
  assert.equal(
    original?.card_stage ?? original?.status,
    'active',
    'Only the proved missing-review transition may be superseded',
  );
  const repair = proof.repairSource;
  assert.equal(repair?.verified, true);
  assert.equal(repair.task, entry.receipt.task_id);
  assert.match(repair.candidate ?? '', /^[a-f0-9]{40}$/);
  assert.match(repair.evidenceDigest ?? '', /^[a-f0-9]{64}$/);
  assert.equal(repair.assessment?.noKnownDefects, true);
  assert.equal(repair.assessment.task, repair.task);
  assert.equal(repair.assessment.owner, repair.owner);
  assert.equal(repair.assessment.head, repair.candidate);
  assert.ok(Number.isFinite(Date.parse(repair.assessment.observedAt)));
}
