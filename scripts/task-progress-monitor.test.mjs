import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTaskProgress } from './task-progress-monitor.mjs';
import { monitoringRegistration } from './task-monitor-registration.mjs';
const task = {
  id: 'fixture',
  stage: 'developing',
  createdAt: new Date(0).toISOString(),
  monitoring: { state: 'registered' },
};
const session = {
  version: 1,
  batch: 'fixture',
  events: [{ id: 'a', name: 'prepare', status: 'running', startedAt: 1, owner: { pid: 10, host: 'fixture' } }],
};
test('only absent recorded owner proves interrupted stage', () => {
  assert.equal(inspectTaskProgress(task, session, { observeOwner: () => 'absent' }).status, 'interrupted');
  for (const state of ['unknown', 'present-unverified'])
    assert.equal(
      inspectTaskProgress(task, session, { now: 100, observeOwner: () => state }).status,
      'unverified-running',
    );
});
test('elapsed time only requests review; no records remain unknown', () => {
  assert.equal(
    inspectTaskProgress(task, session, { now: 10000, reviewAfterMs: 500, observeOwner: () => 'present-unverified' })
      .status,
    'review-needed',
  );
  assert.equal(inspectTaskProgress(task, null, { now: 10000, reviewAfterMs: 500 }).status, 'unknown');
});
test('offline, paused, closed and historical tasks never become interrupted', () => {
  assert.equal(inspectTaskProgress(task, session, { connected: false }).status, 'unknown');
  assert.equal(inspectTaskProgress(task, session, { paused: true }).status, 'paused');
  assert.equal(inspectTaskProgress({ ...task, stage: 'closed' }, session).status, 'closed');
  assert.equal(inspectTaskProgress({ ...task, monitoring: undefined }, session).status, 'unregistered');
  assert.equal(inspectTaskProgress(task, { ...session, batch: 'other' }).status, 'unknown');
});
test('automatic minimal registration never fabricates missing notification metadata', () => {
  const m = monitoringRegistration('owner', undefined, 'owner');
  assert.equal(m.state, 'pending-context');
  assert.equal(m.automaticResumptionEnabled, false);
  assert.equal(inspectTaskProgress({ ...task, monitoring: m }, session).status, 'registration-incomplete');
});
test('explicit metadata requires actual runtime owner and complete fields', () => {
  const c = {
    taskNumber: '1',
    taskName: 'fixture',
    taskStableId: 'stable',
    worker: '/root/fixture',
    rootThreadId: 'root',
    roomId: 'room',
    authorizationRef: 'auth',
  };
  assert.throws(() => monitoringRegistration('owner', c, 'foreign'));
  assert.throws(() => monitoringRegistration('owner', { ...c, roomId: '' }, 'owner'));
  const m = monitoringRegistration('owner', c, 'owner');
  assert.equal(m.state, 'registered');
  assert.equal(m.platformWorkerVerified, false);
});
