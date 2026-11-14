import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVerificationProcessLifecycle, sealEndedVerificationLock } from './verification-process-lifecycle.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'verifier-lifecycle-'))),
    lock = path.join(root, '.task-verification', 'test.lock');
  mkdirSync(lock, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, lock };
}
test('owner proof and original supervisor intent are persisted before a launch', (t) => {
  const f = fixture(t);
  let saved = false;
  const life = createVerificationProcessLifecycle({
    ...f,
    inspect: () => ({ pid: 12, startTime: 'owner' }),
    scope: (state, event, save, run) => {
      event.processes.push({ token: 'token' });
      save();
      saved = true;
      return run();
    },
    launch: () => {
      const p = JSON.parse(readFileSync(path.join(f.lock, 'verification-owner.json')));
      assert.equal(p.attemptId, 'attempt');
      assert.equal(p.event.processes.length, 1);
      return 'child';
    },
    assertGone: () => {},
  });
  assert.equal(life.start({ attemptId: 'attempt', fingerprint: 'fp' }, 'node', [], {}), 'child');
  assert.equal(saved, true);
  assert.throws(() => life.start({ attemptId: 'two', fingerprint: 'fp' }, 'node', [], {}));
});
test('alive owner, surviving group and empty legacy proof never unlock', (t) => {
  const f = fixture(t);
  assert.throws(() => sealEndedVerificationLock({ ...f, inspect: () => null }));
  const life = createVerificationProcessLifecycle({
    ...f,
    inspect: () => ({ pid: 12, startTime: 'owner' }),
    scope: (s, e, save, run) => run(),
    launch: () => null,
  });
  life.start({ attemptId: 'attempt', fingerprint: 'fp' }, 'node', [], {});
  assert.throws(() => sealEndedVerificationLock({ ...f, inspect: () => ({ startTime: 'owner' }) }), /alive/);
  assert.throws(
    () =>
      sealEndedVerificationLock({
        ...f,
        inspect: () => null,
        assertGone: () => {
          throw Error('live group');
        },
      }),
    /live group/,
  );
  assert.ok(existsSync(f.lock));
});
test('proven ended lock is archived without claiming retry or altering attempts', (t) => {
  const f = fixture(t);
  const life = createVerificationProcessLifecycle({
    ...f,
    inspect: () => ({ pid: 12, startTime: 'owner' }),
    scope: (s, e, save, run) => run(),
    launch: () => null,
  });
  life.start({ attemptId: 'attempt', fingerprint: 'fp' }, 'node', [], {});
  const r = sealEndedVerificationLock({ ...f, inspect: () => null, assertGone: () => {} });
  assert.equal(r.retryAuthorized, false);
  assert.ok(existsSync(path.join(r.archive, 'verification-owner.json')));
  assert.equal(existsSync(f.lock), false);
});
