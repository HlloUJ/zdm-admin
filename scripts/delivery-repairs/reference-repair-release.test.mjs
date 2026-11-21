import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acceptedGit, freezeAcceptedSource, readAcceptance, sourceEntries } from '../accepted-source.mjs';
import { assertCompletionQuality } from '../completion-ci-evidence.mjs';
import { verifyReferenceConsumerSource } from './preview-reference-proof.mjs';
import {
  assertReferenceRepairMerge,
  assertReferenceRepairReview,
  assertReferenceRepairStart,
  assertReferenceRepairTree,
  checkApproval,
  referenceRepairApproval,
} from './reference-repair-release.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const tracked = 'scripts/accepted-source-continuation.mjs';
const futurePath = 'scripts/future-engineering.mjs';
const collector = 'scripts/delivery-repairs/preview-reference-proof.mjs';
const host = 'scripts/delivery-repairs/reference-repair-release.mjs';
const deleted = 'src/removed.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reference-repair-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => acceptedGit(root, args);
  const branch = 'codex/synthetic';
  git('init', '-b', branch);
  git('config', 'user.name', 'Synthetic Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const edit = (file, content) => {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  };
  function commit() {
    git('add', '--all');
    git('commit', '-m', 'synthetic source');
    return git('rev-parse', 'HEAD');
  }
  edit('src/business.mjs', '// frozen business');
  edit(deleted, '// original file');
  edit(tracked, '// source protected by current policy');
  edit(futurePath, '// source declared by a future freeze');
  edit(collector, '// exact old collector');
  commit();
  rmSync(path.join(root, deleted));
  const head = commit();
  const tree = git('rev-parse', 'HEAD^{tree}');
  const current = freezeAcceptedSource(root, { id: 'current', branch, worktree: root });
  const originalFile = path.join(root, '.git/task-delivery/current/accepted-source.json');
  const meta = JSON.parse(git('show', '-s', '--format=%B', current.commit).split('\n').slice(1).join('\n'));
  function freeze(id, declared) {
    const entries = sourceEntries(root, tree, true).filter(({ file }) => declared.has(file));
    const message =
      'zdm-accepted-source-v1\n' +
      JSON.stringify({
        ...meta,
        batch: id,
        protectedPaths: entries.map(({ file }) => file),
      });
    const commit = acceptedGit(root, ['commit-tree', tree, '-p', head], { input: message + '\n' });
    git('update-ref', 'refs/zdm/accepted/' + id, commit);
    const directory = path.join(root, '.git/task-delivery', id);
    mkdirSync(directory);
    const file = path.join(directory, 'accepted-source.json');
    writeFileSync(
      file,
      JSON.stringify({
        ...JSON.parse(readFileSync(originalFile)),
        batch: id,
        commit,
        businessDigest: sha(JSON.stringify(entries)),
        messageDigest: sha(message),
      }),
    );
    return { commit, file };
  }
  const legacy = freeze('legacy', new Set(meta.protectedPaths.filter((file) => file !== tracked)));
  const future = freeze('future', new Set([...meta.protectedPaths, futurePath]));
  return { root, head, tree, git, edit, commit, legacy, current, future };
}

test('canonical consumer verification accepts old, current and later declared protected paths', (t) => {
  const f = fixture(t);
  for (const id of ['legacy', 'current', 'future'])
    assert.equal(verifyReferenceConsumerSource(f.root, id, f.head, f.tree).accepted, f[id].commit);
  f.edit('src/business.mjs', '// dirty candidate');
  assert.throws(() => verifyReferenceConsumerSource(f.root, 'current', f.head, f.tree), /became dirty/);
});

for (const [file, content, id] of [
  ['src/business.mjs', 'tampered', 'legacy'],
  [deleted, 'restored without review', 'current'],
  [tracked, null, 'legacy'],
  [tracked, 'tampered later source', 'current'],
  [futurePath, 'tampered future source', 'future'],
]) {
  test('candidate proof preserves exact frozen content and absence: ' + file + ' ' + id, (t) => {
    const f = fixture(t);
    if (content === null) rmSync(path.join(f.root, file));
    else f.edit(file, content);
    const changed = f.commit();
    const tree = f.git('rev-parse', 'HEAD^{tree}');
    assert.throws(
      () => verifyReferenceConsumerSource(f.root, id, changed, tree),
      /differs from accepted local snapshot/,
    );
    assert.throws(() => verifyReferenceConsumerSource(f.root, id, f.head, f.tree), /Consumer candidate moved/);
    assert.equal(readAcceptance(f.root, id).commit, f[id].commit);
  });
}

test('unknown or altered freeze metadata remains rejected', (t) => {
  const f = fixture(t);
  const original = JSON.parse(readFileSync(f.future.file, 'utf8'));
  writeFileSync(f.future.file, JSON.stringify({ ...original, version: 2 }));
  assert.throws(() => verifyReferenceConsumerSource(f.root, 'future', f.head, f.tree), { code: 'ERR_ASSERTION' });
  writeFileSync(f.future.file, JSON.stringify({ ...original, businessDigest: '0'.repeat(64) }));
  assert.throws(
    () => verifyReferenceConsumerSource(f.root, 'future', f.head, f.tree),
    /Frozen protected source digest changed/,
  );
});

function repair(t) {
  const f = fixture(t);
  f.edit('src/later-published.mjs', '// unrelated but already published change');
  const base = f.commit();
  f.edit(collector, '// current verifier');
  const first = f.commit();
  f.edit(host, '// independent reviewed host');
  const head = f.commit();
  const task = { checkpoints: [{ commit: first }, { commit: head }] };
  const ok = (candidate = head) => assertReferenceRepairTree(f.git, task, base, candidate, f.head);
  return { ...f, originalMain: f.head, base, first, head, task, ok };
}

test('maintenance may extend a later published base using only owned linear repair commits', (t) => {
  const f = repair(t);
  assert.deepEqual(f.ok(), [collector, host]);
  f.task.checkpoints.shift();
  assert.throws(() => f.ok(), /Unregistered repair commit/);
});

test('later restoration does not hide an unrelated intermediate change or mode change', (t) => {
  const f = repair(t);
  f.edit('src/business.mjs', '// escaped scope');
  const outside = f.commit();
  f.edit('src/business.mjs', '// frozen business');
  const restored = f.commit();
  f.task.checkpoints.push({ commit: outside }, { commit: restored });
  assert.throws(() => f.ok(restored), /Unapproved repair path/);
  f.git('checkout', '--detach', f.head);
  chmodSync(path.join(f.root, collector), 0o755);
  const mode = f.commit();
  f.task.checkpoints.push({ commit: mode });
  assert.throws(() => f.ok(mode), /removed or changed mode/);
});

test('approval and reentry bind both PR sides and refuse a foreign merge or missing original intent', (t) => {
  const f = repair(t);
  const grant = {
    head: f.head,
    base: f.base,
    pr: 177,
    prRun: '1234',
    hostDigest: 'a'.repeat(64),
    failureDigest: 'b'.repeat(64),
  };
  assert.equal(
    referenceRepairApproval(grant),
    ['引用修复发布批准 187 PR #177', f.head, f.base, 'CI 1234 宿主', 'a'.repeat(64), '初败', 'b'.repeat(64)].join(' '),
  );
  const open = { state: 'open', base: { sha: f.base } };
  assert.doesNotThrow(() => assertReferenceRepairStart(f.git, open, grant, { local: f.base, remote: f.base }));
  assert.throws(() => assertReferenceRepairStart(f.git, open, grant, { local: f.base, remote: f.head }), /main moved/);
  f.git('checkout', '-b', 'main', f.base);
  f.git('merge', '--no-ff', 'codex/synthetic', '-m', 'protected fixture merge');
  const main = f.git('rev-parse', 'HEAD');
  const merged = { state: 'closed', merged: true, merge_commit_sha: main };
  assert.throws(
    () => assertReferenceRepairStart(f.git, merged, grant, { local: f.base, remote: main }),
    /original intent/,
  );
  assert.doesNotThrow(() =>
    assertReferenceRepairStart(f.git, merged, grant, { local: f.base, remote: main, prior: { grant } }),
  );
  assert.throws(
    () =>
      assertReferenceRepairStart(f.git, merged, grant, {
        local: f.base,
        remote: main,
        prior: { grant: { ...grant, pr: 178 } },
      }),
    /intent changed/,
  );
  assert.throws(() => assertReferenceRepairMerge(f.git, merged, { ...grant, head: f.first }, main));
});

test('approval must be an independent native observation for this exact candidate and host digest', () => {
  const task = { owner: 'executor', monitoring: { worker: 'executor' } };
  const coordination = { current: { rootThreadId: 'coordinator' } };
  const grant = {
    head: '1'.repeat(40),
    base: '2'.repeat(40),
    pr: 199,
    prRun: '456',
    hostDigest: '3'.repeat(64),
    failureDigest: '4'.repeat(64),
  };
  grant.review = {
    provider: 'codex-native-read_thread',
    threadId: 'coordinator',
    turnId: 'turn',
    observedAt: new Date().toISOString(),
    message: { id: 'message', phase: 'commentary', text: referenceRepairApproval(grant) },
  };
  assert.doesNotThrow(() => assertReferenceRepairReview(grant, task, coordination));
  assert.throws(
    () => assertReferenceRepairReview({ ...grant, head: '5'.repeat(40) }, task, coordination),
    /Exact independent approval required/,
  );
  assert.throws(
    () => assertReferenceRepairReview({ ...grant, hostDigest: '6'.repeat(64) }, task, coordination),
    /Exact independent approval required/,
  );
  grant.review.threadId = task.owner;
  assert.throws(() => assertReferenceRepairReview(grant, task, { current: { rootThreadId: task.owner } }));
});

test('the full approval gate accepts exact preparation and refuses another coordinator', () => {
  const id = 'historical-acceptance-postmerge-recovery-590';
  const branch = 'codex/' + id;
  const original = {
    head: '8342a2122c73925b3e9e2e3b64caa82dde0f7fbb',
    main: '879bd045eb6b104e7417b90771b64141ca0d74c6',
    pr: 166,
    prRun: '44907343460',
    mainRun: '44909383673',
  };
  const accepted = '38ae5a147c8c7fec7f0239866a6de81953116f98';
  const failureDigest = '4d8350038f38e318b525ab3fcded8e254d210c807bbad476ffa99279ee195462';
  const grant = {
    version: 1,
    task: id,
    accepted,
    pr: 199,
    prRun: '456',
    head: '1'.repeat(40),
    base: original.main,
    hostDigest: '3'.repeat(64),
    failureDigest,
    preparation: '66bb58e4-a03d-4d9d-88f3-ce08fd454748',
  };
  const coordinator = 'synthetic-coordinator',
    owner = 'synthetic-executor';
  grant.review = {
    provider: 'codex-native-read_thread',
    threadId: coordinator,
    turnId: 'review-turn',
    observedAt: new Date().toISOString(),
    message: { id: 'review-message', phase: 'commentary', text: referenceRepairApproval(grant) },
  };
  const prepared = (entry) => ({
    version: 1,
    task: id,
    accepted,
    head: entry.head,
    pullRequest: entry.pr,
    runId: entry.prRun,
  });
  const ci = (head, runId, branch, eventName) => ({
    name: 'ci',
    status: 'success',
    key: head + ':' + runId,
    result: {
      runId,
      headSha: head,
      attempt: 1,
      conclusion: 'success',
      branch,
      eventName,
      jobs: ['Frontend quality', 'Backend quality'].map((name) => ({
        name,
        status: 'completed',
        conclusion: 'success',
      })),
    },
  });
  const decision = {
    id: grant.preparation,
    status: 'finished',
    coordinator,
    input: { expectedCoordinationRevision: 9, task: id, owner, executor: owner, phase: 'preparation' },
    prepared: prepared(grant),
  };
  const opts = {
    grant,
    failureDigest,
    assertQuality: assertCompletionQuality,
    task: { id, branch, owner, recordedHead: grant.head, frozen: { accepted }, monitoring: { worker: owner } },
    coordination: { revision: 9, current: { rootThreadId: coordinator } },
    order: { dynamicDecisions: [decision] },
    state: {
      preparedCandidates: [prepared(original), prepared(grant)],
      events: [
        ci(original.head, original.prRun, branch, 'pull_request'),
        ci(original.main, original.mainRun, 'main', 'push'),
        ci(grant.head, grant.prRun, branch, 'pull_request'),
      ],
    },
  };
  assert.doesNotThrow(() => checkApproval(opts));
  decision.coordinator = 'another-coordinator';
  assert.throws(() => checkApproval(opts), /Preparation belongs to another coordinator/);
  decision.coordinator = coordinator;
  assert.throws(() => checkApproval({ ...opts, failureDigest: '5'.repeat(64) }), /First failure log differs/);
});

test('latest independent main can enter only as the independently recomputed clean composition', (t) => {
  const f = repair(t);
  f.git('checkout', '-b', 'later-main', f.base);
  f.edit('src/independent.mjs', '// independently published source');
  const later = f.commit();
  f.git('checkout', 'codex/synthetic');
  f.git('merge', '--no-ff', later, '-m', 'combine approved latest main');
  const combined = f.git('rev-parse', 'HEAD');
  f.task.checkpoints.push({ commit: combined });
  const verify = (head) => assertReferenceRepairTree(f.git, f.task, later, head, f.originalMain);
  assert.deepEqual(verify(combined), [collector, host]);
  f.edit(collector, '// manually changed merge result');
  f.git('add', '--all');
  const mutated = acceptedGit(f.root, ['commit-tree', f.git('write-tree'), '-p', f.head, '-p', later], {
    input: 'unreviewed merge result\n',
  });
  f.task.checkpoints.push({ commit: mutated });
  assert.throws(() => verify(mutated), /differs from the exact clean Git merge/);
});
