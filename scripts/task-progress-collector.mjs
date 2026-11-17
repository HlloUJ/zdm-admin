import assert from 'node:assert/strict';
import { taskExecutor, taskMonitoring } from './task-execution-binding.mjs';
import { readTaskCoordination } from './task-coordination.mjs';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { inspectTaskProgress } from './task-progress-monitor.mjs';

function safe(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    try {
      assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked progress input refused');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (p === path.dirname(p)) break;
  }
}
function read(file) {
  safe(file);
  return JSON.parse(readFileSync(file, 'utf8'));
}
// Local disk evidence only. The root must independently verify platform worker identity.
export function collectTaskProgress(root, options = {}) {
  const registry = createTaskRegistry(root);
  const coordinator = readTaskCoordination(registry.commonDir)?.current.rootThreadId;
  return registry
    .list()
    .filter((task) => task.executionBindings || Object.hasOwn(task, 'monitoring'))
    .map((task) => {
      const monitoring = taskMonitoring(task);
      const metadata = {
        task: task.id,
        owner: taskExecutor(task),
        ...(task.executionBindings ? { historicalOwner: task.owner } : {}),
        ...(coordinator || monitoring?.coordinatorThreadId
          ? { coordinatorThreadId: coordinator ?? monitoring.coordinatorThreadId }
          : {}),
        monitoring,
        ...Object.fromEntries(
          ['taskNumber', 'taskName', 'taskStableId', 'roomId', 'worker', 'rootThreadId', 'authorizationRef'].map(
            (key) => [key, monitoring?.[key] ?? null],
          ),
        ),
        automaticResumptionEnabled: false,
        rootVerificationRequired: true,
      };
      if (
        !monitoring ||
        monitoring.state !== 'registered' ||
        metadata.owner !== monitoring.owner ||
        ['taskNumber', 'taskName', 'taskStableId', 'roomId', 'worker', 'rootThreadId', 'authorizationRef'].some(
          (key) => !metadata[key],
        )
      )
        return {
          ...metadata,
          status: 'registration-incomplete',
          reason: monitoring?.reason ?? 'Notification identity metadata incomplete',
        };
      try {
        if (task.stage === 'closed') return { ...inspectTaskProgress(task, null, options), ...metadata };
        assert.equal(typeof monitoring.paused, 'boolean', 'Monitoring pause state unknown');
        const paused = monitoring.paused;
        const file = path.join(registry.commonDir, 'task-delivery', task.id, 'completion-session.json');
        safe(file);
        const completion = existsSync(file) ? read(file) : null;
        const observed = inspectTaskProgress(task, completion, { ...options, paused });
        return { ...observed, ...metadata, status: observed.status === 'unobserved' ? 'unknown' : observed.status };
      } catch (error) {
        return { ...metadata, status: 'unknown', reason: `Monitoring evidence unavailable: ${error.message}` };
      }
    });
}
