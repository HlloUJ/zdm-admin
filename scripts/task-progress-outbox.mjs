import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
    const receipt_id = hash([task, sourceKey]);
    const payloadHash = hash(payload);
    return change((state) => {
      const existing = [...state.pending, ...state.acknowledged].find((r) => r.receipt_id === receipt_id);
      if (existing) {
        assert.equal(existing.payload_hash, payloadHash, 'Receipt identity reused with changed facts');
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
  function fail(receiptId, code) {
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
      return structuredClone(entry);
    });
  }
  return { read, enqueue, prepare, acknowledge, fail };
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
          );
          /* uncertain write: read back, never resend here */
        }
        seen = await adapter.read(receipt.task_id, receipt.receipt_id);
      }
      if (['applied', 'duplicate'].includes(seen.status)) {
        outbox.acknowledge(receipt.receipt_id, seen);
        results.push({ receipt_id: receipt.receipt_id, status: 'confirmed' });
      } else {
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
export function authenticatedBoardAdapter(call) {
  return {
    async read(task, receiptId) {
      const result = await call('get_task_progress_receipt', { id: task, receipt_id: receiptId });
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
    apply: (envelope) => call('apply_task_progress_receipt', envelope),
  };
}
