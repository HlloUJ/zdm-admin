import {
  assertDeferredMaintenanceGrant,
  calendarRequirements,
  liveMainQuality,
  preserveDeferredHandoff,
  readDeferredHandoff,
  verifyCalendarAcceptance,
  verifyDeferredLineage,
  verifySourceOnlyMaintenance,
} from './completion-deferred.mjs';
import {
  POST_MERGE_SOURCE,
  assertOriginalPostMergeTurn,
  verifyPostMergeMaintenance,
} from './delivery-repairs/historical-post-merge.mjs';
import { readTaskCoordination } from './task-coordination.mjs';
import { deliveryCiCapability } from './verification-policy.mjs';
import { withIntegrationResource } from './integration-resource.mjs';
import { assertTaskExecutor } from './task-execution-binding.mjs';
import { handoffCreatedArtifacts } from './task-cleanup-created-artifacts.mjs';
import { handoffAuditedDependencies } from './delivery-repairs/task-cleanup-npm.mjs';
import { createTaskDeliveryQueue } from './task-delivery-queue.mjs';
import { assertCleanupUnreferenced, cleanupCommand, loadCleanupPolicy } from './task-cleanup-cli.mjs';
import { captureCiProgress } from './task-delivery-status-sync.mjs';
import { drainProgressHost } from './task-progress-host.mjs';
import {
  handoffBuiltDist,
  handoffPreservedReportCopies,
  recordCloseoutCleanupInventory,
} from './task-cleanup-handoff.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import {
  freezeAcceptedSource,
  assertAcceptedSource,
  readAcceptance,
  verifyLocalAcceptedContinuation,
  verifyRemoteAcceptance,
} from './accepted-source.mjs';
import { applyTaskComposition } from './task-composition.mjs';
import { requireBatchTimingForCleanup, reconcileInterruptedValidationTiming } from './batch-timing-runtime.mjs';
import { readTimingSummary, readTimeline, refreshTimeline } from './batch-timing-store.mjs';
import { deliveryStatus, backfillDeliveryStatus } from './completion-status.mjs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { runCompletionProcess, completionPermission } from './completion-process.mjs';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  openCompletion,
  saveCompletion,
  completionStage,
  completionSummary,
  pauseCompletion,
  resumeCompletion,
  recordRepair,
  finishRepair,
  settleCompletion,
} from './completion-session.mjs';
import { assertCompletionQuality, verifyCompletionEvidence } from './completion-ci-evidence.mjs';
import { hasHistoricalCiDiagnosis, recordHistoricalCiDiagnosis } from './delivery-repairs/completion-ci-diagnosis.mjs';
import {
  readActiveBatch,
  closeBatch,
  planBatchDelivery,
  assertBatchModulesReady,
  batchSharedWork,
} from './task-batch.mjs';
import { waitRemoteQuality, selectQualityRun } from './wait-quality.mjs';
import {
  recoverWriter,
  recoverInterrupted,
  trackStageRestoration,
  finishStageRestorations,
  completionEvidence,
  writeReceipt,
  restoreReceipt,
} from './completion-recovery.mjs';
import { inventoryAssets } from './task-completion.mjs';
import { runCompletionFlow } from './completion-flow.mjs';
import { hasAppliedPublishedCiRepair } from './delivery-repairs/published-ci-repair.mjs';
import { finalHandoffPlan, finalHandoff } from './completion-handoff.mjs';
import { createCompletionPreviewControl } from './completion-preview.mjs';
import { parseWorktreePorcelain } from './git-workflow-core.mjs';
import {
  integrationBackendSnapshot,
  integrationProofMatches,
  readIntegrationProof,
} from './integration-handoff-state.mjs';
import { retainedPublishedPreview } from './start-micro-task.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { closeTaskBatch, selectedTaskBatch, withTaskContext } from './task-context.mjs';
import { verifyRetainedDependencies } from './task-dependency-retention.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';

function run(root, command, args, options = {}) {
  const r = runCompletionProcess(command, args, {
    cwd: root,
    ...options,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    if (r.stderr) process.stderr.write(r.stderr.slice(-4000));
    throw new Error(command + ' failed; preserve state and inspect its original output');
  }
  return r.stdout.trim();
}
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
function registeredMainAnchor(root, verifyPublished) {
  const mains = parseWorktreePorcelain(run(root, 'git', ['worktree', 'list', '--porcelain'])).filter(
    (entry) => entry.branch === 'main',
  );
  assert.equal(mains.length, 1);
  const anchor = mains[0].path;
  if (verifyPublished) {
    assert.equal(
      realpathSync(fileURLToPath(import.meta.url)),
      path.join(anchor, 'scripts/completion-cli.mjs'),
      'Use the published main completion entry',
    );
    assert.equal(run(anchor, 'git', ['rev-parse', 'HEAD']), run(anchor, 'git', ['rev-parse', 'origin/main']));
    assert.equal(run(anchor, 'git', ['status', '--porcelain']), '');
  }
  return anchor;
}
async function completionCommandLocked(
  root,
  args,
  {
    preserveAssets,
    checkRuntime,
    execute = run,
    runtimeSnapshot = integrationBackendSnapshot,
    runtimeProof = readIntegrationProof,
    waitQuality = waitRemoteQuality,
    verifyEvidence = verifyCompletionEvidence,
    previewControl = createCompletionPreviewControl({ execute }),
    runtimeReferences = taskRuntimeReferences,
    deferSettle = false,
    deferredTurn,
    historicalRecovery,
    externalAcceptanceFile,
    assertCurrentAdmission,
  },
) {
  const preparationOnly = args[0] === 'prepare';
  let engineeringReviewFile;
  if (preparationOnly && args.length === 5 && args[3] === '--engineering-review') {
    engineeringReviewFile = args[4];
    args = args.slice(0, 3);
  }
  let publishedRepairId;
  if (preparationOnly && args.length === 5 && args[3] === '--published-repair') {
    publishedRepairId = args[4];
    assert.match(publishedRepairId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    args = args.slice(0, 3);
  }
  let recomposeManifestMain;
  if (preparationOnly && args.length === 5 && args[3] === '--recompose-manifest') {
    recomposeManifestMain = args[4];
    assert.match(recomposeManifestMain, /^[a-f0-9]{40}$/, 'Exact published main SHA required');
    args = args.slice(0, 3);
  }
  if (preparationOnly) args = ['deliver', ...args.slice(1)];
  assert.equal(typeof deferSettle, 'boolean');
  assert.ok(!deferSettle || args[0] === 'deliver', 'deferSettle only applies to deliver');
  const limits = {
    begin: [0, 1],
    freeze: [0, 0],
    'check-source': [1, 3],
    'compose-reviewed': [2, 2],
    deliver: [2, 2],
    recover: [0, 0],
    status: [1, 1],
    backfill: [1, 1],
    'pause-record': [1, 1],
    'resume-record': [1, 1],
    'handoff-plan': [1, 1],
    'final-handoff': [1, 1],
    'handoff-deferred-maintenance': [2, 2],
    report: [1, 1],
    settle: [3, 3],
    wait: [2, 2],
    'repair-start': [4, 5],
    'repair-finish': [1, 1],
    'record-ci-diagnosis': [2, 2],
    measure: [3, Infinity],
  };
  const command = args[0],
    count = args.length - 1;
  assert.ok(
    limits[command] && count >= limits[command][0] && count <= limits[command][1],
    'Unexpected completion arguments',
  );
  const [mode, ...rest] = args,
    git = (...a) => execute(existsSync(root) ? root : process.cwd(), 'git', a),
    common = path.resolve(root, git('rev-parse', '--git-common-dir'));
  let batch = readActiveBatch(root);
  const requestedBatch = [
    'report',
    'settle',
    'deliver',
    'status',
    'backfill',
    'pause-record',
    'resume-record',
  ].includes(mode)
    ? rest[0]
    : batch?.id;
  assert.match(requestedBatch ?? '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Exact completion batch required');
  const directory = path.join(common, 'task-delivery', requestedBatch);
  const archiveFile = path.join(common, 'task-batches/archive', requestedBatch + '.json');
  const registry = existsSync(archiveFile) ? read(archiveFile) : batch?.id === requestedBatch ? batch : null;
  if (mode === 'status') return deliveryStatus(directory, requestedBatch, registry);
  if (mode === 'backfill') return backfillDeliveryStatus(directory, requestedBatch, registry);
  if (mode === 'report') {
    assert.ok(existsSync(path.join(directory, 'completion-session.json')), 'No recorded completion interval');
    return {
      ...completionSummary(openCompletion(directory, requestedBatch, { formal: false })),
      timingScope: 'formal-delivery-only',
      batchTiming: readTimingSummary(common, requestedBatch) ?? { status: 'legacy-unavailable', wallMs: null },
      deliveryStatus: deliveryStatus(directory, requestedBatch, registry),
    };
  }
  if (
    ['settle', 'deliver'].includes(mode) &&
    !batch &&
    existsSync(path.join(common, 'task-batches/archive', requestedBatch + '.json'))
  ) {
    const archived = read(path.join(common, 'task-batches/archive', requestedBatch + '.json'));
    assert.equal(mode === 'deliver' ? archived.recordedHead : archived.main.local, rest[1]);
    recoverWriter(directory);
    const old = openCompletion(directory, requestedBatch, { formal: false });
    if (old.events.some((e) => e.status === 'running')) recoverInterrupted(old, directory);
    assert.ok(
      old.events.some((e) => e.name === 'cleanup' && e.status === 'success'),
      'No owned completed cleanup',
    );
    if (!old.closedAt) {
      old.closedAt = Date.parse(archived.closedAt);
      saveCompletion(directory, old);
    }
    const ci = [...old.events]
      .reverse()
      .find((e) => e.name === 'ci' && e.status === 'success' && e.result?.headSha === archived.main.local);
    assert.ok(ci, 'No retained main CI proof');
    let receiptRestored = false;
    if (!existsSync(path.join(directory, 'completion-receipt.json'))) {
      if (!old.events.some((e) => e.name === 'close' && e.key === ci.key && e.status === 'success')) {
        trackStageRestoration(old, directory);
        await completionStage(
          old,
          'close',
          ci.key,
          async () => ({ batch: archived.id, main: archived.main, recoveredFrom: 'closed-registry-proof' }),
          { save: (s) => saveCompletion(directory, s) },
        );
        finishStageRestorations(old, directory);
      }
      restoreReceipt(directory, old, ci.key, archived);
      receiptRestored = true;
    }
    return {
      alreadyClosed: true,
      historical: true,
      summary: completionSummary(old),
      deliveryStatus: backfillDeliveryStatus(directory, requestedBatch, archived, { receiptRestored }),
    };
  }
  assert.ok(batch && batch.id === requestedBatch, 'Exact active batch required');
  assert.ok(
    [batch.worktree, batch.repository.anchor].map((p) => path.resolve(p)).includes(path.resolve(root)),
    'Use the registered task or retained main anchor',
  );
  if (mode === 'handoff-plan') {
    const file = path.join(directory, 'completion-session.json');
    return finalHandoffPlan(root, batch, rest[0], { execute, state: existsSync(file) ? read(file) : undefined });
  }
  if (['begin', 'freeze', 'deliver', 'final-handoff', 'settle'].includes(mode) && batch.taskRegistryVersion !== 2) {
    assertBatchModulesReady(batch);
  }
  if (recomposeManifestMain) {
    assert.ok(batch.taskRegistryVersion === 2 && batch.frozen?.accepted, 'Original registered freeze required');
    assert.equal(rest[1], batch.recordedHead, 'Recomposition requires the original recorded candidate');
  }
  if (['begin', 'freeze', 'deliver'].includes(mode)) {
    assertCurrentAdmission?.();
    const acceptance = freezeAcceptedSource(batch.worktree, batch);
    if (batch.taskRegistryVersion === 2) {
      const tasks = createTaskRegistry(root),
        current = tasks.readTask(batch.id);
      if (!current.frozen)
        tasks.revise(current.id, current.revision, (record) => {
          record.frozen = {
            accepted: acceptance.commit,
            tree: acceptance.tree,
            businessDigest: acceptance.businessDigest,
          };
          record.stage = 'frozen';
        });
      if (mode === 'deliver' && rest[1] !== batch.recordedHead) {
        assert.equal(
          execute(batch.worktree, 'git', ['rev-parse', 'HEAD']),
          rest[1],
          'Requested repair candidate is not HEAD',
        );
        assertAcceptedSource(batch.worktree, batch.id, rest[1]);
        const before = tasks.readTask(batch.id);
        const commits = execute(batch.worktree, 'git', ['rev-list', '--reverse', before.recordedHead + '..' + rest[1]])
          .split('\n')
          .filter(Boolean);
        tasks.revise(before.id, before.revision, (record) => {
          record.recordedHead = rest[1];
          for (const commit of commits)
            if (!record.checkpoints.some((item) => item.commit === commit))
              record.checkpoints.push({
                commit,
                verification:
                  'Candidate adopted only after original accepted business/control-plane identity check; formal gates remain required',
                recordedAt: new Date().toISOString(),
              });
        });
        batch = readActiveBatch(root);
      }
    }
    if (mode === 'freeze')
      return { acceptance, protection: 'local-content-addressed; remote-independent-enforcement-not-implied' };
  }
  if (mode === 'check-source') {
    if (rest.length === 1) return assertAcceptedSource(batch.worktree, batch.id, rest[0]);
    assert.equal(rest.length, 3, 'Use check-source <candidate> --continuation-main <exact-main>');
    assert.equal(rest[1], '--continuation-main');
    const main = rest[2];
    assert.match(main, /^[a-f0-9]{40}$/);
    assert.equal(git('rev-parse', 'refs/remotes/origin/main'), main, 'Exact fetched origin/main required');
    assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), main + '\trefs/heads/main', 'Published main moved');
    const claims = verifyLocalAcceptedContinuation(batch.worktree, batch.id, rest[0], main);
    assert.equal(claims.accepted, batch.frozen?.accepted, 'Registered original freeze changed');
    return claims;
  }
  if (['recover', 'deliver'].includes(mode)) recoverWriter(directory);
  const state = openCompletion(directory, batch.id, {
      requestedAt: mode === 'begin' ? rest[0] : undefined,
      formal: ['begin', 'deliver'].includes(mode),
    }),
    save = (s) => {
      saveCompletion(directory, s);
      finishStageRestorations(s, directory);
    };
  if (assertCurrentAdmission) Object.defineProperty(state, completionPermission, { value: assertCurrentAdmission });
  if (mode === 'pause-record' || mode === 'resume-record') {
    const marker = mode === 'pause-record' ? pauseCompletion(state) : resumeCompletion(state);
    save(state);
    return {
      batch: batch.id,
      marker,
      recordOnly: true,
      note: 'Only records user-request boundaries. It does not stop processes, CI, Git or services.',
    };
  }
  if (mode === 'deliver' && resumeCompletion(state)) save(state);
  if (['recover', 'deliver'].includes(mode)) recoverInterrupted(state, directory);
  trackStageRestoration(state, directory);
  if (mode === 'compose-reviewed') {
    assert.equal(batch.taskRegistryVersion, 2, 'Exact registered task required');
    assert.equal(path.resolve(root), path.resolve(batch.worktree), 'Use the owned task worktree');
    assert.ok(
      state.startedAt !== null && !state.closedAt && !state.deferredSettlement,
      'Active formal delivery required',
    );
    const [main, candidate] = rest;
    for (const commit of [main, candidate]) assert.match(commit, /^[a-f0-9]{40}$/);
    assert.equal(git('rev-parse', 'origin/main'), main, 'Use the exact published origin/main');
    assert.equal(git('rev-parse', 'HEAD'), batch.recordedHead, 'Exact checkpointed task parent required');
    assert.equal(git('status', '--porcelain'), '', 'Composition requires a clean owned task');
    const acceptance = readAcceptance(root, batch.id);
    assert.ok(acceptance, 'Original task freeze required');
    const verified = verifyRemoteAcceptance(root, {
      candidate,
      accepted: acceptance.commit,
      branch: batch.branch,
      trustedMain: main,
    });
    assert.equal(verified.reviewedMerge?.commit, candidate, 'Exact reviewed merge commit required');
    assert.equal(verified.reviewedMerge.main, main, 'Reviewed merge must use the exact published main parent');
    assert.equal(verified.reviewedMerge.taskHead, batch.recordedHead, 'Exact checkpointed task parent required');
    return (
      await completionStage(
        state,
        'prepare',
        'reviewed-composition:' + main + ':' + candidate,
        async () => {
          assertCurrentAdmission?.();
          const worktrees = parseWorktreePorcelain(git('worktree', 'list', '--porcelain'));
          await previewControl.prepareComposition({
            anchor: batch.repository.anchor,
            task: batch.worktree,
            preview: worktrees.find((entry) => entry.branch === 'codex/preview-current')?.path,
            common,
            main,
            taskRegistryVersion: 2,
          });
          assertCurrentAdmission?.();
          const composed = applyTaskComposition(root, batch.id, main, { reviewedCandidate: candidate });
          return {
            task: batch.id,
            head: composed.recordedHead,
            accepted: acceptance.commit,
            main,
            review: verified.review,
          };
        },
        { save },
      )
    ).result;
  }
  if (mode === 'recover') return { batch: batch.id, summary: completionSummary(state) };
  if (['begin', 'deliver'].includes(mode) && !state.previewFingerprint) {
    const profile = path.join(common, 'preview-environment/environment.json');
    if (existsSync(profile))
      state.previewFingerprint = createHash('sha256')
        .update(JSON.stringify(read(profile).profile))
        .digest('hex');
    save(state);
  }
  if (mode === 'deliver') {
    assert.equal(rest[1], batch.recordedHead, 'Exact frozen task head required');
    return runCompletionFlow(root, batch, rest[1], {
      preparationOnly,
      engineeringReviewFile,
      publishedRepairId,
      recomposeManifestMain,
      assertCurrentAdmission,
      execute,
      state,
      save,
      directory,
      checkRuntime,
      common,
      inventoryAssets,
      previewControl,
      runtimeReferences,
      deferSettle,
      readState: () => openCompletion(directory, batch.id, { formal: false }),
      dispatch: (cwd, args) =>
        completionCommandLocked(cwd, args, {
          preserveAssets,
          checkRuntime,
          execute,
          runtimeSnapshot,
          runtimeProof,
          waitQuality,
          verifyEvidence,
          previewControl,
          runtimeReferences,
          assertCurrentAdmission,
        }),
    });
  }
  if (mode === 'begin') {
    const profile = path.join(common, 'preview-environment/environment.json');
    if (!state.previewFingerprint && existsSync(profile))
      state.previewFingerprint = createHash('sha256')
        .update(JSON.stringify(read(profile).profile))
        .digest('hex');
    save(state);
    return { batch: batch.id, startedAt: new Date(state.startedAt).toISOString(), clockSource: state.clockSource };
  }
  if (mode === 'handoff-deferred-maintenance') {
    // The one-time bootstrap has already merged by the ordinary protected GitHub
    // path. This entry only applies its Git-only runtime handoff.
    assert.equal(batch.id, 'deferred-calendar-delivery-slot-release');
    assert.equal(batch.kind, 'infrastructure');
    const [main, grantFile] = rest;
    assert.match(main, /^[a-f0-9]{40}$/);
    const anchor = batch.repository.anchor;
    assert.equal(registeredMainAnchor(root, execute === run), anchor);
    const tasks = createTaskRegistry(root);
    const prepared = state.preparedCandidates?.find((entry) => entry.head === batch.recordedHead);
    assert.equal(prepared?.task, batch.id, 'Exact prepared maintenance PR required');
    assert.equal(prepared.accepted, batch.frozen?.accepted);
    const initialCi = state.events.findLast(
      (e) => e.name === 'ci' && e.status === 'success' && e.key === prepared.head + ':' + prepared.runId,
    );
    assert.equal(initialCi?.result?.eventName, 'pull_request');
    assertCompletionQuality(initialCi.result, prepared.head, prepared.runId);
    const status = deliveryStatus(directory, batch.id, tasks.readTask(batch.id));
    if (status.formalDeliveryComplete) {
      assert.equal(status.main, main);
      return { alreadyClosed: true, deliveryStatus: status };
    }
    return createResourceLeases(common).run('main-delivery', batch.id, async () => {
      const grant = assertDeferredMaintenanceGrant(directory, batch, createExecutionOrder(common).read(), grantFile);
      assert.equal(grant.pullRequest, prepared.pullRequest);
      assert.equal(grant.prRunId, prepared.runId);
      const held = createTaskDeliveryQueue(common)
        .inspect()
        .tickets.find((item) => !item.deferred?.release);
      assert.ok(
        held?.task === 'scheduled-manifest-cleanup' && held.deferred && held.status === 'waiting',
        'Original deferred maintenance barrier is missing or not idle',
      );
      assert.equal(held.deferred.main, grant.base);
      const capability = deliveryCiCapability(anchor, (command, args) => execute(anchor, command, args));
      assert.equal(capability.verified, true, 'Protected main quality policy must be proven');
      const pull = JSON.parse(
        execute(anchor, 'gh', [
          'pr',
          'view',
          String(prepared.pullRequest),
          '--json',
          'baseRefName,headRefName,headRefOid,state,mergeCommit',
        ]),
      );
      assert.equal(pull.baseRefName, 'main');
      assert.equal(pull.headRefName, batch.branch);
      assert.equal(pull.headRefOid, prepared.head);
      assert.equal(pull.state, 'MERGED');
      assert.equal(pull.mergeCommit?.oid, main);
      git('fetch', 'origin');
      assert.equal(git('rev-parse', 'origin/main'), main);
      assert.equal(execute(anchor, 'git', ['rev-parse', 'HEAD']), main);
      assert.equal(git('rev-list', '--parents', '-n', '1', main), [main, held.deferred.main, prepared.head].join(' '));
      assert.equal(git('rev-parse', main + '^{tree}'), git('rev-parse', prepared.head + '^{tree}'));
      assert.equal(assertAcceptedSource(anchor, batch.id, main).accepted, prepared.accepted);
      assertCurrentAdmission();
      const dispatch = (args) =>
        completionCommandLocked(root, args, {
          preserveAssets,
          checkRuntime,
          execute,
          runtimeSnapshot,
          runtimeProof,
          waitQuality,
          verifyEvidence,
          previewControl,
          runtimeReferences,
          assertCurrentAdmission,
        });
      const proof = state.events.findLast(
        (e) => e.name === 'ci' && e.status === 'success' && e.result?.headSha === main && e.result?.branch === 'main',
      );
      const ci = proof?.result ?? (await dispatch(['wait', 'main', main]));
      liveMainQuality(anchor, execute, capability.repository, main, ci.runId);
      const refresh = (stage) => {
        const current = tasks.readTask(batch.id);
        if (
          current.stage === 'closed' ||
          current.stage === stage ||
          (current.stage === 'handoff-verified' && stage === 'main-verified')
        )
          return;
        tasks.revise(current.id, current.revision, (record) => {
          record.stage = stage;
          record.main = { local: main, remote: main, runId: String(ci.runId) };
        });
      };
      refresh('main-verified');
      const passed = openCompletion(directory, batch.id, { formal: false });
      if (!passed.events.some((e) => e.name === 'handoff' && e.key === main + ':final' && e.status === 'success')) {
        const current = selectedTaskBatch(root);
        await finalHandoff(root, current, main, {
          execute,
          runtimeSnapshot,
          runtimeProof,
          checkRuntime,
          state: passed,
          save,
          common,
          previewControl,
          sourceOnly: {
            verify: (plan, owner) => verifySourceOnlyMaintenance(plan, current, grant.base, owner, execute),
          },
        });
      }
      refresh('handoff-verified');
      return { status: 'maintenance-handoff-verified', main, runId: String(ci.runId), formalDeliveryComplete: false };
    });
  }
  if (mode === 'final-handoff') {
    const options = { execute, runtimeSnapshot, runtimeProof, checkRuntime, state, save, common, previewControl };
    return finalHandoff(root, batch, rest[0], options);
  }
  if (mode === 'measure') {
    const [label, separator, command, ...commandArgs] = rest;
    assert.ok(
      ['prepare', 'handoff', 'review', 'repair', 'push', 'pr', 'merge', 'sync'].includes(label) &&
        separator === '--' &&
        command,
      'measure <stage> -- <command> [args]',
    );
    return completionStage(
      state,
      label,
      git('rev-parse', 'HEAD'),
      () => {
        const r = runCompletionProcess(command, commandArgs, { cwd: root, stdio: 'inherit' });
        assert.equal(r.status, 0, 'Measured stage failed; retain its original output');
        return { exitCode: 0 };
      },
      { save },
    );
  }
  if (mode === 'repair-start') {
    const [id, failureRun, category, file, kind] = rest,
      evidence = path.resolve(root, file ?? '');
    assert.ok(
      evidence.startsWith(directory + path.sep) ||
        evidence.startsWith(path.join(batch.worktree, '.task-verification') + path.sep),
      'Diagnostic evidence must belong to this batch',
    );
    recordRepair(state, { id, failureRun, category, evidence, kind });
    save(state);
    return { repair: id, status: 'open' };
  }
  if (mode === 'repair-finish') {
    finishRepair(state, rest[0]);
    save(state);
    return { repair: rest[0], status: 'verified' };
  }
  if (mode === 'record-ci-diagnosis') {
    assertCurrentAdmission?.();
    assert.equal(batch.taskRegistryVersion, 2, 'Exact independent task required');
    assert.equal(readAcceptance(batch.worktree, batch.id)?.commit, batch.frozen.accepted);
    const anchor = batch.repository.anchor;
    const main = batch.main?.local;
    assert.match(main ?? '', /^[a-f0-9]{40}$/);
    assert.equal(execute(anchor, 'git', ['rev-parse', 'HEAD']), main);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), main + '\trefs/heads/main');
    assertAcceptedSource(batch.worktree, batch.id, main);
    const diagnosis = recordHistoricalCiDiagnosis(state, batch, rest[0], path.resolve(root, rest[1]));
    save(state);
    return { diagnosis, formalDeliveryComplete: false };
  }
  if (mode === 'wait') {
    let [runId, head] = rest;
    if (['pr', 'main'].includes(runId)) {
      const selector = runId,
        branch = selector === 'pr' ? batch.branch : 'main';
      runId = (
        await completionStage(
          state,
          'discovery',
          `${selector}:${head}`,
          async () => {
            for (let attempt = 0; ; attempt++) {
              try {
                const runs = JSON.parse(
                  execute(root, 'gh', [
                    'run',
                    'list',
                    '--workflow',
                    'quality.yml',
                    '--branch',
                    branch,
                    '--event',
                    selector === 'pr' ? 'pull_request' : 'push',
                    '--commit',
                    head,
                    '--limit',
                    '20',
                    '--json',
                    'databaseId,headSha,event,headBranch',
                  ]),
                );
                return selectQualityRun(runs, { selector, branch, head });
              } catch (error) {
                if (error.code !== 'CI_RUN_MISSING' || attempt >= 12) throw error;
                await new Promise((resolve) => setTimeout(resolve, 5000));
              }
            }
          },
          { save },
        )
      ).result;
    }
    const result = (
      await completionStage(
        state,
        'ci',
        `${head}:${runId}`,
        () =>
          waitQuality(root, runId, head, {
            onProgress: async (progress) => {
              captureCiProgress(common, batch.id, progress);
              await drainProgressHost();
            },
          }),
        { save },
      )
    ).result;
    return {
      runId: result.runId,
      headSha: result.headSha,
      conclusion: result.conclusion,
      attempt: result.attempt,
      gatesFinishedAt: result.gatesFinishedAt,
      elapsedMs: result.elapsedMs,
      jobs: result.jobs.map(({ name, status, conclusion }) => ({ name, status, conclusion })),
      next: {
        phase: result.eventName === 'push' && result.branch === 'main' ? 'final-handoff' : 'merge',
        head: result.headSha,
        runId: String(runId),
        ...(result.eventName === 'push' && result.branch === 'main'
          ? {
              handoff: ['npm', 'run', 'task:completion', '--', 'final-handoff', head],
              settle: ['npm', 'run', 'task:completion', '--', 'settle', batch.id, head, String(runId)],
            }
          : {}),
      },
    };
  }
  if (mode !== 'settle') throw Error('Unknown completion command');
  assert.ok(state.startedAt !== null, 'Begin formal completion before settle');
  if (state.deferredSettlement && batch.id === 'scheduled-manifest-cleanup')
    assert.ok(deferredTurn?.deferred.release, 'Release the original calendar ticket before settlement');
  assert.ok(
    state.events.every((e) => e.status !== 'running'),
    'A recorded stage is still running; preserve its process and evidence',
  );
  assert.ok(
    state.events
      .filter((e) => e.failure?.ci)
      .every(
        (e) =>
          state.repairs.some((r) => r.failureRun === String(e.failure.ci.runId)) ||
          hasHistoricalCiDiagnosis(state, e, batch.frozen?.accepted, rest[1], rest[2]) ||
          hasAppliedPublishedCiRepair(state, e, batch, rest[1], rest[2], git),
      ),
    'Record diagnosed repair cost for each failed CI before closing',
  );
  const [, expectedMain, runId] = rest;
  assert.match(expectedMain ?? '', /^[a-f0-9]{40}$/);
  assert.match(runId ?? '', /^\d+$/);
  const entries = parseWorktreePorcelain(git('worktree', 'list', '--porcelain')),
    anchor = entries.find((e) => e.branch === 'main')?.path,
    integration = entries.find((e) => e.branch === 'codex/integration-current')?.path,
    preview = entries.find((e) => e.branch === 'codex/preview-current')?.path;
  assert.ok(anchor && integration && preview, 'Required retained worktrees missing');
  const key = expectedMain + ':' + runId;
  const cleanupPolicy = path.join(common, 'task-cleanup/policy.json');
  const deferCleanup =
    batch.taskRegistryVersion === 2 && existsSync(cleanupPolicy) && loadCleanupPolicy(common).ownershipV2 === true;
  const cleanupDisposition = {
    state: 'deferred-to-scheduled-cleanup',
    task: batch.id,
    worktree: batch.worktree,
    branch: batch.branch,
    head: batch.recordedHead,
    main: expectedMain,
  };
  for (const repair of state.repairs.filter((r) => !r.finishedAt && r.isCiFailure !== false))
    finishRepair(state, repair.id);
  save(state);
  const cleanupStarted = state.events.some((e) => e.name === 'cleanup' && e.key === key);
  const preserved = [...state.events]
    .reverse()
    .find((e) => e.name === 'preserve' && e.key === key && e.status === 'success');
  const taskExists = existsSync(batch.worktree);
  assert.ok(taskExists || (cleanupStarted && preserved), 'Missing task without owned cleanup proof');
  if (!taskExists) verifyPreservation(preserved.result.manifest, path.join(common, 'task-assets', batch.id));
  let lineage = historicalRecovery,
    calendarProof;
  if (deferredTurn?.deferred.release) {
    const taskRegistry = createTaskRegistry(root);
    const { archive } = readDeferredHandoff(directory, batch, state, deferredTurn);
    const { schedule } = await cleanupCommand(anchor, ['schedule-status']);
    calendarProof = verifyCalendarAcceptance({
      directory,
      archive,
      evidenceFile: externalAcceptanceFile,
      schedule,
      destination: existsSync(cleanupPolicy) ? loadCleanupPolicy(common).notification?.destination : undefined,
    });
    lineage = verifyDeferredLineage({ anchor, registry: taskRegistry, archive, execute });
  } else if (!historicalRecovery) {
    // One fresh remote snapshot before destructive steps; never infer a different batch.
    git('fetch', 'origin');
    assert.equal(execute(anchor, 'git', ['rev-parse', 'HEAD']), expectedMain);
    assert.equal(git('rev-parse', 'origin/main'), expectedMain);
  }
  const liveMain = lineage?.main ?? expectedMain;
  const local = git('for-each-ref', '--format=%(objectname)', 'refs/heads/' + batch.branch);
  const remote = git('ls-remote', 'origin', 'refs/heads/' + batch.branch);
  assert.ok(local === batch.recordedHead || (!local && cleanupStarted), 'Task local ref changed');
  assert.ok(remote.startsWith(batch.recordedHead + '\t') || (!remote && cleanupStarted), 'Task remote ref changed');
  if (taskExists) {
    assert.equal(execute(batch.worktree, 'git', ['status', '--porcelain']), '');
    planBatchDelivery(batch.worktree);
  }
  assert.equal(execute(anchor, 'git', ['status', '--porcelain']), '');
  git('merge-base', '--is-ancestor', batch.recordedHead, liveMain);
  assertAcceptedSource(anchor, batch.id, expectedMain);
  // Exact business/control-plane identity is frozen; main CI validates the final technical tree.
  assert.ok(readAcceptance(anchor, batch.id), 'Missing accepted source');
  const ciEvent = [...state.events].reverse().find((e) => e.name === 'ci' && e.key === key && e.status === 'success');
  assert.ok(ciEvent, 'Use the single wait entry before settle');
  assertCompletionQuality(ciEvent.result, expectedMain, runId);
  if (!lineage) {
    const repository = JSON.parse(execute(root, 'gh', ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    liveMainQuality(root, execute, repository, expectedMain, runId);
  }
  const evidence = path.join(directory, 'ci-' + runId),
    proofFile = path.join(directory, 'ci-' + runId + '-proof.json');
  const result = await settleCompletion(
    state,
    key,
    {
      evidence: {
        run: () => {
          return completionEvidence({ root: anchor, evidence, proofFile, ci: ciEvent.result, execute, verifyEvidence });
        },
        reuse: () => false,
      },
      handoff: {
        run: async () => {
          const snapshot = runtimeSnapshot(integration),
            proof = runtimeProof(integration);
          assert.ok(
            integrationProofMatches(proof, snapshot) && snapshot.worktreeClean,
            'Published runtime handoff must be completed first',
          );
          assert.equal(proof.taskHead, lineage?.successors?.at(-1)?.head ?? batch.recordedHead);
          assert.equal(proof.integrationHead, snapshot.integrationHead);
          git('merge-base', '--is-ancestor', liveMain, snapshot.integrationHead);
          assert.ok(retainedPublishedPreview(root, preview), 'Retained preview must already match published main');
          assert.equal(
            existsSync(path.join(integration, 'backups/task-preview/active-database-task.json')),
            false,
            'Database task lock remains',
          );
          await previewControl.check({
            anchor,
            task: batch.worktree,
            preview,
            main: liveMain,
            common,
            taskRegistryVersion: batch.taskRegistryVersion,
          });
          const runtime = await checkRuntime(root, common);
          assert.equal(runtime.runtimeHealthy, true);
          assert.equal(runtime.backupRetained, true);
          if (state.previewFingerprint)
            assert.equal(runtime.profileFingerprint, state.previewFingerprint, 'Persistent data profile changed');
          return lineage ? { ...runtime, lineage, calendar: calendarProof } : runtime;
        },
      },
      preserve: {
        reuse: () => Boolean(lineage && cleanupStarted),
        run: async () => {
          if (previewControl.assertCleanupSafe)
            await previewControl.assertCleanupSafe({
              anchor,
              task: batch.worktree,
              preview,
              common,
              main: liveMain,
            });
          if (!existsSync(batch.worktree)) return preserved.result;
          if (deferCleanup) return { state: 'evidence-retained-for-scheduled-cleanup' };
          const cleanupHandoff =
            batch.taskRegistryVersion === 2
              ? await handoffBuiltDist({
                  root: batch.worktree,
                  common,
                  task: batch.id,
                  proof: {
                    worktree: batch.worktree,
                    head: batch.recordedHead,
                    accepted: readAcceptance(anchor, batch.id).commit,
                    main: expectedMain,
                  },
                  assertUnreferenced: async () => {
                    const task = createTaskRegistry(anchor).readTask(batch.id);
                    const references = await runtimeReferences(task);
                    assert.equal(references.owned.length, 0, 'Task frontend still references generated output');
                    assert.equal(references.backendPorts.length, 0, 'Task backend still references generated output');
                    if (previewControl.assertCleanupSafe)
                      await previewControl.assertCleanupSafe({
                        anchor,
                        task: batch.worktree,
                        preview,
                        common,
                        main: liveMain,
                      });
                  },
                })
              : { state: 'retained', reason: 'Legacy task outputs remain protected' };
          const createdHandoffs =
            batch.taskRegistryVersion === 2
              ? await handoffCreatedArtifacts({
                  root: batch.worktree,
                  common,
                  task: batch.id,
                  proof: {
                    worktree: batch.worktree,
                    head: batch.recordedHead,
                    accepted: readAcceptance(anchor, batch.id).commit,
                    main: expectedMain,
                  },
                  assertUnreferenced: async (record) => {
                    const current = createTaskRegistry(anchor).readTask(batch.id),
                      references = await runtimeReferences(current);
                    assert.equal(references.owned.length, 0, 'Task frontend still references created artifacts');
                    assert.equal(references.backendPorts.length, 0, 'Task backend still references created artifacts');
                    if (previewControl.assertCleanupSafe)
                      await previewControl.assertCleanupSafe({
                        anchor,
                        task: batch.worktree,
                        preview,
                        common,
                        main: liveMain,
                      });
                    assertCleanupUnreferenced(record);
                  },
                })
              : { registered: false, handedOff: [], protected: [] };
          const dependencyHandoffs =
            batch.taskRegistryVersion === 2
              ? await handoffAuditedDependencies({
                  root: batch.worktree,
                  common,
                  task: batch.id,
                  proof: {
                    worktree: batch.worktree,
                    head: batch.recordedHead,
                    accepted: readAcceptance(anchor, batch.id).commit,
                    main: expectedMain,
                  },
                  assertUnreferenced: async (record) => {
                    const current = createTaskRegistry(anchor).readTask(batch.id),
                      references = await runtimeReferences(current);
                    assert.equal(references.owned.length, 0, 'Task frontend still references private dependencies');
                    assert.equal(
                      references.backendPorts.length,
                      0,
                      'Task backend still references private dependencies',
                    );
                    if (previewControl.assertCleanupSafe)
                      await previewControl.assertCleanupSafe({
                        anchor,
                        task: batch.worktree,
                        preview,
                        common,
                        main: liveMain,
                      });
                    assertCleanupUnreferenced(record);
                  },
                })
              : { registered: false, handedOff: [], protected: [] };
          const preservedAssets = preserveAssets(batch.worktree, path.join(common, 'task-assets', batch.id));
          const reportHandoffs =
            batch.taskRegistryVersion === 2
              ? await handoffPreservedReportCopies({
                  root: batch.worktree,
                  common,
                  task: batch.id,
                  proof: {
                    worktree: batch.worktree,
                    head: batch.recordedHead,
                    accepted: readAcceptance(anchor, batch.id).commit,
                    main: expectedMain,
                  },
                  preserved: preservedAssets,
                  assertUnreferenced: async () => {
                    const task = createTaskRegistry(anchor).readTask(batch.id);
                    const references = await runtimeReferences(task);
                    assert.equal(references.owned.length, 0, 'Task frontend still references reports');
                    assert.equal(references.backendPorts.length, 0, 'Task backend still references reports');
                    if (previewControl.assertCleanupSafe)
                      await previewControl.assertCleanupSafe({
                        anchor,
                        task: batch.worktree,
                        preview,
                        common,
                        main: liveMain,
                      });
                  },
                })
              : [];
          const cleanupInventory = recordCloseoutCleanupInventory({
            root: batch.worktree,
            common,
            task: batch.id,
            proof: {
              worktree: batch.worktree,
              head: batch.recordedHead,
              accepted: readAcceptance(anchor, batch.id).commit,
              main: expectedMain,
            },
            preserved: preservedAssets,
            distHandoff: cleanupHandoff,
            reportHandoffs,
            createdHandoffs,
            dependencyHandoffs,
          });
          return {
            ...preservedAssets,
            cleanupHandoff,
            reportHandoffs,
            createdHandoffs,
            dependencyHandoffs,
            cleanupInventory,
          };
        },
      },
      cleanup: {
        reuse: (prior) => {
          if (!lineage) return false;
          if (deferCleanup) return JSON.stringify(prior) === JSON.stringify(cleanupDisposition);
          return prior.worktreeRemoved && prior.branchRemoved && !taskExists && !local && !remote;
        },
        run: async () => {
          if (previewControl.assertCleanupSafe)
            await previewControl.assertCleanupSafe({
              anchor,
              task: batch.worktree,
              preview,
              common,
              main: liveMain,
            });
          if (batch.taskRegistryVersion === 2) {
            const task = createTaskRegistry(anchor).readTask(batch.id);
            assert.equal(task.stage, 'handoff-verified', 'Current task handoff is incomplete');
            const references = await runtimeReferences(task);
            assert.equal(references.owned.length, 0, 'Current task frontend still runs; retain its source');
            assert.equal(references.backendPorts.length, 0, 'Current task backend still runs; retain its source');
          }
          reconcileInterruptedValidationTiming(common, batch.id, { root: batch.worktree, completion: state, key });
          requireBatchTimingForCleanup(common, batch.id);
          if (existsSync(batch.worktree)) assert.equal(execute(batch.worktree, 'git', ['status', '--porcelain']), '');
          process.chdir(anchor);
          if (lineage) {
            assert.equal(execute(anchor, 'git', ['rev-parse', 'HEAD']), liveMain);
            assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), liveMain + '\trefs/heads/main');
          }
          if (deferCleanup) return cleanupDisposition;
          if (existsSync(batch.worktree)) execute(anchor, 'git', ['worktree', 'remove', batch.worktree]);
          if (git('for-each-ref', '--format=%(objectname)', 'refs/heads/' + batch.branch))
            execute(anchor, 'git', ['branch', '-d', batch.branch]);
          if (git('ls-remote', 'origin', 'refs/heads/' + batch.branch))
            execute(anchor, 'git', ['push', 'origin', '--delete', batch.branch]);
          else execute(anchor, 'git', ['update-ref', '-d', 'refs/remotes/origin/' + batch.branch]);
          assert.equal(existsSync(batch.worktree), false);
          assert.equal(execute(anchor, 'git', ['ls-remote', 'origin', 'refs/heads/' + batch.branch]), '');
          assert.equal(execute(anchor, 'git', ['rev-parse', 'HEAD']), liveMain);
          return { worktreeRemoved: true, branchRemoved: true };
        },
      },
      close: {
        run: () => {
          if (lineage) assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), liveMain + '\trefs/heads/main');
          const result =
            batch.taskRegistryVersion === 2 && (deferCleanup || lineage)
              ? closeTaskBatch(anchor, batch, {
                  ...(deferCleanup ? { deferredCleanup: cleanupDisposition } : {}),
                  ...(lineage ? { historicalMain: expectedMain, liveMain } : {}),
                })
              : closeBatch(anchor);
          return { batch: result.id, main: result.main };
        },
      },
    },
    { save },
  );
  result.remoteSnapshot = {
    main: expectedMain,
    checkedAt: new Date().toISOString(),
    source: 'fetch-and-exact-live-ci-identity',
    ...(lineage ? { currentMain: liveMain, lineage, calendar: calendarProof } : {}),
  };
  if (readTimeline(common, batch.id)) result.batchTiming = refreshTimeline(common, batch.id).summary;
  result.summary.timingScope = 'formal-delivery-only';
  writeReceipt(path.join(directory, 'completion-receipt.json'), result);
  result.deliveryStatus = backfillDeliveryStatus(
    directory,
    batch.id,
    read(path.join(common, 'task-batches/archive', batch.id + '.json')),
  );
  return result;
}

export function verifyPreservation(file, directory) {
  assert.equal(path.dirname(file), directory);
  assert.match(path.basename(file), /^assets-[a-f0-9]{64}\.json$/);
  const bytes = readFileSync(file);
  assert.equal(
    'assets-' + createHash('sha256').update(bytes).digest('hex') + '.json',
    path.basename(file),
    'Preservation manifest changed',
  );
  for (const e of JSON.parse(bytes))
    if (e.kind === 'private-dependencies-retained') verifyRetainedDependencies(e, directory);
    else if (e.kind !== 'external-dependency-retained') {
      assert.equal(e.kind, 'generated-output');
      assert.match(e.digest, /^[a-f0-9]{64}$/);
      const blob = path.join(directory, 'blobs', e.digest);
      assert.ok(!lstatSync(blob).isSymbolicLink());
      assert.equal(createHash('sha256').update(readFileSync(blob)).digest('hex'), e.digest, 'Preserved blob changed');
    }
  return true;
}

export async function completionCommand(root, args, options = {}) {
  if (args[0] === 'reference-proof') {
    const { parseReferenceProofArguments } = await import('./delivery-repairs/preview-reference-source.mjs');
    const selected = parseReferenceProofArguments(args.slice(1));
    const { collectPreviewReferenceProof } = await import('./delivery-repairs/preview-reference-proof.mjs');
    return collectPreviewReferenceProof(root, selected.foreignTask, selected.historyFile, {
      publishedBaseline: selected.publishedBaseline,
      effect: selected.effect,
    });
  }
  const proofFlag = args.indexOf('--reference-proof');
  if (proofFlag >= 0) {
    const [command, task] = args;
    assert.ok(
      ['prepare', 'deliver', 'settle', 'resume-post-merge'].includes(command),
      'Reference selection requires prepare, deliver, settle or resume-post-merge',
    );
    const effect = command === 'prepare' ? 'preparation' : 'final';
    const baseLength = command === 'resume-post-merge' ? 5 : command === 'settle' ? 4 : 3;
    const base = args.slice(0, baseLength);
    const flags = args.slice(baseLength);
    const preparationFlag = ['--engineering-review', '--published-repair', '--recompose-manifest'].find((flag) =>
      flags.includes(flag),
    );
    const reviewIndex = flags.indexOf(preparationFlag);
    assert.ok(
      flags.length === 2 || (command === 'prepare' && flags.length === 4 && [0, 2].includes(reviewIndex)),
      'Unexpected reference-proof arguments',
    );
    assert.ok([0, 2].includes(proofFlag - baseLength) && args[proofFlag + 1], 'Unexpected reference-proof arguments');
    if (flags.length === 4) {
      assert.equal(reviewIndex + proofFlag - baseLength, 2, 'Exact preparation option and reference proof required');
      assert.ok(flags[reviewIndex + 1], 'Preparation option value required');
      base.push(preparationFlag, flags[reviewIndex + 1]);
    }
    const { withPreviewReferenceProof } = await import('./delivery-repairs/preview-reference-proof.mjs');
    return withPreviewReferenceProof(root, args[proofFlag + 1], { task, effect }, () =>
      completionCommand(root, base, options),
    );
  }
  const registry = createTaskRegistry(root);
  const explicit = [
    'report',
    'settle',
    'defer-release',
    'resume-post-merge',
    'deliver',
    'prepare',
    'status',
    'backfill',
    'pause-record',
    'resume-record',
  ].includes(args[0])
    ? args[1]
    : null;
  const task = explicit ? registry.readTask(explicit) : selectedTaskBatch(root);
  const orderReadOnly = ['report', 'status', 'handoff-plan', 'check-source'].includes(args[0]);
  // Before private-lease recovery, freeze, automatic session restoration, or any external effect.
  // Even legacy/unregistered mutation is denied when the explicit policy is active.
  const executionOrder = createExecutionOrder(registry.commonDir);
  let effect = 'final';
  const action = args[0];
  const deferredAction = ['settle', 'defer-release'].includes(action);
  const admission = () => ({
    lane: 'delivery',
    task: task.id,
    owner: task.owner,
    admission: process.env.ZDM_EXECUTION_ADMISSION,
    effect,
  });
  const assertAdmission = () => {
    if (action === 'handoff-deferred-maintenance') {
      const current = registry.readTask(task.id);
      return assertDeferredMaintenanceGrant(
        path.join(registry.commonDir, 'task-delivery', task.id),
        current,
        executionOrder.read(),
        args[2],
      );
    }
    if (
      deferredAction &&
      executionOrder.read().tickets.some((t) => t.task === task.id && t.lane === 'delivery' && t.deferredDelivery)
    )
      return executionOrder.assertDeferredAdmission(admission());
    return executionOrder.assertAdmission(admission());
  };
  if (task && !orderReadOnly)
    assertTaskExecutor(
      task,
      options.owner ?? process.env.CODEX_THREAD_ID,
      'Completion must belong to the exact current chat/task',
    );
  if (action === 'handoff-deferred-maintenance') assert.ok(executionOrder.read(), 'Execution order must be active');
  if (!orderReadOnly && executionOrder.read()) {
    assert.ok(task, 'No registered execution-order task; do not adopt legacy work');
    const preparationCommand =
      ['prepare', 'freeze', 'begin', 'repair-start', 'repair-finish', 'compose-reviewed'].includes(args[0]) ||
      (args[0] === 'wait' && args[1] === 'pr' && args[2] === task.recordedHead);
    effect = preparationCommand ? 'preparation' : 'final';
    assertAdmission();
  }
  const guardedOptions = orderReadOnly
    ? options
    : {
        ...options,
        assertCurrentAdmission: () => {
          if (!executionOrder.read()) return;
          const current = registry.readTask(task.id);
          assertTaskExecutor(current, options.owner ?? process.env.CODEX_THREAD_ID);
          assertAdmission();
        },
      };
  if (task) {
    assert.ok(!task.previewOnly, 'Temporary combined previews cannot enter formal completion');
    assert.ok(!task.compatibility?.readOnly, 'Legacy frozen task remains on its reviewed recovery path');
    const readOnly = ['report', 'status', 'handoff-plan', 'check-source'].includes(args[0]);
    if (!readOnly)
      assertTaskExecutor(
        task,
        options.owner ?? process.env.CODEX_THREAD_ID,
        'Completion must belong to the exact current chat/task',
      );
    return withTaskContext({ id: task.id, commonDir: registry.commonDir, owner: task.owner }, async () => {
      if (readOnly) return completionCommandLocked(root, args, guardedOptions);
      const leases = createResourceLeases(registry.commonDir);
      leases.recoverEndedTask('task-delivery-' + task.id, task.owner, () => {
        const directory = path.join(registry.commonDir, 'task-delivery', task.id);
        assert.ok(
          existsSync(path.join(directory, 'completion-session.json')),
          'Interrupted owner has no process evidence; retain lease',
        );
        recoverWriter(directory);
        recoverInterrupted(openCompletion(directory, task.id, { formal: false }), directory);
        return true;
      });
      return leases.run('task-delivery-' + task.id, task.owner, async () => {
        if (action === 'resume-post-merge') {
          const [, id, ticketId, main, mainRunId] = args;
          assert.equal(args.length, 5, 'resume-post-merge <task> <original-ticket> <maintenance-main> <main-run>');
          assert.equal(id, POST_MERGE_SOURCE.task);
          assert.ok(executionOrder.read(), 'Original final execution scope required');
          const anchor = registeredMainAnchor(root, !options.execute);
          const common = registry.commonDir;
          const directory = path.join(common, 'task-delivery', id);
          const publicationFile = path.join(directory, 'post-merge-maintenance-publication.json');
          const queue = createTaskDeliveryQueue(common);
          const published = () => {
            const info = lstatSync(publicationFile);
            assert.ok(info.isFile() && !info.isSymbolicLink() && !(info.mode & 0o077));
            return read(publicationFile);
          };
          if (task.stage === 'closed' && !queue.inspect().tickets.some((item) => item.task === id)) {
            const prior = published();
            const status = deliveryStatus(directory, id, task);
            assert.ok(status.formalDeliveryComplete);
            assert.equal(prior.ticket, ticketId);
            assert.equal(prior.originalMain, POST_MERGE_SOURCE.main);
            assert.equal(prior.maintenance.main, main);
            assert.equal(prior.maintenance.mainRunId, mainRunId);
            return { alreadyClosed: true, maintenancePublication: prior, deliveryStatus: status };
          }

          const ticket = assertOriginalPostMergeTurn(queue, leases.inspect('main-delivery'), task, ticketId);
          const turn = await queue.wait(ticket, { waitForTurn: false });
          try {
            const assertRecoveryTurn = () => {
              guardedOptions.assertCurrentAdmission();
              assertOriginalPostMergeTurn(queue, leases.inspect('main-delivery'), task, turn.id, { active: true });
            };
            const result = await withIntegrationResource(anchor, id, async (integrationLease) => {
              assert.equal(integrationLease.task, id, 'Original integration scope required');
              assertRecoveryTurn();
              recoverWriter(directory);
              const state = openCompletion(directory, id, { formal: false });
              recoverInterrupted(state, directory);
              trackStageRestoration(state, directory);
              const execute = options.execute ?? run;
              const recovery = verifyPostMergeMaintenance({
                anchor,
                common,
                task,
                ticket: turn,
                state,
                main,
                mainRunId,
                execute,
                coordination: readTaskCoordination(common),
                ledger: executionOrder.read(),
              });
              assertRecoveryTurn();
              const publication = { version: 1, ticket: turn.id, ...recovery };
              if (existsSync(publicationFile)) assert.deepEqual(published(), publication);
              else writeReceipt(publicationFile, publication);

              const originalMain = recovery.originalMain;
              const handedOff = state.events.findLast(
                (item) => item.name === 'handoff' && item.key === originalMain + ':final' && item.status === 'success',
              );
              if (handedOff) {
                assert.equal(handedOff.result.main, main);
                assert.deepEqual(handedOff.result.maintenance, recovery.maintenance);
              } else {
                Object.defineProperty(state, completionPermission, { value: assertRecoveryTurn });
                await finalHandoff(anchor, selectedTaskBatch(anchor), main, {
                  execute,
                  runtimeSnapshot: options.runtimeSnapshot ?? integrationBackendSnapshot,
                  runtimeProof: options.runtimeProof ?? readIntegrationProof,
                  checkRuntime: options.checkRuntime,
                  state,
                  save: (current) => {
                    saveCompletion(directory, current);
                    finishStageRestorations(current, directory);
                  },
                  common,
                  previewControl: options.previewControl ?? createCompletionPreviewControl({ execute }),
                  recovery,
                });
              }
              assertRecoveryTurn();
              const current = registry.readTask(id);
              if (current.stage === 'main-verified')
                registry.revise(id, current.revision, (record) => {
                  record.stage = 'handoff-verified';
                });
              const settled = await completionCommandLocked(
                anchor,
                ['settle', id, originalMain, POST_MERGE_SOURCE.mainRunId],
                {
                  ...guardedOptions,
                  historicalRecovery: recovery,
                  assertCurrentAdmission: assertRecoveryTurn,
                },
              );
              assert.equal(
                settled.deliveryStatus?.formalDeliveryComplete,
                true,
                'Original post-merge delivery remains open',
              );
              return { ...settled, maintenancePublication: publication };
            });
            await queue.finish(turn, { success: true });
            return result;
          } catch (error) {
            await queue.finish(turn, { success: false, error });
            throw error;
          }
        }
        if (!deferredAction) return completionCommandLocked(root, args, guardedOptions);
        const common = registry.commonDir;
        const directory = path.join(common, 'task-delivery', task.id);
        const queue = createTaskDeliveryQueue(common);
        const ticket = queue.inspect().tickets.find((item) => item.task === task.id && item.deferred);
        if (!ticket) {
          assert.equal(action, 'settle', 'Original deferred FIFO ticket required');
          if (task.stage === 'closed') {
            const status = deliveryStatus(directory, task.id, task);
            if (status.formalDeliveryComplete && task.id === 'scheduled-manifest-cleanup') {
              assert.equal(status.main, args[2]);
              assert.equal(openCompletion(directory, task.id, { formal: false }).deferredSettlement?.runId, args[3]);
              return { alreadyClosed: true, deliveryStatus: status };
            }
          }
          return completionCommandLocked(root, args, guardedOptions);
        }
        assert.equal(ticket.owner, task.owner);
        assert.equal(ticket.accepted, task.frozen?.accepted);
        assert.equal(ticket.deferred.head, task.recordedHead);
        assert.equal(ticket.deferred.main, args[2]);
        assert.equal(ticket.deferred.runId, args[3]);
        if (action === 'defer-release') {
          assert.equal(
            args.length,
            7,
            'defer-release <task> <original-main> <run-id> <schedule-source> <slot-1> <slot-2>',
          );
          assert.ok(executionOrder.read(), 'Execution order must be active');
          const calendar = calendarRequirements(task.id, args.slice(5), args[4]);
          const state = openCompletion(directory, task.id, { formal: false });
          const anchor = registeredMainAnchor(root, !options.execute);
          assert.ok(
            state.events.every((event) => event.status !== 'running'),
            'Completion work is still active',
          );
          const prior = executionOrder.read().tickets.find((t) => t.task === task.id && t.lane === 'delivery');
          if (prior.deferredDelivery && ticket.status === 'waiting') {
            const saved = readDeferredHandoff(directory, task, state, ticket);
            assert.deepEqual(saved.archive.calendar, calendar, 'Original calendar requirements changed');
            assert.equal(saved.release.archive, prior.deferredDelivery.archive);
            return { status: 'deferred-released', queueTicket: ticket.id };
          }
          const turn = await queue.wait(ticket, { purpose: 'deferred-release', waitForTurn: false });
          try {
            const saved = await withIntegrationResource(anchor, task.id, async () => {
              const execute = options.execute ?? run;
              assert.equal(execute(anchor, 'git', ['status', '--porcelain']), '');
              assert.equal(
                execute(anchor, 'git', ['rev-parse', 'HEAD']),
                execute(anchor, 'git', ['rev-parse', 'origin/main']),
              );
              execute(anchor, 'git', ['merge-base', '--is-ancestor', calendar.sourceHead, args[2]]);
              const saved = preserveDeferredHandoff(directory, task, state, turn, calendar);
              verifyDeferredLineage({ anchor, archive: saved.archive, registry, execute });
              guardedOptions.assertCurrentAdmission();
              return saved;
            });
            await queue.releaseDeferred(turn, saved.release, (retained) =>
              executionOrder.deferDelivery(
                { ...admission(), queueTicket: retained.id, archive: saved.release.archive },
                (current) =>
                  retained.owner === current.owner && retained.deferred.release.archive === saved.release.archive,
              ),
            );
            return { status: 'deferred-released', queueTicket: ticket.id };
          } catch (error) {
            await queue.finish(turn, { success: false, error });
            throw error;
          }
        }
        const purpose = ticket.deferred.release ? 'deferred-settle' : 'delivery';
        if (purpose === 'deferred-settle') {
          const original = executionOrder.assertDeferredAdmission(admission());
          assert.equal(original.deferredDelivery.archive, ticket.deferred.release.archive);
          assert.equal(original.deferredDelivery.queueTicket, ticket.id);
          assert.ok(options.externalAcceptanceFile, 'Original executor calendar receipt required');
        }
        const turn = await queue.wait(ticket, { purpose, waitForTurn: purpose === 'delivery' });
        try {
          const settle = () => completionCommandLocked(root, args, { ...guardedOptions, deferredTurn: turn });
          const result =
            purpose === 'deferred-settle'
              ? await withIntegrationResource(registeredMainAnchor(root, !options.execute), task.id, settle)
              : await settle();
          assert.equal(
            result.deliveryStatus?.formalDeliveryComplete,
            true,
            'Deferred settlement did not close formal delivery',
          );
          if (purpose === 'deferred-settle')
            executionOrder.completeDeferred(admission(), { task: task.id, main: args[2] }, () => {
              const closed = registry.readTask(task.id);
              return (
                closed.main?.local === args[2] && deliveryStatus(directory, task.id, closed).formalDeliveryComplete
              );
            });
          await queue.finish(turn, { success: true });
          return result;
        } catch (error) {
          await queue.finish(turn, { success: false, error });
          throw error;
        }
      });
    });
  }
  if (!['begin', 'freeze', 'deliver', 'final-handoff', 'settle', 'measure'].includes(args[0]))
    return completionCommandLocked(root, args, options);
  const batch = readActiveBatch(root);
  if (!batch) return completionCommandLocked(root, args, options);
  const work = batchSharedWork(batch);
  const lease = work.claim({ owner: 'completion-' + randomUUID(), module: 'batch-delivery', resources: ['shared'] });
  try {
    return await completionCommandLocked(root, args, options);
  } finally {
    work.release(lease);
  }
}
