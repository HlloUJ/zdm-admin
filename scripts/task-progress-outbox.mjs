import {
  STALE_PROTOCOL,
  validateProgressHistory,
  validateClosedSupersession,
  validateRecordedClientStale,
  validateTerminalInvalidSupersession,
} from './task-progress-supersession.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';

const approvedRejections = new WeakSet();
const byteHash = (value) => createHash('sha256').update(value).digest('hex');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const progressSourceIdentity = (task, sourceKey) => hash([task, sourceKey]);
function safe(file) {
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked progress store refused');
    if (path.dirname(cursor) === cursor) break;
  }
}
// Local engineering evidence only. No network, production imports, workers, retries or queue ownership.
export function createProgressOutbox(directory, { capacity = 512 } = {}) {
  assert.ok(Number.isSafeInteger(capacity) && capacity > 0 && capacity <= 4096);
  const file = path.join(directory, 'outbox.json');
  const lock = path.join(directory, 'outbox.lock');
  function read() {
    safe(file);
    if (!existsSync(file)) return { version: 1, tasks: {}, pending: [], acknowledged: [] };
    const state = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(state.version, 1);
    return state;
  }
  function change(fn) {
    safe(file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
    try {
      const state = read();
      const result = fn(state);
      const temporary = file + '.' + randomUUID();
      writeFileSync(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
      return result;
    } finally {
      unlinkSync(lock);
    }
  }
  function enqueue(task, sourceKey, payload) {
    assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(typeof sourceKey === 'string' && sourceKey.length > 0);
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 16384, 'Receipt too large');
    const receipt_id = progressSourceIdentity(task, sourceKey);
    const payloadHash = hash(payload);
    return change((state) => {
      const existing = [...state.pending, ...state.acknowledged, ...(state.rejected ?? [])].find(
        (r) => r.receipt_id === receipt_id,
      );
      if (existing) {
        assert.equal(existing.payload_hash, payloadHash, 'Receipt identity reused with changed facts');
        if (
          [
            'rejected-not-delivered',
            'superseded-without-submission',
            'client-reported-stale-not-delivered',
            'terminal-invalid-with-supersession',
          ].includes(existing.state)
        ) {
          const bytes = readFileSync(existing.audit);
          assert.equal(byteHash(bytes), existing.auditDigest);
          return { ...JSON.parse(bytes).entry, state: existing.state };
        }
        return structuredClone(existing);
      }
      assert.ok(
        state.pending.length < capacity,
        'Progress outbox full; retain original source, do not drop pending facts',
      );
      const sequence = (state.tasks[task] ?? 0) + 1;
      state.tasks[task] = sequence;
      const receipt = { ...payload, version: 1, task_id: task, receipt_id, sequence };
      const entry = { receipt_id, payload_hash: payloadHash, receipt, state: 'pending' };
      state.pending.push(entry);
      return structuredClone(entry);
    });
  }
  function prepare(receiptId, revision) {
    assert.ok(Number.isSafeInteger(revision));
    return change((state) => {
      const entry = state.pending.find((item) => item.receipt_id === receiptId);
      assert.ok(entry);
      entry.revision ??= revision;
      return structuredClone(entry);
    });
  }
  function acknowledge(receiptId, readback) {
    return change((state) => {
      const index = state.pending.findIndex((entry) => entry.receipt_id === receiptId);
      assert.ok(index >= 0, 'Unknown pending receipt');
      assert.equal(readback.receipt_id, receiptId);
      assert.equal(readback.task_id, state.pending[index].receipt.task_id);
      assert.ok(['applied', 'duplicate'].includes(readback.status));
      assert.ok(Number.isSafeInteger(readback.revision));
      assert.deepEqual(readback.receipt, state.pending[index].receipt, 'Readback receipt content differs');
      assert.ok(Number.isSafeInteger(readback.applied_revision) && readback.applied_revision > 0);
      assert.ok(readback.applied_revision <= readback.revision);
      const [entry] = state.pending.splice(index, 1);
      entry.state = 'confirmed';
      entry.readback = readback;
      state.acknowledged.push(entry);
      state.acknowledged = state.acknowledged.slice(-capacity);
      return entry;
    });
  }
  function fail(receiptId, code, rejection = null) {
    assert.ok(typeof code === 'string' && /^[a-z0-9_-]{1,80}$/.test(code));
    return change((state) => {
      const entry = state.pending.find((item) => item.receipt_id === receiptId);
      assert.ok(entry, 'Unknown pending receipt');
      entry.failure = {
        code,
        retryable: ![
          'revision_conflict',
          'stale_receipt',
          'receipt_conflict',
          'task_paused',
          'invalid_receipt',
          'forbidden',
        ].includes(code),
      };
      if (rejection) entry.failure.rejection = structuredClone(rejection);
      return structuredClone(entry);
    });
  }
  function quarantineTerminal(receiptId, proof, { afterAudit = () => {} } = {}) {
    assert.ok(approvedRejections.has(proof), 'Authenticated owner rejection/readback required');
    return change((state) => {
      const prior = (state.rejected ?? []).find((item) => item.receipt_id === receiptId);
      if (prior) return structuredClone(prior);
      const index = state.pending.findIndex((item) => item.receipt_id === receiptId);
      assert.ok(index >= 0, 'Unknown pending stale receipt');
      const entry = state.pending[index];
      const superseded = proof.kind === 'superseded-without-submission',
        recorded = proof.kind === 'recorded-client-stale',
        invalid = proof.kind === 'terminal-invalid-with-supersession';
      const validate = invalid
        ? validateTerminalInvalidSupersession
        : superseded
          ? validateClosedSupersession
          : recorded
            ? validateRecordedClientStale
            : validateStaleProof;
      validate(entry, proof);
      if (recorded || invalid) assert.equal(proof.clientEvidence.outboxDirectory, directory);
      const auditDirectory = path.join(directory, 'rejected');
      safe(auditDirectory);
      mkdirSync(auditDirectory, { recursive: true, mode: 0o700 });
      const auditFile = path.join(auditDirectory, receiptId + '.json');
      safe(auditFile);
      const original = readFileSync(file);
      const audit = {
        version: 1,
        status: superseded
          ? 'superseded-without-submission'
          : invalid
            ? 'terminal-invalid-with-supersession'
            : recorded
              ? 'client-reported-stale-not-delivered'
              : 'rejected-not-delivered',
        entry: structuredClone(entry),
        entryDigest: hash(entry),
        originalOutbox: { bytes: original.toString('base64'), sha256: byteHash(original) },
        rejection: proof.rejection,
        readback: proof.readback,
        ...(superseded ? { kind: proof.kind, closedSource: proof.closedSource } : {}),
        ...(recorded || invalid ? { kind: proof.kind, clientEvidence: proof.clientEvidence } : {}),
        ...(invalid ? { repairSource: proof.repairSource } : {}),
        ...(proof.historyEvidence ? { historyEvidence: proof.historyEvidence } : {}),
      };
      if (existsSync(auditFile)) {
        const retained = JSON.parse(readFileSync(auditFile, 'utf8'));
        assert.equal(retained.entryDigest, hash(entry), 'Existing rejection audit differs');
        assert.deepEqual(retained.entry, entry);
        validate(entry, retained);
        assert.equal(byteHash(Buffer.from(retained.originalOutbox.bytes, 'base64')), retained.originalOutbox.sha256);
      } else {
        const fd = openSync(auditFile, 'wx', 0o600);
        try {
          writeFileSync(fd, JSON.stringify(audit) + '\n');
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        const parent = openSync(auditDirectory, 'r');
        try {
          fsyncSync(parent);
        } finally {
          closeSync(parent);
        }
      }
      afterAudit(auditFile);
      const result = {
        receipt_id: entry.receipt_id,
        payload_hash: entry.payload_hash,
        state: superseded
          ? 'superseded-without-submission'
          : invalid
            ? 'terminal-invalid-with-supersession'
            : recorded
              ? 'client-reported-stale-not-delivered'
              : 'rejected-not-delivered',
        task_id: entry.receipt.task_id,
        sequence: entry.receipt.sequence,
        audit: auditFile,
        auditDigest: byteHash(readFileSync(auditFile)),
      };
      (state.rejected ??= []).push(result);
      state.pending.splice(index, 1);
      return structuredClone(result);
    });
  }
  return {
    directory,
    read,
    enqueue,
    prepare,
    acknowledge,
    fail,
    quarantineStale: (id, proof, options) => {
      assert.notEqual(proof.kind, 'superseded-without-submission');
      return quarantineTerminal(id, proof, options);
    },
    quarantineRecordedStale: (id, proof, options) => {
      assert.equal(proof.kind, 'recorded-client-stale');
      return quarantineTerminal(id, proof, options);
    },
    quarantineInvalid: (id, proof, options) => {
      assert.equal(proof.kind, 'terminal-invalid-with-supersession');
      return quarantineTerminal(id, proof, options);
    },
    quarantineSuperseded: (id, proof, options) => {
      assert.equal(proof.kind, 'superseded-without-submission');
      return quarantineTerminal(id, proof, options);
    },
  };
}

function validateStaleProof(entry, proof) {
  assert.equal(entry.failure?.code, 'stale_receipt');
  assert.equal(entry.failure.retryable, false);
  assert.ok(Number.isSafeInteger(entry.revision) && entry.revision > 0);
  const rejection = proof.rejection;
  assert.equal(rejection.operation, 'apply_task_progress_receipt');
  assert.deepEqual(rejection.args, { id: entry.receipt.task_id, revision: entry.revision, receipt: entry.receipt });
  assert.equal(rejection.result.code, 'stale_receipt');
  if (rejection.result.retryable === undefined) validateProgressHistory(entry, proof.historyEvidence);
  else assert.equal(rejection.result.retryable, false);
  assert.ok(
    typeof rejection.source === 'string' && rejection.source.length > 0,
    'Original authenticated operation reference required',
  );
  const seen = proof.readback;
  assert.equal(seen.task_id, entry.receipt.task_id);
  assert.equal(seen.task?.id, entry.receipt.task_id);
  assert.equal(seen.receipt_id, entry.receipt_id);
  assert.equal(seen.status, 'not_found');
  assert.equal(seen.receipt, null);
  assert.ok(Number.isSafeInteger(seen.revision) && seen.revision >= entry.revision);
  assert.equal(seen.task.revision, seen.revision);
}
// Historical recovery needs the original owner tool trace, not a bare caller-provided failure code.
export async function recoverStaleReceipt(outbox, adapter, receiptId, { rejectionRef, afterAudit } = {}) {
  const entry = outbox.read().pending.find((item) => item.receipt_id === receiptId);
  const prior = (outbox.read().rejected ?? []).find((item) => item.receipt_id === receiptId);
  if (prior) return prior;
  assert.ok(entry, 'Unknown pending stale receipt');
  assert.equal(typeof adapter.readRejection, 'function', 'Original authenticated rejection adapter unavailable');
  const proof = {
    rejection: await adapter.readRejection(rejectionRef, entry),
    readback: await adapter.read(entry.receipt.task_id, receiptId),
  };
  if (proof.rejection.result.retryable === undefined) {
    assert.equal(typeof adapter.history, 'function');
    proof.historyEvidence = await adapter.history(entry.receipt.task_id, receiptId);
    proof.readback = proof.historyEvidence.current;
  }
  validateStaleProof(entry, proof);
  approvedRejections.add(proof);
  return outbox.quarantineStale(receiptId, proof, { afterAudit });
}

// A single bounded flush via the already authenticated owner host. Read before any send, including retries.
export async function flushProgress(outbox, adapter, { limit = 32 } = {}) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 128);
  const results = [];
  for (const entry of outbox.read().pending.slice(0, limit)) {
    const receipt = entry.receipt;
    try {
      let seen = await adapter.read(receipt.task_id, receipt.receipt_id);
      if (seen.status === 'not_found') {
        if ((entry.revision !== undefined && entry.revision !== seen.revision) || entry.failure?.retryable === false) {
          results.push({
            receipt_id: receipt.receipt_id,
            status: 'needs-review',
            reason: entry.failure?.code ?? 'revision_conflict',
          });
          break;
        }
        const pending = outbox.prepare(receipt.receipt_id, seen.revision);
        try {
          await adapter.apply({ id: receipt.task_id, revision: pending.revision, receipt });
        } catch (error) {
          outbox.fail(
            receipt.receipt_id,
            /^[a-z0-9_-]{1,80}$/.test(error.code ?? '') ? error.code : 'write_result_unknown',
            error.authenticatedRejection ?? null,
          );
          /* uncertain write: read back, never resend here */
        }
        seen = await adapter.read(receipt.task_id, receipt.receipt_id);
      }
      if (['applied', 'duplicate'].includes(seen.status)) {
        outbox.acknowledge(receipt.receipt_id, seen);
        results.push({ receipt_id: receipt.receipt_id, status: 'confirmed' });
      } else {
        const failed = outbox.read().pending.find((item) => item.receipt_id === receipt.receipt_id);
        if (failed?.failure?.rejection && adapter.readRejection) {
          const result = await recoverStaleReceipt(outbox, adapter, receipt.receipt_id, {
            rejectionRef: failed.failure.rejection.source,
          });
          results.push({ receipt_id: receipt.receipt_id, status: result.state });
          continue;
        }
        results.push({ receipt_id: receipt.receipt_id, status: 'pending' });
        break; // preserve source order; no later task receipt can overtake this one
      }
    } catch (error) {
      results.push({
        receipt_id: receipt.receipt_id,
        status: 'pending',
        reason: error.code ?? 'transport-unavailable',
      });
      break;
    }
  }
  return results;
}

// `call` is supplied ONLY by the authenticated owner host, never from credentials in this repo.
export function authenticatedBoardAdapter(call, { readRejectedOperation } = {}) {
  const observed = new Map();
  const adapter = {
    async read(task, receiptId, options) {
      const result = await call('get_task_progress_receipt', { id: task, receipt_id: receiptId }, options);
      assert.equal(result.task.id, task);
      assert.equal(result.receipt_id, receiptId);
      return {
        task_id: task,
        receipt_id: receiptId,
        status: result.outcome,
        revision: result.task.revision,
        applied_revision: result.applied_revision,
        receipt: result.receipt,
        task: result.task,
      };
    },
    async readRejection(ref, entry) {
      const rejection = observed.get(ref) ?? (readRejectedOperation ? await readRejectedOperation(ref) : null);
      assert.ok(rejection, 'Original authenticated rejection unavailable');
      assert.deepEqual(rejection.args, { id: entry.receipt.task_id, revision: entry.revision, receipt: entry.receipt });
      return structuredClone(rejection);
    },
    async history(task, receiptId, options) {
      const before = await adapter.read(task, receiptId, options);
      const events = await call('task_history', { id: task }, options);
      const current = await adapter.read(task, receiptId, options);
      assert.equal(before.revision, current.revision, 'Task changed during history observation');
      return { contract: STALE_PROTOCOL, operation: 'task_history', task, events, current };
    },
    async apply(envelope, options) {
      try {
        return await call('apply_task_progress_receipt', envelope, options);
      } catch (error) {
        // Only authenticated call adapters attach the exact server result; arbitrary code alone never qualifies.
        if (
          error.boardResponse?.code === 'stale_receipt' &&
          [undefined, false].includes(error.boardResponse.retryable)
        ) {
          const rejection = {
            source: error.operationRef ?? 'owner-call:' + randomUUID(),
            operation: 'apply_task_progress_receipt',
            args: structuredClone(envelope),
            result: structuredClone(error.boardResponse),
          };
          observed.set(rejection.source, rejection);
          error.authenticatedRejection = rejection;
        }
        throw error;
      }
    },
  };
  return adapter;
}

// A fresh authoritative source observation can prove the board already matches.
// This never acknowledges, rewrites, retries or removes a historical receipt.
export async function confirmCurrentBoardProjection({ directory, task, receiptId, observeCurrent }, adapter) {
  assert.equal(typeof observeCurrent, 'function');
  const source = await observeCurrent();
  assert.equal(source.task, task);
  assert.ok(Array.isArray(source.evidence_refs) && source.evidence_refs.length);
  assert.ok(Number.isFinite(Date.parse(source.observed_at)));
  const seen = await adapter.read(task, receiptId);
  assert.equal(seen.task_id, task);
  assert.equal(seen.receipt_id, receiptId);
  assert.equal(seen.task?.id, task);
  assert.ok(Number.isSafeInteger(seen.revision) && seen.revision > 0);
  assert.equal(seen.task.revision, seen.revision);
  const fields = ['board_column', 'status', 'current_work', 'next_step'];
  assert.deepEqual(Object.keys(source.expected).sort(), fields.sort(), 'Exact projection required');
  for (const field of fields) {
    assert.equal(typeof source.expected[field], 'string');
    assert.equal(seen.task[field], source.expected[field], 'Current board differs from observed source');
  }
  const proof = { version: 1, status: 'current-state-confirmed-no-write', task, source, readback: seen };
  const store = path.join(directory, 'confirmations');
  safe(store);
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const file = path.join(store, hash(proof) + '.json'),
    content = JSON.stringify(proof) + '\n';
  safe(file);
  if (existsSync(file)) assert.equal(readFileSync(file, 'utf8'), content);
  else writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
  return { status: proof.status, evidence: file, historicalReceiptDelivered: false };
}

export async function supersedeUnsubmittedReceipt(outbox, adapter, receiptId, { readClosedSource, afterAudit } = {}) {
  const entry = outbox.read().pending.find((item) => item.receipt_id === receiptId);
  const prior = (outbox.read().rejected ?? []).find((item) => item.receipt_id === receiptId);
  if (prior) return prior;
  assert.ok(entry, 'Unknown unsubmitted receipt');
  assert.equal(typeof readClosedSource, 'function');
  const closedSource = await readClosedSource();
  const historyEvidence = await adapter.history(entry.receipt.task_id, receiptId);
  const proof = {
    kind: 'superseded-without-submission',
    closedSource,
    historyEvidence,
    readback: historyEvidence.current,
  };
  validateClosedSupersession(entry, proof);
  approvedRejections.add(proof);
  return outbox.quarantineSuperseded(receiptId, proof, { afterAudit });
}

// Legacy published client retained the terminal code but not the full HTTP body.
// Preserve that lower evidence strength; fresh authenticated history independently proves supersession.
export async function recoverRecordedClientStale(outbox, adapter, receiptId, { clientEvidenceFile, afterAudit } = {}) {
  const state = outbox.read(),
    prior = (state.rejected ?? []).find((item) => item.receipt_id === receiptId);
  if (prior) return prior;
  const entry = state.pending.find((item) => item.receipt_id === receiptId);
  assert.ok(entry);
  safe(clientEvidenceFile);
  const bytes = readFileSync(clientEvidenceFile),
    report = JSON.parse(bytes);
  const matched = report.outboxes?.find((box) => box.receipts?.some((receipt) => receipt.receipt_id === receiptId));
  assert.ok(matched);
  const historyEvidence = await adapter.history(entry.receipt.task_id, receiptId);
  const proof = {
    kind: 'recorded-client-stale',
    clientEvidence: {
      contract: 'published-progress-outbox-terminal-v1',
      file: clientEvidenceFile,
      bytes: bytes.toString('base64'),
      digest: byteHash(bytes),
      report,
      outboxDirectory: matched.directory,
      originalProviderResponse: 'not-retained',
    },
    historyEvidence,
    readback: historyEvidence.current,
  };
  validateRecordedClientStale(entry, proof);
  approvedRejections.add(proof);
  return outbox.quarantineRecordedStale(receiptId, proof, { afterAudit });
}

export async function recoverTerminalInvalidWithSupersession(
  outbox,
  adapter,
  receiptId,
  { clientEvidenceFile, evidenceBase, readRepairSource, afterAudit } = {},
) {
  const state = outbox.read(),
    prior = (state.rejected ?? []).find((item) => item.receipt_id === receiptId);
  if (prior) {
    assert.equal(prior.state, 'terminal-invalid-with-supersession');
    return prior;
  }
  const entry = state.pending.find((item) => item.receipt_id === receiptId);
  assert.ok(entry, 'Unknown invalid receipt');
  assert.equal(typeof readRepairSource, 'function', 'Verified current repair source required');
  safe(clientEvidenceFile);
  const bytes = readFileSync(clientEvidenceFile),
    report = JSON.parse(bytes);
  const source = path.resolve(
    evidenceBase ?? path.dirname(path.dirname(path.dirname(outbox.directory))),
    report.sourceFile,
  );
  assert.equal(source, path.join(outbox.directory, 'outbox.json'), 'Client observation is for another outbox');
  const repairSource = await readRepairSource(),
    historyEvidence = await adapter.history(entry.receipt.task_id, receiptId);
  const proof = {
    kind: 'terminal-invalid-with-supersession',
    clientEvidence: {
      file: clientEvidenceFile,
      bytes: bytes.toString('base64'),
      digest: byteHash(bytes),
      report,
      outboxDirectory: outbox.directory,
      sourceFile: source,
    },
    repairSource,
    historyEvidence,
    readback: historyEvidence.current,
  };
  validateTerminalInvalidSupersession(entry, proof);
  approvedRejections.add(proof);
  return outbox.quarantineInvalid(receiptId, proof, { afterAudit });
}
