import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrowserTestPlan, proveFinishedSpecConsumers } from './affected-test-inputs.mjs';
import { createBackendTestPlan } from './backend-test-plan.mjs';
const page = 'src/pages/slab/color/index.vue';
const backend = 'backend/src/main/java/com/zdm/platform/inventory/';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-affected-inputs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  };
  write(
    page,
    "<script setup>import { ref } from 'vue';\nconst permissionPrefix = 'color';\n</script><template>Before</template>",
  );
  write('src/router/index.ts', "export const route = () => import('@/pages/slab/color/index.vue');");
  write('tests/e2e/slab-color.spec.ts', '// existing coverage');
  write(
    `${backend}FinishedSpecValidator.java`,
    'package com.zdm.platform.inventory;\nfinal class FinishedSpecValidator {}',
  );
  write(`${backend}FinishedProductService.java`, 'class FinishedProductService { FinishedSpecValidator helper; }');
  write(
    `${backend}FinishedProductController.java`,
    'class FinishedProductController { FinishedProductService service; }',
  );
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.');
  git('commit', '-m', 'fixture', '--no-verify');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, write };
}
test('reviewed page uses its actual browser tests when route consumers and policy remain stable', (t) => {
  const f = fixture(t);
  f.write(
    page,
    "<script setup>import { ref } from 'vue';\nconst permissionPrefix = 'color';\n</script><template>After</template>",
  );
  assert.deepEqual(createBrowserTestPlan([page], f.root).tests, ['tests/e2e/slab-color.spec.ts']);
});
test('new page consumers, dependencies, permission changes and renames fall back to all browser tests', (t) => {
  for (const mutate of [
    (f) => f.write('src/another.ts', "import Page from '@/pages/slab/color/index.vue';"),
    (f) => f.write(page, '<script setup>import x from "./new-helper";</script>'),
    (f) => f.write(page, "const permissionPrefix = 'changed';"),
    (f) => f.write('src/loader.ts', 'const component = import(componentPath);'),
    (f) => rmSync(path.join(f.root, page)),
  ]) {
    const f = fixture(t);
    mutate(f);
    assert.equal(createBrowserTestPlan([page], f.root).mode, 'full');
  }
});
test('unknown frontend inputs never inherit a nearby page mapping', (t) => {
  const f = fixture(t);
  assert.equal(createBrowserTestPlan([page, 'src/components/shared.vue'], f.root).mode, 'full');
  assert.equal(createBrowserTestPlan(['src/pages/slab/new/index.vue'], f.root).mode, 'full');
});
test('package-private spec validation proves direct and transitive consumers before narrowing', (t) => {
  const f = fixture(t);
  assert.equal(proveFinishedSpecConsumers(f.root), true);
  assert.equal(
    createBackendTestPlan([`${backend}FinishedSpecValidator.java`], () => true, { root: f.root }).mode,
    'targeted',
  );
  f.write('backend/src/main/java/Other.java', 'class Other { FinishedProductService service; }');
  assert.equal(proveFinishedSpecConsumers(f.root), false);
  assert.equal(
    createBackendTestPlan([`${backend}FinishedSpecValidator.java`], () => true, { root: f.root }).mode,
    'full',
  );
});
test('new validator dependencies or reflective consumers cannot reuse the narrow backend plan', (t) => {
  const f = fixture(t);
  f.write(`${backend}FinishedSpecValidator.java`, 'import other.Shared;\nfinal class FinishedSpecValidator {}');
  assert.equal(proveFinishedSpecConsumers(f.root), false);
  const g = fixture(t);
  g.write('backend/src/main/java/Reflective.java', 'class Reflective { Object value = Class.forName(name); }');
  assert.equal(proveFinishedSpecConsumers(g.root), false);
});
