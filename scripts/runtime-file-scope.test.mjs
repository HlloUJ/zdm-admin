import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isRuntimeFile } from './runtime-file-scope.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';
import { integrationSourceIdentity } from './integration-handoff-state.mjs';
import { PREVIEW_RUNTIME_MODULES } from './task-preview-service.mjs';

const runtime = [
  'backend/src/main/java/com/zdm/platform/inventory/ProductController.java',
  'backend/src/main/resources/db/migration/V999__test.sql',
  'backend/pom.xml',
  'docker-compose.yml',
  'Dockerfile',
  'compose.test.yml',
  '.env',
  '.env.local',
  'pom.xml',
  '.mvn/jvm.config',
  '.codex/zdm-project-workflow.yaml',
  'scripts/backend-runtime.mjs',
  'scripts/task-runtime-state.mjs',
  'scripts/dev-all.mjs',
  'scripts/dev-task.mjs',
  'scripts/ensure-backend.mjs',
  'scripts/run-integration.mjs',
  'scripts/sync-integration.mjs',
  'scripts/delivery-launcher.mjs',
  'scripts/integration-handoff-state.mjs',
  'scripts/task-preview-service.mjs',
  'scripts/task-preview-control.mjs',
  'scripts/task-preview-independent.mjs',
  'scripts/macos/launchd-dev.mjs',
  'scripts/macos/启动装点猫.command',
  'scripts/macos/停止装点猫.command',
  'scripts/macos/com.zdm.admin.dev.plist',
];
const nonRuntime = [
  'backend/src/test/java/Test.java',
  'backend/src/test/resources/test.yml',
  'backend/README.md',
  'src/services/productStateActivity.ts',
  'tests/e2e/product-state-activity.spec.ts',
  'package-lock.json',
  'scripts/business-regression.mjs',
  'scripts/runtime-file-scope.mjs',
  'unknown.bin',
  '../backend/pom.xml',
  '/backend/pom.xml',
  'C:\\backend\\pom.xml',
  '',
  null,
];
test('pure runtime policy preserves registered runtime inputs, normalization and all exclusions', () => {
  for (const file of runtime) {
    assert.equal(isRuntimeFile(file), true, file);
    assert.equal(isRuntimeFile('./' + file), true, file);
    assert.equal(isRuntimeFile(file.replaceAll('/', '\\')), true, file);
  }
  for (const file of nonRuntime) assert.equal(isRuntimeFile(file), false, String(file));
});
test('every tracked path keeps full-gate runtime classification while unknowns still select full gates', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tree = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  assert.equal(tree.status, 0);
  const files = [...new Set([...tree.stdout.split('\0').filter(Boolean), ...runtime, ...nonRuntime])];
  for (const file of files)
    assert.equal(isRuntimeFile(file), classifyChangedFiles([file], { root }).runtime, String(file));
  for (const file of ['unknown.bin', '../backend/pom.xml', 'scripts/business-regression.mjs']) {
    const scope = classifyChangedFiles([file], { root });
    assert.equal(scope.full, true);
    assert.equal(scope.frontend && scope.backend && scope.engineering, true);
  }
});
test('large real runtime fingerprints cannot load repository business scanning at all', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-no-scan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, 'scripts/business-regression-contracts.json'), 'invalid contract must not be read');
  const script = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    let scans = 0;
    registerHooks({ resolve(specifier, context, next) {
      if (/business-regression|verification-impact/.test(specifier)) { scans++; throw Error('Repeated business scan'); }
      return next(specifier, context);
    }});
    const { integrationSourceIdentity } = await import(${JSON.stringify(new URL('./integration-handoff-state.mjs', import.meta.url).href)});
    const entries = Array.from({length: 2000}, (_, i) => '100644 blob ' + 'a'.repeat(40) + '\\tbackend/src/main/java/F' + i + '.java');
    assert.match(integrationSourceIdentity(${JSON.stringify(root)}, entries.join('\\0')), /^[a-f0-9]{64}$/);
    assert.equal(scans, 0);
    console.log('2000 paths; zero business scan dependencies');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /zero business scan dependencies/);
});
test('runtime input changes still invalidate fingerprints; frontend-only tree changes do not', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-input-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'backend/src/main'), { recursive: true });
  const main = path.join(root, 'backend/src/main/Main.java');
  writeFileSync(main, 'old source');
  const tree = '100644 blob ' + 'a'.repeat(40) + '\tbackend/pom.xml';
  const first = integrationSourceIdentity(root, tree);
  assert.equal(
    integrationSourceIdentity(root, tree + '\0' + '100644 blob ' + 'b'.repeat(40) + '\tsrc/page.vue'),
    first,
  );
  assert.notEqual(integrationSourceIdentity(root, tree.replace('a'.repeat(40), 'b'.repeat(40))), first);
  writeFileSync(main, 'new source');
  assert.notEqual(integrationSourceIdentity(root, tree), first);
});

test('actual backend startup and watcher scope never reads a legacy task business-test contract', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-legacy-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, 'scripts/business-regression-contracts.json'), 'invalid contract must not be read');
  const script = `
    import assert from 'node:assert/strict';
    import { backendSensitiveFiles } from ${JSON.stringify(new URL('./dev-task.mjs', import.meta.url).href)};
    assert.deepEqual(backendSensitiveFiles(${JSON.stringify([...runtime, ...nonRuntime])}), ${JSON.stringify(runtime)});
    console.log('startup and watcher scope preserve runtime inputs without reading business contracts');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /without reading business contracts/);
  assert.throws(() => classifyChangedFiles(['backend/pom.xml'], { root }), /JSON|Unexpected token/);
});

test('installed preview service copies its complete native module dependency closure', () => {
  const available = new Set(['task-preview-service.mjs', ...PREVIEW_RUNTIME_MODULES]);
  assert.equal(available.size, PREVIEW_RUNTIME_MODULES.length + 1);
  for (const name of available) {
    assert.equal(path.basename(name), name);
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]/g)) {
      const dependency = match[1] ?? match[2];
      assert.ok(available.has(dependency.replace(/^\.\//, '')), `${name} requires uncopied ${dependency}`);
    }
  }
  assert.ok(available.has('integration-resource.mjs'));
});
