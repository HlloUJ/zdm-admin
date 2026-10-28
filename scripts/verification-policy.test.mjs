import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryCiCapability, needsContractPreflight } from './verification-policy.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { DIAGNOSTIC_FILES } from './ci-diagnostic-evidence.mjs';
import { createVerificationPlan, executeVerification } from './verify.mjs';
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

test('real verifier plus npm entry points run each diagnostic once, and light failure starts no costly work', async (t) => {
  for (const [failure, diagnosticOnly] of [
    [false, false],
    [false, true],
    [true, false],
  ]) {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'real-readiness-chain-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, '.task-verification'));
    writeFileSync(path.join(root, '.gitignore'), '.task-verification/\n');
    for (const file of [...DIAGNOSTIC_FILES, 'scripts/remaining.test.mjs'])
      writeFileSync(
        path.join(root, file),
        `import test from 'node:test';import fs from 'node:fs';test('actual case',()=>fs.appendFileSync('.task-verification/calls', ${JSON.stringify(file + '\n')}));`,
      );
    writeFileSync(
      path.join(root, 'scripts/light.mjs'),
      `import fs from 'node:fs';fs.appendFileSync('.task-verification/light','called\\n');process.exitCode=${failure ? 1 : 0};`,
    );
    writeFileSync(path.join(root, 'scripts/format.mjs'), '');
    const cli = (name) => `node ${JSON.stringify(fileURLToPath(new URL(name, import.meta.url)))}`;
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'real-entry-fixture',
        scripts: {
          'format:changed': 'node scripts/format.mjs',
          'lint:changed': 'node scripts/light.mjs',
          'test:ci-reuse': cli('./run-script-tests.mjs') + ' --diagnostic',
          'test:scripts:files': cli('./run-targeted-script-tests.mjs'),
        },
      }),
    );
    for (const args of [
      ['init', '-b', 'main'],
      ['config', 'user.name', 'Fixture'],
      ['config', 'user.email', 'fixture@example.invalid'],
      ['add', '.'],
      ['commit', '-m', 'fixture'],
      ['update-ref', 'refs/remotes/origin/main', 'HEAD'],
    ])
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    const env = { PATH: process.env.PATH, HOME: os.homedir(), LANG: 'en_US.UTF-8' };
    const plan = createVerificationPlan({
      root,
      env,
      affected: true,
      ciCapability: { verified: true },
      files: [diagnosticOnly ? DIAGNOSTIC_FILES[0] : 'scripts/remaining.test.mjs'],
    });
    assert.equal(plan.earlyChecks.length, 1);
    assert.ok(!plan.frontend.some((task) => task.args.includes('lint:changed')));
    const result = await executeVerification(plan, { report: () => {} });
    assert.equal(result, failure ? 1 : 0);
    assert.equal(readFileSync(path.join(root, '.task-verification/light'), 'utf8'), 'called\n');
    const calls = path.join(root, '.task-verification/calls');
    if (failure) assert.equal(existsSync(calls), false, 'diagnostics and targeted consumers must not start');
    else {
      const executed = readFileSync(calls, 'utf8').trim().split('\n');
      assert.equal(executed.length, DIAGNOSTIC_FILES.length + (diagnosticOnly ? 0 : 1));
      assert.equal(
        new Set(executed).size,
        executed.length,
        'no diagnostic may execute twice through real entry points',
      );
      assert.deepEqual(
        executed.sort(),
        [...DIAGNOSTIC_FILES, ...(diagnosticOnly ? [] : ['scripts/remaining.test.mjs'])].sort(),
      );
    }
    // Exercise the actual CI light-check CLI with its independently checked scope identity.
    const ciEnv = { ...env, CI_EVIDENCE_DIR: path.join(root, '.task-verification') };
    const scopeResult = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./ci-quality-evidence.mjs', import.meta.url)), 'scope'],
      { cwd: root, env: ciEnv, encoding: 'utf8' },
    );
    assert.equal(scopeResult.status, 0, scopeResult.stdout + scopeResult.stderr);
    const lightResult = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./ci-light-checks.mjs', import.meta.url))],
      { cwd: root, env: ciEnv, encoding: 'utf8' },
    );
    assert.equal(lightResult.status, failure ? 1 : 0, lightResult.stdout + lightResult.stderr);
    const scopeFile = path.join(root, '.task-verification/scope.json');
    const scope = JSON.parse(readFileSync(scopeFile));
    scope.identity.candidateSha = 'wrong';
    writeFileSync(scopeFile, JSON.stringify(scope));
    const badScope = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-light-checks.mjs', import.meta.url))], {
      cwd: root,
      env: ciEnv,
      encoding: 'utf8',
    });
    assert.equal(badScope.status, 1);
    assert.match(badScope.stderr, /different candidateSha/);
  }
});
