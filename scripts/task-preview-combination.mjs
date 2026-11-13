import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { withIntegrationResource } from './integration-resource.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import { sourceEntries } from './accepted-source.mjs';

const git = (root, args, env = {}) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env },
    stdio: 'pipe',
  }).trim();

export function assertPreviewMember(task) {
  assert.equal(task.stage, 'developing', 'Only unfinished developing tasks may enter a preview combination');
  assert.ok(
    !task.compatibility?.readOnly && !task.recovery?.runtimeBlocked && !task.previewOnly,
    'Read-only, blocked or combined tasks cannot enter a preview combination',
  );
  assert.ok(
    !task.paused && !task.humanPause && !task.frozen,
    'Paused or frozen task cannot enter a preview combination',
  );
}

// Only the private temporary index is written. Source indexes, refs and files are never changed.
export function snapshotPreviewMember(root, task) {
  assertPreviewMember(task);
  const registry = createTaskRegistry(root);
  assert.equal(createTaskRegistry(task.worktree).commonDir, registry.commonDir, 'Member repository differs');
  const live = registry.resolve({ id: task.id, worktree: task.worktree });
  assertPreviewMember(live);
  const pauseFile = path.join(registry.commonDir, 'task-delivery', task.id, 'completion-session.json');
  if (existsSync(pauseFile)) {
    const session = JSON.parse(readFileSync(pauseFile));
    assert.ok(
      !(session.pauses ?? []).some((pause) => pause.finishedAt == null),
      'Completion pause requires explicit recovery',
    );
  }
  const head = git(task.worktree, ['rev-parse', 'HEAD']);
  const directory = mkdtempSync(path.join(tmpdir(), 'zdm-combination-index-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(directory, 'index') };
    git(task.worktree, ['read-tree', head], env);
    const files = execFileSync(
      'git',
      ['-C', task.worktree, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    for (const file of files) {
      assert.ok(
        !/(?:^|\/)(?:\.env(?!\.example$)|.*\.(?:pem|key)$|data-environment\.json$)/i.test(file),
        'Private input cannot enter preview source',
      );
      const absolute = path.join(task.worktree, file);
      if (existsSync(absolute))
        assert.ok(lstatSync(absolute).isFile(), 'Links and non-files require explicit handling');
    }
    git(task.worktree, ['add', '-A', '--', '.'], env);
    const tree = git(task.worktree, ['write-tree'], env);
    for (const entry of sourceEntries(task.worktree, tree, true))
      assert.ok(['100644', '100755'].includes(entry.mode), 'Preview source cannot include links or submodules');
    assert.equal(git(task.worktree, ['rev-parse', 'HEAD']), head, 'Member HEAD changed during snapshot');
    return { id: task.id, worktree: task.worktree, branch: task.branch, head, tree, revision: live.revision };
  } finally {
    rmSync(directory, { recursive: true });
  }
}

export function planPreviewCombination(root, ids) {
  assert.ok(ids.length >= 2 && new Set(ids).size === ids.length, 'At least two distinct exact task IDs required');
  const registry = createTaskRegistry(root);
  const members = ids.map((id) => snapshotPreviewMember(root, registry.resolve({ id })));
  const base = git(root, ['rev-parse', 'origin/main']);
  let combined = base;
  for (const member of members) {
    const snapshot = git(root, [
      'commit-tree',
      member.tree,
      '-p',
      member.head,
      '-m',
      'Temporary preview snapshot; not a delivery candidate',
    ]);
    const merge = spawnSync(
      'git',
      ['--no-replace-objects', '-C', root, 'merge-tree', '--write-tree', combined, snapshot],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    assert.equal(merge.status, 0, 'Preview source conflict; no member changed:\n' + merge.stdout + merge.stderr);
    const tree = merge.stdout.split('\n')[0];
    assert.match(tree, /^[a-f0-9]{40}$/);
    combined = git(root, [
      'commit-tree',
      tree,
      '-p',
      combined,
      '-p',
      snapshot,
      '-m',
      'Temporary combined preview; never deliver',
    ]);
  }
  const plan = {
    version: 1,
    previewOnly: true,
    base,
    members,
    tree: git(root, ['rev-parse', combined + '^{tree}']),
    combined,
  };
  verifyPreviewMembers(root, plan);
  return plan;
}

export function verifyPreviewMembers(root, plan) {
  const registry = createTaskRegistry(root);
  for (const member of plan.members)
    assert.deepEqual(
      snapshotPreviewMember(root, registry.resolve({ id: member.id })),
      member,
      'Member changed; prepare a new combination instead of updating this one',
    );
}

// The caller creates an ordinary empty infrastructure task using the published start entry.
// Mark it preview-only before materializing any combined source. Failure retains this marker.
export function assertCombinationRuntime(root, task) {
  if (!task.previewOnly) return;
  assert.equal(task.resources.dataScope, 'isolated-task', 'Combined preview requires isolated data');
  verifyPreviewMembers(root, task.previewOnly);
  assert.equal(git(task.worktree, ['diff', '--name-only']), '', 'Combination source changed after preparation');
  assert.equal(
    git(task.worktree, ['ls-files', '--others', '--exclude-standard']),
    '',
    'Combination gained unrecorded source',
  );
  assert.equal(git(task.worktree, ['write-tree']), task.previewOnly.tree, 'Combination index changed');
}

export async function applyPreviewCombination(root, targetId, plan, owner, dependencies = {}) {
  const registry = createTaskRegistry(root);
  const leases = createResourceLeases(registry.commonDir);
  return leases.run('task-delivery-' + targetId, owner, () =>
    leases.run('task-preview-' + targetId, targetId, () =>
      withIntegrationResource(root, targetId, async () => {
        const target = registry.resolve({ id: targetId });
        assert.ok(
          !existsSync(path.join(registry.commonDir, 'task-environments', target.id)),
          'Existing data or preparation must be preserved; use a new carrier',
        );
        const references = await (dependencies.references ?? taskRuntimeReferences)(target);
        assert.equal(references.owned.length, 0, 'Existing frontend must be preserved; use a new carrier');
        assert.equal(references.backendPorts.length, 0, 'Existing backend must be preserved; use a new carrier');
        assert.equal(target.owner, owner, 'Exact combination carrier owner required');
        assert.equal(target.kind, 'infrastructure', 'Combination requires a dedicated infrastructure carrier');
        assertPreviewMember(target);
        assert.ok(!plan.members.some((member) => member.id === target.id), 'A member cannot be its own carrier');
        assert.equal(git(target.worktree, ['status', '--porcelain']), '', 'Carrier source must be pristine');
        assert.equal(
          git(target.worktree, ['rev-parse', 'HEAD']),
          plan.base,
          'Carrier must start at the exact planned main',
        );
        assert.equal(target.startHead, plan.base, 'Reused task cannot become a preview carrier');
        assert.equal(target.checkpoints.length, 0, 'Carrier has existing work');
        assert.equal(plan.previewOnly, true);
        assert.equal(git(root, ['rev-parse', plan.combined + '^{tree}']), plan.tree, 'Combination tree differs');
        verifyPreviewMembers(root, plan);
        const marked = registry.revise(target.id, target.revision, (record) => {
          record.previewOnly = plan;
          record.resources.dataScope = 'isolated-task';
        });
        await dependencies.beforeMaterialize?.(marked);
        // read-tree touches only the newly created carrier; no merge/reset on source tasks.
        git(target.worktree, ['read-tree', '-m', '-u', plan.base, plan.tree]);
        assertCombinationRuntime(root, marked);
        return {
          task: marked.id,
          worktree: marked.worktree,
          previewOnly: true,
          members: plan.members,
          dataScope: 'isolated-task',
          runtimeStarted: false,
        };
      }),
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...ids] = process.argv.slice(2);
    assert.ok(['plan', 'apply'].includes(command), 'combination plan <members...> | apply <new-carrier> <members...>');
    const target = command === 'apply' ? ids.shift() : null;
    const plan = planPreviewCombination(process.cwd(), ids);
    const result = target
      ? await applyPreviewCombination(process.cwd(), target, plan, process.env.CODEX_THREAD_ID)
      : plan;
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
