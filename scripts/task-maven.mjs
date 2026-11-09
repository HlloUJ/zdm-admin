import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function taskMavenVolume(root, project) {
  assert.match(project, /^[a-zA-Z0-9_-]+$/);
  return (
    'zdm-task-maven-' +
    createHash('sha256')
      .update(path.resolve(root) + ':' + project)
      .digest('hex')
      .slice(0, 24)
  );
}
export function prepareTaskMaven(
  { root, project },
  execute = (args) => spawnSync('docker', args, { cwd: root, encoding: 'utf8' }),
) {
  const volume = taskMavenVolume(root, project),
    inspected = execute(['volume', 'inspect', volume]);
  if (inspected.status === 0) {
    const values = JSON.parse(inspected.stdout);
    assert.equal(values.length, 1, 'Exact Maven cache volume required');
    assert.equal(values[0].Name, volume);
    assert.equal(values[0].Labels?.['com.zdm.task.maven'], project, 'Maven cache is not owned by this task');
  } else {
    // Docker must distinguish an absent volume from permission/transport errors.
    assert.ok(
      !inspected.error && inspected.status === 1 && /no such volume/i.test(inspected.stderr),
      'Cannot prove Maven cache absence; preserve it',
    );
    const created = execute(['volume', 'create', '--label', 'com.zdm.task.maven=' + project, volume]);
    assert.equal(created.status, 0, created.error?.message ?? created.stderr);
    assert.equal(created.stdout.trim(), volume, 'Created Maven cache identity differs');
  }
  return volume;
}
