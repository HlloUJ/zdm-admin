import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveRuntimeMigrations } from './backend-runtime.mjs';
const first = { name: 'V1__base.sql', content: 'SELECT 1;' };
const pending = { name: 'V2__paused.sql', content: 'SELECT 2;' };
const record = {
  type: 'zdm-paused-database-task',
  catalog: [pending].map((entry) => ({ ...entry, sha256: createHash('sha256').update(entry.content).digest('hex') })),
};
test('loads only already applied verified snapshots and keeps current migrations', () => {
  assert.deepEqual(resolveRuntimeMigrations([first], [record], [{ script: pending.name, success: '1' }]), [
    first,
    pending,
  ]);
  assert.deepEqual(resolveRuntimeMigrations([first], [record], []), [first]);
});
test('rejects missing, failed, tampered and conflicting migrations', () => {
  assert.throws(() => resolveRuntimeMigrations([first], [], [{ script: pending.name, success: '1' }]), /缺少可信/);
  assert.throws(() => resolveRuntimeMigrations([first], [], [{ script: first.name, success: '0' }]), /失败迁移/);
  assert.throws(
    () =>
      resolveRuntimeMigrations([first], [{ ...record, catalog: [{ ...record.catalog[0], content: 'changed' }] }], []),
    /校验失败/,
  );
  assert.throws(
    () =>
      resolveRuntimeMigrations(
        [{ ...pending, content: 'changed' }],
        [record],
        [{ script: pending.name, success: '1' }],
      ),
    /冲突/,
  );
});
