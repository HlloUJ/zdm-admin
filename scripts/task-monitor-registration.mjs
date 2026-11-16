import assert from 'node:assert/strict';

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
  return {
    ...base,
    state: 'registered',
    platformWorkerVerified: false,
    ...Object.fromEntries(fields.map((key) => [key, context[key]])),
    ...(context.executionSurface ? { executionSurface: context.executionSurface } : {}),
  };
}

// Formal new starts require real, exact metadata. Legacy registry readers remain compatible.
export function requireStartMonitoring(owner, taskId, context) {
  assert.ok(context !== undefined, 'Formal new task requires --monitor-context before claiming or starting');
  const registration = monitoringRegistration(owner, context);
  assert.equal(registration.taskStableId, taskId, 'Monitoring taskStableId must match the exact task');
  return registration;
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
  requireStartMonitoring(
    value('--owner') || process.env.CODEX_THREAD_ID,
    slug,
    raw === undefined ? undefined : JSON.parse(raw),
  );
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
    monitoringRegistration(task.owner, context); // Existing explicit carrier-to-board bindings remain valid.
    for (const key of [
      'taskNumber',
      'taskName',
      'taskStableId',
      'worker',
      'rootThreadId',
      'roomId',
      'authorizationRef',
      'executionSurface',
    ])
      assert.equal(saved.monitoring?.[key], context[key], 'Monitoring readback differs: ' + key);
    assert.equal(saved.monitoring.state, 'registered');
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
