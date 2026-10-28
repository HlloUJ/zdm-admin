import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseWorktreePorcelain } from './git-workflow-core.mjs';
import { integrationProofMatches } from './integration-handoff-state.mjs';
import { retainedPublishedPreview } from './start-micro-task.mjs';
import { planBatchDelivery } from './task-batch.mjs';
import { completionStage } from './completion-session.mjs';

// Local, read-only target plan. The executing entry refreshes origin before planning.
export function finalHandoffPlan(root, batch, main, { execute, state }) {
  assert.match(main, /^[a-f0-9]{40}$/);
  planBatchDelivery(root);
  const git = (cwd, ...args) => execute(cwd, 'git', args);
  const worktrees = parseWorktreePorcelain(git(root, 'worktree', 'list', '--porcelain'));
  const locate = (branch) => {
    const selected = worktrees.filter((w) => w.branch === branch);
    assert.equal(selected.length, 1, 'Exact retained worktree required: ' + branch);
    const cwd = selected[0].path;
    assert.equal(git(cwd, 'status', '--porcelain'), '', 'Dirty worktree: ' + branch);
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'])
      assert.equal(
        existsSync(path.resolve(cwd, git(cwd, 'rev-parse', '--git-path', marker))),
        false,
        'Existing Git operation: ' + branch,
      );
    return cwd;
  };
  const anchor = locate('main'),
    integration = locate('codex/integration-current'),
    preview = locate('codex/preview-current');
  assert.equal(path.resolve(anchor), path.resolve(batch.repository.anchor));
  assert.equal(path.resolve(locate(batch.branch)), path.resolve(batch.worktree));
  assert.equal(git(anchor, 'rev-parse', 'HEAD'), main);
  assert.equal(git(anchor, 'rev-parse', 'origin/main'), main);
  assert.equal(git(root, 'rev-parse', batch.branch), batch.recordedHead);
  assert.equal(git(root, 'rev-parse', 'origin/' + batch.branch), batch.recordedHead);
  git(root, 'merge-base', '--is-ancestor', batch.recordedHead, main);
  assert.equal(
    git(root, 'rev-parse', batch.recordedHead + '^{tree}'),
    git(root, 'rev-parse', main + '^{tree}'),
    'Candidate tree changed',
  );
  const integrationHead = git(integration, 'rev-parse', 'HEAD'),
    previewHead = git(preview, 'rev-parse', 'HEAD');
  const remoteHead = git(integration, 'rev-parse', 'origin/codex/integration-current');
  const pending = state?.integrationPush;
  const ownedPending =
    pending?.main === main &&
    pending.taskHead === batch.recordedHead &&
    pending.localHead === integrationHead &&
    path.resolve(pending.worktree) === path.resolve(integration) &&
    [pending.oldRemote, pending.localHead].includes(remoteHead);
  if (integrationHead !== remoteHead) {
    assert.ok(ownedPending, 'Integration remote differs without this batch pending-push proof');
    git(root, 'merge-base', '--is-ancestor', remoteHead, integrationHead);
    git(root, 'merge-base', '--is-ancestor', main, integrationHead);
  }
  assert.equal(
    existsSync(path.join(integration, 'backups/task-preview/active-database-task.json')),
    false,
    'Active database protection lock: retain state and use the original guarded integration handoff',
  );
  git(root, 'merge-base', '--is-ancestor', previewHead, main);
  const base = git(root, 'merge-base', main, integrationHead);
  return {
    main,
    anchor,
    integration,
    preview,
    task: batch.worktree,
    taskHead: batch.recordedHead,
    integrationHead,
    previewHead,
    integrationNeedsMerge: base !== main,
    integrationNeedsPush: integrationHead !== remoteHead || (ownedPending && pending.status !== 'done'),
    remoteHead,
    previewNeedsAdvance: previewHead !== main,
    remoteEvidence: 'local-tracking-reference-only',
  };
}

export async function finalHandoff(root, batch, main, options) {
  const { execute, runtimeSnapshot, runtimeProof, checkRuntime, state, save, common, previewControl } = options;
  assert.ok(state.startedAt !== null, 'Begin formal completion before final handoff');
  // Use only the published entry, never execute a task candidate before its main CI succeeds.
  const ci = [...state.events]
    .reverse()
    .find((e) => e.name === 'ci' && e.status === 'success' && e.result?.headSha === main);
  assert.ok(
    ci?.result?.eventName === 'push' &&
      ci.result.branch === 'main' &&
      ci.result.attempt === 1 &&
      ci.result.conclusion === 'success',
    'Successful exact main CI required',
  );
  return (
    await completionStage(
      state,
      'handoff',
      main + ':final',
      async () => {
        execute(root, 'git', ['fetch', 'origin']);
        const plan = finalHandoffPlan(root, batch, main, options);
        const owner = await previewControl.assertOwner({ ...plan, common });
        const before = await checkRuntime(root, common, { allowPreviewUnavailable: true });
        assert.ok(
          (before.integrationHealthy ?? before.runtimeHealthy) && before.backupRetained,
          'Persistent runtime or backup unavailable',
        );
        if (state.previewFingerprint)
          assert.equal(before.profileFingerprint, state.previewFingerprint, 'Persistent data profile changed');
        if (plan.integrationNeedsMerge || plan.integrationNeedsPush) {
          await completionStage(
            state,
            'sync',
            main + ':integration',
            () => {
              try {
                if (plan.integrationNeedsMerge) execute(plan.integration, 'git', ['merge', '--no-edit', main]);
              } catch (error) {
                const merge = execute(plan.integration, 'git', ['rev-parse', '--git-path', 'MERGE_HEAD']);
                if (existsSync(path.resolve(plan.integration, merge)))
                  execute(plan.integration, 'git', ['merge', '--abort']);
                throw error;
              }
              const localHead = execute(plan.integration, 'git', ['rev-parse', 'HEAD']);
              state.integrationPush = {
                main,
                taskHead: batch.recordedHead,
                worktree: plan.integration,
                oldRemote: plan.remoteHead,
                localHead,
                status: 'pending',
              };
              save(state);
              if (plan.integrationNeedsMerge || plan.integrationHead !== plan.remoteHead)
                execute(plan.integration, 'git', ['push', 'origin', 'codex/integration-current']);
              assert.equal(
                execute(plan.integration, 'git', ['rev-parse', 'origin/codex/integration-current']),
                localHead,
              );
              state.integrationPush.status = 'done';
              save(state);
              return { main, localHead };
            },
            { save },
          );
        }
        if (plan.previewNeedsAdvance)
          await completionStage(
            state,
            'sync',
            main + ':preview',
            () => {
              execute(plan.preview, 'git', ['merge', '--ff-only', main]);
              return { main };
            },
            { save },
          );
        const snapshotReady = (snapshot) => {
          const proof = runtimeProof(plan.integration);
          return (
            integrationProofMatches(proof, snapshot) &&
            snapshot.worktreeClean &&
            proof.taskHead === batch.recordedHead &&
            proof.integrationHead === snapshot.integrationHead &&
            !existsSync(path.join(plan.integration, 'backups/task-preview/active-database-task.json'))
          );
        };
        const beforeSnapshot = runtimeSnapshot(plan.integration);
        const taskSelected = owner.worktree && path.resolve(owner.worktree) === path.resolve(plan.task);
        const reused = snapshotReady(beforeSnapshot) && !taskSelected;
        if (!reused)
          execute(plan.anchor, process.execPath, [
            path.join(plan.anchor, 'scripts/delivery-launcher.mjs'),
            'handoff',
            '--task',
            batch.branch,
          ]);
        // Keep fresh before/after runtime checks, then use the final snapshot for ancestry too.
        const afterSnapshot = runtimeSnapshot(plan.integration);
        assert.ok(snapshotReady(afterSnapshot), 'Published runtime handoff proof missing');
        execute(root, 'git', ['merge-base', '--is-ancestor', main, afterSnapshot.integrationHead]);
        assert.ok(retainedPublishedPreview(root, plan.preview), 'Retained preview differs from published main');
        const preview = await previewControl.ensure({ ...plan, common });
        assert.ok(retainedPublishedPreview(root, plan.preview), 'Retained preview changed during startup');
        const after = await checkRuntime(root, common);
        assert.ok(after.runtimeHealthy && after.backupRetained, 'Runtime health or backup changed');
        assert.equal(after.profileFingerprint, before.profileFingerprint, 'Persistent data profile changed');
        return {
          main,
          launcherReused: reused,
          previewReused: preview.reused,
          integrationUpdated: plan.integrationNeedsMerge,
          previewUpdated: plan.previewNeedsAdvance,
        };
      },
      { save },
    )
  ).result;
}
