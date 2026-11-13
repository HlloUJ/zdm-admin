import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readAcceptance, assertAcceptedSource } from './accepted-source.mjs';
import { historicalCommitEvidence } from './task-commit-ownership.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { deliveryStatus } from './completion-status.mjs';

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

export function taskWorkStatus(root, { id, owner }) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  assert.equal(task.owner, owner, 'Current chat must own this exact task');
  const currentHead = git(root, 'rev-parse', 'HEAD');
  return {
    task: id,
    stage: task.stage,
    currentHead,
    recordedHead: task.recordedHead,
    recordedHeadMatches: currentHead === task.recordedHead,
    clean: git(root, 'status', '--porcelain') === '',
    frozen: Boolean(task.frozen),
    verificationProven: false,
    formalDeliveryComplete: deliveryStatus(path.join(registry.commonDir, 'task-delivery', id), id, task)
      .formalDeliveryComplete,
  };
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
    // An old lifecycle label must not certify newly checkpointed source.
    // Retain the original metadata and history rather than rewriting it.
    if (record.stage === 'dev-validated') record.stage = 'developing';
    if (!record.checkpoints.some((entry) => entry.commit === commit))
      record.checkpoints.push({ commit, verification, recordedAt: new Date().toISOString() });
    record.recordedHead = git(root, 'rev-parse', 'HEAD');
  });
}

export function checkpointFrozenHistory(root, args) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id: args.id, worktree: root });
  assert.equal(task.owner, args.owner, 'Current chat must own this exact task');
  const leases = createResourceLeases(registry.commonDir);
  const lease = leases.acquire('task-delivery-' + task.id, task.owner);
  try {
    return checkpointFrozenHistoryLocked(root, args);
  } finally {
    leases.release(lease);
  }
}
function checkpointFrozenHistoryLocked(root, { id, owner, review }) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  assert.equal(task.owner, owner, 'Current chat must own this exact task');
  assert.ok(
    ['frozen', 'blocked'].includes(task.stage) && task.frozen,
    'Only an unmerged frozen task may repair historical ownership',
  );
  const acceptance = readAcceptance(root, id);
  assert.equal(acceptance?.commit, task.frozen.accepted, 'Original accepted source changed');
  const head = git(root, 'rev-parse', acceptance.commit + '^');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head, 'Historical repair requires unchanged frozen development HEAD');
  assert.equal(task.recordedHead, head, 'Recorded source moved after freezing');
  assert.equal(git(root, 'status', '--porcelain'), '', 'Historical repair requires clean source');
  assertAcceptedSource(root, id, head);
  assert.deepEqual(
    { task: review.task, owner: review.owner, revision: review.revision, head: review.head, accepted: review.accepted },
    { task: id, owner, revision: task.revision, head, accepted: acceptance.commit },
    'Review must identify the exact task owner, revision and frozen source',
  );
  const validate = () => {
    const stateFile = path.join(registry.commonDir, 'task-delivery', id, 'completion-session.json');
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      assert.ok(
        !state.closedAt &&
          !state.events.some(
            (event) => event.status === 'running' || (event.name === 'merge' && event.status === 'success'),
          ),
        'Formal writer or merged delivery must be settled before historical repair',
      );
    }
    const plan = historicalCommitEvidence(root, task, head);
    assert.equal(review.originMain, plan.originMain, 'Review main reference changed');
    assert.ok(plan.entries.length, 'No missing historical checkpoints');
    assert.ok(Array.isArray(review.entries), 'Per-commit review evidence required');
    assert.deepEqual(
      review.entries.map(({ commit, parents, diffSha256 }) => ({ commit, parents, diffSha256 })),
      plan.entries,
      'Historical review must cover every exact missing commit and diff, in Git order',
    );
    for (const entry of review.entries)
      assert.ok(text(entry.reason) && entry.reason.length <= 4000, 'Per-commit ownership and scope review required');
    return plan;
  };
  validate();
  return registry.revise(id, task.revision, (record) => {
    // Recheck topology, other task ownership and source inside the registry lock.
    assert.equal(git(root, 'rev-parse', 'HEAD'), head, 'Source moved during historical review');
    assert.equal(git(root, 'status', '--porcelain'), '', 'Source changed during historical review');
    assert.deepEqual(readAcceptance(root, id), acceptance, 'Freeze changed during historical review');
    validate();
    const recordedAt = new Date().toISOString();
    record.checkpoints.push(
      ...review.entries.map((entry) => ({
        commit: entry.commit,
        verification: entry.reason,
        recordedAt,
        historicalReview: {
          owner,
          accepted: acceptance.commit,
          head,
          originMain: review.originMain,
          parents: entry.parents,
          diffSha256: entry.diffSha256,
        },
      })),
    );
  });
}

export function taskWorkCommand(root, args, owner = process.env.CODEX_THREAD_ID) {
  const [command, id, commit, verification] = args;
  assert.ok(
    (command === 'status' && args.length === 2) ||
      (command === 'checkpoint' && args.length === 4) ||
      (command === 'checkpoint-history' && args.length === 3),
    'task:work <checkpoint task-id commit verification-note|checkpoint-history task-id review.json|status task-id>',
  );
  if (command === 'checkpoint-history')
    return checkpointFrozenHistory(root, { id, owner, review: JSON.parse(readFileSync(commit, 'utf8')) });
  return command === 'status'
    ? taskWorkStatus(root, { id, owner })
    : checkpointTask(root, { id, owner, commit, verification });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(taskWorkCommand(process.cwd(), process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
