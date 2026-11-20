import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, mkdirSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertHostIdle,
  assertNoActiveValidationMount,
  validationDockerDirectoryKeys,
} from '../task-cancellation-proof.mjs';
import { nativeDockerVnodeSource } from './preview-docker-vnode-source.mjs';
import {
  assertRecoveryContainer,
  assertRecoveryConsumers,
  validationRuntimeHash,
} from './validation-backend-recovery.mjs';
import { assertOriginalValidationFailure } from './validation-recovery-evidence.mjs';
import { referenceHash } from './preview-reference-history.mjs';
import {
  assertMaintenanceHistory,
  assertMaintenanceInspect,
  assertMaintenanceNeighbor,
  assertMaintenanceStartup,
} from './validation-maintenance-lineage.mjs';
import { assertStablePreparationRounds, preparationValidationIdle } from './validation-preparation-idle.mjs';

const parent = '/fixture/worktrees',
  root = parent + '/task';
const task = {
  id: 'synthetic-validation-task',
  owner: 'fixture-owner',
  worktree: root,
  branch: 'codex/fixture',
  recordedHead: 'a'.repeat(40),
  frozen: { accepted: 'b'.repeat(40), tree: 'c'.repeat(40), businessDigest: 'd'.repeat(64) },
};
const acceptedRecordDigest = 'e'.repeat(64);
const evidence = {
  backend: { id: 'c'.repeat(64), port: 8098, startedAt: '2025-03-01T11:00:00Z' },
  formerPort: 5196,
  foreign: { task: 'fixture-neighbor', port: 5197, backendPort: 8097 },
};
const originalTicket = {
  task: task.id,
  lane: 'delivery',
  owner: task.owner,
  order: 4,
  request: { sequence: 4 },
  phaseOrigin: { digest: 'fixture' },
};
const fixture = () => ({
  task: structuredClone(task),
  ticket: {
    ...structuredClone(originalTicket),
    status: 'blocked',
    dynamicDecisionId: 'fixture-final',
    admission: 'fixture-historical-scope',
  },
  state: {
    dynamicDecisions: [
      {
        id: 'fixture-final',
        status: 'consumed',
        admission: 'fixture-historical-scope',
        sourceProof: {
          head: task.recordedHead,
          accepted: referenceHash(
            JSON.stringify({
              accepted: task.frozen.accepted,
              tree: task.frozen.tree,
              businessDigest: task.frozen.businessDigest,
            }),
          ),
          acceptedRecord: acceptedRecordDigest,
        },
        input: { task: task.id, lane: 'delivery', phase: 'final', owner: task.owner, executor: task.owner },
        ticketBefore: structuredClone(originalTicket),
      },
    ],
  },
  stage: {
    name: 'prepare',
    key: task.recordedHead + ':readiness',
    status: 'failure',
    owner: { host: 'fixture.local', pid: 31 },
    processTracking: 1,
    processes: [{ token: 'fake' }],
  },
  attempt: {
    id: 'queue-attempt',
    task: task.id,
    owner: task.owner,
    accepted: task.frozen.accepted,
    initialHead: task.recordedHead,
    outcome: 'failure',
    mainMutationStarted: false,
    lease: { resource: 'main-delivery', task: 'queue-attempt', pid: 31 },
    failure: 'Owned validation runtime cleanup incomplete',
  },
  journal: {
    task: task.id,
    head: task.recordedHead,
    state: 'cleanup-blocked',
    port: evidence.formerPort,
    lease: { task: task.id, pid: 31, resource: 'temporary-port-' + evidence.formerPort },
    cleanupFailure: 'Unknown other frontend consumer',
  },
  archivedTicket: { order: 4 },
  acceptedRecordDigest,
  host: 'fixture.local',
});

test('exact archived transaction is eligible; real identities are supplied only as inputs', () => {
  assert.doesNotThrow(() => assertOriginalValidationFailure(fixture()));
});
for (const [name, change] of Object.entries({
  'foreign original worker': (x) => {
    x.state.dynamicDecisions[0].input.executor = 'unrelated';
  },
  'different ticket ownership': (x) => {
    x.ticket.owner = 'unrelated';
  },
  'changed frozen object': (x) => {
    x.task.frozen.accepted = 'd'.repeat(40);
  },
  'raw frozen commit in place of the dispatched digest': (x) => {
    x.state.dynamicDecisions[0].sourceProof.accepted = x.task.frozen.accepted;
  },
  'changed frozen tree': (x) => {
    x.task.frozen.tree = 'f'.repeat(40);
  },
  'changed accepted record': (x) => {
    x.acceptedRecordDigest = 'f'.repeat(64);
  },
  'foreign process': (x) => {
    x.journal.lease.pid = 32;
  },
  'unproved failure': (x) => {
    x.journal.cleanupFailure = 'app failed';
  },
  'main mutation started': (x) => {
    x.attempt.mainMutationStarted = true;
  },
  'ordinary admission still active': (x) => {
    x.state.scopedAdmissions = [{ task: task.id, phase: 'preparation' }];
  },
  'different retired lease': (x) => {
    x.journal.lease.resource = 'temporary-port-5193';
  },
})) {
  test('rejects origin: ' + name, () => {
    const value = fixture();
    change(value);
    assert.throws(() => assertOriginalValidationFailure(value));
  });
}

const result = (running) => ({
  Id: evidence.backend.id,
  Created: 'fixture-created',
  Image: 'fixture-image',
  State: { Running: running, StartedAt: evidence.backend.startedAt },
  Config: { Labels: { 'com.docker.compose.project': 'fixture-compose', 'com.docker.compose.service': 'backend' } },
  HostConfig: { PortBindings: {} },
  Mounts: [
    { Type: 'bind', Source: root, Destination: '/workspace', RW: true },
    { Type: 'volume', Name: 'fixture-store' },
  ],
});
test('a successful stop retains the exact container object and mounts', () => {
  const original = result(true),
    stopped = result(false);
  assertRecoveryContainer(original, evidence, { root, project: 'fixture-compose', running: true });
  assertRecoveryContainer(stopped, evidence, { root, project: 'fixture-compose', running: false });
  assert.equal(validationRuntimeHash(original), validationRuntimeHash(stopped));
  stopped.Mounts.pop();
  assert.notEqual(validationRuntimeHash(original), validationRuntimeHash(stopped));
  assert.throws(() =>
    assertRecoveryContainer(original, evidence, { root, project: 'fixture-compose', running: false }),
  );
  assert.throws(() =>
    assertRecoveryContainer({ ...result(false), Id: 'd'.repeat(64) }, evidence, {
      root,
      project: 'fixture-compose',
      running: false,
    }),
  );
});
test('an active worktree mount or enclosing mount blocks even with signed directory observations', () => {
  for (const source of [root, parent, root + '/child', '/host_mnt' + root]) {
    assert.throws(
      () => assertNoActiveValidationMount({ containers: [{ mounts: [{ Type: 'bind', Source: source }] }] }, root),
      /overlaps/,
    );
  }
  assert.doesNotThrow(() =>
    assertNoActiveValidationMount({ containers: [{ mounts: [{ Type: 'bind', Source: root + '-other' }] }] }, root),
  );
});
test('normal admission and cancellation still reject a claimed directory exemption or an unknown process', () => {
  const snapshot = {
    processes: [{ pid: 51, ppid: 1, command: 'unknown ' + task.id }],
    files: [{ pid: 52, descriptor: '8', type: 'DIR', name: root }],
    containers: [],
  };
  assert.throws(() => assertHostIdle(snapshot, task), /unresolved/);
  snapshot.processes[0].command = 'unrelated';
  assert.throws(() => assertHostIdle(snapshot, task), /remain open/);
  assert.equal(preparationValidationIdle(task, '/no/such/repo', 'final'), null);
  assert.equal(preparationValidationIdle(task, '/no/such/repo', 'development'), null);
});
test('reservation and consumption each require a stable directory identity', () => {
  const before = { backend: { id: 'fixture-retained' }, handles: { fd: 3, inode: 'fixture' } };
  assert.equal(
    assertStablePreparationRounds(before, structuredClone(before)),
    assertStablePreparationRounds(before, before),
  );
  assert.throws(() => assertStablePreparationRounds(before, { ...before, handles: null }), /changed/);
});

function liveObservation() {
  const lease = {
    task: evidence.foreign.task,
    pid: 63,
    token: 'fixture',
    resource: 'temporary-port-' + evidence.foreign.port,
  };
  const round = (observedAt) => ({
    observedAt,
    previewLeases: [{ ...lease, port: evidence.foreign.port }],
    backendConsumers: [],
    backendHealth: { statusCode: 200, status: 'UP' },
    frontendObservations: [5175, 5176, ...Array.from({ length: 23 }, (_, i) => 5177 + i)].map((port) => ({
      port,
      response: { statusCode: 0, errorCode: 'ECONNREFUSED' },
    })),
  });
  return { identity: { ...evidence.foreign, lease }, rounds: [round(90_000), round(95_000)] };
}
test('two fresh observations can retain the proven neighbor, but an unknown or new consuming frontend blocks', () => {
  const o = liveObservation();
  assert.doesNotThrow(() => assertRecoveryConsumers(o, evidence, root, 100_000));
  assert.throws(() => assertRecoveryConsumers(o, evidence, root, 151_000));
  const found = o.rounds[1].frontendObservations.find((p) => p.port === 5195);
  found.response.errorCode = 'ETIMEDOUT';
  assert.throws(() => assertRecoveryConsumers(o, evidence, root, 100_000), /Unknown/);
  found.response = {
    statusCode: 200,
    body: JSON.stringify({
      type: 'zdm-task-preview',
      workspaceRoot: '/fixture/another',
      branch: 'codex/another',
      mode: 'full',
      apiTarget: 'http://127.0.0.1:' + evidence.backend.port,
    }),
  };
  assert.throws(() => assertRecoveryConsumers(o, evidence, root, 100_000), /uses this backend/);
});

if (process.platform === 'darwin')
  test('the native macOS probe distinguishes an actual read-only directory FD and actual write FD', (t) => {
    const temp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'validation-dirs-')));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const file = path.join(temp, 'probe.c'),
      binary = path.join(temp, 'probe'),
      folder = path.join(temp, 'directory');
    mkdirSync(folder);
    writeFileSync(file, nativeDockerVnodeSource);
    execFileSync('/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', file, '-o', binary]);
    const dirfd = openSync(folder, 'r'),
      writefd = openSync(path.join(temp, 'write-test'), 'w');
    t.after(() => {
      closeSync(dirfd);
      closeSync(writefd);
    });
    const native = JSON.parse(
      execFileSync(binary, [String(process.pid), String(dirfd), String(writefd)], { encoding: 'utf8' }),
    );
    assert.equal(native.processStable, true);
    const [dir, writer] = native.fds;
    assert.equal(dir.directory, true);
    assert.equal(writer.directory, false);
    assert.notEqual(writer.openFlags & 2, 0);
    const s = { pid: native.pid, image: { signatureVerified: true }, fds: [dir] };
    const proof = { cleanupAuthorized: false, services: [s] };
    assert.deepEqual(
      [...validationDockerDirectoryKeys(proof, temp)],
      [JSON.stringify([native.pid, String(dirfd), folder, 'DIR'])],
    );
    assert.throws(
      () => validationDockerDirectoryKeys({ ...proof, services: [{ ...s, fds: [dir, writer] }] }, temp),
      /Unproved/,
    );
    assert.throws(() =>
      validationDockerDirectoryKeys({ ...proof, services: [{ ...s, image: { signatureVerified: false } }] }, temp),
    );
    assert.throws(() => validationDockerDirectoryKeys({ cleanupAuthorized: true, services: [s] }, temp));
  });

test('a reassigned port must have the current foreign task, worktree, branch and runtime nonce', () => {
  const other = {
    id: 'another-task',
    worktree: '/fixture/another',
    branch: 'codex/another',
    resources: { dataScope: 'isolated-task' },
  };
  const o = liveObservation();
  const recovery = { ...evidence, task: task.id };
  const port = recovery.formerPort;
  const lease = { port, task: other.id, token: 'replacement', pid: 42, resource: 'temporary-port-' + port };
  const metadata = {
    type: 'zdm-task-preview',
    workspaceRoot: other.worktree,
    branch: other.branch,
    mode: 'full',
    apiTarget: 'http://127.0.0.1:8096',
    runtimeId: lease.token,
  };
  const readTask = (id) => (id === other.id ? other : null);
  for (const round of o.rounds) {
    round.previewLeases.push(lease);
    round.frontendObservations.find((p) => p.port === port).response = {
      statusCode: 200,
      body: JSON.stringify(metadata),
    };
  }
  assert.doesNotThrow(() => assertRecoveryConsumers(o, recovery, root, 100_000, readTask));
  const last = o.rounds[1].frontendObservations.find((p) => p.port === port);
  for (const changed of [
    { runtimeId: 'stale' },
    { branch: 'codex/foreign' },
    { workspaceRoot: root },
    { apiTarget: 'http://127.0.0.1:' + recovery.backend.port },
  ]) {
    last.response.body = JSON.stringify({ ...metadata, ...changed });
    assert.throws(() => assertRecoveryConsumers(o, recovery, root, 100_000, readTask));
  }
  last.response = { statusCode: 0, errorCode: 'ECONNREFUSED' };
  assert.throws(() => assertRecoveryConsumers(o, recovery, root, 100_000, readTask), /Unknown/);
});

function dockerMaintenanceFixture(comparison = 'empty-dns-fields-null-to-empty-array') {
  const hash = (value) => referenceHash(JSON.stringify(value));
  const id = 'c'.repeat(64),
    image = 'fixture-image',
    config = { Labels: { fixture: 'task' } };
  const host = { Memory: 512, Dns: null, DnsOptions: null, DnsSearch: null };
  const mounts = [{ Type: 'bind', Source: root, Destination: '/workspace', RW: true }];
  const stamp = (second) => '2025-03-01T11:00:' + String(second).padStart(2, '0') + 'Z';
  const old = stamp(0),
    boot = stamp(10);
  const before = {
    id,
    name: 'fixture-backend',
    ports: [8098],
    startedAt: old,
    imageDigest: image,
    configSha256: hash(config),
    hostConfigSha256: hash(host),
    orderedMountsSha256: hash(mounts),
    withoutStartedAtSha256: hash({ id, image, config, host, mounts }),
  };
  const identity = hash({ id, startedAt: old, image, config, host, mounts });
  const original = {
    id,
    port: 8098,
    task: task.id,
    startedAt: old,
    rawExactFormulaSha256: identity,
    withoutStartedAtSha256: before.withoutStartedAtSha256,
    recordedIdentityMatches: true,
    sourceMatched: true,
  };
  const binding = {
    id,
    port: 8098,
    task: task.id,
    identity,
    withoutStartedAtSha256: before.withoutStartedAtSha256,
    recordedIdentityMatches: true,
    sourceMatches: true,
    profileStatus: 'ready',
    matchedFull: true,
    startedAtUnchanged: true,
    recordedBackendStateSha256: 'd'.repeat(64),
    backup: { present: true, stable: true },
  };
  const live = { id, name: before.name, running: true, startedAt: boot, comparison };
  const start = { step: 'start-existing', id, name: before.name, at: stamp(11), comparison };
  const maintenanceTask = 'fixture-maintenance-owner';
  return {
    artifacts: {
      baselineHash: 'b'.repeat(64),
      baseline: { version: 1, task: maintenanceTask, observedAt: stamp(1), active: [before], taskBackends: [original] },
      restart: {
        task: maintenanceTask,
        phase: 'restart',
        run: [
          { step: 'preflight', at: stamp(2), SQL: [0, 0], dockerSessionId: 'old-session' },
          { step: 'desktop-restart-requested', at: stamp(3) },
          { step: 'desktop-restart-cli', at: stamp(7), status: 0 },
          ...(comparison === 'exact' ? [start] : []),
          {
            step: 'recovery-readback',
            at: stamp(14),
            rows: [{ id, running: true, startedAt: boot, noChangeExceptStart: comparison === 'exact' }],
          },
          ...(comparison === 'exact' ? [] : [{ step: 'failure', at: stamp(14) }]),
        ],
      },
      recovery: {
        task: maintenanceTask,
        phase: 'recover',
        run: [
          ...(comparison === 'exact' ? [] : [start]),
          {
            step: 'recovery-readback',
            at: stamp(20),
            rows: [live],
            health: [{ port: 8098, ready: true }],
            diagnosticPreserved: true,
          },
        ],
      },
      bindings: { version: 1, baselineSha256: 'b'.repeat(64), rows: [binding] },
    },
    origin: { task: task.id, id, port: 8098, startedAt: old },
    container: {
      Id: id,
      Name: '/' + before.name,
      State: { StartedAt: boot, Running: true },
      Image: image,
      Config: config,
      HostConfig: comparison === 'exact' ? host : { ...host, Dns: [], DnsOptions: [], DnsSearch: [] },
      Mounts: mounts,
    },
    bootLog: stamp(12) + ' INFO Started FixtureApplication in 1.8 seconds',
  };
}

for (const comparison of ['exact', 'empty-dns-fields-null-to-empty-array']) {
  test('proves the same container startup from complete maintenance evidence: ' + comparison, () => {
    const { artifacts, origin, container, bootLog } = dockerMaintenanceFixture(comparison);
    const proof = assertMaintenanceHistory(artifacts, origin);
    assertMaintenanceInspect(container, proof);
    assertMaintenanceStartup(bootLog, proof);
    assert.throws(() => assertMaintenanceStartup('', proof));
    assert.throws(() => assertMaintenanceStartup([bootLog, bootLog].join('\n'), proof));
    for (const change of [
      (c) => {
        c.State.StartedAt = '2025-03-02T11:00:10Z';
      },
      (c) => {
        c.State.Running = false;
      },
      (c) => {
        c.Id = 'e'.repeat(64);
      },
      (c) => {
        c.HostConfig.Memory++;
      },
      (c) => {
        c.HostConfig.Dns = ['192.0.2.1'];
      },
      (c) => {
        c.Mounts[0].Source = '/fixture/different';
      },
      (c) => {
        c.Config.Labels.fixture = 'changed';
      },
    ]) {
      const candidate = structuredClone(container);
      change(candidate);
      assert.throws(() => assertMaintenanceInspect(candidate, proof));
    }
  });
}

test('maintenance history rejects a spliced baseline, duplicate start and discarded first failure', () => {
  for (const change of [
    (a) => {
      a.bindings.baselineSha256 = 'a'.repeat(64);
    },
    (a) => {
      a.recovery.run.push(a.recovery.run[0]);
    },
    (a) => {
      a.restart.run.pop();
    },
    (a) => {
      a.recovery.run[1].health[0].ready = false;
    },
    (a) => {
      a.baseline.taskBackends[0].task = 'other';
    },
    (a) => {
      a.baseline.taskBackends[0].rawExactFormulaSha256 = 'a'.repeat(64);
    },
  ]) {
    const { artifacts, origin } = dockerMaintenanceFixture();
    change(artifacts);
    assert.throws(() => assertMaintenanceHistory(artifacts, origin));
  }
});

test('a proven foreign restart changes only its two backend boot identifiers', () => {
  const { artifacts, origin } = dockerMaintenanceFixture();
  const proof = assertMaintenanceHistory(artifacts, origin);
  const previous = {
    registryDigest: 'source-record',
    data: { backupExists: true },
    lease: { token: 'unchanged' },
    backend: {
      id: proof.before.id,
      inventory: { mounts: ['/fixture/neighbor'] },
      containerIdentity: proof.binding.identity,
      recordDigest: proof.binding.recordedBackendStateSha256,
    },
  };
  const backend = { containerIdentity: 'new-container-identity', recordDigest: 'new-backend-record' };
  const current = structuredClone(previous);
  Object.assign(current.backend, backend);
  assertMaintenanceNeighbor(previous, current, { proof, backend });
  for (const change of [
    (o) => {
      o.data.backupExists = false;
    },
    (o) => {
      o.lease.token = 'changed';
    },
    (o) => {
      o.backend.inventory.mounts = [];
    },
    (o) => {
      o.backend.id = 'new-container';
    },
    (o) => {
      o.backend.recordDigest = previous.backend.recordDigest;
    },
  ]) {
    const candidate = structuredClone(current);
    change(candidate);
    assert.throws(() => assertMaintenanceNeighbor(previous, candidate, { proof, backend }));
  }
});

test('the archived frontend port can stay closed only with the exact independent lease proof', () => {
  const o = liveObservation();
  const recovery = { ...evidence, task: task.id };
  const port = recovery.formerPort;
  const lease = { task: 'other-task', token: 'proved', pid: 42, resource: 'temporary-port-' + port };
  for (const round of o.rounds) {
    round.previewLeases.push({ port, ...lease });
    round.reassignedClosed = { port, lease };
  }
  assert.doesNotThrow(() => assertRecoveryConsumers(o, recovery, root, 100_000));
  const round = o.rounds[1];
  round.reassignedClosed = { port, lease: { ...lease, token: 'different' } };
  assert.throws(() => assertRecoveryConsumers(o, recovery, root, 100_000));
  delete round.reassignedClosed;
  assert.throws(() => assertRecoveryConsumers(o, recovery, root, 100_000), /Unknown/);
});
