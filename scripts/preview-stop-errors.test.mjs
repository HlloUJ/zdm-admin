import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { stopChild, PreviewSupervisor } from './task-preview-service.mjs';

function controlledChild(kill) {
  const child = new EventEmitter();
  Object.assign(child, { pid: 12345, exitCode: null, signalCode: null, kill: (signal) => kill(child, signal) });
  return child;
}

test('owned stop preserves the actual synchronous error event instead of waiting after EPERM', async () => {
  const error = Object.assign(new Error('signal permission denied'), { code: 'EPERM' });
  const signals = [];
  const child = controlledChild((value, signal) => {
    signals.push(signal);
    value.emit('error', error);
    return false;
  });
  await assert.rejects(stopChild(child), (actual) => actual === error);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(child.exitCode, null);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
});

test('owned stop refuses an unproved false kill return without clearing ownership', async () => {
  const child = controlledChild(() => false);
  const supervisor = new PreviewSupervisor({}, { selectedWorktree: '/owned/acceptance' }, { status: () => ({}) });
  supervisor.child = child;
  await assert.rejects(supervisor.stopOwnedChild(), { code: 'CHILD_STOP_SIGNAL_REJECTED' });
  assert.equal(supervisor.child, child);
  assert.equal(supervisor.config.selectedWorktree, '/owned/acceptance');
  assert.equal(supervisor.intentionalStop, false);
});

test('owned stop propagates a thrown signal error and releases only its own listeners', async () => {
  const error = new Error('native kill failed');
  const child = controlledChild(() => {
    throw error;
  });
  const observer = () => {};
  child.on('error', observer);
  await assert.rejects(stopChild(child), (actual) => actual === error);
  assert.deepEqual(child.listeners('error'), [observer]);
  assert.equal(child.listenerCount('exit'), 0);
});

test('owned stop propagates a later error while waiting for the real exit', async () => {
  const error = Object.assign(new Error('later failure'), { code: 'EPERM' });
  const child = controlledChild((value) => {
    setImmediate(() => value.emit('error', error));
    return true;
  });
  await assert.rejects(stopChild(child), (actual) => actual === error);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
});

test('owned stop does not signal children whose exit is already recorded', async () => {
  await stopChild(null);
  const child = controlledChild(() => assert.fail('an exited child must not be signalled'));
  child.exitCode = 0;
  await stopChild(child);
});

test('owned stop observes the actual exit of a real child and leaves no stop timer behind', async (t) => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready');setInterval(()=>{},1000)"], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
  });
  await stopChild(child);
  assert.ok(child.exitCode !== null || child.signalCode);
  assert.equal(child.listenerCount('exit'), 0);
});
