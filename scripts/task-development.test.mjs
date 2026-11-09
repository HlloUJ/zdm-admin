import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { readyTask, checkpointTask, scopeTask, reviewTask, taskWorkStatus } from './task-development.mjs';
import { captureSource, captureIdentity } from './verification-evidence.mjs';
import { readActiveBatch } from './task-batch.mjs';
import { assertTaskDevelopmentSnapshot } from './task-context.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'task-development-'))),
    main = path.join(dir, 'main');
  mkdirSync(main);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(path.join(main, '.gitignore'), '.task-runtime/\n.task-verification/\n');
  writeFileSync(path.join(main, 'source.js'), 'export const value = 1;');
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'base');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const a = path.join(dir, 'a'),
    b = path.join(dir, 'b');
  git(main, 'worktree', 'add', '-b', 'codex/a', a);
  git(main, 'worktree', 'add', '-b', 'codex/b', b);
  const registry = createTaskRegistry(main);
  registry.register({ id: 'a', worktree: a, owner: 'chat-a' });
  registry.register({ id: 'b', worktree: b, owner: 'chat-b' });
  writeFileSync(path.join(a, 'source.js'), 'export const value = 2;');
  const check = { name: 'shared configuration checks', args: ['run', 'verify:local'], kind: 'orchestration' };
  const descriptor = { ...check, root: a, command: 'npm', reuse: false };
  const identity = captureIdentity(descriptor);
  const log = '.task-verification/logs/check.log';
  mkdirSync(path.join(a, '.task-verification/logs'), { recursive: true });
  writeFileSync(path.join(a, log), 'fixture successful execution output');
  const proof = {
    version: 4,
    exitCode: 0,
    status: 'not-reusable',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    attemptId: 'fixture',
    identity: identity.identity,
    fingerprint: identity.fingerprint,
    artifacts: null,
    log,
    logDigest: digest(readFileSync(path.join(a, log))),
  };
  writeFileSync(path.join(a, '.task-verification/check.json'), JSON.stringify(proof));
  mkdirSync(path.join(a, '.task-runtime'));
  writeFileSync(
    path.join(a, '.task-runtime/approval.txt'),
    'Fixture approval: change source.js while retaining task B.',
  );
  writeFileSync(
    path.join(a, '.task-runtime/recheck.txt'),
    'Fixture reviewer inspected source.js, task B and the wrong-task and stale-candidate paths.',
  );
  const ref = (file) => ({ file, sha256: digest(readFileSync(path.join(a, file))) });
  const evidence = [ref('.task-runtime/recheck.txt')];
  const scope = {
    version: 1,
    task: 'a',
    authorization: [ref('.task-runtime/approval.txt')],
    requirements: [
      {
        id: 'approved-change',
        requirement: 'Change source.js and preserve B',
        source: 'Fixture approval',
        acceptance: 'New value is present; B is unchanged',
      },
    ],
  };
  const scopeFile = path.join(a, '.task-runtime/scope.json');
  writeFileSync(scopeFile, JSON.stringify(scope));
  const scoped = scopeTask(a, { id: 'a', owner: 'chat-a', scope: '.task-runtime/scope.json' });
  const review = {
    version: 2,
    task: 'a',
    scopeDigest: scoped.reviewScope.digest,
    sourceDigest: captureSource(a).digest,
    requirements: [{ id: 'approved-change', result: 'met', implementation: ['source.js'], evidence }],
    reverseReview: {
      completed: true,
      basis: scoped.reviewScope.digest,
      finalDiffEvidence: evidence,
      cases: [
        {
          requirement: 'approved-change',
          entry: 'source.js and task B',
          scenario: 'Wrong owner, changed source and stale evidence',
          expected: 'Refuse incomplete readiness and preserve B',
          observed: 'Fixture assertions cover refusals and preservation',
          evidence,
        },
      ],
    },
    findings: [],
    reviewedFiles: ['source.js'],
    verification: [{ name: check.name, file: '.task-verification/check.json' }],
  };
  const reviewFile = path.join(a, '.task-runtime/review.json');
  const save = () => writeFileSync(reviewFile, JSON.stringify(review));
  save();
  reviewTask(a, { id: 'a', owner: 'chat-a', review: '.task-runtime/review.json' });
  return {
    ref,
    evidence,
    scope,
    scopeFile,
    a,
    b,
    main,
    git,
    registry,
    review,
    reviewFile,
    proof,
    save,
    log,
    dependencies: { plan: () => ({ tasks: [check] }) },
  };
}
test('development readiness requires requirement/reverse-review and exact existing execution proof without running another gate', (t) => {
  const f = fixture(t),
    before = f.registry.readTask('b');
  const result = readyTask(f.a, { id: 'a', owner: 'chat-a', review: '.task-runtime/review.json' }, f.dependencies);
  assert.equal(result.stage, 'dev-validated');
  assert.equal(result.development.formalDeliveryComplete, false);
  assert.equal(result.development.evidenceReuseGranted, false);
  assert.deepEqual(f.registry.readTask('b'), before);
});
for (const failure of [
  'wrong owner',
  'requirement',
  'reverse review',
  'unresolved finding',
  'file scope',
  'source drift',
  'log changed',
  'artifacts',
  'missing check',
  'frozen',
]) {
  test('development readiness retains task state on ' + failure, (t) => {
    const f = fixture(t),
      before = f.registry.readTask('a');
    const args = { id: 'a', owner: 'chat-a', review: '.task-runtime/review.json' };
    if (failure === 'wrong owner') args.owner = 'chat-b';
    if (failure === 'requirement') f.review.requirements[0].result = 'pending';
    if (failure === 'reverse review') f.review.reverseReview.completed = false;
    if (failure === 'unresolved finding') f.review.findings = [{ status: 'open', evidence: 'not fixed' }];
    if (failure === 'file scope') f.review.reviewedFiles = [];
    if (failure === 'source drift') writeFileSync(path.join(f.a, 'source.js'), 'changed again');
    if (failure === 'log changed') writeFileSync(path.join(f.a, f.log), 'tampered log');
    if (failure === 'artifacts') f.dependencies.artifacts = () => 'changed-artifact';
    if (failure === 'missing check') f.review.verification = [];
    if (failure === 'frozen') {
      const directory = path.join(before.repository.commonDir, 'task-delivery/a');
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'accepted-source.json'), '{}');
    }
    f.save();
    assert.throws(() => readyTask(f.a, args, f.dependencies));
    assert.deepEqual(f.registry.readTask('a'), before);
  });
}
test('a WIP checkpoint records only the owning task and does not mark it ready or publish it', (t) => {
  const f = fixture(t),
    before = f.registry.readTask('b');
  f.git(f.a, 'add', 'source.js');
  f.git(f.a, 'commit', '-m', 'WIP own task');
  const commit = f.git(f.a, 'rev-parse', 'HEAD');
  const record = checkpointTask(f.a, { id: 'a', owner: 'chat-a', commit, verification: 'WIP, not validated' });
  assert.equal(record.stage, 'developing');
  assert.equal(record.checkpoints[0].commit, commit);
  assert.deepEqual(f.registry.readTask('b'), before);
  assert.equal(f.git(f.main, 'status', '--porcelain'), '');
});
function recordNext(f) {
  const task = f.registry.readTask('a');
  f.review.previousReview = task.reviewPasses.at(-1).digest;
  f.review.sourceDigest = captureSource(f.a).digest;
  f.review.scopeDigest = task.reviewScope.digest;
  const file = '.task-runtime/review-' + task.reviewPasses.length + '.json';
  writeFileSync(path.join(f.a, file), JSON.stringify(f.review));
  const result = reviewTask(f.a, { id: 'a', owner: 'chat-a', review: file });
  return { result, file };
}
const markReady = (f, review = '.task-runtime/review.json') =>
  readyTask(f.a, { id: 'a', owner: 'chat-a', review }, f.dependencies);

test('an open finding blocks readiness, cannot be omitted, and needs correction, regression and recheck proof', (t) => {
  const f = fixture(t);
  f.review.findings = [
    {
      id: 'gap',
      requirement: 'approved-change',
      description: 'B preservation needs proof',
      expected: 'B unchanged',
      actual: 'Not yet verified',
      status: 'open',
    },
  ];
  const open = recordNext(f);
  assert.throws(() => markReady(f, open.file), /Unresolved review finding/);
  const original = f.registry.readTask('a');
  f.review.findings = [];
  assert.throws(() => recordNext(f), /Cannot discard/);
  assert.deepEqual(f.registry.readTask('a'), original);
  f.review.findings = structuredClone(original.reviewPasses.at(-1).document.findings);
  f.review.findings[0].status = 'resolved';
  assert.throws(() => recordNext(f), /actual correction/);
  f.review.findings[0].correction = 'Added preservation coverage';
  f.review.findings[0].regressionEvidence = f.evidence;
  assert.throws(() => recordNext(f), /evidence files/);
  f.review.findings[0].recheckEvidence = f.evidence;
  const fixed = recordNext(f);
  assert.equal(markReady(f, fixed.file).stage, 'dev-validated');
  assert.equal(taskWorkStatus(f.a, { id: 'a', owner: 'chat-a' }, f.dependencies).developmentComplete, true);
  assert.equal(f.registry.readTask('a').reviewPasses.length, 3);
});
for (const mode of [
  'omitted requirement',
  'duplicate requirement',
  'wrong scope',
  'old review',
  'reverse case missing',
  'inapplicable without reason',
  'legacy declaration',
])
  test('review refuses ' + mode + ' without changing the baseline or prior findings', (t) => {
    const f = fixture(t),
      before = f.registry.readTask('a');
    if (mode === 'omitted requirement') f.review.requirements = [];
    if (mode === 'duplicate requirement') f.review.requirements.push(structuredClone(f.review.requirements[0]));
    if (mode === 'wrong scope') f.review.reverseReview.basis = '0'.repeat(64);
    if (mode === 'old review') f.review.previousReview = '0'.repeat(64);
    if (mode === 'reverse case missing') f.review.reverseReview.cases = [];
    if (mode === 'inapplicable without reason') f.review.requirements[0].result = 'not-applicable';
    if (mode === 'legacy declaration') f.review.version = 1;
    const file = '.task-runtime/invalid-review.json';
    if (mode !== 'old review') f.review.previousReview = before.reviewPasses.at(-1).digest;
    writeFileSync(path.join(f.a, file), JSON.stringify(f.review));
    assert.throws(() => reviewTask(f.a, { id: 'a', owner: 'chat-a', review: file }));
    assert.deepEqual(f.registry.readTask('a'), before);
  });
test('a new WIP invalidates old readiness, preserves review history and cannot advertise ready through batch status', (t) => {
  const f = fixture(t);
  markReady(f);
  writeFileSync(path.join(f.a, 'source.js'), 'new unfinished source');
  assert.equal(
    readActiveBatch(f.a).modules[0].status,
    'in-progress',
    'Dirty source is already stale before checkpoint',
  );
  assert.equal(taskWorkStatus(f.a, { id: 'a', owner: 'chat-a' }, f.dependencies).developmentComplete, false);
  f.git(f.a, 'add', 'source.js');
  f.git(f.a, 'commit', '-m', 'new WIP');
  const result = checkpointTask(f.a, {
    id: 'a',
    owner: 'chat-a',
    commit: f.git(f.a, 'rev-parse', 'HEAD'),
    verification: 'WIP, unfinished',
  });
  assert.equal(result.stage, 'developing');
  assert.equal(result.development.reviewed, false);
  assert.equal(result.developmentHistory.length, 1);
  assert.equal(result.reviewPasses.length, 1);
  assert.equal(readActiveBatch(f.a).modules[0].status, 'in-progress');
  assert.throws(() => assertTaskDevelopmentSnapshot(readActiveBatch(f.a)), /review is incomplete/);
});
test('a same-content commit retains a valid review rather than requiring another complete check', (t) => {
  const f = fixture(t);
  markReady(f);
  f.git(f.a, 'add', 'source.js');
  f.git(f.a, 'commit', '-m', 'save validated source');
  const result = checkpointTask(f.a, {
    id: 'a',
    owner: 'chat-a',
    commit: f.git(f.a, 'rev-parse', 'HEAD'),
    verification: 'Same reviewed candidate',
  });
  assert.equal(result.stage, 'dev-validated');
  assert.equal(taskWorkStatus(f.a, { id: 'a', owner: 'chat-a' }, f.dependencies).developmentComplete, true);
  assert.doesNotThrow(() => assertTaskDevelopmentSnapshot(readActiveBatch(f.a)));
});
test('fresh status rejects changed evidence, execution environment or artifacts after a previously successful ready', (t) => {
  const f = fixture(t);
  markReady(f);
  const before = f.registry.readTask('a');
  const changedArtifacts = taskWorkStatus(
    f.a,
    { id: 'a', owner: 'chat-a' },
    { ...f.dependencies, artifacts: () => 'changed' },
  );
  assert.equal(changedArtifacts.developmentComplete, false);
  assert.match(changedArtifacts.reason, /artifacts changed/);
  const changedInputs = taskWorkStatus(
    f.a,
    { id: 'a', owner: 'chat-a' },
    { ...f.dependencies, identity: () => ({ fingerprint: 'changed' }) },
  );
  assert.equal(changedInputs.developmentComplete, false);
  assert.match(changedInputs.reason, /inputs, dependencies/);
  writeFileSync(path.join(f.a, f.log), 'changed execution log');
  assert.equal(readActiveBatch(f.a).modules[0].status, 'in-progress');
  writeFileSync(path.join(f.a, '.task-runtime/recheck.txt'), 'changed proof');
  assert.equal(taskWorkStatus(f.a, { id: 'a', owner: 'chat-a' }, f.dependencies).developmentComplete, false);
  assert.equal(readActiveBatch(f.a).modules[0].status, 'in-progress');
  assert.deepEqual(f.registry.readTask('a'), before, 'Status is read-only');
});
test('scope amendments preserve the baseline and require explicit authorization for removed or rewritten requirements', (t) => {
  const f = fixture(t);
  markReady(f);
  const original = f.registry.readTask('a');
  f.scope.previousScopeDigest = original.reviewScope.digest;
  f.scope.requirements[0].acceptance = 'Explicitly changed approved criterion';
  writeFileSync(f.scopeFile, JSON.stringify(f.scope));
  assert.throws(
    () => scopeTask(f.a, { id: 'a', owner: 'chat-a', scope: '.task-runtime/scope.json' }),
    /silently remove or rewrite/,
  );
  assert.deepEqual(f.registry.readTask('a'), original);
  f.scope.amendments = [
    {
      id: 'approved-change',
      reason: 'User explicitly amended the acceptance criterion',
      authorization: [f.ref('.task-runtime/approval.txt')],
    },
  ];
  writeFileSync(f.scopeFile, JSON.stringify(f.scope));
  const result = scopeTask(f.a, { id: 'a', owner: 'chat-a', scope: '.task-runtime/scope.json' });
  assert.equal(result.reviewScopeHistory[0].digest, original.reviewScope.digest);
  assert.equal(result.development.reviewed, false);
  assert.equal(result.stage, 'developing');
  assert.equal(result.reviewPasses.length, 1);
});
test('readiness remains blocked when the separately recorded review or a real applicable check is incomplete', (t) => {
  const f = fixture(t);
  f.review.requirements[0].result = 'blocked';
  f.review.reverseReview.completed = false;
  const pending = recordNext(f);
  assert.throws(() => markReady(f, pending.file), /Unfinished requirement/);
  f.review.requirements[0].result = 'met';
  const noReverse = recordNext(f);
  assert.throws(() => markReady(f, noReverse.file), /Reverse review is incomplete/);
  f.review.reverseReview.completed = true;
  f.review.verification = [];
  const noCheck = recordNext(f);
  assert.throws(() => markReady(f, noCheck.file), /Exact existing check evidence/);
  assert.equal(f.registry.readTask('a').stage, 'developing');
});

test('subsequent review cannot overwrite the original review file', (t) => {
  const f = fixture(t),
    before = f.registry.readTask('a');
  f.review.previousReview = before.reviewPasses.at(-1).digest;
  f.save();
  assert.throws(
    () => reviewTask(f.a, { id: 'a', owner: 'chat-a', review: '.task-runtime/review.json' }),
    /Preserve prior review files/,
  );
  assert.deepEqual(f.registry.readTask('a'), before);
});
