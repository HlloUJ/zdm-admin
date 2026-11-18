import assert from 'node:assert/strict';
import path from 'node:path';

const under = (value, root) => {
  const normalized = value.replace(/^\/host_mnt\//, '/').replace(/ \(deleted\)$/, '');
  return normalized === root || normalized.startsWith(root + path.sep);
};
const mentions = (value, token) => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![a-zA-Z0-9_-])' + escaped + '(?![a-zA-Z0-9_-])').test(value);
};

export function observedHostMountPath(value, platform) {
  assert.ok(
    typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value,
    'Unknown host mount path',
  );
  return platform === 'darwin' && value.startsWith('/host_mnt/') ? value.slice('/host_mnt'.length) : value;
}

export function retainedDirectoryKeys(round, identity) {
  const proof = round.retainedDirectoryReferences;
  if (!proof) return new Set();
  assert.equal(proof.kind, 'retained-docker-source-directories-v1');
  assert.equal(proof.cleanupAuthorized, false);
  assert.equal(proof.backend, identity.backend.id);
  const mounts = identity.backend.inventory.mounts.filter(
    (m) => m.Type === 'bind' && observedHostMountPath(m.Source, 'darwin') === identity.worktree,
  );
  assert.equal(mounts.length, 1);
  assert.deepEqual(proof.sourceMount, mounts[0]);
  assert.equal(proof.sourceMount.Destination, '/workspace');
  assert.equal(proof.endpoint.path, identity.dockerEndpoint.slice('unix://'.length));
  assert.ok(
    round.files.some((f) => f.pid === proof.endpoint.ownerPid && f.type === 'unix' && f.name === proof.endpoint.path),
  );
  const keys = new Set(),
    pids = new Set();
  for (const service of proof.services) {
    assert.ok(!pids.has(service.pid));
    pids.add(service.pid);
    const owner = service.pid === proof.endpoint.ownerPid;
    assert.equal(
      service.executable,
      '/Applications/Docker.app/Contents/MacOS/' + (owner ? 'com.docker.backend' : 'com.docker.sailor'),
    );
    assert.equal(service.image.executable, service.executable);
    assert.equal(service.image.identifier, owner ? 'com.docker.docker' : 'com.docker');
    assert.equal(service.image.team, '9BNSXJN65R');
    assert.equal(service.image.signatureVerified, true);
    assert.match(service.image.hash, /^[a-f0-9]{64}$/);
    assert.equal(service.processStable, true);
    assert.ok(Number.isSafeInteger(service.startSeconds) && service.startSeconds > 0);
    const process = round.processes.find((p) => p.pid === service.pid);
    assert.ok(process && process.ppid === service.ppid);
    if (!owner) assert.equal(service.ppid, proof.endpoint.ownerPid);
    assert.equal(service.uid, proof.sourceUid);
    assert.ok(service.fds.length > 0);
    for (const fd of service.fds) {
      assert.equal(fd.returnedSize, service.expectedSize);
      assert.equal(fd.errno, 0);
      assert.ok(Number.isSafeInteger(fd.fd) && fd.fd >= 0);
      assert.equal(fd.directory, true);
      assert.equal(fd.vnodeType, 2);
      assert.equal(fd.fileType, 1);
      assert.ok([1, 0x8001].includes(fd.openFlags));
      assert.equal(fd.guardFlags, 0);
      assert.equal(String(fd.device), proof.sourceDevice);
      assert.ok(Number.isSafeInteger(fd.inode) && fd.inode > 0);
      assert.equal(fd.mode & 0o170000, 0o040000);
      assert.ok(under(fd.path, identity.worktree));
      if (fd.fsgetpathErrno === 0) {
        assert.equal(fd.lstatStatus, 0);
        assert.equal(fd.pathDevice, fd.device);
        assert.equal(fd.pathInode, fd.inode);
        assert.equal(fd.pathMode, fd.mode);
        assert.equal(fd.fsgetpathErrno, 0);
        assert.equal(fd.fsgetpath, fd.path);
      } else {
        assert.equal(fd.fsgetpathSize, -1);
        assert.equal(fd.fsgetpathErrno, 2);
        assert.equal(fd.fsgetpath, '');
        if (fd.lstatStatus === 0) {
          assert.equal(fd.lstatErrno, 0);
          assert.notEqual(fd.pathInode, fd.inode);
          assert.equal(fd.pathDevice, fd.device);
          assert.equal(fd.pathMode & 0o170000, 0o040000);
        } else {
          assert.equal(fd.lstatStatus, -1);
          assert.equal(fd.lstatErrno, 2);
        }
        assert.equal(fd.parent, path.dirname(fd.path));
        assert.ok(under(fd.parent, identity.worktree));
        assert.equal(fd.parentStatus, 0);
        assert.equal(fd.parentDevice, fd.device);
        assert.ok(Number.isSafeInteger(fd.parentInode) && fd.parentInode > 0);
        assert.equal(fd.parentMode & 0o170000, 0o040000);
      }
      const key = JSON.stringify([service.pid, String(fd.fd), fd.path]);
      assert.ok(!keys.has(key));
      keys.add(key);
      assert.ok(
        round.files.some(
          (f) => f.pid === service.pid && f.descriptor === String(fd.fd) && f.name === fd.path && f.type === 'DIR',
        ),
      );
    }
  }
  assert.ok(pids.has(proof.endpoint.ownerPid));
  const owner = proof.services.find((service) => service.pid === proof.endpoint.ownerPid);
  assert.ok(
    owner.fds.some((fd) => fd.path === identity.worktree && String(fd.inode) === proof.sourceInode),
    'Actual Docker endpoint owner must retain the exact source root vnode',
  );
  return keys;
}

// Mirror the published metadata/unknown policy. This proof observes other
// frontends; it neither stops them nor adds a new nonce/ownership requirement.
export function referenceFrontendMetadata(port, response, lease) {
  let metadata;
  try {
    if (response.statusCode === 200) metadata = JSON.parse(response.body);
  } catch {
    /* Original unknown policy below. */
  }
  const recognized =
    metadata?.type === 'zdm-task-preview' &&
    typeof metadata.workspaceRoot === 'string' &&
    path.isAbsolute(metadata.workspaceRoot) &&
    typeof metadata.branch === 'string' &&
    ['full', 'frontend'].includes(metadata.mode) &&
    typeof metadata.apiTarget === 'string' &&
    /^http:\/\/127\.0\.0\.1:80(?:8[1-9]|9\d)$/.test(metadata.apiTarget);
  if (recognized) return metadata;
  assert.ok(
    !lease &&
      ((response.statusCode === 0 && response.errorCode === 'ECONNREFUSED') ||
        (port >= 5177 && response.statusCode >= 200 && response.statusCode < 500)),
    'Unknown other frontend consumer',
  );
  return null;
}

// Pure checks are also exercised with hostile fixtures. Production obtains all
// inputs itself; this function grants no capability and changes no runtime.
export function assertStoppedPreviewRound(round, identity, now) {
  assert.equal(round.host, identity.host, 'Cross-host stopped-preview observation');
  assert.equal(round.dockerEndpoint, identity.dockerEndpoint, 'Docker endpoint changed');
  assert.match(round.dockerEndpoint, /^unix:\/\//);
  assert.ok(Number.isFinite(round.observedAt) && round.observedAt <= now && now - round.observedAt <= 60000);
  assert.ok(Number.isSafeInteger(round.observerPid) && round.observerPid > 0);
  assert.ok(
    round.processes.length && round.files.length && Array.isArray(round.containers),
    'Incomplete host inventory',
  );
  assert.ok(
    round.processes.some((p) => p.pid === round.observerPid),
    'Observer absent from inventory',
  );
  assert.ok(!round.processes.some((p) => p.pid === identity.lease.pid), 'Lease process active or PID reused');
  assert.deepEqual(round.frontend, { statusCode: 0, errorCode: 'ECONNREFUSED' }, 'Frontend not positively closed');
  const tokens = [identity.task, identity.worktree, identity.lease.token];
  const retained = retainedDirectoryKeys(round, identity);
  const ignored = new Set([round.observerPid]);
  // Invoke the public collector with exec. No process-name/wrapper allowlist.
  assert.deepEqual(round.wrapperAncestors, []);
  for (const p of round.processes) {
    assert.ok(Number.isSafeInteger(p.pid) && p.pid > 0 && Number.isSafeInteger(p.ppid) && p.ppid >= 0);
    assert.ok(typeof p.command === 'string' && p.command);
    if (!ignored.has(p.pid))
      assert.ok(!tokens.some((token) => mentions(p.command, token)), 'Task/nonce process remains');
  }
  for (const file of round.files) {
    assert.ok(Number.isSafeInteger(file.pid) && file.pid > 0 && typeof file.name === 'string');
    if (file.opaque === true) {
      assert.ok(
        file.name === '' && ['NPOLICY', 'NEXUS', 'PIPE'].includes(file.type) && /^\d+[rwu-]?$/.test(file.descriptor),
      );
      continue;
    }
    assert.ok(file.name, 'Unknown open file');
    assert.ok(
      (!under(file.name, identity.worktree) ||
        (file.type === 'DIR' && retained.has(JSON.stringify([file.pid, file.descriptor, file.name])))) &&
        !file.name.includes(identity.lease.token),
      'Task file/nonce remains open',
    );
    if (['IPv4', 'IPv6'].includes(file.type)) {
      assert.ok(!new RegExp(':' + identity.port + '(?:$|->|\\s)').test(file.name), 'Frontend socket remains');
      assert.ok(
        !new RegExp('->[^\\s]*:' + identity.backendPort + '(?:$|\\s)').test(file.name),
        'A live client still references the retained backend',
      );
    }
  }
  for (const container of round.containers) {
    assert.ok(container && typeof container.labels === 'object' && Array.isArray(container.mounts));
    if (container.id === identity.backend.id) {
      assert.deepEqual(container, identity.backend.inventory, 'Retained backend changed');
      continue;
    }
    assert.ok(
      !Object.values(container.labels).some((v) => typeof v === 'string' && tokens.some((t) => mentions(v, t))),
      'Other task container remains',
    );
    assert.ok(
      !container.mounts.some(
        (m) =>
          typeof m.Source === 'string' &&
          (under(m.Source, identity.worktree) ||
            (retained.size && under(identity.worktree, observedHostMountPath(m.Source, 'darwin')))),
      ),
      'Other container retains the source',
    );
  }
  assert.ok(
    round.containers.some((c) => c.id === identity.backend.id),
    'Retained backend disappeared',
  );
  assert.deepEqual(round.backendHealth, { statusCode: 200, status: 'UP' }, 'Retained backend unhealthy');
  assert.deepEqual(round.backendConsumers, [], 'Recognized frontend still references retained backend');
}

export function assertStoppedPreviewPair({ identity, afterFirst, afterSecond, first, second }, now) {
  assertStoppedPreviewIdentity(identity);
  assertStoppedPreviewRound(first, identity, now);
  assertStoppedPreviewRound(second, identity, now);
  assert.deepEqual(afterFirst, identity, 'Identity changed after first full observation');
  assert.deepEqual(afterSecond, identity, 'Identity changed after second full observation');
  assert.ok(second.observedAt >= first.observedAt, 'Observation order reversed');
  assert.deepEqual(second.previewLeases, first.previewLeases, 'Leases changed between full observations');
  assert.deepEqual(
    second.retainedDirectoryReferences,
    first.retainedDirectoryReferences,
    'Retained Docker directory identities changed between rounds',
  );
  assert.deepEqual(
    second.frontendObservations,
    first.frontendObservations,
    'Frontend observations changed between rounds',
  );
}

export function assertStoppedPreviewIdentity(identity) {
  assert.ok(identity.task && identity.executor && path.isAbsolute(identity.worktree));
  assert.match(identity.head, /^[a-f0-9]{40}$/);
  assert.match(identity.registryDigest, /^[a-f0-9]{64}$/);
  assert.equal(identity.lease.task, identity.task);
  assert.deepEqual(Object.keys(identity.lease).sort(), ['pid', 'resource', 'task', 'token']);
  assert.equal(identity.lease.resource, 'temporary-port-' + identity.port);
  assert.ok(identity.port >= 5177 && identity.port <= 5199);
  assert.ok(Number.isSafeInteger(identity.lease.pid) && identity.lease.pid > 0);
  assert.match(identity.lease.token, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(identity.data.status, 'ready');
  assert.equal(identity.data.databaseExists, true);
  assert.equal(identity.data.mediaExists, true);
  assert.equal(identity.data.backupExists, true);
  assert.match(identity.data.registrationDigest, /^[a-f0-9]{64}$/);
  assert.match(identity.backend.id, /^[a-f0-9]{64}$/);
  assert.equal(identity.history.task, identity.task);
  assert.equal(identity.history.worker, identity.executor);
  assert.equal(identity.history.port, identity.port);
  assert.equal(identity.history.backendPort, identity.backendPort);
  assert.equal(identity.history.head, identity.head);
  assert.match(identity.history.startDigest, /^[a-f0-9]{64}$/);
  assert.match(identity.history.checkDigest, /^[a-f0-9]{64}$/);
  assert.match(identity.history.statusDigest, /^[a-f0-9]{64}$/);
  for (const value of [
    identity.history.startedAt,
    identity.history.checkedAt,
    identity.history.finishedAt,
    identity.leaseFile.birthtimeMs,
    identity.leaseFile.ctimeMs,
    identity.leaseFile.mtimeMs,
  ])
    assert.ok(Number.isFinite(value));
  assert.ok(identity.leaseFile.birthtimeMs >= identity.history.startedAt);
  assert.ok(identity.leaseFile.birthtimeMs <= identity.history.checkedAt);
  assert.ok(
    identity.leaseFile.ctimeMs <= identity.history.checkedAt,
    'Lease changed after historical live nonce check',
  );
  assert.ok(identity.leaseFile.mtimeMs <= identity.history.checkedAt);
  assert.ok(identity.history.finishedAt >= identity.history.checkedAt, 'Original execution did not finish after check');
}
