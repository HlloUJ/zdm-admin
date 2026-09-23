import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptTestFiles } from './script-test-plan.mjs';

export function validateNodeTestSummary(summary) {
  assert.ok(summary && Number.isSafeInteger(summary.tests) && summary.tests > 0, 'Node tests did not execute');
  for (const name of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'])
    assert.ok(Number.isSafeInteger(summary[name]) && summary[name] >= 0, `Invalid Node ${name} count`);
  assert.equal(summary.pass, summary.tests, 'Every Node test must pass');
  for (const name of ['fail', 'cancelled', 'skipped', 'todo'])
    assert.equal(summary[name], 0, `Node ${name} tests cannot pass the engineering gate`);
  return summary;
}

export function parseNodeTestSummary(tap) {
  const match = tap.match(
    /(?:^|\n)1\.\.\d+\n# tests (\d+)\n# suites (\d+)\n# pass (\d+)\n# fail (\d+)\n# cancelled (\d+)\n# skipped (\d+)\n# todo (\d+)\n# duration_ms [\d.]+\s*$/,
  );
  assert.ok(match, 'Node TAP report has no complete final summary');
  return validateNodeTestSummary(
    Object.fromEntries(
      ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((name, index) => [
        name,
        Number(match[index + 1]),
      ]),
    ),
  );
}

export function runEngineeringTests(root, env = process.env) {
  const files = scriptTestFiles(root, 'engineering');
  assert.ok(files.length, 'Engineering test inventory is empty');
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'zdm-engineering-results-'));
  const tap = path.join(temporary, 'results.tap');
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-reporter=spec',
        '--test-reporter=tap',
        '--test-reporter-destination=stdout',
        `--test-reporter-destination=${tap}`,
        ...files,
      ],
      { cwd: root, stdio: 'inherit', env },
    );
    if (result.status !== 0) return result.status ?? 1;
    const summary = parseNodeTestSummary(readFileSync(tap, 'utf8'));
    if (env.CI_EVIDENCE_DIR) {
      mkdirSync(env.CI_EVIDENCE_DIR, { recursive: true });
      writeFileSync(
        path.join(env.CI_EVIDENCE_DIR, 'engineering-results.json'),
        JSON.stringify(
          {
            runId: env.ENGINEERING_RUN_ID ?? null,
            files,
            summary,
          },
          null,
          2,
        ) + '\n',
      );
    }
    return 0;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.deepEqual(
      process.argv.slice(2),
      ['--engineering'],
      'Usage: node scripts/run-script-tests.mjs --engineering',
    );
    process.exitCode = runEngineeringTests(process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
