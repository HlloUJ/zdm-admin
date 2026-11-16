import assert from 'node:assert/strict';

export function validateFrontendTestReport(report, { kind, runId } = {}) {
  assert.equal(report?.schemaVersion, 1, 'Missing frontend execution report');
  assert.equal(report.kind, kind, 'Unexpected frontend test domain');
  assert.ok(runId && report.runId === runId, 'Frontend execution report is stale');
  assert.equal(report.complete, true, 'Frontend report is incomplete');
  assert.equal(report.errors.length, 0, 'Frontend report contains unhandled errors');
  if (kind === 'related' && report.files.length === 0) {
    const selection = report.selection;
    assert.equal(selection?.resolver, 'vitest-dependency-graph', 'Missing related dependency discovery');
    assert.equal(selection.complete, true, 'Related dependency discovery is incomplete');
    assert.ok(
      selection.sources?.length > 0 &&
        selection.sources.every((source) => typeof source === 'string' && source.length > 0),
      'Missing related source inventory',
    );
    assert.ok(selection.universe?.length > 0, 'An empty project cannot prove related tests inapplicable');
    assert.equal(new Set(selection.universe).size, selection.universe.length, 'Duplicate available test files');
    for (const list of [selection.selected, report.completedFiles, report.collectedTests, report.tests, report.suites])
      assert.deepEqual(list, [], 'Empty related selection contains unexpected execution');
    return {
      status: 'not-applicable',
      reason: 'No tests selected by completed Vitest dependency discovery',
      tests: 0,
      files: 0,
      suites: 0,
    };
  }
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
  return { status: 'passed', tests: report.tests.length, files: report.files.length, suites: report.suites.length };
}

export function testIdentities(report, executed = false) {
  assert.ok(Array.isArray(report.suites), 'Playwright report is missing suites');
  assert.equal(report.errors?.length ?? 0, 0, 'Playwright report contains global errors');
  const ids = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      assert.ok(spec.id && Array.isArray(spec.tests) && spec.tests.length, 'Invalid Playwright spec');
      for (const item of spec.tests) {
        assert.ok(item.projectName, 'Playwright project identity is missing');
        if (executed) {
          assert.ok(item.results?.length, `Test has no execution result: ${spec.id}`);
          assert.equal(item.expectedStatus ?? 'passed', 'passed', `Expected failure cannot pass: ${spec.id}`);
          assert.equal(item.results?.length, 1, `Every execution must pass exactly once: ${spec.id}`);
          assert.equal(item.results[0].retry ?? 0, 0, `Test retried: ${spec.id}`);
          assert.equal(item.status, 'expected', `Test was skipped, flaky or unexpected: ${spec.id}`);
          assert.ok(
            item.results.every((result) => result.status === 'passed'),
            `Every execution must pass without skipped, interrupted or failed attempts: ${spec.id}`,
          );
        }
        ids.push(`${spec.id}:${item.projectName}:${item.repeatEachIndex ?? 0}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  report.suites.forEach(visit);
  assert.ok(ids.length > 0, 'An empty test list cannot pass the coverage gate');
  assert.equal(new Set(ids).size, ids.length, 'Duplicate tests inside a Playwright report');
  return ids.sort();
}
