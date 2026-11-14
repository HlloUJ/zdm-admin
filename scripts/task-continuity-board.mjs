import assert from 'node:assert/strict';
// Produces a narrow patch for the root's existing board connector. No token, network client,
// status-lane override, synthetic task or task completion is created by this module.
export function continuityBoardPatch(observation, binding, current, observedAt, now = Date.now()) {
  assert.equal(current.id, binding.taskStableId, 'Exact existing task required');
  assert.ok(
    Number.isFinite(observedAt) && now >= observedAt && now - observedAt <= 120000,
    'Refresh stale observation',
  );
  if (!['interrupted', 'blocked'].includes(observation.status) || current.status === 'done') return null;
  if (Date.parse(current.updated_at) > observedAt) return null; // A newer owner update wins.
  const current_work =
    observation.status === 'interrupted'
      ? '检测到原阶段执行者已结束；尚未证明安全续接，保留原任务现场。'
      : '原阶段记录为失败或受阻；尚未恢复执行，保留首次失败与原证据。';
  const next_step = '核对原执行者、上一步结果及资源归属；满足原流程条件才续接，不能确定则报告准确阻点。';
  if (current.current_work === current_work && current.next_step === next_step) return null;
  return {
    id: current.id,
    revision: current.revision,
    current_work,
    next_step,
    evidence: `中断观察：${observation.task}；${observation.reason}；${new Date(observedAt).toISOString()}。未改变任务栏位，未声称已经恢复。`,
  };
}
