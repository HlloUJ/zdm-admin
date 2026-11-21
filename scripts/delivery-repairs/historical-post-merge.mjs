import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  acceptedRef,
  assertAcceptedSource,
  readAcceptance,
  sourceDifference,
  sourceEntries,
} from '../accepted-source.mjs';
import { ACCEPTED_SOURCE_CHECK } from '../accepted-source-policy.mjs';
import { assertCompletionQuality } from '../completion-ci-evidence.mjs';
import { deliveryStatus } from '../completion-status.mjs';
import { isRuntimeFile } from '../runtime-file-scope.mjs';
import { deliveryCiCapability } from '../verification-policy.mjs';

export const POST_MERGE_SOURCE = {
  task: 'trusted-749-single-parent-continuation',
  head: '46349d67d40e89580a32ec24abd360a49b08680b',
  main: 'f8203f37825c59e29631ca9f2d459aa5bafd7af5',
  pullRequest: 162,
  prRunId: '44889372275',
  mainRunId: '44900850590',
};
export const POST_MERGE_MAINTENANCE = 'historical-acceptance-postmerge-recovery-590';
const maintenancePaths = new Set([
  'docs/engineering/accepted-source-delivery.md',
  'docs/task-completion.md',
  'scripts/accepted-source.mjs',
  'scripts/accepted-source.test.mjs',
  'scripts/completion-cli.mjs',
  'scripts/completion-cli.test.mjs',
  'scripts/completion-flow.mjs',
  'scripts/completion-handoff.mjs',
  'scripts/delivery-repairs/historical-post-merge.mjs',
  'scripts/delivery-repairs/historical-post-merge.test.mjs',
  'scripts/task-completion.mjs',
  'scripts/task-completion-progress.mjs',
  'scripts/test-domain-manifest.json',
]);
const oid = /^[a-f0-9]{40}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const runId = /^\d+$/;

function readPrivate(file) {
  const info = lstatSync(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077), 'Unsafe private delivery evidence');
  return JSON.parse(readFileSync(file));
}

export function assertOriginalPostMergeTurn(queue, lease, task, ticketId, { active = false } = {}) {
  assert.match(ticketId, uuid);
  const ticket = queue.inspect().tickets.find((item) => !item.deferred?.release || item.status !== 'waiting');
  assert.equal(ticket?.id, ticketId, 'Exact original FIFO head required');
  assert.equal(ticket.task, task.id);
  assert.equal(ticket.owner, task.owner);
  assert.equal(ticket.accepted, task.frozen?.accepted);
  assert.equal(ticket.initialHead, task.recordedHead);
  assert.ok(ticket.mainMutationStarted && ticket.purpose === 'delivery' && !ticket.deferred);
  assert.ok(['running', 'blocked'].includes(ticket.status), 'Original post-merge block required');
  assert.deepEqual(ticket.lease, lease, 'Original main delivery lease changed');
  assert.equal(lease?.resource, 'main-delivery');
  assert.equal(lease.task, ticket.id);
  if (active) {
    assert.equal(ticket.status, 'running');
    assert.equal(lease.pid, process.pid, 'Current process must own the main delivery turn');
  }
  return ticket;
}

function ciEvent(state, evidence, branch, eventName) {
  const event = state.events.findLast(
    (item) => item.name === 'ci' && item.key === evidence.head + ':' + evidence.runId && item.status === 'success',
  );
  assert.ok(event, 'Original successful CI stage missing');
  assertCompletionQuality(event.result, evidence.head, evidence.runId);
  assert.equal(event.result.eventName, eventName);
  assert.equal(event.result.branch, branch);
}

function originalFailure(directory, ticket) {
  const dir = path.join(directory, 'queue-attempts');
  assert.ok(lstatSync(dir).isDirectory(), 'Original failed queue attempt missing');
  const attempts = readdirSync(dir)
    .filter((file) => file.startsWith(ticket.id + '-') && file.endsWith('.json'))
    .map((file) => readPrivate(path.join(dir, file)));
  assert.ok(
    attempts.some(
      (item) =>
        item.id === ticket.id &&
        item.task === ticket.task &&
        item.owner === ticket.owner &&
        item.accepted === ticket.accepted &&
        item.initialHead === ticket.initialHead &&
        item.mainMutationStarted === true &&
        item.purpose === 'delivery' &&
        item.outcome === 'failure' &&
        item.lease?.task === ticket.id &&
        typeof item.failure === 'string' &&
        item.failure.length > 0,
    ),
    'Original post-merge failure must be retained',
  );
}

function verifyApproval(common, task, prepared, original, review, coordination, ledger) {
  assert.equal(review?.provider, 'codex-native-read_thread');
  assert.equal(review.threadId, coordination?.current.rootThreadId);
  assert.notEqual(review.threadId, prepared.executor);
  assert.notEqual(review.threadId, task.monitoring?.worker ?? task.owner);
  assert.ok(review.turnId && review.message?.id && review.message.phase === 'commentary');
  const approved =
    '维护发布批准 ' +
    [
      POST_MERGE_MAINTENANCE,
      'PR #' + prepared.pullRequest,
      prepared.head,
      original.main,
      'CI ' + prepared.prRunId,
    ].join(' ');
  assert.equal(review.message.text.trim(), approved, 'Exact independent maintenance approval required');
  const observedAt = Date.parse(review.observedAt);
  assert.ok(Number.isFinite(observedAt) && observedAt <= Date.now(), 'Invalid native approval observation');

  const decision = ledger.dynamicDecisions?.find((item) => item.id === prepared.preparation);
  assert.equal(decision?.status, 'finished', 'Original maintenance preparation must be finished');
  assert.equal(decision.coordinator, review.threadId);
  assert.equal(decision.input.expectedCoordinationRevision, coordination.revision);
  assert.equal(decision.input.phase, 'preparation');
  assert.equal(decision.input.task, POST_MERGE_MAINTENANCE);
  assert.equal(decision.input.executor, prepared.executor);
  for (const [key, value] of Object.entries({
    head: prepared.head,
    accepted: prepared.accepted,
    pullRequest: prepared.pullRequest,
    runId: prepared.prRunId,
  }))
    assert.equal(decision.prepared[key], value, 'Maintenance preparation identity changed: ' + key);

  const recorded = readPrivate(path.join(common, 'task-delivery', POST_MERGE_MAINTENANCE, 'completion-session.json'));
  assert.equal(recorded.batch, POST_MERGE_MAINTENANCE);
  const matching = recorded.preparedCandidates?.filter(({ head }) => head === prepared.head) ?? [];
  assert.equal(matching.length, 1, 'Exact maintenance candidate must have been prepared');
  for (const key of ['head', 'accepted', 'pullRequest'])
    assert.equal(matching[0][key], prepared[key], 'Maintenance preparation record changed: ' + key);
  assert.equal(matching[0].runId, prepared.prRunId);
  ciEvent(
    recorded,
    { head: prepared.head, runId: prepared.prRunId },
    'codex/' + POST_MERGE_MAINTENANCE,
    'pull_request',
  );
}

export function verifyMaintenanceTree(anchor, base, main, git) {
  const before = sourceEntries(anchor, base, true),
    after = sourceEntries(anchor, main, true);
  const files = sourceDifference(before, after);
  const oldEntries = new Map(before.map((entry) => [entry.file, entry])),
    newEntries = new Map(after.map((entry) => [entry.file, entry]));
  assert.ok(
    files.includes('scripts/accepted-source.mjs') &&
      files.includes('scripts/delivery-repairs/historical-post-merge.mjs'),
    'Required historical acceptance and handoff maintenance missing',
  );
  for (const file of files) {
    assert.ok(maintenancePaths.has(file) && !isRuntimeFile(file), 'Unrelated main change: ' + file);
    assert.equal(newEntries.get(file)?.mode, '100644', 'Maintenance path removed or changed mode: ' + file);
    assert.ok(!oldEntries.has(file) || oldEntries.get(file).mode === '100644', 'Invalid maintenance input: ' + file);
  }
  assert.equal(git('rev-parse', main + '^1'), base, 'Maintenance must immediately follow the original merge');
  return files;
}

function liveQuality(api, workflow, { head, runId: id, branch, event, pullRequest }) {
  const route = 'actions/runs/' + id;
  const live = api(route);
  assert.equal(String(live.id), id);
  assert.equal(live.workflow_id, workflow);
  assert.equal(live.run_attempt, 1);
  assert.equal(live.event, event);
  assert.equal(live.head_branch, branch);
  assert.equal(live.status, 'completed');
  assert.equal(live.path, '.github/workflows/quality.yml');
  // The API can omit PR associations for a push to a branch in the same repository.
  // The independently matched PR and the recorded exact run still bind the head.
  if (pullRequest && live.pull_requests?.length) {
    assert.ok(
      live.pull_requests?.some((pr) => pr.number === pullRequest && pr.head.sha === head),
      'CI run is not attached to the exact review PR',
    );
  }
  const jobs = api(route + '/jobs?filter=all&per_page=100');
  assert.equal(jobs.jobs.length, jobs.total_count, 'Incomplete job readback');
  assert.ok(
    jobs.jobs.every((job) => String(job.run_id) === id && job.run_attempt === 1),
    'Job run changed',
  );
  assertCompletionQuality(
    { runId: id, headSha: live.head_sha, attempt: live.run_attempt, conclusion: live.conclusion, jobs: jobs.jobs },
    head,
    id,
  );
}

function exactMergedPr(api, repository, { number, branch, head, main }) {
  const pull = api('pulls/' + number);
  assert.equal(pull.number, number);
  assert.equal(pull.state, 'closed');
  assert.equal(pull.merged, true);
  assert.equal(pull.merge_commit_sha, main);
  assert.equal(pull.base.ref, 'main');
  assert.equal(pull.head.ref, branch);
  assert.equal(pull.base.repo.full_name, repository);
  assert.equal(pull.head.repo.full_name, repository);
  assert.equal(pull.head.sha, head);
}

function protectedMaintenanceApi(anchor, execute, head) {
  const capability = deliveryCiCapability(anchor, (command, args) => execute(anchor, command, args));
  assert.equal(capability.verified, true, 'Protected main quality policy must be proven');
  const api = (route) => JSON.parse(execute(anchor, 'gh', ['api', 'repos/' + capability.repository + '/' + route]));
  const protection = api('branches/main/protection');
  assert.equal(protection.allow_force_pushes?.enabled, false);
  assert.equal(protection.allow_deletions?.enabled, false);
  const requiredSource = protection.required_status_checks?.checks?.find(
    ({ context }) => context === ACCEPTED_SOURCE_CHECK,
  );
  assert.ok(
    protection.required_status_checks.contexts.includes(ACCEPTED_SOURCE_CHECK) && requiredSource?.app_id > 0,
    'Trusted source check must be required on main',
  );
  const checks = api('commits/' + head + '/check-runs?per_page=100');
  assert.equal(checks.check_runs.length, checks.total_count, 'Incomplete source check readback');
  assert.equal(
    checks.check_runs.filter(
      (check) =>
        check.name === ACCEPTED_SOURCE_CHECK &&
        check.app?.id === requiredSource.app_id &&
        check.head_sha === head &&
        check.status === 'completed' &&
        check.conclusion === 'success',
    ).length,
    1,
    'Exact approved maintenance source check is missing',
  );
  return { api, capability };
}

export function verifyPostMergeMaintenance(
  { anchor, common, task, ticket, state, main, mainRunId, execute, coordination, ledger },
  original = POST_MERGE_SOURCE,
) {
  assert.equal(task.id, original.task);
  assert.equal(task.branch, 'codex/' + original.task);
  assert.ok(['main-verified', 'handoff-verified', 'closed'].includes(task.stage));
  assert.equal(task.recordedHead, original.head);
  assert.equal(task.main?.local, original.main);
  assert.equal(task.main?.remote, original.main);
  if (task.stage !== 'closed') assert.equal(task.main.runId, original.mainRunId);
  assert.equal(state.batch, task.id);
  assert.ok(state.startedAt !== null && !state.deferredSettlement);
  assert.ok(
    state.events.every((item) => item.status !== 'running'),
    'Another completion stage is still active',
  );
  assert.ok(
    state.events.some(
      (item) => item.name === 'handoff' && item.key === original.main + ':final' && item.status === 'failure',
    ),
    'Original final handoff failure missing',
  );
  originalFailure(path.join(common, 'task-delivery', task.id), ticket);
  ciEvent(state, { head: original.head, runId: original.prRunId }, task.branch, 'pull_request');
  ciEvent(state, { head: original.main, runId: original.mainRunId }, 'main', 'push');

  assert.match(main, oid);
  assert.match(mainRunId, runId);
  const grant = readPrivate(path.join(common, 'task-delivery', task.id, 'post-merge-maintenance.json'));
  assert.deepEqual(
    { version: grant.version, task: grant.task, owner: grant.owner, ticket: grant.ticket, accepted: grant.accepted },
    { version: 1, task: task.id, owner: task.owner, ticket: ticket.id, accepted: task.frozen.accepted },
    'Independent approval applies to a different original ticket or freeze',
  );
  const prepared = grant.maintenance;
  assert.match(prepared.head, oid);
  assert.match(prepared.accepted, oid);
  assert.match(prepared.prRunId, runId);
  assert.ok(Number.isSafeInteger(prepared.pullRequest) && prepared.pullRequest > 0);
  assert.notEqual(prepared.pullRequest, original.pullRequest);
  assert.equal(prepared.base, original.main);
  verifyApproval(common, task, prepared, original, grant.review, coordination, ledger);

  const git = (...args) => execute(anchor, 'git', ['--no-replace-objects', ...args]);
  git('fetch', 'origin');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('rev-parse', 'HEAD'), main, 'Use the published maintenance main checkout');
  assert.equal(git('rev-parse', 'origin/main'), main, 'Unexpected successor main');
  const acceptance = readAcceptance(anchor, task.id);
  assert.equal(acceptance?.commit, task.frozen.accepted);
  assert.equal(acceptance.tree, task.frozen.tree);
  assert.equal(acceptance.businessDigest, task.frozen.businessDigest);
  assertAcceptedSource(anchor, task.id, original.head);
  assertAcceptedSource(anchor, task.id, original.main);
  const tree = (commit) => git('rev-parse', commit + '^{tree}');
  assert.equal(tree(original.head), tree(original.main), 'Original candidate tree changed');
  assert.equal(git('rev-parse', original.main + '^2'), original.head);
  assert.equal(git('rev-list', '--parents', '-n', '1', main), [main, original.main, prepared.head].join(' '));
  assert.equal(git('rev-list', '--parents', '-n', '1', prepared.head), [prepared.head, original.main].join(' '));
  assert.equal(tree(main), tree(prepared.head), 'Published maintenance differs from the approved candidate');
  verifyMaintenanceTree(anchor, original.main, main, git);
  assert.equal(assertAcceptedSource(anchor, POST_MERGE_MAINTENANCE, main).accepted, prepared.accepted);
  const tag = acceptedRef(POST_MERGE_MAINTENANCE);
  assert.equal(git('ls-remote', 'origin', tag), prepared.accepted + '\t' + tag);

  const { api, capability } = protectedMaintenanceApi(anchor, execute, prepared.head);
  const maintenanceBranch = 'codex/' + POST_MERGE_MAINTENANCE;
  for (const entry of [
    {
      number: original.pullRequest,
      branch: task.branch,
      head: original.head,
      main: original.main,
      prRunId: original.prRunId,
      mainRunId: original.mainRunId,
    },
    {
      number: prepared.pullRequest,
      branch: maintenanceBranch,
      head: prepared.head,
      main,
      prRunId: prepared.prRunId,
      mainRunId,
    },
  ]) {
    exactMergedPr(api, capability.repository, entry);
    liveQuality(api, capability.workflow, {
      head: entry.head,
      runId: entry.prRunId,
      event: 'pull_request',
      branch: entry.branch,
      pullRequest: entry.number,
    });
    liveQuality(api, capability.workflow, {
      head: entry.main,
      runId: entry.mainRunId,
      event: 'push',
      branch: 'main',
    });
  }
  assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), main + '\trefs/heads/main', 'Remote main changed');
  return {
    main,
    originalMain: original.main,
    maintenance: { main, head: prepared.head, pullRequest: prepared.pullRequest, prRunId: prepared.prRunId, mainRunId },
  };
}

// An independently published maintenance PR has no ordinary pre-merge final
// scope of its own. Only a verified original closeout can establish this
// specific candidate's alternative path; never synthesize a readiness event.
export function verifyMaintenanceCloseoutReadiness(
  { anchor, registry, batch, head, pr, state, execute },
  source = POST_MERGE_SOURCE,
) {
  if (batch.id !== POST_MERGE_MAINTENANCE) return false;
  const original = registry.readTask(source.task);
  assert.equal(original?.stage, 'closed', 'Original 590 settlement must complete first');
  const directory = path.join(registry.commonDir, 'task-delivery', original.id);
  const publication = readPrivate(path.join(directory, 'post-merge-maintenance-publication.json'));
  const receipt = readPrivate(path.join(directory, 'completion-receipt.json'));
  assert.equal(deliveryStatus(directory, original.id, original).formalDeliveryComplete, true);
  assert.equal(publication.version, 1);
  assert.match(publication.ticket, uuid);
  assert.equal(publication.originalMain, source.main);
  assert.equal(receipt.remoteSnapshot?.main, source.main);
  assert.deepEqual(receipt.remoteSnapshot?.lineage, {
    main: publication.main,
    originalMain: publication.originalMain,
    maintenance: publication.maintenance,
  });
  assert.deepEqual(receipt.results?.handoff?.result?.lineage, receipt.remoteSnapshot.lineage);

  const maintenance = publication.maintenance;
  assert.equal(maintenance.main, publication.main);
  assert.equal(maintenance.main, pr.mergeCommit?.oid);
  assert.equal(maintenance.pullRequest, pr.number);
  assert.equal(maintenance.head, head);
  assert.match(maintenance.main, oid);
  assert.match(maintenance.mainRunId, runId);
  assert.match(maintenance.prRunId, runId);
  const preparation = state.preparedCandidates?.find((candidate) => candidate.head === head);
  assert.equal(preparation?.pullRequest, pr.number);
  assert.equal(preparation.runId, maintenance.prRunId);
  assert.equal(preparation.accepted, batch.frozen.accepted);
  ciEvent(state, { head, runId: maintenance.prRunId }, batch.branch, 'pull_request');

  const git = (...args) => execute(anchor, 'git', ['--no-replace-objects', ...args]);
  git('fetch', 'origin');
  assert.equal(git('rev-parse', 'origin/main'), maintenance.main);
  assert.equal(git('rev-parse', 'HEAD'), maintenance.main);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(
    git('rev-list', '--parents', '-n', '1', maintenance.main),
    [maintenance.main, source.main, head].join(' '),
  );
  assert.equal(git('rev-parse', maintenance.main + '^{tree}'), git('rev-parse', head + '^{tree}'));
  verifyMaintenanceTree(anchor, source.main, maintenance.main, git);
  assert.equal(assertAcceptedSource(anchor, batch.id, head).accepted, batch.frozen.accepted);

  const { api, capability } = protectedMaintenanceApi(anchor, execute, head);
  exactMergedPr(api, capability.repository, { number: pr.number, branch: batch.branch, head, main: maintenance.main });
  liveQuality(api, capability.workflow, {
    head,
    runId: maintenance.prRunId,
    branch: batch.branch,
    event: 'pull_request',
    pullRequest: pr.number,
  });
  liveQuality(api, capability.workflow, {
    head: maintenance.main,
    runId: maintenance.mainRunId,
    branch: 'main',
    event: 'push',
  });
  assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), maintenance.main + '\trefs/heads/main');
  return true;
}
