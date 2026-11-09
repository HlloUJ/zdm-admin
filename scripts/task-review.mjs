import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { captureSource, captureIdentity, captureArtifacts } from './verification-evidence.mjs';
import { collectDeliveryChanges } from './verify.mjs';
import { createValidationPlan } from './check-changed-plan.mjs';

export const reviewDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function reviewFile(root, file, within = ['.task-runtime', '.task-verification']) {
  assert.ok(text(file) && !path.isAbsolute(file), 'Task evidence needs a relative file path');
  const absolute = path.resolve(root, file);
  assert.ok(
    within.some((part) => absolute.startsWith(path.resolve(root, part) + path.sep)),
    'Evidence must belong to this task',
  );
  assert.ok(lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink(), 'Evidence must be a regular file');
  assert.equal(realpathSync(absolute), absolute, 'Linked evidence is unsafe');
  return absolute;
}
function references(root, refs) {
  assert.ok(Array.isArray(refs) && refs.length > 0, 'Actual evidence files and hashes required');
  for (const ref of refs) {
    assert.ok(sha(ref.sha256), 'Evidence SHA-256 required');
    assert.equal(
      reviewDigest(readFileSync(reviewFile(root, ref.file))),
      ref.sha256,
      'Review evidence changed: ' + ref.file,
    );
  }
}
function indexed(items, label) {
  assert.ok(Array.isArray(items) && items.length > 0, label + ' must not be empty');
  assert.ok(
    items.every((item) => text(item.id)),
    label + ' ids required',
  );
  assert.equal(new Set(items.map((item) => item.id)).size, items.length, 'Duplicate ' + label + ' ids');
  return new Map(items.map((item) => [item.id, item]));
}
export function validateReviewScope(root, task, scope) {
  assert.equal(scope.version, 1, 'Unknown approved scope schema');
  assert.equal(scope.task, task.id, 'Approved scope belongs to another task');
  references(root, scope.authorization);
  const requirements = indexed(scope.requirements, 'approved requirements');
  for (const item of requirements.values())
    assert.ok(
      text(item.requirement) && text(item.source) && text(item.acceptance),
      'Original requirement, source and acceptance required',
    );
  const previous = task.reviewScope;
  if (previous) {
    assert.equal(scope.previousScopeDigest, previous.digest, 'Scope amendment must name its original baseline');
    const changed = previous.document.requirements.filter(
      (item) => JSON.stringify(requirements.get(item.id)) !== JSON.stringify(item),
    );
    const amendments = scope.amendments ?? [];
    assert.equal(new Set(amendments.map((item) => item.id)).size, amendments.length, 'Duplicate scope amendments');
    assert.deepEqual(
      amendments.map((item) => item.id).sort(),
      changed.map((item) => item.id).sort(),
      'Cannot silently remove or rewrite approved requirements',
    );
    for (const item of amendments) {
      assert.ok(text(item.reason), 'Approved scope change reason required');
      references(root, item.authorization);
    }
  } else {
    assert.equal(scope.previousScopeDigest ?? null, null, 'No preceding scope exists');
    assert.equal((scope.amendments ?? []).length, 0, 'Initial scope cannot amend another baseline');
  }
}
export function validateTaskReview(root, task, record, sourceDigest) {
  assert.equal(record.version, 2, 'Review v2 with an approved requirement baseline is required');
  assert.equal(record.task, task.id);
  assert.ok(task.reviewScope, 'Register the approved requirement baseline before reviewing');
  assert.equal(record.scopeDigest, task.reviewScope.digest, 'Review belongs to another requirement baseline');
  references(root, task.reviewScope.document.authorization);
  for (const item of task.reviewScope.document.amendments ?? []) references(root, item.authorization);
  assert.equal(record.sourceDigest, sourceDigest, 'Review belongs to an older candidate');
  const required = new Map(task.reviewScope.document.requirements.map((item) => [item.id, item]));
  const items = indexed(record.requirements, 'reviewed requirements');
  assert.deepEqual(
    [...items.keys()].sort(),
    [...required.keys()].sort(),
    'Review must cover every approved requirement exactly once',
  );
  for (const item of items.values()) {
    assert.ok(['met', 'not-applicable', 'pending', 'blocked'].includes(item.result), 'Unknown requirement result');
    if (item.result === 'met') {
      assert.ok(
        Array.isArray(item.implementation) && item.implementation.length > 0 && item.implementation.every(text),
        'Implementation locations required',
      );
      references(root, item.evidence);
    }
    if (item.result === 'not-applicable') {
      assert.ok(text(item.reason), 'Inapplicability needs an explicit reason');
      references(root, item.evidence);
    }
  }
  assert.ok(typeof record.reverseReview?.completed === 'boolean', 'Separate reverse review pass required');
  assert.equal(
    record.reverseReview.basis,
    task.reviewScope.digest,
    'Reverse review must start from the approved requirements',
  );
  if (record.reverseReview.completed) {
    references(root, record.reverseReview.finalDiffEvidence);
    const cases = record.reverseReview.cases;
    assert.ok(Array.isArray(cases) && cases.length > 0, 'Requirement-derived entry and failure scenarios required');
    for (const item of cases) {
      assert.ok(
        required.has(item.requirement) &&
          text(item.entry) &&
          text(item.scenario) &&
          text(item.expected) &&
          text(item.observed),
        'Reverse review case is incomplete',
      );
      references(root, item.evidence);
    }
    assert.deepEqual(
      [...new Set(cases.map((item) => item.requirement))].sort(),
      [...required.keys()].sort(),
      'Reverse review omitted approved requirements',
    );
  }
  assert.ok(Array.isArray(record.findings), 'Findings ledger required');
  assert.equal(new Set(record.findings.map((item) => item.id)).size, record.findings.length, 'Duplicate findings');
  const previous = task.reviewPasses?.at(-1);
  assert.equal(
    record.previousReview ?? null,
    previous?.digest ?? null,
    'Review must continue the original review history',
  );
  const findings = new Map(record.findings.map((item) => [item.id, item]));
  for (const old of previous?.document.findings ?? []) {
    const next = findings.get(old.id);
    assert.ok(next, 'Cannot discard an earlier review finding: ' + old.id);
    for (const key of ['requirement', 'description', 'expected', 'actual'])
      assert.equal(next[key], old[key], 'Original finding must be preserved: ' + old.id);
  }
  for (const item of findings.values()) {
    // Retired requirements can still have historical findings; they are never deleted.
    const known =
      required.has(item.requirement) ||
      task.reviewScopeHistory?.some((scope) => scope.document.requirements.some((r) => r.id === item.requirement));
    assert.ok(
      text(item.id) && known && text(item.description) && text(item.expected) && text(item.actual),
      'Finding must identify its original requirement and discrepancy',
    );
    assert.ok(['open', 'blocked', 'resolved'].includes(item.status), 'Unknown finding status');
    if (item.status === 'resolved') {
      assert.ok(text(item.correction), 'Resolved finding needs an actual correction');
      references(root, item.regressionEvidence);
      references(root, item.recheckEvidence);
    }
  }
  return {
    requirements: required.size,
    unresolved: record.findings.filter((item) => item.status !== 'resolved').map((item) => item.id),
    incomplete: record.requirements
      .filter((item) => !['met', 'not-applicable'].includes(item.result))
      .map((item) => item.id),
    reverseReviewComplete: record.reverseReview.completed,
  };
}
export function assertStoredDevelopmentReview(root, task, dependencies = {}) {
  const capture = dependencies.capture ?? captureSource;
  assert.equal(task.development?.reviewed, true, 'Current task development review is incomplete');
  assert.equal(
    task.development.reviewVersion,
    2,
    'Legacy readiness is historical; record a baseline-bound review before claiming development complete',
  );
  assert.equal(task.stage, 'dev-validated', 'Current development stage is not validated');
  const latest = task.reviewPasses?.at(-1);
  assert.ok(latest && task.reviewScope, 'Requirement and review history missing');
  assert.equal(task.development.scopeDigest, task.reviewScope.digest, 'Approved scope changed after review');
  assert.equal(task.development.reviewDigest, latest.digest, 'A newer review has not passed the readiness gate');
  assert.equal(
    reviewDigest(readFileSync(reviewFile(root, latest.file))),
    latest.digest,
    'Recorded review file changed',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(reviewFile(root, latest.file))),
    latest.document,
    'Stored review content differs from the recorded file',
  );
  const sourceDigest = capture(root).digest;
  assert.equal(sourceDigest, task.development.sourceDigest, 'Current task changed after development review');
  // Validate against the predecessor of the stored pass, rather than itself.
  const result = validateTaskReview(
    root,
    { ...task, reviewPasses: task.reviewPasses.slice(0, -1) },
    latest.document,
    sourceDigest,
  );
  assert.equal(result.unresolved.length, 0, 'Unresolved review finding remains');
  assert.equal(result.incomplete.length, 0, 'Unfinished requirement remains');
  assert.equal(result.reverseReviewComplete, true, 'Reverse review is incomplete');
  validateDevelopmentChecks(root, latest.document, dependencies);
  return result;
}
export function developmentReviewStatus(root, task, dependencies = {}) {
  try {
    const result = assertStoredDevelopmentReview(root, task, dependencies);
    return { developmentComplete: true, ...result, formalDeliveryComplete: false };
  } catch (error) {
    return { developmentComplete: false, reason: error.message, formalDeliveryComplete: false };
  }
}
export function invalidateDevelopment(record, reason) {
  if (record.development?.reviewed) {
    record.developmentHistory ??= [];
    record.developmentHistory.push({ ...record.development, invalidatedAt: new Date().toISOString(), reason });
  }
  record.development = { reviewed: false, reason, formalDeliveryComplete: false };
  if (record.stage === 'dev-validated') record.stage = 'developing';
}

export function validateDevelopmentChecks(root, record, dependencies = {}) {
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
  assert.equal(record.sourceDigest, snapshot.digest, 'Review belongs to an older candidate');
  assert.deepEqual(
    [...(record.reviewedFiles ?? [])].sort(),
    [...new Set(files)].sort(),
    'Authorization review omitted or added changed files',
  );
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
    const proofFile = reviewFile(root, matching[0].file, ['.task-verification']);
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
    assert.equal(reviewDigest(JSON.stringify(proof.identity)), proof.fingerprint, 'Evidence fingerprint changed');
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
      reviewDigest(readFileSync(reviewFile(root, proof.log, ['.task-verification/logs']))),
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
  return proofs;
}
