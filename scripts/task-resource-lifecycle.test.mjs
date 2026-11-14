import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchedulerLifecycle, assessExternalRecovery } from './task-resource-lifecycle.mjs';
import { createAdmissionBroker } from './task-resource-broker.mjs';
import { initialSchedulerState } from './task-resource-scheduler.mjs';
const proof = { pid: 1234, startTime: 'original', runToken: 'run' };
const job = {
  spawnProof: proof,
  fingerprint: 'source',
  externalManifest: {
    runToken: 'run',
    fingerprint: 'source',
    complete: true,
    containers: [{ id: 'exact-container', runToken: 'run' }],
    leases: [{ resource: 'exact-lease', tokenDigest: 'hash' }],
  },
};
const observations = {
  runToken: 'run',
  requestedAt: 1,
  observedAt: 2,
  process: { status: 'absent', pid: 1234, expectedStartTime: 'original' },
  containers: [{ id: 'exact-container', runToken: 'run', status: 'stopped' }],
  leases: [{ resource: 'exact-lease', tokenDigest: 'hash', runToken: 'run', status: 'released-by-owner' }],
};
test('external recovery never equates termination to success or automatic retry', () => {
  const r = assessExternalRecovery({ job, observations, now: 2 });
  assert.equal(r.resourcesEnded, true);
  assert.equal(r.successEvidence, false);
  assert.equal(r.restartAutomatically, false);
  assert.equal(r.releaseAutomatically, false);
});
test('missing manifest, live containers, foreign identity or held lease always block recovery', () => {
  for (const patch of [
    { runToken: 'other' },
    { process: { status: 'running' } },
    { containers: [{ id: 'exact-container', runToken: 'run', status: 'running' }] },
    { leases: [] },
  ])
    assert.equal(
      assessExternalRecovery({ job, observations: { ...observations, ...patch }, now: 2 }).resourcesEnded,
      false,
    );
  assert.equal(assessExternalRecovery({ job: { spawnProof: proof }, observations }).resourcesEnded, false);
});
test('lifecycle cannot close active or unknown work or turn off reservations', () => {
  let closed = 0;
  const jobs = [{ id: 'one', status: 'running' }];
  const l = createSchedulerLifecycle({
    broker: { quiesce() {}, snapshot: () => ({ jobs }) },
    closeOwnedStores: () => closed++,
  });
  assert.equal(l.drain().canClose, false);
  assert.throws(() => l.close(), /must finish/);
  jobs[0] = { id: 'one', status: 'blocked', runtimeUncertain: true };
  assert.throws(() => l.close());
  assert.equal(closed, 0);
  jobs[0] = { id: 'one', status: 'done' };
  assert.equal(l.close().phase, 'stopped');
  assert.equal(closed, 1);
});
test('drain withdraws unexecuted admissions and refuses new requests without killing a process', async () => {
  let state = initialSchedulerState();
  const broker = createAdmissionBroker({
    store: {
      read: () => structuredClone(state),
      write: (s) => {
        state = structuredClone(s);
      },
    },
    budget: () => ({ macPeakBytes: 1, dockerPeakBytes: 0 }),
    validateEvidence: () => true,
  });
  const descriptor = {
    task: 't',
    stage: 's',
    worktree: '/fixture',
    fingerprint: 'f',
    resources: [],
    restartable: false,
    externalResources: true,
  };
  const ticket = await broker.enqueue(descriptor);
  await broker.pollAdmission(ticket, 'same-caller-claim');
  const lifecycle = createSchedulerLifecycle({ broker, closeOwnedStores() {} });
  assert.equal(lifecycle.drain().canClose, true);
  assert.equal(state.jobs[0].status, 'waiting-client');
  await assert.rejects(broker.pollAdmission(ticket, 'same-caller-claim'), /draining/);
  await assert.rejects(broker.enqueue(descriptor), /draining/);
  assert.deepEqual(broker.tick({}), []);
  assert.equal(lifecycle.close().phase, 'stopped');
});

test('stale or wrong PID observations cannot certify resources ended', () => {
  assert.equal(assessExternalRecovery({ job, observations, now: 20000 }).resourcesEnded, false);
  assert.equal(
    assessExternalRecovery({
      job,
      observations: { ...observations, process: { status: 'absent', pid: 9999, expectedStartTime: 'original' } },
      now: 2,
    }).resourcesEnded,
    false,
  );
});
test('actual isolated coordinator exit leaves its lock and active record blocked, not auto-adopted', async (t) => {
  const { mkdtempSync, realpathSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { openSchedulerStore } = await import('./task-resource-scheduler-store.mjs');
  const { inspectSchedulerRecovery } = await import('./task-resource-recovery.mjs');
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'zdm921-life-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const moduleUrl = new URL('./task-resource-scheduler-store.mjs', import.meta.url).href;
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import {openSchedulerStore} from ${JSON.stringify(moduleUrl)}; const store=openSchedulerStore(${JSON.stringify(dir)});const s=store.read();s.jobs=[{id:'fixture',task:'fixture',status:'running',runtimeUncertain:true}];store.write(s);process.exit(0);`,
  ]);
  const r = inspectSchedulerRecovery(dir);
  assert.equal(r.lockPresent, true);
  assert.equal(r.cleanOpenPossible, false);
  assert.equal(r.unresolved.length, 1);
  assert.throws(() => openSchedulerStore(dir));
});
