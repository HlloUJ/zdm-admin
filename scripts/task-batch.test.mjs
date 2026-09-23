import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  readActiveBatch,
  assertBatchIdAvailable,
  validateActiveBatch,
  registerBatch,
  upsertBatchModule,
  setBatchModuleStatus,
  recordBatchCheckpoint,
  planBatchDelivery,
  planBatchRollback,
  closeBatch,
} from './task-batch.mjs';

function fixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'zdm-batch-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const anchor = path.join(directory, 'repo');
  const worktree = path.join(directory, 'task');
  mkdirSync(anchor);
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git(anchor, 'init', '--initial-branch=main');
  git(anchor, 'config', 'user.email', 'batch@example.invalid');
  git(anchor, 'config', 'user.name', 'Batch fixture');
  writeFileSync(path.join(anchor, 'baseline.txt'), 'baseline');
  git(anchor, 'add', '.');
  git(anchor, 'commit', '-m', 'baseline', '--no-verify');
  git(anchor, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(anchor, 'worktree', 'add', '-b', 'codex/task', worktree, 'main');
  const registry = path.join(anchor, '.git/task-batches');
  const commit = (file, value = file, cwd = worktree) => {
    writeFileSync(path.join(cwd, file), value);
    git(cwd, 'add', file);
    git(cwd, 'commit', '-m', file, '--no-verify');
    return git(cwd, 'rev-parse', 'HEAD');
  };
  const checkpoint = (moduleId, sha, verification = 'Fixture note only; no external verification implied') =>
    recordBatchCheckpoint(worktree, { moduleId, commit: sha, verification });
  const module = (id, dependsOn = []) => upsertBatchModule(worktree, { id, title: `Module ${id}`, dependsOn });
  return { directory, anchor, worktree, registry, git, commit, checkpoint, module };
}
function ready(f, id, sha) {
  f.module(id);
  f.checkpoint(id, sha);
  setBatchModuleStatus(f.worktree, id, 'ready');
}
const entry = fileURLToPath(new URL('./task-batch.mjs', import.meta.url));

test('status without a batch is read-only, returns JSON null and creates no registry', (t) => {
  const f = fixture(t);
  assert.equal(readActiveBatch(f.anchor), null);
  const result = spawnSync(process.execPath, [entry, 'status', '--json'], { cwd: f.anchor, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), null);
  assert.equal(existsSync(f.registry), false);
});

test('registration preserves dirty code, is discoverable across worktrees and is idempotent', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.worktree, 'dirty.txt'), 'existing user work');
  const before = f.git(f.worktree, 'status', '--porcelain');
  const head = f.git(f.worktree, 'rev-parse', 'HEAD');
  const record = registerBatch(f.worktree, { id: 'batch-one', owner: 'explicit-owner' });
  assert.equal(record.owner, 'explicit-owner');
  assert.equal(record.base, head);
  assert.deepEqual(registerBatch(f.worktree, { id: 'batch-one' }), record);
  assert.deepEqual(validateActiveBatch(f.anchor, readActiveBatch(f.anchor)), record);
  assert.equal(f.git(f.worktree, 'status', '--porcelain'), before);
  assert.equal(f.git(f.worktree, 'rev-parse', 'HEAD'), head);
});

test('one active batch cannot be silently replaced or registered from main/integration', (t) => {
  const f = fixture(t);
  assert.throws(() => registerBatch(f.anchor, { id: 'invalid-main' }), /codex task branch/);
  registerBatch(f.worktree, { id: 'batch-one' });
  assert.throws(() => registerBatch(f.worktree, { id: 'batch-two' }), /already owns/);
  assert.throws(() => registerBatch(f.worktree, { id: 'batch-one', kind: 'infrastructure' }), /already owns/);
  const other = path.join(f.directory, 'other');
  f.git(f.anchor, 'worktree', 'add', '-b', 'codex/other', other, 'main');
  assert.throws(() => registerBatch(other, { id: 'batch-one' }), /already owns/);
});

test('corrupt, cross-repository and stale branch records are errors, never an absent batch', (t) => {
  const f = fixture(t);
  const other = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  const file = path.join(f.registry, 'active.json');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, '{broken');
  assert.throws(() => readActiveBatch(f.anchor), /Invalid batch record/);
  writeFileSync(file, original);
  mkdirSync(other.registry);
  writeFileSync(path.join(other.registry, 'active.json'), original);
  assert.throws(() => readActiveBatch(other.anchor), /another or relocated/);
  f.git(f.worktree, 'checkout', '-b', 'codex/changed');
  assert.throws(() => validateActiveBatch(f.anchor, readActiveBatch(f.anchor)), /changed branch/);
  const status = spawnSync(process.execPath, [entry, 'status', '--json'], { cwd: f.anchor, encoding: 'utf8' });
  assert.equal(status.status, 1);
});

test('dependency ids and cycles are validated before metadata is written', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  assert.throws(() => f.module('child', ['missing']), /Missing dependency/);
  assert.equal(readActiveBatch(f.anchor).modules.length, 0);
  f.module('a');
  f.module('b', ['a']);
  f.module('c', ['b']);
  assert.throws(() => f.module('a', ['c']), /cycle/);
  assert.throws(() => f.module('b', ['a', 'a']), /Duplicate module dependency/);
  assert.deepEqual(readActiveBatch(f.anchor).modules.find((module) => module.id === 'a').dependsOn, []);
});

test('checkpoint requires an existing owned commit after base and cannot belong to two modules', (t) => {
  const f = fixture(t);
  const registered = registerBatch(f.worktree, { id: 'batch-one' });
  f.module('a');
  f.module('b');
  assert.throws(() => f.checkpoint('a', registered.base), /after the batch base/);
  assert.throws(() => f.checkpoint('a', 'f'.repeat(40)), /Git query failed/);
  const foreign = f.git(f.anchor, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'foreign object');
  assert.throws(() => f.checkpoint('a', foreign), /belong to the current branch/);
  const own = f.commit('a.txt');
  f.checkpoint('a', own);
  f.checkpoint('a', own);
  assert.throws(() => f.checkpoint('b', own), /already belongs/);
  assert.equal(readActiveBatch(f.anchor).modules[0].checkpoints.length, 1);
});

test('commits predating registration still need explicit module attribution', (t) => {
  const f = fixture(t);
  const sha = f.commit('existing-task-work.txt');
  registerBatch(f.worktree, { id: 'batch-one' });
  f.module('a');
  setBatchModuleStatus(f.worktree, 'a', 'ready');
  assert.throws(() => planBatchDelivery(f.anchor), /Unassigned batch commit/);
  f.checkpoint('a', sha);
  const plan = planBatchDelivery(f.anchor);
  assert.deepEqual(plan.commits, [sha]);
  assert.equal(plan.verificationProven, false);
});

test('delivery rejects dirt, unassigned commits and paused/excluded code; verification text is not a test result', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  const first = f.commit('a.txt');
  ready(f, 'a', first);
  const plan = planBatchDelivery(f.anchor);
  assert.equal(plan.verificationProven, false);
  assert.ok(plan.requiredExternalChecks.length);
  writeFileSync(path.join(f.worktree, 'dirty.txt'), 'dirty');
  assert.throws(() => planBatchDelivery(f.anchor), /must be clean/);
  rmSync(path.join(f.worktree, 'dirty.txt'));
  for (const status of ['paused', 'excluded']) {
    setBatchModuleStatus(f.worktree, 'a', status);
    assert.throws(() => planBatchDelivery(f.anchor), /still contributes/);
  }
  setBatchModuleStatus(f.worktree, 'a', 'ready');
  const second = f.commit('unknown.txt');
  assert.throws(() => planBatchDelivery(f.anchor), new RegExp(second));
});

test('upstream main commits are excluded but task sync merges require an explicit checkpoint', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  const own = f.commit('a.txt');
  ready(f, 'a', own);
  const upstream = f.commit('upstream.txt', 'upstream', f.anchor);
  f.git(f.anchor, 'update-ref', 'refs/remotes/origin/main', upstream);
  f.git(f.worktree, 'merge', '--no-edit', 'main');
  const merge = f.git(f.worktree, 'rev-parse', 'HEAD');
  assert.throws(() => planBatchDelivery(f.anchor), new RegExp(merge));
  f.checkpoint('a', merge);
  const plan = planBatchDelivery(f.anchor);
  assert.deepEqual(plan.commits, [own, merge]);
  assert.ok(!plan.commits.includes(upstream));
});

test('rollback plans include transitive dependents in reverse dependency order and perform no Git changes', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  for (const [module, dependencies] of [
    ['a', []],
    ['b', ['a']],
    ['c', ['b']],
    ['independent', []],
  ]) {
    f.module(module, dependencies);
    f.checkpoint(module, f.commit(`${module}.txt`));
  }
  const head = f.git(f.worktree, 'rev-parse', 'HEAD');
  const plan = planBatchRollback(f.anchor, 'a');
  assert.deepEqual(
    plan.modules.map((module) => module.id),
    ['c', 'b', 'a'],
  );
  assert.equal(plan.executed, false);
  assert.equal(f.git(f.worktree, 'rev-parse', 'HEAD'), head);
});

test('active Git operations and registry write locks stop mutations without taking over', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  const marker = path.resolve(f.worktree, f.git(f.worktree, 'rev-parse', '--git-path', 'MERGE_HEAD'));
  writeFileSync(marker, f.git(f.worktree, 'rev-parse', 'HEAD'));
  assert.throws(() => f.module('a'), /operation in progress/);
  rmSync(marker);
  mkdirSync(path.join(f.registry, 'write.lock'));
  assert.throws(() => f.module('a'), /registry is locked/);
  rmSync(path.join(f.registry, 'write.lock'), { recursive: true });
  assert.equal(readActiveBatch(f.anchor).modules.length, 0);
});

test('close waits for synchronized main and complete carrier cleanup, then keeps archived rollback metadata', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  const sha = f.commit('a.txt');
  ready(f, 'a', sha);
  assert.throws(() => closeBatch(f.anchor), /not in main/);
  f.git(f.anchor, 'merge', '--ff-only', 'codex/task');
  assert.throws(() => closeBatch(f.anchor), /must match/);
  f.git(f.anchor, 'update-ref', 'refs/remotes/origin/main', 'main');
  f.git(f.anchor, 'update-ref', 'refs/remotes/origin/codex/task', sha);
  assert.throws(() => closeBatch(f.anchor), /worktree has not/);
  f.git(f.anchor, 'worktree', 'remove', f.worktree);
  assert.throws(() => closeBatch(f.anchor), /Task branch still exists/);
  f.git(f.anchor, 'branch', '-d', 'codex/task');
  assert.throws(() => closeBatch(f.anchor), /Remote-tracking/);
  f.git(f.anchor, 'update-ref', '-d', 'refs/remotes/origin/codex/task');
  const archived = closeBatch(f.anchor);
  assert.equal(archived.main.remoteFreshnessProven, false);
  assert.equal(readActiveBatch(f.anchor), null);
  const rollback = planBatchRollback(f.anchor, 'a', 'batch-one');
  assert.deepEqual(rollback.commits, [sha]);
  assert.equal(rollback.executed, false);
  const other = path.join(f.directory, 'new-task');
  f.git(f.anchor, 'worktree', 'add', '-b', 'codex/new-task', other, 'main');
  assert.throws(() => registerBatch(other, { id: 'batch-one' }), /already archived/);
  assert.ok(existsSync(path.join(f.registry, 'archive/batch-one.json')));
  writeFileSync(
    path.join(f.registry, 'archive/wrong-id.json'),
    readFileSync(path.join(f.registry, 'archive/batch-one.json')),
  );
  assert.throws(() => planBatchRollback(f.anchor, 'a', 'wrong-id'), /filename does not match/);
});

test('rewritten upstream history invalidates the active batch instead of silently changing its base', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  const unrelated = f.git(f.anchor, 'commit-tree', 'HEAD^{tree}', '-m', 'replacement main root');
  f.git(f.anchor, 'update-ref', 'refs/remotes/origin/main', unrelated);
  assert.throws(() => validateActiveBatch(f.anchor, readActiveBatch(f.anchor)), /no longer contains/);
});

test('rollback commits follow Git reverse topology even when module checkpoints were registered out of order', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  f.module('a');
  f.module('b', ['a']);
  const first = f.commit('first.txt');
  const dependent = f.commit('dependent.txt');
  const followup = f.commit('followup.txt');
  f.checkpoint('a', followup);
  f.checkpoint('b', dependent);
  f.checkpoint('a', first);
  const plan = planBatchRollback(f.anchor, 'a');
  assert.deepEqual(
    plan.modules.map((module) => module.id),
    ['b', 'a'],
  );
  assert.deepEqual(plan.modules.find((module) => module.id === 'a').commits, [followup, first]);
  assert.deepEqual(plan.commits, [followup, dependent, first]);
});

test('active rollback plans expose actual HEAD, unassigned commits and dirty work without changing them', (t) => {
  const f = fixture(t);
  registerBatch(f.worktree, { id: 'batch-one' });
  f.module('a');
  const checkpoint = f.commit('checkpoint.txt');
  f.checkpoint('a', checkpoint);
  const latest = f.commit('unassigned.txt');
  writeFileSync(path.join(f.worktree, 'draft.txt'), 'uncommitted work');
  const before = readActiveBatch(f.anchor);
  const plan = planBatchRollback(f.anchor, 'a');
  assert.equal(plan.head, latest);
  assert.equal(plan.recordedHead, checkpoint);
  assert.deepEqual(plan.unassignedCommits, [latest]);
  assert.equal(plan.dirty, true);
  assert.match(plan.workingTreeStatus, /draft.txt/);
  assert.equal(plan.warnings.length, 2);
  assert.deepEqual(plan.commits, [checkpoint]);
  assert.equal(f.git(f.worktree, 'rev-parse', 'HEAD'), latest);
  assert.deepEqual(readActiveBatch(f.anchor), before);
  assert.equal(readFileSync(path.join(f.worktree, 'draft.txt'), 'utf8'), 'uncommitted work');
});

test('batch id preflight rejects invalid or archived ids without creating registry state', (t) => {
  const f = fixture(t);
  assert.equal(assertBatchIdAvailable(f.anchor, 'available'), 'available');
  assert.equal(existsSync(f.registry), false);
  assert.throws(() => assertBatchIdAvailable(f.anchor, 'a'.repeat(65)), /Invalid batch id/);
  assert.equal(existsSync(f.registry), false);
  mkdirSync(path.join(f.registry, 'archive'), { recursive: true });
  writeFileSync(path.join(f.registry, 'archive/taken.json'), '{}');
  assert.throws(() => assertBatchIdAvailable(f.anchor, 'taken'), /already archived/);
  assert.equal(readActiveBatch(f.anchor), null);
});

test('batched history proof rejects wrong object types and merged commits that forked before the recorded base', (t) => {
  const f = fixture(t);
  const oldBase = f.git(f.anchor, 'rev-parse', 'HEAD');
  const base = f.commit('base-extension.txt', 'next base', f.anchor);
  f.git(f.anchor, 'update-ref', 'refs/remotes/origin/main', base);
  f.git(f.worktree, 'merge', '--ff-only', 'main');
  registerBatch(f.worktree, { id: 'batch-one' });
  f.module('a');
  const own = f.commit('own.txt');
  f.checkpoint('a', own);
  const side = f.git(f.anchor, 'commit-tree', `${own}^{tree}`, '-p', oldBase, '-m', 'side before batch base');
  const merge = f.git(f.anchor, 'commit-tree', `${own}^{tree}`, '-p', own, '-p', side, '-m', 'merge side');
  f.git(f.anchor, 'update-ref', 'refs/heads/codex/task', merge);
  const record = readActiveBatch(f.anchor);
  assert.deepEqual(validateActiveBatch(f.anchor, record), record);
  const sideCheckpoint = structuredClone(record);
  sideCheckpoint.modules[0].checkpoints[0].commit = side;
  assert.throws(() => validateActiveBatch(f.anchor, sideCheckpoint), /Checkpoint no longer belongs/);
  const wrongType = structuredClone(record);
  wrongType.startHead = f.git(f.anchor, 'rev-parse', `${own}^{tree}`);
  assert.throws(() => validateActiveBatch(f.anchor, wrongType), /Missing recorded startHead/);
  const missing = structuredClone(record);
  missing.modules[0].checkpoints[0].commit = 'f'.repeat(40);
  assert.throws(() => validateActiveBatch(f.anchor, missing), /Checkpoint no longer belongs/);
});

for (const state of ['branch', 'head', 'operation', 'replacement']) {
  test(`metadata writes recheck live ${state} after the edit and retain the previous record on failure`, (t) => {
    const f = fixture(t);
    registerBatch(f.worktree, { id: 'batch-one' });
    f.module('a');
    f.checkpoint('a', f.commit('a.txt'));
    const record = readActiveBatch(f.anchor);
    const file = path.join(f.registry, 'active.json');
    const before = readFileSync(file, 'utf8');
    const marker = path.resolve(f.worktree, f.git(f.worktree, 'rev-parse', '--git-path', 'MERGE_HEAD'));
    const replacement =
      state === 'replacement'
        ? f.git(f.anchor, 'commit-tree', `${record.recordedHead}^{tree}`, '-m', 'replacement with unrelated history')
        : null;
    const original = childProcess.spawnSync;
    let queries = 0;
    const intercepted = t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
      const relevant =
        command === 'git' &&
        (['branch', 'replacement'].includes(state)
          ? args[0] === 'branch' && args[1] === '--show-current'
          : state === 'head'
            ? args[0] === 'rev-parse' && args[2] === 'refs/heads/codex/task^{commit}'
            : args[0] === 'rev-parse' && args.includes('--git-path'));
      if (relevant && ++queries === 2) {
        if (state === 'operation') writeFileSync(marker, record.recordedHead);
        else {
          const mutation =
            state === 'branch'
              ? ['checkout', '-b', 'codex/changed-during-edit']
              : state === 'replacement'
                ? ['replace', record.recordedHead, replacement]
                : ['update-ref', 'refs/heads/codex/task', record.base];
          const result = original('git', mutation, { cwd: f.worktree, encoding: 'utf8' });
          assert.equal(result.status, 0, result.stderr);
        }
      }
      return original(command, args, options);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(
        () => setBatchModuleStatus(f.worktree, 'a', 'ready'),
        /changed branch|rewritten behind|operation in progress|Recorded base\/start history/,
      );
      assert.equal(queries, 2);
    } finally {
      intercepted.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(existsSync(path.join(f.registry, 'write.lock')), false);
  });
}
