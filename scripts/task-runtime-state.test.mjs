import { taskMavenVolume } from './task-maven.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertNoValidationBackendConsumers,
  createLatestChangeQueue,
  retainedValidationBackend,
  taskBackendAction,
  taskBackendContainerIdentity,
  taskBackendSourceIdentity,
} from './task-runtime-state.mjs';

import { backendFixture } from './test-support/task-backend-fixture.mjs';

test('runtime reuse requires source/configuration and an unchanged correctly scoped live container', () => {
  const { container, expected } = backendFixture();
  const containerIdentity = taskBackendContainerIdentity(container, expected);
  assert.ok(containerIdentity);
  const state = { containerIdentity, sourceIdentity: 'code-1', configurationIdentity: 'config-1' };
  const record = { version: 1, ...state };
  assert.equal(taskBackendAction(record, state), 'reuse');
  assert.equal(taskBackendAction(record, { ...state, sourceIdentity: 'code-2' }), 'restart');
  assert.equal(taskBackendAction(record, { ...state, sourceIdentity: 'migration-2', risk: true }), 'recreate');
  assert.equal(taskBackendAction(record, { ...state, configurationIdentity: 'config-2' }), 'recreate');
  assert.equal(taskBackendAction(null, state), 'recreate');
  for (const mutate of [
    (value) => (value.State.Running = false),
    (value) => (value.Config.Labels['com.docker.compose.project'] = 'other'),
    (value) => (value.Mounts[0].Source = '/other'),
    (value) => (value.Mounts[1].RW = true),
    (value) => (value.Mounts[2].Name = 'zdm-admin_zdm_maven_repo'),
    (value) => (value.Mounts[2].RW = false),
    (value) => (value.HostConfig.PortBindings['8080/tcp'][0].HostPort = '8085'),
    (value) => (value.HostConfig.PortBindings['8080/tcp'][0].HostIp = '0.0.0.0'),
  ]) {
    const different = structuredClone(container);
    mutate(different);
    assert.equal(taskBackendContainerIdentity(different, expected), null);
  }
  for (const field of ['Id', 'Image']) {
    const different = { ...container, [field]: 'changed' };
    assert.notEqual(taskBackendContainerIdentity(different, expected), containerIdentity);
  }
  container.State.StartedAt = 'start-2';
  assert.notEqual(taskBackendContainerIdentity(container, expected), containerIdentity);
});

test('macOS Docker Desktop host mount aliases resolve to the same task paths', (t) => {
  if (process.platform !== 'darwin') return;
  const { container, expected } = backendFixture();
  const root = mkdtempSync(path.join(tmpdir(), 'zdm-runtime-mount-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const migrations = path.join(root, 'migrations');
  mkdirSync(migrations);
  expected.root = root;
  expected.migrationDirectory = migrations;
  container.Mounts[0].Source = `/host_mnt${root}`;
  container.Mounts[1].Source = `/host_mnt${migrations}`;
  container.Mounts[2].Name = taskMavenVolume(root, expected.project);
  assert.ok(taskBackendContainerIdentity(container, expected));
});

test('backend input identity observes production/config/migrations without reading test code or build output', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'zdm-runtime-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  };
  put('backend/src/main/java/Example.java', 'first');
  put('migrations/V1__base.sql', 'create');
  const input = { root, migrationDirectory: path.join(root, 'migrations') };
  const first = taskBackendSourceIdentity(input);
  put('backend/src/test/java/ExampleTest.java', 'test');
  put('backend/target/classes/Example.class', 'compiled');
  assert.equal(taskBackendSourceIdentity(input), first);
  for (const file of [
    'backend/src/main/java/Example.java',
    'backend/pom.xml',
    '.mvn/jvm.config',
    'migrations/V1__base.sql',
  ]) {
    const before = taskBackendSourceIdentity(input);
    put(file, 'changed');
    assert.notEqual(taskBackendSourceIdentity(input), before, file);
  }
});

test('change queue merges bursts while running and does not lose the last late event', async () => {
  const timers = new Map();
  let next = 0;
  let release;
  const calls = [];
  const queue = createLatestChangeQueue({
    schedule: (callback) => {
      timers.set(++next, callback);
      return next;
    },
    cancel: (id) => timers.delete(id),
    run: async (files) => {
      calls.push(files);
      if (calls.length === 1) await new Promise((resolve) => (release = resolve));
    },
    onError: (error) => {
      throw error;
    },
  });
  const fire = () => {
    const current = [...timers.values()];
    timers.clear();
    for (const callback of current) callback();
  };
  queue.notify('A');
  queue.notify('B');
  fire();
  assert.deepEqual(calls, [['A', 'B']]);
  for (let index = 0; index < 20; index += 1) {
    queue.notify('A');
    queue.notify('migration');
    fire();
  }
  assert.equal(calls.length, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    ['A', 'B'],
    ['A', 'migration'],
  ]);
  queue.notify('last');
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), ['last']);
  queue.notify('cancelled');
  queue.close();
  fire();
  assert.equal(calls.length, 3);
});

test('a failed backend update stops pending work and invokes its error handler once', async () => {
  let fire;
  let failed = 0;
  let calls = 0;
  const queue = createLatestChangeQueue({
    schedule: (callback) => {
      fire = callback;
      return 1;
    },
    cancel() {},
    run: async () => {
      calls += 1;
      throw new Error('failed');
    },
    onError: async () => {
      failed += 1;
    },
  });
  queue.notify('first');
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  queue.notify('after failure');
  fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(failed, 1);
});

function retainedBackendFixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'validation-backend-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const task = {
    id: 'retained-fixture',
    owner: 'original-executor',
    frozen: { accepted: 'a'.repeat(40) },
    resources: { dataScope: 'isolated-task' },
    repository: { commonDir: path.join(root, 'common') },
    worktree: root,
  };
  const directory = path.join(root, '.task-runtime/candidate-runtime');
  const receiptFolder = path.join(task.repository.commonDir, 'task-delivery', task.id, 'validation-backend-recovery');
  mkdirSync(directory, { recursive: true });
  mkdirSync(receiptFolder, { recursive: true });
  writeFileSync(
    path.join(receiptFolder, 'receipt.json'),
    JSON.stringify({
      containerRetained: true,
      evidence: {
        task: task.id,
        worker: task.owner,
        accepted: task.frozen.accepted,
        backend: { id: 'f'.repeat(64), port: 8083 },
      },
    }),
    { mode: 0o600 },
  );
  const lease = { task: task.id, token: 'temporary-lease-token', pid: process.pid, resource: 'temporary-port-5180' };
  const delivery = { task: task.owner, pid: process.pid, token: 'delivery-lease-token' };
  const leases = { inspect: (key) => (key === lease.resource ? lease : delivery) };
  const head = 'b'.repeat(40);
  const journal = { version: 1, task: task.id, port: 5180, head, lease };
  const save = (state) =>
    writeFileSync(
      path.join(directory, '50955d02-f701-422a-8f3e-676ecb82c043.json'),
      JSON.stringify({ ...journal, state }),
      { mode: 0o600 },
    );
  const input = { task, leases, port: 5180, head, project: 'zdm-task-original' };
  return { input, save, lease, delivery };
}

test('start, health check and stop share a temporary project even without a ready frontend', (t) => {
  const { input, save } = retainedBackendFixture(t);
  save('prepared');
  const start = retainedValidationBackend({ ...input, starting: true });
  assert.notEqual(start.project, input.project);
  assert.equal(start.retainedPort, 8083);
  assert.equal(start.retainedId, 'f'.repeat(64));
  for (const stage of ['starting', 'ready']) {
    save(stage);
    assert.deepEqual(retainedValidationBackend(input), start);
  }
  assert.match(start.backendRecord, /candidate-runtime\/50955d02-f701-422a-8f3e-676ecb82c043\.backend\.json$/);
});

test('retained validation refuses foreign leases, wrong candidates and unjournaled partial starts', (t) => {
  const { input, save, delivery } = retainedBackendFixture(t);
  assert.throws(() => retainedValidationBackend({ ...input, starting: true }), /Exact candidate runtime journal/);
  save('starting');
  assert.throws(() => retainedValidationBackend({ ...input, head: 'c'.repeat(40) }));
  assert.throws(() => retainedValidationBackend({ ...input, port: 5176, starting: true }), /private validation port/);
  const pid = delivery.pid;
  delivery.pid = pid + 1;
  assert.throws(() => retainedValidationBackend(input), /different owners/);
  delivery.pid = pid;
  save('stopped');
  assert.throws(() => retainedValidationBackend(input), /outside its live journal/);
});

test('cleanup only proceeds after its private backend has no known or unknown preview consumer', () => {
  const frontend = (apiTarget) => ({ statusCode: 200, metadata: { apiTarget } });
  const inactive = { statusCode: 0, errorCode: 'ECONNREFUSED' };
  assert.doesNotThrow(() => assertNoValidationBackendConsumers([inactive, frontend('http://127.0.0.1:8082')], 8087));
  for (const target of ['http://127.0.0.1:8087', 'http://localhost:8087/health'])
    assert.throws(
      () => assertNoValidationBackendConsumers([inactive, frontend(target)], 8087),
      /possible preview consumer/,
    );
  assert.throws(() => assertNoValidationBackendConsumers([{ statusCode: 200 }], 8087), /Unrecognized preview/);
  assert.doesNotThrow(() => assertNoValidationBackendConsumers([{ statusCode: 200, port: 5190, leased: false }], 8087));
  assert.throws(
    () => assertNoValidationBackendConsumers([{ statusCode: 200, port: 5190, leased: true }], 8087),
    /Unrecognized preview/,
  );
  assert.throws(
    () => assertNoValidationBackendConsumers([{ statusCode: 0, errorCode: 'ETIMEDOUT' }], 8087),
    /Unrecognized preview/,
  );
});
