import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  acceptedGit,
  freezeAcceptedSource,
  readAcceptance,
  assertAcceptedSource,
  prepareAcceptedComposition,
  verifyRemoteAcceptance,
} from './accepted-source.mjs';
function fixture(t, { legacy = false, overwritesA = false, freezeAfterMainSync = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'accepted-composition-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => acceptedGit(root, args);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'test@example.invalid');
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, '.gitignore'), '.task-runtime/\n');
  writeFileSync(path.join(root, 'src/product.js'), 'price = 12;\n');
  writeFileSync(path.join(root, 'src/obsolete.js'), 'obsolete');
  writeFileSync(path.join(root, 'scripts/accepted-source-composition.mjs'), '// frozen control plane');
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD'),
    remote = path.join(root, '.task-runtime/origin.git');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main');
  git('switch', '-c', 'codex/a');
  writeFileSync(path.join(root, 'src/product.js'), 'price = 20;\n');
  rmSync(path.join(root, 'src/obsolete.js'));
  git('add', '.');
  git('commit', '-m', 'task A approved feature');
  const head = git('rev-parse', 'HEAD');
  const batch = { id: 'a', worktree: root, branch: 'codex/a', base, ...(legacy ? {} : { taskRegistryVersion: 2 }) };
  let original = freezeAfterMainSync ? null : freezeAcceptedSource(root, batch);
  const b = path.join(root, '.task-runtime/b');
  git('worktree', 'add', '-b', 'codex/b', b, overwritesA ? head : base);
  const bGit = (...args) => git('-C', b, ...args);
  writeFileSync(path.join(b, 'src/task-b.js'), 'published B feature');
  if (overwritesA) writeFileSync(path.join(b, 'src/product.js'), 'price = 15;\n');
  bGit('add', '.');
  bGit('commit', '-m', 'published B');
  const main = bGit('rev-parse', 'HEAD');
  git('push', 'origin', main + ':refs/heads/main');
  git('fetch', 'origin');
  if (freezeAfterMainSync) {
    git('merge', '--no-edit', main);
    original = freezeAcceptedSource(root, batch);
  }
  return { root, git, b, bGit, batch, original, head: git('rev-parse', 'HEAD'), base, main };
}
test('trusted main composes with original task additions/changes/deletions without rebuilding the acceptance', (t) => {
  const f = fixture(t);
  const remoteProof = verifyRemoteAcceptance(f.root, {
    candidate: f.head,
    accepted: f.original.commit,
    branch: f.batch.branch,
    trustedMain: f.main,
  });
  assert.equal(
    remoteProof.composedTree,
    remoteProof.candidateMergeTree,
    'Old task head can be checked against the actual PR merge result',
  );
  const proof = prepareAcceptedComposition(f.root, f.batch.id, f.main);
  f.git('-c', 'merge.renames=false', 'merge', '--no-edit', f.main);
  const candidate = f.git('rev-parse', 'HEAD');
  assertAcceptedSource(f.root, f.batch.id, candidate);
  verifyRemoteAcceptance(f.root, {
    candidate,
    accepted: f.original.commit,
    branch: f.batch.branch,
    trustedMain: f.main,
  });
  assert.equal(readFileSync(path.join(f.root, 'src/task-b.js'), 'utf8'), 'published B feature');
  assert.equal(readFileSync(path.join(f.root, 'src/product.js'), 'utf8'), 'price = 20;\n');
  assert.equal(existsSync(path.join(f.root, 'src/obsolete.js')), false);
  assert.equal(proof.accepted, f.original.commit);
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
  assert.deepEqual(freezeAcceptedSource(f.root, f.batch), f.original);
});
for (const attack of ['task business', 'main business', 'deleted source', 'control plane']) {
  test('combined source still blocks unauthorized ' + attack, (t) => {
    const f = fixture(t);
    prepareAcceptedComposition(f.root, 'a', f.main);
    f.git('-c', 'merge.renames=false', 'merge', '--no-edit', f.main);
    if (attack === 'task business') writeFileSync(path.join(f.root, 'src/product.js'), 'price = 99;');
    if (attack === 'main business') writeFileSync(path.join(f.root, 'src/task-b.js'), 'unreviewed B edit');
    if (attack === 'deleted source') writeFileSync(path.join(f.root, 'src/obsolete.js'), 'resurrected source');
    if (attack === 'control plane')
      writeFileSync(path.join(f.root, 'scripts/accepted-source-composition.mjs'), '// bypass');
    f.git('add', '.');
    f.git('commit', '-m', 'unreviewed change');
    const candidate = f.git('rev-parse', 'HEAD');
    assert.throws(() => assertAcceptedSource(f.root, 'a', candidate), /differs from accepted/);
    assert.throws(
      () =>
        verifyRemoteAcceptance(f.root, {
          candidate,
          accepted: f.original.commit,
          branch: f.batch.branch,
          trustedMain: f.main,
        }),
      /changed accepted/,
    );
    assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
  });
}
test('main containing A ancestry cannot silently overwrite the frozen task-owned delta', (t) => {
  const f = fixture(t, { overwritesA: true });
  assert.throws(() => prepareAcceptedComposition(f.root, 'a', f.main));
  assert.throws(() =>
    verifyRemoteAcceptance(f.root, {
      candidate: f.head,
      accepted: f.original.commit,
      branch: f.batch.branch,
      trustedMain: f.main,
    }),
  );
  assert.equal(existsSync(path.join(f.root, '.git/task-delivery/a/composition.json')), false);
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
});
test('old freeze without an original integration base is not silently upgraded or rebaselined', (t) => {
  const f = fixture(t, { legacy: true });
  assert.throws(() => prepareAcceptedComposition(f.root, 'a', f.main), /Legacy frozen/);
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
});
test('local composition proof cannot use a branch that is not the freshly published main', (t) => {
  const f = fixture(t);
  f.git('update-ref', 'refs/remotes/origin/main', f.base);
  assert.throws(() => prepareAcceptedComposition(f.root, 'a', f.base), /Published main changed/);
  assert.equal(existsSync(path.join(f.root, '.git/task-delivery/a/composition.json')), false);
});
test('trusted main synchronized during development is kept as baseline provenance, not misattributed to task A', (t) => {
  const f = fixture(t, { freezeAfterMainSync: true });
  writeFileSync(path.join(f.b, 'src/task-b.js'), 'new published B revision');
  f.bGit('add', '.');
  f.bGit('commit', '-m', 'published B improvement');
  const main = f.bGit('rev-parse', 'HEAD');
  f.git('push', 'origin', main + ':refs/heads/main');
  f.git('fetch', 'origin');
  const proof = prepareAcceptedComposition(f.root, 'a', main);
  f.git('-c', 'merge.renames=false', 'merge', '--no-edit', main);
  assertAcceptedSource(f.root, 'a', f.git('rev-parse', 'HEAD'));
  assert.equal(readFileSync(path.join(f.root, 'src/product.js'), 'utf8'), 'price = 20;\n');
  assert.equal(readFileSync(path.join(f.root, 'src/task-b.js'), 'utf8'), 'new published B revision');
  assert.equal(proof.accepted, f.original.commit);
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
});
