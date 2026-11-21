import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertHostIdle } from '../task-cancellation-proof.mjs';
import { taskProjectName } from '../dev-task.mjs';
import { readResumeResources } from '../task-rebinding.mjs';
import { inspectSignedDockerDirectories } from './preview-docker-directories.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const byId = (a, b) => a.id.localeCompare(b.id);
const under = (candidate, root) => candidate === root || candidate.startsWith(root + path.sep);
const canonicalSpelling = (value) =>
  value
    .replace(/^\/System\/Volumes\/Data\//, '/')
    .replace(/ \(deleted\)$/, '')
    .normalize('NFC')
    .toLowerCase();

function sourcePath(value) {
  assert.ok(path.isAbsolute(value) && path.normalize(value) === value, 'Unknown Docker bind source path');
  const exposed = value.replace(/^\/(host_mnt|run\/desktop\/mnt\/host)\//, '/');
  return realpathSync.native(exposed);
}

function ancestry(value) {
  const result = [];
  for (let cursor = value; ; cursor = path.dirname(cursor)) {
    const { dev, ino } = lstatSync(cursor, { bigint: true });
    result.push(dev + ':' + ino);
    if (cursor === path.dirname(cursor)) return result;
  }
}

export function assertDispatchMountsClear(task, snapshot, { containers, volumes }) {
  // Include stopped containers: configured mounts must still be attributable.
  assert.ok(Array.isArray(containers) && Array.isArray(volumes), 'Incomplete Docker mount inventory');
  const running = containers
    .filter((row) => row.running)
    .map(({ id, labels, mounts }) => ({ id, labels, mounts }))
    .sort(byId);
  assert.deepEqual(running, [...snapshot.containers].sort(byId), 'Running container inventory changed');
  const project = taskProjectName({ root: task.worktree, branch: task.branch });
  const worktree = ancestry(task.worktree);
  const protectedPath = canonicalSpelling(task.worktree);
  const containerIds = new Set();
  const physicalBinds = [];
  for (const row of containers) {
    assert.match(row.id, /^[a-f0-9]{64}$/);
    assert.ok(!containerIds.has(row.id), 'Duplicate Docker container observation');
    containerIds.add(row.id);
    assert.equal(typeof row.running, 'boolean');
    assert.ok(row.labels === null || (row.labels && !Array.isArray(row.labels) && typeof row.labels === 'object'));
    assert.ok(
      !Object.values(row.labels ?? {}).some(
        (label) =>
          label === task.id ||
          label === project ||
          (typeof label === 'string' && under(canonicalSpelling(label), protectedPath)),
      ),
      'Docker container belongs to the task',
    );
    assert.ok(Array.isArray(row.mounts), 'Unknown Docker container mount inventory');
    assert.ok(Array.isArray(row.binds ?? []), 'Unknown Docker bind configuration');
    assert.ok(Array.isArray(row.configuredMounts ?? []), 'Unknown Docker mount configuration');
    assert.deepEqual(row.volumesFrom ?? [], [], 'Inherited container volumes are not independently attributable');
    const sources = row.mounts.map((mount) => {
      assert.ok(path.isAbsolute(mount.Destination), 'Unknown Docker mount destination');
      if (mount.Type === 'bind') {
        const source = sourcePath(mount.Source);
        const parents = ancestry(source);
        assert.ok(
          !parents.includes(worktree[0]) && !worktree.includes(parents[0]),
          'Docker bind mount overlaps task worktree',
        );
        physicalBinds.push({ container: row.id, source, destination: mount.Destination, ancestry: parents });
        return { type: 'bind', source, destination: mount.Destination };
      }
      if (mount.Type === 'volume') {
        assert.match(mount.Name, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
        const matches = volumes.filter((volume) => volume.name === mount.Name);
        assert.equal(matches.length, 1, 'Named volume identity is missing or ambiguous');
        const volume = matches[0];
        assert.equal(volume.driver, 'local', 'Unknown volume driver');
        assert.deepEqual(volume.optionKeys, [], 'Volume could map an unobserved host bind');
        assert.equal(volume.mountpoint, '/var/lib/docker/volumes/' + mount.Name + '/_data');
        assert.equal(mount.Source, volume.mountpoint);
        return { type: 'volume', source: mount.Name, destination: mount.Destination };
      }
      assert.equal(mount.Type, 'tmpfs', 'Unsupported Docker mount type');
      assert.ok(!mount.Source, 'Unexpected tmpfs source');
      return { type: 'tmpfs', source: '', destination: mount.Destination };
    });
    const compareSource = (mount, source) =>
      mount.type === 'bind' ? sourcePath(source) === mount.source : mount.source === source;
    for (const bind of row.binds ?? []) {
      const [source, destination, options, ...rest] = bind.split(':');
      assert.ok(
        !rest.length && sources.some((mount) => mount.destination === destination && compareSource(mount, source)),
        'Configured Docker bind is absent from the observed mounts',
      );
      assert.ok(options === undefined || options.length);
    }
    for (const spec of row.configuredMounts ?? [])
      assert.ok(
        sources.some(
          (mount) =>
            mount.type === spec.Type && mount.destination === spec.Target && compareSource(mount, spec.Source ?? ''),
        ),
        'Configured Docker mount is absent from the observed mounts',
      );
  }
  return physicalBinds;
}

function readMountInventory(endpoint) {
  assert.ok(endpoint.startsWith('unix:///'), 'Only the observed local Docker endpoint is allowed');
  const docker = '/Applications/Docker.app/Contents/Resources/bin/docker';
  assert.equal(realpathSync(docker), docker, 'Unknown Docker CLI installation');
  const executable = lstatSync(docker, { bigint: true });
  assert.ok(executable.isFile() && (executable.mode & 0o022n) === 0n, 'Unsafe Docker CLI executable');
  const signature = spawnSync(
    '/usr/bin/codesign',
    [
      '--verify',
      '--strict',
      '-R',
      '=anchor apple generic and certificate leaf[subject.OU] = "9BNSXJN65R" and identifier "docker"',
      docker,
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  assert.ok(!signature.error && signature.status === 0, 'Docker CLI signature could not be verified');
  const env = { ...process.env };
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  const call = (...args) => {
    const response = spawnSync(docker, ['--host', endpoint, ...args], {
      env,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.ok(
      !response.error && response.status === 0 && !response.stderr.trim(),
      'Docker mount inventory unavailable',
    );
    return response.stdout.trim().split('\n').filter(Boolean);
  };
  const list = () => call('ps', '-aq', '--no-trunc').sort();
  const ids = list();
  const inspect = (args, fields) => {
    const rows = call(...args);
    assert.equal(rows.length, 1, 'Docker identity observation is incomplete');
    const values = rows[0].split('\t').map((value) => JSON.parse(value));
    assert.equal(values.length, fields, 'Docker identity fields are incomplete');
    return values;
  };
  const containers = ids.map((id) => {
    assert.match(id, /^[a-f0-9]{64}$/);
    const fields = [
      '{{json .Id}}',
      '{{json .State.Running}}',
      '{{json .Config.Labels}}',
      '{{json .Mounts}}',
      '{{json .HostConfig.Binds}}',
      // The Engine omits this optional key for an empty configured mount list.
      '{{json (index .HostConfig "Mounts")}}',
      '{{json .HostConfig.VolumesFrom}}',
    ];
    const [observedId, running, labels, mounts, binds, configuredMounts, volumesFrom] = inspect(
      ['inspect', '--type', 'container', '--format', fields.join('\t'), id],
      fields.length,
    );
    assert.equal(observedId, id);
    return { id, running, labels, mounts, binds, configuredMounts, volumesFrom };
  });
  const names = [
    ...new Set(
      containers.flatMap((row) => row.mounts.filter((mount) => mount.Type === 'volume').map((mount) => mount.Name)),
    ),
  ].sort();
  const volumes = names.map((name) => {
    assert.match(name, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
    const [observed, driver, mountpoint, options] = inspect(
      [
        'volume',
        'inspect',
        '--format',
        '{{json .Name}}\t{{json .Driver}}\t{{json .Mountpoint}}\t{{json .Options}}',
        name,
      ],
      4,
    );
    assert.equal(observed, name);
    assert.ok(options === null || (options && typeof options === 'object' && !Array.isArray(options)));
    return { name, driver, mountpoint, optionKeys: Object.keys(options ?? {}).sort() };
  });
  assert.deepEqual(list(), ids, 'Docker containers changed during mount observation');
  const current = lstatSync(docker, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'])
    assert.equal(current[key], executable[key], 'Docker CLI changed during mount observation');
  return { containers, volumes };
}

function assertMatchingDirectories(proof, matching, snapshot, task) {
  assert.equal(proof.endpoint.path, snapshot.dockerEndpoint.slice('unix://'.length));
  assert.ok(
    snapshot.files.some(
      (f) => f.pid === proof.endpoint.ownerPid && f.type === 'unix' && f.name === proof.endpoint.path,
    ),
  );
  const key = ({ pid, descriptor, name }) => JSON.stringify([pid, descriptor, name]);
  const expected = new Set(matching.map(key));
  assert.equal(expected.size, matching.length, 'Duplicate task directory observation');
  const seen = new Set();
  for (const service of proof.services) {
    assert.ok(!seen.has(service.pid), 'Duplicate observed Docker process');
    seen.add(service.pid);
    assert.equal(service.image.signatureVerified, true);
    assert.equal(service.image.team, '9BNSXJN65R');
    assert.equal(service.processStable, true);
    assert.equal(service.uid, proof.sourceUid);
    assert.ok(Number.isSafeInteger(service.startSeconds) && service.startSeconds > 0);
    const owner = service.pid === proof.endpoint.ownerPid;
    if (!owner)
      assert.equal(service.ppid, proof.endpoint.ownerPid, 'Directory holder is not the Docker endpoint child');
    const executable =
      '/Applications/Docker.app/Contents/MacOS/' + (owner ? 'com.docker.backend' : 'com.docker.sailor');
    assert.equal(service.executable, executable);
    assert.equal(service.image.executable, executable);
    assert.match(service.image.hash, /^[a-f0-9]{64}$/);
    for (const fd of service.fds) {
      assert.ok(
        fd.directory && [1, 0x8001].includes(fd.openFlags) && !fd.guardFlags,
        'Unverified read-only directory descriptor',
      );
      assert.ok(under(fd.path, task.worktree), 'Directory proof references another worktree');
      assert.ok(
        expected.delete(key({ pid: service.pid, descriptor: String(fd.fd), name: fd.path })),
        'Unexpected kernel directory descriptor',
      );
    }
  }
  assert.ok(seen.has(proof.endpoint.ownerPid), 'Unsigned Docker endpoint owner');
  assert.equal(expected.size, 0, 'Kernel evidence does not cover every task directory descriptor');
}

export function compareDispatchHostRounds(task, { observe, readMounts, inspectDirectories, readResources, record }) {
  function observeRound() {
    const startedAt = Date.now();
    const snapshot = observe();
    const protectedPath = canonicalSpelling(task.worktree);
    const matching = snapshot.files.filter((file) => under(canonicalSpelling(file.name), protectedPath));
    if (!matching.length) {
      assertHostIdle(snapshot, task);
      return { snapshot, retained: null };
    }
    assert.ok(
      matching.every((file) => file.type === 'DIR' && /^\d+$/.test(file.descriptor) && under(file.name, task.worktree)),
      'Task files/cwd remain open with an unproven reference',
    );
    const matched = new Set(matching);
    assertHostIdle({ ...snapshot, files: snapshot.files.filter((file) => !matched.has(file)) }, task);
    const identity = { worktree: task.worktree, dockerEndpoint: snapshot.dockerEndpoint };
    assert.ok(identity.dockerEndpoint?.startsWith('unix:///'), 'Local Docker endpoint required');
    record('observed-task-directories', matching);
    const resources = readResources(task);
    const mounts = readMounts(identity.dockerEndpoint);
    const physicalBinds = assertDispatchMountsClear(task, snapshot, mounts);
    const directories = inspectDirectories(identity, snapshot, matching, record);
    assertMatchingDirectories(directories, matching, snapshot, task);
    assert.deepEqual(readResources(task), resources, 'Task resources changed during directory observation');
    assert.ok(Date.now() - startedAt <= 60000, 'Docker reference observation is stale');
    return { snapshot, retained: { mounts, physicalBinds, directories, resources, cleanupAuthorized: false } };
  }
  const first = observeRound();
  const second = observeRound();
  assert.deepEqual(second.retained, first.retained, 'Docker directory or mount observations changed between rounds');
  const observationsDigest = digest([first.snapshot, second.snapshot]);
  if (!first.retained) return { observationsDigest };
  const evidence = record('dispatch-only-retained-directories', { observationsDigest, ...first.retained });
  return {
    observationsDigest,
    retainedDockerDirectories: {
      digest: digest(first.retained),
      resourcesDigest: digest(first.retained.resources),
      file: evidence,
      verifiedAt: Date.now(),
    },
  };
}

export function assertDispatchProofCurrent(task, readiness) {
  const proof = readiness.retainedDockerDirectories;
  if (!proof) return;
  assert.equal(digest(readResumeResources(task)), proof.resourcesDigest, 'Task resources changed before dispatch');
  const elapsed = Date.now() - proof.verifiedAt;
  assert.ok(elapsed >= 0 && elapsed <= 5000, 'Retained directory observation expired before dispatch');
}

export function verifyDynamicDispatchHost(task, { decisionId, action }, observe) {
  assert.ok(
    ['dispatch', 'dispatch-start'].includes(action),
    'Only an actual dispatch can use retained directory proof',
  );
  assert.match(decisionId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(task.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  let folder;
  let sequence = 0;
  const record = (label, evidence) => {
    if (!folder) {
      const base = path.join(task.repository.commonDir, 'task-registry', 'dispatch-observations');
      assert.equal(realpathSync(path.dirname(base)), path.dirname(base), 'Linked dispatch evidence parent');
      try {
        mkdirSync(base, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const stat = lstatSync(base);
      assert.ok(
        stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
      );
      folder = mkdtempSync(path.join(base, task.id + '-' + decisionId + '-' + action + '-'));
    }
    const file = path.join(folder, ++sequence + '-' + label + '.json');
    writeFileSync(
      file,
      JSON.stringify({ task: task.id, worktree: task.worktree, decisionId, action, evidence }) + '\n',
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
    return file;
  };
  return compareDispatchHostRounds(task, {
    observe,
    readMounts: readMountInventory,
    inspectDirectories: inspectSignedDockerDirectories,
    readResources: readResumeResources,
    record,
  });
}
