import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { readyTask, checkpointTask } from './task-development.mjs';
import { captureSource, captureIdentity } from './verification-evidence.mjs';
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
  const check = { name: 'fixture check', args: ['run', 'lint:changed', '--', 'source.js'] };
  const descriptor = { ...check, root: a, command: 'npm', kind: 'node', reuse: false };
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
  const review = {
    version: 1,
    task: 'a',
    sourceDigest: captureSource(a).digest,
    requirements: [{ id: 'approved-change', result: 'met', evidence: 'source.js reviewed against authorized change' }],
    reverseReview: { completed: true, evidence: 'Wrong task, changed source and stale evidence paths checked' },
    findings: [],
    reviewedFiles: ['source.js'],
    authorizationEvidence: 'Fixture approval',
    verification: [{ name: check.name, file: '.task-verification/check.json' }],
  };
  mkdirSync(path.join(a, '.task-runtime'));
  const reviewFile = path.join(a, '.task-runtime/review.json');
  const save = () => writeFileSync(reviewFile, JSON.stringify(review));
  save();
  return {
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
