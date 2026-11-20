import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { taskExecutor } from '../task-execution-binding.mjs';
import { taskProjectName } from '../dev-task.mjs';
import { assertReferenceHistoricalBaseline } from './preview-reference-source.mjs';
import { nativeOutputObjects, referenceHash, regularReferenceFile } from './preview-reference-history.mjs';
import { readMaintenanceBackend } from './validation-maintenance-lineage.mjs';

const git = (root, ...args) =>
  execFileSync('git', ['--no-optional-locks', '--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
  }).trim();

export function readReassignedNativeCheck(peer, task, lease, anchor) {
  const worker = taskExecutor(task);
  const file = path.resolve(peer.nativeCheck.file);
  assert.ok(file.startsWith(path.join(os.homedir(), '.codex/sessions') + path.sep));
  assert.ok(path.basename(file).endsWith('-' + worker + '.jsonl'), 'Reassigned preview worker is unproven');
  const { bytes } = regularReferenceFile(file);
  let source, nativeId;
  for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'session_meta') nativeId ??= event.payload?.id;
    if (event.type === 'event_msg' && event.payload?.item?.id === peer.nativeCheck.event) {
      if (event.payload.type !== 'item_completed') continue;
      assert.equal(source, undefined, 'Duplicate native preview check');
      assert.equal(referenceHash(line), peer.nativeCheck.sha256);
      source = event.payload;
    }
  }
  assert.equal(nativeId, worker);
  const item = source?.item;
  assert.equal(source?.thread_id, worker);
  assert.equal(item?.type, 'CommandExecution');
  assert.equal(item.status, 'completed');
  assert.equal(item.exit_code, 0);
  assert.equal(decodeURIComponent(new URL(item.cwd).pathname), anchor);
  const command = 'npm run task:entry -- --worktree ';
  const ending = ' preview check --task ' + task.id;
  const checkLines = item.command[2]
    .split('\n')
    .filter((line) =>
      [task.worktree, "'" + task.worktree + "'"].some(
        (worktree) => line === command + worktree + ending || line.startsWith(command + worktree + ending + ' | tee '),
      ),
    );
  assert.equal(checkLines.length, 1, 'Expected the actual published preview check');
  assert.ok(Number.isFinite(source.started_at_ms) && Number.isFinite(source.completed_at_ms));
  assert.ok(source.started_at_ms <= source.completed_at_ms);
  assert.ok(lease.stat.mtimeMs <= source.started_at_ms && lease.stat.ctimeMs <= source.started_at_ms);
  assert.ok(
    source.completed_at_ms < Date.parse(peer.boot.live.startedAt),
    'Expected the original pre-maintenance check',
  );
  assertReferenceHistoricalBaseline(anchor, peer.nativeCheck.publishedMain, source.started_at_ms);
  git(anchor, 'merge-base', '--is-ancestor', peer.nativeCheck.publishedMain, 'refs/remotes/origin/main');
  const values = nativeOutputObjects(item.aggregated_output);
  const exact = values.filter(
    (value) =>
      value.task === task.id &&
      value.worktree === task.worktree &&
      value.branch === task.branch &&
      value.state === 'running' &&
      value.runtimeReady === true &&
      value.previews?.length === 1,
  );
  assert.equal(exact.length, 1);
  const preview = exact[0].previews[0];
  assert.equal(preview.port, peer.port);
  assert.equal(preview.api, 'http://127.0.0.1:' + peer.backendPort);
  assert.equal(preview.runtimeReady, true);
  assert.deepEqual(preview.errors, []);
  return { worker, event: item.id, sha256: peer.nativeCheck.sha256 };
}

export function captureReassignedClosedPeer(scope, peer, docker) {
  const task = scope.registry.readTask(peer.task);
  assert.equal(task.id, peer.task);
  assert.equal(task.resources.dataScope, 'isolated-task');
  assert.ok(!task.recovery?.runtimeBlocked);
  assert.equal(git(task.worktree, 'status', '--porcelain'), '');
  assert.equal(git(task.worktree, 'rev-parse', 'HEAD'), task.recordedHead);
  assert.equal(git(task.worktree, 'branch', '--show-current'), task.branch);
  const source = path.join(
    scope.registry.commonDir,
    'task-registry/resource-leases',
    'temporary-port-' + peer.port,
    'owner.json',
  );
  const lease = regularReferenceFile(source);
  assert.equal(referenceHash(lease.bytes), peer.observed.leaseFileSha256, 'Reassigned lease changed since maintenance');
  const value = JSON.parse(lease.bytes);
  assert.equal(value.resource, 'temporary-port-' + peer.port);
  assert.equal(value.task, task.id);
  assert.equal(value.pid, peer.observed.leaseOwnerPid);
  assert.ok(Number.isSafeInteger(value.pid) && value.pid > 1);
  assert.match(value.token, /^[a-f0-9-]{36}$/);
  const history = readReassignedNativeCheck(peer, task, lease, scope.anchor);
  const list = JSON.parse(docker('inspect', peer.containerId));
  assert.equal(list.length, 1);
  const c = list[0];
  const project = taskProjectName({ root: task.worktree, branch: task.branch });
  const backend = readMaintenanceBackend(c, peer.boot, { root: task.worktree, project, port: peer.backendPort });
  const endpoint =
    process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
      ? process.env.DOCKER_HOST
      : JSON.parse(docker('context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'));
  assert.match(endpoint, /^unix:\/\//);
  assert.equal(referenceHash(regularReferenceFile(source).bytes), peer.observed.leaseFileSha256);
  return {
    task: task.id,
    registryDigest: referenceHash(JSON.stringify(task)),
    worktree: task.worktree,
    host: os.hostname(),
    dockerEndpoint: endpoint,
    port: peer.port,
    lease: value,
    history,
    backendPort: peer.backendPort,
    backend: { id: c.Id, inventory: { id: c.Id, labels: c.Config.Labels, mounts: c.Mounts }, ...backend },
  };
}
