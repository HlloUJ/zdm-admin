import assert from 'node:assert/strict';
import test from 'node:test';

import { createValidationPlan } from './check-changed-plan.mjs';

const names = (plan) => plan.tasks.map((task) => task.name);

test('deleted TypeScript inputs trigger typecheck and the full unit suite', () => {
  const plan = createValidationPlan(['src/services/removed.ts'], () => false);

  assert.deepEqual(names(plan), ['source guards', 'typecheck', 'unit tests']);
  assert.deepEqual(plan.tasks.at(-1).args, ['run', 'test:unit']);
});

test('dependency changes trigger full frontend checks', () => {
  const plan = createValidationPlan(['package-lock.json']);

  assert.deepEqual(names(plan), ['frontend quality', 'frontend build']);
});

test('backend changes execute Docker backend tests', () => {
  const plan = createValidationPlan(['backend/src/main/java/example/Service.java']);

  assert.deepEqual(names(plan), ['backend tests']);
  assert.deepEqual(plan.tasks[0].args, ['run', 'backend:test']);
});

test('deleted backend files still execute backend tests', () => {
  const plan = createValidationPlan(['backend/src/main/java/example/RemovedService.java'], () => false);

  assert.deepEqual(names(plan), ['backend tests']);
  assert.deepEqual(plan.tasks[0].args, ['run', 'backend:test']);
});

test('Vue source changes select incremental frontend checks', () => {
  const plan = createValidationPlan(['src/pages/example/index.vue']);

  assert.deepEqual(names(plan), ['source guards', 'typecheck', 'eslint', 'stylelint', 'related unit tests']);
});

test('reviewed backend mapping provides an executable Maven selector and explanation', () => {
  const plan = createValidationPlan(['backend/src/main/java/com/zdm/platform/inventory/SlabLogChanges.java']);
  assert.equal(plan.backendPlan.mode, 'targeted');
  assert.equal(plan.tasks[0].reason, plan.backendPlan.reason);
  assert.deepEqual(plan.tasks[0].args.slice(0, 3), ['run', 'backend:test', '--']);
  assert.ok(plan.tasks[0].args[3].includes('PlatformApiSmokeTest'));
});

test('dependency branch retains a backend full-suite explanation', () => {
  const plan = createValidationPlan([
    'package.json',
    'backend/src/main/java/com/zdm/platform/inventory/SlabLogChanges.java',
  ]);
  assert.equal(plan.backendPlan.mode, 'full');
  assert.deepEqual(plan.tasks.at(-1).args, ['run', 'backend:test']);
  assert.ok(plan.tasks.at(-1).reason);
});

test('Node script tests use the Node suite instead of being sent to Vitest', () => {
  const plan = createValidationPlan(['scripts/verification-impact.test.mjs']);
  assert.ok(plan.tasks.some((entry) => entry.args.includes('test:scripts')));
  assert.ok(!plan.tasks.some((entry) => entry.args.includes('test:unit')));
});

test('source and test edits retain both explicit and related test consumers', () => {
  const plan = createValidationPlan(['src/example.ts', 'src/example.test.ts']);
  assert.ok(names(plan).includes('unit tests'));
  assert.ok(names(plan).includes('related unit tests'));
});

test('deleted frontend styles do not broaden the unit-test selection', () => {
  const plan = createValidationPlan(['src/removed.css'], () => false);
  assert.deepEqual(names(plan), ['source guards']);
});
