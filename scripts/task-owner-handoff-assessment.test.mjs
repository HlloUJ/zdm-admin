import test from 'node:test';
import assert from 'node:assert/strict';
import { assessOwnerHandoff, ownerHandoffSnapshot } from './task-owner-handoff-assessment.mjs';
const fixture = () => {
  const task = {
    id: 'fixture-task',
    owner: 'old-owner',
    revision: 4,
    recordedHead: 'a'.repeat(40),
    worktree: '/fixture/worktree',
    branch: 'codex/fixture-task',
    stage: 'developing',
  };
  const sourceDigest = ownerHandoffSnapshot(task);
  return {
    task,
    request: {
      task: task.id,
      originalOwner: task.owner,
      sourceDigest,
      targetOwner: 'new-owner',
      scopeDigest: 'approved-scope',
    },
    now: 1000,
    evidence: {
      target: { actualRuntimeIdentity: 'new-owner' },
      authorization: { task: task.id, source: 'fixture-user-authorization', scopeDigest: 'approved-scope' },
      originalWorker: { owner: task.owner, status: 'terminal', authority: 'verified-execution-lifecycle' },
      writers: { complete: true, active: 0, pendingTools: 0 },
      effects: { status: 'reconciled', unknown: 0 },
      leases: { complete: true, unresolved: 0 },
      snapshotDigest: sourceDigest,
      observedAt: 1000,
      requiresConfirmation: false,
      exclusiveCommit: { mechanism: 'all-writers-generation-fence', expectedRevision: 4, nextGeneration: 1 },
    },
  };
};
test('even a fully supplied model is not a live authorization or production grant', () => {
  const input = fixture(),
    before = JSON.stringify(input),
    result = assessOwnerHandoff(input);
  assert.equal(result.modelEligible, true);
  assert.equal(result.canApply, false);
  assert.equal(result.canReplay, false);
  assert.equal(result.productionSupported, false);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.proposedAudit.originalOwner, 'old-owner');
});
test('observed cross-automation native-worker absence blocks transfer', () => {
  const input = fixture();
  input.evidence.originalWorker = { owner: 'old-owner', status: 'unreachable', authority: 'current-agent-list' };
  const result = assessOwnerHandoff(input);
  assert.equal(result.modelEligible, false);
  assert.ok(result.blockers.some((x) => x.includes('unreachable is insufficient')));
});
test('live writer, pending tool, unknown side effect, resource lease and missing confirmation each block', () => {
  for (const change of [
    (x) => {
      x.writers.active = 1;
    },
    (x) => {
      x.writers.pendingTools = 1;
    },
    (x) => {
      x.effects.unknown = 1;
    },
    (x) => {
      x.leases.unresolved = 1;
    },
    (x) => {
      x.requiresConfirmation = true;
    },
  ]) {
    const input = fixture();
    change(input.evidence);
    assert.equal(assessOwnerHandoff(input).modelEligible, false);
  }
});
test('changed candidate/target/scope and stale evidence cannot authorize takeover', () => {
  for (const change of [
    (x) => {
      x.task.recordedHead = 'b'.repeat(40);
    },
    (x) => {
      x.request.targetOwner = 'someone-else';
    },
    (x) => {
      x.request.scopeDigest = 'expanded';
    },
    (x) => {
      x.now = 6001;
    },
    (x) => {
      x.task.revision++;
    },
  ]) {
    const input = fixture();
    change(input);
    assert.equal(assessOwnerHandoff(input).modelEligible, false);
  }
});
test('current registry without a generation fence remains ineligible', () => {
  const input = fixture();
  input.evidence.exclusiveCommit = { mechanism: 'current-owner-equality', expectedRevision: 4 };
  assert.equal(assessOwnerHandoff(input).modelEligible, false);
});
test('isolated compare-and-swap model admits one successor and retains original owner', async () => {
  // Fixture only; no actual task registry is read or written.
  const state = { revision: 4, originalOwner: 'old-owner', effectiveOwner: 'old-owner', generation: 0 };
  const commit = (plan) => {
    if (state.revision !== plan.expectedRevision || state.generation !== 0) return false;
    state.effectiveOwner = plan.proposedOwner;
    state.revision++;
    state.generation++;
    return true;
  };
  const plan = assessOwnerHandoff(fixture()).proposedAudit;
  const results = await Promise.all([
    Promise.resolve().then(() => commit(plan)),
    Promise.resolve().then(() => commit(plan)),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(state.originalOwner, 'old-owner');
  assert.equal(state.generation, 1);
});
