import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createTaskRegistry } from './task-registry.mjs';
import { captureIdentity } from './verification-evidence.mjs';
import { executeVerification } from './verify.mjs';
import { createScheduledVerification } from './task-resource-verification.mjs';
// Candidate integration point for a published launcher. Does not replace task:entry,
// launch a service, import legacy leases, or authorize a task by its recycled display number.
export function createScheduledPlanExecutor({
  taskId,
  owner,
  broker,
  resolveTask = (root) => createTaskRegistry(root).resolve({ id: taskId, worktree: root }),
  canonical = realpathSync,
  run,
  inspect,
}) {
  assert.ok(taskId && owner);
  return async (plan, options = {}) => {
    const root = canonical(plan.preflight.root);
    const task = resolveTask(root);
    assert.equal(task.id, taskId, 'Exact registered task required');
    assert.equal(task.owner, owner, 'Current owner must match task registration');
    assert.equal(canonical(task.worktree), root, 'Task worktree mismatch');
    assert.ok(
      ['developing', 'dev-validated', 'blocked'].includes(task.stage) && !task.frozen,
      'Frozen delivery must use original delivery path',
    );
    const stages = [
      plan.preflight,
      ...(plan.earlyChecks ?? []),
      plan.contractPreflight,
      plan.runtime,
      ...(plan.frontend ?? []),
      ...(plan.backend ?? []),
      ...(plan.engineering ?? []),
    ].filter(Boolean);
    for (const step of stages) assert.equal(canonical(step.root), root, 'Stage crosses task worktree');
    // These stages stay intact; injection is the existing original executor's public run hook.
    const scheduled = createScheduledVerification({
      taskId,
      broker,
      ...(run ? { run } : {}),
      inspect: (step) => {
        const current = resolveTask(root);
        assert.equal(current.id, taskId);
        assert.equal(current.owner, owner);
        assert.ok(
          !current.frozen && ['developing', 'dev-validated', 'blocked'].includes(current.stage),
          'Task changed before execution',
        );
        return (inspect ?? captureIdentity)(step);
      },
    });
    return executeVerification(plan, {
      ...options,
      run: async (step, runOptions) => {
        assert.equal(canonical(step.root), root, 'Stage crosses task worktree');
        const latest = resolveTask(root);
        assert.equal(latest.id, taskId);
        assert.equal(latest.owner, owner);
        assert.ok(
          !latest.frozen && ['developing', 'dev-validated', 'blocked'].includes(latest.stage),
          'Task changed while queued',
        );
        return scheduled(step, runOptions);
      },
    });
  };
}
