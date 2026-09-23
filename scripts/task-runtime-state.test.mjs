import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createLatestChangeQueue,
  taskBackendAction,
  taskBackendContainerIdentity,
  taskBackendSourceIdentity,
} from './task-runtime-state.mjs';

export function backendFixture() {
  const expected = { root: '/task', project: 'zdm-task-test', backendPort: 8084, migrationDirectory: '/migrations' };
  const container = {
    Id: 'container-1',
    Image: 'sha256:image',
    State: { Running: true, StartedAt: 'start-1' },
    Config: {
      Labels: {
        'com.docker.compose.project': expected.project,
        'com.docker.compose.service': 'backend',
        'com.zdm.task.preview': 'true',
        'com.zdm.task.database': 'integration',
      },
    },
    HostConfig: { PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8084' }] } },
    Mounts: [
      { Type: 'bind', Source: '/task', Destination: '/workspace', RW: true },
      { Type: 'bind', Source: '/migrations', Destination: '/task-migrations', RW: false },
    ],
  };
  return { expected, container };
}

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
