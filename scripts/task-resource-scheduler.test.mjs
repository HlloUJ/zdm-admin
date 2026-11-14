import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  initialSchedulerState,
  registerJob,
  planTick,
  recordStarted,
  recordExit,
  recoverJob,
  acknowledgeNotification,
} from './task-resource-scheduler.mjs';
import { openSchedulerStore } from './task-resource-scheduler-store.mjs';
const G = 1024 ** 3;
const sample = (at, overrides = {}) => ({
  at,
  macAvailableBytes: 12 * G,
  dockerAvailableBytes: 6 * G,
  diskAvailableBytes: 22 * G,
  cpuBusyPercent: 20,
  memoryPressure: false,
  swapGrowing: false,
  ioCongested: false,
  ...overrides,
});
const job = (id, overrides = {}) => ({
  id,
  task: id,
  stage: 'tests',
  fingerprint: 'abc',
  worktree: '/isolated/' + id,
  macPeakBytes: G,
  dockerPeakBytes: G,
  resources: [],
  restartable: true,
  ...overrides,
});
function ready(count = 1) {
  const s = initialSchedulerState();
  for (let i = 0; i < count; i++) registerJob(s, job(String(i)));
  planTick(s, sample(0), 0);
  return s;
}
function running() {
  const s = ready();
  planTick(s, sample(60000), 60000);
  recordStarted(s, '0', { pid: 123, startTime: 'exact', runToken: 'token', fingerprint: 'abc' }, 60001);
  return s;
}
test('stable sixty seconds then two Docker groups, no unbounded concurrency', () => {
  const s = ready(5);
  assert.equal(planTick(s, sample(59999), 59999).length, 0);
  assert.equal(planTick(s, sample(60000), 60000).length, 2);
});
test('unknown or stale readings do not admit work', () => {
  for (const value of [null, sample(0), sample(60000, { dockerAvailableBytes: NaN })]) {
    const s = ready();
    assert.deepEqual(planTick(s, value, 60000), []);
  }
});
test('memory, swap, CPU and IO pressure reset stable window', () => {
  for (const change of [
    { memoryPressure: true },
    { swapGrowing: true },
    { ioCongested: true },
    { cpuBusyPercent: 90 },
  ]) {
    const s = ready();
    planTick(s, sample(30000, change), 30000);
    assert.equal(planTick(s, sample(60000), 60000).length, 0);
    assert.equal(planTick(s, sample(120000), 120000).length, 1);
  }
});
test('exclusive resources and full peak reservations prevent overbooking', () => {
  const s = ready(0);
  registerJob(s, job('a', { resources: ['db'] }));
  registerJob(s, job('b', { resources: ['db'] }));
  assert.equal(planTick(s, sample(60000), 60000).length, 1);
});
test('critical pressure requests TERM only for one verified owned restartable group', () => {
  const s = running();
  assert.deepEqual(planTick(s, sample(61000, { dockerAvailableBytes: 0.5 * G }), 61000), [
    { kind: 'stop-owned', job: '0', signal: 'SIGTERM' },
  ]);
  assert.equal(s.jobs[0].status, 'stopping');
  assert.equal(planTick(s, sample(62000, { dockerAvailableBytes: 0.5 * G }), 62000).length, 0);
});
test('unknown ownership never produces a stop action', () => {
  const s = running();
  s.jobs[0].ownershipVerified = false;
  assert.deepEqual(planTick(s, sample(61000, { dockerAvailableBytes: 0.5 * G }), 61000), []);
});
test('pause waits for termination, keeps old evidence, reruns only interrupted phase', () => {
  const s = running();
  s.jobs[0].evidence = ['prior-phase'];
  planTick(s, sample(61000, { dockerAvailableBytes: 0.5 * G }), 61000);
  assert.throws(() => recordExit(s, '0', { runToken: 'token', processesEnded: false }, 62000));
  recordExit(s, '0', { runToken: 'token', processesEnded: true }, 62000);
  assert.equal(s.jobs[0].status, 'resource-paused');
  assert.deepEqual(s.jobs[0].evidence, ['prior-phase']);
  planTick(s, sample(63000), 63000);
  assert.equal(planTick(s, sample(123000), 123000)[0].kind, 'start-verified');
});
test('ordinary failure never automatically retries', () => {
  const s = running();
  recordExit(s, '0', { runToken: 'token', processesEnded: true, code: 1 }, 62000);
  assert.equal(s.jobs[0].status, 'blocked');
  assert.deepEqual(planTick(s, sample(120000), 120000), []);
});
test('success requires matching fingerprint and evidence', () => {
  const s = running();
  recordExit(
    s,
    '0',
    { runToken: 'token', processesEnded: true, code: 0, fingerprint: 'other', evidence: 'report' },
    62000,
  );
  assert.equal(s.jobs[0].status, 'blocked');
});
test('bounded resource interruption budget', () => {
  const s = ready();
  s.jobs[0].status = 'resource-paused';
  s.jobs[0].interruptions = 3;
  assert.deepEqual(planTick(s, sample(60000), 60000), []);
  assert.equal(s.jobs[0].status, 'blocked');
});
test('restart with unproved identity/source blocks rather than starting duplicate', () => {
  const s = running();
  recoverJob(s, '0', { processesEnded: false, fingerprint: 'abc' }, 65000);
  assert.equal(s.jobs[0].status, 'blocked');
});
test('safe interrupted recovery clears healthy window and reruns stage', () => {
  const s = running();
  recoverJob(s, '0', { processesEnded: true, fingerprint: 'abc' }, 65000);
  assert.equal(s.jobs[0].status, 'resource-paused');
  assert.equal(s.healthySince, null);
});
test('every transition records task action reason; logs alone cannot ack notifications', () => {
  const s = running();
  assert.ok(s.events.every((e) => e.task && e.from && e.to && e.reason && !e.delivered));
  assert.throws(() => acknowledgeNotification(s, 1, {}));
  acknowledgeNotification(s, 1, { destination: 'user-room', messageId: 'verified' });
  assert.equal(s.events[0].delivered, true);
});
test('single lock and durable restart roundtrip preserve events/evidence', () => {
  const d = mkdtempSync(path.join(process.cwd(), '.task-runtime/scheduler-test-'));
  try {
    const store = openSchedulerStore(d);
    assert.throws(() => openSchedulerStore(d));
    const s = running();
    store.write(s);
    assert.deepEqual(store.read(), s);
    store.close();
    const next = openSchedulerStore(d);
    assert.deepEqual(next.read(), s);
    next.close();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
