import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';

const runner = fileURLToPath(new URL('./run-frontend-tests.mjs', import.meta.url));
const dependencies = fileURLToPath(new URL('../node_modules', import.meta.url));
function executeFixture(t, kind, source, options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-frontend-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const reportDirectory = path.join(root, 'reports');
  const env = { ...process.env, CI_EVIDENCE_DIR: reportDirectory, FRONTEND_TEST_RUN_ID: 'fixture-first-run' };
  delete env.NODE_TEST_CONTEXT;
  let args = [];
  if (kind === 'unit') {
    symlinkSync(dependencies, path.join(root, 'node_modules'), 'dir');
    const config = { test: { environment: 'node', include: ['*.test.mjs'], maxWorkers: 1 } };
    if (options.projects)
      config.test.projects = options.projects.map((name) => ({
        test: { name, environment: 'node', include: ['*.test.mjs'] },
      }));
    writeFileSync(path.join(root, 'vitest.config.mjs'), `export default ${JSON.stringify(config)};`);
    writeFileSync(path.join(root, 'example.test.mjs'), `import {test,expect,describe} from 'vitest';\n${source}`);
    args = ['--config', path.join(root, 'vitest.config.mjs')];
  } else {
    mkdirSync(path.join(root, 'scripts'));
    writeFileSync(
      path.join(root, 'scripts/feedback-foundation.test.mjs'),
      `import {test,describe} from 'node:test';\n${source}`,
    );
  }
  const child = spawnSync(process.execPath, [runner, kind, ...args], { cwd: root, env, encoding: 'utf8' });
  const reportFile = path.join(reportDirectory, `${kind}-results.json`);
  assert.equal(child.status, options.failure ? 1 : 0, child.stdout + child.stderr);
  assert.equal(existsSync(reportFile), !options.failure, child.stdout + child.stderr);
  return { child, report: existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : null };
}

test('real Vitest and Node reporters preserve actual tests and nested suite inventory', (t) => {
  for (const kind of ['unit', 'source-guards']) {
    const { report } = executeFixture(
      t,
      kind,
      "describe('outer',()=>{describe('inner',()=>test('pass',()=>{})); test('second',()=>{})});",
    );
    assert.equal(report.tests.length, 2);
    assert.equal(report.files.length, 1);
    assert.equal(report.runId, 'fixture-first-run');
    validateFrontendTestReport(report, { kind, runId: 'fixture-first-run' });
  }
});

test('Vitest project identities remain distinct when two projects execute the same file', (t) => {
  const { report } = executeFixture(t, 'unit', "test('pass',()=>{});", { projects: ['first', 'second'] });
  assert.equal(report.files.length, 2);
  assert.equal(new Set(report.files).size, 2);
  assert.equal(report.tests.length, 2);
  assert.equal(new Set(report.tests.map((entry) => entry.id)).size, 2);
});

test('real skipped, todo, failed and empty Node source guards cannot pass', (t) => {
  for (const source of [
    "test.skip('skip',()=>{});",
    "test.todo('todo');",
    "test('fail',()=>{throw Error('fixture failure')});",
    '',
    "test('pass',()=>{}); describe('empty',()=>{});",
  ])
    executeFixture(t, 'source-guards', source, { failure: true });
});

test('real Vitest skipped, todo, failed, retried and empty suites cannot pass', (t) => {
  for (const source of [
    "test.skip('skip',()=>{});",
    "test.todo('todo');",
    "test('fail',()=>{throw Error('fixture failure')});",
    "let attempts=0; test('retry',{retry:1},()=>{expect(++attempts).toBe(2)});",
    "test.fails('expected failure',()=>{throw Error('fixture failure')});",
    '',
    "test('pass',()=>{}); describe('empty',()=>{});",
  ])
    executeFixture(t, 'unit', source, { failure: true });
});

test('missing, stale, incomplete, duplicated and truncated reports cannot grant success', (t) => {
  const { report } = executeFixture(t, 'unit', "test('pass',()=>{});");
  for (const mutate of [
    (value) => {
      value.runId = 'stale';
    },
    (value) => {
      value.complete = false;
    },
    (value) => {
      value.completedFiles = [];
    },
    (value) => {
      value.tests = [];
    },
    (value) => {
      value.collectedTests.push('missing');
    },
    (value) => {
      value.tests.push(value.tests[0]);
    },
    (value) => {
      value.tests[0].status = 'pending';
    },
    (value) => {
      value.tests[0].retryCount = 1;
    },
    (value) => {
      value.errors.push({ message: 'unhandled' });
    },
  ]) {
    const broken = structuredClone(report);
    mutate(broken);
    assert.throws(() => validateFrontendTestReport(broken, { kind: 'unit', runId: 'fixture-first-run' }));
  }
  assert.throws(() => validateFrontendTestReport(undefined, { kind: 'unit', runId: 'fixture-first-run' }));
});
