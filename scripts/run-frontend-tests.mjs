import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_GUARD_TESTS } from './script-test-plan.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';

const script = (name) => fileURLToPath(new URL(name, import.meta.url));

export function sourceGuardReport(raw, files, root) {
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
    assert.notEqual(
      path.resolve(root, data.name),
      data.file,
      'A file wrapper cannot replace actual source guard cases',
    );
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
  assert.equal(summary.counts.passed, tests.length, 'Every source guard must pass');
  for (const count of ['failed', 'cancelled', 'skipped', 'todo']) assert.equal(summary.counts[count], 0);
  return {
    schemaVersion: 1,
    kind: 'source-guards',
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

export function runFrontendTests(kind, args = [], { root = process.cwd(), env = process.env } = {}) {
  assert.ok(['unit', 'source-guards'].includes(kind), 'Unknown frontend test domain');
  const runId = env.FRONTEND_TEST_RUN_ID ?? randomUUID();
  const directory = path.resolve(root, env.CI_EVIDENCE_DIR ?? `.task-verification/frontend-tests/${runId}`);
  mkdirSync(directory, { recursive: true });
  const rawFile = path.join(directory, `${kind}-${runId}-raw.json`);
  const childEnv = { ...env, FRONTEND_TEST_RUN_ID: runId, FRONTEND_TEST_REPORT: rawFile };
  let command;
  if (kind === 'unit') {
    command = [
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      ...args,
      '--reporter=default',
      `--reporter=${script('./vitest-evidence-reporter.mjs')}`,
    ];
  } else {
    assert.equal(args.length, 0, 'Source guards must run the complete registered inventory');
    command = [
      '--test',
      '--test-reporter=spec',
      `--test-reporter=${script('./node-source-evidence-reporter.mjs')}`,
      '--test-reporter-destination=stdout',
      '--test-reporter-destination=stdout',
      ...SOURCE_GUARD_TESTS,
    ];
  }
  const result = spawnSync(process.execPath, command, { cwd: root, env: childEnv, stdio: 'inherit' });
  if (result.status !== 0) return result.status ?? 1;
  const raw = JSON.parse(readFileSync(rawFile, 'utf8'));
  const report = kind === 'unit' ? raw : sourceGuardReport(raw, SOURCE_GUARD_TESTS, root);
  const summary = validateFrontendTestReport(report, { kind, runId });
  writeFileSync(path.join(directory, `${kind}-results.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`${kind}: ${summary.tests} tests passed without skipped or retried cases`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runFrontendTests(process.argv[2], process.argv.slice(3));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
