import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackendTestPlan } from './backend-test-plan.mjs';

const internal = 'backend/src/main/java/com/zdm/platform/inventory/SlabLogChanges.java';
const internalTest = 'backend/src/test/java/com/zdm/platform/inventory/SlabLogChangesTest.java';

test('the reviewed internal helper keeps existing API and data-scope consumers', () => {
  const plan = createBackendTestPlan([internal, internalTest]);
  assert.equal(plan.mode, 'targeted');
  assert.ok(plan.tests.includes('com.zdm.platform.inventory.*Test'));
  assert.ok(plan.tests.includes('com.zdm.platform.PlatformApiSmokeTest'));
  assert.ok(plan.tests.includes('com.zdm.platform.DataScopeApiTest'));
  assert.ok(plan.tests.includes('com.zdm.platform.PlatformModuleBoundaryTest'));
});

test('test edits cannot hide a simultaneous production dependency change', () => {
  const plan = createBackendTestPlan([
    internalTest,
    'backend/src/main/java/com/zdm/platform/inventory/SlabInventoryService.java',
  ]);
  assert.equal(plan.mode, 'full');
  assert.deepEqual(plan.tests, []);
});

test('unknown, security, contract, migration, build and shared test files fall back to full', () => {
  for (const file of [
    'backend/src/main/java/com/zdm/platform/security/DataScope.java',
    'backend/src/main/java/com/zdm/platform/auth/AuthService.java',
    'backend/src/main/java/com/zdm/platform/common/ApiResponse.java',
    'backend/src/main/java/com/zdm/platform/inventory/SlabInventoryController.java',
    'backend/src/main/resources/db/migration/V999__example.sql',
    'backend/pom.xml',
    'backend/src/test/resources/application.yml',
    'backend/src/test/java/com/zdm/platform/SupplyChainTestSession.java',
    'backend/src/test/java/com/zdm/platform/inventory/UnknownTest.java',
  ]) {
    const plan = createBackendTestPlan([internal, file]);
    assert.equal(plan.mode, 'full', file);
    assert.ok(plan.reason.includes(file));
  }
});

test('deleted known helper and concurrent dependencies cannot select a narrow suite', () => {
  assert.equal(createBackendTestPlan([internal], () => false).mode, 'full');
  assert.equal(createBackendTestPlan([internal, 'package-lock.json']).mode, 'full');
});

test('frontend-only files do not invent a backend check', () => {
  assert.equal(createBackendTestPlan(['src/example.ts']).mode, 'none');
});
