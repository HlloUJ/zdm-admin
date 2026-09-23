import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';
import { validatePlaywrightTestReport } from './playwright-test-evidence.mjs';

const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const dependencies = script('../node_modules');
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-local-test-entry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  symlinkSync(dependencies, path.join(root, 'node_modules'), 'dir');
  const env = { ...process.env, CI_EVIDENCE_DIR: path.join(root, 'reports') };
  delete env.NODE_TEST_CONTEXT;
  const execute = (runner, args) =>
    spawnSync(process.execPath, [script(runner), ...args], { cwd: root, env, encoding: 'utf8' });
  return { root, env, execute };
}
function relatedFixture(t, source = "test('works',()=>{});", related = true) {
  const f = fixture(t);
  writeFileSync(
    path.join(f.root, 'vitest.config.mjs'),
    "export default {test:{environment:'node',include:['*.test.mjs'],maxWorkers:1}};",
  );
  writeFileSync(path.join(f.root, 'source.mjs'), 'export const value = 1;');
  writeFileSync(
    path.join(f.root, 'example.test.mjs'),
    `import {test,expect,describe} from 'vitest';\n${related ? "import './source.mjs';" : ''}\n${source}`,
  );
  return f;
}

test('related entry executes discovered tests and rejects skip, todo, retry and empty selected suites', (t) => {
  for (const [source, expected] of [
    ["test('works',()=>{});", 0],
    ["test.skip('skip',()=>{});", 1],
    ["test.todo('todo');", 1],
    ["let n=0; test('retry',{retry:1},()=>expect(++n).toBe(2));", 1],
    ["test('works',()=>{}); describe('empty',()=>{});", 1],
  ]) {
    const f = relatedFixture(t, source);
    const result = f.execute('./run-frontend-tests.mjs', ['related', 'source.mjs']);
    assert.equal(result.status, expected, result.stdout + result.stderr);
  }
});

test('actual empty related discovery is not-applicable only with existing sources and a nonempty universe', (t) => {
  const f = relatedFixture(t, undefined, false);
  const result = f.execute('./run-frontend-tests.mjs', ['related', 'source.mjs']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /not-applicable/);
  const report = JSON.parse(readFileSync(path.join(f.env.CI_EVIDENCE_DIR, 'related-results.json'), 'utf8'));
  assert.equal(validateFrontendTestReport(report, { kind: 'related', runId: report.runId }).status, 'not-applicable');
  for (const mutate of [
    (value) => {
      value.selection.complete = false;
    },
    (value) => {
      value.selection.universe = [];
    },
    (value) => {
      value.selection.sources = [];
    },
    (value) => {
      value.selection.selected = ['missing'];
    },
  ]) {
    const broken = structuredClone(report);
    mutate(broken);
    assert.throws(() => validateFrontendTestReport(broken, { kind: 'related', runId: report.runId }));
  }
  for (const args of [['related'], ['related', 'typo.mjs']]) {
    const failed = f.execute('./run-frontend-tests.mjs', args);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  }
  rmSync(path.join(f.root, 'example.test.mjs'));
  const emptyProject = f.execute('./run-frontend-tests.mjs', ['related', 'source.mjs']);
  assert.equal(emptyProject.status, 1, emptyProject.stdout + emptyProject.stderr);
});

function playwrightFixture(t, source, extraConfig = '') {
  const f = fixture(t);
  writeFileSync(
    path.join(f.root, 'playwright.config.mjs'),
    `export default {testDir:'.',testMatch:'*.spec.mjs',workers:1,reporter:[['list']],${extraConfig}};`,
  );
  writeFileSync(path.join(f.root, 'example.spec.mjs'), `import {test,expect} from '@playwright/test';\n${source}`);
  return f;
}

test('Playwright validates selected cases while preserving explicit JSON reporters, file selection, grep and shards', (t) => {
  const f = playwrightFixture(t, "test('first',()=>{}); test('second',()=>{});", 'fullyParallel:true,');
  f.env.PLAYWRIGHT_JSON_OUTPUT_NAME = path.join(f.root, 'original-report.json');
  for (const args of [
    [],
    ['example.spec.mjs', '--grep=first', '--reporter=list,json'],
    ['--shard=1/2'],
    ['--shard=2/2'],
  ]) {
    const result = f.execute('./run-playwright-tests.mjs', args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(path.join(f.env.CI_EVIDENCE_DIR, 'playwright-results.json'), 'utf8'));
    assert.equal(report.tests.length, args.length ? 1 : 2);
    validatePlaywrightTestReport(report, report.runId);
  }
  assert.equal(JSON.parse(readFileSync(f.env.PLAYWRIGHT_JSON_OUTPUT_NAME, 'utf8')).stats.expected, 1);
});

test('Playwright --list preserves JSON discovery and does not create execution evidence', (t) => {
  const f = playwrightFixture(t, "test.skip('not run during list',()=>{});");
  f.env.PLAYWRIGHT_JSON_OUTPUT_NAME = path.join(f.root, 'list.json');
  const result = f.execute('./run-playwright-tests.mjs', ['--list', '--reporter=json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(JSON.parse(readFileSync(f.env.PLAYWRIGHT_JSON_OUTPUT_NAME, 'utf8')).suites.length);
  assert.equal(existsSync(f.env.CI_EVIDENCE_DIR), false);
});

test('real Playwright skip, fixme, expected failure, retry, empty and exclusive suites cannot pass', (t) => {
  for (const source of [
    "test.skip('skip',()=>{});",
    "test.fixme('fixme',()=>{});",
    "test('failure',()=>expect(1).toBe(2));",
    "test('expected failure',()=>{test.fail(); expect(1).toBe(2)});",
    "test('retry',({}, info)=>expect(info.retry).toBe(1));",
    '',
    "test.only('exclusive',()=>{}); test('omitted',()=>{});",
  ]) {
    const f = playwrightFixture(t, source, 'retries:1,');
    const result = f.execute('./run-playwright-tests.mjs', []);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(existsSync(path.join(f.env.CI_EVIDENCE_DIR, 'playwright-results.json')), false);
  }
});

test('a removed Playwright additional reporter hook cannot fall back to a successful exit code', (t) => {
  const f = fixture(t);
  rmSync(path.join(f.root, 'node_modules'));
  mkdirSync(path.join(f.root, 'node_modules/@playwright/test'), { recursive: true });
  writeFileSync(path.join(f.root, 'node_modules/@playwright/test/cli.js'), 'process.exit(0);');
  const result = f.execute('./run-playwright-tests.mjs', []);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /ENOENT/);
});

test('missing or duplicated selected Playwright cases and incomplete or stale reports cannot pass', (t) => {
  const f = playwrightFixture(t, "test('works',()=>{});");
  const result = f.execute('./run-playwright-tests.mjs', []);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(path.join(f.env.CI_EVIDENCE_DIR, 'playwright-results.json'), 'utf8'));
  for (const mutate of [
    (value) => {
      value.selected.push('missing-case');
    },
    (value) => {
      value.tests.push(value.tests[0]);
    },
    (value) => {
      value.complete = false;
    },
    (value) => {
      value.runId = 'stale';
    },
    (value) => {
      value.errors.push({ message: 'late error' });
    },
    (value) => {
      value.tests[0].results[0].retry = 1;
    },
  ]) {
    const broken = structuredClone(report);
    mutate(broken);
    assert.throws(() => validatePlaywrightTestReport(broken, report.runId));
  }
});

test('related selection unions changed source consumers and explicit changed tests without duplicate execution', (t) => {
  const f = relatedFixture(t);
  writeFileSync(path.join(f.root, 'independent.test.mjs'), "import {test} from 'vitest'; test('independent',()=>{});");
  const result = f.execute('./run-frontend-tests.mjs', [
    'related',
    'source.mjs',
    'example.test.mjs',
    'independent.test.mjs',
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(path.join(f.env.CI_EVIDENCE_DIR, 'related-results.json'), 'utf8'));
  assert.equal(report.tests.length, 2);
  assert.equal(new Set(report.tests.map((item) => item.id)).size, 2);
  assert.equal(report.files.length, 2);
});
