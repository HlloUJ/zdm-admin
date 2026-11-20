import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertCompletionQuality } from '../completion-ci-evidence.mjs';
import { deliveryStatus } from '../completion-status.mjs';

const sha = /^[a-f0-9]{40}$/;
export const publishedRepairKey = ':published-ci-repair:';

function successfulCi(state, head, branch, eventName) {
  const event = [...state.events]
    .reverse()
    .find(
      (item) =>
        item.name === 'ci' &&
        item.status === 'success' &&
        item.result?.headSha === head &&
        item.result.branch === branch &&
        item.result.eventName === eventName,
    );
  assert.ok(event, 'Exact successful CI event required for ' + head);
  assertCompletionQuality(event.result, head, String(event.result.runId));
  assert.ok(Number.isFinite(Date.parse(event.result.gatesFinishedAt)), 'Exact CI completion time required');
  return event.result;
}

export function originalRepairPull(gh, repository, number, branch, heads) {
  const pull = gh(
    'pr',
    'view',
    String(number),
    '--repo',
    repository,
    '--json',
    'number,state,headRefOid,headRefName,baseRefName,isCrossRepository,url',
  );
  assert.equal(pull.number, number);
  assert.equal(pull.state, 'OPEN', 'Original PR must remain open');
  assert.equal(pull.headRefName, branch);
  assert.equal(pull.baseRefName, 'main');
  assert.equal(pull.isCrossRepository, false);
  assert.ok(heads.includes(pull.headRefOid), 'Original PR no longer points to the exact old or composed candidate');
  return pull;
}

// Bind the source delta to the delivered repair and to both candidate trees.
// A repair already in the old tree, subsequently overwritten, or applied on
// top of different inputs cannot grant this preparation path.
function assertRepairDelta(git, repairMain, oldHead, candidate) {
  const before = repairMain + '^1';
  const changed = (from, to, ...files) =>
    git('--literal-pathspecs', 'diff', '--name-only', '-z', '--no-renames', from, to, '--', ...files)
      .split('\0')
      .filter(Boolean);
  const files = changed(before, repairMain);
  assert.ok(files.length, 'Published repair has no source change');
  assert.deepEqual(changed(before, oldHead, ...files), [], 'Published repair inputs differ from the failed candidate');
  assert.deepEqual(
    changed(repairMain, candidate, ...files),
    [],
    'Composition does not carry the exact published repair',
  );
}

export function verifyPublishedCiRepair({
  batch,
  state,
  registry,
  git,
  gh,
  repository,
  taskHead,
  main,
  accepted,
  repairId,
  candidate,
}) {
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  assert.match(repairId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.notEqual(repairId, batch.id, 'An independently delivered repair task is required');
  assert.equal(batch.frozen?.accepted, accepted);
  const failures = state.events.filter(
    (item) => item.name === 'ci' && item.status === 'failure' && item.failure?.ci?.headSha === taskHead,
  );
  assert.equal(failures.length, 1, 'One original failed CI event for the exact candidate is required');
  const [failure] = failures;
  const failed = failure.failure.ci;
  assert.match(failed.runId, /^\d+$/);
  assert.equal(failure.key, taskHead + ':' + failed.runId);
  assert.equal(failed.attempt, 1, 'Original first-attempt failure required');
  assert.equal(failed.conclusion, 'failure');
  assert.equal(failed.failedJob?.conclusion, 'failure');
  assert.ok(Number.isSafeInteger(failed.failedJob.id), 'Original failed job required');

  const pulls = state.events.filter(
    (item) =>
      item.name === 'pr' &&
      item.status === 'success' &&
      item.key === taskHead &&
      item.result?.headRefOid === taskHead &&
      item.finishedAt <= failure.startedAt,
  );
  const numbers = [...new Set(pulls.map((item) => item.result.number))];
  assert.equal(numbers.length, 1, 'Original PR for the failed candidate is required');
  const [pullRequest] = numbers;
  assert.ok(Number.isSafeInteger(pullRequest) && pullRequest > 0);
  originalRepairPull(gh, repository, pullRequest, batch.branch, [taskHead]);
  const api = 'repos/' + repository + '/actions/';
  const run = gh('api', api + 'runs/' + failed.runId + '/attempts/1');
  assert.equal(String(run.id), failed.runId);
  assert.equal(run.run_attempt, 1);
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.path, '.github/workflows/quality.yml');
  assert.equal(run.event, 'pull_request');
  assert.equal(run.head_branch, batch.branch);
  assert.equal(run.head_sha, taskHead);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'failure');
  assert.ok(
    run.pull_requests?.some((pull) => pull.number === pullRequest),
    'Run belongs to another PR',
  );

  const job = gh('api', api + 'jobs/' + failed.failedJob.id);
  assert.equal(job.id, failed.failedJob.id);
  assert.equal(job.name, failed.failedJob.name);
  assert.equal(job.completed_at, failed.failedJob.completedAt);
  assert.equal(job.conclusion, 'failure');
  assert.equal(job.status, 'completed');
  assert.equal(job.run_attempt, 1);
  assert.equal(String(job.run_id), failed.runId);
  assert.equal(job.head_sha, taskHead);

  const repair = registry.readTask(repairId);
  assert.equal(repair?.stage, 'closed', 'Repair task must be formally delivered');
  const directory = path.join(registry.commonDir, 'task-delivery', repairId);
  const receipt = deliveryStatus(directory, repairId, repair);
  assert.equal(receipt.formalDeliveryComplete, true, 'Repair task requires its formal completion receipt');
  const repairMain = receipt.main;
  assert.ok(
    git('rev-list', '--first-parent', main).split('\n').includes(repairMain),
    'Repair is absent from published main',
  );
  const parents = git('show', '-s', '--format=%P', repairMain).split(' ');
  assert.deepEqual(parents.slice(1), [repair.recordedHead], 'Published merge is not the exact independent repair');
  const repairState = JSON.parse(readFileSync(path.join(directory, 'completion-session.json'), 'utf8'));
  const repairCi = successfulCi(repairState, repairMain, 'main', 'push');
  assert.ok(
    Date.parse(job.completed_at) < Date.parse(repairCi.gatesFinishedAt),
    'Repair main CI must follow the original failure',
  );
  assertRepairDelta(git, repairMain, taskHead, candidate);
  return {
    accepted,
    taskHead,
    main,
    candidate,
    failureEventId: failure.id,
    failureRunId: failed.runId,
    pullRequest,
    repairId,
    repairMain,
    repairRunId: String(repairCi.runId),
    repairVerifiedAt: repairCi.gatesFinishedAt,
  };
}

export function hasAppliedPublishedCiRepair(state, failed, batch, finalMain, runId, git) {
  const plans = state.events.filter(
    (event) =>
      event.name === 'prepare' &&
      event.status === 'success' &&
      event.result?.publishedRepair?.failureEventId === failed.id,
  );
  if (!plans.length) return false;
  for (const {
    result: { publishedRepair: repair },
  } of plans) {
    assert.equal(repair.accepted, batch.frozen?.accepted);
    assert.equal(repair.taskHead, failed.failure.ci.headSha);
    assert.equal(repair.failureRunId, failed.failure.ci.runId);
    assert.match(repair.candidate, sha);
    assert.notEqual(repair.candidate, repair.taskHead);
    const prepared = state.preparedCandidates?.find((item) => item.head === repair.candidate);
    if (!prepared) continue;
    assert.equal(prepared.pullRequest, repair.pullRequest);
    assert.equal(prepared.accepted, repair.accepted);
    const pr = successfulCi(state, repair.candidate, batch.branch, 'pull_request');
    assert.equal(String(pr.runId), prepared.runId);
    const main = successfulCi(state, finalMain, 'main', 'push');
    assert.equal(String(main.runId), runId);
    assert.equal(new Set([repair.failureRunId, repair.repairRunId, prepared.runId, runId]).size, 4);
    assert.ok(Date.parse(failed.failure.ci.failedJob.completedAt) < Date.parse(repair.repairVerifiedAt));
    assert.ok(Date.parse(repair.repairVerifiedAt) < Date.parse(pr.gatesFinishedAt));
    assert.ok(Date.parse(pr.gatesFinishedAt) < Date.parse(main.gatesFinishedAt));
    git('merge-base', '--is-ancestor', repair.candidate, finalMain);
    assertRepairDelta(git, repair.repairMain, repair.taskHead, finalMain);
    return true;
  }
  return false;
}
