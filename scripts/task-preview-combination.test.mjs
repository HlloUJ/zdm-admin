import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createTaskRegistry } from './task-registry.mjs';
import { freezeAcceptedSource } from './accepted-source.mjs';
import { completionCommand } from './completion-cli.mjs';
import {
  planPreviewCombination,
  applyPreviewCombination,
  verifyPreviewMembers,
  assertCombinationRuntime,
} from './task-preview-combination.mjs';
function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'combination-test-'))),
    main = path.join(dir, 'main');
  mkdirSync(main);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(main, 'base.txt'), 'base\n');
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'base');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const registry = createTaskRegistry(main),
    roots = {};
  for (const id of ['a', 'b', 'combined']) {
    roots[id] = path.join(dir, id);
    git(main, 'worktree', 'add', '-b', 'codex/' + id, roots[id]);
    registry.register({ id, worktree: roots[id], owner: 'test-owner', kind: 'infrastructure' });
  }
  writeFileSync(path.join(roots.a, 'a.txt'), 'unfinished a');
  writeFileSync(path.join(roots.b, 'b.txt'), 'unfinished b');
  const fingerprint = (id) => [
    git(roots[id], 'rev-parse', 'HEAD'),
    git(roots[id], 'status', '--porcelain'),
    git(roots[id], 'diff', '--cached'),
  ];
  return { main, roots, registry, git, fingerprint };
}
test('combines dirty members only into private carrier and leaves source files/index/HEAD untouched', async (t) => {
  const f = fixture(t),
    before = ['a', 'b'].map(f.fingerprint);
  const plan = planPreviewCombination(f.main, ['a', 'b']);
  const result = await applyPreviewCombination(f.main, 'combined', plan, 'test-owner', {
    references: async () => ({ owned: [], backendPorts: [] }),
  });
  assert.equal(result.runtimeStarted, false);
  assert.equal(result.dataScope, 'isolated-task');
  for (const id of ['a', 'b'])
    assert.equal(readFileSync(path.join(f.roots.combined, id + '.txt'), 'utf8'), 'unfinished ' + id);
  assert.deepEqual(['a', 'b'].map(f.fingerprint), before);
  assertCombinationRuntime(f.main, f.registry.resolve({ id: 'combined' }));
});
test('conflict refuses preparation without changing source tasks or target', async (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.roots.a, 'base.txt'), 'a\n');
  writeFileSync(path.join(f.roots.b, 'base.txt'), 'b\n');
  const before = ['a', 'b', 'combined'].map(f.fingerprint);
  assert.throws(() => planPreviewCombination(f.main, ['a', 'b']), /Preview source conflict/);
  assert.deepEqual(['a', 'b', 'combined'].map(f.fingerprint), before);
});
test('member changes invalidate plan instead of updating carrier or members', async (t) => {
  const f = fixture(t),
    plan = planPreviewCombination(f.main, ['a', 'b']);
  writeFileSync(path.join(f.roots.a, 'a.txt'), 'changed');
  assert.throws(() => verifyPreviewMembers(f.main, plan), /Member changed/);
  await assert.rejects(
    () =>
      applyPreviewCombination(f.main, 'combined', plan, 'test-owner', {
        references: async () => ({ owned: [], backendPorts: [] }),
      }),
    /Member changed/,
  );
  assert.equal(f.git(f.roots.combined, 'status', '--porcelain'), '');
});
test('blocked, paused, frozen and nested combination members are rejected', async (t) => {
  for (const flag of [{ recovery: { runtimeBlocked: true } }, { paused: true }, { frozen: {} }, { previewOnly: {} }]) {
    const f = fixture(t);
    const task = f.registry.readTask('a');
    f.registry.revise('a', task.revision, (r) => Object.assign(r, flag));
    assert.throws(() => planPreviewCombination(f.main, ['a', 'b']), /cannot enter/);
  }
});
test('combination cannot freeze or enter any formal completion command', async (t) => {
  const f = fixture(t),
    plan = planPreviewCombination(f.main, ['a', 'b']);
  await applyPreviewCombination(f.main, 'combined', plan, 'test-owner', {
    references: async () => ({ owned: [], backendPorts: [] }),
  });
  const task = f.registry.resolve({ id: 'combined' });
  assert.throws(() => freezeAcceptedSource(f.roots.combined, task), /cannot be frozen/);
  assert.throws(() => freezeAcceptedSource(f.roots.combined, { ...task, previewOnly: undefined }), /cannot be frozen/);
  for (const args of [
    ['begin'],
    ['freeze'],
    ['deliver', 'combined', plan.base],
    ['settle', 'combined', plan.base, '1'],
  ])
    await assert.rejects(
      completionCommand(f.roots.combined, args, { owner: 'test-owner' }),
      /cannot enter formal completion/,
    );
});
test('runtime enforces dedicated data and exact carrier content', async (t) => {
  const f = fixture(t),
    plan = planPreviewCombination(f.main, ['a', 'b']);
  await applyPreviewCombination(f.main, 'combined', plan, 'test-owner', {
    references: async () => ({ owned: [], backendPorts: [] }),
  });
  const task = f.registry.resolve({ id: 'combined' });
  assert.throws(
    () => assertCombinationRuntime(f.main, { ...task, resources: { dataScope: 'persistent-preview' } }),
    /isolated data/,
  );
  writeFileSync(path.join(f.roots.combined, 'a.txt'), 'changed');
  assert.throws(() => assertCombinationRuntime(f.main, task), /source changed/);
});
test('private inputs and duplicate members are rejected', async (t) => {
  const f = fixture(t);
  assert.throws(() => planPreviewCombination(f.main, ['a', 'a']), /distinct/);
  writeFileSync(path.join(f.roots.a, '.env'), 'private');
  assert.throws(() => planPreviewCombination(f.main, ['a', 'b']), /Private input/);
});

test('recorded completion pause is rejected before any composition', async (t) => {
  const f = fixture(t),
    folder = path.join(f.registry.commonDir, 'task-delivery/a');
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'completion-session.json'), JSON.stringify({ pauses: [{ startedAt: 1 }] }));
  assert.throws(() => planPreviewCombination(f.main, ['a', 'b']), /pause requires explicit recovery/);
});
test('existing carrier work and removable preview-only labels are forbidden', async (t) => {
  const f = fixture(t),
    plan = planPreviewCombination(f.main, ['a', 'b']);
  writeFileSync(path.join(f.roots.combined, 'existing.txt'), 'preserve');
  await assert.rejects(
    () =>
      applyPreviewCombination(f.main, 'combined', plan, 'test-owner', {
        references: async () => ({ owned: [], backendPorts: [] }),
      }),
    /pristine/,
  );
  assert.equal(readFileSync(path.join(f.roots.combined, 'existing.txt'), 'utf8'), 'preserve');
  const task = f.registry.readTask('combined');
  f.registry.revise(task.id, task.revision, (record) => {
    record.previewOnly = plan;
  });
  const marked = f.registry.readTask('combined');
  assert.throws(
    () =>
      f.registry.revise(marked.id, marked.revision, (record) => {
        delete record.previewOnly;
      }),
    /immutable/,
  );
});

test('running frontends, backends and existing data are rejected without changing carrier', async (t) => {
  const f = fixture(t),
    plan = planPreviewCombination(f.main, ['a', 'b']);
  for (const references of [
    { owned: [{}], backendPorts: [] },
    { owned: [], backendPorts: [8082] },
  ]) {
    await assert.rejects(
      applyPreviewCombination(f.main, 'combined', plan, 'test-owner', { references: async () => references }),
      /Existing frontend|Existing backend/,
    );
    assert.equal(f.git(f.roots.combined, 'status', '--porcelain'), '');
    assert.equal(f.registry.readTask('combined').previewOnly, undefined);
  }
  mkdirSync(path.join(f.registry.commonDir, 'task-environments/combined'), { recursive: true });
  await assert.rejects(applyPreviewCombination(f.main, 'combined', plan, 'test-owner'), /Existing data/);
});
test('active delivery or preview operation excludes carrier conversion', async (t) => {
  const { createResourceLeases } = await import('./resource-lease.mjs');
  const f = fixture(t),
    plan = planPreviewCombination(f.main, ['a', 'b']),
    leases = createResourceLeases(f.registry.commonDir);
  for (const name of ['task-delivery-combined', 'task-preview-combined']) {
    const lease = leases.acquire(name, 'test-owner');
    try {
      await assert.rejects(applyPreviewCombination(f.main, 'combined', plan, 'test-owner'), /Resource is owned/);
    } finally {
      leases.release(lease);
    }
    assert.equal(f.registry.readTask('combined').previewOnly, undefined);
  }
});

test('late target edits are preserved and reject materialization', async (t) => {
  const f = fixture(t),
    plan = planPreviewCombination(f.main, ['a', 'b']);
  await assert.rejects(
    applyPreviewCombination(f.main, 'combined', plan, 'test-owner', {
      references: async () => ({ owned: [], backendPorts: [] }),
      beforeMaterialize: async () => writeFileSync(path.join(f.roots.combined, 'a.txt'), 'late edit'),
    }),
    /would be overwritten|not uptodate|Command failed/,
  );
  assert.equal(readFileSync(path.join(f.roots.combined, 'a.txt'), 'utf8'), 'late edit');
  assert.equal(f.registry.readTask('combined').previewOnly.previewOnly, true);
});
