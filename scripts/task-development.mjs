import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { captureSource } from './verification-evidence.mjs';
import {
  reviewFile,
  validateReviewScope,
  validateTaskReview,
  invalidateDevelopment,
  developmentReviewStatus,
  validateDevelopmentChecks,
} from './task-review.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { encoding: 'utf8' }).trim();
function owned(task, owner) {
  assert.equal(task.owner, owner, 'Current chat must own this exact task');
  assert.ok(!task.previewOnly, 'Preview-only combinations are not development or delivery tasks');
  assert.ok(
    ['developing', 'dev-validated', 'blocked'].includes(task.stage),
    'Formal delivery source is frozen; development cannot reset it',
  );
  assert.ok(
    !existsSync(path.join(task.repository.commonDir, 'task-delivery', task.id, 'accepted-source.json')),
    'Accepted source already exists; preserve the original freeze',
  );
}
export function scopeTask(root, { id, owner, scope }) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  owned(task, owner);
  const bytes = readFileSync(reviewFile(root, scope, ['.task-runtime'])),
    document = JSON.parse(bytes);
  if (task.reviewScope?.digest === digest(bytes)) return task;
  validateReviewScope(root, task, document);
  return registry.revise(id, task.revision, (record) => {
    record.reviewScopeHistory ??= [];
    if (record.reviewScope) record.reviewScopeHistory.push(record.reviewScope);
    record.reviewScope = {
      digest: digest(bytes),
      file: scope,
      raw: bytes.toString('utf8'),
      document,
      recordedAt: new Date().toISOString(),
    };
    invalidateDevelopment(record, 'Approved scope registered or explicitly amended; current-candidate review required');
  });
}
export function reviewTask(root, { id, owner, review }) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  owned(task, owner);
  const bytes = readFileSync(reviewFile(root, review, ['.task-runtime'])),
    document = JSON.parse(bytes);
  if (task.reviewPasses?.at(-1)?.digest === digest(bytes)) return task;
  assert.ok(
    !(task.reviewPasses ?? []).some((pass) => pass.file === review),
    'Preserve prior review files; use a new file for each pass',
  );
  const snapshot = captureSource(root);
  const result = validateTaskReview(root, task, document, snapshot.digest);
  assert.equal(captureSource(root).digest, snapshot.digest, 'Candidate changed during review recording');
  return registry.revise(id, task.revision, (record) => {
    record.reviewPasses ??= [];
    record.reviewPasses.push({
      digest: digest(bytes),
      file: review,
      raw: bytes.toString('utf8'),
      document,
      result,
      recordedAt: new Date().toISOString(),
    });
    invalidateDevelopment(record, 'Review recorded; unresolved findings and applicable checks must pass before ready');
  });
}
export function taskWorkStatus(root, { id, owner }, dependencies = {}) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  assert.equal(task.owner, owner, 'Current chat must own this exact task');
  return { task: id, ...developmentReviewStatus(root, task, dependencies) };
}
export function checkpointTask(root, { id, owner, commit, verification }) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  owned(task, owner);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.ok(text(verification), 'Checkpoint notes required; WIP may explicitly remain unverified');
  git(root, 'merge-base', '--is-ancestor', task.base, commit);
  git(root, 'merge-base', '--is-ancestor', commit, 'HEAD');
  const sourceDigest = captureSource(root).digest;
  return registry.revise(id, task.revision, (record) => {
    if (record.development?.reviewed && record.development.sourceDigest !== sourceDigest)
      invalidateDevelopment(record, 'New source differs from the reviewed candidate');
    if (!record.checkpoints.some((entry) => entry.commit === commit))
      record.checkpoints.push({ commit, verification, recordedAt: new Date().toISOString() });
    record.recordedHead = git(root, 'rev-parse', 'HEAD');
  });
}
export function readyTask(root, { id, owner, review }, dependencies = {}) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  owned(task, owner);
  const bytes = readFileSync(reviewFile(root, review, ['.task-runtime'])),
    record = JSON.parse(bytes);
  const latest = task.reviewPasses?.at(-1);
  assert.equal(latest?.digest, digest(bytes), 'Record the complete review and findings history before ready');
  assert.deepEqual(record, latest.document, 'Recorded review content changed');
  const snapshot = captureSource(root);
  const result = validateTaskReview(
    root,
    { ...task, reviewPasses: task.reviewPasses.slice(0, -1) },
    record,
    snapshot.digest,
  );
  assert.equal(result.unresolved.length, 0, 'Unresolved review finding remains');
  assert.equal(result.incomplete.length, 0, 'Unfinished requirement remains');
  assert.equal(result.reverseReviewComplete, true, 'Reverse review is incomplete');
  const proofs = validateDevelopmentChecks(root, record, dependencies);
  assert.equal(captureSource(root).digest, snapshot.digest, 'Candidate changed during readiness validation');
  return registry.revise(id, task.revision, (current) => {
    current.stage = 'dev-validated';
    current.recordedHead = git(root, 'rev-parse', 'HEAD');
    current.development = {
      reviewed: true,
      reviewVersion: 2,
      scopeDigest: task.reviewScope.digest,
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
    if (command !== 'checkpoint') assert.equal(notes, undefined, 'Unexpected task work arguments');
    if (command === 'status') assert.equal(value, undefined, 'Unexpected status arguments');
    assert.ok(
      ['scope', 'review', 'checkpoint', 'ready', 'status'].includes(command),
      'task:work <scope task-id scope-file|review task-id review-file|checkpoint task-id commit verification-note|ready task-id review-file|status task-id>',
    );
    const result =
      command === 'checkpoint'
        ? checkpointTask(process.cwd(), { id, owner, commit: value, verification: notes })
        : command === 'scope'
          ? scopeTask(process.cwd(), { id, owner, scope: value })
          : command === 'review'
            ? reviewTask(process.cwd(), { id, owner, review: value })
            : command === 'status'
              ? taskWorkStatus(process.cwd(), { id, owner })
              : readyTask(process.cwd(), { id, owner, review: value });
    console.log(JSON.stringify(result, null, 2));
    if (command === 'status' && !result.developmentComplete) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
