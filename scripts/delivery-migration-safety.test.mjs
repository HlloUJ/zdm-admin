import assert from 'node:assert/strict';
import test from 'node:test';
import { assertForwardMigrationCatalog } from './delivery-migration-safety.mjs';
const entry = (version, content = 'sql') => ({ name: 'V' + version + '__fixture.sql', content });
const row = (version) => ({ version, script: entry(version).name, success: '1' });
test('new ordered migrations preserve applied SQL and prove forward compatibility without changing data', () => {
  assert.deepEqual(assertForwardMigrationCatalog([entry('167'), entry('168')], [entry('167')], [row('167')]), {
    applied: 1,
    pending: [entry('168').name],
    compatible: true,
  });
  assert.equal(assertForwardMigrationCatalog([entry('20261108120000')], [], []).compatible, true);
});
test('a private task runtime success cannot hide an out-of-order change against the actual integration schema', () => {
  assert.throws(
    () => assertForwardMigrationCatalog([entry('168'), entry('172')], [entry('172')], [row('172')]),
    /below an already applied/,
  );
});
test('applied deletion/content replacement, failed history and equivalent version aliases fail before merge', () => {
  assert.throws(() => assertForwardMigrationCatalog([], [entry('168')], [row('168')]), /Applied migration missing/);
  assert.throws(
    () => assertForwardMigrationCatalog([entry('168', 'changed')], [entry('168')], [row('168')]),
    /Applied SQL changed/,
  );
  assert.throws(
    () => assertForwardMigrationCatalog([entry('168')], [entry('168')], [{ ...row('168'), success: '0' }]),
    /Failed migration history/,
  );
  assert.throws(
    () => assertForwardMigrationCatalog([entry('168'), entry('0168.0')], [], []),
    /Duplicate Flyway version/,
  );
  assert.throws(
    () => assertForwardMigrationCatalog([{ name: 'R__unreviewed.sql', content: 'sql' }], [], []),
    /Unreviewed repeatable/,
  );
});
