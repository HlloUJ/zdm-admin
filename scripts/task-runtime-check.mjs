import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';

export function candidateRuntimeCheck(root, env = process.env, execute = execFileSync) {
  const port = Number(env.ZDM_TASK_VALIDATION_PORT);
  assert.ok(Number.isInteger(port) && port >= 5177 && port <= 5199, 'Exact temporary validation port required');
  const registry = createTaskRegistry(root),
    task = registry.resolve({ worktree: root });
  assert.equal(env.ZDM_TASK_VALIDATION_ROOT, task.worktree);
  assert.equal(
    createResourceLeases(registry.commonDir).inspect('temporary-port-' + port)?.task,
    task.id,
    'Temporary validation port belongs to another task',
  );
  execute(
    process.execPath,
    [
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'dev-task.mjs'),
      '--check',
      '--worktree',
      task.worktree,
      '--port',
      String(port),
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    candidateRuntimeCheck(process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
