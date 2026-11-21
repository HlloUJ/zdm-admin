import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { regularReferenceFile, referenceHash } from './preview-reference-history.mjs';

const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
export const referenceCollectorFiles = Object.freeze([
  'scripts/preview-consumers.mjs',
  'scripts/completion-cli.mjs',
  'scripts/task-completion.mjs',
  'scripts/delivery-repairs/preview-reference-proof.mjs',
  'scripts/delivery-repairs/preview-reference-proof-core.mjs',
  'scripts/delivery-repairs/preview-reference-history.mjs',
  'scripts/delivery-repairs/preview-reference-source.mjs',
  'scripts/delivery-repairs/validation-maintenance-followup.mjs',
  'scripts/delivery-repairs/validation-maintenance-lineage.mjs',
  'scripts/delivery-repairs/validation-recovery-evidence.mjs',
  'scripts/delivery-repairs/preview-docker-directories.mjs',
  'scripts/delivery-repairs/preview-docker-vnode-source.mjs',
]);
export function referenceLoadedFiles(root) {
  return referenceCollectorFiles.map((file) => ({
    file,
    digest: referenceHash(regularReferenceFile(path.join(root, file)).bytes),
  }));
}
export function referencePublishedBaseline(anchor, requested) {
  const selected = requested ?? git(anchor, 'rev-parse', 'HEAD');
  assert.match(selected, /^[a-f0-9]{40}$/, 'Exact published observer SHA required');
  assert.equal(git(anchor, 'rev-parse', selected + '^{commit}'), selected);
  git(anchor, 'merge-base', '--is-ancestor', selected, 'refs/remotes/origin/main');
  return selected;
}
export function assertReferenceHistoricalBaseline(anchor, baseline, checkedAt) {
  assert.ok(Number.isFinite(checkedAt) && checkedAt > 0);
  const records = git(anchor, 'reflog', 'show', '--date=raw', '--format=%H%x00%gD', 'refs/heads/main')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{40})\0refs\/heads\/main@\{(\d+) [+-]\d{4}\}$/);
      assert.ok(match, 'Unrecognized original main reflog');
      return { commit: match[1], changedAt: Number(match[2]) * 1000 };
    });
  const original = records.find((record) => record.changedAt <= checkedAt);
  assert.ok(original, 'Main reflog does not cover the actual native check time');
  assert.equal(original.commit, baseline, 'Historical native check used a different published main');
  assert.equal(git(anchor, 'rev-parse', `main@{${new Date(checkedAt).toISOString()}}`), baseline);
  return { ...original, checkedAt };
}
export function referenceCollectorPublication({ anchor, common, task, candidate, moduleRoot, loadedFiles }) {
  assert.equal(realpathSync(moduleRoot), moduleRoot);
  assert.deepEqual(
    referenceLoadedFiles(moduleRoot),
    loadedFiles,
    'Collector implementation changed since import; use a fresh published entry',
  );
  let commit, kind;
  if (moduleRoot === realpathSync(anchor)) {
    commit = git(anchor, 'rev-parse', 'HEAD');
    assert.equal(
      commit,
      git(anchor, 'rev-parse', 'refs/remotes/origin/main'),
      'Collector is not the current published main',
    );
    assert.equal(git(anchor, 'status', '--porcelain'), '', 'Published collector is dirty');
    assert.equal(git(anchor, 'branch', '--show-current'), 'main');
    kind = 'published-main';
  } else {
    // Only this original bootstrap task has the reviewed first-upgrade grant.
    // Other consumers always use canonical published main, even on old branches.
    assert.equal(
      task.id,
      'sealed-process-journal-host-recovery',
      'Only 520 has the original first-upgrade carrier exception',
    );
    assert.equal(task.kind, 'infrastructure');
    assert.equal(moduleRoot, path.join(common, 'task-delivery', task.id, 'reviewed-control', candidate));
    commit = candidate;
    kind = 'reviewed-520-first-upgrade';
  }
  const publication = { kind, commit, tree: git(anchor, 'rev-parse', commit + '^{tree}'), files: loadedFiles };
  assertReferenceCollectorPublication(anchor, { task: task.id, candidate }, publication);
  return publication;
}
export function assertReferenceCollectorPublication(anchor, consumer, publication) {
  assert.deepEqual(Object.keys(publication).sort(), ['commit', 'files', 'kind', 'tree']);
  assert.match(publication.commit, /^[a-f0-9]{40}$/);
  assert.equal(publication.tree, git(anchor, 'rev-parse', publication.commit + '^{tree}'));
  if (publication.kind === 'published-main')
    git(anchor, 'merge-base', '--is-ancestor', publication.commit, 'refs/remotes/origin/main');
  else {
    assert.equal(publication.kind, 'reviewed-520-first-upgrade');
    assert.equal(consumer.task, 'sealed-process-journal-host-recovery');
    assert.equal(publication.commit, consumer.candidate);
  }
  assert.deepEqual(
    publication.files.map((item) => item.file),
    referenceCollectorFiles,
  );
  for (const item of publication.files) {
    const bytes = execFileSync('git', [
      '--no-replace-objects',
      '-C',
      anchor,
      'show',
      publication.commit + ':' + item.file,
    ]);
    assert.equal(referenceHash(bytes), item.digest, 'Collector source is not the exact Git object: ' + item.file);
  }
  return true;
}
export function assertReferenceConsumerCandidate(root, candidate, tree) {
  assert.equal(
    git(root, 'rev-parse', 'HEAD'),
    candidate,
    'Consumer candidate moved; collect a new public reference-proof for the current exact HEAD and original published baseline, then resume. Keep the old packet.',
  );
  assert.equal(git(root, 'status', '--porcelain'), '', 'Consumer candidate became dirty');
  assert.equal(git(root, 'rev-parse', candidate + '^{tree}'), tree);
}
export function referenceConsumerSnapshot(root) {
  const candidate = git(root, 'rev-parse', 'HEAD'),
    tree = git(root, 'rev-parse', 'HEAD^{tree}');
  assertReferenceConsumerCandidate(root, candidate, tree);
  return { candidate, tree };
}
export function parseReferenceProofArguments(args) {
  const [foreignTask, historyFile, ...flags] = args;
  const forPrepare = flags[0] === '--for-prepare' || flags.at(-1) === '--for-prepare';
  const baseline = forPrepare ? flags.filter((_, index) => index !== flags.indexOf('--for-prepare')) : flags;
  assert.ok(
    foreignTask &&
      historyFile &&
      (!baseline.length || (baseline.length === 2 && baseline[0] === '--published-baseline')),
    'Expected reference-proof <foreign-task-id> <exact-native-history-file> [--published-baseline <full-published-sha>] [--for-prepare]',
  );
  if (baseline.length) assert.match(baseline[1], /^[a-f0-9]{40}$/);
  return {
    foreignTask,
    historyFile,
    publishedBaseline: baseline[1],
    ...(forPrepare ? { effect: 'preparation' } : {}),
  };
}
