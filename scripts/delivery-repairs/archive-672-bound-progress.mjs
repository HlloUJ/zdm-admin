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
import { createProgressOutbox, progressSourceIdentity } from '../task-progress-outbox.mjs';
import { scopedAdmissions } from '../task-execution-scope.mjs';

export const runtimeId = 'store-exit-selection-672-134-delivery';
export const boardId = 'store-deletion-three-fixes';
const releaseTask = 'task-delivery-status-sync';
const last = 56;
const queueRevision = 148;
const pauseId = progressSourceIdentity(runtimeId, 'queue:' + queueRevision + ':delivery');
const retirement = 'retired-q148-pause-not-delivered';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));
const canonical = (value) => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
};
function unlinked(file) {
  for (let part = file; ; part = path.dirname(part)) {
    if (existsSync(part)) assert.ok(!lstatSync(part).isSymbolicLink(), 'Linked bound-progress evidence refused');
    if (part === path.dirname(part)) break;
  }
}
function privateBytes(file) {
  unlinked(file);
  const info = lstatSync(file);
  assert.ok(info.isFile() && (info.mode & 0o077) === 0 && info.size <= 16 * 1024 * 1024);
  return readFileSync(file);
}
function durable(file, data) {
  const temp = file + '.' + randomUUID();
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(data) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  const folder = openSync(path.dirname(file), 'r');
  try {
    fsyncSync(folder);
  } finally {
    closeSync(folder);
  }
}
function useLock(file, work) {
  unlinked(file);
  writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
  return Promise.resolve()
    .then(work)
    .finally(() => unlinkSync(file));
}

export function boundPolicy(binding, entries) {
  assert.equal(binding.boardTaskId, boardId);
  assert.equal(binding.revision, 1, 'Original fixed binding revision required');
  assert.equal(entries.length, last);
  const ids = new Set();
  const packets = entries.map(({ receipt, receipt_id }, i) => {
    assert.equal(receipt.task_id, runtimeId);
    assert.equal(receipt.version, 1);
    assert.equal(receipt.sequence, i + 1);
    assert.equal(receipt.receipt_id, receipt_id);
    assert.match(receipt_id, /^[a-f0-9]{64}$/);
    assert.ok(!ids.has(receipt_id) && !Object.hasOwn(receipt, 'stage_fact'));
    assert.ok(['started', 'completed', 'blocked'].includes(receipt.event));
    ids.add(receipt_id);
    return { sequence: i + 1, receipt_id, payload_sha256: sha256(canonical(receipt)) };
  });
  const proof = {
    version: 1,
    source_task_id: runtimeId,
    board_task_id: boardId,
    binding_revision: binding.revision,
    binding_sha256: digest(binding),
    first_sequence: 1,
    last_sequence: last,
  };
  return { ...proof, policy_sha256: sha256(canonical({ ...proof, packets })) };
}

function sourceContext({ registry, queue, readCoordination }, actor) {
  const coordination = readCoordination();
  assert.equal(actor, coordination?.current.rootThreadId, 'Actual current coordinator required');
  const current = registry.readTask(runtimeId);
  assert.equal(current.id, runtimeId);
  assert.match(current.frozen?.accepted ?? '', /^[a-f0-9]{40}$/);
  const binding = current.executionBindings?.at(-1);
  assert.equal(binding?.boardTaskId, boardId);
  assert.equal(binding.monitoring.taskStableId, boardId);
  const state = queue.read();
  assert.ok(state.revision >= queueRevision && state.paused);
  assert.ok(!scopedAdmissions(state).some((scope) => scope.task === runtimeId), 'Joint delivery remains admitted');
  const ticket = state.tickets.find((item) => item.task === runtimeId && item.lane === 'delivery');
  assert.equal(ticket?.status, 'blocked');
  assert.equal(ticket.owner, current.owner);
  const selected = state.dynamicDecisions?.find((item) => item.id === ticket.dynamicDecisionId);
  assert.equal(selected?.status, 'consumed');
  assert.equal(selected.admission, ticket.admission);
  assert.equal(selected.bindingRevision, binding.revision);
  assert.equal(selected.input.phase, 'final');
  assert.equal(selected.input.task, runtimeId);
  assert.equal(selected.input.owner, ticket.owner);
  const block = state.events.findLast(
    (event) => event.task === runtimeId && event.action === 'block' && event.lane === 'delivery',
  );
  const dispatch = state.events.find(
    (event) =>
      event.task === runtimeId &&
      event.action === 'dispatch-applied' &&
      event.decisionId === selected.id &&
      event.admission === selected.admission,
  );
  const authority = state.dynamicAuthorities?.find((item) => item.id === selected.input.authorityId);
  assert.ok(dispatch && block && state.events.indexOf(dispatch) < state.events.indexOf(block));
  assert.equal(block.reason, ticket.reason);
  assert.ok(authority?.source.tasks.some((item) => item.task === runtimeId && item.owner === ticket.owner));
  assert.deepEqual(dispatch.request, authority.request);
  assert.equal(coordination.current.request.authorId, authority.request.authorId);
  const fence = state.events.findLast((event) => ['initialize', 'pause-all'].includes(event.action));
  assert.ok(
    fence &&
      fence.request.authorId === authority.request.authorId &&
      fence.request.sequence < authority.request.sequence,
  );
  assert.ok(
    state.events.indexOf(fence) < state.events.indexOf(dispatch),
    'Later user pause requires separate handling',
  );
  return {
    binding,
    ticket,
    block,
    fence,
    dispatch,
    authority,
    accepted: current.frozen.accepted,
    taskRevision: current.revision,
  };
}

function matchRead(seen, id) {
  assert.equal(seen.version, 1);
  assert.equal(seen.receipt_id, id);
  assert.equal(seen.task.id, boardId);
  assert.ok(Number.isSafeInteger(seen.task.revision) && seen.task.revision >= 60 && !seen.task.deleted_at);
  assert.equal(seen.task.status, 'merging');
  assert.equal(seen.task.board_column, 'merging');
  assert.ok(['not_found', 'applied'].includes(seen.outcome));
  if (seen.outcome === 'not_found') {
    assert.equal(seen.receipt, null);
    assert.equal(seen.applied_revision, null);
  } else {
    assert.ok(
      Number.isSafeInteger(seen.applied_revision) &&
        seen.applied_revision > 0 &&
        seen.applied_revision <= seen.task.revision,
    );
  }
}
function checkedHistory(history, task) {
  assert.equal(history.length, task.revision, 'Complete primary-card history required');
  const rows = history
    .map((event) => {
      assert.equal(event.task_id, boardId);
      return typeof event.snapshot === 'string' ? JSON.parse(event.snapshot) : event.snapshot;
    })
    .sort((a, b) => a.revision - b.revision);
  rows.forEach((row, index) => {
    assert.equal(row.id, boardId);
    assert.equal(row.revision, index + 1, 'History gap or duplicate');
  });
  const outline = { ...task };
  delete outline.board_column;
  const latest = { ...rows.at(-1) };
  delete latest.progress_receipt;
  assert.deepEqual(latest, outline, 'History and current primary card differ');
  return rows;
}
function matchPause(entry, facts) {
  assert.equal(entry.receipt_id, pauseId);
  assert.equal(entry.state, 'pending');
  assert.ok(!['revision', 'failure', 'readback'].some((key) => Object.hasOwn(entry, key)));
  const receipt = entry.receipt;
  assert.equal(receipt.task_id, runtimeId);
  assert.equal(receipt.receipt_id, pauseId);
  assert.equal(receipt.sequence, last + 1);
  assert.equal(receipt.event, 'paused');
  assert.deepEqual(receipt.action, { id: 'queue:delivery', label: 'delivery' });
  assert.deepEqual(receipt.next, { kind: 'wait', label: '等待恢复指令' });
  assert.deepEqual(receipt.evidence_refs, ['execution-order:' + queueRevision + ':delivery:' + runtimeId]);
  assert.equal(receipt.reason, facts.block.reason);
  assert.ok(!Object.hasOwn(receipt, 'stage_fact'));
}
function checkHistoryNoPause(rows) {
  assert.ok(
    rows.every(
      (row) => ![row.progress_receipt?.receipt?.receipt_id, row.progress_receipt?.receipt_id].includes(pauseId),
    ),
  );
}
function matchInitial(raw, facts) {
  const state = JSON.parse(raw);
  assert.equal(state.version, 1);
  assert.equal(state.pending.length, last + 1);
  assert.deepEqual(state.acknowledged, []);
  assert.deepEqual(state.rejected ?? [], []);
  assert.deepEqual(state.retired ?? [], []);
  assert.ok(
    state.pending.every(
      (entry) =>
        entry.state === 'pending' && !['revision', 'failure', 'readback'].some((key) => Object.hasOwn(entry, key)),
    ),
  );
  matchPause(state.pending.at(-1), facts);
  return state;
}

function readRetirement(archive, box, facts) {
  const bytes = privateBytes(archive),
    retained = JSON.parse(bytes);
  assert.equal(retained.status, retirement);
  const original = matchInitial(Buffer.from(retained.originalBytes, 'base64'), facts);
  assert.deepEqual(retained.source, facts);
  matchRead(retained.seen, pauseId);
  assert.equal(retained.seen.outcome, 'not_found');
  checkHistoryNoPause(checkedHistory(retained.history, retained.seen.task));
  const entries = original.pending.slice(0, last);
  const proof = boundPolicy(facts.binding, entries);
  assert.deepEqual(retained.policy, proof);
  const expectedRetired = { ...original.pending.at(-1), state: retirement, audit: archive, auditDigest: sha256(bytes) };
  const state = box.read();
  assert.deepEqual(state.retired, [expectedRetired]);
  assert.equal(
    state.pending.some(({ receipt_id }) => receipt_id === pauseId),
    false,
  );
  return { entries, proof, retained, expectedRetired };
}

export async function runBound672({ action, actor, attestation }, deps) {
  assert.ok(['archive', 'replay'].includes(action));
  assert.equal(
    await deps.dependenciesReady({ dependsOn: [releaseTask] }),
    true,
    '417 formally published and closed required',
  );
  const { registry, queue, call } = deps;
  assert.equal(queue.commonDir, registry.commonDir);
  const directory = path.join(registry.commonDir, 'task-progress', runtimeId);
  const file = path.join(directory, 'outbox.json');
  const archive = path.join(directory, 'retired-q148-seq57.json');
  const read = (id) => call('get_task_progress_receipt', { id: boardId, receipt_id: id });
  const expectedSource = sourceContext(deps, actor);
  return useLock(path.join(directory, 'bound-672.lock'), async () => {
    const facts = sourceContext(deps, actor);
    assert.deepEqual(facts, expectedSource);
    const box = createProgressOutbox(directory);
    if (action === 'archive') {
      if (box.read().retired?.length) {
        const { retained, expectedRetired } = readRetirement(archive, box, facts);
        assert.deepEqual(attestation, retained.attestation);
        return { status: retirement, receiptId: pauseId, auditDigest: expectedRetired.auditDigest, replay: true };
      }
      const raw = privateBytes(file);
      const state = matchInitial(raw, facts);
      const proof = boundPolicy(facts.binding, state.pending.slice(0, last));
      assert.deepEqual(
        attestation,
        {
          coordinator: actor,
          sourceRevision: queueRevision,
          receiptId: pauseId,
          blockSha256: digest(facts.block),
          outboxSha256: sha256(raw),
          outcome: 'never-prepared-no-unknown-write',
        },
        'Exact current coordinator transport assessment required',
      );
      const start = Date.now();
      const first = await read(state.pending[0].receipt_id);
      matchRead(first, state.pending[0].receipt_id);
      assert.equal(first.outcome, 'not_found');
      assert.deepEqual(first.receipt_source_binding, proof, 'Published Site policy does not match original packets');
      const history = await call('task_history', { id: boardId });
      const seen = await read(pauseId);
      matchRead(seen, pauseId);
      assert.equal(seen.outcome, 'not_found');
      assert.equal(seen.receipt_source_binding, undefined, 'Mistaken pause must not be sendable');
      assert.deepEqual(seen.task, first.task);
      checkHistoryNoPause(checkedHistory(history, seen.task));
      assert.ok(Date.now() - start <= 60_000, 'Stale unused-receipt observation');
      return queue.guard(() => {
        assert.deepEqual(sourceContext(deps, actor), facts);
        unlinked(file);
        unlinked(archive);
        const lock = path.join(directory, 'outbox.lock');
        writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
        try {
          assert.deepEqual(privateBytes(file), raw, 'Original outbox changed');
          const entry = state.pending.at(-1);
          const payload = {
            status: retirement,
            originalBytes: raw.toString('base64'),
            attestation,
            source: facts,
            policy: proof,
            entry,
            history,
            seen,
            observedAt: new Date().toISOString(),
          };
          if (!existsSync(archive)) durable(archive, payload);
          const bytes = privateBytes(archive),
            retained = JSON.parse(bytes);
          assert.equal(retained.status, retirement);
          for (const field of ['originalBytes', 'attestation', 'source', 'policy', 'entry'])
            assert.deepEqual(retained[field], payload[field]);
          matchRead(retained.seen, pauseId);
          assert.equal(retained.seen.outcome, 'not_found');
          checkHistoryNoPause(checkedHistory(retained.history, retained.seen.task));
          const archived = { ...entry, state: retirement, audit: archive, auditDigest: sha256(bytes) };
          state.pending.pop();
          state.retired = [archived];
          durable(file, state);
          return { status: retirement, receiptId: pauseId, auditDigest: archived.auditDigest };
        } finally {
          unlinkSync(lock);
        }
      });
    }
    assert.equal(attestation, undefined);
    const { entries, proof } = readRetirement(archive, box, facts);
    const receipts = [];
    for (const entry of entries) {
      assert.deepEqual(sourceContext(deps, actor), facts, 'Joint-delivery origin changed while replaying');
      const local = box.read();
      const already = local.acknowledged.find((item) => item.receipt_id === entry.receipt_id);
      const current = already ?? local.pending[0];
      assert.equal(current?.receipt_id, entry.receipt_id, 'Only the exact outbox head may be sent');
      assert.equal(current.payload_hash, entry.payload_hash);
      assert.deepEqual(current.receipt, entry.receipt);
      let seen = await read(entry.receipt_id);
      matchRead(seen, entry.receipt_id);
      assert.deepEqual(seen.receipt_source_binding, proof);
      if (seen.outcome === 'not_found') {
        assert.ok(!already && current.failure?.retryable !== false);
        const history = checkedHistory(await call('task_history', { id: boardId }), seen.task);
        const manual = history
          .filter((row) => !row.progress_receipt)
          .map((row) => Date.parse(row.updated_at))
          .filter(Number.isFinite);
        assert.ok(
          Date.parse(entry.receipt.observed_at) >= Math.max(Date.parse(seen.task.created_at), ...manual),
          'A later manual board update supersedes this source; hold the original head',
        );
        assert.ok(
          current.revision === undefined || current.revision === seen.task.revision,
          'Prepared revision changed',
        );
        assert.deepEqual(sourceContext(deps, actor), facts, 'Joint-delivery origin changed before writing');
        const prepared = box.prepare(entry.receipt_id, seen.task.revision);
        assert.deepEqual(prepared.receipt, entry.receipt);
        try {
          await call('apply_task_progress_receipt', {
            id: boardId,
            revision: prepared.revision,
            receipt: entry.receipt,
          });
        } catch (error) {
          const code = /^[a-z0-9_-]{1,80}$/.test(error.code ?? '') ? error.code : 'write_result_unknown';
          box.fail(entry.receipt_id, code);
        }
        seen = await read(entry.receipt_id);
        matchRead(seen, entry.receipt_id);
        assert.deepEqual(seen.receipt_source_binding, proof);
      }
      assert.equal(seen.outcome, 'applied', 'Head outcome unresolved; stop without dispatching a successor');
      assert.deepEqual(seen.receipt, entry.receipt, 'Native durable readback differs from original packet');
      if (!already) {
        box.acknowledge(entry.receipt_id, {
          task_id: runtimeId,
          board_task_id: boardId,
          task: seen.task,
          receipt_id: entry.receipt_id,
          revision: seen.task.revision,
          applied_revision: seen.applied_revision,
          status: seen.outcome,
          receipt: seen.receipt,
        });
      }
      receipts.push({ receiptId: entry.receipt_id, appliedRevision: seen.applied_revision });
    }
    return { status: 'bound-ordinary-progress-confirmed', count: receipts.length, last: receipts.at(-1) };
  });
}
