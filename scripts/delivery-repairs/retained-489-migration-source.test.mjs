import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { flywayChecksum, recoverMigrationInputs, verifiedMigrationCatalog } from './retained-489-migration-source.mjs';

const entries = [
  { name: 'V1__one.sql', bytes: Buffer.from('12345\r\n6789\r') },
  { name: 'V2__two.sql', bytes: Buffer.from('a\nb\rc') },
];
const rows = ['1\tV1__one.sql\t-873187034\tSQL\t1', '2\tV2__two.sql\t891568578\tSQL\t1'];
const verifiedCatalog = () => verifiedMigrationCatalog(entries, rows.join('\n'), 2);

function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'retained-migration-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const migrationDirectory = path.join(root, 'migrations');
  const journalDirectory = path.join(root, 'journal');
  mkdirSync(migrationDirectory);
  const registration = path.join(root, 'backend-state.json');
  const stat = lstatSync(migrationDirectory, { bigint: true });
  const original = {
    version: 1,
    containerIdentity: 'a'.repeat(64),
    configurationIdentity: 'b'.repeat(64),
    sourceIdentity: 'c'.repeat(64),
  };
  const originalBytes = JSON.stringify(original, null, 2) + '\n';
  writeFileSync(registration, originalBytes);
  const sourceIdentity = () =>
    createHash('sha256').update(readdirSync(migrationDirectory).sort().join('\0')).digest('hex');
  const binding = {
    migrationDirectory,
    mount: [String(stat.dev), String(stat.ino)],
    containerIdentity: original.containerIdentity,
    container: 'd'.repeat(64),
  };
  return {
    args: {
      registration,
      journalDirectory,
      binding,
      catalog: verifiedCatalog(),
      release: { main: 'isolated-fixture-only' },
      signal: new AbortController().signal,
      readSourceIdentity: sourceIdentity,
      verifyLiveMount: async () => {},
    },
    original,
    originalBytes,
    registration,
    migrationDirectory,
    journalDirectory,
  };
}

test('matches the Flyway signed CRC32 across first-line BOM and different line endings', () => {
  assert.equal(flywayChecksum(Buffer.from('\ufeff123\n456\r789\r\n')), -873187034);
  assert.equal(flywayChecksum(Buffer.from('a\r\nb\rc\n')), 891568578);
  assert.throws(() => flywayChecksum(Buffer.from([0xc3, 0x28])), TypeError);
});

test('requires a one-to-one match against all successful versioned SQL history', () => {
  assert.equal(verifiedCatalog().size, 2);
  for (const bad of [
    rows[0],
    [rows[0], rows[0]].join('\n'),
    rows.join('\n').replace('V2__two.sql', 'V2__different.sql'),
    rows.join('\n').replace('2\tV2', '3\tV2'),
    rows.join('\n').replace('891568578', '0'),
    rows.join('\n').replace('SQL\t1', 'SQL\t0'),
    rows.join('\n').replace('SQL\t1', 'BASELINE\t1'),
  ])
    assert.throws(() => verifiedMigrationCatalog(entries, bad, 2));
  assert.throws(() => verifiedMigrationCatalog(entries, rows.join('\n'), 3), /Git migration count/);
  assert.throws(
    () => verifiedMigrationCatalog([entries[0], { ...entries[1], name: 'V01__other.sql' }], rows.join('\n'), 2),
    /Duplicate migration version/,
  );
});

test('a failed post-write probe preserves the old registration and exact intent, then resumes', async (t) => {
  const f = fixture(t);
  const probe = async () => {
    assert.deepEqual(
      readdirSync(f.migrationDirectory).sort(),
      entries.map((entry) => entry.name),
    );
    for (const entry of entries)
      assert.deepEqual(readFileSync(path.join(f.migrationDirectory, entry.name)), entry.bytes);
    throw new Error('fixture container probe failed');
  };
  await assert.rejects(recoverMigrationInputs({ ...f.args, verifyLiveMount: probe }), /fixture container probe failed/);
  assert.equal(readFileSync(f.registration, 'utf8'), f.originalBytes);
  assert.deepEqual(readdirSync(f.journalDirectory), ['intent.json']);
  const intent = readFileSync(path.join(f.journalDirectory, 'intent.json'));
  assert.equal(Buffer.from(JSON.parse(intent).originalRegistration, 'base64').toString('utf8'), f.originalBytes);

  const recovered = await recoverMigrationInputs(f.args);
  assert.deepEqual(JSON.parse(readFileSync(f.registration)), {
    ...f.original,
    sourceIdentity: f.args.readSourceIdentity(),
  });
  assert.deepEqual(readFileSync(path.join(f.journalDirectory, 'intent.json')), intent);
  assert.equal(recovered.migrations, 2);
  const inode = lstatSync(f.registration).ino;
  assert.deepEqual(await recoverMigrationInputs(f.args), recovered);
  assert.equal(lstatSync(f.registration).ino, inode);
});

test('first recovery refuses existing, unknown or linked inputs without rewriting them', async (t) => {
  const f = fixture(t);
  const known = path.join(f.migrationDirectory, entries[0].name);
  writeFileSync(known, entries[0].bytes);
  await assert.rejects(recoverMigrationInputs(f.args), /original empty mount/);
  assert.deepEqual(readFileSync(known), entries[0].bytes);
  rmSync(known);
  symlinkSync(f.registration, known);
  await assert.rejects(recoverMigrationInputs(f.args), /Linked reference evidence/);
  rmSync(known);
  writeFileSync(path.join(f.migrationDirectory, 'foreign.sql'), 'unknown');
  await assert.rejects(recoverMigrationInputs(f.args), /Unexpected file/);
  assert.equal(readFileSync(f.registration, 'utf8'), f.originalBytes);
  assert.deepEqual(readdirSync(f.journalDirectory), []);
});

test('resumes an exact fragment, but refuses drift in the mount, migration, registration or binding', async (t) => {
  const f = fixture(t);
  const options = { ...f.args, verifyLiveMount: async () => assert.fail('injected failed container check') };
  await assert.rejects(recoverMigrationInputs(options), /injected failed container check/);
  const first = path.join(f.migrationDirectory, entries[0].name);
  const inode = lstatSync(first).ino;
  const second = path.join(f.migrationDirectory, entries[1].name);
  writeFileSync(second, 'inexact fragment');
  await assert.rejects(recoverMigrationInputs(f.args), /Retained migration bytes differ/);
  rmSync(second);
  await assert.rejects(
    recoverMigrationInputs({ ...f.args, binding: { ...f.args.binding, mount: ['1', '2'] } }),
    /recovery binding changed/,
  );
  writeFileSync(f.registration, JSON.stringify({ ...f.original, configurationIdentity: 'e'.repeat(64) }));
  await assert.rejects(recoverMigrationInputs(f.args), /changed outside recovery/);
  writeFileSync(f.registration, f.originalBytes);
  await recoverMigrationInputs(f.args);
  assert.equal(lstatSync(first).ino, inode);
  assert.deepEqual(readFileSync(second), entries[1].bytes);
});

test('the persisted registration intent survives loss of the final receipt', async (t) => {
  const f = fixture(t);
  const initial = await recoverMigrationInputs(f.args);
  const before = readFileSync(f.registration);
  const inode = lstatSync(f.registration).ino;
  rmSync(initial.receipt);
  assert.deepEqual(await recoverMigrationInputs(f.args), initial);
  assert.deepEqual(readFileSync(f.registration), before);
  assert.equal(lstatSync(f.registration).ino, inode);
});
