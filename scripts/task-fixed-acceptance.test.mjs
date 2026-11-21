import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { composeFixedAcceptance } from './task-fixed-acceptance-compose.mjs';
import { publishFixedAcceptance, registerFixedAcceptancePlan } from './task-fixed-acceptance-run.mjs';
import { captureQueueProgress } from './task-delivery-status-sync.mjs';
import {
  checkFixedAcceptanceReview,
  fixedAcceptanceReadyFact,
  pendingFixedAcceptance,
  verifyFixedAcceptanceMember,
} from './task-fixed-acceptance.mjs';

const owner = '00000000-0000-4000-8000-000000000162';
const taskId = 'active-business-task';
const head = 'a'.repeat(40);
const releaseHead = 'b'.repeat(40);
const completion = 'c'.repeat(64);
const backendId = 'd'.repeat(64);
const configDigest = 'e'.repeat(64);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const policyPath = 'fixed-acceptance/policy.json';

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'zdm-fixed-acceptance-')));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const worktree = path.join(root, 'runtime');
  const task = { id: taskId, owner, kind: 'business', stage: 'developing', worktree };
  const board = 'canonical-board-task';
  task.monitoring = { taskStableId: board };
  const ticket = {
    lane: 'development',
    status: 'completed',
    executionKind: 'business',
    task: taskId,
    owner,
    order: 1,
    monitorContext: { taskStableId: board },
    completion: { digest: completion, evidence: { task: taskId, owner, head } },
  };
  const queue = { revision: 9, paused: false, tickets: [ticket] };
  const live = { worktree, head: releaseHead, branch: 'codex/fixed-5179-live', backendId, configDigest };
  const options = {
    registry: { commonDir: root, resolve: () => task, readTask: () => task, list: () => [task] },
    readQueue: () => queue,
    inspect: async () => live,
    verifyDevelopment: () => true,
  };
  const write = (file, value) => {
    const bytes = JSON.stringify(value) + '\n';
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return hash(bytes);
  };
  const policy = { version: 1, common: root, port: 5179, enabled: true, executor: owner, initialCompletions: [] };
  write(path.join(root, policyPath), policy);
  const reportFile = '.task-runtime/acceptance/member.json';
  const report = {
    version: 1,
    task: taskId,
    head,
    releaseHead,
    outcome: 'passed',
    origin: 'http://127.0.0.1:5179',
    verifiedAt: new Date().toISOString(),
    checks: [{ name: 'verified route and API', passed: true }],
  };
  const reportHash = write(path.join(worktree, reportFile), report);
  const member = { task: taskId, board, head, completion, report: { file: reportFile, sha256: reportHash } };
  const release = {
    version: 2,
    port: 5179,
    head: releaseHead,
    branch: live.branch,
    backendId,
    configDigest,
    members: [member],
  };
  const releaseFile = path.join(worktree, '.task-runtime/acceptance/verified-release.json');
  write(releaseFile, release);
  return {
    root,
    worktree,
    task,
    ticket,
    queue,
    board,
    live,
    options,
    write,
    policy,
    report,
    reportFile,
    member,
    releaseFile,
    release,
  };
}

test('a durable development completion produces one fixed-preview request without touching board placement', async (t) => {
  const f = fixture(t);
  const prior = { ...f.queue, revision: 8, tickets: [{ ...f.ticket, status: 'running', completion: null }] };
  captureQueueProgress(f.root, f.queue, prior);
  captureQueueProgress(f.root, f.queue, prior);
  const event = JSON.parse(readFileSync(path.join(f.root, 'fixed-acceptance/inbox', completion + '.json')));
  assert.deepEqual(event, { version: 1, task: taskId, owner, head, completion });
  const result = await pendingFixedAcceptance(f.root, f.options);
  assert.deepEqual(result.pending, [{ task: taskId, board: f.board, head, completion, worktree: f.worktree }]);
  f.write(path.join(f.root, policyPath), { ...f.policy, initialCompletions: [completion] });
  assert.deepEqual((await pendingFixedAcceptance(f.root, f.options)).pending, []);
});

test('review placement requires the same source receipt, active 5179, and its original feature report', async (t) => {
  const f = fixture(t);
  const proof = await verifyFixedAcceptanceMember(f.root, taskId, f.options);
  const receipt = { task_id: f.board, ...fixedAcceptanceReadyFact(proof) };
  const box = path.join(f.root, 'task-progress', f.board);
  await checkFixedAcceptanceReview(box, receipt, f.options);
  await assert.rejects(
    checkFixedAcceptanceReview(box, { ...receipt, evidence_refs: ['only-development'] }, f.options),
    /lacks exact 5179 evidence/,
  );
  f.live.head = 'f'.repeat(40);
  await assert.rejects(checkFixedAcceptanceReview(box, receipt, f.options), /Current 5179 source differs/);
  f.live.head = releaseHead;
  f.member.completion = 'f'.repeat(64);
  f.write(f.releaseFile, f.release);
  await assert.rejects(verifyFixedAcceptanceMember(f.root, taskId, f.options), /different development receipt/);
  f.member.completion = completion;
  f.write(f.releaseFile, f.release);
  f.write(path.join(f.worktree, f.reportFile), { ...f.report, outcome: 'failed' });
  await assert.rejects(verifyFixedAcceptanceMember(f.root, taskId, f.options), /report changed/);
});

test('isolated combination keeps the active preview, exact development delta and source branch', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'zdm-fixed-compose-')));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const run = (...args) =>
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@localhost',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
  run('init', '-qb', 'main');
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src/app.js'), 'base\n');
  run('add', 'src');
  run('commit', '-qm', 'base');
  const main = run('rev-parse', 'HEAD');
  run('update-ref', 'refs/remotes/origin/main', main);

  run('switch', '-qc', 'live');
  writeFileSync(path.join(root, 'src/previous.js'), 'previous preview\n');
  run('add', 'src');
  run('commit', '-qm', 'previous release');
  const active = run('rev-parse', 'HEAD');
  run('switch', '-qc', 'development', main);
  writeFileSync(path.join(root, 'src/app.js'), 'new development\n');
  run('add', 'src');
  run('commit', '-qm', 'development passed');
  const development = run('rev-parse', 'HEAD');
  const candidate = { task: taskId, worktree: root, head: development, completion };
  const result = composeFixedAcceptance(root, { active, main, pending: [candidate] });
  assert.equal(result.previewOnly, true);
  assert.equal(run('show', result.candidate + ':src/previous.js'), 'previous preview');
  assert.equal(run('show', result.candidate + ':src/app.js'), 'new development');
  assert.equal(run('rev-parse', 'HEAD'), development);
  assert.equal(run('status', '--porcelain'), '');
  assert.equal(run('rev-parse', 'refs/heads/live'), active);

  run('switch', '-qc', 'conflicting-live', active);
  writeFileSync(path.join(root, 'src/app.js'), 'conflicting version\n');
  run('add', 'src');
  run('commit', '-qm', 'conflicting release');
  const conflicting = run('rev-parse', 'HEAD');
  run('switch', '-q', 'development');
  assert.throws(
    () => composeFixedAcceptance(root, { active: conflicting, main, pending: [candidate] }),
    /source conflict/,
  );
  assert.equal(run('rev-parse', 'refs/heads/conflicting-live'), conflicting);
  assert.equal(run('rev-parse', 'HEAD'), development);
});

function stagedRelease(t) {
  const f = fixture(t);
  const member = { task: taskId, board: f.board, head, completion, worktree: f.worktree };
  const plan = {
    previewOnly: true,
    active: releaseHead,
    candidate: 'f'.repeat(40),
    tree: '1'.repeat(40),
    main: '2'.repeat(40),
    affectedBackend: true,
    migrations: ['backend/src/main/resources/db/migration/V175__fixture.sql'],
    members: [member],
  };
  const backup = path.join(f.root, 'rehearsed-backup.sql.gz');
  const backupSha256 = f.write(backup, { snapshot: 'unchanged' });
  const calls = [];
  let active = plan.active;
  const proof = {
    task: taskId,
    board: f.board,
    candidate: head,
    development: completion,
    release: plan.candidate,
    publication: '2'.repeat(64),
  };
  const adapters = {
    registry: f.options.registry,
    actor: owner,
    guard: (callback) => callback(),
    inspect: async () => ({ ...f.live, head: active, proofDigest: active }),
    verify: async () => {
      calls.push('feature');
      return proof;
    },
    record: () => {
      calls.push('record');
      return { receipt_id: 'receipt' };
    },
  };
  const execute = {
    plan,
    prepare: async () => {
      calls.push('prepare');
      return {
        head: plan.candidate,
        tree: plan.tree,
        featureVerification: true,
        rollbackVerified: true,
        isolatedBackendVerified: true,
        migrationRehearsed: true,
        backup,
        backupSha256,
      };
    },
    switchPreview: async () => {
      calls.push('switch');
      active = plan.candidate;
    },
    restorePreview: async () => {
      calls.push('restore');
      active = plan.active;
    },
    deliver: async () => {
      calls.push('deliver');
      return { receipt_id: 'receipt', status: 'applied', task: { id: f.board, board_column: 'review', revision: 10 } };
    },
  };
  return { f, member, plan, calls, adapters, execute, getActive: () => active };
}

test('failed feature readback restores the prior 5179 release before creating any board receipt', async (t) => {
  const release = stagedRelease(t);
  release.adapters.verify = async () => {
    throw Error('feature failed');
  };
  await assert.rejects(publishFixedAcceptance(release.f.root, release.execute, release.adapters), /feature failed/);
  assert.deepEqual(release.calls, ['prepare', 'switch', 'restore']);
  assert.equal(release.getActive(), release.plan.active);
  await assert.rejects(
    publishFixedAcceptance(release.f.root, release.execute, release.adapters),
    /outcome requires readback/,
  );
});

test('a lost board response reuses the verified publication and never switches or restores again', async (t) => {
  const release = stagedRelease(t);
  const persisted = registerFixedAcceptancePlan(release.f.root, release.member, () => release.plan);
  const replay = registerFixedAcceptancePlan(release.f.root, release.member, () => assert.fail('Draft rebuilt'));
  assert.deepEqual(replay, persisted);
  await assert.rejects(
    publishFixedAcceptance(
      release.f.root,
      {
        ...release.execute,
        deliver: async () => {
          throw Error('unknown board response');
        },
      },
      release.adapters,
    ),
    /unknown board response/,
  );
  assert.equal(release.getActive(), release.plan.candidate);
  const result = await publishFixedAcceptance(release.f.root, release.execute, release.adapters);
  assert.equal(result.placement[0].revision, 10);
  assert.deepEqual(release.calls, ['prepare', 'switch', 'feature', 'record', 'feature', 'record', 'deliver']);
});
