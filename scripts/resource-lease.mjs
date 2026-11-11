import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';
const fixed = new Set(['preview-5175', 'integration-5173', 'main-delivery', 'main-sync']);
function safe(file) {
  if (existsSync(file)) assert.ok(!lstatSync(file).isSymbolicLink(), 'Linked resource state is unsafe');
}
function resource(value) {
  assert.ok(
    fixed.has(value) ||
      /^task-preview-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
      /^task-delivery-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
      /^backend-port-80(?:8[1-9]|9[0-9])$/.test(value) ||
      /^temporary-port-51(?:7[7-9]|8[0-9]|9[0-9])$/.test(value) ||
      /^data-[a-f0-9]{64}$/.test(value),
    'Unknown shared resource scope',
  );
  return value;
}
export function createResourceLeases(
  commonDir,
  {
    mkdir = mkdirSync,
    alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
      }
    },
  } = {},
) {
  const parent = path.join(commonDir, 'task-registry'),
    directory = path.join(parent, 'resource-leases');
  function inspect(name) {
    resource(name);
    safe(parent);
    safe(directory);
    const folder = path.join(directory, name);
    safe(folder);
    if (!existsSync(folder)) return null;
    const owner = path.join(folder, 'owner.json');
    safe(owner);
    const lease = JSON.parse(readFileSync(owner, 'utf8'));
    assert.equal(lease.resource, name);
    assert.ok(lease.task && lease.token);
    return lease;
  }
  function acquire(name, task) {
    resource(name);
    assert.ok(typeof task === 'string' && task.trim(), 'Exact task owner required');
    safe(parent);
    safe(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const folder = path.join(directory, name);
    safe(folder);
    try {
      mkdir(folder, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST')
        throw Error('Resource is owned or interrupted; do not take over: ' + name, { cause: error });
      throw Error(`Cannot acquire resource ${name}: ${error.code ?? error.message}`, { cause: error });
    }
    const lease = { resource: name, task, token: randomUUID(), pid: process.pid };
    writeFileSync(path.join(folder, 'owner.json'), JSON.stringify(lease) + '\n', { flag: 'wx', mode: 0o600 });
    return lease;
  }
  function release(lease) {
    const current = inspect(lease.resource);
    assert.ok(
      current && current.task === lease.task && current.token === lease.token,
      'Resource owner changed; retain lease',
    );
    const folder = path.join(directory, lease.resource);
    unlinkSync(path.join(folder, 'owner.json'));
    rmdirSync(folder);
  }
  async function run(name, task, action) {
    const lease = acquire(name, task);
    try {
      return await action(lease);
    } finally {
      release(lease);
    }
  }
  function recoverEndedTask(name, task, verifyEndedProcesses) {
    assert.ok(name.startsWith('task-delivery-'), 'Only the exact private completion lease can be recovered');
    const previous = inspect(name);
    if (!previous || alive(previous.pid)) return false;
    assert.equal(previous.task, task, 'Interrupted completion belongs to another task owner');
    assert.equal(verifyEndedProcesses(previous), true, 'Recorded foreground processes must be proved ended');
    release(previous);
    return true;
  }
  return { inspect, acquire, release, run, recoverEndedTask };
}
