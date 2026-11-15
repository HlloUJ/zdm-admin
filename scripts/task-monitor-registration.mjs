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
  assert.match(context.worker, /^\/root\/[a-z0-9_/]+$/);
  // This stores provenance, not a fabricated platform liveness check.
  return {
    ...base,
    state: 'registered',
    platformWorkerVerified: false,
    ...Object.fromEntries(fields.map((key) => [key, context[key]])),
  };
}
