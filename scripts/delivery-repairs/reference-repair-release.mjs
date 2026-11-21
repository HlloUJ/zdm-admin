import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url);
const file = 'scripts/delivery-repairs/reference-repair-release.mjs';
const id = 'historical-acceptance-postmerge-recovery-590';
const branch = 'codex/' + id;
const original = {
  head: '8342a2122c73925b3e9e2e3b64caa82dde0f7fbb',
  main: '879bd045eb6b104e7417b90771b64141ca0d74c6',
  accepted: '38ae5a147c8c7fec7f0239866a6de81953116f98',
  pr: 166,
  prRun: '44907343460',
  mainRun: '44909383673',
};
const paths = new Set([
  'docs/task-completion.md',
  'docs/engineering/readonly-preview-reference-proof.md',
  'scripts/completion-flow.mjs',
  'scripts/delivery-repairs/preview-reference-proof.mjs',
  'scripts/delivery-repairs/reference-repair-release.mjs',
  'scripts/delivery-repairs/reference-repair-release.test.mjs',
  'scripts/test-domain-manifest.json',
]);
const sha = /^[a-f0-9]{40}$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runId = /^\d+$/;
const firstFailure = '4d8350038f38e318b525ab3fcded8e254d210c807bbad476ffa99279ee195462';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function privateFile(file) {
  const info = lstatSync(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && (info.mode & 0o077) === 0);
  return readFileSync(file);
}

export function referenceRepairApproval(grant) {
  return (
    '引用修复发布批准 187 PR #' +
    grant.pr +
    ' ' +
    grant.head +
    ' ' +
    grant.base +
    ' CI ' +
    grant.prRun +
    ' 宿主 ' +
    grant.hostDigest +
    ' 初败 ' +
    grant.failureDigest
  );
}

export function assertReferenceRepairReview(grant, task, coordination) {
  const review = grant.review;
  assert.equal(review?.provider, 'codex-native-read_thread');
  assert.equal(review.threadId, coordination.current.rootThreadId);
  assert.notEqual(review.threadId, task.monitoring?.worker ?? task.owner);
  assert.ok(review.turnId && review.message?.id && review.message.phase === 'commentary');
  assert.equal(review.message.text.trim(), referenceRepairApproval(grant), 'Exact independent approval required');
  const observedAt = Date.parse(review.observedAt);
  assert.ok(Number.isFinite(observedAt) && observedAt <= Date.now());
  return review.threadId;
}

function checkPreparation(state, entry, assertQuality) {
  const candidates = state.preparedCandidates.filter((candidate) => candidate.head === entry.head);
  assert.equal(candidates.length, 1, 'Exactly one preparation for the approved head is required');
  const [candidate] = candidates;
  assert.equal(candidate.task, id);
  assert.equal(candidate.accepted, original.accepted);
  assert.equal(candidate.pullRequest, entry.pr);
  assert.equal(candidate.runId, entry.prRun);
  checkCi(state, entry.head, entry.prRun, branch, 'pull_request', assertQuality);
}

function checkCi(state, head, run, branch, event, assertQuality) {
  const saved = state.events.findLast((e) => e.name === 'ci' && e.status === 'success' && e.key === head + ':' + run);
  assert.ok(saved, 'Exact successful first CI record required: ' + run);
  assertQuality(saved.result, head, run);
  assert.equal(saved.result.branch, branch);
  assert.equal(saved.result.eventName, event);
}

function originalFailureDigest(common) {
  return digest(privateFile(path.join(common, 'task-delivery', id, 'reference-repair-first-failure.log')));
}

export function checkApproval({ grant, task, failureDigest, order, coordination, state, assertQuality }) {
  assert.equal(grant.version, 1);
  assert.equal(grant.task, id);
  assert.equal(grant.accepted, original.accepted);
  assert.equal(task.id, id);
  assert.equal(task.branch, branch);
  assert.equal(task.frozen.accepted, original.accepted);
  assert.equal(task.recordedHead, grant.head);
  assert.match(grant.base, sha);
  assert.match(grant.head, sha);
  assert.notEqual(grant.head, original.head);
  assert.ok(Number.isSafeInteger(grant.pr) && grant.pr > 0 && grant.pr !== original.pr);
  assert.match(grant.prRun, runId);
  assert.match(grant.preparation, uuid);
  assert.match(grant.hostDigest, /^[a-f0-9]{64}$/);
  assert.equal(failureDigest, grant.failureDigest, 'First failure log differs from the approval');
  assert.equal(grant.failureDigest, firstFailure, 'Original first collection failure required');
  const coordinator = assertReferenceRepairReview(grant, task, coordination);

  const decision = order.dynamicDecisions.find((item) => item.id === grant.preparation);
  assert.equal(decision?.status, 'finished');
  assert.equal(decision.coordinator, coordinator, 'Preparation belongs to another coordinator');
  assert.equal(decision.input.expectedCoordinationRevision, coordination.revision);
  assert.equal(decision.input.task, id);
  assert.equal(decision.input.owner, task.owner);
  assert.equal(decision.input.executor, task.monitoring?.worker ?? task.owner);
  assert.equal(decision.input.phase, 'preparation');
  assert.equal(decision.prepared.head, grant.head);
  assert.equal(decision.prepared.accepted, grant.accepted);
  assert.equal(decision.prepared.pullRequest, grant.pr);
  assert.equal(decision.prepared.runId, grant.prRun);
  checkPreparation(state, original, assertQuality);
  checkCi(state, original.main, original.mainRun, 'main', 'push', assertQuality);
  checkPreparation(state, grant, assertQuality);
}

function checkApprovalFromOriginalLog(options, common) {
  checkApproval({ ...options, failureDigest: originalFailureDigest(common) });
}

function entries(git, commit) {
  return new Map(
    git('ls-tree', '-rz', commit)
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const [entry, file] = line.split('\t');
        return [file, entry];
      }),
  );
}

function approvedDelta(before, after) {
  const changed = [];
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(file) === after.get(file)) continue;
    assert.ok(paths.has(file), 'Unapproved repair path: ' + file);
    assert.ok(/^100644 blob [a-f0-9]{40}$/.test(after.get(file) ?? ''), 'Repair path removed or changed mode: ' + file);
    assert.ok(!before.has(file) || before.get(file).startsWith('100644 blob '), 'Unexpected source mode: ' + file);
    changed.push(file);
  }
  return changed.sort();
}

export function assertReferenceRepairTree(git, task, base, head, originalMain = original.main) {
  assert.match(base, sha);
  assert.match(head, sha);
  const baseLineage = new Set(git('rev-list', '--first-parent', base).split('\n'));
  assert.ok(baseLineage.has(originalMain), 'Original merge is not on the base main lineage');
  git('merge-base', '--is-ancestor', base, head);
  const owned = new Set(task.checkpoints.map((item) => item.commit));
  const commits = git('rev-list', '--reverse', base + '..' + head)
    .split('\n')
    .filter(Boolean);
  assert.ok(commits.length, 'Exact owned repair delta required');
  let parent = git('show', '-s', '--format=%P', commits[0]);
  assert.ok(baseLineage.has(parent), 'Repair must start at a published main commit');
  git('merge-base', '--is-ancestor', originalMain, parent);
  let mergedBase = false;
  for (const commit of commits) {
    const parents = git('show', '-s', '--format=%P', commit).split(' ');
    assert.equal(parents[0], parent, 'Repair must retain its registered first-parent chain');
    assert.ok(owned.has(commit), 'Unregistered repair commit');
    if (parents.length === 1) approvedDelta(entries(git, parent), entries(git, commit));
    else {
      assert.deepEqual(parents, [parent, base], 'Only the approved current main may enter the repair');
      assert.equal(mergedBase, false, 'Repeated candidate composition is not approved');
      const clean = git('merge-tree', '--write-tree', parent, base).split('\n')[0];
      assert.equal(
        git('rev-parse', commit + '^{tree}'),
        clean,
        'Repair composition differs from the exact clean Git merge',
      );
      mergedBase = true;
    }
    parent = commit;
  }
  assert.equal(parent, head);
  const changed = approvedDelta(entries(git, base), entries(git, head));
  for (const required of [file, 'scripts/delivery-repairs/preview-reference-proof.mjs'])
    assert.ok(changed.includes(required), 'Required repair is absent: ' + required);
  return changed;
}

function github(anchor, execute) {
  const repository = JSON.parse(execute(anchor, 'gh', ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const api = (route) => JSON.parse(execute(anchor, 'gh', ['api', 'repos/' + repository + '/' + route]));
  const protection = api('branches/main/protection');
  const requirements = protection.required_status_checks;
  assert.equal(requirements.strict, true);
  assert.equal(protection.enforce_admins?.enabled, true);
  assert.equal(protection.allow_force_pushes?.enabled, false);
  assert.equal(protection.allow_deletions?.enabled, false);
  const checks = ['Frontend quality', 'Backend quality', 'Accepted business snapshot'].map((name) => {
    assert.ok(requirements.contexts.includes(name), 'Required check missing: ' + name);
    const required = requirements.checks.filter((check) => check.context === name);
    assert.equal(required.length, 1);
    assert.ok(required[0].app_id > 0, 'Required check is not bound to an app: ' + name);
    return [name, required[0].app_id];
  });
  const workflow = api('actions/workflows/quality.yml');
  assert.equal(workflow.path, '.github/workflows/quality.yml');
  assert.equal(workflow.state, 'active');
  return { repository, api, requiredChecks: checks, workflow: workflow.id };
}

function pull(remote, number, head) {
  const pr = remote.api('pulls/' + number);
  assert.equal(pr.number, number);
  assert.equal(pr.head.sha, head);
  assert.equal(pr.head.ref, branch);
  assert.equal(pr.head.repo.full_name, remote.repository);
  assert.equal(pr.base.repo.full_name, remote.repository);
  assert.equal(pr.base.ref, 'main');
  return pr;
}

function liveCi(remote, head, run, branch, event, assertQuality, pr) {
  const route = 'actions/runs/' + run;
  const live = remote.api(route);
  assert.equal(String(live.id), run);
  assert.equal(live.workflow_id, remote.workflow);
  assert.equal(live.path, '.github/workflows/quality.yml');
  assert.equal(live.status, 'completed');
  assert.equal(live.event, event);
  assert.equal(live.head_branch, branch);
  if (pr && live.pull_requests?.length)
    assert.ok(
      live.pull_requests.some((item) => item.number === pr && item.head.sha === head),
      'CI PR differs',
    );
  const { jobs, total_count: total } = remote.api(route + '/jobs?filter=all&per_page=100');
  assert.equal(jobs.length, total);
  assert.ok(jobs.every((job) => String(job.run_id) === run && job.run_attempt === 1));
  assertQuality(
    { runId: run, headSha: live.head_sha, attempt: live.run_attempt, conclusion: live.conclusion, jobs },
    head,
    run,
  );
}

function verifyOriginal(remote, git, assertQuality) {
  const prior = pull(remote, original.pr, original.head);
  assert.equal(prior.state, 'closed');
  assert.equal(prior.merged, true);
  assert.equal(prior.merge_commit_sha, original.main);
  assert.equal(git('rev-parse', original.main + '^2'), original.head);
  liveCi(remote, original.head, original.prRun, branch, 'pull_request', assertQuality, original.pr);
  liveCi(remote, original.main, original.mainRun, 'main', 'push', assertQuality);
}

function hostDigest(anchor, head) {
  return digest(execFileSync('git', ['--no-replace-objects', '-C', anchor, 'cat-file', 'blob', head + ':' + file]));
}

function verifyRepair(anchor, remote, git, task, grant, assertQuality) {
  assertReferenceRepairTree(git, task, grant.base, grant.head);
  assert.equal(hostDigest(anchor, grant.head), grant.hostDigest, 'Reviewed host differs from the candidate blob');
  const ref = 'refs/tags/zdm-accepted/' + id;
  assert.equal(git('ls-remote', 'origin', ref), grant.accepted + '\t' + ref);
  const current = pull(remote, grant.pr, grant.head);
  liveCi(remote, grant.head, grant.prRun, branch, 'pull_request', assertQuality, grant.pr);
  const checks = remote.api('commits/' + grant.head + '/check-runs?per_page=100');
  assert.equal(checks.check_runs.length, checks.total_count);
  for (const [name, app] of remote.requiredChecks)
    assert.equal(
      checks.check_runs.filter(
        (check) =>
          check.name === name &&
          check.app?.id === app &&
          check.head_sha === grant.head &&
          check.status === 'completed' &&
          check.conclusion === 'success',
      ).length,
      1,
      'Approved commit has no unique required check: ' + name,
    );
  return current;
}

export function assertReferenceRepairMerge(git, pr, grant, main) {
  assert.equal(pr.state, 'closed');
  assert.equal(pr.merged, true);
  assert.equal(pr.merge_commit_sha, main);
  assert.equal(git('show', '-s', '--format=%P', main), grant.base + ' ' + grant.head);
  assert.equal(git('rev-parse', main + '^{tree}'), git('rev-parse', grant.head + '^{tree}'));
}

export function assertReferenceRepairStart(git, pr, grant, { local, remote, prior }) {
  if (prior) assert.deepEqual(prior.grant, grant, 'Original publication intent changed');
  if (pr.state === 'open') {
    assert.equal(pr.base.sha, grant.base, 'Approved PR base changed');
    assert.equal(remote, grant.base, 'Published main moved after approval');
    assert.equal(local, grant.base, 'Local main no longer matches the approved base');
    return;
  }
  assert.ok(prior, 'A merged PR without this host’s original intent cannot grant first-use readiness');
  assertReferenceRepairMerge(git, pr, grant, remote);
  assert.ok([grant.base, remote].includes(local), 'Cannot resume an unrelated local main');
}

function gitAdapter(anchor, execute) {
  return (...args) => execute(anchor, 'git', ['--no-replace-objects', ...args]);
}

export function verifyReferenceRepairCloseout({
  anchor,
  registry,
  batch,
  head,
  pr,
  state,
  execute,
  assertQuality,
  assertSource,
  order,
  coordination,
}) {
  if (batch.id !== id || pr.number === original.pr) return false;
  assert.equal(registry.readTask('trusted-749-single-parent-continuation')?.stage, 'closed');
  const dir = path.join(registry.commonDir, 'task-delivery', id);
  const intent = path.join(dir, 'reference-repair-publication-intent.json');
  const result = path.join(dir, 'reference-repair-publication.json');
  assert.ok(existsSync(intent) && existsSync(result), 'Independently reviewed successor publication required');
  const { grant, ticket } = JSON.parse(privateFile(intent));
  const recorded = JSON.parse(privateFile(result));
  assert.deepEqual(recorded, {
    version: 1,
    ticket,
    grantDigest: digest(JSON.stringify(grant)),
    main: pr.mergeCommit?.oid,
  });
  assert.match(ticket, uuid);
  assert.equal(grant.pr, pr.number);
  assert.equal(grant.head, head);
  checkApprovalFromOriginalLog({ grant, task: batch, order, coordination, state, assertQuality }, registry.commonDir);
  const git = gitAdapter(anchor, execute);
  git('fetch', 'origin');
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('rev-parse', 'HEAD'), recorded.main);
  assert.equal(git('rev-parse', 'origin/main'), recorded.main);
  assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), recorded.main + '\trefs/heads/main');
  const remote = github(anchor, execute);
  verifyOriginal(remote, git, assertQuality);
  assertReferenceRepairMerge(git, verifyRepair(anchor, remote, git, batch, grant, assertQuality), grant, recorded.main);
  assert.equal(assertSource(anchor, id, head).accepted, grant.accepted);
  const mainEvent = state.events.findLast(
    (e) =>
      e.name === 'ci' && e.status === 'success' && e.result?.headSha === recorded.main && e.result?.branch === 'main',
  );
  assert.ok(mainEvent, 'Record the exact successor main first run with the published wait command');
  const run = String(mainEvent.result.runId);
  assert.match(run, runId);
  checkCi(state, recorded.main, run, 'main', 'push', assertQuality);
  liveCi(remote, recorded.main, run, 'main', 'push', assertQuality);
  return true;
}

// First use runs from independently reviewed bytes outside the task checkout.
// Every imported control module comes from the clean published main anchor.
async function publish(anchor, grantFile) {
  assert.equal(realpathSync(anchor), anchor);
  assert.equal(process.cwd(), anchor, 'Run the reviewed host from the stable main anchor');
  assert.ok(!process.env.ZDM_INTEGRATION_OPERATION, 'Acquire a fresh independent integration lease');
  const execute = (cwd, command, args) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 90_000 });
    assert.equal(result.status, 0, 'Command outcome requires readback: ' + command + ' ' + args[0]);
    return args.includes('-rz') ? result.stdout : result.stdout.trim();
  };
  const git = gitAdapter(anchor, execute);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('status', '--porcelain'), '');
  const local = git('rev-parse', 'HEAD');
  const tracked = git('rev-parse', 'origin/main');
  const common = path.resolve(anchor, git('rev-parse', '--git-common-dir'));
  const dir = path.join(common, 'task-delivery', id);
  assert.equal(realpathSync(grantFile), path.join(dir, 'reference-repair-approval.json'));
  const grant = JSON.parse(privateFile(grantFile));
  assert.match(grant.head, sha);
  assert.equal(
    realpathSync(self),
    path.join(dir, 'reviewed-host', grant.head, path.basename(file)),
    'Use the independently reviewed copy outside the candidate',
  );
  assert.equal(digest(privateFile(self)), grant.hostDigest, 'Execute only the independently reviewed host bytes');
  assert.equal(lstatSync(self).mode & 0o222, 0, 'Reviewed host must be read-only');
  assert.equal(hostDigest(anchor, grant.head), grant.hostDigest);
  const intentFile = path.join(dir, 'reference-repair-publication-intent.json');
  const receiptFile = path.join(dir, 'reference-repair-publication.json');
  if (tracked !== local) {
    const prior = JSON.parse(privateFile(intentFile));
    assert.deepEqual(prior.grant, grant, 'Only the original publication may resume local sync');
    assert.equal(local, grant.base);
    assert.equal(git('show', '-s', '--format=%P', tracked), grant.base + ' ' + grant.head);
  }
  const fromMain = (file) => import(pathToFileURL(path.join(anchor, 'scripts', file)).href);
  const [
    { createTaskRegistry },
    { createExecutionOrder },
    { createTaskDeliveryQueue },
    { createResourceLeases },
    { withIntegrationResource },
    { assertTaskExecutor },
    { readTaskCoordination },
    { assertCompletionQuality },
    { assertAcceptedSource, verifyRemoteAcceptance },
    { writeReceipt, recoverWriter, recoverInterrupted },
    { completionStage, openCompletion, saveCompletion },
    { runCompletionProcess, completionPermission },
  ] = await Promise.all(
    [
      'task-registry.mjs',
      'task-execution-order.mjs',
      'task-delivery-queue.mjs',
      'resource-lease.mjs',
      'integration-resource.mjs',
      'task-execution-binding.mjs',
      'task-coordination.mjs',
      'completion-ci-evidence.mjs',
      'accepted-source.mjs',
      'completion-recovery.mjs',
      'completion-session.mjs',
      'completion-process.mjs',
    ].map(fromMain),
  );
  const registry = createTaskRegistry(anchor);
  const order = createExecutionOrder(common);
  const task = registry.resolve({ id });
  const scope = {
    lane: 'delivery',
    task: id,
    owner: task.owner,
    admission: process.env.ZDM_EXECUTION_ADMISSION,
    effect: 'final',
  };
  function assertCurrent() {
    assertTaskExecutor(registry.readTask(id));
    assert.equal(registry.readTask(id).recordedHead, grant.head);
    assert.equal(order.assertAdmission(scope).active, true);
  }
  assertCurrent();
  const queue = createTaskDeliveryQueue(common);
  const leases = createResourceLeases(common);
  leases.recoverEndedTask('task-delivery-' + id, task.owner, () => {
    recoverWriter(dir);
    recoverInterrupted(openCompletion(dir, id, { formal: false }), dir);
    return true;
  });
  return leases.run('task-delivery-' + id, task.owner, async () => {
    recoverWriter(dir);
    const state = openCompletion(dir, id, { formal: false });
    recoverInterrupted(state, dir);
    Object.defineProperty(state, completionPermission, { value: assertCurrent });
    const save = (value) => saveCompletion(dir, value);
    checkApprovalFromOriginalLog(
      {
        grant,
        task,
        order: order.read(),
        coordination: readTaskCoordination(common),
        state,
        assertQuality: assertCompletionQuality,
      },
      common,
    );
    git('fetch', 'origin');
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(execute(task.worktree, 'git', ['status', '--porcelain']), '');
    assert.equal(execute(task.worktree, 'git', ['rev-parse', 'HEAD']), grant.head);
    assert.equal(assertAcceptedSource(anchor, id, grant.head).accepted, grant.accepted);
    const verified = verifyRemoteAcceptance(anchor, {
      accepted: grant.accepted,
      branch,
      candidate: grant.head,
      trustedMain: grant.base,
    });
    assert.equal(verified.candidateMergeTree, git('rev-parse', grant.head + '^{tree}'));
    const remote = github(anchor, execute);
    verifyOriginal(remote, git, assertCompletionQuality);
    const before = verifyRepair(anchor, remote, git, task, grant, assertCompletionQuality);
    const prior = existsSync(intentFile) ? JSON.parse(privateFile(intentFile)) : null;
    if (prior) assert.deepEqual(prior.grant, grant, 'Original publication intent changed');

    if (existsSync(receiptFile)) {
      assert.ok(prior, 'Receipt without original intent');
      const saved = JSON.parse(privateFile(receiptFile));
      assert.deepEqual(saved, {
        version: 1,
        ticket: prior.ticket,
        grantDigest: digest(JSON.stringify(grant)),
        main: before.merge_commit_sha,
      });
      assertReferenceRepairMerge(git, before, grant, saved.main);
      assert.equal(git('rev-parse', 'origin/main'), saved.main);
      assert.equal(git('rev-parse', 'HEAD'), saved.main);
      // A crash can leave the just-completed publication's original ticket.
      const retained = queue.inspect().tickets.find((item) => item.id === prior.ticket);
      if (retained) {
        assert.equal(retained.task, id);
        assert.equal(retained.owner, task.owner);
        assert.equal(retained.accepted, grant.accepted);
        assert.equal(retained.initialHead, grant.head);
        const turn = await queue.wait(retained, { waitForTurn: false });
        await queue.finish(turn, { success: true });
      }
      return saved;
    }

    assertReferenceRepairStart(git, before, grant, {
      local: git('rev-parse', 'HEAD'),
      remote: git('rev-parse', 'origin/main'),
      prior,
    });
    const known = queue.inspect().tickets.find((item) => item.task === id);
    if (prior) assert.equal(known?.id, prior.ticket, 'Original publication ticket is missing');
    const ticket =
      known ?? (await queue.enqueue({ task: id, owner: task.owner, accepted: grant.accepted, head: grant.head }));
    assert.equal(ticket.owner, task.owner);
    assert.equal(ticket.accepted, grant.accepted);
    assert.equal(ticket.initialHead, grant.head);
    const turn = await queue.wait(ticket, { waitForTurn: false });
    try {
      const result = await withIntegrationResource(anchor, id, async (lease) => {
        assert.equal(lease.task, id);
        const actualMain = () => git('ls-remote', 'origin', 'refs/heads/main').split('\t')[0];
        await completionStage(
          state,
          'merge',
          grant.head,
          async () => {
            assertCurrent();
            const currentRemote = github(anchor, execute);
            assert.equal(currentRemote.repository, remote.repository);
            const pr = verifyRepair(anchor, currentRemote, git, task, grant, assertCompletionQuality);
            if (pr.state === 'open') {
              assert.equal(pr.base.sha, grant.base);
              assert.equal(actualMain(), grant.base);
              await queue.markMainMutation(turn);
              if (!prior) writeReceipt(intentFile, { grant, ticket: turn.id });
              const cmd = runCompletionProcess(
                'gh',
                [
                  'pr',
                  'merge',
                  String(grant.pr),
                  '--repo',
                  remote.repository,
                  '--merge',
                  '--match-head-commit',
                  grant.head,
                ],
                { cwd: anchor, encoding: 'utf8', timeout: 90_000 },
              );
              assert.equal(cmd.status, 0, 'Merge outcome unknown; inspect the original PR on retry');
            } else {
              assert.ok(prior, 'Exact original intent required after a merge');
              assertReferenceRepairMerge(git, pr, grant, actualMain());
            }
            git('fetch', 'origin');
            const main = git('rev-parse', 'origin/main');
            assertReferenceRepairMerge(git, pull(remote, grant.pr, grant.head), grant, main);
            assert.equal(actualMain(), main);
            return { sha: main };
          },
          { save },
        );
        const main = git('rev-parse', 'origin/main');
        await completionStage(
          state,
          'sync',
          main,
          () => {
            assertCurrent();
            assertReferenceRepairMerge(git, pull(remote, grant.pr, grant.head), grant, main);
            assert.equal(actualMain(), main);
            assert.ok([grant.base, main].includes(git('rev-parse', 'HEAD')));
            git('merge', '--ff-only', main);
            assert.equal(git('rev-parse', 'HEAD'), main);
            return { main };
          },
          { save },
        );
        const receipt = { version: 1, ticket: turn.id, grantDigest: digest(JSON.stringify(grant)), main };
        writeReceipt(receiptFile, receipt);
        return receipt;
      });
      await queue.finish(turn, { success: true });
      return result;
    } catch (error) {
      await queue.finish(turn, { success: false, error });
      throw error;
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  try {
    assert.equal(process.argv.length, 4, 'Usage: reviewed-host <published-main-anchor> <private-approval>');
    console.log(JSON.stringify(await publish(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
