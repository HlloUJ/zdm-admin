import { assertCombinationRuntime } from './task-preview-combination.mjs';
import assert from 'node:assert/strict';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { temporaryPreviewLeases } from './preview-consumers.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import { readTaskData } from './task-data-environment.mjs';
import { isolateTaskData } from './task-data-scope.mjs';
import { main as runTaskRuntime, inspectManagedPreview, taskPreviewControlRequest, isPortOpen } from './dev-task.mjs';

const leaseIdentity = (lease) => {
  const value = { ...lease };
  delete value.port;
  return value;
};
async function inspectLeasedFrontend(task, lease, resources, inspect) {
  const unchanged = () =>
    assert.deepEqual(
      resources.inspect(lease.resource),
      leaseIdentity(lease),
      'Preview ownership changed; preserve the current runtime',
    );
  unchanged();
  const proof = await inspect({
    port: lease.port,
    expectedWorkspaceRoot: task.worktree,
    expectedBranch: task.branch,
    expectedMode: 'full',
  });
  assert.equal(proof.metadata?.workspaceRoot, task.worktree, 'Preview belongs to another worktree');
  assert.equal(proof.metadata?.branch, task.branch, 'Preview belongs to another branch');
  assert.equal(proof.metadata?.mode, 'full', 'Preview does not own an isolated full runtime');
  assert.equal(
    proof.metadata?.runtimeId,
    lease.token,
    'Preview has no matching runtime nonce; retain legacy or interrupted runtime',
  );
  unchanged();
  return proof;
}

// Formal delivery uses the same exact-runtime stop protocol after freezing;
// it must not depend on an older installed launcher's DELETE implementation.
export async function stopLeasedTaskFrontend(task, lease, dependencies = {}) {
  const system = {
    leases: createResourceLeases,
    inspect: inspectManagedPreview,
    request: taskPreviewControlRequest,
    isOpen: isPortOpen,
    now: () => performance.now(),
    tick: () => new Promise((resolve) => setTimeout(resolve, 100)),
    ...dependencies,
  };
  const resources = system.leases(task.repository.commonDir);
  assert.equal(lease.task, task.id, 'Frontend lease belongs to another task');
  assert.equal(lease.resource, 'temporary-port-' + lease.port, 'Frontend lease port differs');
  await inspectLeasedFrontend(task, lease, resources, system.inspect);
  const response = await system.request(lease.port, 'DELETE', 10_000, lease.token);
  assert.equal(response.statusCode, 202, 'Runtime changed or refused stop; preserve its backend and lease');
  const deadline = system.now() + 10_000;
  while ((await system.isOpen(lease.port)) || resources.inspect(lease.resource)) {
    const current = resources.inspect(lease.resource);
    if (current) assert.deepEqual(current, leaseIdentity(lease), 'Port was reassigned; preserve the new runtime');
    assert.ok(system.now() < deadline, 'Preview owner has not released its runtime; preserve backend');
    await system.tick();
  }
}

// Reuse the existing foreground launcher and its per-port leases. No second
// supervisor, global selection or background process registry is introduced.
export async function independentTaskPreview(root, options, dependencies = {}) {
  const system = {
    registry: createTaskRegistry,
    leases: createResourceLeases,
    readLeases: temporaryPreviewLeases,
    inspect: inspectManagedPreview,
    request: taskPreviewControlRequest,
    readData: readTaskData,
    prepareData: isolateTaskData,
    run: runTaskRuntime,
    references: taskRuntimeReferences,
    isOpen: isPortOpen,
    now: () => performance.now(),
    tick: () => new Promise((resolve) => setTimeout(resolve, 100)),
    ...dependencies,
  };
  const { command, id, owner, port, backendPort } = options;
  assert.ok(['start', 'status', 'stop'].includes(command), 'Unknown independent preview operation');
  assert.ok(port == null || (Number.isInteger(port) && port >= 5177 && port <= 5199), 'Private frontend port required');
  assert.ok(
    backendPort == null || (Number.isInteger(backendPort) && backendPort >= 8081 && backendPort <= 8099),
    'Private backend port required',
  );
  const registry = system.registry(root);
  const task = registry.resolve({ id, worktree: root });
  assert.equal(owner, task.owner, 'Current chat must own this exact task');
  if (command === 'start') assertCombinationRuntime(root, task);
  const common = registry.commonDir;
  const resources = system.leases(common);
  const ownLeases = () => system.readLeases(common).filter((lease) => lease.task === task.id);
  const inspect = (lease) => inspectLeasedFrontend(task, lease, resources, system.inspect);
  async function status() {
    const before = ownLeases();
    const previews = [];
    for (const lease of before) {
      const proof = await inspect(lease);
      if (!proof.errors.length)
        await system.run(['--check', '--worktree', task.worktree, '--port', String(lease.port)]);
      previews.push({
        port: lease.port,
        url: `http://127.0.0.1:${lease.port}/`,
        api: proof.metadata.apiTarget,
        runtimeReady: proof.errors.length === 0,
        errors: proof.errors,
      });
    }
    assert.deepEqual(ownLeases(), before, 'Preview ownership changed during status');
    return {
      task: task.id,
      branch: task.branch,
      worktree: task.worktree,
      state: !previews.length ? 'not-previewing' : previews.every((p) => p.runtimeReady) ? 'running' : 'unhealthy',
      runtimeReady: previews.length > 0 && previews.every((p) => p.runtimeReady),
      verificationProven: false,
      previews,
    };
  }
  if (command === 'status') return status();
  assert.ok(
    !task.frozen && ['developing', 'dev-validated', 'blocked'].includes(task.stage),
    'Frozen or delivered task requires its formal runtime handoff',
  );
  assert.ok(!task.recovery?.runtimeBlocked, 'Historical recovery remains blocked');
  assert.equal(
    task.resources.dataScope,
    'isolated-task',
    'Legacy shared data requires a reviewed transition; do not take over unfinished task data',
  );

  return resources.run('task-preview-' + task.id, task.id, async () => {
    if (command === 'start') {
      const existing = ownLeases();
      if (existing.length) {
        const result = await status();
        assert.equal(result.runtimeReady, true, 'Existing preview is not healthy; preserve it and diagnose');
        assert.ok(
          !port || result.previews.some((p) => p.port === port),
          'Existing task preview uses another port; stop it explicitly before changing ports',
        );
        assert.ok(
          !backendPort || result.previews.every((p) => p.api === `http://127.0.0.1:${backendPort}`),
          'Existing task preview uses another backend; preserve it',
        );
        return { ...result, reused: true };
      }
      // This is an explicit task-level preparation step, before invoking the
      // unchanged fail-closed launcher. Invalid or interrupted records throw;
      // an existing database/media asset is never silently rebuilt.
      if (!system.readData(task.worktree)) await system.prepareData(task.worktree, { id: task.id, owner, apply: true });
      await system.run(
        [
          '--worktree',
          task.worktree,
          '--mode',
          'full',
          ...(port ? ['--port', String(port)] : ['--temporary']),
          ...(backendPort ? ['--backend-port', String(backendPort)] : []),
        ],
        { independent: true },
      );
      const result = await status();
      assert.equal(result.runtimeReady, true, 'Independent preview did not prove its API/data binding');
      return { ...result, reused: false };
    }

    // Prove that no other frontend depends on this backend before changing any
    // of its resources. A failed health check need not prevent stopping our
    // frontend, but an unknown identity always does.
    await system.references(task);
    for (const lease of ownLeases()) await stopLeasedTaskFrontend(task, lease, system);
    const remaining = await system.references(task);
    assert.equal(remaining.owned.length, 0, 'Another own frontend appeared; preserve backend');
    if (remaining.backendPorts.length) {
      await system.run(['--stop', '--worktree', task.worktree, '--port', String(port || 5177)]);
      const stopped = await system.references(task);
      assert.equal(stopped.backendPorts.length, 0, 'Task backend is still running');
      assert.equal(stopped.owned.length, 0, 'Task preview appeared while stopping');
    }
    return { task: task.id, state: 'stopped', dataRetained: true, verificationProven: false };
  });
}
