import assert from 'node:assert/strict';
import path from 'node:path';

export function nodeTestReport(raw, files, root, kind = 'source-guards') {
  assert.equal(raw.schemaVersion, 1, 'Unknown Node event report');
  const summaries = raw.events.filter((event) => event.type === 'test:summary' && !event.data.file);
  assert.equal(summaries.length, 1, 'Node report has no complete final summary');
  const summary = summaries[0].data;
  const completed = raw.events.filter((event) => ['test:pass', 'test:fail'].includes(event.type));
  const suites = completed.filter((event) => event.data.details.type === 'suite');
  const actual = completed.filter((event) => event.data.details.type === 'test');
  const caseKey = (data) => JSON.stringify([data.file, data.line, data.column, data.name, data.nesting]);
  const collected = raw.events.filter(
    (event) =>
      event.type === 'test:enqueue' &&
      event.data.type === 'test' &&
      path.resolve(root, event.data.name) !== event.data.file,
  );
  assert.deepEqual(
    collected.map((event) => caseKey(event.data)).sort(),
    actual.map((event) => caseKey(event.data)).sort(),
    'Node collected cases differ from completed cases',
  );
  const tests = actual.map((event, index) => {
    const data = event.data;
    assert.notEqual(path.resolve(root, data.name), data.file, 'A file wrapper cannot replace actual test cases');
    return {
      id: `${data.file}:${data.line}:${data.column}:${index}`,
      file: path.relative(root, data.file),
      name: data.name,
      status: event.type === 'test:fail' ? 'failed' : data.skip ? 'skipped' : data.todo ? 'todo' : 'passed',
      retryCount: 0,
      repeatCount: 0,
      flaky: false,
      expectedFailure: false,
    };
  });
  assert.equal(summary.counts.tests, tests.length, 'Node counts disagree with actual test events');
  assert.equal(summary.counts.suites, suites.length, 'Node suite counts disagree with actual events');
  assert.equal(summary.counts.passed, tests.length, 'Every selected Node test must pass');
  for (const count of ['failed', 'cancelled', 'skipped', 'todo']) assert.equal(summary.counts[count], 0);
  return {
    schemaVersion: 1,
    kind,
    runId: raw.runId,
    complete: summary.success === true,
    files,
    completedFiles: [...new Set(tests.map((test) => test.file))],
    collectedTests: tests.map((test) => test.id),
    tests,
    suites: suites.map((event) => {
      let testCount = 0;
      for (let index = completed.indexOf(event) - 1; index >= 0; index--) {
        if (completed[index].data.nesting <= event.data.nesting) break;
        if (completed[index].data.details.type === 'test') testCount++;
      }
      return { name: event.data.name, status: event.type === 'test:pass' ? 'passed' : 'failed', testCount };
    }),
    errors: [],
  };
}
