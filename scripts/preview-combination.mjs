import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { startParallelTask } from './task-start.mjs';
import { main as launchPreview } from './dev-task.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { withIntegrationResource } from './integration-resource.mjs';
import {
  combinationGit as git,
  combinationDigest,
  combinationDirectory,
  readPreviewCombination,
  assertCombinationPreview,
} from './preview-combination-state.mjs';

export function parseCombination(args) {
  const [command, id, ...rest] = args;
  assert.ok(
    ['plan', 'create', 'status', 'run', 'stop'].includes(command),
    'combination <plan|create|status|run|stop> <id> [--member <task@full-sha>]',
  );
  assert.match(id ?? '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(id.length <= 64);
  const members = [];
  for (let i = 0; i < rest.length; i += 2) {
    assert.ok(['plan', 'create'].includes(command) && rest[i] === '--member', 'Unexpected combination argument');
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)@([a-f0-9]{40})$/.exec(rest[i + 1] ?? '');
    assert.ok(match, 'Each member needs an exact task id and full commit');
    members.push({ task: match[1], commit: match[2] });
  }
  if (['plan', 'create'].includes(command))
    assert.ok(
      members.length >= 2 && new Set(members.map((m) => m.task)).size === members.length,
      'At least two distinct exact task versions are required',
    );
  return { command, id, members };
}
export function planPreviewCombination(root, { id, members }, registry = createTaskRegistry(root)) {
  const existing = registry.readTask(id);
  if (existing) {
    assert.equal(existing.previewOnly, true, 'Existing business/development task cannot become a combination');
  }
  const fields = {
    previewOnly: true,
    eligibleForTaskDelivery: false,
    previewSwitched: false,
    dataPrepared: false,
    dataAction:
      'Explicit task:data isolate is required before full preview; no data preparation is performed by create.',
    existing: Boolean(existing),
  };
  if (existing) {
    const complete = readPreviewCombination(root, existing, { required: false });
    const intentFile = path.join(combinationDirectory(registry.commonDir, id), 'preparing.json');
    let original = complete;
    if (!original && existsSync(intentFile)) {
      assert.ok(
        lstatSync(intentFile).isFile() && !lstatSync(intentFile).isSymbolicLink(),
        'Unsafe source preparation intent',
      );
      original = JSON.parse(readFileSync(intentFile));
      assert.equal(original.task, existing.id);
      assert.equal(original.owner, existing.owner);
      assert.equal(original.base, existing.base);
    }
    if (original) {
      assert.deepEqual(
        members,
        original.members.map((m) => ({ task: m.task, commit: m.commit })),
        'Preserve the original combination recipe; use another id for new versions',
      );
      return { task: id, members: original.members, ...fields, recovery: true };
    }
  }
  const selected = members.map((member) => {
    assert.notEqual(member.task, id, 'A combination cannot contain itself');
    const task = registry.resolve({ id: member.task });
    assert.ok(
      !task.previewOnly && !task.recovery?.runtimeBlocked,
      'Unproved recovery or another preview combination cannot supply a member',
    );
    assert.equal(
      git(task.worktree, 'rev-parse', 'HEAD'),
      member.commit,
      'Member HEAD differs; specify its exact current version',
    );
    assert.equal(
      git(task.worktree, 'status', '--porcelain'),
      '',
      'Member has uncommitted source; preserve it and save an explicit version in its own task first',
    );
    return {
      task: task.id,
      commit: member.commit,
      branch: task.branch,
      worktree: task.worktree,
      tree: git(task.worktree, 'rev-parse', member.commit + '^{tree}'),
    };
  });
  return { task: id, members: selected, ...fields };
}
export function createPreviewCombination(
  root,
  options,
  { owner = process.env.CODEX_THREAD_ID, start = startParallelTask } = {},
) {
  assert.ok(owner, 'Exact current chat owner required');
  const registry = createTaskRegistry(root),
    leases = createResourceLeases(registry.commonDir);
  const existing = registry.readTask(options.id);
  if (existing) {
    assert.equal(existing.previewOnly, true, 'Existing development task cannot become a combination');
    assert.equal(existing.owner, owner, 'Another owner controls the combination');
  }
  const lease = leases.acquire('task-delivery-' + options.id, owner);
  try {
    return createPreviewCombinationLocked(root, options, { owner, start });
  } finally {
    leases.release(lease);
  }
}
function createPreviewCombinationLocked(root, options, { owner, start }) {
  const registry = createTaskRegistry(root),
    plan = planPreviewCombination(root, options, registry);
  const old = registry.readTask(options.id);
  if (old) {
    assert.equal(old.owner, owner, 'Another owner controls the combination');
    const complete = readPreviewCombination(root, old, { required: false });
    if (complete) {
      assert.deepEqual(complete.members, plan.members, 'Existing combination versions are immutable');
      return { task: old, manifest: complete, reused: true };
    }
  }
  const result = start(
    { slug: options.id, kind: 'infrastructure', owner, previewOnly: true, taskParent: options.taskParent },
    { root },
  );
  let task = registry.resolve({ id: options.id });
  assert.equal(task.previewOnly, true);
  assert.equal(task.owner, owner);
  assert.equal(
    git(task.worktree, 'status', '--porcelain'),
    '',
    'Incomplete combination has changes or conflicts; preserve its recovery state',
  );
  const directory = combinationDirectory(registry.commonDir, task.id),
    intentFile = path.join(directory, 'preparing.json');
  const intent = { version: 1, task: task.id, owner, base: task.base, members: plan.members };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(intentFile)) {
    assert.ok(
      lstatSync(intentFile).isFile() && !lstatSync(intentFile).isSymbolicLink(),
      'Unsafe source preparation intent',
    );
    assert.deepEqual(
      JSON.parse(readFileSync(intentFile)),
      intent,
      'Preserve the original combination recipe; use another id for new versions',
    );
  } else {
    assert.equal(
      git(task.worktree, 'rev-parse', 'HEAD'),
      task.base,
      'Unknown existing combination source; preserve it',
    );
    writeFileSync(intentFile, JSON.stringify(intent, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  }
  // Admit an interrupted exact merge sequence only. An arbitrary clean commit
  // cannot be silently added to a manifest of different source members.
  const previous = git(task.worktree, 'rev-list', '--first-parent', '--reverse', task.base + '..HEAD')
    .split('\n')
    .filter(Boolean);
  const members = new Set(plan.members.map((member) => member.commit));
  for (const commit of previous) {
    const parents = git(task.worktree, 'show', '-s', '--format=%P', commit).split(' ');
    assert.ok(
      parents.length === 2 && members.has(parents[1]),
      'Unknown source commit in incomplete combination; preserve it',
    );
    const expectedTree = git(task.worktree, 'merge-tree', '--write-tree', ...parents).split('\n')[0];
    assert.equal(
      git(task.worktree, 'rev-parse', commit + '^{tree}'),
      expectedTree,
      'Recovered combination merge was changed',
    );
  }
  try {
    for (const member of plan.members) {
      assert.equal(git(task.worktree, 'cat-file', '-t', member.commit), 'commit');
      assert.equal(
        git(task.worktree, 'rev-parse', member.commit + '^{tree}'),
        member.tree,
        'Original member tree changed',
      );
      // Normal owned-carrier merges retain hooks and leave conflicts intact.
      // No commit, branch or file is written in either member task.
      const before = git(task.worktree, 'rev-parse', 'HEAD');
      git(task.worktree, '-c', 'rerere.enabled=false', 'merge', '--no-ff', '--no-edit', member.commit);
      const after = git(task.worktree, 'rev-parse', 'HEAD');
      if (after !== before) {
        assert.deepEqual(
          git(task.worktree, 'show', '-s', '--format=%P', after).split(' '),
          [before, member.commit],
          'Exact member merge required',
        );
        const expected = git(task.worktree, 'merge-tree', '--write-tree', before, member.commit).split('\n')[0];
        assert.equal(
          git(task.worktree, 'rev-parse', 'HEAD^{tree}'),
          expected,
          'A merge hook changed combination source; retain it for review',
        );
      }
    }
    const manifest = {
      version: 1,
      task: task.id,
      owner,
      worktree: task.worktree,
      branch: task.branch,
      base: task.base,
      members: plan.members,
      head: git(task.worktree, 'rev-parse', 'HEAD'),
      tree: git(task.worktree, 'rev-parse', 'HEAD^{tree}'),
      eligibleForTaskDelivery: false,
      createdAt: new Date().toISOString(),
    };
    const bytes = JSON.stringify(manifest, null, 2) + '\n',
      sha256 = combinationDigest(bytes),
      dir = combinationDirectory(registry.commonDir, task.id),
      file = path.join(dir, 'combination-' + sha256 + '.json');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (existsSync(file)) assert.equal(readFileSync(file, 'utf8'), bytes);
    else writeFileSync(file, bytes, { flag: 'wx', mode: 0o400 });
    task = registry.revise(task.id, task.revision, (record) => {
      record.stage = 'developing';
      record.recordedHead = manifest.head;
      record.resources.previewCombination = { file, sha256 };
      if (record.combinationFailures?.length) record.combinationRecoveredAt = new Date().toISOString();
    });
    return {
      task,
      manifest: readPreviewCombination(root, task),
      previewSwitched: false,
      dataPrepared: false,
      reused: false,
      artifacts: result.artifacts,
    };
  } catch (error) {
    const current = registry.readTask(task.id);
    registry.revise(current.id, current.revision, (record) => {
      record.stage = 'blocked';
      record.combinationFailure = {
        reason: error.message,
        recordedAt: new Date().toISOString(),
        members: plan.members,
      };
      record.combinationFailures ??= [];
      record.combinationFailures.push(record.combinationFailure);
    });
    throw error;
  }
}
export async function combinationCommand(root, args, dependencies = {}) {
  const options = parseCombination(args),
    owner = dependencies.owner ?? process.env.CODEX_THREAD_ID;
  if (options.command === 'plan') return planPreviewCombination(root, options);
  if (options.command === 'create') return createPreviewCombination(root, options, { ...dependencies, owner });
  const task = createTaskRegistry(root).resolve({ id: options.id });
  assert.equal(task.previewOnly, true, 'This task is not a preview-only combination');
  if (options.command === 'stop') {
    assert.equal(task.owner, owner, 'Current chat must own the exact combination');
    return withIntegrationResource(root, task.id, async () => {
      const references = await (dependencies.references ?? taskRuntimeReferences)(task);
      const ports = references.owned.map((front) => front.port);
      assert.ok(
        ports.every((port) => Number.isInteger(port) && port >= 5177 && port <= 5199),
        'A combination cannot own a fixed preview port',
      );
      for (const port of ports.length ? ports : [5177])
        await (dependencies.launch ?? launchPreview)(['--worktree', task.worktree, '--stop', '--port', String(port)]);
      return { task: task.id, stopped: true, sourceAndDataRetained: true };
    });
  }
  const manifest = readPreviewCombination(root, task, { required: options.command === 'run' });
  if (options.command === 'status')
    return {
      task: task.id,
      worktree: task.worktree,
      branch: task.branch,
      manifest,
      prepared: Boolean(manifest),
      eligibleForTaskDelivery: false,
    };
  assert.equal(task.owner, owner, 'Current chat must own the exact combination');
  assertCombinationPreview(root, task, { temporary: true });
  // The existing launcher proves private data, actual backend bindings and API
  // health; it never creates data or takes over the fixed preview for this run.
  return (dependencies.launch ?? launchPreview)(['--worktree', task.worktree, '--temporary', '--mode', 'full']);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help'))
    console.log(
      'combination plan|create <id> --member <task@full-sha> --member <task@full-sha>\ncombination status|run|stop <id>\nCreate uses a separate permanent preview-only worktree and private dependencies; clean exact member commits are required. Source conflicts retain that carrier and do not modify members. No data is initialized. Use the published data isolate command explicitly, then run on a temporary port. Stop retains code, data, media, volumes and backups. Never formally deliver or directly edit a preview-only carrier.',
    );
  else
    combinationCommand(process.cwd(), args)
      .then((result) => {
        if (result !== undefined) console.log(JSON.stringify(result, null, 2));
      })
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
}
