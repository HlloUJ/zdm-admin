import { assertDeliveredDependencies } from './task-context.mjs';
import { assertAcceptedSource, publishAcceptance, readAcceptance, verifyRemoteAcceptance } from './accepted-source.mjs';
import { readAcceptedComposition, writeAcceptedComposition } from './accepted-source-composition.mjs';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { completionStage } from './completion-session.mjs';
import { parseWorktreePorcelain } from './git-workflow-core.mjs';
import { planBatchDelivery, readActiveBatch } from './task-batch.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { createTaskDeliveryQueue } from './task-delivery-queue.mjs';
import { applyTaskComposition } from './task-composition.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { assertCompletionQuality } from './completion-ci-evidence.mjs';
import { hasOriginalMergedReadiness } from './delivery-repairs/completion-legacy-readiness.mjs';
import { verifyMaintenanceCloseoutReadiness } from './delivery-repairs/historical-post-merge.mjs';
import { verifyReferenceRepairCloseout } from './delivery-repairs/reference-repair-release.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { readTaskCoordination } from './task-coordination.mjs';
import { withCandidateRuntime } from './task-candidate-runtime.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import {
  persistPreCiReview,
  preCiCompositionCommit,
  preCiCompositionTree,
  readPreCiReview,
  storedPreCiReview,
} from './delivery-repairs/pre-ci-composition.mjs';
import {
  originalRepairPull,
  publishedRepairKey,
  verifyPreparedManifestSource,
  verifyPublishedCiRepair,
} from './delivery-repairs/published-ci-repair.mjs';

// This command is invoked only after the human authorizes this exact batch's formal delivery.
// Every phase awaits its predecessor directly; no extra sleep, watcher, test run or approval loop.
export async function runCompletionFlow(
  root,
  batch,
  head,
  {
    execute,
    state,
    save,
    dispatch,
    checkRuntime,
    common,
    inventoryAssets,
    previewControl,
    runtimeReferences = taskRuntimeReferences,
    candidateRuntime = withCandidateRuntime,
    deferSettle = false,
    preparationOnly = false,
    engineeringReviewFile,
    publishedRepairId,
    recomposeManifestMain,
    assertCurrentAdmission,
    readState = () => state,
  },
) {
  assert.equal(typeof deferSettle, 'boolean');
  assert.equal(typeof preparationOnly, 'boolean');
  assert.ok(!preparationOnly || !deferSettle, 'Preparation is a separate phase, not deferred settlement');
  assert.ok(!recomposeManifestMain || (preparationOnly && !engineeringReviewFile && !publishedRepairId));
  assert.ok(
    !deferSettle || (!state.closedAt && !state.events.some((e) => ['preserve', 'cleanup', 'close'].includes(e.name))),
    'Deferred settlement cannot rewind already-started closeout',
  );
  assert.match(head, /^[a-f0-9]{40}$/);
  const anchor = batch.repository.anchor;
  if (!existsSync(batch.worktree)) {
    assert.equal(preparationOnly, false, 'Preparation cannot restore a closed task');
    assert.equal(deferSettle, false, 'Cannot defer after the task Git carrier is already missing');
    const ci = [...state.events]
      .reverse()
      .find((e) => e.name === 'ci' && e.status === 'success' && e.result?.branch === 'main');
    assert.ok(
      ci && state.events.some((e) => e.name === 'cleanup' && e.key === ci.key),
      'Missing task without owned cleanup',
    );
    return dispatch(anchor, ['settle', batch.id, ci.result.headSha, String(ci.result.runId)]);
  }
  const git = (cwd, ...args) => execute(cwd, 'git', args);
  const phase = async (name, key, fn) => {
    assertCurrentAdmission?.();
    return (
      await completionStage(
        state,
        name,
        key,
        () => {
          assertCurrentAdmission?.();
          return fn();
        },
        { save },
      )
    ).result;
  };
  const parallel = batch.taskRegistryVersion === 2;
  assert.ok(!preparationOnly || parallel, 'Preparation requires exact registered task identity');
  const tasks = parallel ? createTaskRegistry(root) : null;
  const refresh = (stage, detail = {}) => {
    if (!parallel) return;
    const current = tasks.readTask(batch.id);
    tasks.revise(current.id, current.revision, (record) => {
      record.stage = stage;
      Object.assign(record, detail);
    });
    batch = readActiveBatch(root);
  };
  const worktreePlan = (main) => {
    const entries = parseWorktreePorcelain(git(root, 'worktree', 'list', '--porcelain'));
    return {
      anchor,
      task: batch.worktree,
      preview: entries.find((w) => w.branch === 'codex/preview-current')?.path,
      main,
      common,
      taskRegistryVersion: 2,
    };
  };
  async function assertSelectedReferenceCurrent() {
    if (!process.env.ZDM_CLOSED_PREVIEW_REFERENCE) return;
    const { assertReferenceProofCurrent } = await import('./delivery-repairs/preview-reference-proof.mjs');
    assertReferenceProofCurrent(batch.worktree, preparationOnly ? 'preparation' : 'final');
  }
  const preparationReferences = { referenceEffect: 'preparation' };
  function verifyCompositionCandidate(proof, accepted, review) {
    const candidate = review?.candidate ?? preCiCompositionCommit(batch.worktree, proof);
    const checked = verifyRemoteAcceptance(batch.worktree, {
      candidate,
      accepted: accepted.commit,
      branch: batch.branch,
      trustedMain: proof.main,
    });
    assert.equal(checked.candidateMergeTree, proof.candidateTree, 'Manifest resolution changed the actual merge tree');
    return candidate;
  }
  function installCompositionCandidate(proof, candidate) {
    assertCurrentAdmission?.();
    assert.equal(batch.recordedHead, proof.taskHead, 'Original checkpointed candidate required');
    assert.equal(git(batch.worktree, 'rev-parse', 'HEAD'), proof.taskHead);
    assert.equal(git(batch.worktree, 'status', '--porcelain'), '', 'Composition requires a clean owned task');
    assertAcceptedSource(batch.worktree, batch.id, candidate);
    git(batch.worktree, 'merge', '--ff-only', candidate);
  }
  // A persisted composition proves source, so recheck live references before
  // resuming its installation or publishing the newly registered candidate.
  let publishedRepair, manifestRecomposition;
  if (preparationOnly) await assertSelectedReferenceCurrent();
  if (parallel) {
    const accepted = readAcceptance(root, batch.id);
    const proof = readAcceptedComposition(root, batch.id, accepted.commit);
    assert.ok(!proof || !recomposeManifestMain, 'Resume the existing composition with ordinary prepare');
    if (preparationOnly && proof) {
      assertCurrentAdmission?.();
      await runtimeReferences(tasks.readTask(batch.id), preparationReferences);
      await assertSelectedReferenceCurrent();
    }
    if (proof) {
      manifestRecomposition = state.events
        .filter((event) => event.name === 'prepare' && event.status === 'success')
        .map((event) => event.result?.manifestRecomposition)
        .findLast(
          (plan) =>
            plan?.taskHead === proof.taskHead &&
            plan.main === proof.main &&
            plan.accepted === proof.accepted &&
            plan.candidateTree === proof.candidateTree,
        );
      if (manifestRecomposition)
        assert.equal(
          manifestRecomposition.candidate,
          preCiCompositionCommit(batch.worktree, proof),
          'Registered manifest recomposition candidate changed',
        );
      const plans = state.events.filter(
        (event) =>
          event.name === 'prepare' &&
          event.status === 'success' &&
          event.result?.publishedRepair?.taskHead === proof.taskHead &&
          event.result.publishedRepair.main === proof.main &&
          event.result.publishedRepair.accepted === proof.accepted &&
          event.result.candidateTree === proof.candidateTree,
      );
      publishedRepair = plans.at(-1)?.result.publishedRepair;
      if (publishedRepair) {
        if (publishedRepairId !== undefined)
          assert.equal(
            publishedRepairId,
            publishedRepair.repairId,
            'Existing composition has another published repair',
          );
        const candidate = preCiCompositionCommit(batch.worktree, { ...proof, publishedRepair: true });
        assert.equal(publishedRepair.candidate, candidate, 'Published repair candidate changed');
      }
    }
    if (proof && !proof.candidateCommit) {
      const current = git(batch.worktree, 'rev-parse', 'HEAD');
      const review = storedPreCiReview(batch.worktree, proof);
      if (current === proof.taskHead) {
        assertCurrentAdmission?.();
        const tree = preCiCompositionTree(
          batch.worktree,
          { ...proof, protectedPaths: accepted.protectedPaths, publishedRepair: Boolean(publishedRepair) },
          review,
        );
        if (tree) {
          assert.equal(tree, proof.candidateTree, 'Recovered candidate differs from the original composition proof');
          const candidate = verifyCompositionCandidate(
            { ...proof, publishedRepair: Boolean(publishedRepair) },
            accepted,
            review,
          );
          const original = publishedRepair ?? manifestRecomposition;
          if (preparationOnly && original) {
            const github = (...args) => JSON.parse(execute(root, 'gh', args));
            const repository = github('repo', 'view', '--json', 'nameWithOwner').nameWithOwner;
            originalRepairPull(github, repository, original.pullRequest, batch.branch, [proof.taskHead]);
          }
          installCompositionCandidate(proof, candidate);
          engineeringReviewFile = undefined; // Recovery consumes the durable original review.
        }
      } else if (
        review &&
        git(batch.worktree, 'rev-parse', 'HEAD^{tree}') === proof.candidateTree &&
        batch.recordedHead === proof.taskHead
      ) {
        assert.equal(current, review.candidate, 'Recovery must register the exact reviewed commit');
      }
      if (review && engineeringReviewFile && git(batch.worktree, 'rev-parse', 'HEAD') === review.candidate) {
        const supplied = readPreCiReview(batch.worktree, engineeringReviewFile);
        if (supplied.candidate === review.candidate) {
          assert.deepEqual(supplied, review, 'Registered engineering review changed');
          engineeringReviewFile = undefined;
        }
      }
    }
    applyTaskComposition(root, batch.id, undefined, { recover: true });
    batch = readActiveBatch(root);
    head = batch.recordedHead;
    if (preparationOnly) await assertSelectedReferenceCurrent();
  }
  if (publishedRepair?.candidate !== head) publishedRepair = undefined;
  if (manifestRecomposition?.candidate !== head) manifestRecomposition = undefined;
  let repository;
  const github = (...args) => JSON.parse(execute(root, 'gh', args));
  if (preparationOnly) {
    assertCurrentAdmission?.();
    git(root, 'fetch', 'origin');
  }
  await phase('prepare', head, async () => {
    repository = github('repo', 'view', '--json', 'nameWithOwner').nameWithOwner;
    if (!preparationOnly) git(root, 'fetch', 'origin');
    assert.equal(git(batch.worktree, 'rev-parse', 'HEAD'), head);
    assert.equal(git(batch.worktree, 'status', '--porcelain'), '');
    assertAcceptedSource(batch.worktree, batch.id, head);
    assert.equal(git(anchor, 'status', '--porcelain'), '');
    planBatchDelivery(root, { action: 'preparation' });
    const assets = inventoryAssets(batch.worktree);
    assert.ok(
      assets.every((a) => a.kind !== 'blocked'),
      'Unknown or private asset remains; retain task before pushing',
    );
    const worktrees = parseWorktreePorcelain(git(root, 'worktree', 'list', '--porcelain'));
    const integration = worktrees.find((w) => w.branch === 'codex/integration-current')?.path;
    const preview = worktrees.find((w) => w.branch === 'codex/preview-current')?.path;
    assert.ok(preview, 'Registered retained preview required');
    await previewControl.assertOwner({
      task: batch.worktree,
      preview,
      common,
      anchor,
      taskRegistryVersion: batch.taskRegistryVersion,
    });
    assert.ok(integration, 'Registered integration worktree required');
    assert.equal(
      existsSync(path.join(integration, 'backups/task-preview/active-database-task.json')),
      false,
      'Use original protected handoff for an active database lock',
    );
    const protection = JSON.parse(execute(root, 'gh', ['api', `repos/${repository}/branches/main/protection`]));
    assert.equal(protection.enforce_admins?.enabled, true);
    assert.equal(protection.required_status_checks?.strict, true);
    for (const name of ['Frontend quality', 'Backend quality'])
      assert.ok(protection.required_status_checks.contexts.includes(name));
    const runtime = await checkRuntime(root, common, { allowPreviewUnavailable: true });
    assert.ok(
      (runtime.integrationHealthy ?? runtime.runtimeHealthy) && runtime.backupRetained,
      'Runtime or backup preflight failed',
    );
    if (state.previewFingerprint) assert.equal(runtime.profileFingerprint, state.previewFingerprint);
    return { head, protectionChecked: true, runtimePreflight: true, assets };
  });
  if (
    preparationOnly &&
    (recomposeManifestMain ||
      (!publishedRepair &&
        !state.events.some(
          (event) => event.name === 'ci' && event.status === 'success' && event.result?.headSha === head,
        )))
  ) {
    assertCurrentAdmission?.();
    const main = git(root, 'rev-parse', 'origin/main');
    const accepted = readAcceptance(root, batch.id);
    let preparedSource;
    if (recomposeManifestMain) {
      assert.equal(main, recomposeManifestMain, 'Requested manifest recomposition main is not current origin/main');
      preparedSource = verifyPreparedManifestSource({
        batch,
        head,
        main,
        accepted: accepted.commit,
        state,
        repository,
        git: (...args) => git(batch.worktree, ...args),
        gh: github,
      });
    }
    const review = engineeringReviewFile ? readPreCiReview(batch.worktree, engineeringReviewFile) : undefined;
    const candidateTree = preCiCompositionTree(
      batch.worktree,
      {
        accepted: accepted.commit,
        taskHead: head,
        main,
        protectedPaths: accepted.protectedPaths,
        rejectUnreviewed: true,
        publishedRepair: publishedRepairId !== undefined,
      },
      review,
    );
    if (recomposeManifestMain) assert.ok(candidateTree, 'Manifest recomposition requires an actual manifest conflict');
    if (candidateTree) {
      assert.equal(batch.recordedHead, head, 'Original checkpointed candidate required');
      const inputs = { batch: batch.id, accepted: accepted.commit, main, taskHead: head, candidateTree };
      const candidate = verifyCompositionCandidate(
        { ...inputs, publishedRepair: publishedRepairId !== undefined },
        accepted,
        review,
      );
      if (preparedSource) {
        manifestRecomposition = { ...preparedSource, candidate, candidateTree };
        await phase('prepare', head + ':post-ci-manifest:' + main, async () => ({ manifestRecomposition }));
      }
      if (publishedRepairId !== undefined) {
        const plan = await phase('prepare', head + publishedRepairKey + main, () => ({
          candidateTree,
          publishedRepair: verifyPublishedCiRepair({
            ...inputs,
            batch,
            state,
            registry: tasks,
            git: (...args) => git(batch.worktree, ...args),
            gh: github,
            repository,
            repairId: publishedRepairId,
            candidate,
          }),
        }));
        publishedRepair = plan.publishedRepair;
      }
      await phase('prepare', head + ':pre-ci-composition:' + main, async () => {
        await previewControl.prepareComposition(worktreePlan(main), preparationReferences);
        await assertSelectedReferenceCurrent();
        assertCurrentAdmission?.();
        if (review) persistPreCiReview(batch.worktree, inputs, review);
        const proof = writeAcceptedComposition(batch.worktree, inputs);
        installCompositionCandidate(proof, candidate);
        const composed = applyTaskComposition(root, batch.id, undefined, { recover: true });
        assert.equal(composed.recordedHead, candidate, 'Composition must register its exact candidate');
        return { head: candidate, main, originalHead: head, accepted: accepted.commit, candidateTree };
      });
      batch = readActiveBatch(root);
      head = batch.recordedHead;
      await assertSelectedReferenceCurrent();
    }
  }
  if (publishedRepairId !== undefined)
    assert.ok(publishedRepair, 'A failed original candidate and a new published repair are required');
  async function publishCandidate({ readiness = false } = {}) {
    const source = publishedRepair ?? manifestRecomposition;
    const original = preparationOnly && source?.candidate === head ? source : null;
    if (parallel && !original) {
      const merged = JSON.parse(
        execute(root, 'gh', [
          'pr',
          'list',
          '--head',
          batch.branch,
          '--base',
          'main',
          '--state',
          'merged',
          '--json',
          'number,url,state,headRefOid,mergeCommit',
        ]),
      ).filter((p) => p.headRefOid === head && p.state === 'MERGED');
      assert.ok(merged.length <= 1, 'Ambiguous already-merged task');
      if (merged.length) {
        const prior = state.events.find(
          (e) =>
            e.name === 'ci' &&
            e.status === 'success' &&
            e.result?.headSha === head &&
            e.result.eventName === 'pull_request' &&
            e.result.branch === batch.branch,
        );
        assert.ok(
          prior &&
            (hasOriginalMergedReadiness({
              batch,
              head,
              pr: merged[0],
              readRegistration: () => ({
                repository,
                origin: git(batch.worktree, 'remote', 'get-url', 'origin'),
                anchorCommon: git(anchor, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
                worktreeCommon: git(batch.worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
                registration: tasks.readTask(batch.id),
              }),
              events: state.events,
              common,
              readCandidateCommand: () =>
                JSON.parse(git(batch.worktree, 'show', head + ':package.json')).scripts['verify:delivery'],
            }) ||
              verifyReferenceRepairCloseout({
                anchor,
                registry: tasks,
                batch,
                head,
                pr: merged[0],
                state,
                execute,
                assertQuality: assertCompletionQuality,
                assertSource: assertAcceptedSource,
                order: createExecutionOrder(common).read(),
                coordination: readTaskCoordination(common),
              }) ||
              verifyMaintenanceCloseoutReadiness({
                anchor,
                registry: tasks,
                batch,
                head,
                pr: merged[0],
                state,
                execute,
              })),
          'Merged recovery requires its original exact readiness and PR evidence',
        );
        assertCompletionQuality(prior.result, head, prior.result.runId);
        git(root, 'merge-base', '--is-ancestor', head, 'origin/main');
        return merged[0]; // No new PR, local gate rerun or dependency recreation after successful merge.
      }
    }
    if (parallel && readiness) {
      refresh('validating');
      await phase('prepare', head + ':readiness', () =>
        candidateRuntime(batch, head, async (runtimeEnv) => {
          execute(
            batch.worktree,
            process.execPath,
            [path.join(batch.worktree, 'scripts/verify.mjs'), '--affected', '--browser', 'chrome'],
            { env: { ...process.env, ...runtimeEnv } },
          );
          assert.equal(git(batch.worktree, 'rev-parse', 'HEAD'), head);
          assert.equal(git(batch.worktree, 'status', '--porcelain'), '');
          assertAcceptedSource(batch.worktree, batch.id, head);
          return { head, localReadiness: true };
        }),
      );
    }
    await phase('push', head, () => {
      const remote = git(root, 'ls-remote', 'origin', 'refs/heads/' + batch.branch);
      if (original) {
        const remoteHead = remote.split(/\s/)[0];
        assert.ok([original.taskHead, head].includes(remoteHead), 'Original PR branch moved');
        originalRepairPull(github, repository, original.pullRequest, batch.branch, [original.taskHead, head]);
      }
      publishAcceptance(batch.worktree, batch.id);
      if (remote && !remote.startsWith(head + '\t')) {
        const before = remote.split(/\s/)[0];
        git(root, 'merge-base', '--is-ancestor', before, head);
        git(batch.worktree, 'push', 'origin', batch.branch);
      } else if (!remote) git(batch.worktree, 'push', '--set-upstream', 'origin', batch.branch);
      assert.ok(git(root, 'ls-remote', 'origin', 'refs/heads/' + batch.branch).startsWith(head + '\t'));
      return { head };
    });
    const pull = await phase('pr', head, () => {
      if (original) return originalRepairPull(github, repository, original.pullRequest, batch.branch, [head]);
      const args = [
        'pr',
        'list',
        '--head',
        batch.branch,
        '--base',
        'main',
        '--state',
        'all',
        '--json',
        'number,url,state,headRefOid,mergeCommit',
      ];
      const observed = JSON.parse(execute(root, 'gh', args));
      let pulls = observed.filter((p) => p.headRefOid === head);
      assert.ok(pulls.length <= 1, 'Ambiguous pull request');
      if (!pulls.length) {
        assert.ok(
          !observed.some((p) => p.state === 'OPEN'),
          'Existing PR has not read back the exact pushed candidate',
        );
        const title = batch.modules
          .map((m) => m.title)
          .join('；')
          .slice(0, 120);
        const body =
          '本批次交付：\n\n' +
          batch.modules.map((m) => `- ${m.title}：${m.checkpoints.map((c) => c.commit).join(', ')}`).join('\n') +
          '\n\n保留模块提交；本地定向证据见批次登记，完整适用门禁由准确候选 CI 执行。保留覆盖、精确指纹和数据保护要求。';
        const url = execute(root, 'gh', [
          'pr',
          'create',
          '--base',
          'main',
          '--head',
          batch.branch,
          '--title',
          title,
          '--body',
          body,
        ]);
        console.log('PR created: ' + url);
        pulls = JSON.parse(execute(root, 'gh', args)).filter((p) => p.headRefOid === head);
      }
      assert.equal(pulls.length, 1);
      assert.ok(['OPEN', 'MERGED'].includes(pulls[0].state), 'Closed unmerged PR cannot grant delivery');
      return pulls[0];
    });
    if (parallel) refresh('pr-pending');
    return pull;
  }
  const awaitRun = (selector, sha) => dispatch(root, ['wait', selector, sha]);
  let pull = await publishCandidate();
  const initialCi = await awaitRun('pr', head);
  if (preparationOnly) {
    assert.equal(parallel, true, 'Preparation requires exact registered task identity');
    const preparedCi = [...readState().events]
      .reverse()
      .find(
        (event) =>
          event.name === 'ci' &&
          event.status === 'success' &&
          event.result?.headSha === head &&
          String(event.result?.runId) === String(initialCi.runId),
      )?.result;
    assert.ok(preparedCi, 'Original completed PR CI event required');
    assert.equal(preparedCi.eventName, 'pull_request');
    assert.equal(preparedCi.branch, batch.branch);
    assertCompletionQuality(preparedCi, head, initialCi.runId);
    const prepared = {
      version: 1,
      task: batch.id,
      head,
      accepted: readAcceptance(root, batch.id).commit,
      runId: String(initialCi.runId),
      pullRequest: pull.number,
      url: pull.url,
    };
    state.preparedCandidates ??= [];
    const prior = state.preparedCandidates.find((item) => item.head === head);
    if (prior) assert.deepEqual(prior, prepared, 'Prepared candidate proof changed');
    else state.preparedCandidates.push(prepared);
    save(state);
    return { ...prepared, status: 'prepared', formalDeliveryComplete: false, finalMainAdmissionRequired: true };
  }
  async function complete(turn, queue) {
    const main = await phase('merge', head, async () => {
      const current = JSON.parse(
        execute(root, 'gh', ['pr', 'view', String(pull.number), '--json', 'headRefOid,baseRefOid,state,mergeCommit']),
      );
      assert.equal(current.headRefOid, head);
      assertAcceptedSource(batch.worktree, batch.id, head);
      git(root, 'fetch', 'origin');
      if (current.state === 'OPEN') {
        assert.equal(current.baseRefOid, git(root, 'rev-parse', 'origin/main'));
        // Strict server-side up-to-date protection then blocks a concurrent base advance.
        git(root, 'merge-base', '--is-ancestor', current.baseRefOid, head);
        const mergeTree = git(root, 'merge-tree', '--write-tree', current.baseRefOid, head).split('\n')[0];
        assertAcceptedSource(root, batch.id, mergeTree);
        if (parallel) await queue.markMainMutation(turn);
        execute(root, 'gh', ['pr', 'merge', String(pull.number), '--merge', '--match-head-commit', head]);
      } else {
        assert.equal(current.state, 'MERGED');
        if (parallel) await queue.markMainMutation(turn);
      }
      git(root, 'fetch', 'origin');
      const sha = git(root, 'rev-parse', 'origin/main');
      assertAcceptedSource(root, batch.id, sha);
      const parents = git(root, 'rev-list', '--parents', '-n', '1', sha).split(' ');
      assert.equal(parents.length, 3);
      assert.equal(parents[2], head);
      return { sha };
    });
    if (parallel) refresh('merged', { main: { local: main.sha, remote: main.sha } });
    await phase('sync', main.sha, () => {
      const sync = () => {
        git(anchor, 'merge', '--ff-only', 'origin/main');
        return { main: main.sha };
      };
      return parallel ? createResourceLeases(common).run('main-sync', batch.id, sync) : sync();
    });
    const ci = await awaitRun('main', main.sha);
    if (parallel) refresh('main-verified', { main: { local: main.sha, remote: main.sha, runId: String(ci.runId) } });
    await dispatch(anchor, ['final-handoff', main.sha]);
    if (parallel) refresh('handoff-verified');
    if (deferSettle) {
      const proof = readState(),
        mainCi = [...proof.events]
          .reverse()
          .find(
            (e) =>
              e.name === 'ci' &&
              e.status === 'success' &&
              e.result?.branch === 'main' &&
              e.result?.headSha === main.sha,
          ),
        handoff = proof.events.find(
          (e) =>
            e.name === 'handoff' &&
            e.key === main.sha + ':final' &&
            e.status === 'success' &&
            e.result?.main === main.sha,
        );
      assert.ok(mainCi && handoff, 'Defer settlement requires exact successful main CI and final handoff evidence');
      assert.equal(mainCi.result.eventName, 'push');
      assertCompletionQuality(mainCi.result, main.sha, String(ci.runId));
      assert.equal(ci.headSha, main.sha);
      assert.ok(!proof.closedAt, 'Closed delivery cannot defer settlement');
      const prior = proof.deferredSettlement;
      const deferred = {
        version: 1,
        status: 'pending',
        head,
        main: main.sha,
        runId: String(ci.runId),
        deferredAt:
          prior?.head === head && prior.main === main.sha && prior.runId === String(ci.runId)
            ? prior.deferredAt
            : new Date().toISOString(),
        reason: '外部周期验收待完成',
      };
      proof.deferredSettlement = deferred;
      save(proof);
      return {
        ...deferred,
        status: 'deferred',
        formalDeliveryComplete: false,
        batch: batch.id,
        next: {
          kind: 'wait',
          label: deferred.reason,
          settle: ['npm', 'run', 'task:completion', '--', 'settle', batch.id, main.sha, String(ci.runId)],
        },
      };
    }
    return dispatch(anchor, ['settle', batch.id, main.sha, String(ci.runId)]);
  }
  if (!parallel) return complete();
  assertDeliveredDependencies(root, batch, 'final');
  const queue = createTaskDeliveryQueue(common);
  assertCurrentAdmission?.();
  refresh('queued');
  const ticket = await queue.enqueue({
    task: batch.id,
    owner: batch.owner,
    accepted: readAcceptance(root, batch.id).commit,
    head,
  });
  const turn = await phase('queue', ticket.id, () => queue.wait(ticket));
  try {
    git(root, 'fetch', 'origin');
    const latest = git(root, 'rev-parse', 'origin/main');
    const current = JSON.parse(execute(root, 'gh', ['pr', 'view', String(pull.number), '--json', 'state,headRefOid']));
    assert.equal(current.headRefOid, head);
    if (current.state === 'OPEN') {
      assert.equal(
        typeof previewControl.prepareComposition,
        'function',
        'Protected task composition runtime control required',
      );
      // Stop this task's mounted watchers before changing its source. Another
      // selected task remains healthy and untouched.
      assertDeliveredDependencies(root, batch, 'combination');
      await previewControl.prepareComposition(worktreePlan(latest));
      const composed = applyTaskComposition(root, batch.id, latest);
      batch = readActiveBatch(root);
      const changed = composed.recordedHead !== head;
      head = composed.recordedHead;
      await assertSelectedReferenceCurrent();
      // Development proof and the initial exact PR CI precede this turn. Run
      // final local readiness from the composed candidate's own immutable tools.
      pull = await publishCandidate({ readiness: true });
      if (changed) await awaitRun('pr', head);
    } else assert.equal(current.state, 'MERGED');
    assertDeliveredDependencies(root, batch, 'final');
    const result = await complete(turn, queue);
    if (result.status === 'deferred') {
      const retained = await queue.deferSettlement(turn, {
        head,
        main: result.main,
        runId: result.runId,
        deferredAt: result.deferredAt,
      });
      return { ...result, criticalResourcesReleased: true, queueTicket: retained.id };
    }
    await queue.finish(turn, { success: true });
    return result;
  } catch (error) {
    await queue.finish(turn, { success: false, error });
    throw error;
  }
}
