import assert from 'node:assert/strict';
import { runCompletionProcess } from './completion-process.mjs';

export const TEST_CLEANUP_LABELS = {
  task: 'com.zdm.admin.cleanup.task',
  owner: 'com.zdm.admin.cleanup.owner',
  purpose: 'com.zdm.admin.cleanup.purpose',
  database: 'com.zdm.admin.cleanup.database',
};
const idPattern = /^[a-f0-9]{12,64}$/;
const volumePattern = /^zdm-cleanup-test-[a-z0-9-]+$/;
const schemaPattern = /^zdm_cleanup_test_[a-z0-9_]+$/;

function command(args, deadline) {
  assert.ok(Date.now() < deadline, 'Cleanup time budget reached');
  const result = runCompletionProcess('docker', args, {
    encoding: 'utf8',
    timeout: Math.min(15000, deadline - Date.now()),
    maxBuffer: 16 * 1024 ** 2,
  });
  assert.ok(!result.error && result.status === 0, 'Local Docker check failed: ' + args[0]);
  return result.stdout.trim();
}

const words = (text) => text.split(/\s+/).filter(Boolean);

export function cleanupTestResources(task, { deadline, apply, docker = command, env = process.env }) {
  const labels = TEST_CLEANUP_LABELS;
  const d = (...args) => docker(args, deadline);
  const endpoint =
    env.DOCKER_HOST && !env.DOCKER_CONTEXT
      ? env.DOCKER_HOST
      : JSON.parse(d('context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'));
  assert.match(endpoint, /^unix:\/\//, 'Cleanup requires a local Docker endpoint');
  const filter = ['--filter', 'label=' + labels.task + '=' + task.id];
  const list = () => ({
    containers: words(d('ps', '-aq', '--no-trunc', ...filter)),
    volumes: words(d('volume', 'ls', '-q', ...filter)),
  });
  const inventory = list();
  if (!inventory.containers.length && !inventory.volumes.length) return [];
  const blocked = [];
  const owned = (current, purpose) =>
    current?.[labels.task] === task.id && current[labels.owner] === task.owner && current[labels.purpose] === purpose;
  for (const id of inventory.containers) {
    if (Date.now() >= deadline || blocked.length) break;
    try {
      assert.match(id, idPattern);
      const [container] = JSON.parse(d('container', 'inspect', id));
      assert.equal(container.Id, id);
      const current = container.Config.Labels;
      assert.ok(owned(current, 'mysql-fixture'), 'Unproven container ownership');
      assert.match(container.Config.Image, /^mysql:8\.0(?:\.\d+)?(?:@sha256:[a-f0-9]{64})?$/);
      assert.equal(container.HostConfig.Privileged, false);
      assert.equal(container.HostConfig.RestartPolicy.Name, 'no');
      assert.ok(!container.HostConfig.NetworkMode.startsWith('container:'), 'Container shares a network namespace');
      const volume = container.Mounts[0]?.Name;
      assert.equal(container.Mounts.length, 1, 'Fixture must have exactly one data mount');
      assert.equal(container.Mounts[0].Destination, '/var/lib/mysql');
      assert.ok(
        inventory.volumes.includes(volume) && volumePattern.test(volume),
        'Fixture data volume not established',
      );
      const [data] = JSON.parse(d('volume', 'inspect', volume));
      assert.ok(owned(data.Labels, 'mysql-fixture'), 'Unproven fixture volume ownership');
      assert.equal(data.Driver, 'local');
      assert.ok(!data.Options || !Object.keys(data.Options).length, 'Fixture volume points outside local storage');
      assert.deepEqual(words(d('ps', '-aq', '--no-trunc', '--filter', 'volume=' + volume)), [id]);
      const schema = current[labels.database];
      assert.match(schema, schemaPattern, 'Unknown fixture schema');
      if (container.State.Running) {
        const mysql = (query) =>
          d(
            'exec',
            id,
            'sh',
            '-ec',
            'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --batch --skip-column-names -uroot -e "$1"',
            'cleanup',
            query,
          );
        const available = mysql(
          "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() AND USER <> 'event_scheduler'",
        );
        assert.equal(available, '0', 'Database still has a connected client');
        const query =
          "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql','sys','information_schema','performance_schema')";
        const schemas = mysql(query);
        assert.ok(schemas === schema || schemas === '', 'More than one fixture schema or foreign schema');
        if (!apply) continue;
        mysql('DROP DATABASE IF EXISTS `' + schema + '`');
        assert.equal(mysql(query), '', 'Fixture schema remains');
        d('stop', '--time', '3', id);
      }
      if (apply) {
        d('rm', id);
        assert.ok(!words(d('ps', '-aq', '--no-trunc')).includes(id), 'Container remains');
      }
    } catch (error) {
      blocked.push({ resource: id, reason: error.message });
    }
  }
  for (const name of inventory.volumes) {
    if (Date.now() >= deadline || blocked.length) break;
    try {
      assert.match(name, volumePattern);
      const [volume] = JSON.parse(d('volume', 'inspect', name));
      assert.ok(owned(volume.Labels, 'mysql-fixture'), 'Unproven test volume ownership');
      assert.equal(volume.Driver, 'local');
      assert.ok(!volume.Options || !Object.keys(volume.Options).length, 'Volume points outside local fixture storage');
      assert.equal(d('ps', '-aq', '--filter', 'volume=' + name), '', 'Another container uses the test volume');
      if (apply) d('volume', 'rm', name);
    } catch (error) {
      blocked.push({ resource: name, reason: error.message });
    }
  }
  const remaining = list();
  if (remaining.containers.length || remaining.volumes.length)
    blocked.push({ reason: 'Task test runtime resources remain', ...remaining });
  return blocked;
}
