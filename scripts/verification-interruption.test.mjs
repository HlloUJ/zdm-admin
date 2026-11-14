import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnoseVerificationInterruption, sealInterruptionDiagnostic } from './verification-interruption.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'interruption-fixture-'))),
    key = 'a'.repeat(64),
    attemptId = '12345678-1234-1234-1234-123456789abc';
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, '.task-verification'),
    lock = path.join(dir, key + '.lock');
  mkdirSync(lock, { recursive: true });
  mkdirSync(path.join(dir, 'attempts', key), { recursive: true });
  const record = { attemptId, fingerprint: 'fingerprint', startedAt: '2026-11-14T00:00:00Z', status: 'running' };
  const file = path.join(dir, key + '.json');
  writeFileSync(file, JSON.stringify(record));
  writeFileSync(path.join(dir, 'attempts', key, attemptId + '.started.json'), JSON.stringify(record));
  return { root, key, attemptId, dir, lock, file, record };
}
test('legacy empty lock is diagnosed but neither released nor made retryable', (t) => {
  const f = fixture(t),
    before = readFileSync(f.file, 'utf8');
  const { report } = sealInterruptionDiagnostic(f);
  assert.equal(report.classification, 'interrupted-unsettled');
  assert.equal(report.canReleaseLock, false);
  assert.equal(report.canRetry, false);
  assert.equal(readFileSync(f.file, 'utf8'), before);
  assert.ok(existsSync(f.lock));
  assert.throws(() => sealInterruptionDiagnostic(f), /EEXIST/);
});
test('bound process identity distinguishes alive, absent and reused PID without sending signals', (t) => {
  const f = fixture(t);
  writeFileSync(
    path.join(f.lock, 'owner.json'),
    JSON.stringify({
      host: 'fixture',
      attemptId: f.attemptId,
      fingerprint: f.record.fingerprint,
      worktree: f.root,
      processes: [{ pid: 10, startTime: 'original' }],
    }),
  );
  for (const [current, status] of [
    [null, 'absent'],
    [{ startTime: 'original' }, 'alive'],
    [{ startTime: 'new' }, 'pid-reused'],
  ]) {
    const r = diagnoseVerificationInterruption({ ...f, host: 'fixture', inspect: () => current });
    assert.equal(r.observations[0].status, status);
    assert.equal(r.canReleaseLock, false);
  }
});
test('foreign owner is never probed and damaged history is rejected', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.lock, 'owner.json'), JSON.stringify({ host: 'foreign' }));
  const r = diagnoseVerificationInterruption({
    ...f,
    host: 'here',
    inspect: () => {
      throw Error('should not probe');
    },
  });
  assert.equal(r.observations.length, 0);
  writeFileSync(f.file, JSON.stringify({ ...f.record, fingerprint: 'changed' }));
  assert.throws(() => diagnoseVerificationInterruption(f), /mismatch/);
});
test('completed record is not reclassified into interrupted success', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, 'attempts', f.key, f.attemptId + '.json'), '{}');
  assert.equal(diagnoseVerificationInterruption(f).classification, 'completion-present');
});
