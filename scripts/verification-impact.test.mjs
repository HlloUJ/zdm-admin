import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChangedFiles } from './verification-impact.mjs';

const flags = (files) => {
  const { reasons, ...scope } = classifyChangedFiles(files, { engineeringProof: { proven: true } });
  assert.ok(reasons.length);
  return scope;
};
test('only known documents/assets omit both domains', () => {
  assert.deepEqual(flags(['README.md', 'docs/plan.md', 'docs/architecture.svg']), {
    frontend: false,
    backend: false,
    engineering: false,
    docsOnly: true,
    full: false,
    runtime: false,
  });
  assert.equal(flags(['docs/rebuild.sh']).full, true);
});
test('business frontend stays frontend-only without runtime recovery', () => {
  assert.deepEqual(flags(['src/pages/slab/index.vue', 'tests/e2e/slab.spec.ts', 'docs/plan.md']), {
    frontend: true,
    backend: false,
    engineering: false,
    docsOnly: false,
    full: false,
    runtime: false,
  });
});
test('backend internals select the backend domain and runtime', () => {
  assert.deepEqual(flags(['backend/src/main/java/com/zdm/platform/inventory/SlabLogChanges.java']), {
    frontend: false,
    backend: true,
    engineering: false,
    docsOnly: false,
    full: false,
    runtime: true,
  });
});
test('permissions and shared frontend contracts expand both domains without starting a backend', () => {
  for (const file of [
    'src/services/finishedProducts.ts',
    'src/pages/permissions/index.vue',
    'tests/e2e/admin-api-mocks.ts',
    'src/shared/value.ts',
  ]) {
    const scope = flags([file]);
    assert.equal(scope.full, true, file);
    assert.equal(scope.runtime, false, file);
  }
});
test('API, auth, migrations and backend runtime paths require both domains and runtime', () => {
  for (const file of [
    'backend/src/main/java/com/zdm/platform/inventory/ProductController.java',
    'backend/src/main/java/com/zdm/platform/security/DataScope.java',
    'backend/src/main/resources/db/migration/V999__test.sql',
    'backend/pom.xml',
    'backend/src/main/java/com/zdm/platform/config/WebConfig.java',
    'backend/src/main/java/com/zdm/platform/PlatformApplication.java',
    'docker-compose.yml',
    'scripts/backend-runtime.mjs',
  ]) {
    const scope = flags([file]);
    assert.equal(scope.full, true, file);
    assert.equal(scope.runtime, true, file);
  }
});
test('dependencies, CI, validation tooling, configuration and unknown files never narrow checks', () => {
  for (const file of [
    'package.json',
    'package-lock.json',
    '.github/workflows/quality.yml',
    'scripts/verification-impact.mjs',
    'playwright.config.ts',
    'new-tool/unknown.bin',
  ]) {
    const scope = flags([file]);
    assert.equal(scope.frontend, true, file);
    assert.equal(scope.backend, true, file);
    assert.equal(scope.full, true, file);
  }
});
test('mixed files union scopes; empty/invalid input fails closed', () => {
  const mixed = flags(['src/example.vue', 'backend/src/test/java/com/zdm/platform/inventory/ExampleTest.java']);
  assert.equal(mixed.frontend, true);
  assert.equal(mixed.backend, true);
  assert.equal(mixed.runtime, false);
  for (const files of [[], ['/outside/project'], ['../outside'], [null]]) assert.equal(flags(files).full, true);
});

test('backend test-only edits never imply changing the task preview runtime', () => {
  const scope = flags(['backend/src/test/java/com/zdm/platform/inventory/ExampleTest.java']);
  assert.equal(scope.backend, true);
  assert.equal(scope.frontend, false);
  assert.equal(scope.runtime, false);
  assert.equal(flags(['backend/src/test/resources/application.yml']).runtime, false);
});

test('verification helpers and their tests are full scope without runtime startup', () => {
  for (const file of [
    'scripts/backend-test-evidence.mjs',
    'scripts/backend-test-evidence.test.mjs',
    'scripts/backend-test-plan.mjs',
    'scripts/backend-test-plan.test.mjs',
    'scripts/backend-runtime.test.mjs',
    'scripts/dev-task.test.mjs',
    'scripts/task-preview-service.test.mjs',
    'scripts/dev-status.mjs',
    'scripts/dev-unknown.mjs',
    'scripts/backend-unknown.mjs',
    '.codex/unknown-config.json',
  ]) {
    const scope = flags([file]);
    assert.equal(scope.full, true, file);
    assert.equal(scope.runtime, false, file);
  }
});

test('known runtime launch and routing scripts retain runtime checks', () => {
  for (const file of [
    'scripts/dev-task.mjs',
    'scripts/backend-runtime.mjs',
    'scripts/ensure-backend.mjs',
    'scripts/task-preview-service.mjs',
    'scripts/macos/launchd-dev.mjs',
    '.codex/zdm-project-workflow.yaml',
  ]) {
    const scope = flags([file]);
    assert.equal(scope.full, true, file);
    assert.equal(scope.runtime, true, file);
  }
});

test('unreviewed engineering readers require engineering checks even for ordinary business edits', () => {
  assert.equal(classifyChangedFiles(['src/page.vue']).engineering, true);
  assert.equal(flags(['src/page.vue']).engineering, false);
});
test('root Maven and environment inputs are runtime while dependency helpers are not', () => {
  for (const file of ['pom.xml', '.env', '.env.local', '.mvn/maven.config', 'scripts/task-runtime-state.mjs'])
    assert.equal(flags([file]).runtime, true, file);
  for (const file of [
    'scripts/task-runtime-state.test.mjs',
    'scripts/task-dependencies.mjs',
    'scripts/task-dependencies.test.mjs',
  ])
    assert.equal(flags([file]).runtime, false, file);
});
