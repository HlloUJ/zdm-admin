import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const noticeIdentity = (task, binding, attemptId) =>
  digest({
    task: task.id,
    owner: task.owner,
    head: task.recordedHead,
    interruption: binding.interruptionEventId,
    attemptId,
    roomId: binding.roomId,
    taskNumber: binding.taskNumber,
    taskName: binding.taskName,
    authorizationRef: binding.authorizationRef,
  });
function noLinks(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if (existsSync(p)) assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked notification evidence or state');
    if (p === path.dirname(p)) break;
  }
}
function durableCreate(file, value) {
  const fd = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const parent = openSync(path.dirname(file), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
// Pure evaluator is not an authorization or a production proof source. Production dispatch below
// reads the original protected registry/session itself, not a caller's "resumed" boolean.
export function evaluateRecoveryNotice(task, session, binding) {
  assert.ok(
    binding.taskId &&
      binding.taskNumber &&
      binding.taskName &&
      binding.owner &&
      binding.authorizationRef &&
      binding.roomId,
  );
  assert.ok(binding.interruptionEventId);
  if (task?.id !== binding.taskId || task?.owner !== binding.owner || session?.batch !== binding.taskId)
    return { status: 'blocked', reason: 'Original task/owner identity differs; no success notice' };
  if (task.stage === 'closed') return { status: 'ineligible', reason: 'Already completed task is not a new recovery' };
  if ((session.pauses ?? []).some((p) => p.finishedAt == null))
    return { status: 'blocked', reason: 'Explicit pause retained' };
  if (session.version !== 1 || !Number.isFinite(session.startedAt) || !Array.isArray(session.events))
    return { status: 'blocked', reason: 'Original formal session schema incomplete' };
  const events = session.events;
  if (
    events.some((event) => typeof event.id !== 'string' || !event.id.length) ||
    new Set(events.map((event) => event.id)).size !== events.length
  )
    return { status: 'blocked', reason: 'Missing or duplicate execution event identity' };
  const index = events.findIndex((e) => e.id === binding.interruptionEventId);
  const interrupted = events[index];
  if (
    !interrupted ||
    typeof interrupted.name !== 'string' ||
    !interrupted.name.trim() ||
    typeof interrupted.key !== 'string' ||
    !interrupted.key.trim() ||
    interrupted.status !== 'failure' ||
    interrupted.failure?.category !== 'interrupted'
  )
    return { status: 'blocked', reason: 'Original interruption is not proved' };
  const matching = events.slice(index + 1).filter((e) => e.name === interrupted.name && e.key === interrupted.key);
  const attempt = matching.at(-1);
  if (!attempt || attempt.status === 'running')
    return { status: 'pending', reason: 'Wake or running record alone is not recovery success' };
  if (
    !['success', 'failure'].includes(attempt.status) ||
    attempt.id === interrupted.id ||
    !Number.isFinite(attempt.startedAt) ||
    !Number.isFinite(attempt.finishedAt) ||
    !Number.isFinite(interrupted.finishedAt) ||
    attempt.startedAt < interrupted.finishedAt ||
    attempt.finishedAt < attempt.startedAt ||
    typeof attempt.owner?.host !== 'string' ||
    !attempt.owner.host.length ||
    !Number.isSafeInteger(attempt.owner?.pid) ||
    attempt.owner.pid < 2 ||
    attempt.startedAt < session.startedAt ||
    attempt.processTracking !== 1 ||
    !Array.isArray(attempt.processes)
  )
    return { status: 'blocked', reason: 'New original-stage execution evidence incomplete' };
  const success = attempt.status === 'success';
  const reason = success
    ? null
    : attempt.failure?.category === 'interrupted'
      ? '续接执行再次中断，具体原因待查'
      : attempt.failure?.category === 'ci-failed-unclassified'
        ? '续接后的 CI 检查失败，具体失败原因待查'
        : '续接阶段执行失败，具体原因待查';
  const eventId = digest({
    task: task.id,
    owner: task.owner,
    interruption: interrupted.id,
    attempt: attempt.id,
    outcome: success ? 'resumed' : 'failed',
  });
  return {
    status: 'ready',
    eventId,
    task: task.id,
    originalOwner: task.owner,
    interruptionEventId: interrupted.id,
    attemptId: attempt.id,
    success,
    reason,
    roomId: binding.roomId,
    text: `${binding.taskNumber}｜${binding.taskName}：${success ? '已成功续接。' : `续接失败。${reason}。`}`,
    evidenceDigest: digest({ task, session, binding }),
    identityDigest: noticeIdentity(task, binding, attempt.id),
    taskCompleted: false,
  };
}
function source(root, binding) {
  const registry = createTaskRegistry(root),
    task = registry.readTask(binding.taskId);
  const directory = path.join(registry.commonDir, 'task-delivery', binding.taskId);
  const file = path.join(directory, 'completion-session.json');
  noLinks(file);
  if (!existsSync(file)) return { registry, task, directory, session: null };
  return { registry, task, directory, session: JSON.parse(readFileSync(file, 'utf8')) };
}
function ticketDirectory(registry, taskId) {
  const directory = path.join(registry.commonDir, 'task-recovery-notices', taskId);
  noLinks(directory);
  return directory;
}
// Called before root follows up the exact original worker. It grants no execution authority.
export function armRecoveryNotice({ root, binding }) {
  assert.match(binding.worker ?? '', /^\/root\/[a-z0-9_/]+$/);
  const { registry, task, session } = source(root, binding);
  assert.ok(session && session.version === 1 && Number.isFinite(session.startedAt));
  assert.equal(task?.id, binding.taskId);
  assert.equal(task.owner, binding.owner);
  assert.equal(session.batch, binding.taskId);
  assert.notEqual(task.stage, 'closed');
  assert.match(task.recordedHead ?? '', /^[a-f0-9]{40}$/);
  assert.ok(binding.taskNumber && binding.taskName && binding.roomId && binding.authorizationRef);
  const original = session.events.find((e) => e.id === binding.interruptionEventId);
  assert.ok(original?.status === 'failure' && original.failure?.category === 'interrupted');
  assert.ok(original.name && original.key && Number.isFinite(original.finishedAt));
  assert.ok(original.finishedAt <= Date.now());
  const nonce = randomUUID(),
    directory = ticketDirectory(registry, task.id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ticket = {
    version: 1,
    nonce,
    bindingDigest: digest({ ...binding, nonce: undefined }),
    task: task.id,
    owner: task.owner,
    worker: binding.worker,
    head: task.recordedHead,
    interruptionEventId: original.id,
    originalEventDigest: digest(original),
    stage: original.name,
    key: original.key,
    createdAt: Date.now(),
    previousEventIds: session.events.map((e) => e.id),
    previousTokens: session.events.flatMap((e) => (e.processes ?? []).map((p) => p.token)),
    mayRunBusinessActions: false,
  };
  durableCreate(path.join(directory, nonce + '.json'), ticket);
  return { nonce, binding: { ...binding, nonce }, mayRunBusinessActions: false };
}
function spawnedNotice(data, binding) {
  const { registry, task, session, directory } = data;
  if (!binding.nonce) return null;
  assert.match(binding.nonce, /^[a-f0-9-]{36}$/);
  const file = path.join(ticketDirectory(registry, task.id), binding.nonce + '.json');
  noLinks(file);
  const ticket = JSON.parse(readFileSync(file, 'utf8'));
  if (
    ticket.version !== 1 ||
    ticket.nonce !== binding.nonce ||
    ticket.task !== task.id ||
    ticket.owner !== task.owner ||
    ticket.worker !== binding.worker ||
    ticket.originalEventDigest !== digest(session.events.find((e) => e.id === ticket.interruptionEventId)) ||
    ticket.head !== task.recordedHead ||
    ticket.bindingDigest !== digest({ ...binding, nonce: undefined }) ||
    ticket.mayRunBusinessActions !== false ||
    Date.now() < ticket.createdAt ||
    Date.now() - ticket.createdAt > 600000
  )
    return { status: 'blocked', reason: 'Fresh original task/worker/HEAD nonce binding unavailable' };
  const attempt = [...session.events].reverse().find((e) => e.name === ticket.stage && e.key === ticket.key);
  if (
    attempt &&
    (ticket.previousEventIds.includes(attempt.id) ||
      !Number.isFinite(attempt.startedAt) ||
      attempt.startedAt < ticket.createdAt)
  )
    return { status: 'blocked', reason: 'Attempt predates the armed nonce' };
  if (!attempt || attempt.status !== 'running') return null;
  if (
    !attempt.id ||
    ticket.previousEventIds.includes(attempt.id) ||
    attempt.startedAt < ticket.createdAt ||
    !Number.isFinite(attempt.startedAt) ||
    attempt.processTracking !== 1 ||
    !Array.isArray(attempt.processes) ||
    !attempt.owner?.host ||
    !Number.isSafeInteger(attempt.owner.pid) ||
    attempt.owner.pid < 2
  )
    return { status: 'pending', reason: 'No new original attempt after nonce' };
  for (const child of attempt.processes) {
    if (!/^[a-f0-9-]{36}$/.test(child.token ?? '') || ticket.previousTokens.includes(child.token)) continue;
    const journalFile = path.join(directory, 'process-' + child.token + '.json');
    noLinks(journalFile);
    if (!existsSync(journalFile)) continue;
    const stat = lstatSync(journalFile);
    if (!stat.isFile() || stat.mode & 0o077) continue;
    const journal = JSON.parse(readFileSync(journalFile, 'utf8'));
    // The original supervisor writes started only after child 'spawn'. A stale PID alone is never used.
    if (
      journal.status !== 'started' ||
      journal.token !== child.token ||
      journal.host !== attempt.owner.host ||
      !Number.isSafeInteger(journal.pgid) ||
      journal.pgid < 2
    )
      continue;
    const eventId = digest({
      task: task.id,
      owner: task.owner,
      interruption: ticket.interruptionEventId,
      attempt: attempt.id,
      outcome: 'resumed',
    });
    return {
      status: 'ready',
      eventId,
      task: task.id,
      originalOwner: task.owner,
      interruptionEventId: ticket.interruptionEventId,
      attemptId: attempt.id,
      success: true,
      reason: null,
      roomId: binding.roomId,
      text: `${binding.taskNumber}｜${binding.taskName}：已成功续接。`,
      evidenceDigest: digest({
        task: task.id,
        owner: task.owner,
        head: task.recordedHead,
        nonce: binding.nonce,
        attemptId: attempt.id,
        token: child.token,
      }),
      identityDigest: noticeIdentity(task, binding, attempt.id),
      taskCompleted: false,
      executionCurrentlyAlive: 'not-claimed',
      evidenceKind: 'original-post-spawn-journal',
      token: child.token,
    };
  }
  return { status: 'pending', reason: 'No exact original post-spawn journal; running field alone is insufficient' };
}
export function readRecoveryNotice(root, binding) {
  const data = source(root, binding);
  if (!data.session) return { status: 'blocked', reason: 'Original completion session unavailable' };
  const evaluated = evaluateRecoveryNotice(data.task, data.session, binding);
  if (!['ready', 'pending'].includes(evaluated.status)) return evaluated;
  return spawnedNotice(data, binding) ?? evaluated;
}
// Two-phase local interface for a root whose messaging connector runs outside Node.
export function claimRecoveryNotice({ root, binding, directory }) {
  const notice = readRecoveryNotice(root, binding);
  if (notice.status !== 'ready') return notice;
  noLinks(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    durableCreate(path.join(directory, notice.eventId + '.claim.json'), {
      version: 1,
      eventId: notice.eventId,
      root,
      binding,
      notice,
      status: 'dispatch-pending',
      at: Date.now(),
    });
  } catch (error) {
    if (error.code === 'EEXIST') return { status: 'reconcile-existing', eventId: notice.eventId };
    throw error;
  }
  return { status: 'claimed', eventId: notice.eventId };
}
function readClaim(directory, eventId) {
  assert.match(eventId, /^[a-f0-9]{64}$/);
  const file = path.join(directory, eventId + '.claim.json');
  noLinks(file);
  const claim = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(claim.eventId, eventId);
  assert.equal(claim.notice.eventId, eventId);
  return claim;
}
export function beginRecoveryNoticeSend({ directory, eventId }) {
  const claim = readClaim(directory, eventId);
  const fresh = readRecoveryNotice(claim.root, claim.binding);
  if (
    fresh.status !== 'ready' ||
    fresh.eventId !== claim.notice.eventId ||
    fresh.success !== claim.notice.success ||
    fresh.identityDigest !== claim.notice.identityDigest
  )
    return { status: 'blocked', reason: 'Original evidence changed before dispatch', eventId };
  if (Date.now() - claim.at > 120000 || claim.at > Date.now())
    return { status: 'blocked', reason: 'Claim is stale; explicit reconciliation required', eventId };
  try {
    durableCreate(path.join(directory, eventId + '.send.json'), { eventId, at: Date.now(), status: 'send-started' });
  } catch (error) {
    if (error.code === 'EEXIST') return { status: 'reconcile-existing', eventId };
    throw error;
  }
  return { status: 'send-once', eventId, roomId: fresh.roomId, text: fresh.text };
}
export function recordRecoveryNoticeReceipt({ directory, eventId, result }) {
  const { notice } = readClaim(directory, eventId);
  const sendFile = path.join(directory, eventId + '.send.json');
  noLinks(sendFile);
  assert.equal(JSON.parse(readFileSync(sendFile, 'utf8')).eventId, eventId);
  const delivered =
    result?.status === 'delivered' &&
    result.roomId === notice.roomId &&
    result.eventId === eventId &&
    typeof result.messageId === 'string' &&
    result.messageId.length > 0;
  const receipt = {
    status: delivered ? 'delivered' : 'unknown',
    ...(delivered
      ? { messageId: result.messageId }
      : { reason: 'Exact ChatGPT delivery receipt unavailable; read back, never blind-retry' }),
    eventId,
    roomId: notice.roomId,
    recoverySuccessful: notice.success,
    taskCompleted: false,
    at: Date.now(),
  };
  durableCreate(path.join(directory, eventId + '.receipt.json'), receipt);
  return receipt;
}
// Root supplies only its existing ChatGPT transport; no token, new conversation or arbitrary
// production-proof callback is accepted. Unknown delivery must be read back, never blind-retried.
export async function dispatchRecoveryNotice({ root, binding, directory, send }) {
  assert.equal(typeof send, 'function');
  const claim = claimRecoveryNotice({ root, binding, directory });
  if (claim.status !== 'claimed') return claim;
  const request = beginRecoveryNoticeSend({ directory, eventId: claim.eventId });
  if (request.status !== 'send-once') return request;
  let result;
  try {
    result = await send({ roomId: request.roomId, text: request.text, eventId: request.eventId });
  } catch {
    result = { status: 'unknown' };
  }
  return recordRecoveryNoticeReceipt({ directory, eventId: request.eventId, result });
}
