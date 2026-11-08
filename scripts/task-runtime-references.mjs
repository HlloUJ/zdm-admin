import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { taskProjectName } from './dev-task.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { inspectPreviewConsumers, readPreviewResponse, temporaryPreviewLeases } from './preview-consumers.mjs';

function backendPorts(task) {
  const project = taskProjectName({ root: task.worktree, branch: task.branch });
  const ids = execFileSync(
    'docker',
    [
      'ps',
      '--filter',
      'label=com.docker.compose.project=' + project,
      '--filter',
      'label=com.docker.compose.service=backend',
      '--format',
      '{{.ID}}',
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) return [];
  const containers = JSON.parse(execFileSync('docker', ['inspect', ...ids], { encoding: 'utf8' }));
  return containers.flatMap((container) => {
    assert.equal(container.Config?.Labels?.['com.docker.compose.project'], project);
    return (container.NetworkSettings?.Ports?.['8080/tcp'] ?? []).map((binding) => Number(binding.HostPort));
  });
}
// The only supported frontend ranges are fixed entries and explicitly allocated
// temporary ports. Unknown consumers are never stopped or adopted.
export async function taskRuntimeReferences(task, dependencies = {}) {
  const ports = (dependencies.backendPorts ?? backendPorts)(task);
  const snapshot = await inspectPreviewConsumers(
    { worktree: task.worktree, taskId: task.id, closingLeases: dependencies.closingLeases ?? [] },
    {
      request: dependencies.request ?? readPreviewResponse,
      readLeases:
        dependencies.readLeases ??
        (() => temporaryPreviewLeases(task.repository?.commonDir ?? createTaskRegistry(task.worktree).commonDir)),
    },
  );
  const owned = [],
    consumers = [];
  for (const frontend of snapshot.observations.filter((item) => item.metadata)) {
    if (frontend.metadata.workspaceRoot === task.worktree) owned.push(frontend);
    else if (ports.some((port) => frontend.metadata.apiTarget === `http://127.0.0.1:${port}`)) consumers.push(frontend);
  }
  assert.equal(consumers.length, 0, 'Another frontend still uses this task backend; retain both runtimes and source');
  return { task: task.id, backendPorts: ports, owned };
}
