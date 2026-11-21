import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { temporaryPreviewLeases } from './preview-consumers.mjs';
import { inspectLeasedFrontend } from './task-preview-independent.mjs';
import { inspectManagedPreview } from './dev-task.mjs';

const [id, head] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
assert.match(head, /^[a-f0-9]{40}$/);
const root = process.cwd();
const registry = createTaskRegistry(root);
const task = registry.resolve({ id, worktree: root });
assert.equal(task.recordedHead, head);
assert.ok(!task.recovery?.runtimeBlocked, 'Dependency runtime recovery is restricted');
const read = () => temporaryPreviewLeases(registry.commonDir).filter((lease) => lease.task === id);
const known = read();
assert.ok(known.length, 'Dependency has no owned independent preview');
const resources = createResourceLeases(registry.commonDir);
for (const lease of known) {
  const proof = await inspectLeasedFrontend(task, lease, resources, inspectManagedPreview);
  assert.equal(proof.errors.length, 0, 'Dependency preview health or API binding is unproven');
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('./dev-task.mjs', import.meta.url)),
      '--check',
      '--worktree',
      task.worktree,
      '--port',
      String(lease.port),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 15_000,
    },
  );
  await inspectLeasedFrontend(task, lease, resources, inspectManagedPreview).then((current) =>
    assert.equal(current.errors.length, 0, 'Dependency preview changed while checking runtime'),
  );
}
assert.deepEqual(read(), known, 'Dependency runtime ownership changed');
assert.deepEqual(registry.readTask(id), task, 'Dependency registration changed');
const leaseIdentity = createHash('sha256').update(JSON.stringify(known)).digest('hex');
console.log(JSON.stringify({ head, runtimeReady: true, ports: known.map(({ port }) => port), leaseIdentity }));
