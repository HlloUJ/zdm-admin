import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  unlinkSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIAGNOSTIC_FILES } from './ci-diagnostic-evidence.mjs';
import { runScriptTests } from './run-script-tests.mjs';
import { runTargetedScriptTests } from './run-targeted-script-tests.mjs';
function fixture(t, fault) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'targeted-union-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, '.task-verification'));
  writeFileSync(path.join(root, '.gitignore'), '.task-verification/\n');
  const source = (name, extra = '') =>
    `import test from 'node:test';
import { randomUUID } from 'node:crypto';import fs from 'node:fs';test(${JSON.stringify('fixture case: ' + name)},()=>{fs.appendFileSync('.task-verification/calls',${JSON.stringify(name + '\n')});${extra}});`;
  for (const [i, file] of DIAGNOSTIC_FILES.entries())
    writeFileSync(
      path.join(root, file),
      source(file, fault === 'diagnostic' && i === 0 ? 'throw Error("expected diagnostic failure")' : ''),
    );
  writeFileSync(
    path.join(root, 'scripts/remaining.test.mjs'),
    source('remaining', fault === 'remaining' ? 'throw Error("expected remaining failure")' : ''),
  );
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ])
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const env = { PATH: process.env.PATH, HOME: os.homedir(), LANG: 'en_US.UTF-8' };
  return {
    root,
    env,
    calls: () => readFileSync(path.join(root, '.task-verification/calls'), 'utf8').trim().split('\n'),
  };
}
const requested = [DIAGNOSTIC_FILES[0], DIAGNOSTIC_FILES[1], 'scripts/remaining.test.mjs'];
test('real coordinated entry executes diagnostic plus consumer union once and retains all raw-derived cases', (t) => {
  const f = fixture(t);
  assert.equal(runTargetedScriptTests(requested, { ...f }), 0);
  assert.equal(f.calls().length, DIAGNOSTIC_FILES.length + 1);
  assert.equal(new Set(f.calls()).size, f.calls().length);
  assert.ok(f.calls().includes('remaining'));
  assert.equal(
    DIAGNOSTIC_FILES.length + requested.length - f.calls().length,
    2,
    'Two actual duplicate file executions removed',
  );
});
for (const fault of ['diagnostic', 'remaining', 'missing', 'mutation', 'incomplete'])
  test(`coordinated execution blocks ${fault} without retry or incomplete success`, (t) => {
    const f = fixture(t, fault);
    const execute = (mode, files, options) => {
      const code = runScriptTests(mode, files, options);
      if (mode === '--diagnostic' && fault === 'missing')
        unlinkSync(path.join(options.env.LOCAL_DIAGNOSTIC_DIRECTORY, 'local-diagnostic-packet.json'));
      if (mode === '--diagnostic' && fault === 'mutation') writeFileSync(path.join(f.root, 'new-input.mjs'), 'changed');
      if (mode === '--files' && fault === 'incomplete') {
        const file = path.join(options.env.CI_EVIDENCE_DIR, 'scripts-results.json');
        const report = JSON.parse(readFileSync(file));
        report.files = [];
        writeFileSync(file, JSON.stringify(report));
      }
      return code;
    };
    if (['diagnostic', 'remaining'].includes(fault))
      assert.notEqual(runTargetedScriptTests(requested, { ...f, execute }), 0);
    else assert.throws(() => runTargetedScriptTests(requested, { ...f, execute }));
    const calls = f.calls();
    assert.equal(new Set(calls).size, calls.length, 'No automatic test retry');
    if (['diagnostic', 'missing', 'mutation'].includes(fault)) assert.ok(!calls.includes('remaining'));
  });
test('invalid selected path cannot start diagnostics or escape the repository', (t) => {
  const f = fixture(t);
  assert.throws(() => runTargetedScriptTests(['../outside.test.mjs'], f));
  assert.equal(existsSync(path.join(f.root, '.task-verification/calls')), false);
});

for (const missing of [false, true])
  test(`same-executor preflight is reused by targeted consumers; missing=${missing}`, (t) => {
    const f = fixture(t);
    const run = randomUUID(),
      directory = path.join(f.root, '.task-verification/local-diagnostics', run);
    mkdirSync(directory, { recursive: true });
    const env = {
      ...f.env,
      LOCAL_DIAGNOSTIC_RUN: run,
      LOCAL_DIAGNOSTIC_DIRECTORY: directory,
      CI_EVIDENCE_DIR: directory,
    };
    assert.equal(runScriptTests('--diagnostic', [], { root: f.root, env }), 0);
    if (missing) unlinkSync(path.join(directory, 'local-diagnostic-packet.json'));
    if (missing) assert.throws(() => runTargetedScriptTests(requested, { root: f.root, env }), /Incomplete or invalid/);
    else assert.equal(runTargetedScriptTests(requested, { root: f.root, env }), 0);
    assert.equal(f.calls().length, DIAGNOSTIC_FILES.length + (missing ? 0 : 1));
    assert.equal(new Set(f.calls()).size, f.calls().length, 'Preflight was not executed a second time');
  });
