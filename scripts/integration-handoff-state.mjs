import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runtimeDigest, taskBackendSourceIdentity } from './task-runtime-state.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';

export function normalizeDockerMountPath(mountPath) {
  return process.platform === 'darwin' && mountPath.startsWith('/host_mnt/')
    ? mountPath.slice('/host_mnt'.length)
    : mountPath;
}

function capture(args, { cwd, command = 'git', allowFailure = false, trim = true } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status === 0) return trim ? result.stdout.trim() : result.stdout;
  if (allowFailure) return '';
  throw new Error(result.stderr?.trim() || `${command} failed`);
}

export function integrationBackendIdentity(container, root) {
  if (
    !container?.Id ||
    !container.State?.Running ||
    !container.State.StartedAt ||
    container.Config?.Labels?.['com.docker.compose.service'] !== 'backend' ||
    !container.Mounts?.some(
      (mount) =>
        mount.Type === 'bind' &&
        mount.Destination === '/workspace' &&
        path.resolve(normalizeDockerMountPath(mount.Source)) === path.resolve(root),
    )
  )
    return null;
  // Persist only a digest; container configuration can contain credentials.
  return runtimeDigest(
    JSON.stringify({
      id: container.Id,
      state: { startedAt: container.State.StartedAt, running: container.State.Running },
      image: container.Image,
      config: container.Config,
      host: container.HostConfig,
      mounts: container.Mounts,
    }),
  );
}

export function integrationSourceIdentity(root, tree) {
  const runtimeTree = tree.split('\0').filter((entry) => {
    const separator = entry.indexOf('\t');
    if (separator < 0) throw new Error('无法确认集成 Git 文件清单');
    return classifyChangedFiles([entry.slice(separator + 1)]).runtime;
  });
  return runtimeDigest(
    JSON.stringify([
      taskBackendSourceIdentity({
        root,
        migrationDirectory: path.join(root, 'backend/src/main/resources/db/migration'),
      }),
      runtimeTree,
    ]),
  );
}

export function integrationBackendSnapshot(root) {
  const rawContainer = capture(['inspect', 'zdm-platform-backend'], {
    cwd: root,
    command: 'docker',
    allowFailure: true,
  });
  let container = null;
  if (rawContainer) {
    const containers = JSON.parse(rawContainer);
    if (containers.length === 1) [container] = containers;
  }
  return {
    integrationHead: capture(['rev-parse', 'HEAD'], { cwd: root }),
    worktreeClean: capture(['status', '--porcelain'], { cwd: root }) === '',
    sourceIdentity: integrationSourceIdentity(
      root,
      capture(['ls-tree', '-rz', 'HEAD'], { cwd: root, trim: false }).replace(/\0$/, ''),
    ),
    configurationIdentity: runtimeDigest(
      capture(['compose', 'config', '--format', 'json'], { cwd: root, command: 'docker' }),
    ),
    containerIdentity: integrationBackendIdentity(container, root),
  };
}

export function assertIntegrationRuntimeReady(before, after, { recreate = false } = {}) {
  if (!after.containerIdentity || (recreate && before.containerIdentity === after.containerIdentity))
    throw new Error('集成后端未产生新的有效运行身份；数据库锁和备份保留');
  if (!recreate && before.containerIdentity !== after.containerIdentity)
    throw new Error('集成后端复用期间启动身份变化，不能复用健康证据；数据库锁和备份保留');
  if (
    before.sourceIdentity !== after.sourceIdentity ||
    before.configurationIdentity !== after.configurationIdentity ||
    before.integrationHead !== after.integrationHead ||
    !before.worktreeClean ||
    !after.worktreeClean
  )
    throw new Error('集成运行输入在交接期间变化；数据库锁和备份保留');
}

function proofPath(root) {
  const directory = path.join(root, '.task-runtime');
  const file = path.join(directory, 'integration-handoff-state.json');
  for (const target of [directory, file]) {
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('集成交接证明不能是符号链接');
  }
  return file;
}

export function readIntegrationProof(root) {
  const file = proofPath(root);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeIntegrationProof(root, proof) {
  const file = proofPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const pendingFile = `${file}.${process.pid}.tmp`;
  writeFileSync(pendingFile, `${JSON.stringify(proof)}\n`, { flag: 'wx' });
  renameSync(pendingFile, file);
}

export function integrationProofMatches(proof, state) {
  return (
    proof?.version === 1 &&
    proof.status === 'passed' &&
    Boolean(proof.integrationHead && proof.taskHead) &&
    Boolean(state.containerIdentity) &&
    ['sourceIdentity', 'configurationIdentity', 'containerIdentity'].every((key) => proof[key] === state[key])
  );
}
