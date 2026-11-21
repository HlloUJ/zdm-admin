import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertDispatchMountsClear,
  compareDispatchHostRounds,
  verifyDynamicDispatchHost,
} from './task-dispatch-host-proof.mjs';
import { assertHostIdle } from '../task-cancellation-proof.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'dispatch-host-proof-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'task');
  const directory = path.join(workspace, 'child');
  const other = path.join(root, 'out-of-task');
  mkdirSync(directory, { recursive: true });
  mkdirSync(other);
  const task = { id: 'fixture-task', branch: 'codex/fixture-task', worktree: workspace };
  const socket = path.join(root, 'docker.sock');
  const endpoint = 'unix://' + socket;
  const references = [
    { pid: process.pid, descriptor: 'cwd', type: 'DIR', name: other },
    { pid: 10, descriptor: '5', type: 'unix', name: socket },
    { pid: 20, descriptor: '52', type: 'DIR', name: directory },
  ];
  const programs = [
    { pid: process.pid, ppid: 1, command: 'node' },
    { pid: 10, ppid: 1, command: 'untrusted text is never used as the executable identity' },
    { pid: 20, ppid: 10, command: 'same for this diagnostic process row' },
  ];
  const snapshots = [];
  const calls = [];
  const recorded = [];
  const mounts = { containers: [], volumes: [] };
  const executable = (role) => '/Applications/Docker.app/Contents/MacOS/com.docker.' + role;
  const service = (pid, ppid, name, fds) => ({
    pid,
    ppid,
    uid: 501,
    processStable: true,
    startSeconds: 123456,
    executable: executable(name),
    image: { signatureVerified: true, team: '9BNSXJN65R', executable: executable(name), hash: 'a'.repeat(64) },
    fds,
  });
  const proof = {
    endpoint: { ownerPid: 10, path: socket },
    sourceUid: 501,
    services: [
      service(10, 1, 'backend', []),
      service(20, 10, 'sailor', [
        { fd: 52, directory: true, openFlags: 1, guardFlags: 0, path: directory, inode: 345 },
      ]),
    ],
  };
  const assemble = () => ({
    processes: structuredClone(programs),
    files: structuredClone(references),
    containers: mounts.containers
      .filter((container) => container.running)
      .map(({ id, labels, mounts }) => ({ id, labels, mounts })),
    dockerEndpoint: endpoint,
  });
  const adapters = {
    observe() {
      calls.push('inventory');
      const snapshot = assemble();
      snapshots.push(snapshot);
      return snapshot;
    },
    readMounts(observedEndpoint) {
      calls.push('mounts');
      assert.equal(observedEndpoint, endpoint);
      return structuredClone(mounts);
    },
    inspectDirectories(identity, snapshot, matching) {
      calls.push('signature/kernel');
      assert.equal(identity.worktree, workspace);
      assert.equal(identity.dockerEndpoint, endpoint);
      assert.equal(snapshot, snapshots.at(-1));
      assert.deepEqual(matching, [references[2]]);
      return structuredClone(proof);
    },
    readResources() {
      return [{ file: '/fixture/lease', digest: 'current-resource' }];
    },
    record(kind, value) {
      recorded.push({ kind, value: structuredClone(value) });
      return '/fixture/observation/' + kind + '.json';
    },
  };
  return {
    root,
    task,
    directory,
    other,
    mounts,
    proof,
    references,
    programs,
    snapshots,
    calls,
    recorded,
    adapters,
    assemble,
  };
}

test('a trusted sailor may retain only descendant directory vnodes while the signed socket owner has none', (t) => {
  const f = fixture(t);
  const expected = f.assemble();
  const result = compareDispatchHostRounds(f.task, f.adapters);
  assert.deepEqual(f.calls, ['inventory', 'mounts', 'signature/kernel', 'inventory', 'mounts', 'signature/kernel']);
  assert.deepEqual(f.snapshots, [expected, expected], 'The original snapshots keep their open directories');
  assert.equal(f.recorded.at(-1).value.cleanupAuthorized, false);
  assert.equal(f.recorded.at(-1).value.directories.services[1].fds[0].inode, 345);
  assert.match(result.retainedDockerDirectories.digest, /^[a-f0-9]{64}$/);
  assert.throws(() => assertHostIdle(expected, f.task), /Task files\/cwd remain open/);
  assert.throws(
    () => verifyDynamicDispatchHost(f.task, { action: 'dispatch-cancel' }, f.adapters.observe),
    /Only an actual dispatch/,
  );
});

test('normal dispatch uses its strict observations and never invokes the Docker exception collector', (t) => {
  const f = fixture(t);
  f.references.pop();
  const result = compareDispatchHostRounds(f.task, f.adapters);
  assert.deepEqual(f.calls, ['inventory', 'inventory']);
  assert.equal(f.recorded.length, 0);
  assert.equal(result.retainedDockerDirectories, undefined);
});

for (const [name, change, error] of [
  ['foreign process', (f) => (f.programs[2].command += ' ' + f.directory), /Task process/],
  ['regular file', (f) => (f.references[2].type = 'REG'), /unproven reference/],
  ['cwd', (f) => (f.references[2].descriptor = 'cwd'), /unproven reference/],
  [
    'symlink or firmlink spelling',
    (f) => (f.references[2].name = '/System/Volumes/Data' + f.directory),
    /unproven reference/,
  ],
  ['bad image signature', (f) => (f.proof.services[1].image.signatureVerified = false), /Expected values/],
  ['wrong Docker parent', (f) => (f.proof.services[1].ppid = 11), /Docker endpoint child/],
  ['missing native FD', (f) => (f.proof.services[1].fds = []), /cover every task directory/],
  ['write-open directory', (f) => (f.proof.services[1].fds[0].openFlags = 3), /read-only directory/],
  [
    'filesystem inode changed',
    (f) => {
      const inspect = f.adapters.inspectDirectories;
      f.adapters.inspectDirectories = (...args) => {
        const proof = inspect(...args);
        if (f.snapshots.length === 2) proof.services[1].fds[0].inode++;
        return proof;
      };
    },
    /changed between rounds/,
  ],
  ['resource movement', (f) => (f.adapters.readResources = () => [f.calls.length]), /Resources|resources changed/],
]) {
  test('dispatch refuses ' + name, (t) => {
    const f = fixture(t);
    change(f);
    assert.throws(() => compareDispatchHostRounds(f.task, f.adapters), error);
    assert.ok(!f.recorded.some((row) => row.kind === 'dispatch-only-retained-directories'));
  });
}

test('mount inventory refuses equal, parent, child, physical aliases, and unproven Docker volumes', (t) => {
  const f = fixture(t);
  const id = 'a'.repeat(64);
  const container = { id, running: false, labels: {}, mounts: [] };
  f.mounts.containers.push(container);
  container.mounts = [{ Type: 'bind', Source: f.other, Destination: '/unrelated' }];
  assert.doesNotThrow(() => assertDispatchMountsClear(f.task, f.assemble(), f.mounts));
  const alias = path.join(f.root, 'alias');
  symlinkSync(f.directory, alias);
  for (const source of [f.root, f.task.worktree, f.directory, '/host_mnt' + f.directory, alias]) {
    container.mounts[0].Source = source;
    assert.throws(() => assertDispatchMountsClear(f.task, f.assemble(), f.mounts), /overlaps task worktree/);
  }
  const mountpoint = '/var/lib/docker/volumes/local_example/_data';
  container.mounts = [{ Type: 'volume', Name: 'local_example', Source: mountpoint, Destination: '/data' }];
  assert.throws(() => assertDispatchMountsClear(f.task, f.assemble(), f.mounts), /volume identity/);
  f.mounts.volumes.push({ name: 'local_example', driver: 'local', mountpoint, optionKeys: ['device', 'o', 'type'] });
  assert.throws(() => assertDispatchMountsClear(f.task, f.assemble(), f.mounts), /unobserved host bind/);
  f.mounts.volumes[0].optionKeys = [];
  assert.doesNotThrow(() => assertDispatchMountsClear(f.task, f.assemble(), f.mounts));
  container.configuredMounts = [{ Type: 'bind', Source: f.directory, Target: '/hidden' }];
  assert.throws(() => assertDispatchMountsClear(f.task, f.assemble(), f.mounts), /absent from the observed mounts/);
  container.configuredMounts = [];
  container.running = true;
  assert.throws(
    () => assertDispatchMountsClear(f.task, { ...f.assemble(), containers: [] }, f.mounts),
    /Running container inventory changed/,
  );
});
