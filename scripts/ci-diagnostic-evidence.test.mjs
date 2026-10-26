import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIAGNOSTIC_FILES,
  diagnosticEnvironment,
  sealDiagnosticPacket,
  validateDiagnosticPacket,
  mergeDiagnosticReport,
  validateDiagnosticComposition,
  loadDiagnosticPacket,
} from './ci-diagnostic-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'diagnostic-chain-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  for (const file of DIAGNOSTIC_FILES)
    writeFileSync(path.join(root, file), "import test from 'node:test';test('actual fixture case',()=>{});\n");
  const directory = path.join(root, 'evidence');
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./run-script-tests.mjs', import.meta.url)), '--diagnostic'],
    { cwd: root, env: { PATH: process.env.PATH, HOME: os.homedir(), CI_EVIDENCE_DIR: directory }, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(readFileSync(path.join(directory, 'scripts-results.json')));
  // The normalized raw-derived report has no outer CLI summary until after sealing.
  delete report.summary;
  const raw = JSON.parse(
    readFileSync(
      path.join(
        directory,
        readdirSync(directory).find((file) => file.endsWith('-raw.json')),
      ),
    ),
  );
  const identity = {
    version: 1,
    contract: 'same-run-pure-node-diagnostics-v1',
    run: '123',
    attempt: 1,
    candidate: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    files: DIAGNOSTIC_FILES,
    root: 'source-capsule-v1',
    dependencyMode: 'isolated-shallow-source-no-node-modules',
    inputs: 'c'.repeat(64),
    environment: 'd'.repeat(64),
    node: 'e'.repeat(64),
    packages: 'f'.repeat(64),
    git: ['git version', 'a'.repeat(64)],
    gitConfiguration: 'b'.repeat(64),
    kernel: 'kernel',
    platform: ['linux', 'x64', 'ubuntu24', 'image'],
    resources: '4cpu-16gb',
  };
  return {
    root,
    directory,
    report,
    raw,
    identity,
    packet: sealDiagnosticPacket(directory, identity, report, raw, root),
  };
}
test('real isolated Node report seals, validates and combines into an exact disjoint complete inventory', (t) => {
  const f = fixture(t);
  validateDiagnosticPacket(f.packet, f.identity);
  const file = 'scripts/remaining.test.mjs';
  const report = {
    schemaVersion: 1,
    kind: 'engineering',
    runId: 'engineering',
    complete: true,
    files: [file],
    completedFiles: [file],
    collectedTests: ['remaining'],
    tests: [
      {
        id: 'remaining',
        file,
        name: 'remaining',
        status: 'passed',
        retryCount: 0,
        repeatCount: 0,
        flaky: false,
        expectedFailure: false,
      },
    ],
    suites: [],
    errors: [],
  };
  const combined = mergeDiagnosticReport(report, f.packet, f.identity);
  assert.equal(
    validateFrontendTestReport(combined, { kind: 'engineering', runId: 'engineering' }).tests,
    DIAGNOSTIC_FILES.length + 1,
  );
  validateDiagnosticComposition(combined);
  assert.throws(
    () => mergeDiagnosticReport({ ...report, files: [DIAGNOSTIC_FILES[0]] }, f.packet, f.identity),
    /overlap/,
  );
});
test('missing reports, wrong candidate/run/environment/input and tampered raw events cannot grant reuse', (t) => {
  const f = fixture(t);
  for (const key of ['candidate', 'run', 'environment', 'inputs', 'node'])
    assert.throws(() => validateDiagnosticPacket(f.packet, { ...f.identity, [key]: 'changed' }));
  assert.equal(loadDiagnosticPacket(path.join(f.root, 'missing'), f.identity), null);
  const tampered = structuredClone(f.packet);
  tampered.raw.events = [];
  assert.throws(() => validateDiagnosticPacket(tampered, f.identity));
  const normalized = structuredClone(f.packet);
  normalized.report.tests[0].status = 'skipped';
  assert.throws(() => validateDiagnosticPacket(normalized, f.identity));
});
test('diagnostic workers receive reviewed runtime inputs without GitHub identities, API tokens or npm wrapper state', () => {
  const result = diagnosticEnvironment({
    PATH: 'bin',
    CI: 'true',
    NODE_OPTIONS: '--max-old-space-size=2048',
    GITHUB_TOKEN: 'secret',
    GITHUB_EVENT_PATH: 'private',
    RUNNER_NAME: 'runner',
    npm_config_user_agent: 'wrapper',
  });
  assert.deepEqual(result, { CI: 'true', NODE_OPTIONS: '--max-old-space-size=2048', PATH: 'bin' });
  assert.deepEqual(
    diagnosticEnvironment({ PATH: '/project/node_modules/.bin:/usr/bin', NODE_PATH: '/project/node_modules' }),
    { PATH: '/usr/bin' },
  );
});

test('actual CI launcher checks out the exact shallow candidate and executes without installed dependencies', (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'diagnostic-launch-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  for (const file of DIAGNOSTIC_FILES)
    writeFileSync(path.join(root, file), "import test from 'node:test';test('capsule execution',()=>{});\n");
  const runner = new URL('./run-script-tests.mjs', import.meta.url).href;
  writeFileSync(
    path.join(root, 'scripts/run-script-tests.mjs'),
    `import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import {runScriptTests} from ${JSON.stringify(runner)};assert.ok(existsSync('.git/shallow'));assert.equal(existsSync('node_modules'),false);process.exitCode=runScriptTests('--diagnostic');`,
  );
  writeFileSync(path.join(root, '.gitignore'), 'evidence/\n');
  for (const args of [
    ['init'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture', '--no-verify'],
  ])
    assert.equal(spawnSync('git', args, { cwd: root, encoding: 'utf8' }).status, 0);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-ci-diagnostics.mjs', import.meta.url))], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: os.homedir(),
      GITHUB_ACTIONS: 'true',
      CI_EVIDENCE_DIR: path.join(root, 'evidence'),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(path.join(root, 'evidence/scripts-results.json')));
  assert.equal(report.tests.length, DIAGNOSTIC_FILES.length);
  assert.deepEqual(report.files, DIAGNOSTIC_FILES);
});
