import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskRegistry } from './task-registry.mjs';
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
import {
  acceptedCompositionTree,
  candidateCompositionTree,
  writeAcceptedComposition,
} from './accepted-source-composition.mjs';
function fixture(t, { legacy = false, overwritesA = false, freezeAfterMainSync = false, conflictPath = null } = {}) {
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
  if (conflictPath) {
    mkdirSync(path.dirname(path.join(root, conflictPath)), { recursive: true });
    writeFileSync(path.join(root, conflictPath), 'base\n');
  }
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD'),
    remote = path.join(root, '.task-runtime/origin.git');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main');
  git('switch', '-c', 'codex/a');
  const registry = createTaskRegistry(root);
  if (!legacy) registry.register({ id: 'a', owner: 'fixture-a', worktree: root });
  const checkpoint = (commit) => {
    if (legacy) return;
    const task = registry.readTask('a');
    registry.revise('a', task.revision, (record) => {
      record.recordedHead = commit;
      record.checkpoints.push({
        commit,
        verification: 'Explicit fixture task/composition ownership, no quality claim',
      });
    });
  };
  writeFileSync(path.join(root, 'src/product.js'), 'price = 20;\n');
  rmSync(path.join(root, 'src/obsolete.js'));
  if (conflictPath) writeFileSync(path.join(root, conflictPath), 'accepted task\n');
  git('add', '.');
  git('commit', '-m', 'task A approved feature');
  const head = git('rev-parse', 'HEAD');
  checkpoint(head);
  const batch = { id: 'a', worktree: root, branch: 'codex/a', base, ...(legacy ? {} : { taskRegistryVersion: 2 }) };
  let original = freezeAfterMainSync ? null : freezeAcceptedSource(root, batch);
  const b = path.join(root, '.task-runtime/b');
  git('worktree', 'add', '-b', 'codex/b', b, overwritesA ? head : base);
  const bGit = (...args) => git('-C', b, ...args);
  writeFileSync(path.join(b, 'src/task-b.js'), 'published B feature');
  if (conflictPath) writeFileSync(path.join(b, conflictPath), 'published main\n');
  if (overwritesA) writeFileSync(path.join(b, 'src/product.js'), 'price = 15;\n');
  bGit('add', '.');
  bGit('commit', '-m', 'published B');
  const main = bGit('rev-parse', 'HEAD');
  git('push', 'origin', main + ':refs/heads/main');
  git('fetch', 'origin');
  if (freezeAfterMainSync) {
    git('merge', '--no-edit', main);
    checkpoint(git('rev-parse', 'HEAD'));
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

function repairTechnicalConflict(f, file) {
  writeFileSync(path.join(f.root, file), readFileSync(path.join(f.b, file)));
  f.git('add', '--', file);
  f.git('commit', '-m', 'adapt exempt technical file to published main');
  return f.git('rev-parse', 'HEAD');
}

test('exempt original technical conflict compares protected source without changing the freeze, index or worktree', (t) => {
  const file = 'scripts/shared-tool.mjs',
    f = fixture(t, { conflictPath: file });
  assert.throws(() => candidateCompositionTree(f.root, f.head, f.main), /CONFLICT|Command failed/);
  const candidate = repairTechnicalConflict(f, file);
  const before = {
    head: f.git('rev-parse', 'HEAD'),
    index: f.git('write-tree'),
    refs: f.git('show-ref'),
    status: f.git('status', '--porcelain'),
  };
  const expected = acceptedCompositionTree(f.root, f.original.commit, f.main);
  assert.equal(f.git('show', expected + ':src/product.js'), 'price = 20;');
  assert.equal(f.git('show', expected + ':src/task-b.js'), 'published B feature');
  assert.throws(() => f.git('cat-file', '-e', expected + ':src/obsolete.js'));
  assert.deepEqual(
    {
      head: f.git('rev-parse', 'HEAD'),
      index: f.git('write-tree'),
      refs: f.git('show-ref'),
      status: f.git('status', '--porcelain'),
    },
    before,
  );
  const remote = verifyRemoteAcceptance(f.root, {
    candidate,
    accepted: f.original.commit,
    branch: f.batch.branch,
    trustedMain: f.main,
  });
  assert.equal(remote.accepted, f.original.commit);
  const proof = prepareAcceptedComposition(f.root, 'a', f.main);
  assert.equal(proof.expectedTree, expected);
  f.git('merge', '--no-edit', f.main);
  assertAcceptedSource(f.root, 'a', f.git('rev-parse', 'HEAD'));
  assert.equal(readFileSync(path.join(f.root, file), 'utf8'), 'published main\n');
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
});

for (const file of ['src/product.js', 'AGENTS.md', 'scripts/accepted-source-composition.mjs']) {
  test('original protected conflict remains blocked: ' + file, (t) => {
    const f = fixture(t, { conflictPath: file });
    repairTechnicalConflict(f, file);
    assert.throws(() => acceptedCompositionTree(f.root, f.original.commit, f.main), /business\/control-plane conflict/);
    assert.throws(() => prepareAcceptedComposition(f.root, 'a', f.main));
    assert.equal(existsSync(path.join(f.root, '.git/task-delivery/a/composition.json')), false);
    assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
  });
}

test('explicitly protected technical file is never exempted by the comparison adapter', (t) => {
  const file = 'scripts/shared-tool.mjs',
    f = fixture(t, { conflictPath: file });
  const message = f.git('show', '-s', '--format=%B', f.original.commit);
  const metadata = JSON.parse(message.slice('zdm-accepted-source-v1\n'.length));
  metadata.protectedPaths.push(file);
  const accepted = acceptedGit(f.root, ['commit-tree', f.original.tree, '-p', metadata.parent], {
    input: 'zdm-accepted-source-v1\n' + JSON.stringify(metadata) + '\n',
  });
  assert.throws(() => acceptedCompositionTree(f.root, accepted, f.main), /business\/control-plane conflict/);
});

test('technical conflict does not mask unauthorized business content, deletion or executable mode changes', (t) => {
  const file = 'scripts/shared-tool.mjs',
    f = fixture(t, { conflictPath: file });
  repairTechnicalConflict(f, file);
  prepareAcceptedComposition(f.root, 'a', f.main);
  f.git('merge', '--no-edit', f.main);
  const good = f.git('rev-parse', 'HEAD');
  for (const attack of ['business', 'resurrection', 'mode']) {
    const scratch = path.join(f.root, '.task-runtime', 'attack-' + attack);
    f.git('worktree', 'add', '--detach', scratch, good);
    if (attack === 'business') writeFileSync(path.join(scratch, 'src/product.js'), 'price = 99;');
    if (attack === 'resurrection') writeFileSync(path.join(scratch, 'src/obsolete.js'), 'resurrected');
    f.git('-C', scratch, 'add', '.');
    if (attack === 'mode') f.git('-C', scratch, 'update-index', '--chmod=+x', 'src/product.js');
    f.git('-C', scratch, 'commit', '-m', attack);
    const bad = f.git('-C', scratch, 'rev-parse', 'HEAD');
    assert.throws(() => assertAcceptedSource(f.root, 'a', bad), /differs from accepted/);
    assert.throws(
      () =>
        verifyRemoteAcceptance(f.root, {
          candidate: bad,
          accepted: f.original.commit,
          branch: f.batch.branch,
          trustedMain: f.main,
        }),
      /changed accepted/,
    );
  }
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
});

test('clean compositions keep their exact historical full-tree identity', (t) => {
  const f = fixture(t);
  const prior = f
    .git('-c', 'merge.renames=false', 'merge-tree', '--write-tree', '--merge-base=' + f.base, f.main, f.original.commit)
    .split('\n')[0];
  assert.equal(acceptedCompositionTree(f.root, f.original.commit, f.main), prior);
});

test('reviewed technical conflict recovery is bound to its exact resolved tree and original parents', (t) => {
  const file = 'scripts/shared-tool.mjs',
    f = fixture(t, { conflictPath: file });
  // Build the review artifact in a private index; the owned task stays clean.
  const index = path.join(f.root, '.task-runtime/resolved-index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const raw = acceptedCompositionTree(f.root, f.original.commit, f.main);
  acceptedGit(f.root, ['read-tree', raw], { env });
  const entry = f.git('ls-tree', f.main, '--', file).split(/\s+/);
  acceptedGit(f.root, ['update-index', '--cacheinfo', entry[0], entry[2], file], { env });
  const resolved = acceptedGit(f.root, ['write-tree'], { env });
  const proof = writeAcceptedComposition(f.root, {
    batch: 'a',
    accepted: f.original.commit,
    main: f.main,
    taskHead: f.head,
    candidateTree: resolved,
  });
  assert.throws(() => f.git('merge', '--no-ff', '--no-edit', f.main));
  writeFileSync(path.join(f.root, file), readFileSync(path.join(f.b, file)));
  f.git('add', '--', file);
  assert.equal(f.git('write-tree'), proof.candidateTree);
  f.git('commit', '-m', 'reviewed technical-only composition');
  assert.deepEqual(f.git('show', '-s', '--format=%P', 'HEAD').split(' '), [f.head, f.main]);
  assertAcceptedSource(f.root, 'a', f.git('rev-parse', 'HEAD'));
  verifyRemoteAcceptance(f.root, {
    candidate: f.git('rev-parse', 'HEAD'),
    accepted: f.original.commit,
    branch: f.batch.branch,
    trustedMain: f.main,
  });
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
});

test('mixed exempt and protected conflicts cannot enter composition recovery', (t) => {
  const file = 'scripts/shared-tool.mjs',
    f = fixture(t, { conflictPath: file });
  writeFileSync(path.join(f.b, 'src/product.js'), 'price = 77;\n');
  f.bGit('add', '.');
  f.bGit('commit', '-m', 'overlapping business change');
  const main = f.bGit('rev-parse', 'HEAD');
  assert.throws(() => acceptedCompositionTree(f.root, f.original.commit, main), /business\/control-plane conflict/);
  assert.equal(existsSync(path.join(f.root, '.git/task-delivery/a/composition.json')), false);
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
});
