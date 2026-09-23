import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureIdentity, captureArtifacts, captureSource } from './verification-evidence.mjs';
import { runVerificationTask } from './verification-runner.mjs';
import { collectDeliveryChanges, createVerificationPlan, executeVerification } from './verify.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-verification-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'verification@example.invalid');
  git('config', 'user.name', 'Verification fixture');
  writeFileSync(path.join(root, '.gitignore'), '.task-verification/\nnode_modules/\nbackend/target/\ndist/\n.env\n');
  writeFileSync(path.join(root, 'source.js'), 'export const value = 1;\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  git('add', '.');
  git('commit', '-m', 'fixture', '--no-verify');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, git };
}
const silent = { report() {} };
function task(root, script = 'console.log("fixture passed")') {
  return {
    root,
    name: 'fixture',
    command: process.execPath,
    args: ['-e', script],
    env: { PATH: process.env.PATH, HOME: os.homedir() },
  };
}
function record(result) {
  return JSON.parse(readFileSync(result.evidence, 'utf8'));
}

test('matching evidence reuses success, but force and CI always execute', async (t) => {
  const { root } = fixture(t);
  const step = task(root);
  const first = await runVerificationTask(step, silent);
  assert.equal(first.exitCode, 0);
  assert.equal(record(first).status, 'passed');
  assert.equal((await runVerificationTask(step, silent)).reused, true);
  assert.equal((await runVerificationTask(step, { ...silent, force: true })).reused, false);
  assert.equal((await runVerificationTask({ ...step, env: { ...step.env, CI: 'true' } }, silent)).reused, false);
});

test('source content, deletion, untracked files, lockfile, installed dependency, and ignored env invalidate', async (t) => {
  const { root } = fixture(t);
  const step = task(root);
  const changes = [
    () => writeFileSync(path.join(root, 'source.js'), 'export const value = 2;\n'),
    () => rmSync(path.join(root, 'source.js')),
    () => writeFileSync(path.join(root, 'new.js'), 'new input'),
    () => writeFileSync(path.join(root, 'package-lock.json'), '{"changed":true}\n'),
    () => {
      mkdirSync(path.join(root, 'node_modules/dependency'), { recursive: true });
      writeFileSync(path.join(root, 'node_modules/dependency/index.js'), 'changed dependency');
    },
    () => writeFileSync(path.join(root, '.env'), 'VALUE=changed\n'),
  ];
  await runVerificationTask(step, silent);
  for (const change of changes) {
    change();
    const result = await runVerificationTask(step, silent);
    assert.equal(result.exitCode, 0);
    assert.equal(result.reused, false);
    assert.equal((await runVerificationTask(step, silent)).reused, true);
  }
});

test('environment, coverage, command, candidate and baseline changes do not reuse', async (t) => {
  const { root, git } = fixture(t);
  const step = task(root);
  await runVerificationTask(step, silent);
  assert.equal(
    (await runVerificationTask({ ...step, env: { ...step.env, CUSTOM_SETTING: 'changed' } }, silent)).reused,
    false,
  );
  assert.equal((await runVerificationTask({ ...step, coverage: ['different tests'] }, silent)).reused, false);
  assert.equal((await runVerificationTask(task(root, 'console.log("different command")'), silent)).reused, false);
  const before = captureIdentity(step);
  git('commit', '--allow-empty', '-m', 'new main', '--no-verify');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.notEqual(captureIdentity(step).fingerprint, before.fingerprint);
  assert.equal((await runVerificationTask(step, silent)).reused, false);
});

test('shell timing wrappers preserve evidence, but business environment still invalidates it', async (t) => {
  const { root } = fixture(t);
  const step = task(root);
  await runVerificationTask({ ...step, env: { ...step.env, SHLVL: '2', _: '/bin/sh' } }, silent);
  assert.equal(
    (await runVerificationTask({ ...step, env: { ...step.env, SHLVL: '3', _: '/usr/bin/time' } }, silent)).reused,
    true,
  );
  assert.equal(
    (await runVerificationTask({ ...step, env: { ...step.env, FEATURE_FLAG: 'different' } }, silent)).reused,
    false,
  );
});

test('cheap full-gate checks do not scan dependencies to cache subsecond work', () => {
  const plan = createVerificationPlan({ root: '/fixture' });
  assert.equal(plan.preflight.reuse, false);
  assert.equal(plan.frontend.find((step) => step.name === 'frontend build').reuse, false);
});

test('a candidate changed after impact planning cannot run the older narrower plan', async (t) => {
  const { root } = fixture(t);
  const plan = createVerificationPlan({
    root,
    affected: true,
    files: ['README.md'],
    plannedCandidate: captureSource(root),
  });
  writeFileSync(path.join(root, 'backend-change.java'), 'new backend input');
  let invoked = false;
  const result = await executeVerification(plan, {
    ...silent,
    run: async () => {
      invoked = true;
      return { exitCode: 0 };
    },
  });
  assert.equal(result, 1);
  assert.equal(invoked, false);
});

test('a same-content commit preserves candidate evidence on an unchanged baseline', async (t) => {
  const { root, git } = fixture(t);
  const step = task(root);
  writeFileSync(path.join(root, 'source.js'), 'export const value = 3;\n');
  await runVerificationTask(step, silent);
  git('add', 'source.js');
  git('commit', '-m', 'candidate', '--no-verify');
  assert.equal((await runVerificationTask(step, silent)).reused, true);
});

test('failure, unfinished or damaged evidence and modified logs cannot grant success', async (t) => {
  const { root } = fixture(t);
  const failed = await runVerificationTask(task(root, 'process.exit(7)'), silent);
  assert.equal(failed.exitCode, 7);
  assert.equal(record(failed).status, 'failed');
  assert.equal((await runVerificationTask(task(root, 'process.exit(7)'), silent)).reused, false);
  const step = task(root);
  let result = await runVerificationTask(step, silent);
  for (const patch of [
    { status: 'running' },
    { exitCode: 1 },
    { completedAt: null },
    { identity: {} },
    { artifacts: 'wrong' },
  ]) {
    writeFileSync(result.evidence, JSON.stringify({ ...record(result), ...patch }));
    result = await runVerificationTask(step, silent);
    assert.equal(result.reused, false);
  }
  writeFileSync(result.evidence, '{broken');
  result = await runVerificationTask(step, silent);
  assert.equal(result.reused, false);
  writeFileSync(path.join(root, record(result).log), 'tampered');
  assert.equal((await runVerificationTask(step, silent)).reused, false);
});

test('code edited during a successful command invalidates that run', async (t) => {
  const { root } = fixture(t);
  const result = await runVerificationTask(
    task(root, 'require("fs").writeFileSync("source.js", "modified while testing")'),
    silent,
  );
  assert.equal(result.exitCode, 1);
  assert.match(record(result).reason, /changed during/);
});

test('same-task concurrent runs are blocked and locks are released', async (t) => {
  const { root } = fixture(t);
  const step = task(root, 'setTimeout(() => console.log("passed"), 100)');
  const [first, second] = await Promise.all([runVerificationTask(step, silent), runVerificationTask(step, silent)]);
  assert.deepEqual([first.exitCode, second.exitCode], [0, 1]);
  assert.equal((await runVerificationTask(step, silent)).reused, true);
  assert.equal(
    readdirSync(path.join(root, '.task-verification')).some((file) => file.endsWith('.lock')),
    false,
  );
});

test('build and backend artifacts are required for reuse; runtime and browser results always run', async (t) => {
  const { root } = fixture(t);
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist/app.js'), 'built');
  const step = { ...task(root), artifacts: ['dist'] };
  await runVerificationTask(step, silent);
  rmSync(path.join(root, 'dist'), { recursive: true });
  assert.equal((await runVerificationTask(step, silent)).reused, false);
  for (const kind of ['runtime', 'browser']) {
    const run = { ...task(root), kind };
    await runVerificationTask(run, silent);
    assert.equal((await runVerificationTask(run, silent)).reused, false);
  }
});

test('backend evidence is shared from development to full verification only with matching environment and target artifacts', async (t) => {
  const { root } = fixture(t);
  for (const name of ['classes', 'test-classes', 'surefire-reports'])
    mkdirSync(path.join(root, 'backend/target', name), { recursive: true });
  writeFileSync(path.join(root, 'backend/target/jacoco.exec'), 'coverage');
  writeFileSync(path.join(root, 'backend/target/classes/Test.class'), 'compiled');
  let image = 'immutable-image-1';
  const inspect = (step) => {
    const snapshot = captureIdentity({ ...step, kind: 'node' });
    snapshot.identity.environment.docker = { image };
    // This test supplies the isolated Docker probe; the production probe reads engine, images and Maven bytes.
    const { identity } = snapshot;
    return { ...snapshot, identity, fingerprint: createFingerprint(identity) };
  };
  const options = { ...silent, captureIdentity: inspect, captureArtifacts };
  const development = { ...task(root), name: 'backend tests', kind: 'backend' };
  const first = await runVerificationTask(development, options);
  assert.equal(first.exitCode, 0);
  assert.equal((await runVerificationTask({ ...development }, options)).reused, true);
  image = 'immutable-image-2';
  assert.equal((await runVerificationTask(development, options)).reused, false);
  rmSync(path.join(root, 'backend/target/classes/Test.class'));
  assert.equal((await runVerificationTask(development, options)).reused, false);
});

function createFingerprint(identity) {
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

test('list mode is read-only and does not inspect Docker or create evidence', (t) => {
  const { root } = fixture(t);
  const entry = fileURLToPath(new URL('./verify.mjs', import.meta.url));
  const before = readdirSync(root);
  const result = spawnSync(process.execPath, [entry, '--list', '--browser', 'chrome'], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /backend:test/);
  assert.deepEqual(readdirSync(root), before);
});

test('format failure stops early; runtime is sequential; two pipelines preserve test-before-static dependency', async (t) => {
  const { root } = fixture(t);
  const plan = createVerificationPlan({ root, runtime: true });
  const calls = [];
  assert.equal(
    await executeVerification(plan, {
      ...silent,
      run: async (step) => {
        calls.push(step.name);
        return { exitCode: 1 };
      },
    }),
    1,
  );
  assert.deepEqual(calls, ['format check']);
  calls.length = 0;
  const code = await executeVerification(plan, {
    ...silent,
    run: async (step) => {
      calls.push(step.name);
      return { exitCode: step.name === 'backend tests' ? 1 : 0 };
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(calls.slice(0, 2), ['format check', 'task runtime identity']);
  assert.equal(calls.includes('backend static quality'), false);
  assert.equal(calls.includes('browser tests'), true);
});

test('docs and frontend delivery plans avoid unrelated backend checks and real runtime startup', async (t) => {
  const { root } = fixture(t);
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs/guide.md'), '# Documentation\n');
  const changes = collectDeliveryChanges(root);
  assert.deepEqual(changes.files, ['docs/guide.md']);
  const docs = createVerificationPlan({ root, affected: true, ...changes });
  assert.equal(docs.runtime, null);
  assert.deepEqual(docs.frontend, []);
  assert.deepEqual(docs.backend, []);
  assert.ok(docs.preflight.args.includes('format:changed'));
  const front = createVerificationPlan({ root, affected: true, files: ['src/views/ExampleView.vue'] });
  assert.equal(front.runtime, null);
  assert.deepEqual(front.backend, []);
  assert.ok(front.frontend.some((entry) => entry.args.includes('build:app')));
  assert.equal(createVerificationPlan({ root }).runtime, null);
});

test('delivery diff includes committed changes, deleted paths and untracked files', (t) => {
  const { root, git } = fixture(t);
  writeFileSync(path.join(root, 'README.md'), '# changed\n');
  git('add', 'README.md');
  git('commit', '-m', 'docs', '--no-verify');
  rmSync(path.join(root, 'source.js'));
  writeFileSync(path.join(root, 'new.md'), '# New\n');
  assert.deepEqual(collectDeliveryChanges(root).files, ['README.md', 'new.md', 'source.js']);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  assert.equal(collectDeliveryChanges(root).impact.full, true);
});

test('changes between stages fail the whole gate even when every stage passes', async (t) => {
  const { root } = fixture(t);
  const plan = createVerificationPlan({ root });
  let captures = 0;
  assert.equal(
    await executeVerification(plan, {
      ...silent,
      run: async () => ({ exitCode: 0 }),
      capture: () => ({ ...captureSource(root), digest: String(captures++) }),
    }),
    1,
  );
});

test('unavailable cache identity falls back to execution without reusable evidence', async (t) => {
  const { root } = fixture(t);
  const result = await runVerificationTask(task(root), {
    ...silent,
    captureIdentity() {
      throw new Error('probe failed');
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(record(result).status, 'not-reusable');
});

test('different backend commands cannot concurrently overwrite the same target artifacts', async (t) => {
  const { root } = fixture(t);
  const first = { ...task(root, 'setTimeout(() => {}, 100)'), kind: 'backend', reuse: false };
  const second = { ...task(root, 'console.log("other backend command")'), kind: 'backend', reuse: false };
  const results = await Promise.all([runVerificationTask(first, silent), runVerificationTask(second, silent)]);
  assert.deepEqual(
    results.map((entry) => entry.exitCode),
    [0, 1],
  );
});
