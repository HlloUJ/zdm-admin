import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Candidate recorder: existing gates are NOT instrumented by importing this module.
// Inventory validation must come from a reviewed adapter; no default assumption of complete coverage.
export function createExternalManifestRecorder({ store, run, inventory, validateInventory }) {
  run = structuredClone(run);
  inventory = structuredClone(inventory);
  assert.ok(run?.runToken && run.task && run.fingerprint);
  assert.equal(typeof validateInventory, 'function');
  assert.equal(validateInventory(inventory, run), true, 'Reviewed complete resource inventory required');
  assert.ok(Array.isArray(inventory));
  assert.equal(new Set(inventory.map((v) => v.key)).size, inventory.length);
  for (const v of inventory) assert.ok(v.key && ['container', 'lease'].includes(v.kind) && v.resource);
  let state = store.read();
  state.externalRuns ??= {};
  const save = (next) => {
    store.write(next);
    state = next;
  };
  const identity = digest({ run, inventory });
  const existing = state.externalRuns[run.runToken];
  if (existing) assert.equal(existing.identity, identity, 'Manifest belongs to different source/inventory');
  else {
    const next = structuredClone(state);
    next.externalRuns[run.runToken] = {
      identity,
      run: structuredClone(run),
      inventory: structuredClone(inventory),
      resources: {},
      sealed: false,
    };
    save(next);
  }
  const record = () => state.externalRuns[run.runToken];
  const change = (fn) => {
    const next = structuredClone(state);
    fn(next.externalRuns[run.runToken]);
    save(next);
  };
  const declared = (key) => {
    const entry = inventory.find((v) => v.key === key);
    assert.ok(entry, 'Undeclared resource cannot be acquired');
    return entry;
  };
  return {
    intend(key, actual = {}) {
      const expected = declared(key);
      if (actual.resource !== undefined)
        assert.equal(actual.resource, expected.resource, 'Resource must match declared inventory before acquisition');
      if (actual.task !== undefined) assert.equal(actual.task, run.task, 'Task must match before acquisition');
      assert.ok(!record().sealed && !record().resources[key], 'Resource intent already exists or manifest sealed');
      change((r) => {
        r.resources[key] = { status: 'intent' };
      });
    },
    acquiredLease(key, lease) {
      const expected = declared(key);
      assert.equal(expected.kind, 'lease');
      assert.equal(lease.task, run.task);
      assert.equal(lease.resource, expected.resource);
      assert.ok(lease.token);
      assert.equal(record().resources[key]?.status, 'intent');
      change((r) => {
        r.resources[key] = {
          status: 'acquired',
          resource: lease.resource,
          task: lease.task,
          runToken: run.runToken,
          tokenDigest: digest(lease.token),
        };
      });
    },
    acquiredContainer(key, inspection) {
      const expected = declared(key);
      assert.equal(expected.kind, 'container');
      assert.match(inspection.Id, /^[a-f0-9]{64}$/);
      assert.equal(inspection.Name.replace(/^\//, ''), expected.resource);
      assert.equal(inspection.Config?.Labels?.['com.zdm.scheduler.run'], run.runToken);
      assert.equal(inspection.Config?.Labels?.['com.zdm.scheduler.task'], run.task);
      assert.equal(record().resources[key]?.status, 'intent');
      change((r) => {
        r.resources[key] = {
          status: 'acquired',
          id: inspection.Id,
          resource: expected.resource,
          runToken: run.runToken,
        };
      });
    },
    releasedLease(key, lease, remaining) {
      const previous = record().resources[key];
      assert.equal(previous?.status, 'acquired');
      assert.equal(previous.tokenDigest, digest(lease.token));
      assert.equal(previous.resource, lease.resource);
      assert.equal(lease.task, run.task);
      assert.equal(remaining, null, 'Lease remains or belongs to another owner');
      change((r) => {
        r.resources[key].status = 'released-by-owner';
      });
    },
    seal() {
      assert.ok(
        inventory.every((v) => ['acquired', 'released-by-owner'].includes(record().resources[v.key]?.status)),
        'Unresolved acquisition intent; manifest incomplete',
      );
      change((r) => {
        r.sealed = true;
      });
    },
    snapshot() {
      const r = record();
      return {
        runToken: run.runToken,
        task: run.task,
        fingerprint: run.fingerprint,
        complete: r.sealed,
        unresolved: inventory
          .filter((v) => !r.resources[v.key] || r.resources[v.key].status === 'intent')
          .map((v) => v.key),
        containers: inventory
          .filter((v) => v.kind === 'container' && r.resources[v.key]?.id)
          .map((v) => structuredClone(r.resources[v.key])),
        leases: inventory
          .filter((v) => v.kind === 'lease' && r.resources[v.key]?.tokenDigest)
          .map((v) => structuredClone(r.resources[v.key])),
      };
    },
  };
}
// Does not change the original lease implementation. Used only by an explicitly reviewed future adapter.
export function createTrackedLeaseAdapter({ leases, recorder, task }) {
  return {
    acquire(key, resource) {
      recorder.intend(key, { resource, task });
      const lease = leases.acquire(resource, task);
      recorder.acquiredLease(key, lease);
      return lease;
    },
    release(key, lease) {
      leases.release(lease);
      recorder.releasedLease(key, lease, leases.inspect(lease.resource));
    },
  };
}
