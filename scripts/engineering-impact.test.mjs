import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINEERING_EXTRA_INPUTS, captureReviewedScriptInputs } from './script-test-plan.mjs';
import {
  REVIEWED_DELIVERY_INPUTS,
  engineeringConsumers,
  engineeringExternalReaders,
  engineeringOnlyProof,
} from './engineering-impact.mjs';
import { createValidationPlan } from './check-changed-plan.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'engineering-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, source) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  };
  for (const file of ENGINEERING_EXTRA_INPUTS) write(file, '{}');
  for (const file of REVIEWED_DELIVERY_INPUTS) write(file, 'export const value = 1;');
  write('scripts/consumer.mjs', "import './wait-quality.mjs';");
  write('package.json', JSON.stringify({ scripts: { check: 'node scripts/wait-quality.mjs' } }));
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ])
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const seal = () => write('scripts/test-domain-manifest.json', JSON.stringify(captureReviewedScriptInputs(root)));
  const manifest = captureReviewedScriptInputs(root),
    consumers = engineeringConsumers(manifest, REVIEWED_DELIVERY_INPUTS);
  const topology = (file) => ({
    imports: manifest.files[file].imports,
    dynamicImports: manifest.files[file].dynamicImports,
  });
  const registry = {
    version: 1,
    inputs: Object.fromEntries(REVIEWED_DELIVERY_INPUTS.map((f) => [f, topology(f)])),
    consumers: Object.fromEntries(consumers.map((f) => [f, topology(f)])),
    externalReaders: engineeringExternalReaders(root, consumers),
  };
  const saveRegistry = () => write('scripts/engineering-impact.json', JSON.stringify(registry));
  saveRegistry();
  seal();
  return { root, write, seal, registry, saveRegistry };
}
const changed = ['scripts/wait-quality.mjs', 'scripts/test-domain-manifest.json'];
test('audited control tools preserve full engineering while avoiding unrelated frontend/backend suites', (t) => {
  const f = fixture(t);
  f.write(changed[0], 'export const value = 2;');
  f.seal();
  const proof = engineeringOnlyProof(f.root, changed);
  assert.equal(proof.proven, true, proof.reason);
  const impact = classifyChangedFiles(changed, { root: f.root, engineeringProof: { proven: true } });
  assert.equal(impact.engineering, true);
  assert.equal(impact.frontend, false);
  assert.equal(impact.backend, false);
  assert.equal(impact.full, false);
  assert.ok(engineeringOnlyProof(f.root, changed).consumers.includes('scripts/consumer.mjs'));
  const plan = createValidationPlan(changed, () => true, { root: f.root });
  assert.ok(!plan.tasks.some((task) => task.args.includes('verify:local')));
  assert.equal(plan.backendPlan.mode, 'none');
  assert.equal(plan.browserPlan.mode, 'none');
  assert.ok(plan.tasks.some((task) => task.args.includes('test:scripts')));
});
for (const fault of [
  'omitted-consumer',
  'new-consumer',
  'external-consumer',
  'dynamic-external',
  'dependency',
  'entrypoint',
  'unreviewed',
  'expansion',
])
  test(`scope refuses ${fault} and restores complete gates`, (t) => {
    const f = fixture(t);
    if (fault === 'omitted-consumer') {
      delete f.registry.consumers['scripts/consumer.mjs'];
      f.saveRegistry();
    }
    if (fault === 'new-consumer') f.write('scripts/new-consumer.mjs', "import './wait-quality.mjs';");
    if (fault === 'external-consumer') f.write('src/new-consumer.ts', "import '../scripts/wait-quality.mjs';");
    if (fault === 'dynamic-external') f.write('src/dynamic.ts', 'export const value = import(process.env.TARGET);');
    if (fault === 'dependency') f.write('scripts/wait-quality.mjs', "import './new-module.mjs';");
    if (fault === 'entrypoint')
      f.write('package.json', JSON.stringify({ scripts: { check: 'node scripts/wait-quality.mjs --new' } }));
    if (fault === 'expansion') {
      f.registry.inputs['src/business.ts'] = { imports: [], dynamicImports: 0 };
      f.saveRegistry();
    }
    if (fault === 'unreviewed') f.write(changed[0], 'export const value = 2;');
    else f.seal();
    assert.equal(engineeringOnlyProof(f.root, changed).proven, false);
    const impact = classifyChangedFiles(changed, { root: f.root, engineeringProof: { proven: true } });
    assert.equal(impact.frontend, true);
    assert.equal(impact.backend, true);
    assert.equal(impact.full, true);
  });
test('shared validation, permissions, migrations, dependencies and unknown inputs never inherit the narrow scope', (t) => {
  const f = fixture(t);
  for (const file of [
    'scripts/verify.mjs',
    '.github/workflows/quality.yml',
    'package.json',
    'backend/src/main/resources/db/migration/V999.sql',
    'src/services/auth.ts',
    'scripts/unknown.mjs',
  ]) {
    const impact = classifyChangedFiles([...changed, file], { root: f.root, engineeringProof: { proven: true } });
    assert.equal(impact.full, true, file);
  }
});
