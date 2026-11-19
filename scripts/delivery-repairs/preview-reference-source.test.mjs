import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  referenceCollectorFiles,
  referenceLoadedFiles,
  referenceCollectorPublication,
  assertReferenceCollectorPublication,
  referencePublishedBaseline,
  assertReferenceHistoricalBaseline,
  referenceConsumerSnapshot,
  assertReferenceConsumerCandidate,
  parseReferenceProofArguments,
} from './preview-reference-source.mjs';
import { verifyPublishedReferenceSnapshot } from './preview-reference-history.mjs';

function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'reference-source-git-'))),
    main = path.join(dir, 'main');
  mkdirSync(main);
  const writable = (root) => {
    for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) writable(path.join(root, e.name));
    chmodSync(root, 0o700);
  };
  t.after(() => {
    writable(dir);
    rmSync(dir, { recursive: true, force: true });
  });
  const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const commit = (root, message, date) => {
    git(root, 'add', '.');
    execFileSync('git', ['-C', root, 'commit', '-m', message], {
      stdio: 'pipe',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    return git(root, 'rev-parse', 'HEAD');
  };
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(main, 'original-observer.txt'), 'original published observer fixture\n');
  const baseline = commit(main, 'original historical main', '2020-01-01T00:00:00Z');
  git(main, 'update-ref', 'refs/remotes/origin/main', baseline);
  const old = path.join(dir, 'old-432');
  git(main, 'worktree', 'add', '-b', 'codex/old-432', old);
  writeFileSync(path.join(old, 'owned-business.txt'), 'original completed consumer');
  const oldHead = commit(old, 'completed old consumer', '2020-01-01T00:00:10Z');
  for (const file of referenceCollectorFiles) {
    mkdirSync(path.dirname(path.join(main, file)), { recursive: true });
    writeFileSync(path.join(main, file), 'published collector identity fixture: ' + file + '\n');
  }
  const advanced = commit(main, 'published collector after historical check', '2020-01-02T00:00:00Z');
  git(main, 'update-ref', 'refs/remotes/origin/main', advanced);
  const other = path.join(dir, 'other-consumer');
  git(main, 'worktree', 'add', '-b', 'codex/other', other);
  writeFileSync(path.join(other, 'other-business.txt'), 'independent task');
  commit(other, 'other candidate', '2020-01-02T00:00:10Z');
  const common = git(main, 'rev-parse', '--absolute-git-dir');
  const published = (
    root = main,
    task = { id: 'old-432', kind: 'infrastructure' },
    candidate = oldHead,
    loadedFiles = referenceLoadedFiles(root),
  ) => referenceCollectorPublication({ anchor: main, common, task, candidate, moduleRoot: root, loadedFiles });
  return { dir, main, old, other, baseline, advanced, oldHead, common, git, commit, published };
}
test('advanced real main and an old432 consumer without collector files retain separate exact source identities', (t) => {
  const f = fixture(t),
    old = referenceConsumerSnapshot(f.old),
    other = referenceConsumerSnapshot(f.other);
  assert.throws(() =>
    f.git(f.old, 'cat-file', '-e', old.candidate + ':scripts/delivery-repairs/preview-reference-proof.mjs'),
  );
  assert.equal(referencePublishedBaseline(f.main), f.advanced);
  assert.equal(referencePublishedBaseline(f.main, f.baseline), f.baseline);
  const checkedAt = Date.parse('2020-01-01T00:01:00Z');
  assert.equal(assertReferenceHistoricalBaseline(f.main, f.baseline, checkedAt).commit, f.baseline);
  assert.throws(() => assertReferenceHistoricalBaseline(f.main, f.advanced, checkedAt), /different published main/);
  assert.throws(
    () => assertReferenceHistoricalBaseline(f.main, f.baseline, Date.parse('2019-12-31T00:00:00Z')),
    /does not cover/,
  );
  const producer = f.published();
  assert.equal(producer.commit, f.advanced);
  assert.equal(producer.kind, 'published-main');
  const second = f.published(f.main, { id: 'other', kind: 'business' }, other.candidate);
  assert.deepEqual(second, producer);
  assert.notEqual(old.candidate, other.candidate);
  assert.notEqual(old.candidate, producer.commit);
  assertReferenceCollectorPublication(f.main, { task: 'old-432', candidate: old.candidate }, producer);
  assert.throws(() => assertReferenceConsumerCandidate(f.other, old.candidate, old.tree), /candidate moved/);
});
test('different real consumers independently verify the same original published Git observer snapshot', (t) => {
  const f = fixture(t),
    checkedAt = Date.parse('2020-01-01T00:01:00Z'),
    snapshots = [];
  for (const task of ['old-432', 'other']) {
    const directory = path.join(f.common, 'task-delivery', task, 'published-observer', f.baseline);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const original = readFileSync(path.join(f.main, 'original-observer.txt'));
    writeFileSync(path.join(directory, 'original-observer.txt'), original, { mode: 0o444 });
    chmodSync(directory, 0o555);
    const snapshot = verifyPublishedReferenceSnapshot(f.main, directory, f.baseline);
    snapshots.push(snapshot);
    assert.equal(assertReferenceHistoricalBaseline(f.main, snapshot.baseline, checkedAt).commit, f.baseline);
  }
  assert.equal(snapshots[0].tree, snapshots[1].tree);
  assert.notEqual(snapshots[0].directory, snapshots[1].directory);
  assert.throws(() => verifyPublishedReferenceSnapshot(f.main, snapshots[0].directory, f.advanced));
});
test('real composition refuses the old exact consumer binding, then explicit fresh collection metadata retains old bytes', (t) => {
  const f = fixture(t),
    before = referenceConsumerSnapshot(f.old),
    source = f.published();
  const oldBytes = Buffer.from(JSON.stringify({ consumer: before, collector: source, publishedBaseline: f.baseline }));
  const oldFile = path.join(f.common, 'old-selection-fixture.json');
  writeFileSync(oldFile, oldBytes, { mode: 0o600 });
  f.git(f.old, 'merge', '--no-edit', 'main');
  assert.throws(
    () => assertReferenceConsumerCandidate(f.old, before.candidate, before.tree),
    /collect a new public reference-proof/,
  );
  const args = parseReferenceProofArguments([
    'same-old-foreign',
    '/actual-native-history',
    '--published-baseline',
    f.baseline,
  ]);
  const refreshed = {
    consumer: referenceConsumerSnapshot(f.old),
    collector: f.published(f.main, { id: 'old-432', kind: 'infrastructure' }, f.git(f.old, 'rev-parse', 'HEAD')),
    publishedBaseline: args.publishedBaseline,
  };
  const newFile = path.join(f.common, 'new-selection-fixture.json');
  writeFileSync(newFile, JSON.stringify(refreshed), { mode: 0o600 });
  assert.notEqual(refreshed.consumer.candidate, before.candidate);
  assertReferenceConsumerCandidate(f.old, refreshed.consumer.candidate, refreshed.consumer.tree);
  assert.deepEqual(readFileSync(oldFile), oldBytes);
  assert.equal(f.git(f.main, 'rev-parse', 'HEAD'), f.advanced, 'Proof metadata refresh never merges main');
});
test('published collector rejects dirty, changed-after-import, stale and arbitrary candidate implementations', (t) => {
  const f = fixture(t),
    loaded = referenceLoadedFiles(f.main),
    file = path.join(f.main, referenceCollectorFiles[0]);
  writeFileSync(file, 'changed');
  assert.throws(() => f.published(f.main, undefined, undefined, loaded), /changed since import/);
  assert.throws(() => f.published(), /dirty/);
  f.git(f.main, 'restore', referenceCollectorFiles[0]);
  f.git(f.main, 'update-ref', 'refs/remotes/origin/main', f.baseline);
  assert.throws(() => f.published(), /not the current published main/);
  f.git(f.main, 'update-ref', 'refs/remotes/origin/main', f.advanced);
  const copied = path.join(f.common, 'task-delivery/other/reviewed-control', f.git(f.other, 'rev-parse', 'HEAD'));
  for (const relative of referenceCollectorFiles) {
    mkdirSync(path.dirname(path.join(copied, relative)), { recursive: true });
    writeFileSync(path.join(copied, relative), readFileSync(path.join(f.main, relative)));
  }
  assert.throws(
    () => f.published(copied, { id: 'other', kind: 'infrastructure' }, f.git(f.other, 'rev-parse', 'HEAD')),
    /Only 520/,
  );
  const bootstrap = path.join(
    f.common,
    'task-delivery/sealed-process-journal-host-recovery/reviewed-control',
    f.git(f.other, 'rev-parse', 'HEAD'),
  );
  for (const relative of referenceCollectorFiles) {
    mkdirSync(path.dirname(path.join(bootstrap, relative)), { recursive: true });
    writeFileSync(path.join(bootstrap, relative), readFileSync(path.join(f.main, relative)));
  }
  assert.equal(
    f.published(
      bootstrap,
      { id: 'sealed-process-journal-host-recovery', kind: 'infrastructure' },
      f.git(f.other, 'rev-parse', 'HEAD'),
    ).kind,
    'reviewed-520-first-upgrade',
  );
  assert.throws(() => referencePublishedBaseline(f.main, f.oldHead));
});
test('public baseline arguments preserve the old form and reject observer paths, incomplete SHAs and extra adapters', () => {
  assert.deepEqual(parseReferenceProofArguments(['foreign', '/native']), {
    foreignTask: 'foreign',
    historyFile: '/native',
    publishedBaseline: undefined,
  });
  for (const args of [
    ['foreign'],
    ['foreign', '/native', '--published-baseline', 'short'],
    ['foreign', '/native', '--observer', '/file'],
    ['foreign', '/native', '--published-baseline', 'a'.repeat(40), 'safe'],
  ])
    assert.throws(() => parseReferenceProofArguments(args));
});
