// Local-only, same-executor proof. This contract cannot authorize CI report reuse.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSource, hashPaths } from './verification-evidence.mjs';
import { DIAGNOSTIC_FILES, diagnosticEnvironment } from './ci-diagnostic-evidence.mjs';
import { nodeTestReport } from './node-test-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';
const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
export function localDiagnosticIdentity(root, env = process.env) {
  assert.ok(!env.CI && env.GITHUB_ACTIONS !== 'true', 'Local diagnostics cannot authorize CI');
  assert.match(env.LOCAL_DIAGNOSTIC_RUN ?? '', /^[a-f0-9-]{36}$/);
  assert.ok(
    !/(?:--require|--import|--loader|--experimental-loader)/.test(env.NODE_OPTIONS ?? ''),
    'Unreviewed Node preload',
  );
  const effective = diagnosticEnvironment(env);
  const git = (...args) => execFileSync('git', args, { cwd: root, env: effective, encoding: 'utf8' }).trim();
  return {
    version: 1,
    contract: 'same-local-execution-diagnostics-v1',
    run: env.LOCAL_DIAGNOSTIC_RUN,
    root: realpathSync(root),
    candidate: captureSource(root),
    files: DIAGNOSTIC_FILES,
    environment: digest(effective),
    node: digest(readFileSync(process.execPath)),
    nodeVersion: process.version,
    implementation: hashPaths(path.dirname(fileURLToPath(import.meta.url)), [
      'local-diagnostic-evidence.mjs',
      'run-script-tests.mjs',
      'verification-evidence.mjs',
      'ci-diagnostic-evidence.mjs',
      'frontend-test-evidence.mjs',
      'node-test-evidence.mjs',
      'node-source-evidence-reporter.mjs',
      'script-test-plan.mjs',
    ]),
    dependencies: hashPaths(root, ['node_modules'], { dependency: true }),
    git: [
      git('--version'),
      hashPaths('/', [
        path.resolve(root, git('rev-parse', '--git-path', 'config')),
        path.join(env.HOME ?? os.homedir(), '.gitconfig'),
        path.join(env.HOME ?? os.homedir(), '.config/git/config'),
        '/etc/gitconfig',
      ]),
    ],
    platform: [process.platform, process.arch, os.release()],
    resources: [os.cpus().length, os.totalmem()],
  };
}
export function validateLocalDiagnosticPacket(packet, expected) {
  assert.equal(packet?.version, 1);
  assert.equal(expected?.contract, 'same-local-execution-diagnostics-v1');
  assert.match(expected.run, /^[a-f0-9-]{36}$/);
  assert.ok(path.isAbsolute(expected.root));
  assert.deepEqual(packet.identity, expected);
  assert.equal(packet.reportDigest, digest(packet.report));
  assert.equal(packet.rawDigest, digest(packet.raw));
  assert.deepEqual(packet.report.files, DIAGNOSTIC_FILES);
  const rebuilt = nodeTestReport(packet.raw, DIAGNOSTIC_FILES, expected.root, 'scripts');
  assert.deepEqual(packet.report, rebuilt, 'Local normalized diagnostics differ from raw execution');
  validateFrontendTestReport(rebuilt, { kind: 'scripts', runId: rebuilt.runId });
  return rebuilt;
}
export function sealLocalDiagnosticPacket(directory, identity, report, raw) {
  const packet = { version: 1, identity, report, raw, reportDigest: digest(report), rawDigest: digest(raw) };
  validateLocalDiagnosticPacket(packet, identity);
  // A failed or repeated attempt cannot overwrite a prior sealed result in this executor run.
  writeFileSync(path.join(directory, 'local-diagnostic-packet.json'), JSON.stringify(packet, null, 2) + '\n', {
    flag: 'wx',
  });
  return packet;
}
export function loadLocalDiagnosticPacket(directory, expected) {
  try {
    const packet = JSON.parse(readFileSync(path.join(directory, 'local-diagnostic-packet.json')));
    validateLocalDiagnosticPacket(packet, expected);
    return packet;
  } catch {
    return null;
  }
}
export function mergeLocalDiagnosticReport(report, packet, identity) {
  const original = validateLocalDiagnosticPacket(packet, identity);
  assert.ok(
    report.files.every((file) => !original.files.includes(file)),
    'Local diagnostic executions overlap',
  );
  const combined = {
    ...report,
    files: [...report.files, ...original.files].sort(),
    completedFiles: [...report.completedFiles, ...original.completedFiles].sort(),
    collectedTests: [...report.collectedTests, ...original.collectedTests],
    tests: [...report.tests, ...original.tests],
    suites: [...report.suites, ...original.suites],
    localDiagnosticReuse: { identity, packet },
  };
  validateFrontendTestReport(combined, { kind: 'engineering', runId: report.runId });
  return combined;
}
