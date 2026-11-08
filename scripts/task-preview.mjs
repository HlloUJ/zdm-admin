import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { PREVIEW_ROLES, previewDescriptor } from './preview-policy.mjs';
import { previewOwner } from './preview-transition.mjs';
import { readServiceStatus, requestJson, servicePaths } from './task-preview-service.mjs';

export async function taskPreview(root, args, dependencies = {}) {
  const system = {
    registry: createTaskRegistry,
    readStatus: readServiceStatus,
    request: requestJson,
    paths: servicePaths(),
    owner: process.env.CODEX_THREAD_ID,
    ...dependencies,
  };
  const [command = 'status', ...flags] = args;
  const values = {};
  for (let i = 0; i < flags.length; i += 2) {
    assert.ok(['--task', '--owner'].includes(flags[i]) && flags[i + 1], 'Unexpected preview arguments');
    assert.ok(!values[flags[i]], 'Duplicate preview argument');
    values[flags[i]] = flags[i + 1];
  }
  assert.ok(['roles', 'status', 'switch'].includes(command), 'Expected roles, status, or switch');
  if (command === 'roles') {
    assert.equal(flags.length, 0);
    return PREVIEW_ROLES;
  }
  if (command === 'status') {
    assert.equal(flags.length, 0);
    return system.readStatus(system.paths);
  }
  const registry = system.registry(root);
  const task = registry.resolve(values['--task'] ? { id: values['--task'] } : { worktree: root });
  const owner = values['--owner'] ?? system.owner;
  assert.equal(owner, task.owner, 'Current chat must own the selected task');
  previewDescriptor('development', { task });
  const current = await system.readStatus(system.paths);
  assert.equal(
    current.taskSelectionProtocol,
    2,
    'Install the reviewed multi-task runtime before switching; no legacy takeover',
  );
  assert.notEqual(current.phase, 'offline', 'Preview service is offline; no implicit restart or selection');
  const result = await system.request({
    paths: system.paths,
    method: 'POST',
    requestPath: '/select-task',
    timeoutMs: 300_000,
    payload: {
      task: task.id,
      owner,
      worktree: task.worktree,
      taskArgs: ['--mode', 'full'],
      expected: previewOwner(current),
    },
  });
  assert.equal(result.status?.phase, 'running', 'Selected task preview is not ready');
  assert.equal(result.status.worktree, task.worktree, 'Selected preview belongs to another task');
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  taskPreview(process.cwd(), process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
