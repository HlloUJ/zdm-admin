import assert from 'node:assert/strict';

export function validatePlaywrightTestReport(report, runId) {
  assert.equal(report?.schemaVersion, 1, 'Missing Playwright execution report');
  assert.ok(runId && report.runId === runId, 'Playwright execution report is stale');
  assert.equal(report.complete, true, 'Playwright execution report is incomplete');
  assert.equal(report.status, 'passed', 'Playwright run did not pass');
  assert.deepEqual(report.errors, [], 'Playwright report contains global errors');
  assert.ok(report.selected.length > 0, 'Playwright selected no tests');
  assert.equal(new Set(report.selected).size, report.selected.length, 'Duplicate selected Playwright tests');
  assert.deepEqual(
    report.tests.map((test) => test.id).sort(),
    [...report.selected].sort(),
    'Incomplete or duplicate Playwright execution',
  );
  for (const suite of report.suites) assert.ok(suite.tests > 0, `Empty selected suite: ${suite.name}`);
  for (const test of report.tests) {
    assert.equal(test.expectedStatus, 'passed', `Skipped or expected failure test: ${test.name}`);
    assert.equal(test.outcome, 'expected', `Skipped, flaky or unexpected test: ${test.name}`);
    assert.equal(test.results.length, 1, `Test missing execution or retried: ${test.name}`);
    assert.equal(test.results[0].status, 'passed', `Test did not pass: ${test.name}`);
    assert.equal(test.results[0].retry, 0, `Test retried: ${test.name}`);
    assert.deepEqual(test.results[0].errors, [], `Test contains errors: ${test.name}`);
  }
  return { status: 'passed', tests: report.tests.length };
}
