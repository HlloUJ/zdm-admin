import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryCiCapability, needsContractPreflight } from './verification-policy.mjs';
import { createVerificationPlan } from './verify.mjs';
test('live active workflow and enforced strict required checks are all necessary for CI-backed readiness', () => {
  const state = { strict: true, active: true, admins: true };
  const execute = (_command, args) =>
    JSON.stringify(
      args[0] === 'repo'
        ? { nameWithOwner: 'owner/repo' }
        : args[1].endsWith('protection')
          ? {
              enforce_admins: { enabled: state.admins },
              required_status_checks: { strict: state.strict, contexts: ['Frontend quality', 'Backend quality'] },
            }
          : { id: 1, state: state.active ? 'active' : 'disabled', path: '.github/workflows/quality.yml' },
    );
  assert.equal(deliveryCiCapability('.', execute).verified, true);
  for (const key of Object.keys(state)) {
    state[key] = false;
    assert.equal(deliveryCiCapability('.', execute).verified, false);
    state[key] = true;
  }
  assert.equal(
    deliveryCiCapability('.', () => {
      throw Error('unavailable');
    }).verified,
    false,
  );
});
test('completion, shard, reporter, manifest and runtime tools all require early contract diagnostics', () => {
  for (const file of [
    'scripts/completion-process.mjs',
    'scripts/e2e-shards.mjs',
    'scripts/playwright-evidence-reporter.mjs',
    'ci/e2e-app.json',
    'vite.e2e.config.mjs',
    '.codex/zdm-project-workflow.yaml',
  ])
    assert.equal(needsContractPreflight([file]), true, file);
  assert.equal(needsContractPreflight(['src/pages/example.vue']), false);
});
test('proven CI keeps complete required domains while local readiness does not repeat expensive pipelines', () => {
  const options = {
    root: process.cwd(),
    affected: true,
    files: ['scripts/completion-process.mjs', 'vite.e2e.config.mjs'],
  };
  const local = createVerificationPlan({ ...options, ciCapability: { verified: true } });
  assert.equal(local.deferredToCi.full, true);
  assert.ok(local.deferredToCi.frontend && local.deferredToCi.backend && local.deferredToCi.engineering);
  assert.ok(local.contractPreflight);
  assert.deepEqual(local.backend, []);
  assert.deepEqual(local.engineering, []);
  assert.ok(
    !local.frontend.some((t) => t.args.some((a) => ['verify:local', 'test:e2e', 'test:engineering'].includes(a))),
  );
  const fallback = createVerificationPlan({ ...options, ciCapability: { verified: false } });
  assert.ok(fallback.backend.some((t) => t.args.includes('backend:test')));
  assert.ok(fallback.frontend.some((t) => t.args.includes('test:e2e')));
  assert.ok(fallback.engineering.length);
});

test('production permissions, API, migrations and runtime changes retain original local risk gates despite available CI', () => {
  for (const file of [
    'src/services/auth.ts',
    'src/router/index.ts',
    'src/pages/permission/Role.vue',
    'backend/src/main/resources/db/migration/V1.sql',
    'backend/src/main/java/example/Service.java',
    'scripts/dev-task.mjs',
  ]) {
    const plan = createVerificationPlan({
      root: process.cwd(),
      affected: true,
      files: [file],
      ciCapability: { verified: true },
    });
    assert.equal(plan.deferredToCi, undefined, file);
    assert.ok(plan.backend.length || plan.frontend.length, file);
  }
});

test('unavailable CI forces the original complete local fallback even for an ordinary frontend change', () => {
  const plan = createVerificationPlan({
    root: process.cwd(),
    affected: true,
    files: ['src/pages/example.vue'],
    ciCapability: { verified: false },
  });
  assert.equal(plan.ciFallback, true);
  assert.equal(plan.affected, false);
  assert.ok(plan.contractPreflight);
  assert.ok(plan.backend.some((t) => t.args.includes('backend:test')));
  assert.ok(plan.frontend.some((t) => t.args.includes('test:e2e')));
  assert.ok(plan.engineering.length);
});
