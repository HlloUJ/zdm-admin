import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  linkSync,
  chmodSync,
  rmSync,
  realpathSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  lstatSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertStoppedPreviewIdentity,
  assertStoppedPreviewRound,
  assertStoppedPreviewPair,
  referenceFrontendMetadata,
  observedHostMountPath,
} from './preview-reference-proof-core.mjs';
import {
  nativeOutputObjects,
  parseNativePreviewHistory,
  regularReferenceFile,
  verifyPublishedReferenceSnapshot,
} from './preview-reference-history.mjs';
import {
  verifyClosedPreviewReference,
  referenceConsumerAnchor,
  createReferenceEvidenceJournal,
} from './preview-reference-proof.mjs';
import { inspectPreviewConsumers } from '../preview-consumers.mjs';
import { parseDockerVnodeInventory } from './preview-docker-directories.mjs';

const sha = 'a'.repeat(64),
  head = 'b'.repeat(40);
test('rejected observations retain the original inventory before failure without overwriting events', () => {
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'reference-evidence-')));
  const directory = path.join(parent, 'attempt');
  try {
    const record = createReferenceEvidenceJournal(directory);
    const inventory = { files: [{ pid: 887, descriptor: '5004', type: 'DIR', name: '/missing' }] };
    const original = record('host-inventory', inventory);
    inventory.files[0].name = '/later';
    const rejected = record('rejected', { name: 'AssertionError', message: 'Task file/nonce remains open' });
    assert.deepEqual(JSON.parse(readFileSync(original)).value.files[0], {
      pid: 887,
      descriptor: '5004',
      type: 'DIR',
      name: '/missing',
    });
    assert.equal(JSON.parse(readFileSync(rejected)).value.message, 'Task file/nonce remains open');
    assert.deepEqual(readdirSync(directory), ['001-host-inventory.json', '002-rejected.json']);
    assert.equal(lstatSync(directory).mode & 0o777, 0o700);
    assert.equal(lstatSync(original).mode & 0o777, 0o600);
    assert.throws(() => createReferenceEvidenceJournal(directory), /EEXIST/);
    assert.throws(() => record('../escape', {}));
    const collision = path.join(directory, '003-round.json');
    writeFileSync(collision, 'existing observation');
    assert.throws(() => record('round', {}), /EEXIST/);
    assert.equal(readFileSync(collision, 'utf8'), 'existing observation');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
test('Docker Desktop migration mount uses its actual macOS host path without changing Linux paths', () => {
  assert.equal(observedHostMountPath('/host_mnt/private/task/migrations', 'darwin'), '/private/task/migrations');
  assert.equal(observedHostMountPath('/private/task/migrations', 'darwin'), '/private/task/migrations');
  assert.equal(
    observedHostMountPath('/host_mnt/private/task/migrations', 'linux'),
    '/host_mnt/private/task/migrations',
  );
  assert.throws(() => observedHostMountPath('relative/migrations', 'darwin'));
  assert.throws(() => observedHostMountPath('/host_mnt/task/../migrations', 'darwin'));
});
function identity() {
  const backend = { id: 'c'.repeat(64), labels: { task: 'foreign' }, mounts: [{ Source: '/repo/foreign' }] };
  return {
    task: 'foreign',
    executor: 'worker',
    host: 'local',
    worktree: '/repo/foreign',
    branch: 'codex/foreign',
    head,
    registryDigest: sha,
    dockerEndpoint: 'unix:///docker.sock',
    port: 5177,
    backendPort: 8082,
    lease: { resource: 'temporary-port-5177', task: 'foreign', pid: 99, token: '036998b8-e41b-40db-9f02-b54aad3a4ae7' },
    leaseFile: { birthtimeMs: 100, mtimeMs: 100, ctimeMs: 100 },
    data: { status: 'ready', databaseExists: true, mediaExists: true, backupExists: true, registrationDigest: sha },
    backend: { id: backend.id, inventory: backend },
    history: {
      task: 'foreign',
      worker: 'worker',
      port: 5177,
      backendPort: 8082,
      head,
      startedAt: 90,
      checkedAt: 110,
      finishedAt: 120,
      startDigest: sha,
      checkDigest: sha,
      statusDigest: sha,
    },
  };
}
function round(i = identity()) {
  return {
    host: 'local',
    dockerEndpoint: 'unix:///docker.sock',
    observedAt: 900,
    observerPid: 1,
    processes: [
      { pid: 1, ppid: 2, command: 'actual observer' },
      { pid: 2, ppid: 0, command: 'native host' },
    ],
    files: [{ pid: 2, descriptor: 'cwd', type: 'DIR', name: '/other' }],
    containers: [i.backend.inventory],
    wrapperAncestors: [],
    frontend: { statusCode: 0, errorCode: 'ECONNREFUSED' },
    backendHealth: { statusCode: 200, status: 'UP' },
    backendConsumers: [],
  };
}
function retainedDirectoryFixture() {
  const i = identity(),
    r = round(i);
  const mount = { Type: 'bind', Source: '/host_mnt/repo/foreign', Destination: '/workspace' };
  i.backend.inventory.mounts = [mount];
  r.containers = [structuredClone(i.backend.inventory)];
  r.processes.push(
    { pid: 10, ppid: 2, command: '/Applications/Docker.app/Contents/MacOS/com.docker.backend services' },
    { pid: 11, ppid: 10, command: '/Applications/Docker.app/Contents/MacOS/com.docker.sailor' },
  );
  r.files.push({ pid: 10, descriptor: '20', type: 'unix', name: '/docker.sock' });
  const directory = (fd, name) => ({
    fd,
    returnedSize: 1200,
    errno: 0,
    device: 12,
    inode: fd + 100,
    nlink: 2,
    mode: 0o40755,
    directory: true,
    vnodeType: 2,
    fileType: 1,
    openFlags: 1,
    guardFlags: 0,
    path: name,
    lstatStatus: 0,
    lstatErrno: 0,
    pathDevice: 12,
    pathInode: fd + 100,
    pathMode: 0o40755,
    fsgetpathErrno: 0,
    fsgetpath: name,
  });
  const services = [10, 11].map((pid) => ({
    pid,
    ppid: pid === 10 ? 2 : 10,
    uid: 501,
    startSeconds: 50,
    startMicros: 1,
    processStable: true,
    expectedSize: 1200,
    executable: '/Applications/Docker.app/Contents/MacOS/' + (pid === 10 ? 'com.docker.backend' : 'com.docker.sailor'),
    fds: [directory(pid, pid === 10 ? i.worktree : i.worktree + '/src')],
  }));
  for (const service of services) {
    service.image = {
      executable: service.executable,
      identifier: service.pid === 10 ? 'com.docker.docker' : 'com.docker',
      team: '9BNSXJN65R',
      hash: sha,
      signatureVerified: true,
    };
    for (const fd of service.fds)
      r.files.push({ pid: service.pid, descriptor: String(fd.fd), type: 'DIR', name: fd.path });
  }
  r.retainedDirectoryReferences = {
    kind: 'retained-docker-source-directories-v1',
    backend: i.backend.id,
    sourceMount: mount,
    sourceDevice: '12',
    sourceInode: '110',
    sourceUid: 501,
    endpoint: { path: '/docker.sock', ownerPid: 10 },
    services,
    cleanupAuthorized: false,
  };
  return { i, r };
}
test('actual Docker vnode inventory preserves numeric DIR and executable image identities', () => {
  assert.deepEqual(
    parseDockerVnodeInventory('p10\0\nf20\0ar\0tDIR\0D0xc\0i110\0n/repo/foreign\0\nf txt\0tREG\0n/image\0'),
    [
      { pid: 10, descriptor: '20', a: 'r', t: 'DIR', D: '0xc', i: '110', n: '/repo/foreign' },
      { pid: 10, descriptor: ' txt', t: 'REG', n: '/image' },
    ],
  );
  assert.throws(() => parseDockerVnodeInventory('p10\0f20\0tDIR\0tREG\0'), /Duplicate/);
});
test('retained signed Docker service directory references are preserved and grant no asset cleanup', () => {
  const { i, r } = retainedDirectoryFixture();
  assertStoppedPreviewRound(r, i, 950);
  const second = structuredClone(r);
  second.observedAt++;
  assertStoppedPreviewPair({ identity: i, afterFirst: i, afterSecond: i, first: r, second }, 950);
  const fd = r.retainedDirectoryReferences.services[1].fds[0];
  Object.assign(fd, {
    lstatStatus: -1,
    lstatErrno: 2,
    fsgetpathSize: -1,
    fsgetpathErrno: 2,
    fsgetpath: '',
    parent: i.worktree,
    parentStatus: 0,
    parentDevice: 12,
    parentInode: 110,
    parentMode: 0o40755,
  });
  assertStoppedPreviewRound(r, i, 950);
  assert.equal(fd.nlink, 2);
  assert.equal(r.retainedDirectoryReferences.cleanupAuthorized, false);
  fd.openFlags = 0x8001; // Actual macOS FREAD | O_EVTONLY watcher flags.
  assertStoppedPreviewRound(r, i, 950);
});
for (const [name, mutate] of [
  ['wrong endpoint', (p) => (p.endpoint.path = '/remote.sock')],
  ['wrong endpoint owner', (p) => (p.endpoint.ownerPid = 12)],
  ['source mount changed', (p) => (p.sourceMount = { ...p.sourceMount, Destination: '/other' })],
  ['container changed', (p) => (p.backend = 'd'.repeat(64))],
  ['source device changed', (p) => (p.sourceDevice = '13')],
  ['wrong signer', (p) => (p.services[1].image.team = 'unknown')],
  ['no signature', (p) => (p.services[1].image.signatureVerified = false)],
  ['wrong executable', (p) => (p.services[1].executable = '/usr/bin/node')],
  ['no direct parent', (p) => (p.services[1].ppid = 2)],
  ['changed UID', (p) => (p.services[1].uid = 0)],
  ['PID reused', (p) => (p.services[1].startSeconds = 0)],
  ['unstable PID', (p) => (p.services[1].processStable = false)],
  ['not a directory', (p) => (p.services[1].fds[0].directory = false)],
  ['wrong vnode type', (p) => (p.services[1].fds[0].vnodeType = 1)],
  ['writable handle', (p) => (p.services[1].fds[0].openFlags = 3)],
  ['unknown handle flags', (p) => (p.services[1].fds[0].openFlags = 0x4001)],
  ['unknown kernel result', (p) => (p.services[1].fds[0].returnedSize = 0)],
  ['inode path changed', (p) => p.services[1].fds[0].pathInode++],
  ['unmapped path', (p) => (p.services[1].fds[0].path = '/elsewhere')],
  ['guarded handle', (p) => (p.services[1].fds[0].guardFlags = 1)],
  ['cleanup flag', (p) => (p.cleanupAuthorized = true)],
])
  test('retained directory proof rejects ' + name, () => {
    const { i, r } = retainedDirectoryFixture();
    mutate(r.retainedDirectoryReferences);
    assert.throws(() => assertStoppedPreviewRound(r, i, 950));
  });
test('retained Docker directories do not exempt REG, unknown PIDs, extra directories, sockets or overlapping containers', () => {
  for (const extra of [
    { pid: 11, descriptor: '11', type: 'REG', name: '/repo/foreign/src' },
    { pid: 12, descriptor: '11', type: 'DIR', name: '/repo/foreign/src' },
    { pid: 11, descriptor: '99', type: 'DIR', name: '/repo/foreign/new' },
    { pid: 11, descriptor: '12', type: 'IPv4', name: '127.0.0.1:8000->127.0.0.1:8082' },
  ]) {
    const { i, r } = retainedDirectoryFixture();
    r.files.push(extra);
    assert.throws(() => assertStoppedPreviewRound(r, i, 950));
  }
  const { i, r } = retainedDirectoryFixture();
  r.containers.push({ id: 'd'.repeat(64), labels: {}, mounts: [{ Source: '/host_mnt/repo' }] });
  assert.throws(() => assertStoppedPreviewRound(r, i, 950), /Other container/);
});
test('missing retained namespace requires a real same-device existing parent and stable two-round vnode identities', () => {
  for (const change of [
    (fd) => (fd.parent = '/elsewhere'),
    (fd) => (fd.parentDevice = 13),
    (fd) => (fd.parentStatus = -1),
    (fd) => (fd.lstatErrno = 13),
    (fd) => (fd.fsgetpathErrno = 13),
    (fd) => (fd.parentInode = 0),
  ]) {
    const { i, r } = retainedDirectoryFixture(),
      fd = r.retainedDirectoryReferences.services[1].fds[0];
    Object.assign(fd, {
      lstatStatus: -1,
      lstatErrno: 2,
      fsgetpathSize: -1,
      fsgetpathErrno: 2,
      fsgetpath: '',
      parent: i.worktree,
      parentStatus: 0,
      parentDevice: 12,
      parentInode: 110,
      parentMode: 0o40755,
    });
    change(fd);
    assert.throws(() => assertStoppedPreviewRound(r, i, 950));
  }
  const { i, r } = retainedDirectoryFixture(),
    second = structuredClone(r);
  second.retainedDirectoryReferences.services[1].startMicros++;
  assert.throws(
    () => assertStoppedPreviewPair({ identity: i, afterFirst: i, afterSecond: i, first: r, second }, 950),
    /identities changed/,
  );
});
test('complete stopped-frontend checks preserve the retained backend and never mutate supplied observations', () => {
  const i = identity(),
    r = round(i),
    before = structuredClone({ i, r });
  assertStoppedPreviewIdentity(i);
  assertStoppedPreviewRound(r, i, 1000);
  assert.deepEqual({ i, r }, before);
});
const legacyMetadata = {
  type: 'zdm-task-preview',
  workspaceRoot: '/repo/other',
  branch: 'codex/other',
  mode: 'frontend',
  apiTarget: 'http://127.0.0.1:8081',
};
for (const [name, port, response, leased] of [
  ['unleased legacy no nonce', 5179, { statusCode: 200, body: JSON.stringify(legacyMetadata) }, false],
  ['leased recognized legacy no nonce', 5179, { statusCode: 200, body: JSON.stringify(legacyMetadata) }, true],
  ['unrelated temporary HTML', 5190, { statusCode: 200, body: '<html>other server</html>' }, false],
  ['unrecognized temporary metadata', 5190, { statusCode: 200, body: '{"type":"zdm-task-preview"}' }, false],
  ['unknown leased metadata', 5179, { statusCode: 200, body: '{"type":"zdm-task-preview"}' }, true],
  ['closed unleased', 5179, { statusCode: 0, errorCode: 'ECONNREFUSED' }, false],
  ['closed leased', 5179, { statusCode: 0, errorCode: 'ECONNREFUSED' }, true],
  ['timeout unleased', 5179, { statusCode: 0, errorCode: 'ETIMEDOUT' }, false],
  ['unrecognized fixed server', 5175, { statusCode: 200, body: '<html>other</html>' }, false],
])
  test('other-frontend observation preserves published policy: ' + name, async () => {
    const lease = leased
      ? { port, resource: 'temporary-port-' + port, task: 'other', pid: 99, token: 'original' }
      : undefined;
    let expected;
    try {
      expected = await inspectPreviewConsumers(
        { worktree: '/repo/a', taskId: 'a', ports: [port] },
        { readLeases: () => (lease ? [lease] : []), request: async () => response },
      );
    } catch {
      assert.throws(() => referenceFrontendMetadata(port, response, lease));
      return;
    }
    assert.deepEqual(referenceFrontendMetadata(port, response, lease), expected.observations[0].metadata);
  });
function pair() {
  const i = identity(),
    first = round(i),
    second = structuredClone(first);
  first.previewLeases = [i.lease];
  second.previewLeases = structuredClone(first.previewLeases);
  first.frontendObservations = [{ port: 5177, statusCode: 0 }];
  second.frontendObservations = structuredClone(first.frontendObservations);
  second.observedAt = 901;
  return { identity: i, afterFirst: structuredClone(i), afterSecond: structuredClone(i), first, second };
}
test('both complete rounds and all three identical identities are required', () =>
  assertStoppedPreviewPair(pair(), 1000));
for (const [name, mutate] of Object.entries({
  'registry revision': (p) => {
    p.afterFirst.registryDigest = 'd'.repeat(64);
  },
  'source after second round': (p) => {
    p.afterSecond.head = 'd'.repeat(40);
  },
  'nonce changed': (p) => {
    p.afterSecond.lease.token = 'd'.repeat(36);
  },
  'inode changed': (p) => {
    p.afterFirst.leaseFile.inode = 'other';
  },
  'data registration changed': (p) => {
    p.afterSecond.data.registrationDigest = 'd'.repeat(64);
  },
  'observation order': (p) => {
    p.second.observedAt = 899;
  },
  'another lease appeared': (p) => {
    p.second.previewLeases.push({ resource: 'temporary-port-5180' });
  },
  'other frontend changed': (p) => {
    p.second.frontendObservations.push({ port: 5180, statusCode: 200 });
  },
}))
  test('round-pair rejects ' + name, () => {
    const p = pair();
    mutate(p);
    assert.throws(() => assertStoppedPreviewPair(p, 1000));
  });

const badRounds = {
  'foreign host': (r) => {
    r.host = 'other';
  },
  'remote Docker': (r) => {
    r.dockerEndpoint = 'tcp://remote';
  },
  stale: (r) => {
    r.observedAt = -60000;
  },
  future: (r) => {
    r.observedAt = 1001;
  },
  'missing observer': (r) => {
    r.processes.shift();
  },
  'missing full process inventory': (r) => {
    r.processes = [];
  },
  'missing full file inventory': (r) => {
    r.files = [];
  },
  'PID reuse': (r) => {
    r.processes.push({ pid: 99, ppid: 2, command: 'unrelated new process' });
  },
  'task child': (r) => {
    r.processes.push({ pid: 3, ppid: 99, command: 'node /repo/foreign/server.mjs' });
  },
  'same task --test process remains': (r) => {
    r.processes.push({ pid: 3, ppid: 2, command: 'node --test /repo/foreign/proof.test.mjs' });
  },
  'nonce process': (r, i) => {
    r.processes.push({ pid: 3, ppid: 2, command: 'node --runtime=' + i.lease.token });
  },
  'source cwd': (r) => {
    r.files[0].name = '/repo/foreign';
  },
  'source child file': (r) => {
    r.files[0].name = '/repo/foreign/src/app.vue';
  },
  'host_mnt alias': (r) => {
    r.files[0].name = '/host_mnt/repo/foreign/src/app.vue';
  },
  'deleted source still open': (r) => {
    r.files[0].name = '/repo/foreign/src/app.vue (deleted)';
  },
  'nonce open file': (r, i) => {
    r.files[0].name = '/tmp/' + i.lease.token;
  },
  'opaque unknown file': (r) => {
    r.files[0] = { pid: 2, descriptor: '3', type: 'REG', name: '', opaque: true };
  },
  'invalid process': (r) => {
    r.processes[1].pid = 0;
  },
  'unverified wrapper allowlist': (r) => {
    r.wrapperAncestors.push(r.processes[1]);
  },
  'timeout is unknown': (r) => {
    r.frontend.errorCode = 'ETIMEDOUT';
  },
  'reset is unknown': (r) => {
    r.frontend.errorCode = 'ECONNRESET';
  },
  'foreign HTTP response': (r) => {
    r.frontend = { statusCode: 200 };
  },
  'frontend listener': (r) => {
    r.files.push({ pid: 2, type: 'IPv4', name: '127.0.0.1:5177' });
  },
  'frontend outbound socket': (r) => {
    r.files.push({ pid: 2, type: 'IPv4', name: '127.0.0.1:5177->127.0.0.1:8082' });
  },
  'backend client connection': (r) => {
    r.files.push({ pid: 2, type: 'IPv4', name: '127.0.0.1:20000->127.0.0.1:8082' });
  },
  'IPv6 backend client': (r) => {
    r.files.push({ pid: 2, type: 'IPv6', name: '[::1]:20000->[::1]:8082' });
  },
  'backend disappeared': (r) => {
    r.containers = [];
  },
  'backend mount changed': (r) => {
    r.containers[0].mounts[0].Source = '/other';
  },
  'foreign task container': (r) => {
    r.containers.push({ id: 'd'.repeat(64), labels: { task: 'foreign' }, mounts: [] });
  },
  'foreign mount': (r) => {
    r.containers.push({ id: 'd'.repeat(64), labels: {}, mounts: [{ Source: '/repo/foreign/backend' }] });
  },
  'unhealthy backend': (r) => {
    r.backendHealth.status = 'DOWN';
  },
  'another frontend consumer': (r) => {
    r.backendConsumers.push({ port: 5180 });
  },
};
for (const [name, mutate] of Object.entries(badRounds))
  test('read-only proof refuses ' + name, () => {
    const i = identity(),
      r = structuredClone(round(i));
    mutate(r, i);
    assert.throws(() => assertStoppedPreviewRound(r, i, 1000));
  });
const badIdentities = {
  'foreign lease': (i) => {
    i.lease.task = 'other';
  },
  'different port': (i) => {
    i.port = 5178;
  },
  'invalid nonce': (i) => {
    i.lease.token = 'safe';
  },
  'missing database': (i) => {
    i.data.databaseExists = false;
  },
  'missing media': (i) => {
    i.data.mediaExists = false;
  },
  'missing backup': (i) => {
    i.data.backupExists = false;
  },
  'unready data': (i) => {
    i.data.status = 'initializing';
  },
  'foreign native worker': (i) => {
    i.history.worker = 'other';
  },
  'different source': (i) => {
    i.history.head = 'd'.repeat(40);
  },
  'unknown history': (i) => {
    delete i.history.statusDigest;
  },
  'lease replaced after check': (i) => {
    i.leaseFile.ctimeMs = 111;
  },
  'lease rewritten after check': (i) => {
    i.leaseFile.mtimeMs = 111;
  },
  'lease predates original execution': (i) => {
    i.leaseFile.birthtimeMs = 89;
  },
  'execution never ended after live check': (i) => {
    i.history.finishedAt = 109;
  },
};
for (const [name, mutate] of Object.entries(badIdentities))
  test('identity refuses ' + name, () => {
    const i = identity();
    mutate(i);
    assert.throws(() => assertStoppedPreviewIdentity(i));
  });

function historyFixture() {
  const task = { id: 'foreign', worktree: '/repo/foreign', branch: 'codex/foreign' };
  const expected = { task, worker: 'worker', port: 5177, backendPort: 8082, anchor: '/repo/main', head };
  const ready = {
    task: task.id,
    worktree: task.worktree,
    branch: task.branch,
    runtimeReady: true,
    previews: [{ port: 5177, api: 'http://127.0.0.1:8082', runtimeReady: true, errors: [] }],
  };
  const event = (id, command, output, start, end, code = 0) => ({
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      thread_id: 'worker',
      started_at_ms: start,
      completed_at_ms: end,
      item: {
        type: 'CommandExecution',
        id,
        status: code ? 'failed' : 'completed',
        exit_code: code,
        cwd: pathToFileURL('/repo/main').href,
        command: ['/bin/zsh', '-lc', command],
        aggregated_output: 'native log\n' + JSON.stringify(output, null, 2) + '\n',
      },
    },
  });
  const prefix = 'npm run task:entry -- --worktree /repo/foreign ';
  const records = [
    { type: 'session_meta', payload: { id: 'worker' } },
    event('start', prefix + 'preview start --task foreign', { ...ready, reused: false }, 100, 300, 1),
    event('check', prefix + 'preview check --task foreign', ready, 150, 170),
    event(
      'source',
      prefix + 'work status foreign',
      { task: 'foreign', currentHead: head, recordedHead: head, clean: true, recordedHeadMatches: true },
      171,
      180,
    ),
  ];
  return { expected, records };
}
const parse = (f) =>
  parseNativePreviewHistory(Buffer.from(f.records.map((r) => JSON.stringify(r)).join('\n') + '\n'), f.expected);
test('native history requires an ended real start, successful live nonce-check route and clean exact source status', () => {
  const f = historyFixture(),
    result = parse(f);
  assert.deepEqual(result.executionIds, ['start', 'check', 'source']);
  assert.equal(result.head, head);
  assert.equal(result.originals.length, 3);
});
const badHistory = {
  'caller safe JSON': (f) => {
    f.records = [{ safe: true }];
  },
  'foreign session': (f) => {
    f.records[0].payload.id = 'other';
  },
  'foreign command worker': (f) => {
    f.records[2].payload.thread_id = 'other';
  },
  'nonzero check': (f) => {
    f.records[2].payload.item.exit_code = 1;
  },
  'failed status': (f) => {
    f.records[3].payload.item.exit_code = 1;
  },
  'unknown exit': (f) => {
    delete f.records[1].payload.item.exit_code;
  },
  'reused unidentified start': (f) => {
    f.records[1].payload.item.aggregated_output = f.records[1].payload.item.aggregated_output.replace(
      '"reused": false',
      '"reused": true',
    );
  },
  'still running': (f) => {
    f.records[1].payload.item.status = 'in_progress';
  },
  'unclosed execution': (f) => {
    f.records[1].payload.completed_at_ms = Date.now() + 100000;
  },
  'foreign source cwd': (f) => {
    f.records[2].payload.item.cwd = pathToFileURL('/repo/other').href;
  },
  'appended command': (f) => {
    f.records[2].payload.item.command[2] += '; echo safe';
  },
  'caller generated output command': (f) => {
    f.records[2].payload.item.command[2] = 'echo ' + JSON.stringify({ runtimeReady: true });
  },
  'duplicate native lifecycle': (f) => {
    f.records.push(structuredClone(f.records[1]));
  },
  'dirty source': (f) => {
    f.records[3].payload.item.aggregated_output = JSON.stringify({
      task: 'foreign',
      currentHead: head,
      recordedHead: head,
      clean: false,
      recordedHeadMatches: true,
    });
  },
  'wrong API': (f) => {
    f.records[2].payload.item.aggregated_output = f.records[2].payload.item.aggregated_output.replaceAll(
      '8082',
      '8080',
    );
  },
  'wrong frontend port': (f) => {
    f.records[2].payload.item.aggregated_output = f.records[2].payload.item.aggregated_output.replaceAll(
      '5177',
      '5180',
    );
  },
  'fake live readiness': (f) => {
    f.records[2].payload.item.aggregated_output = '{"runtimeReady":true}';
  },
};
for (const [name, mutate] of Object.entries(badHistory))
  test('native provenance refuses ' + name, () => {
    const f = historyFixture();
    mutate(f);
    assert.throws(() => parse(f));
  });
test('JSON output parser handles quoted braces without interpreting nested text as native facts', () => {
  const output = { text: '} { "', ok: true };
  assert.deepEqual(nativeOutputObjects('log\n' + JSON.stringify(output) + '\n'), [output]);
  assert.deepEqual(nativeOutputObjects('log {"safe":true}\n'), []);
});
test('actual evidence files reject symlinks, hardlinks and writable replacements', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'zdm-reference-file-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'native');
  writeFileSync(file, 'original', { mode: 0o600 });
  assert.equal(regularReferenceFile(file).bytes.toString(), 'original');
  const linked = path.join(dir, 'linked');
  symlinkSync(file, linked);
  assert.throws(() => regularReferenceFile(linked));
  const hard = path.join(dir, 'hard');
  linkSync(file, hard);
  assert.throws(() => regularReferenceFile(file));
  rmSync(hard);
  chmodSync(file, 0o666);
  assert.throws(() => regularReferenceFile(file));
});
test('unrelated consumers accept no caller-supplied safe flag or observation adapter', async () => {
  assert.equal(
    await verifyClosedPreviewReference({
      worktree: '/repo/a',
      taskId: 'a',
      lease: identity().lease,
      safe: true,
      observe: () => round(),
    }),
    null,
  );
  await assert.rejects(
    inspectPreviewConsumers(
      { worktree: '/repo/a', taskId: 'a', ports: [5177] },
      {
        readLeases: () => [{ port: 5177, ...identity().lease }],
        request: async () => ({ statusCode: 0, errorCode: 'ECONNREFUSED' }),
      },
    ),
    /unknown on leased port/,
  );
});
test('public completion CLI routes the proof command and rejects incomplete input before observations', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/task-completion.mjs'), 'reference-proof'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected reference-proof/);
});
test('raw task common-dir registration resolves the actual main anchor through a real Git worktree', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'zdm-reference-main-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const main = path.join(dir, 'main'),
    worker = path.join(dir, 'worker');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '--initial-branch=main', main);
  git(
    '-C',
    main,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@invalid.test',
    'commit',
    '--allow-empty',
    '-m',
    'seed',
  );
  git('-C', main, 'worktree', 'add', '-b', 'codex/fixture', worker);
  const registration = { commonDir: path.join(main, '.git') };
  assert.equal(referenceConsumerAnchor(worker, registration.commonDir), main);
  assert.throws(() => referenceConsumerAnchor(worker, path.join(worker, '.git')));
});
test('published observer snapshot verifies every real Git blob and rejects writable, changed or extra source', (t) => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'zdm-reference-snapshot-')));
  const main = path.join(dir, 'main'),
    snapshot = path.join(dir, 'snapshot'),
    name = 'observer.mjs';
  t.after(() => {
    if (existsSync(snapshot)) chmodSync(snapshot, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '--initial-branch=main', main);
  const original = 'export const observer = true;\n';
  writeFileSync(path.join(main, name), original);
  git('-C', main, 'add', name);
  git(
    '-C',
    main,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@invalid.test',
    'commit',
    '-m',
    'published observer',
  );
  const commit = git('-C', main, 'rev-parse', 'HEAD');
  git('-C', main, 'update-ref', 'refs/remotes/origin/main', commit);
  mkdirSync(snapshot);
  writeFileSync(path.join(snapshot, name), original, { mode: 0o444 });
  chmodSync(snapshot, 0o555);
  assert.equal(verifyPublishedReferenceSnapshot(main, snapshot, commit).files, 1);
  chmodSync(snapshot, 0o755);
  assert.throws(() => verifyPublishedReferenceSnapshot(main, snapshot, commit), /writable/);
  chmodSync(snapshot, 0o555);
  chmodSync(path.join(snapshot, name), 0o644);
  assert.throws(() => verifyPublishedReferenceSnapshot(main, snapshot, commit), /writable/);
  writeFileSync(path.join(snapshot, name), 'export const observer = false;\n');
  chmodSync(path.join(snapshot, name), 0o444);
  assert.throws(() => verifyPublishedReferenceSnapshot(main, snapshot, commit), /blob mismatch/);
  chmodSync(path.join(snapshot, name), 0o644);
  writeFileSync(path.join(snapshot, name), original);
  chmodSync(path.join(snapshot, name), 0o444);
  chmodSync(snapshot, 0o755);
  writeFileSync(path.join(snapshot, 'unknown.mjs'), 'unknown', { mode: 0o444 });
  chmodSync(snapshot, 0o555);
  assert.throws(() => verifyPublishedReferenceSnapshot(main, snapshot, commit), /untracked source/);
});
