import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProcess } from './verification-process-identity.mjs';
test('exact process identity parser preserves permission errors as unknown', () => {
  assert.deepEqual(
    inspectProcess(42, () => '42 42 Fri Nov 13 17:00:00 2026'),
    { pid: 42, pgid: 42, startTime: 'Fri Nov 13 17:00:00 2026' },
  );
  assert.throws(() =>
    inspectProcess(42, () => {
      const e = Error('denied');
      e.status = 1;
      e.stderr = 'denied';
      throw e;
    }),
  );
  assert.equal(
    inspectProcess(42, () => {
      const e = Error('ended');
      e.status = 1;
      throw e;
    }),
    null,
  );
  assert.throws(() => inspectProcess(42, () => 'unrecognized'));
  assert.throws(() => inspectProcess(1, () => '1 1 unknown'));
});
