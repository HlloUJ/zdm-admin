import assert from 'node:assert/strict';
import { taskExecutor } from './task-execution-binding.mjs';
import { taskMavenVolume } from './task-maven.mjs';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const runtimeDigest = (value) => createHash('sha256').update(value).digest('hex');

function sameHostPath(left, right) {
  const normalize = (value) => {
    const hostPath =
      process.platform === 'darwin' && value.startsWith('/host_mnt/') ? value.slice('/host_mnt'.length) : value;
    const absolute = path.resolve(hostPath);
    return existsSync(absolute) ? realpathSync(absolute) : absolute;
  };
  return normalize(left) === normalize(right);
}

export function taskBackendSourceIdentity({ root, migrationDirectory }) {
  const hash = createHash('sha256');
  const visit = (file, relative) => {
    hash.update(JSON.stringify(relative));
    if (!existsSync(file)) {
      hash.update('missing');
      return;
    }
    const stat = lstatSync(file, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error(`后端运行输入不能是符号链接：${file}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(file).sort()) visit(path.join(file, name), `${relative}/${name}`);
    } else if (stat.isFile()) {
      hash.update(`${stat.mode}:${stat.mtimeNs}:${stat.ctimeNs}:`);
      hash.update(readFileSync(file));
    } else throw new Error(`无法确认后端运行输入：${file}`);
  };
  for (const relative of ['backend/src/main', 'backend/pom.xml', 'backend/.mvn', '.mvn', 'pom.xml'])
    visit(path.join(root, relative), relative);
  visit(migrationDirectory, 'merged-migrations');
  return hash.digest('hex');
}

export function taskBackendContainerIdentity(
  container,
  { root, project, backendPort, migrationDirectory, database, username, mediaVolume },
) {
  const labels = container?.Config?.Labels ?? {};
  const mounts = container?.Mounts ?? [];
  const port = container?.HostConfig?.PortBindings?.['8080/tcp'];
  if (
    !container?.Id ||
    !container.State?.Running ||
    !container.State.StartedAt ||
    labels['com.docker.compose.project'] !== project ||
    labels['com.docker.compose.service'] !== 'backend' ||
    labels['com.zdm.task.preview'] !== 'true' ||
    labels['com.zdm.task.database'] !== (database ? 'isolated' : 'integration') ||
    (database &&
      (!container.Config.Env?.some((value) =>
        value.startsWith('ZDM_DB_URL=jdbc:mysql://zdm-platform-mysql:3306/' + database + '?'),
      ) ||
        !container.Config.Env?.includes('ZDM_DB_USERNAME=' + username) ||
        !mounts.some(
          (mount) =>
            mount.Type === 'volume' && mount.Destination === '/data/zdm/craft-images' && mount.Name === mediaVolume,
        ))) ||
    !mounts.some(
      (mount) => mount.Type === 'bind' && mount.Destination === '/workspace' && sameHostPath(mount.Source, root),
    ) ||
    !mounts.some(
      (mount) =>
        mount.Type === 'volume' &&
        mount.Destination === '/root/.m2' &&
        mount.Name === taskMavenVolume(root, project) &&
        mount.RW === true,
    ) ||
    !mounts.some(
      (mount) =>
        mount.Type === 'bind' &&
        mount.Destination === '/task-migrations' &&
        sameHostPath(mount.Source, migrationDirectory) &&
        mount.RW === false,
    ) ||
    port?.length !== 1 ||
    port[0].HostIp !== '127.0.0.1' ||
    port[0].HostPort !== String(backendPort)
  )
    return null;
  return runtimeDigest(
    JSON.stringify({
      id: container.Id,
      startedAt: container.State.StartedAt,
      image: container.Image,
      config: container.Config,
      host: container.HostConfig,
      mounts,
    }),
  );
}

export function taskBackendAction(record, { containerIdentity, sourceIdentity, configurationIdentity, risk = false }) {
  if (
    !containerIdentity ||
    record?.version !== 1 ||
    record.containerIdentity !== containerIdentity ||
    record.configurationIdentity !== configurationIdentity
  )
    return 'recreate';
  if (record.sourceIdentity === sourceIdentity) return 'reuse';
  return risk ? 'recreate' : 'restart';
}

// At most one run plus one union of pending paths; a change during a run always gets a final pass.
export function createLatestChangeQueue({ run, onError, delayMs = 700, schedule = setTimeout, cancel = clearTimeout }) {
  const pending = new Set();
  let timer = null;
  let running = false;
  let closed = false;
  const drain = async () => {
    if (closed || running || pending.size === 0) return;
    running = true;
    const paths = [...pending];
    pending.clear();
    try {
      await run(paths);
    } catch (error) {
      close();
      await onError(error);
    } finally {
      running = false;
      if (!closed && pending.size && timer === null) void drain();
    }
  };
  const close = () => {
    closed = true;
    if (timer !== null) cancel(timer);
    timer = null;
    pending.clear();
  };
  return {
    notify(file) {
      if (closed) return;
      pending.add(file);
      if (timer !== null) cancel(timer);
      timer = schedule(() => {
        timer = null;
        void drain();
      }, delayMs);
    },
    close,
  };
}

function readRegularJson(file) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && realpathSync(file) === file, 'Unsafe validation state');
  return JSON.parse(readFileSync(file, 'utf8'));
}

// The published completion runner already owns and journals the exact temporary
// frontend lease. Start, check and stop derive the same backend from that lease,
// including when the frontend never became ready or has already exited.
export function retainedValidationBackend({ task, leases, port, head, project, starting }) {
  if (!task?.frozen) return null;
  const receipt = readRegularJson(
    path.join(task.repository.commonDir, 'task-delivery', task.id, 'validation-backend-recovery/receipt.json'),
  );
  if (!receipt) return null;
  assert.ok(Number.isInteger(port) && port >= 5177 && port <= 5199, 'Retained backend needs a private validation port');
  const lease = leases.inspect('temporary-port-' + port);
  if (!lease && !starting) return null;
  assert.notEqual(port, receipt.evidence.foreign?.port, 'Foreign preview port cannot host candidate validation');
  assert.equal(lease?.task, task.id, 'Retained validation backend requires its exact temporary lease');
  assert.equal(receipt.evidence.worker, taskExecutor(task));
  assert.equal(receipt.evidence.task, task.id);
  assert.equal(receipt.evidence.accepted, task.frozen.accepted);
  assert.equal(receipt.containerRetained, true);
  assert.match(receipt.evidence.backend.id, /^[a-f0-9]{64}$/);
  const retainedPort = Number(receipt.evidence.backend.port);
  assert.ok(retainedPort >= 8081 && retainedPort <= 8099 && Number.isInteger(retainedPort));
  const delivery = leases.inspect('task-delivery-' + task.id);
  assert.equal(delivery?.task, task.owner);
  assert.equal(lease.pid, delivery.pid, 'Temporary validation and completion have different owners');
  process.kill(delivery.pid, 0);
  assert.equal(task.resources.dataScope, 'isolated-task', 'Validation requires the task’s own isolated data');

  const directory = path.join(task.worktree, '.task-runtime/candidate-runtime');
  assert.equal(realpathSync(directory), directory, 'Unsafe candidate runtime journal directory');
  const entries = readdirSync(directory)
    .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
    .map((name) => ({ name, value: readRegularJson(path.join(directory, name)) }))
    .filter(({ value }) => value?.lease?.token === lease.token);
  assert.equal(entries.length, 1, 'Exact candidate runtime journal required');
  const [{ name, value }] = entries;
  assert.deepEqual(value.lease, lease);
  assert.equal(value.version, 1);
  assert.equal(value.task, task.id);
  assert.equal(value.head, head);
  assert.equal(value.port, port);
  assert.ok(['prepared', 'starting', 'ready'].includes(value.state), 'Validation runtime is outside its live journal');
  const suffix = createHash('sha256').update(lease.token).digest('hex').slice(0, 16);
  return {
    project: project + '-validation-' + suffix,
    retainedPort,
    retainedId: receipt.evidence.backend.id,
    retainedSource: receipt,
    runtimeId: lease.token,
    backendRecord: path.join(directory, name.replace(/\.json$/, '.backend.json')),
  };
}

export function assertNoValidationBackendConsumers(observations, backendPort) {
  for (const { metadata, statusCode, errorCode, port, leased } of observations) {
    if (statusCode === 0 && errorCode === 'ECONNREFUSED') continue;
    // Match the published consumer scan for an unrelated, responding
    // temporary port without a managed preview identity or project lease.
    if (!metadata && port >= 5177 && !leased && statusCode >= 200 && statusCode < 500) continue;
    assert.ok(metadata && typeof metadata.apiTarget === 'string', 'Unrecognized preview could use temporary backend');
    const api = new URL(metadata.apiTarget);
    const local = ['localhost', '[::1]'].includes(api.hostname) || api.hostname.startsWith('127.');
    assert.ok(!local || Number(api.port) !== backendPort, 'Temporary backend still has a possible preview consumer');
  }
}
