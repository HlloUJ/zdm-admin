import assert from 'node:assert/strict';
import { taskExecutor, taskMonitoring } from './task-execution-binding.mjs';

// Written with the new task registry record, never backfilled into historical tasks.
export function monitoringRegistration(owner, context, runtimeOwner = process.env.CODEX_THREAD_ID) {
  const base = {
    version: 1,
    mode: 'confirmed-interruption-notice-only',
    paused: false,
    automaticResumptionEnabled: false,
    owner,
    runtimeOwnerVerified: runtimeOwner === owner,
    registeredAt: new Date().toISOString(),
  };
  if (context === undefined)
    return { ...base, state: 'pending-context', reason: 'Notification identity metadata not supplied' };
  assert.ok(context && typeof context === 'object' && !Array.isArray(context), 'Monitoring context must be an object');
  assert.equal(runtimeOwner, owner, 'Real runtime owner required for monitoring context');
  const fields = ['taskNumber', 'taskName', 'taskStableId', 'worker', 'rootThreadId', 'roomId', 'authorizationRef'];
  for (const key of fields)
    assert.ok(typeof context[key] === 'string' && context[key].trim(), `Missing monitoring ${key}`);
  if (context.executionSurface === 'codex-thread') {
    assert.match(context.worker, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.equal(context.worker, owner, 'Native thread must be the actual execution owner');
  } else if (context.executionSurface === 'collaboration-agent') {
    assert.match(context.worker, /^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/);
    assert.equal(context.rootThreadId, owner, 'Collaboration executor belongs to the real coordinator thread');
  } else {
    assert.equal(context.executionSurface, undefined, 'Unknown execution surface');
    assert.match(context.worker, /^\/root\/[a-z0-9_/]+$/);
  }
  // This stores provenance, not a fabricated platform liveness check.
  if (context.coordinatorThreadId !== undefined)
    assert.match(context.coordinatorThreadId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  return {
    ...base,
    state: 'registered',
    platformWorkerVerified: false,
    ...Object.fromEntries(fields.map((key) => [key, context[key]])),
    ...(context.executionSurface ? { executionSurface: context.executionSurface } : {}),
    ...(context.coordinatorThreadId ? { coordinatorThreadId: context.coordinatorThreadId } : {}),
  };
}

// Formal new starts require real, exact metadata. Legacy registry readers remain compatible.
export function requireStartMonitoring(owner, taskId, context) {
  assert.ok(context !== undefined, 'Formal new task requires --monitor-context before claiming or starting');
  const registration = monitoringRegistration(owner, context);
  assert.equal(registration.taskStableId, taskId, 'Monitoring taskStableId must match the exact task');
  return registration;
}

// Resolve invocation input only for new starts, never historical resume.
export function parseStartMonitoringContext(raw = process.env.ZDM_TASK_MONITOR_CONTEXT) {
  return raw === undefined || raw === '' ? undefined : JSON.parse(raw);
}

export function checkStartMonitoringArgs(args, registry) {
  const value = (flag) => {
    const positions = args.flatMap((arg, index) => (arg === flag ? [index] : []));
    assert.ok(positions.length <= 1, 'Duplicate task option: ' + flag);
    return positions.length ? args[positions[0] + 1] : undefined;
  };
  const slug = value('--slug');
  if (!slug || registry.readTask(slug) || args.includes('--resume')) return;
  const raw = value('--monitor-context');
  if (args.includes('--monitor-context')) assert.ok(raw && !raw.startsWith('--'), 'Missing --monitor-context value');
  const context = parseStartMonitoringContext(raw);
  requireStartMonitoring(value('--owner') || process.env.CODEX_THREAD_ID, slug, context);
  return context;
}

export function verifyStartMonitoringReadback(registry, task, context) {
  const saved = registry.readTask(task.id);
  assert.ok(saved, 'Task registration readback missing; inspect existing state, do not replay start');
  for (const key of ['id', 'owner', 'worktree', 'branch', 'revision'])
    assert.equal(saved[key], task[key], 'Task registration readback differs: ' + key);
  assert.deepEqual(
    saved.monitoring,
    task.monitoring,
    'Monitoring readback differs; inspect existing state, do not replay start',
  );
  if (context !== undefined) {
    monitoringRegistration(taskExecutor(task), context); // Keep historical monitoring unchanged.
    for (const key of [
      'taskNumber',
      'taskName',
      'taskStableId',
      'worker',
      'rootThreadId',
      'roomId',
      'authorizationRef',
      'executionSurface',
      'coordinatorThreadId',
    ])
      assert.equal(taskMonitoring(saved)?.[key], context[key], 'Monitoring readback differs: ' + key);
    if (!saved.executionBindings) assert.equal(saved.monitoring.state, 'registered');
  }
  return saved;
}

export function verifyMonitoringInstruction(context, ticket) {
  assert.ok(ticket?.request, 'Original queued user instruction required');
  assert.equal(context.roomId, ticket.request.roomId, 'Monitoring room must match original instruction');
  assert.equal(
    context.authorizationRef,
    ticket.request.messageId,
    'Monitoring authorization must match original instruction',
  );
  if (ticket.monitorContext !== undefined)
    assert.deepEqual(context, ticket.monitorContext, 'Monitoring context differs from the claimed admission');
}
