import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectSchedulerRecovery } from './task-resource-recovery.mjs';
function fixture(t, state, lock = false) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'zdm921-recovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ version: 1, jobs: [], ...state }));
  if (lock) {
    mkdirSync(join(dir, 'scheduler.lock'));
    writeFileSync(
      join(dir, 'scheduler.lock', 'owner.json'),
      JSON.stringify({ pid: 99999999, token: 'do-not-disclose' }),
    );
  }
  return dir;
}
test('old lock is never removed based on dead-looking PID', (t) => {
  const dir = fixture(t, {}, true);
  const before = readFileSync(join(dir, 'scheduler.lock', 'owner.json'), 'utf8');
  const r = inspectSchedulerRecovery(dir);
  assert.equal(r.cleanOpenPossible, false);
  assert.equal(r.automaticUnlock, false);
  assert.equal(JSON.stringify(r).includes('do-not-disclose'), false);
  assert.equal(readFileSync(join(dir, 'scheduler.lock', 'owner.json'), 'utf8'), before);
});
test('active or uncertain stages block fresh admission even without lock', (t) => {
  const dir = fixture(t, {
    jobs: [
      { id: 'a', task: 'task', status: 'running' },
      { id: 'b', status: 'blocked', runtimeUncertain: true },
    ],
  });
  assert.equal(inspectSchedulerRecovery(dir).unresolved.length, 2);
  assert.equal(inspectSchedulerRecovery(dir).cleanOpenPossible, false);
});
test('ended stages preserve evidence; queued callers require explicit reattachment', (t) => {
  const dir = fixture(t, {
    jobs: [
      { id: 'a', status: 'done', evidence: ['kept'] },
      { id: 'b', task: 'task', status: 'queued' },
    ],
  });
  const before = readFileSync(join(dir, 'state.json'), 'utf8');
  const r = inspectSchedulerRecovery(dir);
  assert.equal(r.cleanOpenPossible, true);
  assert.equal(r.automaticReplay, false);
  assert.equal(r.orphanedQueued.length, 1);
  assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), before);
});
