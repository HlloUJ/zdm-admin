import assert from 'node:assert/strict';

export function validateFrontendTestReport(report, { kind, runId } = {}) {
  assert.equal(report?.schemaVersion, 1, 'Missing frontend execution report');
  assert.equal(report.kind, kind, 'Unexpected frontend test domain');
  assert.ok(runId && report.runId === runId, 'Frontend execution report is stale');
  assert.equal(report.complete, true, 'Frontend report is incomplete');
  assert.equal(report.errors.length, 0, 'Frontend report contains unhandled errors');
  assert.ok(report.files.length > 0, 'Frontend file inventory is empty');
  assert.equal(new Set(report.files).size, report.files.length, 'Duplicate frontend files');
  assert.deepEqual([...report.completedFiles].sort(), [...report.files].sort(), 'Incomplete frontend file execution');
  assert.ok(report.tests.length > 0, 'Frontend tests did not execute');
  assert.equal(new Set(report.tests.map((test) => test.id)).size, report.tests.length, 'Duplicate frontend tests');
  assert.deepEqual(
    report.tests.map((test) => test.id).sort(),
    [...report.collectedTests].sort(),
    'Executed frontend tests differ from collected inventory',
  );
  for (const file of report.files)
    assert.ok(
      report.tests.some((test) => test.file === file),
      `Empty test file: ${file}`,
    );
  for (const suite of report.suites) {
    assert.equal(suite.status, 'passed', `Suite did not pass: ${suite.name}`);
    assert.ok(suite.testCount > 0, `Empty test suite: ${suite.name}`);
  }
  for (const test of report.tests) {
    assert.ok(report.files.includes(test.file), 'Test belongs to an unlisted file');
    assert.equal(test.status, 'passed', `Test skipped, todo, pending or failed: ${test.name}`);
    assert.equal(test.retryCount, 0, `Test retried: ${test.name}`);
    assert.equal(test.repeatCount, 0, `Test repeated: ${test.name}`);
    assert.equal(test.flaky, false, `Flaky test: ${test.name}`);
    assert.equal(test.expectedFailure, false, `Expected failure cannot pass: ${test.name}`);
  }
  return { tests: report.tests.length, files: report.files.length, suites: report.suites.length };
}
