import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { executionPausedFor } from './task-execution-scope.mjs';
import { notifyProgressHost } from './task-progress-host.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createProgressOutbox, progressSourceIdentity } from './task-progress-outbox.mjs';

// This bridge emits facts, never a board status, current_work patch or movement decision.
export function validateProgressReceipt(payload) {
  assert.ok(['queued', 'started', 'completed', 'blocked', 'paused'].includes(payload.event));
  assert.ok(payload.action && typeof payload.action.id === 'string' && payload.action.id.length > 0);
  assert.ok(typeof payload.action.label === 'string' && payload.action.label.length > 0);
  assert.ok(Number.isFinite(Date.parse(payload.observed_at)));
  assert.ok(Array.isArray(payload.evidence_refs) && payload.evidence_refs.length > 0);
  assert.ok(payload.evidence_refs.every((ref) => typeof ref === 'string' && ref.length > 0));
  assert.ok(['action', 'wait', 'none'].includes(payload.next?.kind));
  if (payload.next.kind !== 'none') assert.ok(typeof payload.next.label === 'string' && payload.next.label.length > 0);
  assert.ok(!('status' in payload) && !('current_work' in payload) && !('placement' in payload));
  if (payload.stage_fact) {
    assert.ok(['development_ready', 'begin_delivery', 'delivery_complete'].includes(payload.stage_fact.kind));
    assert.ok(payload.stage_fact.conditions && payload.stage_fact.references);
  }
  return payload;
}
export function recordToolProgress(directory, task, sourceKey, payload) {
  const receipt = createProgressOutbox(directory).enqueue(task, sourceKey, validateProgressReceipt(payload));
  notifyProgressHost(directory);
  return receipt;
}
// Must be called AFTER original evidence is durably saved. Failures cannot change the tool result.
export function bestEffortProgress(directory, task, sourceKey, payload, warn = console.error) {
  try {
    return recordToolProgress(directory, task, sourceKey, payload);
  } catch (error) {
    warn(`Task progress remains unsynchronized; original evidence retained: ${error.message}`);
    return null;
  }
}
export function captureCompletionProgress(directory, state, previous) {
  const outboxDirectory =
    path.basename(path.dirname(directory)) === 'task-delivery' && path.basename(directory) === state.batch
      ? path.join(path.dirname(path.dirname(directory)), 'task-progress', state.batch)
      : path.join(directory, 'progress'); // isolated/noncanonical sessions remain inside their own evidence directory
  for (const event of state.events ?? []) {
    if (previous?.events.some((old) => old.id === event.id && old.status === event.status)) continue;
    if (!event.id || !['running', 'success', 'failure'].includes(event.status)) continue;
    const eventType = { running: 'started', success: 'completed', failure: 'blocked' }[event.status];
    const timestamp = event.finishedAt ?? event.startedAt;
    const payload = {
      observed_at: new Date(timestamp).toISOString(),
      action: { id: event.id, label: event.name },
      event: eventType,
      evidence_refs: [`completion-session:${state.batch}:${event.id}:${event.status}`],
      next: event.next ?? { kind: 'wait', label: '下一步确认' },
      ...(event.status === 'failure' ? { reason: event.failure?.category ?? '工具执行失败，原因待确认' } : {}),
    };
    bestEffortProgress(outboxDirectory, state.batch, `completion:${event.id}:${event.status}`, payload);
  }
}
export function captureQueueProgress(commonDir, state, previous) {
  const pausedFor = (current, ticket) => {
    if (!executionPausedFor(current, ticket)) return false;
    const fence = current.events?.findLast((event) => ['initialize', 'pause-all'].includes(event.action))?.request;
    // A newly authorized pending native task is queued behind the fence. It
    // has not been explicitly paused by the user and has not started either.
    return !(
      ticket.status === 'queued' &&
      ticket.awaitingNativeWorker === true &&
      ticket.admission === null &&
      Number.isSafeInteger(fence?.sequence) &&
      typeof fence.authorId === 'string' &&
      fence.authorId.trim() &&
      fence.authorId === ticket.request?.authorId &&
      Number.isSafeInteger(ticket.request?.sequence) &&
      ticket.request.sequence > fence.sequence
    );
  };
  for (const ticket of state.tickets) {
    if (['completed', 'cancelled'].includes(ticket.status)) continue;
    const before = previous?.tickets.find((item) => item.task === ticket.task && item.lane === ticket.lane);
    // Admission is NOT proof of actual action start. No synthetic started event on claim.
    const paused = pausedFor(state, ticket);
    const changed = !before || before.status !== ticket.status || paused !== pausedFor(previous, before);
    if (!changed || (!['queued', 'blocked'].includes(ticket.status) && !paused)) continue;
    const event = paused ? 'paused' : ticket.status;
    bestEffortProgress(
      path.join(commonDir, 'task-progress', ticket.task),
      ticket.task,
      `queue:${state.revision}:${ticket.lane}`,
      {
        observed_at: new Date().toISOString(),
        action: { id: `queue:${ticket.lane}`, label: ticket.lane },
        event,
        evidence_refs: [`execution-order:${state.revision}:${ticket.lane}:${ticket.task}`],
        next: { kind: 'wait', label: paused ? '等待恢复指令' : '等待执行' },
        ...(ticket.reason ? { reason: ticket.reason } : {}),
      },
    );
  }
}

// 417 measures JS string length (UTF-16 code units). Keep code points intact.
function boundedCiLabel(value) {
  if (value.length <= 500) return value;
  const suffix = '……（完整进展见CI记录）',
    budget = 500 - suffix.length;
  let prefix = '';
  for (const character of value) {
    if (prefix.length + character.length > budget) break;
    prefix += character;
  }
  return prefix + suffix;
}
// Uses the waiter's existing authoritative readRun/readJobs results; no new GitHub call/poller.
export function captureCiProgress(common, task, progress) {
  assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.match(progress.runId, /^\d+$/);
  assert.match(progress.headSha, /^[a-f0-9]{40}$/);
  assert.equal(progress.attempt, 1);
  assert.equal(typeof progress.terminalVerified, 'boolean');
  if (progress.terminalVerified) {
    assert.equal(progress.status, 'completed');
    assert.equal(progress.conclusion, 'success');
  }
  assert.ok(Number.isFinite(Date.parse(progress.observedAt)));
  assert.equal(typeof progress.status, 'string');
  const factual = {
    task,
    runId: progress.runId,
    headSha: progress.headSha,
    attempt: 1,
    status: progress.status,
    conclusion: progress.conclusion,
    jobs: progress.jobs,
    terminalVerified: progress.terminalVerified,
  };
  const digest = createHash('sha256').update(JSON.stringify(factual)).digest('hex'),
    sourceKey = 'ci-progress:' + digest,
    directory = path.join(common, 'task-progress', task),
    box = createProgressOutbox(directory),
    id = progressSourceIdentity(task, sourceKey);
  const prior = [...box.read().pending, ...box.read().acknowledged, ...(box.read().rejected ?? [])].find(
    (entry) => entry.receipt_id === id,
  );
  if (prior) return prior;
  const store = path.join(common, 'task-delivery', task, 'ci-progress');
  for (let current = store; ; current = path.dirname(current)) {
    if (existsSync(current)) assert.ok(!lstatSync(current).isSymbolicLink());
    if (current === path.dirname(current)) break;
  }
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const file = path.join(store, progress.runId + '-' + digest + '.json'),
    content = JSON.stringify({ ...factual, observedAt: progress.observedAt }) + '\n';
  let observedAt = progress.observedAt;
  if (existsSync(file)) {
    const old = JSON.parse(readFileSync(file));
    observedAt = old.observedAt;
    delete old.observedAt;
    assert.deepEqual(old, factual);
  } else writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
  const failed =
    (progress.conclusion && progress.conclusion !== 'success') ||
    progress.jobs?.some((job) => ['failure', 'cancelled', 'timed_out'].includes(job.conclusion));
  const event = failed ? 'blocked' : progress.terminalVerified ? 'completed' : 'started';
  const labels = progress.jobs?.map(
    (job) =>
      job.name + ':' + (job.conclusion ?? job.status) + (job.active?.length ? '(' + job.active.join(',') + ')' : ''),
  );
  const label = labels?.length
    ? 'CI ' + progress.runId + ' | ' + labels.join('；')
    : 'CI ' +
      progress.runId +
      '：' +
      progress.status +
      (progress.status === 'completed' && !progress.terminalVerified ? '，必需汇总待核验' : '');
  return recordToolProgress(directory, task, sourceKey, {
    observed_at: observedAt,
    action: { id: 'ci:' + progress.runId + ':' + digest, label: boundedCiLabel(label) },
    event,
    evidence_refs: [file, 'ci:' + progress.runId + ':' + progress.headSha + ':attempt1'],
    next: {
      kind: progress.terminalVerified ? 'wait' : 'action',
      label: failed ? '保留原失败并诊断' : progress.terminalVerified ? '接续正式交付阶段' : '等待同一CI运行的必需检查',
    },
    ...(failed ? { reason: '准确CI运行报告失败；未重跑或改写' } : {}),
  });
}
