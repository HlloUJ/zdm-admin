import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_FILES } from './ci-diagnostic-evidence.mjs';
import { localDiagnosticIdentity, loadLocalDiagnosticPacket } from './local-diagnostic-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';
import { runScriptTests, validateNodeTestSummary } from './run-script-tests.mjs';
import { nodeTestReport } from './node-test-evidence.mjs';

export function targetedScriptPlan(files) {
  assert.ok(files.length, 'Targeted tests require explicit files');
  const requested = [...new Set(files)].sort();
  const diagnostics = requested.some((file) => DIAGNOSTIC_FILES.includes(file)) ? DIAGNOSTIC_FILES : [];
  const remaining = requested.filter((file) => !diagnostics.includes(file));
  return { requested, diagnostics, remaining, inventory: [...new Set([...diagnostics, ...requested])].sort() };
}

export function runTargetedScriptTests(
  args,
  { root = process.cwd(), env = process.env, execute = runScriptTests } = {},
) {
  root = realpathSync(root);
  const files = args.map((file) => {
    const relative = path.relative(root, path.resolve(root, file));
    assert.ok(relative && !relative.startsWith('../') && !path.isAbsolute(relative));
    assert.ok(relative.endsWith('.test.mjs') && statSync(path.join(root, relative)).isFile());
    return relative;
  });
  const plan = targetedScriptPlan(files);
  if (!plan.diagnostics.length || env.CI || env.GITHUB_ACTIONS === 'true')
    return execute('--files', plan.requested, { root, env });
  const run = randomUUID();
  const directory = path.join(root, '.task-verification/targeted-scripts', run);
  const diagnostics = path.join(directory, 'diagnostics');
  mkdirSync(diagnostics, { recursive: true });
  const localEnv = {
    ...env,
    LOCAL_DIAGNOSTIC_RUN: run,
    LOCAL_DIAGNOSTIC_DIRECTORY: diagnostics,
    CI_EVIDENCE_DIR: diagnostics,
  };
  const identity = localDiagnosticIdentity(root, localEnv);
  const code = execute('--diagnostic', [], { root, env: localEnv });
  if (code !== 0) return code;
  assert.deepEqual(localDiagnosticIdentity(root, localEnv), identity, 'Targeted diagnostic inputs changed');
  const packet = loadLocalDiagnosticPacket(diagnostics, identity);
  assert.ok(packet, 'Incomplete or invalid diagnostic execution; never silently execute overlapping tests');
  const reports = [packet.report];
  if (plan.remaining.length) {
    const targetDirectory = path.join(directory, 'remaining');
    const result = execute('--files', plan.remaining, { root, env: { ...env, CI_EVIDENCE_DIR: targetDirectory } });
    if (result !== 0) return result;
    const report = JSON.parse(readFileSync(path.join(targetDirectory, 'scripts-results.json')));
    validateFrontendTestReport(report, { kind: 'scripts', runId: report.runId });
    assert.match(report.runId, /^[a-f0-9-]{36}$/);
    const raw = JSON.parse(readFileSync(path.join(targetDirectory, `scripts-${report.runId}-raw.json`)));
    const { summary, ...normalized } = report;
    assert.deepEqual(
      normalized,
      nodeTestReport(raw, plan.remaining, root, 'scripts'),
      'Targeted report differs from raw execution',
    );
    validateNodeTestSummary(summary);
    assert.deepEqual(report.files, plan.remaining, 'Incomplete targeted remainder');
    reports.push(report);
  }
  assert.deepEqual(localDiagnosticIdentity(root, localEnv), identity, 'Targeted inputs changed across execution');
  const executed = reports.flatMap((report) => report.files);
  assert.equal(new Set(executed).size, executed.length, 'Overlapping test executions');
  assert.deepEqual(executed.sort(), plan.inventory, 'Missing associated test inventory');
  writeFileSync(
    path.join(directory, 'execution-plan.json'),
    JSON.stringify({ plan, identity, reports }, null, 2) + '\n',
  );
  console.log(
    `Targeted diagnostics and consumers executed once: ${executed.length} files; ${plan.requested.filter((file) => plan.diagnostics.includes(file)).length} overlapping files removed.`,
  );
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runTargetedScriptTests(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
