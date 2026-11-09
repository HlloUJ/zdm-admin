import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareTaskMaven, taskMavenVolume } from './task-maven.mjs';
test('runtime caches differ between exact tasks and never select the legacy global volume', () => {
  const a = taskMavenVolume('/a', 'task-a');
  assert.equal(taskMavenVolume('/a', 'task-a'), a);
  assert.notEqual(taskMavenVolume('/b', 'task-a'), a);
  assert.notEqual(taskMavenVolume('/a', 'task-b'), a);
  assert.notEqual(a, 'zdm-admin_zdm_maven_repo');
  const compose = readFileSync(new URL('../docker-compose.task.yml', import.meta.url), 'utf8');
  assert.ok(compose.includes('${ZDM_TASK_MAVEN_VOLUME:?set ZDM_TASK_MAVEN_VOLUME}'));
  const tools = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8').split('  backend-tools:')[1];
  assert.ok(tools.includes('./.task-runtime/maven-tools:/root/.m2'));
  assert.ok(!tools.includes('- zdm_maven_repo:/root/.m2'));
});
test('private cache creation retains old volumes and rejects unknown Docker failures or foreign identity', () => {
  const options = { root: '/a', project: 'task-a' },
    name = taskMavenVolume('/a', 'task-a'),
    calls = [];
  assert.equal(
    prepareTaskMaven(options, (args) => {
      calls.push(args);
      return args[1] === 'inspect'
        ? { status: 1, stderr: 'Error response from daemon: no such volume: ' + name }
        : { status: 0, stdout: name + '\n' };
    }),
    name,
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ['volume', 'create', '--label', 'com.zdm.task.maven=task-a', name]);
  for (const result of [
    { status: 1, stderr: 'permission denied' },
    { status: 1, stderr: 'Cannot connect to the Docker daemon' },
    { status: 0, stdout: JSON.stringify([{ Name: name, Labels: { 'com.zdm.task.maven': 'other' } }]) },
  ])
    assert.throws(() =>
      prepareTaskMaven(options, (args) => {
        assert.equal(args[1], 'inspect');
        return result;
      }),
    );
});
