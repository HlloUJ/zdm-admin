import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const runtimeDigest = (value) => createHash('sha256').update(value).digest('hex');

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

export function taskBackendContainerIdentity(container, { root, project, backendPort, migrationDirectory }) {
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
    labels['com.zdm.task.database'] !== 'integration' ||
    !mounts.some(
      (mount) =>
        mount.Type === 'bind' &&
        mount.Destination === '/workspace' &&
        path.resolve(mount.Source) === path.resolve(root),
    ) ||
    !mounts.some(
      (mount) =>
        mount.Type === 'bind' &&
        mount.Destination === '/task-migrations' &&
        path.resolve(mount.Source) === path.resolve(migrationDirectory) &&
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
