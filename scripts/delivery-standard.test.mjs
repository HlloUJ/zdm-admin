import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryStandardRule, deliveryStandardPlan } from './delivery-standard.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';
const impact = { frontend: true, backend: true, engineering: true, full: true, runtime: false };

test('versioned classification applies high-risk and shared rules before local file extension', () => {
  for (const [file, level] of [
    ['README.md', 'R0'],
    ['src/pages/example/view.css', 'R1'],
    ['src/pages/example/index.vue', 'R2'],
    ['src/components/common/theme.css', 'R3'],
    ['src/services/client.ts', 'R3'],
    ['src/pages/stock/view.css', 'R4'],
    ['scripts/verify.mjs', 'R4'],
    ['AGENTS.md', 'R4'],
    ['docs/engineering/task-execution-order.md', 'R4'],
    ['unknown.data', 'R4'],
    ['../README.md', 'R4'],
  ])
    assert.equal(deliveryStandardRule(file).level, level, file);
});

test('mixed changes union all applicable requirements and generate reproducible plan identities', () => {
  const files = ['src/components/common/Index.vue', 'src/pages/stock/List.vue', 'README.md'];
  const a = deliveryStandardPlan({ files, impact, candidate: 'candidate', base: 'base', environment: { node: '24' } });
  const b = deliveryStandardPlan({
    files: [...files].reverse().concat(files[0]),
    impact,
    candidate: 'candidate',
    base: 'base',
    environment: { node: '24' },
  });
  assert.deepEqual(a, b);
  assert.equal(a.level, 'R4');
  for (const requirement of ['shared-consumers', 'compatibility', 'risk-specific', 'document-contract'])
    assert.ok(a.minimum.includes(requirement));
  assert.deepEqual(a.domains, ['frontend', 'backend', 'engineering']);
  for (const change of [
    { candidate: 'new' },
    { base: 'new' },
    { environment: { node: '26' } },
    { files: ['README.md'] },
    { impact: { ...impact, backend: false } },
  ])
    assert.notEqual(
      deliveryStandardPlan({
        files,
        impact,
        candidate: 'candidate',
        base: 'base',
        environment: { node: '24' },
        ...change,
      }).digest,
      a.digest,
    );
});

test('unknown paths and missing impact cannot authorize a smaller gate set', () => {
  for (const files of [[], null, ['/outside/file'], ['x/../README.md'], ['unknown.bin']]) {
    const plan = deliveryStandardPlan({ files, impact });
    assert.equal(plan.level, 'R4');
    assert.equal(plan.unknownScope, true);
    assert.ok(plan.minimum.includes('complete-applicable-gates'));
    assert.deepEqual(plan.domains, ['frontend', 'backend', 'engineering']);
  }
  assert.throws(
    () => deliveryStandardPlan({ files: ['README.md'], impact: { frontend: true } }),
    /conservative impact/,
  );
});

test('control documents do not use the ordinary document-only execution shortcut', () => {
  const pure = classifyChangedFiles(['README.md'], { engineeringProof: { proven: true } });
  assert.equal(pure.docsOnly, true);
  const control = classifyChangedFiles(['docs/engineering/accepted-source-delivery.md'], {
    engineeringProof: { proven: true },
  });
  assert.equal(control.docsOnly, false);
  assert.equal(control.engineering, true);
});

test('a single shared high-risk file retains both shared and risk-specific checks', () => {
  const plan = deliveryStandardPlan({ files: ['src/components/stock/Shared.vue'], impact });
  assert.equal(plan.level, 'R4');
  assert.ok(plan.minimum.includes('shared-consumers'));
  assert.ok(plan.minimum.includes('risk-specific'));
});

test('missing or malformed standard cannot authorize a document-only plan', async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'invalid-delivery-standard-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'ci'));
  writeFileSync(
    path.join(root, 'scripts/delivery-standard.mjs'),
    readFileSync(new URL('./delivery-standard.mjs', import.meta.url)),
  );
  writeFileSync(path.join(root, 'ci/delivery-standard.json'), '{broken');
  const invalid = await import(new URL('file://' + path.join(root, 'scripts/delivery-standard.mjs')));
  assert.equal(invalid.deliveryStandardAvailable, false);
  const fallback = invalid.deliveryStandardPlan({
    files: ['README.md'],
    impact: { frontend: false, backend: false, engineering: false, full: false, runtime: false, docsOnly: true },
  });
  assert.equal(fallback.level, 'R4');
  assert.equal(fallback.unknownScope, true);
  assert.deepEqual(fallback.domains, ['frontend', 'backend', 'engineering']);
  assert.ok(fallback.minimum.includes('complete-applicable-gates'));
});
