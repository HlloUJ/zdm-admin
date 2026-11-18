import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVerificationProcessLifecycle, sealEndedVerificationLock } from './verification-process-lifecycle.mjs';
const record = {
  attemptId: '11111111-1111-4111-8111-111111111111',
  fingerprint: 'fp',
  startedAt: '2026-11-14T00:00:00Z',
};
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'verifier-lifecycle-'))),
    lock = path.join(root, '.task-verification', 'test.lock');
  mkdirSync(lock, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.task-verification', 'attempts', 'a'.repeat(64));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${record.attemptId}.started.json`), JSON.stringify(record));
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
      assert.equal(p.attemptId, record.attemptId);
      assert.equal(p.event.processes.length, 1);
      return 'child';
    },
    assertGone: () => {},
  });
  assert.equal(life.start(record, 'node', [], {}), 'child');
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
  life.start(record, 'node', [], {});
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
  life.start(record, 'node', [], {});
  const r = sealEndedVerificationLock({ ...f, inspect: () => null, assertGone: () => {} });
  assert.equal(r.retryAuthorized, false);
  assert.ok(existsSync(path.join(r.archive, 'verification-owner.json')));
  assert.equal(existsSync(f.lock), false);
});

test('changed immutable attempt blocks lock sealing', (t) => {
  const f = fixture(t);
  const life = createVerificationProcessLifecycle({
    ...f,
    inspect: () => ({ pid: 12, startTime: 'owner' }),
    scope: (s, e, save, run) => run(),
    launch: () => null,
  });
  life.start(record, 'node', [], {});
  const file = path.join(f.root, '.task-verification', 'attempts', 'a'.repeat(64), `${record.attemptId}.started.json`);
  writeFileSync(file, JSON.stringify({ ...record, fingerprint: 'changed' }));
  assert.throws(() => sealEndedVerificationLock({ ...f, inspect: () => null, assertGone: () => {} }));
  assert.ok(existsSync(f.lock));
});

test('real supervisor reports actual command PID once, not supervisor spawn', async (t) => {
  const f = fixture(t),
    notices = [];
  const life = createVerificationProcessLifecycle(f);
  let output = '';
  const child = life.start(record, process.execPath, ['-e', 'console.log(process.pid); setTimeout(() => {}, 100)'], {
    cwd: f.root,
    stdio: ['ignore', 'pipe', 'pipe'],
    onCommandSpawn: (event) => notices.push(event),
  });
  child.stdout.on('data', (chunk) => (output += chunk));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].pid, Number(output.trim()));
  assert.notEqual(notices[0].pid, child.pid);
  life.assertGone();
});

test('real parent IPC disconnect cannot kill supervisor or abandon the command', { timeout: 5000 }, async (t) => {
  const f = fixture(t),
    notices = [];
  const life = createVerificationProcessLifecycle(f);
  let output = '';
  const child = life.start(record, process.execPath, ['-e', 'setTimeout(() => console.log("finished"), 100)'], {
    cwd: f.root,
    stdio: ['ignore', 'pipe', 'pipe'],
    onCommandSpawn: (event) => notices.push(event),
  });
  // Disconnect as soon as the supervisor exists, before its JS can launch the command.
  child.once('spawn', () => child.disconnect());
  child.stdout.on('data', (chunk) => (output += chunk));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (!child.stdout.readableEnded) await new Promise((resolve) => child.stdout.once('end', resolve));
  assert.equal(code, 0);
  assert.equal(output.trim(), 'finished');
  assert.equal(notices.length, 0);
  life.assertGone();
});
