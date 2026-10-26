import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { hashPaths } from './verification-evidence.mjs';
import { nodeTestReport } from './node-test-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';

export const DIAGNOSTIC_FILES = [
  'ci-equivalence',
  'ci-quality-evidence',
  'ci-chrome-preparation',
  'ci-browser-image',
  'ci-backend-equivalence',
  'backend-test-evidence',
  'ci-report-contract',
  'completion-session',
  'completion-cli',
  'completion-recovery',
  'e2e-shards',
  'script-test-plan',
  'verification-policy',
  'e2e-app',
  'ci-diagnostic-evidence',
]
  .map((name) => `scripts/${name}.test.mjs`)
  .sort();
const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
export function diagnosticEnvironment(env) {
  const result = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) =>
        /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_ALL|TZ|CI|GITHUB_ACTIONS|CI_EVIDENCE_DIR|NODE_.*|NPM_CONFIG_.*)$/.test(
          key,
        ),
      )
      .sort(),
  );
  if (result.PATH)
    result.PATH = result.PATH.split(path.delimiter)
      .filter((entry) => !entry.split(/[\\/]/).includes('node_modules'))
      .join(path.delimiter);
  delete result.NODE_PATH;
  return result;
}
function command(root, program, args) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30000,
    env: diagnosticEnvironment(process.env),
  });
  assert.equal(result.status, 0, 'Diagnostic identity unavailable');
  return result.stdout.trim();
}
export function diagnosticIdentity(root, env = process.env) {
  assert.equal(env.GITHUB_RUN_ATTEMPT, '1');
  assert.ok(
    !/(?:--require|--import|--loader|--experimental-loader)/.test(env.NODE_OPTIONS ?? ''),
    'Unreviewed Node preload cannot reuse diagnostics',
  );
  assert.match(env.GITHUB_RUN_ID ?? '', /^\d+$/);
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(env.ImageOS, 'ubuntu24');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.equal(os.cpus().length, 4);
  assert.ok(os.totalmem() >= 16000000000);
  assert.match(process.version, /^v22\./);
  assert.equal(command(root, 'git', ['status', '--porcelain', '--untracked-files=normal']), '');
  const files = command(root, 'git', ['ls-files', '-z']).split('\0').filter(Boolean).sort();
  return {
    version: 1,
    contract: 'same-run-pure-node-diagnostics-v1',
    run: env.GITHUB_RUN_ID,
    attempt: 1,
    candidate: command(root, 'git', ['rev-parse', 'HEAD']),
    tree: command(root, 'git', ['rev-parse', 'HEAD^{tree}']),
    files: DIAGNOSTIC_FILES,
    root: 'source-capsule-v1',
    dependencyMode: 'isolated-shallow-source-no-node-modules',
    inputs: hashPaths(root, files),
    environment: digest(diagnosticEnvironment(env)),
    node: digest(readFileSync(process.execPath)),
    git: [command(root, 'git', ['--version']), digest(readFileSync(command(root, 'which', ['git'])))],
    gitConfiguration: hashPaths('/', [
      path.join(env.HOME ?? os.homedir(), '.gitconfig'),
      path.join(env.HOME ?? os.homedir(), '.config/git/config'),
      '/etc/gitconfig',
    ]),
    kernel: os.release(),
    packages: digest(command(root, 'dpkg-query', ['-W', '-f=${Package}=${Version}\n'])),
    platform: ['linux', 'x64', env.ImageOS, env.ImageVersion],
    resources: '4cpu-16gb',
  };
}
export function sealDiagnosticPacket(directory, identity, report, raw, executionRoot = process.cwd()) {
  validateFrontendTestReport(report, { kind: 'scripts', runId: report.runId });
  assert.deepEqual(report.files, DIAGNOSTIC_FILES);
  const packet = {
    version: 1,
    identity,
    executionRoot,
    report,
    raw,
    reportDigest: digest(report),
    rawDigest: digest(raw),
  };
  writeFileSync(path.join(directory, 'diagnostic-packet.json'), JSON.stringify(packet, null, 2) + '\n');
  return packet;
}
export function validateDiagnosticPacket(packet, expected) {
  assert.equal(packet?.version, 1);
  assert.equal(expected?.version, 1);
  assert.equal(expected.contract, 'same-run-pure-node-diagnostics-v1');
  assert.equal(expected.attempt, 1);
  assert.match(expected.run, /^\d+$/);
  for (const key of ['candidate', 'tree']) assert.match(expected[key], /^[a-f0-9]{40}$/);
  for (const key of ['inputs', 'environment', 'node', 'packages', 'gitConfiguration'])
    assert.match(expected[key], /^[a-f0-9]{64}$/);
  assert.deepEqual(expected.files, DIAGNOSTIC_FILES);
  assert.deepEqual(expected.platform.slice(0, 3), ['linux', 'x64', 'ubuntu24']);
  assert.equal(expected.resources, '4cpu-16gb');
  assert.ok(Array.isArray(expected.git) && expected.git.length === 2 && expected.git[0]);
  assert.match(expected.git[1], /^[a-f0-9]{64}$/);
  assert.ok(expected.kernel && expected.platform[3]);
  assert.equal(expected.root, 'source-capsule-v1');
  assert.equal(expected.dependencyMode, 'isolated-shallow-source-no-node-modules');
  assert.ok(path.isAbsolute(packet.executionRoot));
  assert.deepEqual(packet.identity, expected);
  assert.equal(packet.reportDigest, digest(packet.report));
  assert.equal(packet.rawDigest, digest(packet.raw));
  assert.deepEqual(packet.report.files, DIAGNOSTIC_FILES);
  const rebuilt = nodeTestReport(packet.raw, DIAGNOSTIC_FILES, packet.executionRoot, 'scripts');
  assert.deepEqual(packet.report, rebuilt, 'Diagnostic normalized report differs from raw execution');
  validateFrontendTestReport(packet.report, { kind: 'scripts', runId: packet.report.runId });
  return packet.report;
}
export function loadDiagnosticPacket(directory, expected) {
  try {
    const packet = JSON.parse(readFileSync(path.join(directory, 'diagnostic-packet.json')));
    validateDiagnosticPacket(packet, expected);
    return packet;
  } catch {
    return null;
  }
}
export function mergeDiagnosticReport(report, packet, currentIdentity) {
  const original = validateDiagnosticPacket(packet, currentIdentity);
  assert.ok(
    report.files.every((file) => !original.files.includes(file)),
    'Diagnostic and engineering executions overlap',
  );
  return {
    ...report,
    files: [...report.files, ...original.files].sort(),
    completedFiles: [...report.completedFiles, ...original.completedFiles].sort(),
    collectedTests: [...report.collectedTests, ...original.collectedTests],
    tests: [...report.tests, ...original.tests],
    suites: [...report.suites, ...original.suites],
    diagnosticReuse: { currentIdentity, packet },
  };
}
export function validateDiagnosticComposition(report) {
  if (!report.diagnosticReuse) return;
  const { currentIdentity, packet } = report.diagnosticReuse;
  const original = validateDiagnosticPacket(packet, currentIdentity);
  assert.equal(new Set(report.tests.map((t) => t.id)).size, report.tests.length);
  assert.deepEqual(
    report.tests.filter((t) => original.files.includes(t.file)),
    original.tests,
  );
}

export function assertDependencyFreeSource(root) {
  let directory = path.resolve(root);
  while (true) {
    assert.equal(
      existsSync(path.join(directory, 'node_modules')),
      false,
      'Diagnostic source can resolve installed dependencies',
    );
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}
