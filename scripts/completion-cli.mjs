import { deliveryStatus, backfillDeliveryStatus } from './completion-status.mjs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { runCompletionProcess } from './completion-process.mjs';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
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
import { readActiveBatch, closeBatch, planBatchDelivery } from './task-batch.mjs';
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
import { finalHandoffPlan, finalHandoff } from './completion-handoff.mjs';
import { createCompletionPreviewControl } from './completion-preview.mjs';
import { parseWorktreePorcelain } from './git-workflow-core.mjs';
import {
  integrationBackendSnapshot,
  integrationProofMatches,
  readIntegrationProof,
} from './integration-handoff-state.mjs';
import { retainedPublishedPreview } from './start-micro-task.mjs';

function run(root, command, args) {
  const r = runCompletionProcess(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    if (r.stderr) process.stderr.write(r.stderr.slice(-4000));
    throw new Error(command + ' failed; preserve state and inspect its original output');
  }
  return r.stdout.trim();
}
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
export async function completionCommand(
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
  },
) {
  const limits = {
    begin: [0, 1],
    deliver: [2, 2],
    recover: [0, 0],
    status: [1, 1],
    backfill: [1, 1],
    'pause-record': [1, 1],
    'resume-record': [1, 1],
    'handoff-plan': [1, 1],
    'final-handoff': [1, 1],
    report: [1, 1],
    settle: [3, 3],
    wait: [2, 2],
    'repair-start': [4, 5],
    'repair-finish': [1, 1],
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
  const batch = readActiveBatch(root),
    requestedBatch = ['report', 'settle', 'deliver', 'status', 'backfill', 'pause-record', 'resume-record'].includes(
      mode,
    )
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
  if (['recover', 'deliver'].includes(mode)) recoverWriter(directory);
  const state = openCompletion(directory, batch.id, {
      requestedAt: mode === 'begin' ? rest[0] : undefined,
      formal: ['begin', 'deliver'].includes(mode),
    }),
    save = (s) => {
      saveCompletion(directory, s);
      finishStageRestorations(s, directory);
    };
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
      execute,
      state,
      save,
      directory,
      checkRuntime,
      common,
      inventoryAssets,
      previewControl,
      dispatch: (cwd, args) =>
        completionCommand(cwd, args, {
          preserveAssets,
          checkRuntime,
          execute,
          runtimeSnapshot,
          runtimeProof,
          waitQuality,
          verifyEvidence,
          previewControl,
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
      await completionStage(state, 'ci', `${head}:${runId}`, () => waitQuality(root, runId, head), { save })
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
  assert.ok(
    state.events.every((e) => e.status !== 'running'),
    'A recorded stage is still running; preserve its process and evidence',
  );
  assert.ok(
    state.events
      .filter((e) => e.failure?.ci)
      .every((e) => state.repairs.some((r) => r.failureRun === String(e.failure.ci.runId))),
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
  // One fresh remote snapshot before destructive steps; no force/reset, never infer a different batch.
  git('fetch', 'origin');
  assert.equal(execute(anchor, 'git', ['rev-parse', 'HEAD']), expectedMain);
  assert.equal(git('rev-parse', 'origin/main'), expectedMain);
  const local = git('for-each-ref', '--format=%(objectname)', 'refs/heads/' + batch.branch);
  const remote = git('ls-remote', 'origin', 'refs/heads/' + batch.branch);
  assert.ok(local === batch.recordedHead || (!local && cleanupStarted), 'Task local ref changed');
  assert.ok(remote.startsWith(batch.recordedHead + '\t') || (!remote && cleanupStarted), 'Task remote ref changed');
  if (taskExists) {
    assert.equal(execute(batch.worktree, 'git', ['status', '--porcelain']), '');
    planBatchDelivery(batch.worktree);
  }
  assert.equal(execute(anchor, 'git', ['status', '--porcelain']), '');
  git('merge-base', '--is-ancestor', batch.recordedHead, expectedMain);
  assert.equal(
    git('rev-parse', batch.recordedHead + '^{tree}'),
    git('rev-parse', expectedMain + '^{tree}'),
    'Candidate tree changed',
  );
  const ciEvent = [...state.events].reverse().find((e) => e.name === 'ci' && e.key === key && e.status === 'success');
  assert.ok(ciEvent, 'Use the single wait entry before settle');
  assertCompletionQuality(ciEvent.result, expectedMain, runId);
  const repository = execute(root, 'gh', ['repo', 'view', '--json', 'nameWithOwner']);
  const name = JSON.parse(repository).nameWithOwner;
  const live = JSON.parse(execute(root, 'gh', ['api', `repos/${name}/actions/runs/${runId}`]));
  assert.equal(live.head_sha, expectedMain);
  assert.equal(live.run_attempt, 1);
  assert.equal(live.conclusion, 'success');
  assert.equal(live.status, 'completed');
  assert.equal(live.path, '.github/workflows/quality.yml');
  assert.equal(live.event, 'push');
  assert.equal(live.head_branch, 'main');
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
          assert.equal(proof.taskHead, batch.recordedHead);
          assert.equal(proof.integrationHead, snapshot.integrationHead);
          git('merge-base', '--is-ancestor', expectedMain, snapshot.integrationHead);
          assert.ok(retainedPublishedPreview(root, preview), 'Retained preview must already match published main');
          assert.equal(
            existsSync(path.join(integration, 'backups/task-preview/active-database-task.json')),
            false,
            'Database task lock remains',
          );
          await previewControl.check({ anchor, task: batch.worktree, preview, main: expectedMain, common });
          const runtime = await checkRuntime(root, common);
          assert.equal(runtime.runtimeHealthy, true);
          assert.equal(runtime.backupRetained, true);
          if (state.previewFingerprint)
            assert.equal(runtime.profileFingerprint, state.previewFingerprint, 'Persistent data profile changed');
          return runtime;
        },
      },
      preserve: {
        run: () =>
          existsSync(batch.worktree)
            ? preserveAssets(batch.worktree, path.join(common, 'task-assets', batch.id))
            : preserved.result,
      },
      cleanup: {
        run: () => {
          if (existsSync(batch.worktree)) assert.equal(execute(batch.worktree, 'git', ['status', '--porcelain']), '');
          process.chdir(anchor);
          if (existsSync(batch.worktree)) execute(anchor, 'git', ['worktree', 'remove', batch.worktree]);
          if (git('for-each-ref', '--format=%(objectname)', 'refs/heads/' + batch.branch))
            execute(anchor, 'git', ['branch', '-d', batch.branch]);
          if (git('ls-remote', 'origin', 'refs/heads/' + batch.branch))
            execute(anchor, 'git', ['push', 'origin', '--delete', batch.branch]);
          else execute(anchor, 'git', ['update-ref', '-d', 'refs/remotes/origin/' + batch.branch]);
          assert.equal(existsSync(batch.worktree), false);
          assert.equal(execute(anchor, 'git', ['ls-remote', 'origin', 'refs/heads/' + batch.branch]), '');
          assert.equal(execute(anchor, 'git', ['rev-parse', 'HEAD']), expectedMain);
          return { worktreeRemoved: true, branchRemoved: true };
        },
      },
      close: {
        run: () => {
          const result = closeBatch(anchor);
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
  };
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
    if (e.kind !== 'external-dependency-retained') {
      assert.equal(e.kind, 'generated-output');
      assert.match(e.digest, /^[a-f0-9]{64}$/);
      const blob = path.join(directory, 'blobs', e.digest);
      assert.ok(!lstatSync(blob).isSymbolicLink());
      assert.equal(createHash('sha256').update(readFileSync(blob)).digest('hex'), e.digest, 'Preserved blob changed');
    }
  return true;
}
