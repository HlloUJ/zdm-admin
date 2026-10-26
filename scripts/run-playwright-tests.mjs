import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectShardArgs } from './e2e-shards.mjs';
import { validatePlaywrightTestReport } from './playwright-test-evidence.mjs';

export function runPlaywrightTests(args, { root = process.cwd(), env = process.env } = {}) {
  const cli = path.join(root, 'node_modules/@playwright/test/cli.js');
  const directory = path.resolve(root, env.CI_EVIDENCE_DIR ?? `.task-verification/playwright-tests/${randomUUID()}`);
  const balanced = args.includes('--balanced');
  args = args.filter((arg) => arg !== '--balanced');
  if (balanced) {
    assert.ok(
      existsSync(path.join(root, '.codex/zdm-project-workflow.yaml')),
      'Managed project required for balanced shards',
    );
    args = selectShardArgs(root, args, directory).args;
  }
  if (args.includes('--list') || args.includes('--help') || args.includes('-h')) {
    // Listing is discovery only; preserve the CLI output without claiming tests executed.
    return spawnSync(process.execPath, [cli, 'test', ...args], { cwd: root, env, stdio: 'inherit' }).status ?? 1;
  }
  const runId = randomUUID();
  mkdirSync(directory, { recursive: true });
  const reportFile = path.join(directory, `playwright-${runId}.json`);
  const result = spawnSync(process.execPath, [cli, 'test', ...args, '--forbid-only'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...env,
      PLAYWRIGHT_TEST_RUN_ID: runId,
      PLAYWRIGHT_TEST_REPORT: reportFile,
      // Locked Playwright 1.62 appends this reporter after configured/CLI reporters. Keep JSON,
      // HTML and custom reporter semantics intact. If this hook changes, missing evidence fails
      // closed below; dependency upgrades must run the real reporter fixtures.
      PW_TEST_REPORTER: fileURLToPath(new URL('./playwright-evidence-reporter.mjs', import.meta.url)),
    },
  });
  if (result.status !== 0) return result.status ?? 1;
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const summary = validatePlaywrightTestReport(report, runId);
  writeFileSync(path.join(directory, 'playwright-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`playwright: ${summary.tests} selected tests passed without skipped or retried cases`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runPlaywrightTests(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
