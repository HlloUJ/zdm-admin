import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { PREVIEW_ROLES, previewDescriptor } from './preview-policy.mjs';
import { previewOwner } from './preview-transition.mjs';
import { readServiceStatus, requestJson, servicePaths } from './task-preview-service.mjs';
import { independentTaskPreview } from './task-preview-independent.mjs';

export async function taskPreview(root, args, dependencies = {}) {
  const system = {
    registry: createTaskRegistry,
    readStatus: readServiceStatus,
    request: requestJson,
    paths: servicePaths(),
    owner: process.env.CODEX_THREAD_ID,
    independent: independentTaskPreview,
    ...dependencies,
  };
  const [command = 'status', ...flags] = args;
  const values = {};
  for (let i = 0; i < flags.length; i += 2) {
    assert.ok(
      ['--task', '--owner', '--port', '--backend-port'].includes(flags[i]) && flags[i + 1],
      'Unexpected preview arguments',
    );
    assert.ok(!values[flags[i]], 'Duplicate preview argument');
    values[flags[i]] = flags[i + 1];
  }
  assert.ok(
    ['roles', 'status', 'switch', 'start', 'stop'].includes(command),
    'Expected start, status --task, stop, roles, or legacy switch',
  );
  if (['start', 'stop'].includes(command) || (command === 'status' && values['--task'])) {
    assert.ok(values['--task'], 'Independent preview requires --task <exact task id>');
    assert.ok(
      command === 'start' || (!values['--port'] && !values['--backend-port']),
      'Port allocation options are only accepted when starting',
    );
    const port = values['--port'] ? Number(values['--port']) : null;
    const backendPort = values['--backend-port'] ? Number(values['--backend-port']) : null;
    assert.ok(
      port === null || (Number.isInteger(port) && port >= 5177 && port <= 5199),
      'Independent frontend port must be 5177-5199',
    );
    assert.ok(
      backendPort === null || (Number.isInteger(backendPort) && backendPort >= 8081 && backendPort <= 8099),
      'Task backend port must be 8081-8099',
    );
    return system.independent(root, {
      command,
      id: values['--task'],
      owner: values['--owner'] ?? system.owner,
      port,
      backendPort,
    });
  }
  assert.ok(!values['--port'] && !values['--backend-port'], 'Legacy preview does not accept port allocation');
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
