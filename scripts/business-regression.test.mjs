import { main as checkChanged } from './check-changed.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateContracts,
  loadContracts,
  discoverConsumers,
  digest,
  requireBrowserBehaviors,
  browserBehaviorTitles,
  requireBackendBehaviors,
  validateContractEvolution,
  validateChangedBusinessCoverage,
  discoverBrowserConsumers,
} from './business-regression.mjs';
import { createValidationPlan } from './check-changed-plan.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';

const root = process.cwd();
const clone = (value) => structuredClone(value);
test('actual product API, SQL, shared adapter consumers and preserved tests match reviewed contracts', () => {
  const registry = validateContracts(root);
  const consumers = registry.contracts[0].consumers;
  for (const file of [
    'src/modules/accessory/routes.ts',
    'src/composables/useCommodityModule.ts',
    'src/pages/finished-stock/store/index.vue',
    'src/pages/slab/supply-chain/index.vue',
    'backend/src/main/java/com/zdm/platform/inventory/AccessoryProductController.java',
  ])
    assert.ok(consumers.includes(file), file);
});
test('omitting even one actual shared consumer blocks the gate', () => {
  const registry = clone(loadContracts(root));
  registry.contracts[0].consumers = registry.contracts[0].consumers.filter(
    (file) => file !== 'src/modules/accessory/routes.ts',
  );
  assert.throws(() => validateContracts(root, registry), /omitted business consumers/);
});
test('new direct, transitive and SQL consumers cannot silently inherit an old impact review', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'zdm-business-impact-'));
  const put = (file, source) => {
    mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
    writeFileSync(path.join(temp, file), source);
  };
  try {
    put('src/services/products.ts', 'export const products = 1;');
    put('src/shared/adapter.ts', "export { products } from '@/services/products';");
    put('src/pages/new/index.vue', "import { products } from '@/shared/adapter';");
    put('backend/src/main/SqlReader.java', 'class SqlReader { String sql="SELECT * FROM finished_products"; }');
    const contract = { roots: ['src/services/products.ts'], tables: ['finished_products'] };
    assert.deepEqual(discoverConsumers(temp, contract), [
      'backend/src/main/SqlReader.java',
      'src/pages/new/index.vue',
      'src/services/products.ts',
      'src/shared/adapter.ts',
    ]);
  } finally {
    rmSync(temp, { recursive: true });
  }
});
// An existing checkpoint/main baseline may reject the same violation before the current-file guard.
test('removing or weakening a previously accepted assertion does not become green automatically', () => {
  const registry = clone(loadContracts(root));
  const contract = registry.contracts[0];
  const file = contract.browserTests[0];
  const source = readFileSync(path.join(root, file), 'utf8');
  assert.ok(source.includes("await expect(row).not.toContainText('旧操作人');"));
  contract.protectedTests[file] = digest(source.replace("await expect(row).not.toContainText('旧操作人');", ''));
  assert.throws(
    () => validateContracts(root, registry),
    /Protected business regression changed|Changed accepted assertions need an exact reviewed transition/,
  );
});
test('product backend-only changes cannot omit frontend consumers from CI', () => {
  const result = classifyChangedFiles(
    ['backend/src/main/java/com/zdm/platform/inventory/AccessoryProductService.java'],
    { engineeringProof: { proven: true } },
  );
  assert.equal(result.frontend, true);
  assert.equal(result.backend, true);
  assert.equal(result.full, true);
});
test('frontend-only product changes select associated real API and UI behavior regressions locally', () => {
  const plan = createValidationPlan(['src/pages/finished-stock/supply-chain/index.vue'], () => true, { root });
  assert.ok(plan.tasks.some((task) => task.args.includes('backend:test')));
  assert.ok(
    plan.tasks.some(
      (task) => task.args.includes('test:e2e:chrome') && task.args.includes('tests/e2e/product-state-activity.spec.ts'),
    ),
  );
});
test('missing one terminal, one batch behavior or duplicate evidence is rejected', () => {
  const required = browserBehaviorTitles();
  assert.equal(required.length, 24);
  requireBrowserBehaviors(required, required);
  for (const index of [0, 5, 14, 23])
    assert.throws(
      () =>
        requireBrowserBehaviors(
          required.filter((_, i) => i !== index),
          required,
        ),
      /Missing or duplicate/,
    );
  assert.throws(() => requireBrowserBehaviors([...required, required[0]], required), /Missing or duplicate/);
});
test('successful evidence from another candidate cannot satisfy business regression', () => {
  assert.throws(
    () =>
      requireBrowserBehaviors(browserBehaviorTitles(), browserBehaviorTitles(), {
        candidate: 'old',
        expectedCandidate: 'current',
      }),
    /different candidate/,
  );
});
test('backend summary totals cannot hide a missing parameterized state or terminal case', () => {
  const methods = {
    returnsRealDatabaseTimeWithoutSourceTagPayload: 12,
    transitionResponseMatchesPersistedActivityBeforeAnyListRefresh: 2,
    slabStatusMutationAndListReadSamePersistedActivity: 2,
    reentryKeepsRealTriggerReasonAndHistoricalLogs: 3,
  };
  const xml = Object.entries(methods)
    .flatMap(([name, count]) => Array.from({ length: count }, (_, i) => `<testcase name="${name}(String)[${i}]"/>`))
    .join('');
  requireBackendBehaviors('com.zdm.platform.inventory.ProductStateActivityApiTest', xml);
  assert.throws(
    () =>
      requireBackendBehaviors(
        'com.zdm.platform.inventory.ProductStateActivityApiTest',
        xml.replace('<testcase name="slabStatusMutationAndListReadSamePersistedActivity(String)[1]"/>', ''),
      ),
    /Missing executed business cases/,
  );
});

test('accepted regression lists and assertion baselines cannot be silently rewritten', () => {
  const previous = loadContracts(root);
  const removed = clone(previous);
  removed.contracts[0].browserTests.shift();
  assert.throws(() => validateContractEvolution(previous, removed), /Cannot silently remove accepted/);
  const weakened = clone(previous);
  const file = weakened.contracts[0].browserTests[0];
  weakened.contracts[0].protectedTests[file] = 'changed';
  assert.throws(() => validateContractEvolution(previous, weakened), /exact reviewed transition/);
  const deleted = clone(previous);
  deleted.contracts = [];
  assert.throws(() => validateContractEvolution(previous, deleted), /Cannot silently remove business contract/);
});

test('cross-directory shared dependencies are traced rather than scoped only by module paths', () => {
  const result = classifyChangedFiles(['backend/src/main/java/com/zdm/platform/account/CreatorNames.java'], {
    engineeringProof: { proven: true },
    root,
  });
  assert.equal(result.frontend, true);
  assert.equal(result.backend, true);
  assert.ok(result.reasons.some((reason) => reason.includes('反向调用链')));
});

test('an unregistered business module or shared source cannot silently pass existing generic tests', () => {
  assert.throws(
    () => validateChangedBusinessCoverage(root, ['src/pages/new-unregistered-business/index.vue']),
    /Unregistered business change/,
  );
  assert.throws(
    () => validateChangedBusinessCoverage(root, ['src/utils/new-unregistered-behavior.ts']),
    /Unregistered business change/,
  );
  validateChangedBusinessCoverage(root, ['src/pages/finished-stock/supply-chain/index.vue']);
});
test('omitting a URL-associated legacy browser regression is rejected', () => {
  const registry = clone(loadContracts(root));
  registry.contracts[0].browserTests = registry.contracts[0].browserTests.filter(
    (file) => file !== 'tests/e2e/feedback-foundation.spec.ts',
  );
  assert.throws(
    () => validateContracts(root, registry),
    /Missing associated browser regression|Cannot silently remove accepted regression/,
  );
});
test('browser URL roots include test helper import consumers without selecting unrelated modules', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'zdm-browser-consumers-'));
  try {
    mkdirSync(path.join(temp, 'tests/e2e'), { recursive: true });
    writeFileSync(path.join(temp, 'tests/e2e/helper.ts'), "export const open=page=>page.goto('/product-example');");
    writeFileSync(path.join(temp, 'tests/e2e/product.spec.ts'), "import {open} from './helper';");
    writeFileSync(path.join(temp, 'tests/e2e/unrelated.spec.ts'), "page.goto('/unrelated');");
    assert.deepEqual(discoverBrowserConsumers(temp, { routes: ['/product-example'] }), ['tests/e2e/product.spec.ts']);
  } finally {
    rmSync(temp, { recursive: true });
  }
});

test('the real changed-check entry blocks an unregistered source before any task executes', async () => {
  let executions = 0;
  const candidate = { digest: 'candidate', baseline: 'base', mergeBase: 'base', mutationStamp: 'stamp' };
  await assert.rejects(
    () =>
      checkChanged(['src/router/index.ts'], {
        root,
        capture: () => candidate,
        run: async () => {
          executions++;
          return { exitCode: 0 };
        },
        report: () => {},
      }),
    /Unregistered business change/,
  );
  assert.equal(executions, 0);
});
