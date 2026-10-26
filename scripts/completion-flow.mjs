import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { completionStage } from './completion-session.mjs';
import { parseWorktreePorcelain } from './git-workflow-core.mjs';
import { planBatchDelivery } from './task-batch.mjs';

// This command is invoked only after the human authorizes this exact batch's formal delivery.
// Every phase awaits its predecessor directly; no extra sleep, watcher, test run or approval loop.
export async function runCompletionFlow(
  root,
  batch,
  head,
  { execute, state, save, dispatch, checkRuntime, common, inventoryAssets },
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
  let repository;
  await phase('prepare', head, async () => {
    repository = JSON.parse(execute(root, 'gh', ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    git(root, 'fetch', 'origin');
    assert.equal(git(batch.worktree, 'rev-parse', 'HEAD'), head);
    assert.equal(git(batch.worktree, 'status', '--porcelain'), '');
    assert.equal(git(anchor, 'status', '--porcelain'), '');
    planBatchDelivery(root);
    const assets = inventoryAssets(batch.worktree);
    assert.ok(
      assets.every((a) => a.kind !== 'blocked'),
      'Unknown or private asset remains; retain task before pushing',
    );
    const integration = parseWorktreePorcelain(git(root, 'worktree', 'list', '--porcelain')).find(
      (w) => w.branch === 'codex/integration-current',
    )?.path;
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
    const runtime = await checkRuntime(root, common);
    assert.ok(runtime.runtimeHealthy && runtime.backupRetained, 'Runtime or backup preflight failed');
    if (state.previewFingerprint) assert.equal(runtime.profileFingerprint, state.previewFingerprint);
    return { head, protectionChecked: true, runtimePreflight: true, assets };
  });
  await phase('push', head, () => {
    const remote = git(root, 'ls-remote', 'origin', 'refs/heads/' + batch.branch);
    if (remote) assert.ok(remote.startsWith(head + '\t'), 'Remote task differs; never force push');
    else git(batch.worktree, 'push', '--set-upstream', 'origin', batch.branch);
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
  const awaitRun = (selector, sha) => dispatch(root, ['wait', selector, sha]);
  await awaitRun('pr', head);
  const main = await phase('merge', head, () => {
    const current = JSON.parse(
      execute(root, 'gh', ['pr', 'view', String(pull.number), '--json', 'headRefOid,baseRefOid,state,mergeCommit']),
    );
    assert.equal(current.headRefOid, head);
    git(root, 'fetch', 'origin');
    if (current.state === 'OPEN') {
      assert.equal(current.baseRefOid, git(root, 'rev-parse', 'origin/main'));
      execute(root, 'gh', ['pr', 'merge', String(pull.number), '--merge', '--match-head-commit', head]);
    } else assert.equal(current.state, 'MERGED');
    git(root, 'fetch', 'origin');
    const sha = git(root, 'rev-parse', 'origin/main');
    assert.equal(git(root, 'rev-parse', sha + '^{tree}'), git(root, 'rev-parse', head + '^{tree}'));
    const parents = git(root, 'rev-list', '--parents', '-n', '1', sha).split(' ');
    assert.equal(parents.length, 3);
    assert.equal(parents[2], head);
    return { sha };
  });
  await phase('sync', main.sha, () => {
    git(anchor, 'merge', '--ff-only', 'origin/main');
    return { main: main.sha };
  });
  const ci = await awaitRun('main', main.sha);
  await dispatch(anchor, ['final-handoff', main.sha]);
  return dispatch(anchor, ['settle', batch.id, main.sha, String(ci.runId)]);
}
