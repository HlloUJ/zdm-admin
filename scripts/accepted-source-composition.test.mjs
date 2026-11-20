import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskRegistry } from './task-registry.mjs';
import { applyTaskComposition } from './task-composition.mjs';
import { runAcceptedSourceCI } from './accepted-source-ci.mjs';
import { completionCommand } from './completion-cli.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
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
function fixture(
  t,
  { legacy = false, overwritesA = false, freezeAfterMainSync = false, conflictPath = null, files = {} } = {},
) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'accepted-composition-')));
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
  for (const [file, versions] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    if (versions.base !== null) writeFileSync(path.join(root, file), versions.base);
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
  for (const [file, versions] of Object.entries(files)) writeFileSync(path.join(root, file), versions.frozen);
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
  for (const [file, versions] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(b, file)), { recursive: true });
    writeFileSync(path.join(b, file), versions.main);
  }
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
  return { root, git, b, bGit, batch, original, head: git('rev-parse', 'HEAD'), base, main, registry };
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

const reviewPath = '.codex/accepted-source-conflict-reviews/a.json';
// Reduced source from the 749 conflict shapes: four frozen paths and five
// engineering paths with actual unmerged entries on both sides.
const reviewedPaths = {
  '.agents/skills/zdm-product-knowledge/references/notion-index.md': {
    base: '账号规则：稳定 ID\n',
    frozen: '账号规则：稳定 ID\n门店移除：读取 V1.3\n',
    main: '账号规则：稳定 ID（新文档库）\n',
    resolved: '账号规则：稳定 ID（新文档库）\n门店移除：读取 V1.3\n',
  },
  'src/pages/order/prototype/index.vue': {
    base: 'function execute() {\n  save();\n}\n',
    frozen: 'async function execute() {\n  await verifyStore();\n  await verifyPayment();\n  save();\n}\n',
    main: 'async function execute() {\n  await verifyPayment();\n  save();\n}\n',
    resolved: 'async function execute() {\n  await verifyStore();\n  await verifyPayment();\n  save();\n}\n',
  },
  'src/pages/order/prototype/resources.ts': {
    base: "label: '配置',\n",
    frozen: "label: '款项配置',\nnote: '按门店隔离',\n",
    main: "label: '款项配置',\n",
    resolved: "label: '款项配置',\nnote: '按门店隔离',\n",
  },
  'src/services/orderPrototypePreview.test.ts': {
    base: "allows('order');\n",
    frozen: "allows('order', 5179);\nblocks('settings');\n",
    main: "allows('order', 5175);\nblocks('settings');\n",
    resolved: "allows('order', 5179);\nblocks('settings');\n",
  },
};
const engineeringPaths = [
  'scripts/business-regression-contracts.json',
  'scripts/engineering-impact.json',
  'scripts/test-domain-manifest.json',
  'tests/e2e/pagination-responsive.spec.ts',
  'tests/e2e/store-order-prototype.spec.ts',
];

const addedFile = 'src/services/storeCacheCleanup.ts';
const addedVersions = { base: null, frozen: 'order cache\n', main: 'selection cache\n', resolved: 'both caches\n' };

function protectedFixture(t, paths = reviewedPaths, version = 1) {
  const f = fixture(t, {
    files: {
      ...paths,
      ...Object.fromEntries(engineeringPaths.map((file) => [file, { base: 'before\n', frozen: 'A\n', main: 'B\n' }])),
    },
  });
  const data = {
    version,
    batch: 'a',
    accepted: f.original.commit,
    integrationBase: f.base,
    reviewedMain: f.main,
    resolutions: Object.entries(paths).map(([file, versions]) => ({
      file,
      inputs: {
        base: versions.base === null ? null : f.git('rev-parse', f.base + ':' + file),
        frozen: f.git('rev-parse', f.original.commit + ':' + file),
        main: f.git('rev-parse', f.main + ':' + file),
      },
      result: {
        mode: '100644',
        object: acceptedGit(f.root, ['hash-object', '--stdin'], { input: versions.resolved }),
        text: versions.resolved,
      },
      reason: 'Verify the exact frozen task changes and the behavior from published main',
    })),
  };
  const task = f.registry.readTask('a');
  f.registry.revise(task.id, task.revision, (record) => {
    record.frozen = { accepted: f.original.commit, tree: f.original.tree, businessDigest: f.original.businessDigest };
    record.stage = 'frozen';
  });
  return { ...f, data, paths };
}
function publishReview(f, receipt = f.data) {
  mkdirSync(path.join(f.b, path.dirname(reviewPath)), { recursive: true });
  writeFileSync(path.join(f.b, reviewPath), JSON.stringify(receipt) + '\n');
  f.bGit('add', '.');
  f.bGit('commit', '-m', 'Separately reviewed exact resolution');
  const main = f.bGit('rev-parse', 'HEAD');
  f.bGit('push', 'origin', main + ':refs/heads/main');
  return main;
}
function resolvedCommit(f, main, { candidateReceipt = false } = {}) {
  const worktree = path.join(f.root, '.task-runtime', 'reviewed-' + f.git('rev-list', '--all', '--count'));
  f.git('worktree', 'add', '--detach', worktree, f.head);
  const git = (...args) => f.git('-C', worktree, ...args);
  assert.throws(() => git('merge', '--no-ff', '--no-commit', main), /Git operation failed/);
  assert.deepEqual(
    git('diff', '--name-only', '--diff-filter=U').split('\n').sort(),
    [...Object.keys(f.paths), ...engineeringPaths].sort(),
  );
  for (const entry of f.data.resolutions) writeFileSync(path.join(worktree, entry.file), entry.result.text);
  for (const file of engineeringPaths) writeFileSync(path.join(worktree, file), 'A and B\n');
  if (candidateReceipt) {
    mkdirSync(path.join(worktree, path.dirname(reviewPath)), { recursive: true });
    writeFileSync(path.join(worktree, reviewPath), JSON.stringify(f.data) + '\n');
  }
  git('add', '.');
  git('commit', '-m', 'Reviewed merge from exact parents');
  return git('rev-parse', 'HEAD');
}

async function verifyPublishedReview(f) {
  const main = publishReview(f),
    candidate = resolvedCommit(f, main),
    baseline = readFileSync(path.join(f.registry.commonDir, 'task-delivery/a/accepted-source.json'));
  const proof = prepareAcceptedComposition(f.root, 'a', main, candidate);
  assert.equal(proof.version, 2);
  assert.equal(proof.accepted, f.original.commit);
  assert.equal(proof.candidateCommit, candidate);
  assert.deepEqual(proof.review.files, Object.keys(f.paths).sort());
  assert.equal(f.git('rev-parse', 'HEAD'), f.head, 'Planning leaves the adopted source untouched');

  f.git('push', 'origin', candidate + ':refs/heads/codex/a');
  f.git('push', 'origin', f.original.commit + ':refs/tags/zdm-accepted/a');
  const trusted = path.join(f.root, '.task-runtime', 'independent-ci');
  f.git('clone', '--branch', 'main', '--single-branch', '--no-local', f.git('remote', 'get-url', 'origin'), trusted);
  const requests = [];
  const ci = await runAcceptedSourceCI(
    trusted,
    {
      pull_request: {
        base: { ref: 'main', sha: main },
        head: { ref: 'codex/a', sha: candidate, repo: { full_name: 'fixture/zdm' } },
      },
    },
    {
      repository: 'fixture/zdm',
      token: 'fixture-only',
      request: async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ id: 1 }) };
      },
    },
  );
  assert.deepEqual(ci.reviewedMerge, { commit: candidate, taskHead: f.head, main });
  assert.equal(ci.composedTree, proof.expectedTree);
  assert.equal(requests[1].conclusion, 'success');

  const recovered = applyTaskComposition(f.root, 'a', undefined, { recover: true });
  assert.equal(recovered.recordedHead, candidate);
  assert.equal(recovered.composition.before, f.head);
  assert.equal(recovered.composition.main, main);
  const final = f.git('commit-tree', ci.candidateMergeTree, '-p', main, '-p', candidate, '-m', 'merge PR on main');
  assertAcceptedSource(f.root, 'a', final);
  assert.deepEqual(readFileSync(path.join(f.registry.commonDir, 'task-delivery/a/accepted-source.json')), baseline);
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
}

test('published protected review composes nine conflict paths through owned recovery and independent remote CI', (t) =>
  verifyPublishedReview(protectedFixture(t)));

test('published mixed review preserves add/add and existing-base conflicts through independent remote CI and recovery', (t) =>
  verifyPublishedReview(protectedFixture(t, { ...reviewedPaths, [addedFile]: addedVersions }, 2)));

test('add/add review requires explicit proven absence and exact input and result objects', (t) => {
  const emptyFile = 'src/empty-base.txt';
  const f = protectedFixture(t, { [addedFile]: addedVersions, [emptyFile]: { ...addedVersions, base: '' } }, 2);
  const [added, existing] = f.data.resolutions;
  const emptyBlob = f.git('rev-parse', f.base + ':' + emptyFile);
  const reject = (receipt, expected) => {
    const main = publishReview(f, receipt);
    assert.throws(() => acceptedCompositionTree(f.root, f.original.commit, main), expected);
  };
  const withAdded = (changes) => ({ ...f.data, resolutions: [{ ...added, ...changes }, existing] });
  reject({ ...f.data, version: 1 }, /existing regular file/);
  reject(withAdded({ inputs: { frozen: added.inputs.frozen, main: added.inputs.main } }), /existing regular file/);
  reject(withAdded({ inputs: { ...added.inputs, base: emptyBlob } }), /existing regular file/);
  reject(
    { ...f.data, resolutions: [added, { ...existing, inputs: { ...existing.inputs, base: null } }] },
    /inputs changed/,
  );
  reject(withAdded({ inputs: { ...added.inputs, frozen: added.inputs.main } }), /inputs changed/);
  reject(withAdded({ inputs: { ...added.inputs, main: added.inputs.frozen } }), /inputs changed/);
  reject(withAdded({ result: { ...added.result, mode: '100755' } }), /cannot change mode/);
  reject(withAdded({ result: { ...added.result, text: 'different bytes' } }), /do not match reviewed blob/);
  reject({ ...f.data, resolutions: [existing] }, /cover exactly/);
  reject({ ...f.data, resolutions: [added, added] }, /cover exactly/);
  const main = publishReview(f);
  const tree = acceptedCompositionTree(f.root, f.original.commit, main);
  for (const row of f.data.resolutions) assert.equal(f.git('rev-parse', tree + ':' + row.file), row.result.object);
});

test('an add/add conflict still requires regular UTF-8 originals on both sides', (t) => {
  const f = protectedFixture(t, { [addedFile]: { ...addedVersions, frozen: Buffer.from([0xff]) } }, 2);
  const main = publishReview(f);
  assert.throws(() => acceptedCompositionTree(f.root, f.original.commit, main), /Binary conflict/);
  f.bGit('update-index', '--chmod=+x', '--', addedFile);
  f.bGit('commit', '-m', 'Executable published input');
  const executableMain = f.bGit('rev-parse', 'HEAD');
  assert.throws(() => acceptedCompositionTree(f.root, f.original.commit, executableMain), /existing regular file/);
});

test('existing reviewed inputs are independently rechecked when unrelated published main advances before CI', (t) => {
  const f = protectedFixture(t),
    main = publishReview(f),
    candidate = resolvedCommit(f, main);
  writeFileSync(path.join(f.b, 'src/published-after-review.js'), 'must be retained\n');
  f.bGit('add', '.');
  f.bGit('commit', '-m', 'Non-overlapping published main change');
  const latest = f.bGit('rev-parse', 'HEAD');
  const proof = verifyRemoteAcceptance(f.root, {
    candidate,
    accepted: f.original.commit,
    branch: f.batch.branch,
    trustedMain: latest,
  });
  assert.equal(proof.trustedMain, latest);
  assert.equal(proof.reviewedMerge.main, main);
  assert.equal(f.git('show', proof.candidateMergeTree + ':src/published-after-review.js'), 'must be retained');
});

test('completion entry adopts only a validated exact merge after the owned runtime is quiesced', async (t) => {
  const f = protectedFixture(t),
    main = publishReview(f),
    candidate = resolvedCommit(f, main);
  f.git('branch', '-f', 'main', main);
  f.bGit('switch', 'main');
  const owner = 'fixture-a';
  let stops = 0;
  const previewControl = {
    prepareComposition: async (plan) => {
      stops++;
      assert.equal(plan.main, main);
      assert.equal(plan.task, f.registry.readTask('a').worktree);
      assert.equal(f.git('rev-parse', 'HEAD'), f.head, 'The owned source is still unmodified');
    },
  };
  await completionCommand(f.root, ['begin'], { owner });
  await assert.rejects(completionCommand(f.root, ['compose-reviewed', main, f.head], { owner, previewControl }));
  assert.equal(stops, 0);
  const result = await completionCommand(f.root, ['compose-reviewed', main, candidate], { owner, previewControl });
  assert.equal(stops, 1);
  assert.equal(result.head, candidate);
  assert.equal(f.git('rev-parse', 'HEAD'), candidate);
  assert.deepEqual(readAcceptance(f.root, 'a'), f.original);
});

test('the candidate cannot publish its own protected conflict review', (t) => {
  const f = protectedFixture(t);
  const candidate = resolvedCommit(f, f.main, { candidateReceipt: true });
  assert.throws(
    () =>
      verifyRemoteAcceptance(f.root, {
        candidate,
        accepted: f.original.commit,
        branch: f.batch.branch,
        trustedMain: f.main,
      }),
    /requires a published exact review/,
  );
});

test('changes to published review inputs or protected conflict coverage fail closed', (t) => {
  const f = protectedFixture(t);
  const incomplete = structuredClone(f.data);
  incomplete.resolutions.pop();
  const first = publishReview(f, incomplete);
  assert.throws(() => acceptedCompositionTree(f.root, f.original.commit, first), /cover exactly/);
  const changed = structuredClone(f.data);
  changed.resolutions[0].inputs.main = changed.resolutions[0].inputs.base;
  const second = publishReview(f, changed);
  assert.throws(() => acceptedCompositionTree(f.root, f.original.commit, second), /inputs changed/);
  const third = publishReview(f);
  writeFileSync(path.join(f.b, f.data.resolutions[0].file), 'new main change\n');
  f.bGit('add', '.');
  f.bGit('commit', '-m', 'Shared main changed after review');
  const latest = f.bGit('rev-parse', 'HEAD');
  assert.notEqual(latest, third);
  assert.throws(() => acceptedCompositionTree(f.root, f.original.commit, latest), /inputs changed/);
});

test('approved protected bytes cannot mask candidate drift or a synthetic merge without the exact parents', (t) => {
  const f = protectedFixture(t),
    main = publishReview(f);
  const candidate = resolvedCommit(f, main);
  const tree = f.git('rev-parse', candidate + '^{tree}');
  const opts = { accepted: f.original.commit, branch: f.batch.branch, trustedMain: main };
  const unrelatedMainParent = f.git('commit-tree', tree, '-p', f.head, '-p', f.main, '-m', 'previous main');
  assert.throws(
    () => verifyRemoteAcceptance(f.root, { ...opts, candidate: unrelatedMainParent }),
    /missing its exact task and trusted main merge parents/,
  );
  const dir = path.join(f.root, '.task-runtime', 'candidate-tampering');
  f.git('worktree', 'add', '--detach', dir, candidate);
  for (const attack of ['rewrite', 'delete', 'mode']) {
    const file = f.data.resolutions[1].file;
    const git = (...args) => f.git('-C', dir, ...args);
    if (attack === 'rewrite') writeFileSync(path.join(dir, file), '// unapproved\n');
    if (attack === 'delete') rmSync(path.join(dir, file));
    if (attack === 'mode') git('update-index', '--chmod=+x', file);
    else git('add', '--', file);
    const tampered = git('commit-tree', git('write-tree'), '-p', f.head, '-p', main, '-m', attack);
    assert.throws(() => verifyRemoteAcceptance(f.root, { ...opts, candidate: tampered }), /changed accepted/);
    git('restore', '--source=' + candidate, '--staged', '--worktree', '--', file);
  }
  assert.throws(
    () => prepareAcceptedComposition(f.root, 'a', main, unrelatedMainParent),
    /exact task and trusted main parents/,
  );
  assert.equal(existsSync(path.join(f.registry.commonDir, 'task-delivery/a/composition.json')), false);
});
