import {
  localDiagnosticIdentity,
  loadLocalDiagnosticPacket,
  sealLocalDiagnosticPacket,
  mergeLocalDiagnosticReport,
} from './local-diagnostic-evidence.mjs';
import {
  assertDependencyFreeSource,
  DIAGNOSTIC_FILES,
  diagnosticEnvironment,
  diagnosticIdentity,
  sealDiagnosticPacket,
  loadDiagnosticPacket,
  mergeDiagnosticReport,
} from './ci-diagnostic-evidence.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptTestFiles } from './script-test-plan.mjs';
import { nodeTestReport } from './node-test-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';

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

export function runScriptTests(mode, args = [], { root = process.cwd(), env = process.env } = {}) {
  assert.ok(
    ['--engineering', '--all', '--files', '--diagnostic'].includes(mode),
    'Expected --engineering, --all or --files',
  );
  const requestedRunId = env.ENGINEERING_RUN_ID;
  let files;
  if (mode === '--diagnostic') {
    assert.equal(args.length, 0);
    files = DIAGNOSTIC_FILES;
  } else if (mode === '--files') {
    assert.ok(args.length, 'File-targeted script tests require explicit files');
    files = args.map((file) => {
      const relative = path.relative(root, path.resolve(root, file));
      assert.ok(
        relative && !relative.startsWith('../') && !path.isAbsolute(relative),
        'Script test is outside the project',
      );
      assert.ok(
        relative.endsWith('.test.mjs') && statSync(path.join(root, relative)).isFile(),
        `Invalid script test file: ${file}`,
      );
      return relative;
    });
    assert.equal(new Set(files).size, files.length, 'Duplicate script test files');
  } else {
    assert.equal(args.length, 0, 'Inventory-based script tests do not accept file filters; use test:scripts:files');
    files = scriptTestFiles(root, mode === '--engineering' ? 'engineering' : 'all');
  }
  assert.ok(files.length, 'Script test inventory is empty');
  const allFiles = [...files];
  const localEnv = env;
  let localIdentity = null,
    localPacket = null;
  if (['--diagnostic', '--engineering'].includes(mode) && env.LOCAL_DIAGNOSTIC_RUN && env.LOCAL_DIAGNOSTIC_DIRECTORY) {
    try {
      localIdentity = localDiagnosticIdentity(root, env);
    } catch {
      /* Unproven identity runs original inventory. */
    }
    if (mode === '--engineering' && localIdentity)
      localPacket = loadLocalDiagnosticPacket(env.LOCAL_DIAGNOSTIC_DIRECTORY, localIdentity);
    if (localPacket) files = files.filter((file) => !DIAGNOSTIC_FILES.includes(file));
  }
  let identity = null,
    packet = null;
  if (['--engineering', '--diagnostic'].includes(mode)) {
    try {
      if (mode === '--diagnostic') {
        assert.equal(env.CI_DIAGNOSTIC_CAPSULE, 'true');
        assertDependencyFreeSource(root);
      }
      identity = diagnosticIdentity(root, env);
    } catch {
      /* No equivalence proof: retain original execution. */
    }
    if (mode === '--engineering' && identity && env.CI_DIAGNOSTIC_DIRECTORY)
      packet = loadDiagnosticPacket(env.CI_DIAGNOSTIC_DIRECTORY, identity);
    if (packet && !localPacket) files = files.filter((file) => !DIAGNOSTIC_FILES.includes(file));
    if (mode === '--engineering')
      console.log(
        localPacket
          ? `Reused complete same-local-execution diagnostics: ${localPacket.report.tests.length} cases, ${DIAGNOSTIC_FILES.length} files`
          : packet
            ? `Reused complete same-run diagnostics: ${DIAGNOSTIC_FILES.length} files`
            : 'Diagnostic equivalence unavailable: executing original full engineering inventory',
      );
    env = diagnosticEnvironment(env);
  }
  const kind = mode === '--engineering' ? 'engineering' : 'scripts';
  const runId = (kind === 'engineering' ? requestedRunId : undefined) ?? randomUUID();
  const directory = path.resolve(root, env.CI_EVIDENCE_DIR ?? `.task-verification/script-tests/${runId}`);
  mkdirSync(directory, { recursive: true });
  const rawFile = path.join(directory, `${kind}-${runId}-raw.json`);
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=2',
      '--test-reporter=spec',
      `--test-reporter=${fileURLToPath(new URL('./node-source-evidence-reporter.mjs', import.meta.url))}`,
      '--test-reporter-destination=stdout',
      '--test-reporter-destination=stdout',
      ...files.map((file) => path.resolve(root, file)),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...env, FRONTEND_TEST_RUN_ID: runId, FRONTEND_TEST_REPORT: rawFile },
    },
  );
  if (result.status !== 0) return result.status ?? 1;
  const raw = JSON.parse(readFileSync(rawFile, 'utf8'));
  let report = nodeTestReport(raw, files, root, kind);
  if (packet) {
    assert.deepEqual(diagnosticIdentity(root, process.env), identity, 'Engineering inputs changed');
    report = mergeDiagnosticReport(report, packet, identity);
  }
  if (localPacket) {
    assert.deepEqual(
      localDiagnosticIdentity(root, localEnv),
      localIdentity,
      'Local diagnostic inputs changed during engineering execution',
    );
    report = mergeLocalDiagnosticReport(report, localPacket, localIdentity);
  }
  if (mode === '--diagnostic' && localIdentity) {
    assert.deepEqual(
      localDiagnosticIdentity(root, localEnv),
      localIdentity,
      'Local diagnostic inputs changed during execution',
    );
    sealLocalDiagnosticPacket(localEnv.LOCAL_DIAGNOSTIC_DIRECTORY, localIdentity, report, raw);
  }
  if (mode === '--diagnostic' && identity) {
    assert.deepEqual(diagnosticIdentity(root, process.env), identity, 'Diagnostic inputs changed');
    sealDiagnosticPacket(directory, identity, report, raw, root);
  }
  assert.deepEqual(report.files, allFiles, 'Incomplete combined engineering inventory');
  const counts = validateFrontendTestReport(report, { kind, runId });
  const summary = validateNodeTestSummary({
    tests: counts.tests,
    suites: counts.suites,
    pass: counts.tests,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  });
  // Keep the CI engineering summary contract and retain the actual case inventory for local evidence.
  writeFileSync(path.join(directory, `${kind}-results.json`), JSON.stringify({ ...report, summary }, null, 2) + '\n');
  console.log(`${kind}: ${counts.tests} tests passed without skipped or todo cases`);
  return 0;
}

export function runEngineeringTests(root, env = process.env) {
  return runScriptTests('--engineering', [], { root, env });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runScriptTests(process.argv[2], process.argv.slice(3));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
