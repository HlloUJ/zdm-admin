import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseNodeTestSummary } from './run-script-tests.mjs';

const command = fileURLToPath(new URL('./run-script-tests.mjs', import.meta.url));
function fixture(t, source, mode = '--engineering', extraFiles = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-engineering-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, 'scripts/example.test.mjs'), source);
  for (const [name, content] of Object.entries(extraFiles)) writeFileSync(path.join(root, 'scripts', name), content);
  const report = path.join(root, `reports/${mode === '--engineering' ? 'engineering' : 'scripts'}-results.json`);
  const env = { ...process.env, CI_EVIDENCE_DIR: path.dirname(report), ENGINEERING_RUN_ID: 'fresh-run' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [command, mode, ...(mode === '--files' ? ['scripts/example.test.mjs'] : [])],
    {
      cwd: root,
      encoding: 'utf8',
      env,
    },
  );
  return { root, result, report };
}
test('the engineering runner emits complete real Node execution counts and file inventory', (t) => {
  const f = fixture(t, "import test from 'node:test'; test('works', () => {});");
  assert.equal(f.result.status, 0, f.result.stderr);
  const evidence = JSON.parse(readFileSync(f.report, 'utf8'));
  assert.deepEqual(evidence.files, ['scripts/example.test.mjs']);
  assert.equal(evidence.runId, 'fresh-run');
  assert.equal(evidence.summary.tests, 1);
  assert.equal(evidence.summary.pass, 1);
  assert.equal(evidence.summary.skipped, 0);
});
test('all and file-targeted script entries validate actual cases, not only a raw Node exit code', (t) => {
  for (const mode of ['--all', '--files', '--engineering']) {
    for (const [source, expected] of [
      ["test('works',()=>{});", 0],
      ["test.skip('skip',()=>{});", 1],
      ["test.todo('todo');", 1],
      ["test('works',()=>{}); describe('empty',()=>{});", 1],
      ['', 1],
    ]) {
      const f = fixture(t, `import {test,describe} from 'node:test';\n${source}`, mode);
      assert.equal(f.result.status, expected, f.result.stdout + f.result.stderr);
      assert.equal(existsSync(f.report), expected === 0);
    }
  }
});
test('an empty file cannot hide behind another passing file; explicit file selection excludes unselected files', (t) => {
  for (const mode of ['--all', '--engineering', '--files']) {
    const f = fixture(t, "import test from 'node:test'; test('works',()=>{});", mode, { 'empty.test.mjs': '' });
    assert.equal(f.result.status, mode === '--files' ? 0 : 1, f.result.stdout + f.result.stderr);
  }
});
test('successful Node exit with skipped or todo tests is rejected without a success artifact', (t) => {
  for (const declaration of ['test.skip', 'test.todo']) {
    const f = fixture(t, `import test from 'node:test'; ${declaration}('not executed', () => {});`);
    assert.equal(f.result.status, 1);
    assert.equal(existsSync(f.report), false);
  }
});
test('failed tests and incomplete, empty or forged summaries cannot pass', (t) => {
  const f = fixture(t, "import test from 'node:test'; test('fails', () => { throw Error('fixture'); });");
  assert.equal(f.result.status, 1);
  assert.equal(existsSync(f.report), false);
  for (const tap of [
    '',
    '# tests 1\n# pass 1',
    '1..0\n# tests 0\n# suites 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n',
  ])
    assert.throws(() => parseNodeTestSummary(tap));
});
