import assert from 'node:assert/strict';
// Produces a narrow patch for the root's existing board connector. No token, network client,
// status-lane override, synthetic task or task completion is created by this module.
export function continuityBoardPatch(observation, binding, current, observedAt, now = Date.now()) {
  assert.equal(observation.task, binding.task, 'Exact source task binding required');
  assert.ok(Number.isInteger(current.revision) && current.revision >= 0, 'Valid board revision required');
  assert.ok(Number.isFinite(Date.parse(current.updated_at)), 'Valid board timestamp required');
  assert.equal(current.id, binding.taskStableId, 'Exact existing task required');
  assert.ok(
    Number.isFinite(observedAt) && now >= observedAt && now - observedAt <= 120000,
    'Refresh stale observation',
  );
  if (
    !['interrupted', 'blocked', 'review-needed', 'unknown', 'registration-incomplete'].includes(observation.status) ||
    current.status === 'done'
  )
    return null;
  if (Date.parse(current.updated_at) > observedAt) return null; // A newer owner update wins.
  const labels = {
    interrupted: '⚠️ 中断待核实：原阶段执行进程已退出，保留现场。',
    blocked: '⚠️ 执行失败：原阶段有失败记录，具体原因需核实。',
    'review-needed': '⏳ 长时间无新进展记录：需要核查，不等于任务中断。',
    unknown: '❔ 状态未知：证据不足，不能判断任务是否中断。',
    'registration-incomplete': '❔ 监测登记不完整：尚不具备准确通知条件。',
  };
  const current_work = labels[observation.status];
  const next_step = '核实原执行者、最新进展和证据，向本对话说明；监测不会自动续接或移动栏目。';
  if (current.current_work === current_work && current.next_step === next_step) return null;
  return {
    id: current.id,
    revision: current.revision,
    current_work,
    next_step,
    evidence: `中断观察：${observation.task}；${observation.reason}；${new Date(observedAt).toISOString()}。未改变任务栏位，未声称已经恢复。`,
  };
}

// Connector transport is supplied by the root; a revision conflict is never retried against
// a new revision without refreshing the original task observation.
export async function syncContinuityBoard({ observation, binding, observedAt, readTask, updateTask, now = Date.now }) {
  const current = await readTask(binding.taskStableId);
  const patch = continuityBoardPatch(observation, binding, current, observedAt, now());
  if (!patch) return { status: 'unchanged', resumePermitted: false };
  try {
    const result = await updateTask(patch);
    if (
      result?.conflict === true ||
      result?.isError === true ||
      result?.id !== patch.id ||
      result?.revision !== patch.revision + 1
    )
      return {
        status: 'unconfirmed',
        reason: 'Update receipt conflicts or lacks exact new revision; re-read before another action',
        resumePermitted: false,
      };
    return {
      status: 'updated',
      task: patch.id,
      revision: result.revision,
      nextAction: 'notify-owner-with-exact-blocker',
      resumePermitted: false,
    };
  } catch (error) {
    return { status: 'unconfirmed', reason: error.message, resumePermitted: false };
  }
}
