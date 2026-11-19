import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryStatus } from './completion-status.mjs';
import { runCompletionProcess } from './completion-process.mjs';
import { acquireCleanupLock } from './task-cleanup-lock.mjs';
import { safePath } from './task-cleanup-queue.mjs';
import { registeredTaskWorktrees } from './task-registry.mjs';

const source = createHash('sha256')
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest('hex');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const shaPattern = /^[a-f0-9]{40}$/;
const recordNames = new Set([
  'accepted-source.json',
  'completion-session.json',
  'completion-receipt.json',
  'completion-status.json',
  'composition.json',
  'delivery-observations.json',
]);

const inside = (child, parent) => child.startsWith(parent + path.sep);
const overlaps = (a, b) => a === b || inside(a, b) || inside(b, a);

function run(command, args, options = {}) {
  const result = runCompletionProcess(command, args, {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 128 * 1024 ** 2,
    ...options,
  });
  assert.ok(!result.error && result.status === 0, result.stderr?.trim() || command + ' failed');
  return result.stdout;
}

const git = (root, ...args) =>
  run('git', [
    '--no-replace-objects',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.hooksPath=/dev/null',
    '-C',
    root,
    ...args,
  ]);
const paths = (text) => text.split('\0').filter(Boolean);
const tree = (action, request, deadline) =>
  JSON.parse(
    run('python3', ['-IB', fileURLToPath(new URL('./task-cleanup-tree.py', import.meta.url))], {
      input: JSON.stringify({ action, ...request }),
      timeout: Math.max(1, deadline - Date.now()),
    }),
  );

function read(file) {
  safePath(file);
  if (!existsSync(file)) return null;
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 128 * 1024 ** 2, 'Unsafe ownership record');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function save(file, value) {
  safePath(file);
  const temporary = file + '.' + randomUUID();
  writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600, flush: true });
  renameSync(temporary, file);
}

function deliveredTasks(registry) {
  const current = registry.list();
  const tasks = new Map(current.map((task) => [task.id, task]));
  const archives = path.join(registry.commonDir, 'task-batches/archive');
  safePath(archives);
  if (existsSync(archives))
    for (const name of readdirSync(archives)) {
      const id = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !idPattern.test(id) || tasks.has(id)) continue;
      const record = read(path.join(archives, name));
      if (record.id === id && record.closedAt && record.repository?.commonDir === registry.commonDir)
        tasks.set(id, { ...record, stage: 'closed' });
    }
  return [...tasks.values()];
}

function assertClosed(root, task, delivery) {
  assert.equal(task.stage, 'closed');
  assert.ok(task.closedAt && shaPattern.test(task.recordedHead) && shaPattern.test(task.main?.local));
  assert.equal(task.main.local, task.main.remote);
  assert.ok(
    task.branch.startsWith('codex/') && !['codex/integration-current', 'codex/preview-current'].includes(task.branch),
  );
  assert.equal(git(root, 'check-ref-format', 'refs/heads/' + task.branch), '');
  assert.ok(delivery.formalDeliveryComplete && delivery.main === task.main.local, 'Formal delivery proof unavailable');
  git(root, 'merge-base', '--is-ancestor', task.recordedHead, task.main.local);
  const actualMain = git(root, 'ls-remote', '--exit-code', 'origin', 'refs/heads/main').trim().split('\t');
  assert.equal(actualMain[1], 'refs/heads/main');
  assert.match(actualMain[0], shaPattern);
  // A newer, unavailable remote object is a reason to wait for main synchronization.
  git(root, 'merge-base', '--is-ancestor', task.main.local, actualMain[0]);
}

function candidates(root, common, task, all) {
  const active = all.filter((item) => item.id !== task.id && item.stage !== 'closed');
  assert.ok(!active.some((item) => item.branch === task.branch), 'Another task registered the original branch');
  const liveWorktrees = registeredTaskWorktrees(root);
  const directory = path.join(common, 'task-delivery', task.id);
  const assets = path.join(common, 'task-assets', task.id);
  const createdSources = path.join(common, 'task-cleanup/created-sources', task.id);
  const data = path.join(common, 'task-environments', task.id);
  const targets = [
    { kind: 'evidence', path: directory },
    { kind: 'assets', path: assets },
    { kind: 'assets', path: createdSources },
  ];
  safePath(task.worktree);
  const registered = liveWorktrees.filter((item) => item.worktree === task.worktree);
  assert.ok(registered.length <= 1);
  if (registered.length || existsSync(task.worktree)) {
    const allowedWorktrees = path.resolve(path.dirname(root), path.basename(root) + '-worktrees');
    assert.ok(inside(task.worktree, allowedWorktrees), 'Worktree outside project task directory');
    assert.equal(registered[0]?.branch, task.branch, 'Original Git worktree was replaced or is unregistered');
    targets.push({ kind: 'worktree', path: task.worktree });
  }
  const pending = [];
  if (existsSync(data))
    pending.push({ path: data, reason: 'Task data registration retains preview, media or backup assets' });
  for (const target of targets) {
    safePath(target.path);
    for (const item of active) assert.ok(!overlaps(target.path, item.worktree), 'Another task owns the cleanup path');
    for (const item of liveWorktrees)
      if (item.worktree !== root && item.worktree !== task.worktree)
        assert.ok(!overlaps(target.path, item.worktree), 'Git worktree references the cleanup path');
  }
  return { targets, pending };
}

function worktreeFiles(task) {
  const cwd = task.worktree;
  assert.equal(git(cwd, 'rev-parse', 'HEAD').trim(), task.recordedHead, 'Worktree HEAD changed');
  assert.equal(
    git(cwd, 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'),
    '',
    'Worktree has new content',
  );
  assert.ok(
    !paths(git(cwd, 'ls-files', '-v', '-z')).some((entry) => /^[a-zS] /.test(entry)),
    'Worktree has hidden index changes',
  );
  const tracked = paths(git(cwd, 'ls-files', '-z', '--stage'));
  assert.ok(!tracked.some((entry) => entry.startsWith('160000 ')), 'Task worktree has a protected submodule');
  return paths(
    git(cwd, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory'),
  ).map((file) => file.replace(/\/$/, ''));
}

function content(target, task) {
  if (target.kind === 'worktree') return worktreeFiles(task);
  if (target.kind === 'evidence')
    return readdirSync(target.path).filter(
      (name) => !recordNames.has(name) && !name.startsWith('completion-status-before-restoration-'),
    );
  return null;
}

function branchState(root, task, { alreadyRemoved = false } = {}) {
  const ref = 'refs/heads/' + task.branch;
  const tracking = 'refs/remotes/origin/' + task.branch;
  const local = git(root, 'for-each-ref', '--format=%(objectname)', ref).trim();
  const saved = git(root, 'for-each-ref', '--format=%(objectname)', tracking).trim();
  const remoteLine = git(root, 'ls-remote', 'origin', ref).trim();
  const remote = remoteLine ? remoteLine.split('\t')[0] : '';
  if (remoteLine) assert.equal(remoteLine.split('\t')[1], ref);
  for (const [name, sha] of [
    [ref, local],
    [ref, remote],
    [tracking, saved],
  ])
    assert.ok(!sha || sha === task.recordedHead, 'Task branch advanced or was reused: ' + name);
  for (const [name, sha] of [
    [ref, local],
    [tracking, saved],
  ]) {
    if (!sha) continue;
    const lastUpdate = git(root, 'reflog', 'show', '-1', '--date=unix', '--format=%gD', name).match(/@\{(\d+)\}/)?.[1];
    assert.ok(
      lastUpdate && Number(lastUpdate) * 1000 <= Date.parse(task.closedAt),
      'Task branch update is newer than closure',
    );
  }
  assert.ok(!alreadyRemoved || (!local && !remote && !saved), 'A previously removed task branch was recreated');
  return { ref, tracking, local, remote };
}

function purgeBranches(root, task, branchProof) {
  assert.ok(
    !registeredTaskWorktrees(root).some((worktree) => worktree.branch === task.branch),
    'Branch is checked out',
  );
  const { ref, tracking, local, remote } = branchState(root, task, branchProof);
  if (remote) git(root, 'push', '--force-with-lease=' + ref + ':' + task.recordedHead, 'origin', ':' + ref);
  if (local) git(root, 'update-ref', '-d', ref, task.recordedHead);
  const remainingTracking = git(root, 'for-each-ref', '--format=%(objectname)', tracking).trim();
  if (remainingTracking) git(root, 'update-ref', '-d', tracking, task.recordedHead);
  assert.equal(git(root, 'ls-remote', 'origin', ref), '', 'Remote task branch still exists');
  assert.equal(git(root, 'for-each-ref', '--format=%(refname)', ref, tracking), '', 'Local task branch still exists');
}

function verifyNestedRepository(root, directory, task, check) {
  safePath(directory);
  check(directory);
  const common = git(directory, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim();
  assert.equal(common, path.join(directory, '.git'), 'Nested checkout shares a Git object store');
  safePath(common);
  assert.ok(!existsSync(path.join(common, 'objects/info/alternates')), 'Nested checkout borrows Git objects');
  assert.deepEqual(
    registeredTaskWorktrees(directory).map((item) => item.worktree),
    [directory],
  );
  assert.equal(
    git(directory, 'remote', '-v').split('\n').filter(Boolean).length,
    2,
    'Nested checkout has additional remotes',
  );
  assert.equal(
    git(directory, 'remote', 'get-url', 'origin'),
    git(root, 'remote', 'get-url', 'origin'),
    'Nested checkout source differs',
  );
  assert.equal(
    git(directory, 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'),
    '',
    'Nested checkout has new content',
  );
  assert.ok(
    !paths(git(directory, 'ls-files', '-v', '-z')).some((entry) => /^[a-zS] /.test(entry)),
    'Nested checkout has hidden index changes',
  );
  assert.ok(
    !paths(git(directory, 'ls-files', '--stage', '-z')).some((entry) => entry.startsWith('160000 ')),
    'Nested checkout contains a submodule',
  );
  assert.ok(
    !git(directory, 'fsck', '--full', '--unreachable', '--no-reflogs', '--no-progress').includes('unreachable commit '),
    'Nested checkout contains independent commits',
  );
  const refs = git(directory, 'for-each-ref', '--format=%(objectname)').trim().split('\n').filter(Boolean);
  const head = git(directory, 'rev-parse', 'HEAD').trim();
  for (const sha of new Set([head, ...refs])) git(root, 'merge-base', '--is-ancestor', sha, task.main.local);
}

function worktreeBytes(task) {
  let bytes = 0;
  for (const filename of paths(git(task.worktree, 'ls-files', '-z'))) {
    const file = path.join(task.worktree, filename);
    // Parent links and shared/special files require independent review before Git removes the tree.
    safePath(path.dirname(file));
    const stat = lstatSync(file);
    assert.ok(
      stat.isSymbolicLink() || (stat.isFile() && stat.nlink === 1),
      'Tracked worktree member is shared or special',
    );
    bytes += stat.size;
  }
  return bytes;
}

function removeTarget(root, target, task, state, persist, check, budget, deadline) {
  const file = target.path;
  if (!existsSync(file)) {
    assert.ok(
      target.kind !== 'worktree' || !registeredTaskWorktrees(root).some((item) => item.worktree === file),
      'A worktree registration remains',
    );
    return { state: 'absent', bytes: 0 };
  }
  check(file);
  const selected = content(target, task);
  let record = state.files[file];
  if (!record) {
    let inventory = tree('inventory', { path: file, roots: selected }, deadline);
    const repositories = [];
    const rejected = [];
    for (const relative of inventory.repositories) {
      try {
        verifyNestedRepository(root, path.join(file, relative), task, check);
        repositories.push(relative);
      } catch (error) {
        rejected.push({ path: relative, reason: error.message });
      }
    }
    if (repositories.length) inventory = tree('inventory', { path: file, roots: selected, repositories }, deadline);
    record = { ...inventory, cursor: 0, remainingDirectories: [], rejected };
    state.files[file] = record;
    persist();
  }
  const next = record.entries.slice(record.cursor, record.cursor + 1000);
  const result = tree('subtract', { path: file, root: record.root, entries: next, bytes: budget, deadline }, deadline);
  record.cursor += result.consumed;
  record.remainingDirectories.push(...result.remainingDirectories);
  persist();
  let bytes = result.deletedLogicalBytes;
  if (record.cursor < record.entries.length) {
    if (record.entries[record.cursor].bytes > budget && result.consumed === 0)
      return { state: 'budget', reason: 'Next file is larger than the available logical byte budget', bytes };
    return { state: 'partial', bytes };
  }
  const remaining = content(target, task);
  const visible = remaining ?? readdirSync(file);
  if (visible.length)
    return {
      state: 'pending',
      reason: 'Protected, changed or newly observed content remains',
      bytes,
      remaining: visible.slice(0, 20),
      rejected: record.rejected,
    };
  check(file);
  if (target.kind === 'worktree') {
    const size = worktreeBytes(task);
    if (size > budget - bytes) return { state: 'budget', bytes };
    git(root, 'worktree', 'remove', file);
    assert.ok(!existsSync(file), 'Worktree remains after Git removal');
    bytes += size;
  } else if (target.kind === 'assets') {
    assert.equal(readdirSync(file).length, 0);
    // A newly created member can cause only a nonempty-directory refusal.
    tree('remove-empty-root', { path: file, root: record.root }, deadline);
    assert.ok(!existsSync(file), 'Task asset root remains');
  }
  delete state.files[file];
  persist();
  return { state: 'cleaned', bytes };
}

export async function runOwnershipCleanup(
  root,
  {
    registry,
    policy,
    unreferenced,
    readDelivery = deliveryStatus,
    verifyRuntimeResources = async () => [],
    apply = false,
  },
) {
  const common = registry.commonDir;
  const base = path.join(common, 'task-cleanup');
  const journal = path.join(base, 'ownership-v2');
  safePath(journal);
  const all = deliveredTasks(registry);
  const closed = all.filter((task) => task.stage === 'closed');
  if (!apply) return { closedTasks: closed.map((task) => task.id), processed: [], remaining: closed.length };
  mkdirSync(journal, { recursive: true, mode: 0o700 });
  assert.equal(lstatSync(journal).mode & 0o077, 0);
  const deadline = Date.now() + policy.budgetMs;
  const lease = acquireCleanupLock(base, 'run.lock', { source });
  let budget = policy.maxLogicalBytes,
    slots = policy.limit,
    deletedLogicalBytes = 0;
  let interruptedBytesUnknown = false;
  const processed = [];
  try {
    return await lease.scope(async () => {
      // Start with the least recently checked, so an unresolved task cannot monopolize later runs.
      const pending = closed
        .map((task) => {
          const file = path.join(journal, task.id + '.json');
          return { task, file, previous: read(file) };
        })
        .sort((a, b) => (a.previous?.checkedAt ?? 0) - (b.previous?.checkedAt ?? 0));
      for (const { task, file, previous } of pending) {
        if (Date.now() >= deadline || slots <= 0 || budget <= 0) break;
        const key = task.id;
        const state = previous ?? { version: 2, key, head: task.recordedHead, files: {} };
        assert.equal(state.version, 2);
        assert.equal(state.key, key);
        assert.equal(state.head, task.recordedHead, 'Cleanup delivery identity changed');
        // A cleaned history is terminal until another task/delivery claims its own new identity.
        if (state.outcome === 'cleaned') continue;
        const persist = () => save(file, state);
        const check = (target) => unreferenced({ path: target, task: task.id });
        state.checkedAt = Date.now();
        state.pending = [];
        state.outcome = 'partial';
        try {
          const delivery = readDelivery(path.join(common, 'task-delivery', key), key, task);
          if (!delivery.formalDeliveryComplete) {
            state.pending = [{ reason: 'Formal delivery proof unavailable' }];
          } else {
            assertClosed(root, task, delivery);
            const receipt = read(path.join(common, 'task-delivery', key, 'completion-receipt.json'));
            const branchProof = { alreadyRemoved: receipt?.results?.cleanup?.result?.branchRemoved === true };
            branchState(root, task, branchProof);
            const inventory = candidates(root, common, task, all);
            if (inventory.targets.some((target) => target.kind === 'worktree')) worktreeFiles(task);
            slots -= 1;
            state.pending.push(...inventory.pending);
            state.pending.push(...(await verifyRuntimeResources(task, { deadline, apply: true })));
            for (const target of inventory.targets) {
              if (slots <= 0 || budget <= 0 || Date.now() >= deadline) {
                state.pending.push({ path: target.path, reason: 'Next scheduled budget' });
                continue;
              }
              if (!existsSync(target.path)) continue;
              try {
                const result = removeTarget(root, target, task, state, persist, check, budget, deadline);
                budget -= result.bytes;
                deletedLogicalBytes += result.bytes;
                slots -= 1;
                if (!['cleaned', 'absent'].includes(result.state)) state.pending.push({ path: target.path, ...result });
              } catch (error) {
                slots -= 1;
                // A terminated helper may have used its full allowance before returning.
                budget = 0;
                interruptedBytesUnknown = true;
                state.pending.push({ path: target.path, reason: error.message });
              }
            }
            if (!state.pending.length) {
              assert.ok(!existsSync(task.worktree), 'Task worktree remains');
              purgeBranches(root, task, branchProof);
              state.outcome = 'cleaned';
            }
          }
        } catch (error) {
          state.pending.push({ reason: error.message });
        }
        if (state.pending.length && !state.firstFailure)
          state.firstFailure = { checkedAt: state.checkedAt, pending: state.pending };
        persist();
        processed.push({ key, state: state.outcome === 'cleaned' ? 'cleaned' : 'blocked', pending: state.pending });
      }
      return {
        processed,
        deletedLogicalBytes,
        interruptedBytesUnknown,
        physicalBytes: null,
        remaining: closed.filter((task) => read(path.join(journal, task.id + '.json'))?.outcome !== 'cleaned').length,
      };
    });
  } finally {
    lease.release();
  }
}
