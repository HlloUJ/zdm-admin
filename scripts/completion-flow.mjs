import { assertAcceptedSource, publishAcceptance, readAcceptance } from './accepted-source.mjs';
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
import { withCandidateRuntime } from './task-candidate-runtime.mjs';

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
    candidateRuntime = withCandidateRuntime,
  },
) {
  assert.match(head, /^[a-f0-9]{40}$/);
  const anchor = batch.repository.anchor;
  if (!existsSync(batch.worktree)) {
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
  const phase = async (name, key, fn) => (await completionStage(state, name, key, fn, { save })).result;
  const parallel = batch.taskRegistryVersion === 2;
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
  // Complete an interrupted, already-proved merge before normal source checks.
  // Runtime quiescence happened before that proof was written.
  if (parallel) {
    applyTaskComposition(root, batch.id, undefined, { recover: true });
    batch = readActiveBatch(root);
    head = batch.recordedHead;
  }
  let repository;
  await phase('prepare', head, async () => {
    repository = JSON.parse(execute(root, 'gh', ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    git(root, 'fetch', 'origin');
    assert.equal(git(batch.worktree, 'rev-parse', 'HEAD'), head);
    assert.equal(git(batch.worktree, 'status', '--porcelain'), '');
    assertAcceptedSource(batch.worktree, batch.id, head);
    assert.equal(git(anchor, 'status', '--porcelain'), '');
    planBatchDelivery(root);
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
  async function publishCandidate({ readiness = false } = {}) {
    if (parallel) {
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
            state.events.some((e) => e.name === 'prepare' && e.key === head + ':readiness' && e.status === 'success'),
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
      publishAcceptance(batch.worktree, batch.id);
      const remote = git(root, 'ls-remote', 'origin', 'refs/heads/' + batch.branch);
      if (remote && !remote.startsWith(head + '\t')) {
        const before = remote.split(/\s/)[0];
        git(root, 'merge-base', '--is-ancestor', before, head);
        git(batch.worktree, 'push', 'origin', batch.branch);
      } else if (!remote) git(batch.worktree, 'push', '--set-upstream', 'origin', batch.branch);
      assert.ok(git(root, 'ls-remote', 'origin', 'refs/heads/' + batch.branch).startsWith(head + '\t'));
      return { head };
    });
    const pull = await phase('pr', head, () => {
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
      let pulls = JSON.parse(execute(root, 'gh', args)).filter((p) => p.headRefOid === head);
      assert.ok(pulls.length <= 1, 'Ambiguous pull request');
      if (!pulls.length) {
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
  await awaitRun('pr', head);
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
    return dispatch(anchor, ['settle', batch.id, main.sha, String(ci.runId)]);
  }
  if (!parallel) return complete();
  const queue = createTaskDeliveryQueue(common);
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
      await previewControl.prepareComposition(worktreePlan(latest));
      const composed = applyTaskComposition(root, batch.id, latest);
      batch = readActiveBatch(root);
      const changed = composed.recordedHead !== head;
      head = composed.recordedHead;
      // Development proof and the initial exact PR CI precede this turn. Run
      // final local readiness from the composed candidate's own immutable tools.
      pull = await publishCandidate({ readiness: true });
      if (changed) await awaitRun('pr', head);
    } else assert.equal(current.state, 'MERGED');
    const result = await complete(turn, queue);
    await queue.finish(turn, { success: true });
    return result;
  } catch (error) {
    await queue.finish(turn, { success: false, error });
    throw error;
  }
}
