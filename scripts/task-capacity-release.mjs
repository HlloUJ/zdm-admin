import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { taskExecutor } from './task-execution-binding.mjs';
import { verifyCancellation } from './task-cancellation-proof.mjs';
import { assertAcceptedSource } from './accepted-source.mjs';
import { coordinationDigest } from './task-coordination-next.mjs';

const git = (root, ...args) =>
  execFileSync('git', ['--no-optional-locks', '--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();

export function capacityReleaseProof(registry, ticket, task, { observe } = {}) {
  assert.equal(ticket.task, task.id);
  assert.equal(ticket.owner, task.owner);
  function source() {
    const head = git(task.worktree, 'rev-parse', 'HEAD');
    assert.equal(git(task.worktree, 'branch', '--show-current'), task.branch);
    assert.equal(head, task.recordedHead, 'Checkpoint the exact candidate before releasing capacity');
    assert.equal(git(task.worktree, 'status', '--porcelain'), '', 'Uncommitted source prevents safe release');
    assert.ok(
      task.checkpoints.some((point) => point.commit === head) || head === task.startHead,
      'The exact checkpoint must be registered',
    );
    if (task.frozen) assertAcceptedSource(task.worktree, task.id, head);
    return {
      head,
      tree: git(task.worktree, 'rev-parse', head + '^{tree}'),
      revision: task.revision,
      branch: task.branch,
      bindingRevision: task.executionBindings?.at(-1)?.revision ?? 0,
      executor: taskExecutor(task),
      accepted: task.frozen?.accepted ?? null,
    };
  }
  const checkpoint = source();
  // Same rigorous observation as cancel-plan, but no user cancellation, task
  // cancellation, evidence deletion, or resource release is performed here.
  const idle = verifyCancellation(registry, ticket, { observe });
  assert.deepEqual(source(), checkpoint, 'Checkpoint changed during idle check');
  assert.equal(idle.sourcePresent, true, 'Original worktree is required for a continuation point');
  return { checkpoint, idle };
}

export function releaseIdleCapacity(state, input, verify) {
  const { task, lane, owner, admission, expectedQueueRevision, action, recovery } = input;
  const record = state.tickets.find((item) => item.lane === lane && item.task === task);
  assert.equal(record?.owner, owner);
  assert.equal(record.admission, admission, 'Exact fenced admission required');
  if (record.status === 'parked') {
    assert.equal(record.capacityRelease.inputDigest, coordinationDigest(input), 'Release replay changed');
    verify(record, { replay: true });
    return structuredClone(record);
  }
  assert.equal(record.status, 'blocked', 'Only a fenced, blocked task can release idle capacity');
  assert.equal(state.revision, expectedQueueRevision);
  assert.ok(
    ![state.scopedAdmission, ...(state.scopedAdmissions ?? [])].some(
      (scope) => scope?.task === task && scope.lane === lane,
    ),
    'Live admission must be fenced first',
  );
  assert.ok(
    !(state.dynamicDecisions ?? []).some((decision) => decision.status === 'reserved' && decision.input.task === task),
    'Unknown dispatch must be read back first',
  );
  assert.ok(
    lane === 'development' ? action === 'development' : ['preparation', 'final'].includes(action),
    'Exact continuation action required',
  );
  assert.ok(
    recovery &&
      ['dependency', 'resource'].includes(recovery.kind) &&
      typeof recovery.reason === 'string' &&
      recovery.reason.trim(),
    'Concrete recovery condition required',
  );
  if (recovery.kind === 'dependency')
    assert.match(recovery.task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Exact dependency task required');
  const { checkpoint, idle, coordinator } = verify(record, { replay: false });
  assert.equal(idle?.outcome, 'quiescent', 'Fresh evidence of an idle task is required');
  for (const key of ['task', 'lane', 'owner', 'admission']) assert.equal(idle[key], record[key]);
  assert.equal(checkpoint.head, idle.originalHead);
  const paused = state.events.findLast((event) => event.action === 'pause-all');
  const proof = {
    inputDigest: coordinationDigest(input),
    checkpoint,
    idle,
    coordinator,
    action,
    recovery,
    reason: record.reason,
    pauseSequence: paused?.request.sequence ?? 0,
  };
  // Keep original admission identity for provenance; parked is not an executable
  // state and does not count as occupied. A fresh dispatch must rotate it.
  record.capacityRelease = proof;
  record.status = 'parked';
  state.events.push({ action: 'capacity-released', task, lane, release: coordinationDigest(proof) });
  return structuredClone(record);
}

export function validateReleasedCapacity(state, ticket) {
  if (ticket.status !== 'parked') return;
  const release = ticket.capacityRelease;
  assert.equal(release?.idle?.outcome, 'quiescent', 'Parked task lacks original idle proof');
  assert.equal(ticket.admission, release.idle.admission, 'Parked admission history changed');
  assert.ok(
    state.events.some(
      (event) =>
        event.action === 'capacity-released' &&
        event.task === ticket.task &&
        event.lane === ticket.lane &&
        event.release === coordinationDigest(release),
    ),
    'Capacity release event is missing',
  );
}

export function assertParkedContinuation(state, ticket, proof, phase) {
  if (ticket.status !== 'parked') return;
  const { checkpoint, action, pauseSequence, recovery } = ticket.capacityRelease;
  assert.equal(phase, action, 'New action needs its own authorization');
  if (recovery.kind === 'dependency')
    assert.ok(
      proof.dependencies?.some((item) => item.task === recovery.task && item.ready),
      'The recorded dependency has no fresh proof for this action',
    );
  assert.equal(proof.sourceProof.head, checkpoint.head, 'Parked candidate changed');
  assert.equal(proof.task.recordedHead, checkpoint.head, 'Parked registry checkpoint changed');
  assert.equal(proof.task.branch, checkpoint.branch, 'Parked branch changed');
  assert.equal(proof.task.frozen?.accepted ?? null, checkpoint.accepted ?? null, 'Parked original freeze changed');
  assert.equal(proof.executor, checkpoint.executor, 'Parked executor changed');
  assert.equal(proof.bindingRevision, checkpoint.bindingRevision, 'Parked execution binding changed');
  const lastPause = state.events.findLast((event) => event.action === 'pause-all')?.request.sequence ?? 0;
  assert.ok(
    lastPause === pauseSequence || proof.authoritySequence > lastPause,
    'A later user pause fences this continuation',
  );
}
