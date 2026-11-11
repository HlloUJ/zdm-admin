import { prepareTaskArtifacts } from './task-artifacts.mjs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';
import { bindBatchTiming } from './batch-timing-store.mjs';
import { createResourceLeases } from './resource-lease.mjs';
const runGit = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const safe = (file) => {
  if (existsSync(file)) assert.ok(!lstatSync(file).isSymbolicLink(), 'Linked task path is unsafe');
};
const hasRef = (root, ref) => {
  const r = spawnSync('git', ['-C', root, 'show-ref', '--verify', '--quiet', ref]);
  assert.ok(r.status === 0 || r.status === 1, 'Cannot establish branch ownership');
  return r.status === 0;
};
export function parseTaskStart(args) {
  const options = {
    slug: null,
    kind: 'business',
    owner: null,
    resume: false,
    previewOnly: false,
    taskParent: null,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (['--help', '-h'].includes(value)) {
      options.help = true;
      continue;
    }
    if (value === '--resume') {
      assert.ok(!options.resume, 'Duplicate resume flag');
      options.resume = true;
      continue;
    }
    if (value === '--preview-only') {
      assert.ok(!options.previewOnly, 'Duplicate preview-only flag');
      options.previewOnly = true;
      continue;
    }
    const key = { '--slug': 'slug', '--kind': 'kind', '--owner': 'owner', '--task-parent': 'taskParent' }[value];
    assert.ok(key && args[i + 1] && !args[i + 1].startsWith('--'), 'Unknown task option or missing value: ' + value);
    options[key] = args[++i];
  }
  if (options.slug) {
    assert.match(options.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(options.slug.length <= 64, 'Task id too long');
  }
  assert.ok(['business', 'infrastructure', 'maintenance'].includes(options.kind), 'Unknown task kind');
  return options;
}
export function startParallelTask(
  options,
  {
    root = process.cwd(),
    registry = createTaskRegistry(root),
    git = runGit,
    prepare = prepareTaskArtifacts,
    bindTiming = bindBatchTiming,
  } = {},
) {
  root = realpathSync(root);
  const owner = options.owner || process.env.CODEX_THREAD_ID;
  function ready(result) {
    result.artifacts = prepare(result.task);
    try {
      const mains = registeredTaskWorktrees(root).filter((entry) => entry.branch === 'main');
      assert.equal(mains.length, 1);
      result.timing = bindTiming(
        result.task.worktree,
        { ...result.task, repository: { ...result.task.repository, anchor: realpathSync(mains[0].worktree) } },
        { resume: result.resumed },
      );
    } catch (error) {
      result.timing = { status: 'unavailable', reason: error.message };
    }
    return result;
  }
  assert.ok(
    typeof owner === 'string' && owner.trim(),
    'Explicit task owner required when execution identity is unavailable',
  );
  if (!options.slug) {
    const task = registry.resolve({ worktree: root });
    assert.equal(task.owner, owner, 'Another owner controls this task');
    assert.equal(Boolean(task.previewOnly), Boolean(options.previewOnly), 'Use the exact preview-only task purpose');
    return ready({ task, resumed: true, previewSwitched: false, remoteFetched: false });
  }
  const existing = registry.readTask(options.slug);
  if (existing) {
    assert.equal(existing.owner, owner, 'Another owner controls this task');
    assert.equal(existing.kind, options.kind, 'Task kind differs');
    assert.equal(
      Boolean(existing.previewOnly),
      Boolean(options.previewOnly),
      'Use the exact preview-only task purpose',
    );
    const task = registry.resolve({ id: options.slug });
    return ready({ task, resumed: true, previewSwitched: false, remoteFetched: false });
  }
  assert.ok(!options.resume, 'Task is not registered; do not adopt an unknown branch or worktree');
  const entries = registeredTaskWorktrees(root),
    mains = entries.filter((x) => x.branch === 'main');
  assert.equal(mains.length, 1, 'Exact main anchor required');
  const anchor = realpathSync(mains[0].worktree),
    integration = entries.find((x) => x.branch === 'codex/integration-current');
  const parent = options.taskParent || (integration ? path.dirname(integration.worktree) : null);
  assert.ok(
    parent && path.isAbsolute(parent),
    'Persistent task parent required; do not fall back to temporary storage',
  );
  safe(parent);
  assert.ok(existsSync(parent) && lstatSync(parent).isDirectory(), 'Persistent task parent must exist');
  const canonicalParent = realpathSync(parent);
  for (const temporary of [tmpdir(), '/tmp', '/private/tmp'].filter(existsSync).map((file) => realpathSync(file)))
    assert.ok(
      canonicalParent !== temporary && !canonicalParent.startsWith(temporary + path.sep),
      'Task worktrees must not use operating-system temporary storage',
    );
  const taskParent = canonicalParent,
    target = path.join(taskParent, options.slug),
    branch = 'codex/' + options.slug;
  assert.ok(!existsSync(target), 'Target directory already exists; preserve its contents');
  assert.ok(!hasRef(root, 'refs/heads/' + branch), 'Local branch already exists; preserve its contents');
  const old = registry.legacy();
  assert.ok(
    !old || (old.id !== options.slug && old.worktree !== target && old.branch !== branch),
    'Legacy task requires explicit preserved migration',
  );
  assert.equal(git(anchor, 'status', '--porcelain'), '', 'Main anchor is dirty; do not alter it');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply'])
    assert.ok(
      !existsSync(path.resolve(anchor, git(anchor, 'rev-parse', '--git-path', marker))),
      'Main has an unfinished Git operation',
    );
  safe(registry.directory);
  mkdirSync(registry.directory, { recursive: true, mode: 0o700 });
  const leases = createResourceLeases(registry.commonDir),
    mainLease = leases.acquire('main-sync', owner);
  // The lock is deliberately retained on an uncertain interrupted operation; normal paths release it below.
  let intent, result;
  try {
    git(anchor, 'fetch', 'origin', '--prune');
    assert.ok(!hasRef(root, 'refs/remotes/origin/' + branch), 'Remote task branch already exists');
    git(anchor, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main');
    git(anchor, 'merge', '--ff-only', 'origin/main');
    const base = git(anchor, 'rev-parse', 'origin/main');
    const directory = path.join(registry.directory, 'start-intents');
    safe(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    intent = path.join(directory, options.slug + '.json');
    safe(intent);
    const record = {
      task: options.slug,
      owner,
      branch,
      worktree: target,
      base,
      state: 'prepared',
      previewSwitched: false,
      previewOnly: Boolean(options.previewOnly),
    };
    writeFileSync(intent, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    git(anchor, 'worktree', 'add', '-b', branch, target, base);
    record.state = 'worktree-created';
    writeFileSync(intent, JSON.stringify(record, null, 2) + '\n');
    const task = registry.register({
      id: options.slug,
      worktree: target,
      owner,
      kind: options.kind,
      previewOnly: Boolean(options.previewOnly),
    });
    record.state = 'registered';
    writeFileSync(intent, JSON.stringify(record, null, 2) + '\n');
    result = { task, resumed: false, previewSwitched: false, remoteFetched: true, remoteMain: base };
  } finally {
    leases.release(mainLease);
  }
  return ready(result);
}
export function main(args = process.argv.slice(2)) {
  const options = parseTaskStart(args);
  if (options.help) {
    console.log(
      'Usage: task:start -- --slug <task-id> --owner <owner> [--kind business|infrastructure|maintenance] [--resume] [--preview-only] [--task-parent <persistent-directory>]\nEach task uses its own branch and worktree. Startup never switches 5175 or starts shared services. Preview-only purpose is immutable and forbids formal delivery.',
    );
    return;
  }
  console.log(JSON.stringify(startParallelTask(options), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
