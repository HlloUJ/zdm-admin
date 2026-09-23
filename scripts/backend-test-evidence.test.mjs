import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { backendReportState, validateBackendReports } from './backend-test-evidence.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-backend-report-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'backend/src/test/java/example'), { recursive: true });
  mkdirSync(path.join(root, 'backend/target/surefire-reports'), { recursive: true });
  const report = (name, attrs = '', body = '<testcase name="works"/>') => {
    writeFileSync(
      path.join(root, `backend/src/test/java/example/${name}.java`),
      'class Test { @Test void works() {} }',
    );
    const file = path.join(root, `backend/target/surefire-reports/TEST-example.${name}.xml`);
    writeFileSync(file, `<testsuite tests="1" failures="0" errors="0" skipped="0" ${attrs}>${body}</testsuite>`);
    return file;
  };
  return { root, report };
}

test('fresh complete backend reports prove full and selected coverage', (t) => {
  const { root, report } = fixture(t);
  report('OneTest');
  report('TwoTest');
  assert.equal(validateBackendReports(root, { startedAt: new Date().toISOString() }).tests, 2);
  assert.equal(validateBackendReports(root, { selector: 'example.One*' }).tests, 1);
  assert.throws(() => validateBackendReports(root, { selector: 'UnknownTest' }), /No expected/);
});

test('missing, stale, unchanged, skipped, failed and flaky reports cannot pass', (t) => {
  const { root, report } = fixture(t);
  const file = report('OneTest');
  const previousReports = backendReportState(root);
  assert.throws(() => validateBackendReports(root, { previousReports }), /not updated/);
  utimesSync(file, new Date(0), new Date(0));
  assert.throws(() => validateBackendReports(root, { startedAt: new Date().toISOString() }), /Stale/);
  for (const body of [
    '<testcase><skipped/></testcase>',
    '<testcase><failure/></testcase>',
    '<testcase><flakyFailure/></testcase>',
  ]) {
    report('OneTest', '', body);
    assert.throws(() => validateBackendReports(root), /Non-passing/);
  }
  writeFileSync(file, '<testsuite tests="1" failures="0" errors="0" skipped="1"><testcase/></testsuite>');
  assert.throws(() => validateBackendReports(root), /skipped/);
  writeFileSync(file, '<testsuite tests="0" failures="0" errors="0" skipped="0"></testsuite>');
  assert.throws(() => validateBackendReports(root), /Incomplete/);
  rmSync(file);
  assert.throws(() => validateBackendReports(root), /Missing/);
});
