import assert from 'node:assert/strict';
import test from 'node:test';

import { createValidationPlan } from './check-changed-plan.mjs';

const names = (plan) => plan.tasks.map((task) => task.name);

test('deleted TypeScript files still trigger typecheck', () => {
  const plan = createValidationPlan(['src/services/removed.ts'], () => false);

  assert.deepEqual(names(plan), ['typecheck']);
});

test('dependency changes trigger full frontend checks', () => {
  const plan = createValidationPlan(['package-lock.json']);

  assert.deepEqual(names(plan), ['frontend quality', 'frontend build']);
});

test('backend changes execute Docker backend tests', () => {
  const plan = createValidationPlan(['backend/src/main/java/example/Service.java']);

  assert.deepEqual(names(plan), ['backend tests']);
});

test('Vue source changes select incremental frontend checks', () => {
  const plan = createValidationPlan(['src/pages/example/index.vue']);

  assert.deepEqual(names(plan), ['typecheck', 'eslint', 'stylelint', 'related unit tests']);
});
