import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { freezeAcceptedSource } from './accepted-source.mjs';
import { checkpointFrozenHistory } from './task-development.mjs';
import { historicalCommitEvidence } from './task-commit-ownership.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'frozen-history-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'codex/a');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'source.txt'), 'base');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const registry = createTaskRegistry(root);
  registry.register({ id: 'a', owner: 'chat-a', worktree: root });
  const commit = (value) => {
    writeFileSync(path.join(root, 'source.txt'), value);
    git('add', '.');
    git('commit', '-m', value);
    return git('rev-parse', 'HEAD');
  };
  commit('one');
  const head = commit('two');
  let task = registry.readTask('a');
  registry.revise('a', task.revision, (record) => {
    record.recordedHead = head;
    record.checkpoints.push({ commit: head, verification: 'fixture' });
  });
  const freeze = () => {
    // Model already-frozen historical state produced by the old tool, without
    // weakening the new v2 pre-freeze path under test.
    const accepted = freezeAcceptedSource(root, { id: 'a', worktree: root, branch: 'codex/a' });
    task = registry.readTask('a');
    registry.revise('a', task.revision, (record) => {
      record.stage = 'frozen';
      record.frozen = { accepted: accepted.commit, tree: accepted.tree, businessDigest: accepted.businessDigest };
    });
    return accepted;
  };
  const review = () => {
    const current = registry.readTask('a');
    const plan = historicalCommitEvidence(root, current, head);
    return {
      task: 'a',
      owner: 'chat-a',
      revision: current.revision,
      head,
      accepted: current.frozen.accepted,
      originMain: plan.originMain,
      entries: plan.entries.map((entry) => ({
        ...entry,
        reason: 'Reviewed source.txt diff as this fixture task, no foreign changes; not validation evidence',
      })),
    };
  };
  return { root, git, registry, commit, head, freeze, review };
}
test('freeze rejects missing historical ownership before any acceptance side effect, and retains dirty snapshot support', (t) => {
  const f = fixture(t),
    task = f.registry.readTask('a');
  assert.throws(
    () => freezeAcceptedSource(f.root, { ...task, taskRegistryVersion: 2 }),
    /Unassigned task commits before freeze/,
  );
  assert.equal(existsSync(path.join(f.root, '.git/task-delivery/a/accepted-source.json')), false);
  assert.equal(f.git('for-each-ref', '--format=%(objectname)', 'refs/zdm/accepted/a'), '');
  f.registry.revise('a', task.revision, (record) => {
    for (const commit of historicalCommitEvidence(f.root, task, f.head).missing)
      record.checkpoints.push({ commit, verification: 'Reviewed fixture' });
  });
  writeFileSync(path.join(f.root, 'source.txt'), 'uncommitted snapshot');
  const accepted = freezeAcceptedSource(f.root, { ...f.registry.readTask('a'), taskRegistryVersion: 2 });
  assert.equal(f.git('show', accepted.commit + ':source.txt'), 'uncommitted snapshot');
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
});
test('original owner atomically appends exact historical evidence without changing freeze, head, source or existing checkpoints', (t) => {
  const f = fixture(t),
    accepted = f.freeze(),
    before = f.registry.readTask('a'),
    review = f.review();
  const bytes = readFileSync(path.join(f.root, '.git/task-delivery/a/accepted-source.json'));
  const result = checkpointFrozenHistory(f.root, { id: 'a', owner: 'chat-a', review });
  assert.equal(result.revision, before.revision + 1);
  assert.deepEqual(result.checkpoints.slice(0, before.checkpoints.length), before.checkpoints);
  assert.deepEqual(result.frozen, before.frozen);
  assert.equal(result.stage, before.stage);
  assert.equal(result.recordedHead, before.recordedHead);
  assert.equal(result.checkpoints.at(-1).historicalReview.diffSha256, review.entries[0].diffSha256);
  assert.deepEqual(readFileSync(path.join(f.root, '.git/task-delivery/a/accepted-source.json')), bytes);
  assert.equal(f.git('rev-parse', 'refs/zdm/accepted/a'), accepted.commit);
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  assert.equal(f.git('status', '--porcelain'), '');
});
for (const attack of [
  'owner',
  'revision',
  'digest',
  'parents',
  'omission',
  'duplicate',
  'reason',
  'head',
  'accepted',
  'main',
  'dirty',
]) {
  test('rejects ' + attack + ' with no partial metadata update', (t) => {
    const f = fixture(t);
    f.freeze();
    const before = f.registry.readTask('a'),
      review = f.review();
    let owner = 'chat-a';
    if (attack === 'owner') owner = 'chat-b';
    if (attack === 'revision') review.revision--;
    if (attack === 'digest') review.entries[0].diffSha256 = '0'.repeat(64);
    if (attack === 'parents') review.entries[0].parents = [f.head];
    if (attack === 'omission') review.entries = [];
    if (attack === 'duplicate') review.entries.push(review.entries[0]);
    if (attack === 'reason') review.entries[0].reason = '';
    if (attack === 'head') review.head = '0'.repeat(40);
    if (attack === 'accepted') review.accepted = '0'.repeat(40);
    if (attack === 'main') review.originMain = '0'.repeat(40);
    if (attack === 'dirty') writeFileSync(path.join(f.root, 'source.txt'), 'dirty');
    assert.throws(() => checkpointFrozenHistory(f.root, { id: 'a', owner, review }));
    assert.deepEqual(f.registry.readTask('a'), before);
  });
}
test('other task checkpoint ownership refuses adoption', (t) => {
  const f = fixture(t);
  f.freeze();
  const review = f.review(),
    other = path.join(f.root, '..', path.basename(f.root) + '-b');
  t.after(() => rmSync(other, { recursive: true, force: true }));
  f.git('worktree', 'add', '-b', 'codex/b', other, 'origin/main');
  f.registry.register({ id: 'b', worktree: other, owner: 'chat-b' });
  const b = f.registry.readTask('b');
  f.registry.revise('b', b.revision, (r) =>
    r.checkpoints.push({ commit: review.entries[0].commit, verification: 'already claimed' }),
  );
  assert.throws(() => checkpointFrozenHistory(f.root, { id: 'a', owner: 'chat-a', review }), /another task/);
});
test('untrusted side branch is rejected while published-main merge is reviewable', (t) => {
  const f = fixture(t);
  f.git('checkout', '-b', 'side', 'origin/main');
  writeFileSync(path.join(f.root, 'side.txt'), 'side');
  f.git('add', '.');
  f.git('commit', '-m', 'side');
  const side = f.git('rev-parse', 'HEAD');
  f.git('checkout', 'codex/a');
  f.git('merge', '--no-ff', 'side', '-m', 'merge side');
  const task = f.registry.readTask('a'),
    head = f.git('rev-parse', 'HEAD');
  assert.throws(() => historicalCommitEvidence(f.root, task, head), /side-branch|Command failed/);
  f.git('update-ref', 'refs/remotes/origin/main', side);
  const proof = historicalCommitEvidence(f.root, task, head);
  assert.ok(proof.entries.some((e) => e.commit === head && e.parents[1] === side));
  assert.ok(!proof.commits.includes(side));
});

test('running formal writer rejects historical metadata updates', (t) => {
  const f = fixture(t);
  f.freeze();
  const review = f.review(),
    before = f.registry.readTask('a');
  writeFileSync(
    path.join(f.root, '.git/task-delivery/a/completion-session.json'),
    JSON.stringify({ events: [{ name: 'prepare', status: 'running' }] }),
  );
  assert.throws(() => checkpointFrozenHistory(f.root, { id: 'a', owner: 'chat-a', review }), /Formal writer/);
  assert.deepEqual(f.registry.readTask('a'), before);
});

test('the formal resource lease excludes live and interrupted writers without stealing, and is released after success or rejection', (t) => {
  const f = fixture(t);
  f.freeze();
  const review = f.review(),
    before = f.registry.readTask('a'),
    leases = createResourceLeases(before.repository.commonDir);
  const lease = leases.acquire('task-delivery-a', 'chat-a');
  assert.throws(() => checkpointFrozenHistory(f.root, { id: 'a', owner: 'chat-a', review }), /owned or interrupted/);
  assert.deepEqual(leases.inspect('task-delivery-a'), lease);
  assert.deepEqual(f.registry.readTask('a'), before);
  leases.release(lease);
  const bad = structuredClone(review);
  bad.entries[0].reason = '';
  assert.throws(() => checkpointFrozenHistory(f.root, { id: 'a', owner: 'chat-a', review: bad }));
  assert.equal(leases.inspect('task-delivery-a'), null);
  checkpointFrozenHistory(f.root, { id: 'a', owner: 'chat-a', review });
  assert.equal(leases.inspect('task-delivery-a'), null);
});

test('HEAD movement during snapshot capture cannot publish an unchecked acceptance', (t) => {
  const f = fixture(t),
    task = f.registry.readTask('a');
  f.registry.revise('a', task.revision, (record) => {
    for (const commit of historicalCommitEvidence(f.root, task, f.head).missing)
      record.checkpoints.push({ commit, verification: 'Reviewed fixture' });
  });
  const next = f.git(
    'commit-tree',
    f.git('rev-parse', 'HEAD^{tree}'),
    '-p',
    f.head,
    '-m',
    'unassigned concurrent commit',
  );
  const wrapper = mkdtempSync(path.join(tmpdir(), 'freeze-git-'));
  t.after(() => rmSync(wrapper, { recursive: true, force: true }));
  const realGit = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  const marker = path.join(wrapper, 'moved');
  writeFileSync(
    path.join(wrapper, 'git'),
    `#!/bin/sh\nif [ "$1" = "write-tree" ] && [ ! -f '${marker}' ]; then\n touch '${marker}'\n '${realGit}' update-ref HEAD '${next}' '${f.head}' || exit 1\nfi\nexec '${realGit}' "$@"\n`,
    { mode: 0o755 },
  );
  const original = process.env.PATH;
  process.env.PATH = wrapper + path.delimiter + original;
  try {
    assert.throws(
      () => freezeAcceptedSource(f.root, { ...f.registry.readTask('a'), taskRegistryVersion: 2 }),
      /Source HEAD moved/,
    );
  } finally {
    process.env.PATH = original;
  }
  assert.equal(f.git('for-each-ref', '--format=%(objectname)', 'refs/zdm/accepted/a'), '');
  assert.equal(existsSync(path.join(f.root, '.git/task-delivery/a/accepted-source.json')), false);
  assert.equal(f.git('rev-parse', 'HEAD'), next);
});
