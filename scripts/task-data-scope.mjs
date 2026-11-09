import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';
import { provisionPreviewData, readTaskData } from './task-data-environment.mjs';
import { taskProjectName } from './dev-task.mjs';
import { withIntegrationResource } from './integration-resource.mjs';
import { deliveryStatus } from './completion-status.mjs';

export async function isolateTaskData(root, { id, owner, apply = false }, dependencies = {}) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id });
  assert.equal(task.owner, owner, 'Exact task owner required for isolated data preparation');
  assert.ok(!task.recovery?.runtimeBlocked, 'Historical recovery is not verified; data preparation remains blocked');
  assert.ok(
    !['merged', 'main-verified', 'handoff-verified', 'closed'].includes(task.stage) &&
      (task.resources.dataScope === 'isolated-task' ||
        !['frozen', 'queued', 'validating', 'pr-pending'].includes(task.stage)),
    'Data scope cannot change during or after delivery',
  );
  const integration = registeredTaskWorktrees(root).filter((item) => item.branch === 'codex/integration-current');
  assert.equal(integration.length, 1, 'Exact integration source required for an isolated seed');
  const project = taskProjectName({ root: task.worktree, branch: task.branch });
  if (!apply)
    return {
      apply: false,
      task: task.id,
      worktree: task.worktree,
      source: integration[0].worktree,
      action: 'backup-and-copy-into-a-new-task-database-and-media-volume',
      retainsExistingData: true,
    };
  return withIntegrationResource(root, task.id, async () => {
    const running = (
      dependencies.running ??
      ((project) =>
        execFileSync(
          'docker',
          ['ps', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.ID}}'],
          {
            encoding: 'utf8',
          },
        ).trim())
    )(project);
    assert.equal(running, '', 'Stop the exact task runtime before changing its data scope');
    let selected = task;
    if (task.resources.dataScope !== 'isolated-task')
      selected = registry.revise(task.id, task.revision, (record) => {
        record.resources.dataScope = 'isolated-task';
      });
    // Failed provisioning keeps both the isolated scope and its failure/backup records.
    // Launching it then fails closed instead of returning to the persistent shared data.
    const data = await (dependencies.provision ?? provisionPreviewData)(
      { root: selected.worktree, project, integrationRoot: integration[0].worktree },
      dependencies.data ?? {},
    );
    return {
      task: selected.id,
      scope: 'isolated-task',
      database: data.database,
      mediaVolume: data.mediaVolume,
      backupFile: data.backupFile,
      existingPersistentPreviewRetained: true,
    };
  });
}
export async function dataScopeCommand(root, args, owner = process.env.CODEX_THREAD_ID) {
  const [command, id, flag] = args;
  assert.ok(
    ['status', 'isolate', 'published'].includes(command) && id && args.length <= 3,
    'task:data <status|isolate|published> <task-id> [--apply]',
  );
  assert.ok(flag === undefined || (command !== 'status' && flag === '--apply'), 'Unexpected data arguments');
  if (command === 'published') return preparePublishedData(root, { id, owner, apply: flag === '--apply' });
  if (command === 'status') {
    const task = createTaskRegistry(root).resolve({ id }),
      data = readTaskData(task.worktree);
    return {
      task: id,
      scope: task.resources.dataScope ?? 'persistent-preview',
      status: data?.status ?? 'unprepared',
      database: data?.database ?? null,
      mediaVolume: data?.mediaVolume ?? null,
    };
  }
  return isolateTaskData(root, { id, owner, apply: flag === '--apply' });
}
export async function preparePublishedData(root, { id, owner, apply = false }, dependencies = {}) {
  const registry = createTaskRegistry(root),
    task = registry.readTask(id);
  assert.ok(
    task && !task.compatibility?.readOnly && ['infrastructure', 'maintenance'].includes(task.kind),
    'Published data setup requires the exact authorized infrastructure task',
  );
  assert.equal(task.owner, owner, 'Exact task owner required for published data preparation');
  if (task.stage === 'closed')
    assert.equal(
      deliveryStatus(path.join(registry.commonDir, 'task-delivery', task.id), task.id, task).formalDeliveryComplete,
      true,
      'Closed setup task needs its complete retained receipt',
    );
  const worktrees = registeredTaskWorktrees(root);
  const locate = (branch) => {
    const matches = worktrees.filter((item) => item.branch === branch);
    assert.equal(matches.length, 1, 'Exact published data source/carrier required: ' + branch);
    return matches[0].worktree;
  };
  const retained = locate('codex/preview-current'),
    integrationRoot = locate('codex/integration-current');
  if (!apply)
    return {
      apply: false,
      task: id,
      worktree: retained,
      source: integrationRoot,
      action: 'prepare-durable-published-preview-data-once',
      retainsExistingData: true,
    };
  const project = taskProjectName({ root: retained, branch: 'codex/preview-current' });
  const data = await withIntegrationResource(root, task.id, () =>
    (dependencies.provision ?? provisionPreviewData)(
      { root: retained, project, integrationRoot },
      dependencies.data ?? {},
    ),
  );
  return {
    task: id,
    scope: 'published-preview',
    database: data.database,
    mediaVolume: data.mediaVolume,
    backupFile: data.backupFile,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  dataScopeCommand(process.cwd(), process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
