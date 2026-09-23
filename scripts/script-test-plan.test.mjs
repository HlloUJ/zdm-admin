import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createVerificationPlan } from './verify.mjs';
import {
  captureReviewedScriptInputs,
  createScriptTestPlan,
  engineeringDomainProof,
  scriptTestFiles,
} from './script-test-plan.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-script-domain-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  };
  for (const file of [
    'package.json',
    'package-lock.json',
    'vite.config.js',
    'docker-compose.yml',
    'docker-compose.task.yml',
    '.codex/zdm-project-workflow.yaml',
  ])
    write(file, '{}');
  write('scripts/helper.mjs', 'export const value = 1;');
  write('scripts/consumer.mjs', "import { value } from './helper.mjs';\nexport const result = value;");
  write('scripts/helper.test.mjs', "import './helper.mjs';");
  write('scripts/consumer.test.mjs', "import './consumer.mjs';");
  write('scripts/unrelated.test.mjs', "import test from 'node:test';");
  write('scripts/feedback-foundation.test.mjs', '/* source guard */');
  const seal = () => write('scripts/test-domain-manifest.json', JSON.stringify(captureReviewedScriptInputs(root)));
  seal();
  return { root, write, seal };
}
test('business source changes preserve engineering proof but tooling inputs do not', (t) => {
  const f = fixture(t);
  f.write('src/page.vue', 'business change');
  assert.equal(engineeringDomainProof(f.root).proven, true);
  f.write('scripts/helper.mjs', 'export const value = 2;');
  assert.equal(engineeringDomainProof(f.root).proven, false);
  f.seal();
  assert.equal(engineeringDomainProof(f.root).proven, true);
  f.write('vite.config.js', 'changed configuration');
  assert.equal(engineeringDomainProof(f.root).proven, false);
});
test('engineering test inventory retains all reviewed tools and excludes only explicit source guards', (t) => {
  const f = fixture(t);
  assert.deepEqual(scriptTestFiles(f.root, 'engineering'), [
    'scripts/consumer.test.mjs',
    'scripts/helper.test.mjs',
    'scripts/unrelated.test.mjs',
  ]);
  assert.ok(scriptTestFiles(f.root).includes('scripts/feedback-foundation.test.mjs'));
});
test('local selection includes indirect consumers, not only the edited helper test', (t) => {
  const f = fixture(t);
  f.write('scripts/helper.mjs', 'export const value = 2;');
  assert.deepEqual(createScriptTestPlan(['scripts/helper.mjs'], f.root).tests, [
    'scripts/consumer.test.mjs',
    'scripts/helper.test.mjs',
  ]);
});
test('new imports, dynamic imports, unknown files and deletions invalidate precise script selection', (t) => {
  for (const mutate of [
    (f) => f.write('scripts/helper.mjs', "import './consumer.mjs';\nexport const value = 2;"),
    (f) => f.write('scripts/helper.mjs', 'export const value = import(process.env.MODULE);'),
    (f) => f.write('scripts/new.test.mjs', 'new filesystem reader'),
    (f) => rmSync(path.join(f.root, 'scripts/consumer.mjs')),
  ]) {
    const f = fixture(t);
    mutate(f);
    assert.equal(createScriptTestPlan(['scripts/helper.mjs'], f.root).mode, 'full');
    assert.equal(engineeringDomainProof(f.root).proven, false);
  }
});
test('changed filesystem-reader code invalidates domain proof even with unchanged imports', (t) => {
  const f = fixture(t);
  f.write('scripts/consumer.test.mjs', "import './consumer.mjs';\nreadFileSync('src/business.ts');");
  assert.equal(engineeringDomainProof(f.root).proven, false);
});

test('shared configuration or changed filesystem/process readers cannot use import-only selection', (t) => {
  for (const [file, source] of [
    ['vite.config.js', 'changed configuration'],
    ['scripts/helper.mjs', "import fs from 'node:fs';\nexport const value = fs.readFileSync(input);"],
    ['scripts/helper.mjs', 'export const value = spawnSync(command);'],
  ]) {
    const f = fixture(t);
    f.write(file, source);
    assert.equal(createScriptTestPlan(['scripts/helper.mjs', file], f.root).mode, 'full');
  }
});

test('affected verification keeps one engineering pipeline and retains source guards', (t) => {
  const f = fixture(t);
  const plan = createVerificationPlan({
    root: f.root,
    affected: true,
    files: ['scripts/helper.mjs'],
    impact: { full: false, engineering: true, frontend: false, backend: false },
  });
  assert.equal(plan.engineering.length, 1);
  assert.ok(plan.engineering[0].args.includes('test:engineering'));
  assert.equal(plan.frontend.filter((entry) => entry.args.includes('test:source-guards')).length, 1);
  assert.equal(
    plan.frontend.filter((entry) => entry.args.some((arg) => ['test:scripts', 'test:scripts:files'].includes(arg)))
      .length,
    0,
  );
});
