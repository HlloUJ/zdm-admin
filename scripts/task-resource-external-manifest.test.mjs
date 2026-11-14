import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalManifestRecorder, createTrackedLeaseAdapter } from './task-resource-external-manifest.mjs';
const run = { runToken: 'run', task: 'task', fingerprint: 'source' };
const inventory = [
  { key: 'lease', kind: 'lease', resource: 'task-delivery-task' },
  { key: 'container', kind: 'container', resource: 'task-owned-test' },
];
function setup() {
  let state = { version: 1 };
  const options = {
    store: {
      read: () => structuredClone(state),
      write: (s) => {
        state = structuredClone(s);
      },
    },
    run,
    inventory,
    validateInventory: () => true,
  };
  return { options, recorder: createExternalManifestRecorder(options), state: () => state };
}
const lease = { task: 'task', resource: 'task-delivery-task', token: 'original-secret-lease-token' };
const container = {
  Id: 'a'.repeat(64),
  Name: '/task-owned-test',
  Config: { Labels: { 'com.zdm.scheduler.run': 'run', 'com.zdm.scheduler.task': 'task' } },
};
test('complete manifest requires declared inventory and all post-acquisition receipts', () => {
  const s = setup();
  assert.throws(() => s.recorder.seal(), /incomplete/);
  s.recorder.intend('lease');
  s.recorder.acquiredLease('lease', lease);
  s.recorder.intend('container');
  s.recorder.acquiredContainer('container', container);
  s.recorder.seal();
  const m = s.recorder.snapshot();
  assert.equal(m.complete, true);
  assert.equal(m.containers[0].id, container.Id);
  assert.equal(JSON.stringify(s.state()).includes(lease.token), false);
});
test('crash between creation and receipt remains incomplete after reopen and cannot repeat intent', () => {
  const s = setup();
  s.recorder.intend('container');
  const restored = createExternalManifestRecorder(s.options);
  assert.equal(restored.snapshot().complete, false);
  assert.throws(() => restored.intend('container'));
  assert.throws(() => restored.seal());
});
test('foreign container labels and replacement lease cannot certify own resources', () => {
  const s = setup();
  s.recorder.intend('container');
  assert.throws(() => s.recorder.acquiredContainer('container', { ...container, Config: { Labels: {} } }));
  s.recorder.intend('lease');
  s.recorder.acquiredLease('lease', lease);
  assert.throws(() => s.recorder.releasedLease('lease', { ...lease, token: 'replacement' }, null));
  assert.throws(() => s.recorder.releasedLease('lease', lease, { ...lease }));
});
test('unreviewed inventory and changed source rejected', () => {
  const s = setup();
  assert.throws(() => createExternalManifestRecorder({ ...s.options, validateInventory: () => false }));
  assert.throws(() => createExternalManifestRecorder({ ...s.options, run: { ...run, fingerprint: 'other' } }));
  assert.throws(() => s.recorder.intend('unlisted'));
});
test('lease wrapper records intent before acquisition and preserves original release checks', () => {
  const s = setup();
  let current = null;
  const calls = [];
  const leases = {
    acquire() {
      assert.equal(s.recorder.snapshot().unresolved.includes('lease'), true);
      calls.push('acquire');
      return (current = lease);
    },
    release(v) {
      assert.equal(v.token, current.token);
      calls.push('release');
      current = null;
    },
    inspect: () => current,
  };
  const adapter = createTrackedLeaseAdapter({ leases, recorder: s.recorder, task: 'task' });
  const own = adapter.acquire('lease', 'task-delivery-task');
  adapter.release('lease', own);
  assert.deepEqual(calls, ['acquire', 'release']);
  assert.equal(s.recorder.snapshot().leases[0].status, 'released-by-owner');
});
test('intent storage failure prevents lease creation', () => {
  let create = 0;
  const s = setup();
  const options = {
    ...s.options,
    store: {
      read: () => s.state(),
      write() {
        throw Error('disk unavailable');
      },
    },
  };
  const recorder = createExternalManifestRecorder(options);
  const adapter = createTrackedLeaseAdapter({
    leases: {
      acquire() {
        create++;
      },
    },
    recorder,
    task: 'task',
  });
  assert.throws(() => adapter.acquire('lease', 'task-delivery-task'));
  assert.equal(create, 0);
});

test('wrong actual acquisition resource is rejected before touching original lease service', () => {
  const s = setup();
  let acquired = 0;
  const adapter = createTrackedLeaseAdapter({
    leases: {
      acquire() {
        acquired++;
      },
    },
    recorder: s.recorder,
    task: 'task',
  });
  assert.throws(() => adapter.acquire('lease', 'different-resource'));
  assert.equal(acquired, 0);
});
test('actual isolated original lease implementation produces exact owner release evidence', async (t) => {
  const { mkdtempSync, realpathSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createResourceLeases } = await import('./resource-lease.mjs');
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'zdm921-manifest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = setup();
  const leases = createResourceLeases(dir);
  const adapter = createTrackedLeaseAdapter({ leases, recorder: s.recorder, task: 'task' });
  const own = adapter.acquire('lease', 'task-delivery-task');
  assert.equal(leases.inspect(own.resource).token, own.token);
  adapter.release('lease', own);
  assert.equal(leases.inspect(own.resource), null);
  assert.equal(s.recorder.snapshot().leases[0].status, 'released-by-owner');
});
