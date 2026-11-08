import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';

export function dataResource(data) {
  assert.ok(
    data?.status === 'ready' && /^zdm_task_[a-f0-9]{16}$/.test(data.database),
    'An existing isolated data binding is required',
  );
  assert.ok(/^zdm-task-media-[a-f0-9]{16}$/.test(data.mediaVolume), 'Isolated media binding required');
  return (
    'data-' +
    createHash('sha256')
      .update(JSON.stringify([data.database, data.mediaVolume]))
      .digest('hex')
  );
}
export function withPreviewDataLease(root, data, project, port, action) {
  const registry = createTaskRegistry(root),
    leases = createResourceLeases(registry.commonDir);
  return leases.run(dataResource(data), project, () => leases.run('backend-port-' + port, project, action));
}
