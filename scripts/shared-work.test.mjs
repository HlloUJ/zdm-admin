import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSharedWork } from './shared-work.mjs';
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'shared-work-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, work: createSharedWork(directory) };
}
test('disjoint workers coexist but a shared operation waits for both releases', (t) => {
  const { work } = fixture(t);
  const a = work.claim({ owner: 'thread-a', module: 'a', resources: ['src/a.vue'] });
  const b = work.claim({ owner: 'thread-b', module: 'b', resources: ['src/b.vue'] });
  assert.throws(() => work.assertIdle(), /workers remain active/);
  assert.throws(
    () => work.claim({ owner: 'delivery', module: 'batch', resources: ['shared'] }),
    /another active worker/,
  );
  work.release(a);
  assert.throws(() => work.assertIdle(), /workers remain active/);
  work.release(b);
  work.assertIdle();
  const delivery = work.claim({ owner: 'delivery', module: 'batch', resources: ['shared'] });
  assert.throws(
    () => work.claim({ owner: 'thread-c', module: 'c', resources: ['src/c.vue'] }),
    /another active worker/,
  );
  work.release(delivery);
});
test('file and directory claims cannot overlap and invalid paths cannot hide conflicts', (t) => {
  const { work } = fixture(t);
  work.claim({ owner: 'a', module: 'a', resources: ['src/pages'] });
  for (const value of ['src/pages/a.vue', 'src', 'src/pages'])
    assert.throws(() => work.claim({ owner: 'b', module: 'b', resources: [value] }), /another active worker/);
  for (const value of ['/src', '../src', 'src/../other', './src', 'src//other'])
    assert.throws(() => work.claim({ owner: 'b', module: 'b', resources: [value] }), /canonical/);
});
test('only the exact owner token can release a persisted claim', (t) => {
  const { directory, work } = fixture(t);
  const a = work.claim({ owner: 'a', module: 'a', resources: ['src/a.vue'] });
  const before = readFileSync(path.join(directory, 'workers.json'), 'utf8');
  assert.throws(() => work.release({ ...a, token: 'wrong' }), /ownership/);
  assert.equal(readFileSync(path.join(directory, 'workers.json'), 'utf8'), before);
  const reopened = createSharedWork(directory);
  assert.throws(() => reopened.assertIdle(), /workers remain active/);
  reopened.release(a);
  reopened.assertIdle();
});
test('an existing metadata lock is never stolen', (t) => {
  const { directory, work } = fixture(t);
  mkdirSync(path.join(directory, 'write.lock'));
  assert.throws(() => work.claim({ owner: 'a', module: 'a', resources: ['src/a.vue'] }), /locked/);
});
