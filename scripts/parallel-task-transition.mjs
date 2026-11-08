import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync, mkdirSync, realpathSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';
import { captureSource } from './verification-evidence.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
function regular(file) {
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Unsafe transition input');
  return readFileSync(file);
}
function safeDirectory(directory) {
  if (existsSync(directory))
    assert.ok(
      lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
      'Unsafe transition directory',
    );
  else mkdirSync(directory, { recursive: true, mode: 0o700 });
}
export function transitionSourceState(root) {
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    branch: git(root, 'branch', '--show-current'),
    sourceDigest: captureSource(root).digest,
    indexDigest: hash(execFileSync('git', ['-C', root, 'diff', '--cached', '--binary'])),
    status: git(root, 'status', '--porcelain'),
  };
}
function overlayFiles(overlayRoot) {
  const bytes = regular(path.join(overlayRoot, 'manifest.json')),
    manifest = JSON.parse(bytes);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.completeFinalWorktreeProven, false);
  assert.equal(manifest.runtimeBlocked, true);
  assert.ok(manifest.files.length);
  const files = manifest.files.map((entry) => {
    assert.ok(
      entry.path &&
        !path.isAbsolute(entry.path) &&
        !entry.path.split('/').some((part) => ['.', '..', ''].includes(part)),
    );
    const file = path.join(overlayRoot, 'files', entry.path);
    assert.ok(realpathSync(file).startsWith(realpathSync(overlayRoot) + path.sep));
    assert.equal(hash(regular(file)), entry.sha256, 'Historical overlay bytes changed: ' + entry.path);
    return { path: entry.path, sha256: entry.sha256, sourceLine: entry.sourceLine };
  });
  return { files, manifest, manifestDigest: hash(bytes) };
}
export function makeParallelTransitionPlan(root, { taskA, taskB, overlayRoot }) {
  root = realpathSync(root);
  overlayRoot = realpathSync(overlayRoot);
  assert.equal(git(root, 'branch', '--show-current'), 'main');
  assert.equal(git(root, 'status', '--porcelain'), '');
  const registry = createTaskRegistry(root),
    legacy = registry.inspectLegacy(),
    overlay = overlayFiles(overlayRoot);
  assert.ok(legacy.frozen, 'Original frozen legacy record required');
  assert.equal(overlay.manifest.nativeOwner, taskB.owner, 'Recovery owner differs from original source');
  assert.equal(
    path.dirname(taskB.worktree),
    path.dirname(taskA.worktree),
    'Both tasks must use the known permanent task parent',
  );
  assert.ok(!taskB.worktree.startsWith('/tmp/') && !taskB.worktree.startsWith('/private/tmp/'));
  assert.ok(
    registeredTaskWorktrees(root).some(
      (item) => item.worktree === realpathSync(taskA.worktree) && item.branch === taskA.branch,
    ),
  );
  const a = { ...taskA, worktree: realpathSync(taskA.worktree), before: transitionSourceState(taskA.worktree) };
  assert.equal(a.before.branch, a.branch);
  const files = overlay.files.map((entry) => {
    const tree = git(root, 'ls-tree', overlay.manifest.base, '--', entry.path);
    const blob = tree ? tree.split(/\s+/)[2] : null;
    const beforeDigest = blob ? hash(execFileSync('git', ['-C', root, 'cat-file', 'blob', blob])) : null;
    return { ...entry, beforeDigest };
  });
  return {
    version: 1,
    operation: 'preserve-legacy-and-restore-independent-tasks',
    root,
    main: git(root, 'rev-parse', 'HEAD'),
    common: registry.commonDir,
    taskA: a,
    taskB: { ...taskB, base: overlay.manifest.base, files },
    overlayRoot,
    overlayDigest: overlay.manifestDigest,
    legacy: { id: legacy.record.id, recordDigest: legacy.recordDigest, acceptanceDigest: legacy.acceptanceDigest },
    businessCompletionAuthorized: false,
    dataChangesAuthorized: false,
  };
}
export function applyParallelTransition(plan) {
  assert.equal(plan.version, 1);
  assert.equal(plan.businessCompletionAuthorized, false);
  assert.equal(plan.dataChangesAuthorized, false);
  const { root, taskA: a, taskB: b } = plan,
    registry = createTaskRegistry(root);
  assert.equal(registry.commonDir, plan.common);
  assert.equal(git(root, 'rev-parse', 'HEAD'), plan.main);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.deepEqual(
    transitionSourceState(a.worktree),
    a.before,
    'A changed; preserve the new work and review a fresh transition plan',
  );
  const overlay = overlayFiles(plan.overlayRoot);
  assert.equal(overlay.manifestDigest, plan.overlayDigest);
  const legacy = registry.inspectLegacy();
  assert.equal(legacy.recordDigest, plan.legacy.recordDigest);
  assert.equal(legacy.acceptanceDigest, plan.legacy.acceptanceDigest);
  const directory = path.join(root, '.task-runtime/preview-recovery/task-transition');
  safeDirectory(directory);
  const digest = hash(JSON.stringify(plan)),
    journal = path.join(directory, digest + '.json');
  const state = existsSync(journal) ? JSON.parse(regular(journal)) : { version: 1, planDigest: digest, stages: [] };
  assert.equal(state.planDigest, digest);
  assert.match(b.branch, /^codex\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
  if (existsSync(b.worktree))
    assert.ok(state.stages.includes('before-new-worktree'), 'Unknown target directory exists; do not adopt');
  else
    assert.equal(
      git(root, 'for-each-ref', '--format=%(objectname)', 'refs/heads/' + b.branch),
      '',
      'Unknown recovery branch exists',
    );
  safeDirectory(path.dirname(b.worktree));
  const save = (stage) => {
    if (!state.stages.includes(stage)) state.stages.push(stage);
    writeFileSync(journal, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  };
  if (!registry.readTask(plan.legacy.id))
    registry.preserveLegacy({
      expectedRecordDigest: plan.legacy.recordDigest,
      expectedAcceptanceDigest: plan.legacy.acceptanceDigest,
    });
  assert.equal(registry.readTask(plan.legacy.id).compatibility.readOnly, true);
  save('legacy-preserved');
  if (!existsSync(b.worktree)) {
    assert.equal(
      git(root, 'for-each-ref', '--format=%(objectname)', 'refs/heads/' + b.branch),
      '',
      'Unknown recovery branch exists',
    );
    save('before-new-worktree');
    git(root, 'worktree', 'add', '-b', b.branch, b.worktree, b.base);
    save('new-worktree-created');
  } else assert.ok(state.stages.includes('before-new-worktree'), 'Unknown target directory exists; do not adopt');
  assert.equal(git(b.worktree, 'branch', '--show-current'), b.branch);
  assert.equal(git(b.worktree, 'rev-parse', 'HEAD'), b.base);
  assert.ok(
    registeredTaskWorktrees(root).some(
      (item) => item.worktree === realpathSync(b.worktree) && item.branch === b.branch,
    ),
  );
  const changed = execFileSync('git', ['-C', b.worktree, 'status', '--porcelain', '--untracked-files=all', '-z'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  for (const row of changed)
    assert.ok(
      !/[RC]/.test(row.slice(0, 2)) && b.files.some((file) => file.path === row.slice(3)),
      'Unknown recovery worktree source; preserve it before adoption',
    );
  for (const file of b.files) {
    const target = path.join(b.worktree, file.path);
    let ancestor = path.dirname(target);
    while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
    assert.ok(
      realpathSync(ancestor) === realpathSync(b.worktree) ||
        realpathSync(ancestor).startsWith(realpathSync(b.worktree) + path.sep),
      'Recovery target escapes its own worktree',
    );
    const bytes = regular(path.join(plan.overlayRoot, 'files', file.path));
    const current = existsSync(target) ? hash(regular(target)) : null;
    assert.ok(current === file.beforeDigest || current === file.sha256, 'Unknown B change; retain it: ' + file.path);
    if (current !== file.sha256) {
      safeDirectory(path.dirname(target));
      writeFileSync(target, bytes, { mode: 0o644 });
    }
    assert.equal(hash(regular(target)), file.sha256);
  }
  save('historical-overlay-restored-not-final');
  for (const task of [a, b]) {
    const old = registry.readTask(task.id);
    if (!old) registry.register({ id: task.id, worktree: task.worktree, owner: task.owner, kind: 'business' });
    const current = registry.resolve({ id: task.id, worktree: task.worktree });
    assert.equal(current.owner, task.owner);
    assert.ok(!current.frozen, 'Task was frozen after planning; do not migrate its baseline');
    if (!current.transition)
      registry.revise(task.id, current.revision, (record) => {
        record.title = task.title;
        record.transition = { planDigest: digest, originalHead: task === a ? a.before.head : b.base };
        if (task === a) {
          record.resources.dataScope = 'persistent-preview';
          record.resources.persistentPreviewOwner = true;
          record.checkpoints = git(
            a.worktree,
            'rev-list',
            '--reverse',
            record.base + '..' + a.before.head,
            '--not',
            'origin/main',
          )
            .split('\n')
            .filter(Boolean)
            .map((commit) => ({
              commit,
              verification: 'Recovered existing WIP history; no new validation or formal delivery claimed',
            }));
        } else
          record.recovery = {
            status: 'partial-historical-restoration',
            runtimeBlocked: true,
            originalBranch: overlay.manifest.originalBranchRetained,
            originalWorktree: overlay.manifest.originalMissingWorktreeRetained,
            historicalManifest: path.join(plan.overlayRoot, 'manifest.json'),
            files: b.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
            blockers: [
              'Final generated/continuously edited source is not fully proved',
              'V168 conflicts with the unfinished order task; reconcile before first runtime/data migration',
            ],
          };
        record.stage = 'developing';
      });
    else assert.equal(current.transition.planDigest, digest, 'Task belongs to another transition');
  }
  save('independent-identities-registered');
  const legacyDirectory = path.join(registry.commonDir, 'task-batches');
  safeDirectory(path.join(legacyDirectory, 'archive'));
  const oldActive = path.join(legacyDirectory, 'active.json');
  assert.equal(hash(regular(oldActive)), plan.legacy.recordDigest);
  chmodSync(oldActive, 0o400); // Preserve exact bytes; ordinary old writers must fail instead of reviving a second standard.
  const workers = path.join(legacyDirectory, plan.legacy.id + '.workers');
  if (existsSync(workers)) {
    assert.ok(lstatSync(workers).isDirectory() && !lstatSync(workers).isSymbolicLink());
    chmodSync(workers, 0o500);
  }
  chmodSync(legacyDirectory, 0o500);
  save('legacy-writers-read-only');
  assert.deepEqual(transitionSourceState(a.worktree), a.before, 'A source/index changed during transition');
  assert.equal(hash(regular(oldActive)), plan.legacy.recordDigest);
  assert.equal(registry.inspectLegacy().acceptanceDigest, plan.legacy.acceptanceDigest);
  assert.equal(git(root, 'status', '--porcelain'), '');
  state.result = {
    metadataApplied: true,
    taskASourceUnchanged: true,
    taskARemainsIncomplete: true,
    taskBHistoricalFiles: b.files.length,
    taskBFinalWorktreeProven: false,
    taskBRuntimeBlocked: true,
    legacyBytesUnchanged: true,
    oldBranchAndMissingWorktreeRegistrationRetained: true,
    previewChanged: false,
    databaseChanged: false,
    sourcePublished: false,
    journal,
  };
  save('verified');
  return state.result;
}
