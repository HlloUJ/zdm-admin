import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Detection is not recovery. Unknown/missing execution evidence is never a task failure.
export function interruptionNotice(binding, observation, { connected, paused, now, observedAt }) {
  if (connected !== true || paused !== false) return null;
  if (!Number.isFinite(now) || !Number.isFinite(observedAt) || observedAt > now || now - observedAt > 60_000)
    return null;
  if (binding?.monitoringMode !== 'confirmed-interruption-notice-only' || binding.resumeAllowed !== false) return null;
  for (const key of ['task', 'taskNumber', 'taskName', 'owner', 'worker', 'rootThreadId', 'roomId', 'authorizationRef'])
    assert.ok(typeof binding[key] === 'string' && binding[key].trim(), 'Incomplete monitoring registration');
  assert.equal(observation.task, binding.task, 'Observation task mismatch');
  let identity, reason;
  if (observation.status === 'interrupted') {
    const absent = observation.observations?.filter((item) => item.owner === 'absent');
    if (!absent?.length || absent.some((item) => !item.id || !item.stage)) return null;
    identity = absent.map(({ id, stage }) => ({ id, stage })).sort((a, b) => a.id.localeCompare(b.id));
    reason = '已记录的执行进程已退出，任务阶段未记录结束；中断原因待查。';
  } else if (observation.status === 'blocked') {
    const event = observation.failureEvent;
    // A corrupt file/permission error also produces "blocked" in the old observer. Not a business failure.
    if (!event?.id || event.status !== 'failure' || !Number.isFinite(event.finishedAt)) return null;
    identity = { id: event.id, stage: event.name };
    reason = '原执行阶段已记录失败；具体原因待核实。';
  } else if (['review-needed', 'unknown', 'registration-incomplete'].includes(observation.status)) {
    identity = { status: observation.status, reason: observation.reason, anchor: observation.anchor ?? null };
    reason =
      observation.status === 'review-needed'
        ? '长时间没有新的进展记录，需要核查；这不代表任务已中断。'
        : observation.status === 'registration-incomplete'
          ? '监测登记不完整，当前无法可靠监测。'
          : '当前状态未知，尚不能确认是否中断。';
  } else return null;
  const eventId = createHash('sha256')
    .update(JSON.stringify({ task: binding.task, owner: binding.owner, identity }))
    .digest('hex');
  return {
    version: 1,
    eventId,
    task: binding.task,
    rootThreadId: binding.rootThreadId,
    roomId: binding.roomId,
    text: `任务 ${binding.taskNumber}「${binding.taskName}」需要关注：${reason} 未自动续接。`,
    automaticResumptionEnabled: false,
  };
}

function safe(directory) {
  for (let p = path.resolve(directory); ; p = path.dirname(p)) {
    if (fs.existsSync(p)) assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Linked notice state refused');
    if (p === path.dirname(p)) break;
  }
}
function create(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
export function claimInterruptionNotice(directory, notice) {
  assert.equal(process.env.CODEX_THREAD_ID, notice.rootThreadId, 'Original root required');
  assert.match(notice.eventId, /^[a-f0-9]{64}$/);
  assert.equal(notice.automaticResumptionEnabled, false);
  safe(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, notice.eventId + '.json');
  safe(file);
  try {
    create(file, { ...notice, state: 'sending-or-unknown' });
  } catch (error) {
    if (error.code === 'EEXIST') return { status: 'reconcile-existing', eventId: notice.eventId };
    throw error;
  }
  return { status: 'send-once', eventId: notice.eventId, roomId: notice.roomId, text: notice.text };
}
export function receiptInterruptionNotice(directory, notice, { messageId, readbackText, readbackRoom }) {
  assert.equal(process.env.CODEX_THREAD_ID, notice.rootThreadId, 'Original root required');
  assert.match(notice.eventId, /^[a-f0-9]{64}$/);
  safe(directory);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, notice.eventId + '.json'))), {
    ...notice,
    state: 'sending-or-unknown',
  });
  assert.ok(typeof messageId === 'string' && messageId.trim());
  assert.equal(readbackText, notice.text);
  assert.equal(readbackRoom, notice.roomId);
  create(path.join(directory, notice.eventId + '.receipt.json'), {
    eventId: notice.eventId,
    messageId,
    roomId: readbackRoom,
    state: 'delivered',
  });
}
