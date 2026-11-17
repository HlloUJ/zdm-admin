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
      !under(file.name, identity.worktree) && !file.name.includes(identity.lease.token),
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
      !container.mounts.some((m) => typeof m.Source === 'string' && under(m.Source, identity.worktree)),
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
