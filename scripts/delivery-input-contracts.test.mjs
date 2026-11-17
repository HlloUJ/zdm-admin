import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkChangedDocumentContracts, checkDeliveryInputs } from './delivery-input-contracts.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'changed-document-contract-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs/target.md'), '# Existing');
  return root;
}
test('only changed document internal references are checked, with no external fetch or historic crawl', (t) => {
  const root = fixture(t);
  writeFileSync(
    path.join(root, 'docs/changed.md'),
    '[valid](target.md) [external](https://invalid.example/offline) [anchor](#title)',
  );
  writeFileSync(path.join(root, 'docs/history.md'), '[broken](missing.md)');
  const result = checkChangedDocumentContracts(root, ['docs/changed.md', 'docs/deleted.md']);
  assert.deepEqual(
    result.map((r) => r.status),
    ['passed', 'deleted'],
  );
  assert.deepEqual(result[0].references, ['target.md']);
  writeFileSync(path.join(root, 'docs/changed.md'), '[bad](missing.md)');
  assert.throws(() => checkChangedDocumentContracts(root, ['docs/changed.md']), /Missing internal/);
  writeFileSync(path.join(root, 'docs/changed.md'), '[escape](../../outside.md)');
  assert.throws(() => checkChangedDocumentContracts(root, ['docs/changed.md']), /escapes/);
});
test('diff failure and document conflict markers cannot produce a passed contract packet', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'docs/changed.md'), '<<<<<<< source\n');
  assert.throws(() => checkChangedDocumentContracts(root, ['docs/changed.md']), /conflict/);
  assert.throws(
    () =>
      checkDeliveryInputs(
        root,
        { files: [], candidate: 'a', standardDigest: 'b' },
        {
          git: () => {
            throw Error('actual diff error');
          },
        },
      ),
    /actual diff error/,
  );
});
test('real local CLI executes the diff guard and isolates its report from an inherited CI output directory', (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, '.gitignore'), '.task-verification/\n');
  writeFileSync(path.join(root, 'README.md'), '[valid](docs/target.md)');
  for (const args of [
    ['init'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ]) {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const forbidden = path.join(root, 'untouched-ci');
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./delivery-input-contracts.mjs', import.meta.url)),
      '--files-json',
      JSON.stringify(['README.md']),
    ],
    { cwd: root, encoding: 'utf8', env: { ...process.env, CI_EVIDENCE_DIR: forbidden } },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(path.join(root, '.task-verification/delivery-input-contracts.json'), 'utf8'));
  assert.equal(report.complete, true);
  assert.equal(report.documents[0].file, 'README.md');
  assert.throws(() => readFileSync(path.join(forbidden, 'delivery-input-contracts.json')), { code: 'ENOENT' });
});

test('documentation examples are not treated as live internal links', (t) => {
  const root = fixture(t);
  writeFileSync(
    path.join(root, 'docs/example.md'),
    '```md\n[example](not-a-live-file.md)\n```\nInline `[example](also-not-live.md)` and [actual](target.md).',
  );
  const result = checkChangedDocumentContracts(root, ['docs/example.md']);
  assert.deepEqual(result[0].references, ['target.md']);
});
