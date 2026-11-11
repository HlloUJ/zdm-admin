import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createResourceLeases } from './resource-lease.mjs';
function fixture(t, dependencies) {
  const dir = mkdtempSync(path.join(tmpdir(), 'task-resource-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return createResourceLeases(dir, dependencies);
}
test('preview operations exclude each other without blocking independent main delivery', (t) => {
  const resources = fixture(t),
    a = resources.acquire('preview-5175', 'a'),
    delivery = resources.acquire('main-delivery', 'b');
  assert.throws(() => resources.acquire('preview-5175', 'b'), /owned or interrupted/);
  assert.throws(() => resources.release({ ...a, token: 'wrong' }), /owner changed/);
  assert.equal(resources.inspect('preview-5175').task, 'a');
  resources.release(a);
  resources.release(delivery);
});
test('private completion recovery requires exact owner and ended foreground proof, never a timed shared-resource takeover', (t) => {
  const resources = fixture(t, { alive: () => false });
  const original = resources.acquire('task-delivery-a', 'chat-a');
  assert.throws(() => resources.recoverEndedTask('task-delivery-a', 'chat-b', () => true), /another task owner/);
  assert.throws(() => resources.recoverEndedTask('task-delivery-a', 'chat-a', () => false), /proved ended/);
  assert.equal(resources.inspect('task-delivery-a').token, original.token);
  assert.throws(() => resources.recoverEndedTask('main-delivery', 'chat-a', () => true), /private completion/);
  assert.equal(
    resources.recoverEndedTask('task-delivery-a', 'chat-a', () => true),
    true,
  );
  assert.equal(resources.inspect('task-delivery-a'), null);
});
test('async operations retain their lease throughout await and release only their own scope', async (t) => {
  const resources = fixture(t);
  let release;
  const pending = resources.run(
    'preview-5175',
    'a',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  assert.throws(() => resources.acquire('preview-5175', 'b'), /owned or interrupted/);
  release('done');
  assert.equal(await pending, 'done');
  assert.equal(resources.inspect('preview-5175'), null);
});
test('failed operation releases its own lease and unknown scopes are rejected', async (t) => {
  const resources = fixture(t);
  await assert.rejects(
    resources.run('preview-5175', 'a', () => {
      throw Error('injected');
    }),
    /injected/,
  );
  assert.equal(resources.inspect('preview-5175'), null);
  for (const name of ['../other', 'backend-port-8080', 'temporary-port-5173', 'global-development'])
    assert.throws(() => resources.acquire(name, 'a'), /Unknown/);
});
test('permission and filesystem failures retain their actual cause instead of reporting an occupied resource', (t) => {
  for (const code of ['EPERM', 'EACCES', 'ENOSPC']) {
    const failure = Object.assign(new Error('injected filesystem failure'), { code });
    const resources = fixture(t, {
      mkdir: () => {
        throw failure;
      },
    });
    assert.throws(
      () => resources.acquire('main-sync', 'a'),
      (error) => {
        assert.match(error.message, new RegExp('Cannot acquire resource main-sync: ' + code));
        assert.equal(error.cause, failure);
        assert.doesNotMatch(error.message, /owned or interrupted/);
        return true;
      },
    );
    assert.equal(resources.inspect('main-sync'), null);
  }
});
test('independent preview operations serialize only their own task and preserve foreign leases', async (t) => {
  const resources = fixture(t),
    a = resources.acquire('task-preview-a', 'a');
  const b = resources.acquire('task-preview-b', 'b');
  assert.throws(() => resources.acquire('task-preview-a', 'a'), /owned or interrupted/);
  assert.equal(resources.inspect('task-preview-b').token, b.token);
  assert.throws(() => resources.recoverEndedTask('task-preview-a', 'a', () => true), /private completion/);
  resources.release(a);
  resources.release(b);
});
