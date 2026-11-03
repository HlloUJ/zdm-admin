import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectShardArgs } from './e2e-shards.mjs';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'e2e-shards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'tests/e2e'), { recursive: true });
  mkdirSync(path.join(root, 'ci'));
  const plan = {
    version: 1,
    total: 2,
    strategy: 'whole-file-duration-v1',
    sources: ['1', '2'].map((runId) => ({ runId, reports: ['a'.repeat(64), 'b'.repeat(64)] })),
    files: [
      { file: 'long.spec.ts', shard: 1, estimatedMs: 100 },
      { file: 'short.spec.ts', shard: 2, estimatedMs: 100 },
    ],
  };
  for (const f of plan.files) writeFileSync(path.join(root, 'tests/e2e', f.file), '');
  const save = () => writeFileSync(path.join(root, 'ci/e2e-shards.json'), JSON.stringify(plan));
  save();
  return { root, plan, save };
}
test('real Playwright shards execute imported registrations exactly once and escape overlapping entry paths', (t) => {
  const f = fixture(t);
  const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
  const api = fileURLToPath(new URL('../node_modules/@playwright/test/index.mjs', import.meta.url));
  f.plan.files.push({ file: 'prefix-long+[a].spec.ts', shard: 2, estimatedMs: 100 });
  f.plan.files.push({ file: 'long+[a].spec.ts', shard: 1, estimatedMs: 100 });
  f.save();
  writeFileSync(
    path.join(f.root, 'playwright.config.cjs'),
    "module.exports = { testDir: './tests/e2e', retries: 0, workers: 1 };\n",
  );
  writeFileSync(
    path.join(f.root, 'tests/e2e/shared-cases.ts'),
    `import { test, expect } from ${JSON.stringify(api)};
export function register(name) { test(name, () => { expect(1 + 1).toBe(2); }); }`,
  );
  for (const entry of f.plan.files) {
    writeFileSync(
      path.join(f.root, 'tests/e2e', entry.file),
      `import { test, expect } from ${JSON.stringify(api)};
import { register } from './shared-cases';
test(${JSON.stringify('direct ' + entry.file)}, () => { expect(2 + 2).toBe(4); });
register(${JSON.stringify('imported ' + entry.file)});`,
    );
  }
  const run = (args) => {
    const result = spawnSync(process.execPath, [cli, 'test', '--reporter=json', '--forbid-only', ...args], {
      cwd: f.root,
      encoding: 'utf8',
      env: { ...process.env, PW_TEST_REPORTER: '', PLAYWRIGHT_JSON_OUTPUT_NAME: '' },
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const report = JSON.parse(result.stdout);
    const specs = [];
    const visit = (suite) => {
      for (const spec of suite.specs ?? []) specs.push(spec);
      for (const child of suite.suites ?? []) visit(child);
    };
    report.suites.forEach(visit);
    return specs;
  };
  const all = run(['--list']);
  assert.equal(all.length, 8);
  const executed = [];
  for (const n of [1, 2]) {
    const selection = selectShardArgs(f.root, [`--shard=${n}/2`, '--workers=1'], path.join(f.root, 'real' + n));
    const specs = run(selection.args);
    const files = f.plan.files.filter((entry) => entry.shard === n).map((entry) => entry.file);
    assert.deepEqual(
      specs.map((spec) => spec.title).sort(),
      files.flatMap((file) => ['direct ' + file, 'imported ' + file]).sort(),
    );
    for (const spec of specs) {
      for (const item of spec.tests) {
        assert.equal(item.expectedStatus, 'passed');
        assert.equal(item.results.length, 1);
        assert.equal(item.results[0].status, 'passed');
        assert.equal(item.results[0].retry, 0);
      }
      executed.push(spec.id);
    }
  }
  assert.equal(new Set(executed).size, executed.length);
  assert.deepEqual(executed.sort(), all.map((spec) => spec.id).sort());
});
