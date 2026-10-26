import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { completionCommand, verifyPreservation } from './completion-cli.mjs';
import { preserveAssets } from './task-completion.mjs';
import {
  registerBatch,
  upsertBatchModule,
  recordBatchCheckpoint,
  setBatchModuleStatus,
  readActiveBatch,
} from './task-batch.mjs';
function fixture(t, scenario = 'normal') {
  const original = process.cwd(),
    dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'completion-cli-'))),
    anchor = path.join(dir, 'main'),
    task = path.join(dir, 'task'),
    integration = path.join(dir, 'integration'),
    preview = path.join(dir, 'preview-current'),
    remote = path.join(dir, 'origin.git');
  mkdirSync(anchor);
  t.after(() => {
    process.chdir(original);
    rmSync(dir, { recursive: true, force: true });
  });
  const exec = (root, command, args) => {
      const r = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    },
    git = (root, ...a) => exec(root, 'git', a);
  git(anchor, 'init', '--initial-branch=main');
  git(anchor, 'config', 'user.email', 'fixture@example.invalid');
  git(anchor, 'config', 'user.name', 'Fixture');
  git(dir, 'init', '--bare', remote);
  git(anchor, 'remote', 'add', 'origin', remote);
  writeFileSync(path.join(anchor, '.gitignore'), '.task-verification/\n.env\nbackups/\n');
  git(anchor, 'add', '.gitignore');
  git(anchor, 'commit', '--no-verify', '-m', 'baseline');
  git(anchor, 'push', '-u', 'origin', 'main');
  git(anchor, 'worktree', 'add', '-b', 'codex/task', task);
  git(anchor, 'worktree', 'add', '-b', 'codex/integration-current', integration);
  git(anchor, 'worktree', 'add', '-b', 'codex/preview-current', preview);
  registerBatch(task, { id: 'example', kind: 'infrastructure' });
  upsertBatchModule(task, { id: 'module', title: 'Fixture' });
  writeFileSync(path.join(task, 'change.txt'), 'approved');
  git(task, 'add', 'change.txt');
  git(task, 'commit', '--no-verify', '-m', 'change');
  const head = git(task, 'rev-parse', 'HEAD');
  recordBatchCheckpoint(task, { moduleId: 'module', commit: head, verification: 'fixture' });
  setBatchModuleStatus(task, 'module', 'ready');
  git(task, 'push', '-u', 'origin', 'codex/task');
  git(anchor, 'merge', '--no-ff', '--no-verify', 'codex/task', '-m', 'merge');
  git(anchor, 'push', 'origin', 'main');
  git(integration, 'push', '-u', 'origin', 'codex/integration-current');
  if (!scenario.startsWith('handoff')) {
    git(integration, 'merge', '--ff-only', 'main');
    git(integration, 'push', 'origin', 'codex/integration-current');
    git(preview, 'merge', '--ff-only', 'main');
  }
  const main = git(anchor, 'rev-parse', 'HEAD'),
    common = path.join(anchor, '.git');
  mkdirSync(path.join(common, 'preview-environment'));
  const profile = { status: 'ready' };
  writeFileSync(
    path.join(common, 'preview-environment/environment.json'),
    JSON.stringify({ version: 1, repository: common, profile }),
  );
  mkdirSync(path.join(task, '.task-verification'));
  writeFileSync(path.join(task, '.task-verification/result.log'), 'diagnostic');
  const ci = {
    runId: '42',
    headSha: main,
    eventName: 'push',
    branch: 'main',
    attempt: 1,
    conclusion: 'success',
    jobs: ['Frontend quality', 'Backend quality'].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
  };
  let downloads = 0,
    checks = 0,
    deleteFailed = false;
  const execute = (root, command, args) => {
    if (command === 'gh') {
      if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'fixture/repo' });
      if (args[0] === 'api')
        return JSON.stringify({
          head_sha: main,
          run_attempt: scenario === 'rerun' ? 2 : 1,
          conclusion: 'success',
          status: 'completed',
          path: '.github/workflows/quality.yml',
          event: 'push',
          head_branch: 'main',
        });
      if (args[0] === 'run') {
        downloads++;
        const dest = args.at(-1);
        writeFileSync(path.join(dest, 'payload.json'), 'verified');
        return '';
      }
      throw Error('Unexpected gh');
    }
    if (scenario === 'delete-failure' && args[0] === 'push' && args.includes('--delete') && !deleteFailed) {
      deleteFailed = true;
      throw Error('transport interruption');
    }
    return exec(root, command, args);
  };
  const options = {
    preserveAssets,
    execute,
    waitQuality: async () => ci,
    runtimeSnapshot: () => ({
      integrationHead: main,
      worktreeClean: true,
      sourceIdentity: 's',
      configurationIdentity: 'c',
      containerIdentity: scenario === 'bad-runtime' ? null : 'i',
    }),
    runtimeProof: () => ({
      version: 1,
      status: 'passed',
      integrationHead: main,
      taskHead: head,
      sourceIdentity: 's',
      configurationIdentity: 'c',
      containerIdentity: 'i',
    }),
    checkRuntime: async () => ({
      runtimeHealthy: true,
      backupRetained: true,
      profileFingerprint: createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
    }),
    verifyEvidence: (_root, evidence) => {
      checks++;
      assert.equal(readFileSync(path.join(evidence, 'payload.json'), 'utf8'), 'verified');
      return { testFixtureOnly: true };
    },
  };
  return {
    anchor,
    task,
    main,
    common,
    integration,
    preview,
    head,
    git,
    options,
    ci,
    downloads: () => downloads,
    checks: () => checks,
  };
}
async function prepare(f) {
  await completionCommand(f.task, ['wait', '42', f.main], f.options);
  await completionCommand(f.task, ['begin'], f.options);
}
test('real local Git closure keeps main/integration/preview and assets, then returns historical receipt without repeating CI', async (t) => {
  const f = fixture(t);
  await prepare(f);
  const result = await completionCommand(f.task, ['settle', 'example', f.main, '42'], f.options);
  assert.equal(result.results.cleanup.result.worktreeRemoved, true);
  assert.equal(existsSync(f.task), false);
  assert.equal(readActiveBatch(f.anchor), null);
  assert.equal(f.downloads(), 1);
  assert.equal(f.checks(), 1);
  const again = await completionCommand(f.anchor, ['settle', 'example', f.main, '42'], f.options);
  assert.equal(again.alreadyClosed, true);
  assert.equal(f.downloads(), 1);
  assert.ok(existsSync(path.join(f.common, 'task-assets/example')));
});
for (const scenario of ['bad-runtime', 'rerun'])
  test(`real closure refuses ${scenario} before removing task or closing registry`, async (t) => {
    const f = fixture(t, scenario);
    await prepare(f);
    await assert.rejects(completionCommand(f.task, ['settle', 'example', f.main, '42'], f.options));
    assert.ok(existsSync(f.task));
    assert.ok(readActiveBatch(f.anchor));
  });
test('unknown private asset blocks preservation and all Git cleanup', async (t) => {
  const f = fixture(t);
  await prepare(f);
  writeFileSync(path.join(f.task, '.env'), 'private input');
  await assert.rejects(completionCommand(f.task, ['settle', 'example', f.main, '42'], f.options), /private input/);
  assert.ok(existsSync(f.task));
  assert.ok(readActiveBatch(f.anchor));
});
test('remote deletion interruption resumes from retained anchor, verifies preservation and does not redownload reports', async (t) => {
  const f = fixture(t, 'delete-failure');
  await prepare(f);
  await assert.rejects(completionCommand(f.task, ['settle', 'example', f.main, '42'], f.options), /transport/);
  assert.equal(existsSync(f.task), false);
  assert.ok(readActiveBatch(f.anchor));
  const result = await completionCommand(f.anchor, ['settle', 'example', f.main, '42'], f.options);
  assert.equal(result.results.cleanup.result.branchRemoved, true);
  assert.equal(f.downloads(), 1);
  assert.equal(f.checks(), 1);
});
test('damaged preserved blobs cannot justify resumed cleanup', async (t) => {
  const f = fixture(t, 'delete-failure');
  await prepare(f);
  await assert.rejects(completionCommand(f.task, ['settle', 'example', f.main, '42'], f.options));
  const session = JSON.parse(readFileSync(path.join(f.common, 'task-delivery/example/completion-session.json'))),
    manifest = session.events.find((e) => e.name === 'preserve').result.manifest,
    items = JSON.parse(readFileSync(manifest));
  assert.equal(verifyPreservation(manifest, path.dirname(manifest)), true);
  writeFileSync(path.join(path.dirname(manifest), 'blobs', items[0].digest), 'damaged');
  await assert.rejects(completionCommand(f.anchor, ['settle', 'example', f.main, '42'], f.options), /Preserved blob/);
  assert.ok(readActiveBatch(f.anchor));
});

function handoffFixture(t) {
  const f = fixture(t, 'handoff-stale');
  let proof = {
    version: 1,
    status: 'passed',
    taskHead: f.head,
    integrationHead: f.git(f.integration, 'rev-parse', 'HEAD'),
    sourceIdentity: 's',
    configurationIdentity: 'c',
    containerIdentity: 'i',
  };
  let launches = 0;
  const execute = f.options.execute;
  f.options.runtimeSnapshot = () => ({
    integrationHead: f.git(f.integration, 'rev-parse', 'HEAD'),
    worktreeClean: true,
    sourceIdentity: 's',
    configurationIdentity: 'c',
    containerIdentity: 'i',
  });
  f.options.runtimeProof = () => proof;
  f.options.execute = (root, cmd, args) => {
    if (cmd === process.execPath) {
      assert.equal(root, f.anchor);
      assert.deepEqual(args.slice(1), ['handoff', '--task', 'codex/task']);
      launches++;
      proof = { ...proof, ...f.options.runtimeSnapshot(), taskHead: f.head };
      return '';
    }
    return execute(root, cmd, args);
  };
  return { ...f, launches: () => launches };
}
test('final handoff aligns all targets once, launches published handoff once and reuses unchanged runtime thereafter', async (t) => {
  const f = handoffFixture(t);
  await prepare(f);
  const plan = await completionCommand(f.task, ['handoff-plan', f.main], f.options);
  assert.equal(plan.integrationNeedsMerge, true);
  assert.equal(plan.previewNeedsAdvance, true);
  assert.equal(f.launches(), 0);
  assert.notEqual(f.git(f.preview, 'rev-parse', 'HEAD'), f.main, 'plan is read-only');
  const result = await completionCommand(f.task, ['final-handoff', f.main], f.options);
  assert.equal(result.integrationUpdated, true);
  assert.equal(result.previewUpdated, true);
  assert.equal(f.launches(), 1);
  assert.equal(f.git(f.integration, 'rev-parse', 'origin/codex/integration-current'), f.main);
  assert.equal(f.git(f.preview, 'rev-parse', 'HEAD'), f.main);
  const again = await completionCommand(f.anchor, ['final-handoff', f.main], f.options);
  assert.equal(again.launcherReused, true);
  assert.equal(again.integrationUpdated, false);
  assert.equal(f.launches(), 1);
  await completionCommand(f.anchor, ['settle', 'example', f.main, '42'], f.options);
  assert.equal(existsSync(f.task), false);
});
for (const problem of ['dirty-preview', 'diverged-preview', 'runtime', 'profile', 'main-ci', 'database-lock'])
  test(`final handoff refuses ${problem} before updating any carrier`, async (t) => {
    const f = handoffFixture(t);
    await prepare(f);
    const before = f.git(f.integration, 'rev-parse', 'HEAD');
    if (problem === 'dirty-preview') writeFileSync(path.join(f.preview, 'unknown'), 'keep');
    if (problem === 'diverged-preview') {
      writeFileSync(path.join(f.preview, 'independent'), 'keep');
      f.git(f.preview, 'add', 'independent');
      f.git(f.preview, 'commit', '--no-verify', '-m', 'independent work');
    }
    if (problem === 'database-lock') {
      mkdirSync(path.join(f.integration, 'backups/task-preview'), { recursive: true });
      writeFileSync(
        path.join(f.integration, 'backups/task-preview/active-database-task.json'),
        'retain original protection',
      );
    }
    if (problem === 'runtime') f.options.checkRuntime = async () => ({ runtimeHealthy: false, backupRetained: true });
    if (problem === 'profile')
      f.options.checkRuntime = async () => ({
        runtimeHealthy: true,
        backupRetained: true,
        profileFingerprint: 'changed',
      });
    if (problem === 'main-ci') {
      const file = path.join(f.common, 'task-delivery/example/completion-session.json');
      const state = JSON.parse(readFileSync(file));
      state.events = [];
      writeFileSync(file, JSON.stringify(state));
    }
    await assert.rejects(completionCommand(f.task, ['final-handoff', f.main], f.options));
    assert.equal(f.git(f.integration, 'rev-parse', 'HEAD'), before);
    assert.equal(f.launches(), 0);
    assert.ok(existsSync(f.task));
  });
test('final handoff refuses merge conflict, restores its own Git merge and retains all data carriers', async (t) => {
  const f = handoffFixture(t);
  writeFileSync(path.join(f.integration, 'change.txt'), 'independent');
  f.git(f.integration, 'add', 'change.txt');
  f.git(f.integration, 'commit', '--no-verify', '-m', 'integration independent change');
  f.git(f.integration, 'push', 'origin', 'codex/integration-current');
  const before = f.git(f.integration, 'rev-parse', 'HEAD');
  await prepare(f);
  await assert.rejects(completionCommand(f.task, ['final-handoff', f.main], f.options));
  assert.equal(f.git(f.integration, 'rev-parse', 'HEAD'), before);
  assert.equal(f.git(f.integration, 'status', '--porcelain'), '');
  assert.notEqual(f.git(f.preview, 'rev-parse', 'HEAD'), f.main);
  assert.equal(f.launches(), 0);
});
test('explicit push PR merge and sync timing retains only stage and candidate, not arguments', async (t) => {
  const f = fixture(t);
  await completionCommand(f.task, ['begin'], f.options);
  for (const stage of ['push', 'pr', 'merge', 'sync'])
    await completionCommand(
      f.task,
      ['measure', stage, '--', process.execPath, '-e', 'process.exit(0)', 'private-argument'],
      f.options,
    );
  const file = path.join(f.common, 'task-delivery/example/completion-session.json');
  const bytes = readFileSync(file, 'utf8');
  assert.equal(bytes.includes('private-argument'), false);
  const report = await completionCommand(f.task, ['report', 'example'], f.options);
  assert.deepEqual(
    report.stages.map((s) => s.name),
    ['push', 'pr', 'merge', 'sync'],
  );
});

test('automatic main wait returns concise next-stage arguments while retaining full raw jobs once', async (t) => {
  const f = fixture(t);
  const execute = f.options.execute;
  let discoveries = 0,
    waits = 0;
  f.ci.jobs[0].steps = [{ name: 'raw evidence', conclusion: 'success' }];
  f.options.waitQuality = async (_root, run, head) => {
    waits++;
    assert.equal(run, '42');
    assert.equal(head, f.main);
    return f.ci;
  };
  f.options.execute = (root, cmd, args) => {
    if (cmd === 'gh' && args[0] === 'run' && args[1] === 'list') {
      discoveries++;
      assert.ok(args.includes(f.main));
      assert.ok(args.includes('push'));
      return JSON.stringify([{ databaseId: 42, headSha: f.main, event: 'push', headBranch: 'main' }]);
    }
    return execute(root, cmd, args);
  };
  await completionCommand(f.task, ['begin'], f.options);
  const result = await completionCommand(f.task, ['wait', 'main', f.main], f.options);
  assert.equal(discoveries, 1);
  assert.equal(waits, 1);
  assert.equal(result.jobs[0].steps, undefined);
  assert.deepEqual(result.next.handoff, ['npm', 'run', 'task:completion', '--', 'final-handoff', f.main]);
  assert.deepEqual(result.next.settle.slice(-3), ['example', f.main, '42']);
  const session = JSON.parse(readFileSync(path.join(f.common, 'task-delivery/example/completion-session.json')));
  assert.equal(session.events.find((e) => e.name === 'ci').result.jobs[0].steps[0].name, 'raw evidence');
});

test('handoff target plan does not create a completion session or mutate any carrier', async (t) => {
  const f = handoffFixture(t);
  const session = path.join(f.common, 'task-delivery/example/completion-session.json');
  assert.equal(existsSync(session), false);
  const before = [f.integration, f.preview].map((r) => f.git(r, 'rev-parse', 'HEAD'));
  const plan = await completionCommand(f.task, ['handoff-plan', f.main], f.options);
  assert.equal(plan.integrationNeedsMerge, true);
  assert.equal(existsSync(session), false);
  assert.deepEqual(
    [f.integration, f.preview].map((r) => f.git(r, 'rev-parse', 'HEAD')),
    before,
  );
  assert.equal(f.launches(), 0);
});
