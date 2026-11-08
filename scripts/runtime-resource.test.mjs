import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dataResource } from './runtime-resource.mjs';
import { createResourceLeases } from './resource-lease.mjs';
const data = (value) => ({
  status: 'ready',
  database: 'zdm_task_' + value.repeat(16),
  mediaVolume: 'zdm-task-media-' + value.repeat(16),
});
test('data resource keys bind schema and media while rejecting integration or unknown bindings', () => {
  assert.equal(
    dataResource(data('a')),
    dataResource({ ...data('a'), password: 'different credentials are not a different database' }),
  );
  assert.notEqual(dataResource(data('a')), dataResource(data('b')));
  assert.throws(() => dataResource({ ...data('a'), database: 'zdm_admin' }));
  assert.throws(() => dataResource({ ...data('a'), mediaVolume: 'zdm-admin_zdm_craft_images' }));
});
test('a shared data migration excludes another writer and isolated databases can prepare independently', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-resource-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const leases = createResourceLeases(root),
    a = dataResource(data('a')),
    b = dataResource(data('b'));
  await leases.run(a, 'task-a', async () => {
    assert.throws(() => leases.acquire(a, 'task-b'), /owned/);
    await leases.run(b, 'task-b', async () => {
      assert.equal(leases.inspect(a).task, 'task-a');
      assert.equal(leases.inspect(b).task, 'task-b');
    });
    assert.equal(leases.inspect(b), null);
  });
  assert.equal(leases.inspect(a), null);
});
