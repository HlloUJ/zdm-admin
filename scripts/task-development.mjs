import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { captureSource, captureIdentity, captureArtifacts } from './verification-evidence.mjs';
import { collectDeliveryChanges } from './verify.mjs';
import { createValidationPlan } from './check-changed-plan.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { encoding: 'utf8' }).trim();
function owned(task, owner) {
  assert.equal(task.owner, owner, 'Current chat must own this exact task');
  assert.ok(
    ['developing', 'dev-validated', 'blocked'].includes(task.stage),
    'Formal delivery source is frozen; development cannot reset it',
  );
  assert.ok(
    !existsSync(path.join(task.repository.commonDir, 'task-delivery', task.id, 'accepted-source.json')),
    'Accepted source already exists; preserve the original freeze',
  );
}
function ownFile(root, file, within) {
  const absolute = path.resolve(root, file);
  assert.ok(absolute.startsWith(path.resolve(root, within) + path.sep), 'Evidence must belong to this task');
  assert.ok(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink());
  assert.equal(realpathSync(absolute), absolute, 'Linked evidence is unsafe');
  return absolute;
}
export function checkpointTask(root, { id, owner, commit, verification }) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  owned(task, owner);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.ok(text(verification), 'Checkpoint notes required; WIP may explicitly remain unverified');
  git(root, 'merge-base', '--is-ancestor', task.base, commit);
  git(root, 'merge-base', '--is-ancestor', commit, 'HEAD');
  return registry.revise(id, task.revision, (record) => {
    if (!record.checkpoints.some((entry) => entry.commit === commit))
      record.checkpoints.push({ commit, verification, recordedAt: new Date().toISOString() });
    record.recordedHead = git(root, 'rev-parse', 'HEAD');
  });
}
export function readyTask(root, { id, owner, review }, dependencies = {}) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  owned(task, owner);
  const system = {
    capture: captureSource,
    changes: collectDeliveryChanges,
    plan: (files) => createValidationPlan(files, (file) => existsSync(path.join(root, file)), { root }),
    identity: captureIdentity,
    artifacts: captureArtifacts,
    ...dependencies,
  };
  const snapshot = system.capture(root),
    changes = system.changes(root),
    files = changes.files;
  assert.ok(changes.base, 'Delivery change scope is unknown');
  const file = ownFile(root, review, '.task-runtime');
  const bytes = readFileSync(file),
    record = JSON.parse(bytes);
  assert.equal(record.version, 1);
  assert.equal(record.task, task.id);
  assert.equal(record.sourceDigest, snapshot.digest, 'Review belongs to an older candidate');
  assert.ok(
    Array.isArray(record.requirements) && record.requirements.length > 0,
    'Requirement-by-requirement review required',
  );
  for (const item of record.requirements)
    assert.ok(text(item.id) && item.result === 'met' && text(item.evidence), 'Unfinished requirement remains');
  assert.ok(record.reverseReview?.completed && text(record.reverseReview.evidence), 'Reverse review evidence required');
  assert.ok(
    Array.isArray(record.findings) &&
      record.findings.every((item) => item.status === 'resolved' && text(item.evidence)),
    'Unresolved review finding remains',
  );
  assert.deepEqual(
    [...new Set(record.reviewedFiles ?? [])].sort(),
    [...new Set(files)].sort(),
    'Authorization review omitted or added changed files',
  );
  assert.ok(text(record.authorizationEvidence), 'Approved scope reference required');
  const plan = system.plan(files),
    reports = record.verification ?? [];
  const checks = [...plan.tasks];
  if (plan.browserPlan?.mode === 'full' || plan.e2eFiles?.length)
    checks.push({
      name: 'affected E2E',
      args: ['run', 'test:e2e:chrome', ...(plan.browserPlan?.mode === 'full' ? [] : ['--', ...plan.e2eFiles])],
      kind: 'browser',
    });
  const proofs = [];
  for (const check of checks) {
    const matching = reports.filter((entry) => entry.name === check.name);
    assert.equal(matching.length, 1, 'Exact existing check evidence required: ' + check.name);
    const proofFile = ownFile(root, matching[0].file, '.task-verification');
    const proof = JSON.parse(readFileSync(proofFile));
    assert.equal(proof.version, 4);
    assert.equal(proof.exitCode, 0);
    assert.ok(proof.completedAt && proof.startedAt);
    assert.ok(
      ['passed', 'not-reusable'].includes(proof.status),
      'Failed, interrupted or inapplicable evidence is not success',
    );
    assert.equal(proof.identity.root, realpathSync(root));
    assert.equal(proof.identity.command, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    assert.deepEqual(proof.identity.args, check.args, 'Evidence command differs from required check');
    assert.equal(digest(JSON.stringify(proof.identity)), proof.fingerprint, 'Evidence fingerprint changed');
    const descriptor = {
      ...check,
      root,
      command: proof.identity.command,
      kind: check.kind ?? (check.args.includes('backend:test') ? 'backend' : 'node'),
      reuse: check.args.includes('backend:test'),
      ...(check.args.includes('build:app') ? { artifacts: ['dist'] } : {}),
    };
    const expected = system.identity(descriptor);
    assert.equal(
      proof.fingerprint,
      expected.fingerprint,
      'Existing execution inputs, dependencies, environment or scope changed',
    );
    assert.equal(proof.artifacts, system.artifacts(descriptor), 'Required verification artifacts changed');
    assert.equal(
      digest(readFileSync(ownFile(root, proof.log, '.task-verification/logs'))),
      proof.logDigest,
      'Verification log changed',
    );
    proofs.push({
      name: check.name,
      file: matching[0].file,
      attemptId: proof.attemptId,
      fingerprint: proof.fingerprint,
    });
  }
  assert.equal(system.capture(root).digest, snapshot.digest, 'Candidate changed during review recording');
  return registry.revise(id, task.revision, (current) => {
    current.stage = 'dev-validated';
    current.recordedHead = git(root, 'rev-parse', 'HEAD');
    current.development = {
      reviewed: true,
      sourceDigest: snapshot.digest,
      reviewDigest: digest(bytes),
      reviewFile: review,
      verification: proofs,
      formalDeliveryComplete: false,
      evidenceReuseGranted: false,
    };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, id, value, notes, ...extra] = process.argv.slice(2);
    assert.equal(extra.length, 0, 'Unexpected task work arguments');
    const owner = process.env.CODEX_THREAD_ID;
    if (command === 'ready') assert.equal(notes, undefined, 'Unexpected ready arguments');
    assert.ok(
      ['checkpoint', 'ready'].includes(command),
      'task:work <checkpoint task-id commit verification-note|ready task-id review-file>',
    );
    console.log(
      JSON.stringify(
        command === 'checkpoint'
          ? checkpointTask(process.cwd(), { id, owner, commit: value, verification: notes })
          : readyTask(process.cwd(), { id, owner, review: value }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
