import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_GUARD_TESTS } from './script-test-plan.mjs';
import { nodeTestReport } from './node-test-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';

const script = (name) => fileURLToPath(new URL(name, import.meta.url));

export { nodeTestReport as sourceGuardReport } from './node-test-evidence.mjs';

export function runFrontendTests(kind, args = [], { root = process.cwd(), env = process.env } = {}) {
  assert.ok(['unit', 'related', 'source-guards'].includes(kind), 'Unknown frontend test domain');
  const runId = env.FRONTEND_TEST_RUN_ID ?? randomUUID();
  const directory = path.resolve(root, env.CI_EVIDENCE_DIR ?? `.task-verification/frontend-tests/${runId}`);
  mkdirSync(directory, { recursive: true });
  const rawFile = path.join(directory, `${kind}-${runId}-raw.json`);
  const childEnv = { ...env, FRONTEND_TEST_RUN_ID: runId, FRONTEND_TEST_REPORT: rawFile, FRONTEND_TEST_KIND: kind };
  let command;
  if (kind !== 'source-guards') {
    command = [
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      ...(kind === 'related' ? ['related', '--run', '--passWithNoTests'] : ['run']),
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
  const report = kind === 'source-guards' ? nodeTestReport(raw, SOURCE_GUARD_TESTS, root) : raw;
  const summary = validateFrontendTestReport(report, { kind, runId });
  writeFileSync(path.join(directory, `${kind}-results.json`), JSON.stringify(report, null, 2) + '\n');
  if (env.FRONTEND_TEST_RESULT_PATH)
    writeFileSync(env.FRONTEND_TEST_RESULT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(
    summary.status === 'not-applicable'
      ? `${kind}: not-applicable; Vitest dependency discovery selected no tests for ${report.selection.sources.length} source files (${report.selection.universe.length} available test files)`
      : `${kind}: ${summary.tests} tests passed without skipped or retried cases`,
  );
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
