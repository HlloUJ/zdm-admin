import assert from 'node:assert/strict';
import test from 'node:test';
import { engineeringOnlyProof } from './engineering-impact.mjs';
import { engineeringScopeFixture as fixture } from './test-support/engineering-scope-fixture.mjs';
import { createValidationPlan } from './check-changed-plan.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';

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
  'external-script',
  'reflective-script',
  'omitted-reflective',
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
    if (fault === 'external-script')
      f.write('scripts/reader.py', 'subprocess.run(["node", "scripts/wait-quality.mjs"])');
    if (fault === 'reflective-script')
      f.write('scripts/dynamic.mjs', 'export const module = import(process.env.MODULE);');
    if (fault === 'omitted-reflective') {
      f.registry.reflectiveReaders['scripts/absent.mjs'] = 'bad';
      f.saveRegistry();
    }
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
