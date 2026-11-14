import { createHash } from 'node:crypto';

const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Feasibility model only. It has no filesystem writes, runner, registry mutation or live grant
// adapter. Evidence labels below are requirements, not a way to manufacture trusted proof.
export function assessOwnerHandoff({ task, request, evidence, now = Date.now() }) {
  const blockers = [];
  const expected = {
    task: task?.id,
    owner: task?.owner,
    revision: task?.revision,
    head: task?.recordedHead,
    worktree: task?.worktree,
    branch: task?.branch,
    frozen: task?.frozen ?? null,
  };
  const sourceDigest = fingerprint(expected);
  if (!task?.id || !task.owner || !Number.isInteger(task.revision) || !/^[a-f0-9]{40}$/.test(task.recordedHead ?? ''))
    blockers.push('Exact original task identity unavailable');
  if (request?.task !== task?.id || request?.originalOwner !== task?.owner || request?.sourceDigest !== sourceDigest)
    blockers.push('Requested task snapshot differs');
  if (
    !request?.targetOwner ||
    request.targetOwner === task?.owner ||
    evidence?.target?.actualRuntimeIdentity !== request.targetOwner
  )
    blockers.push('Exact new execution identity not established');
  if (
    evidence?.authorization?.task !== task?.id ||
    !evidence?.authorization?.source ||
    evidence.authorization.scopeDigest !== request?.scopeDigest ||
    !request?.scopeDigest
  )
    blockers.push('Original authorized task scope not established');
  // Listing absence/inaccessibility is deliberately not accepted as proof of termination.
  if (
    evidence?.originalWorker?.owner !== task?.owner ||
    evidence?.originalWorker?.status !== 'terminal' ||
    evidence?.originalWorker?.authority !== 'verified-execution-lifecycle'
  )
    blockers.push('Original worker is not proved terminal; unreachable is insufficient');
  if (evidence?.writers?.complete !== true || evidence?.writers?.active !== 0 || evidence?.writers?.pendingTools !== 0)
    blockers.push('Live writers or pending tool effects not ruled out');
  if (evidence?.effects?.status !== 'reconciled' || evidence?.effects?.unknown !== 0)
    blockers.push('Previous operation outcome unknown; replay forbidden');
  if (evidence?.leases?.complete !== true || evidence?.leases?.unresolved !== 0)
    blockers.push('Original queues/resource ownership unresolved');
  if (
    evidence?.snapshotDigest !== sourceDigest ||
    !Number.isFinite(evidence?.observedAt) ||
    evidence.observedAt > now ||
    now - evidence.observedAt > 5000
  )
    blockers.push('Snapshot proof missing, stale or changed');
  if (evidence?.requiresConfirmation !== false) blockers.push('Required confirmation unresolved');
  if (task?.stage === 'closed' || task?.compatibility?.readOnly || task?.previewOnly)
    blockers.push('Task is not eligible for an ownership transition');
  if (
    evidence?.exclusiveCommit?.mechanism !== 'all-writers-generation-fence' ||
    evidence?.exclusiveCommit?.expectedRevision !== task?.revision ||
    evidence?.exclusiveCommit?.nextGeneration !== 1
  )
    blockers.push('No proven single-task CAS and old-writer fence');
  return {
    version: 1,
    sourceDigest,
    blockers,
    modelEligible: blockers.length === 0,
    productionSupported: false,
    canApply: false,
    canReplay: false,
    proposedAudit: blockers.length
      ? null
      : {
          task: task.id,
          originalOwner: task.owner,
          proposedOwner: request.targetOwner,
          expectedRevision: task.revision,
          sourceDigest,
          scopeDigest: request.scopeDigest,
          generation: 1,
          originalEvidenceRetained: true,
        },
  };
}
export function ownerHandoffSnapshot(task) {
  return fingerprint({
    task: task.id,
    owner: task.owner,
    revision: task.revision,
    head: task.recordedHead,
    worktree: task.worktree,
    branch: task.branch,
    frozen: task.frozen ?? null,
  });
}
