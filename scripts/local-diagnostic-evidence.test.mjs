import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_FILES, validateDiagnosticComposition } from './ci-diagnostic-evidence.mjs';
import { validateLocalDiagnosticPacket, localDiagnosticIdentity } from './local-diagnostic-evidence.mjs';
const runner = fileURLToPath(new URL('./run-script-tests.mjs', import.meta.url));
function fixture(t, { failure = false, mutation = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'local-diagnostics-')));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, '.task-verification'));
  writeFileSync(path.join(root, '.gitignore'), '.task-verification/\nnode_modules/\n');
  const source = (name, extra = '') =>
    `import test from 'node:test';import fs from 'node:fs';test(${JSON.stringify('fixture case: ' + name)},()=>{fs.appendFileSync('.task-verification/executed.log',${JSON.stringify(name + '\n')});${extra}});`;
  for (const [i, file] of DIAGNOSTIC_FILES.entries())
    writeFileSync(path.join(root, file), source(file, failure && i === 0 ? 'throw Error("intentional failure")' : ''));
  writeFileSync(
    path.join(root, 'scripts/remaining.test.mjs'),
    source('remaining', mutation ? 'fs.writeFileSync("changed-input.txt","changed");' : ''),
  );
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ])
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const directory = path.join(root, '.task-verification/diagnostics');
  mkdirSync(directory);
  const env = {
    PATH: process.env.PATH,
    HOME: os.homedir(),
    LANG: 'en_US.UTF-8',
    LOCAL_DIAGNOSTIC_RUN: randomUUID(),
    LOCAL_DIAGNOSTIC_DIRECTORY: directory,
    CI_EVIDENCE_DIR: directory,
  };
  const run = (mode, overrides = {}) =>
    spawnSync(process.execPath, [runner, mode], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
  const calls = () => readFileSync(path.join(root, '.task-verification/executed.log'), 'utf8').trim().split('\n');
  return { root, directory, env, run, calls, packetFile: path.join(directory, 'local-diagnostic-packet.json') };
}
test('real same-run diagnostics execute once; remaining cases run and full raw-derived inventory stays complete', (t) => {
  const f = fixture(t);
  const pre = f.run('--diagnostic');
  assert.equal(pre.status, 0, pre.stderr + pre.stdout);
  const packet = JSON.parse(readFileSync(f.packetFile));
  validateLocalDiagnosticPacket(packet, packet.identity);
  assert.equal(f.calls().length, 15);
  const result = f.run('--engineering');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Reused complete same-local-execution diagnostics: 15 cases, 15 files/);
  assert.equal(f.calls().length, 16);
  assert.equal(new Set(f.calls()).size, 16);
  const report = JSON.parse(readFileSync(path.join(f.directory, 'engineering-results.json')));
  assert.equal(report.tests.length, 16);
  assert.equal(report.files.length, 16);
  assert.equal(report.summary.skipped, 0);
  assert.ok(report.tests.every((x) => x.status === 'passed' && x.retryCount === 0));
  assert.throws(() => validateDiagnosticComposition(report), /Local diagnostic proof cannot authorize CI/);
  const damaged = structuredClone(packet);
  damaged.raw.events.pop();
  assert.throws(() => validateLocalDiagnosticPacket(damaged, packet.identity));
  damaged.identity.run = randomUUID();
  assert.throws(() => validateLocalDiagnosticPacket(damaged, packet.identity));
});
test('source, dependency, environment, run, missing and corrupt proof all fall back to actual full execution', (t) => {
  for (const fault of ['source', 'dependency', 'environment', 'run', 'missing', 'corrupt', 'ci']) {
    const f = fixture(t);
    const pre = f.run('--diagnostic');
    assert.equal(pre.status, 0, pre.stderr + pre.stdout);
    let overrides = {};
    if (fault === 'source') writeFileSync(path.join(f.root, 'new-input.txt'), 'changed');
    if (fault === 'dependency') {
      mkdirSync(path.join(f.root, 'node_modules'));
      writeFileSync(path.join(f.root, 'node_modules/dependency.js'), 'changed');
    }
    if (fault === 'environment') overrides = { LANG: 'zh_CN.UTF-8' };
    if (fault === 'run') overrides = { LOCAL_DIAGNOSTIC_RUN: randomUUID() };
    if (fault === 'missing') rmSync(f.packetFile);
    if (fault === 'corrupt') writeFileSync(f.packetFile, '{broken');
    if (fault === 'ci') overrides = { CI: 'true' };
    const result = f.run('--engineering', overrides);
    assert.equal(result.status, 0, fault + result.stderr + result.stdout);
    assert.ok(!result.stdout.includes('Reused complete same-local-execution'), fault);
    assert.equal(f.calls().length, 31, fault);
    const report = JSON.parse(readFileSync(path.join(f.directory, 'engineering-results.json')));
    assert.equal(report.tests.length, 16);
    assert.equal(report.localDiagnosticReuse, undefined);
  }
});
test('failed diagnostics never seal success and a candidate change during remaining execution cannot pass', (t) => {
  const failed = fixture(t, { failure: true });
  assert.notEqual(failed.run('--diagnostic').status, 0);
  assert.equal(existsSync(failed.packetFile), false);
  assert.notEqual(failed.run('--engineering').status, 0);
  const moving = fixture(t, { mutation: true });
  const pre = moving.run('--diagnostic');
  assert.equal(pre.status, 0, pre.stderr + pre.stdout);
  const result = moving.run('--engineering');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Local diagnostic inputs changed/);
  assert.throws(() => localDiagnosticIdentity(process.cwd(), { CI: 'true' }), /cannot authorize CI/);
});
