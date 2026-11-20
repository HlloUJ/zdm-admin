import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  isTechnicalPath,
  isNewTechnicalPath,
  isAcceptedSourceControlPath,
  assertSourcePath,
} from './accepted-source-policy.mjs';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  realpathSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
const SHA = /^[a-f0-9]{40}$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reviewDirectory = '.codex/accepted-source-conflict-reviews';
const rawGit = (root, args, options = {}) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
const git = (root, ...args) => rawGit(root, args).trim();
function safe(file) {
  if (existsSync(file)) assert.ok(!lstatSync(file).isSymbolicLink(), 'Linked composition proof is unsafe');
}
function location(root, batch) {
  assert.match(batch, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const common = realpathSync(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')));
  const directory = path.join(common, 'task-delivery', batch);
  for (const entry of [path.dirname(directory), directory, path.join(directory, 'compositions')]) safe(entry);
  return directory;
}
function frozenBase(root, accepted) {
  const message = git(root, 'show', '-s', '--format=%B', accepted);
  assert.ok(message.startsWith('zdm-accepted-source-v1\n'));
  const metadata = JSON.parse(message.slice('zdm-accepted-source-v1\n'.length));
  assert.equal(
    metadata.taskRegistryVersion,
    2,
    'Legacy frozen sources require their original reviewed recovery; no inferred composition base',
  );
  assert.match(metadata.integrationBase, SHA);
  assert.match(metadata.originalTaskBase, SHA);
  assert.match(metadata.originMainAtFreeze, SHA);
  git(root, 'merge-base', '--is-ancestor', metadata.originalTaskBase, metadata.integrationBase);
  git(root, 'merge-base', '--is-ancestor', metadata.integrationBase, metadata.originMainAtFreeze);
  git(root, 'merge-base', '--is-ancestor', metadata.integrationBase, metadata.parent);
  return {
    base: metadata.integrationBase,
    batch: metadata.batch,
    parent: metadata.parent,
    protectedPaths: metadata.protectedPaths,
  };
}
export function candidateCompositionTree(root, candidate, main) {
  assert.match(candidate, SHA);
  assert.match(main, SHA);
  assert.equal(git(root, 'cat-file', '-t', candidate), 'commit');
  assert.equal(git(root, 'cat-file', '-t', main), 'commit');
  const tree = git(root, '-c', 'merge.renames=false', 'merge-tree', '--write-tree', main, candidate).split('\n')[0];
  assert.match(tree, SHA);
  return tree;
}
function regularBlob(root, commit, file, required = true) {
  const entry = rawGit(root, ['--literal-pathspecs', 'ls-tree', '-z', commit, '--', file]);
  if (!entry && !required) return null;
  const match = /^100644 blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(entry);
  assert.equal(match?.[2], file, 'Reviewed conflict requires an existing regular file at ' + file);
  return match[1];
}

// Only the exact trusted main tree may supply a review. The candidate's
// worktree, refs, objects named in its text and local proof files cannot do so.
function applyAcceptedConflictReview(root, { batch, accepted, main, base, tree, conflicts, protectedPaths }) {
  assert.match(batch, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const reviewPath = reviewDirectory + '/' + batch + '.json';
  for (const file of conflicts) {
    assert.ok(
      protectedPaths.has(file) && !isAcceptedSourceControlPath(file) && !file.startsWith(reviewDirectory + '/'),
      'Frozen business/control-plane conflict requires explicit resolution: ' + file,
    );
  }
  const reviewBlob = regularBlob(root, main, reviewPath, false);
  assert.ok(
    reviewBlob,
    'Frozen business/control-plane conflict requires a published exact review: ' + conflicts.join(', '),
  );
  const reviewText = rawGit(root, ['cat-file', 'blob', reviewBlob]);
  const review = JSON.parse(reviewText);
  assert.ok([1, 2].includes(review.version), 'Unknown protected conflict review version');
  assert.equal(review.batch, batch);
  assert.equal(review.accepted, accepted, 'Review refers to another original acceptance');
  assert.equal(review.integrationBase, base, 'Review refers to another original integration base');
  assert.match(review.reviewedMain, SHA);
  assert.equal(git(root, 'cat-file', '-t', review.reviewedMain), 'commit');
  rawGit(root, ['merge-base', '--is-ancestor', review.reviewedMain, main]);
  if (review.version === 2) rawGit(root, ['merge-base', '--is-ancestor', base, review.reviewedMain]);
  assert.ok(Array.isArray(review.resolutions));
  assert.deepEqual(
    review.resolutions.map(({ file }) => file).sort(),
    [...conflicts].sort(),
    'Published review must cover exactly the current protected conflicts',
  );
  const replacements = review.resolutions.map(({ file, inputs, result, reason }) => {
    assert.ok(typeof reason === 'string' && reason.trim(), 'Reviewed preservation rationale required for ' + file);
    assertSourcePath(file);
    // Only a v2 review may explicitly declare an absent base. ls-tree still
    // rejects an existing entry of the wrong type or mode on any side.
    const addAdd = review.version === 2 && inputs?.base === null;
    const actual = {
      base: regularBlob(root, base, file, !addAdd),
      frozen: regularBlob(root, accepted, file),
      main: regularBlob(root, main, file),
    };
    assert.deepEqual(inputs, actual, 'Published review inputs changed for ' + file);
    assert.equal(regularBlob(root, review.reviewedMain, file), actual.main, 'Review does not describe published main');
    for (const blob of Object.values(actual)) {
      if (blob === null) continue;
      const bytes = rawGit(root, ['cat-file', 'blob', blob], { encoding: 'buffer' });
      assert.ok(
        !bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes),
        'Binary conflict is unsupported',
      );
    }
    assert.match(result?.object, SHA);
    assert.equal(result.mode, '100644', 'Reviewed conflict cannot change mode or delete a protected file');
    assert.ok(typeof result.text === 'string' && !result.text.includes('\0'), 'Exact reviewed text required');
    const bytes = Buffer.from(result.text);
    assert.equal(bytes.toString('utf8'), result.text, 'Invalid reviewed text');
    assert.equal(
      rawGit(root, ['hash-object', '--stdin'], { input: bytes }).trim(),
      result.object,
      'Published resolution bytes do not match reviewed blob for ' + file,
    );
    return { file, bytes, object: result.object };
  });

  const scratch = mkdtempSync(path.join(tmpdir(), 'zdm-reviewed-source-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    rawGit(root, ['read-tree', tree], { env });
    for (const { file, bytes, object } of replacements) {
      assert.equal(rawGit(root, ['hash-object', '-w', '--stdin'], { input: bytes }).trim(), object);
      rawGit(root, ['update-index', '--cacheinfo', '100644', object, file], { env });
    }
    return {
      tree: rawGit(root, ['write-tree'], { env }).trim(),
      review: { blob: reviewBlob, reviewedMain: review.reviewedMain, files: [...conflicts].sort() },
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function assertReviewedMergeParents(root, commit, main, frozenParent, taskHead) {
  for (const id of [commit, main, frozenParent, taskHead]) assert.match(id, SHA);
  const parents = git(root, 'show', '-s', '--format=%P', commit).split(' ');
  assert.deepEqual(parents, [taskHead, main], 'Reviewed merge must have the exact task and trusted main parents');
  git(root, 'merge-base', '--is-ancestor', frozenParent, taskHead);
}

export function findReviewedMerge(root, candidate, main, accepted, expected) {
  const { frozenParent, review } = expected;
  const { batch } = frozenBase(root, accepted);
  const reviewPath = reviewDirectory + '/' + batch + '.json';
  // The initial composition may be followed by checkpointed engineering
  // commits. Recover the actual merge from first-parent history, not a trailer.
  const history = git(root, 'rev-list', '--first-parent', '--merges', '--parents', frozenParent + '..' + candidate);
  for (const line of history.split('\n').filter(Boolean)) {
    const [merge, first, second, ...extra] = line.split(' ');
    if (extra.length) continue;
    // A PR can enter CI before the final FIFO turn combines a newer main.
    // An earlier second parent still needs the very same published review.
    if (second !== main) {
      if (!git(root, 'merge-base', second, main).split('\n').includes(second)) continue;
      if (regularBlob(root, second, reviewPath, false) !== review.blob) continue;
    }
    const mergeExpected = second === main ? expected : acceptedComposition(root, accepted, second);
    assert.deepEqual(mergeExpected.review, review, 'Reviewed merge does not match the current published review');
    assertReviewedMergeParents(root, merge, second, frozenParent, first);
    return { commit: merge, taskHead: first, main: second, tree: mergeExpected.tree };
  }
  throw Error('Reviewed candidate is missing its exact task and trusted main merge parents');
}

export function acceptedComposition(root, accepted, main) {
  assert.match(accepted, SHA);
  assert.match(main, SHA);
  const { base, batch, parent, protectedPaths } = frozenBase(root, accepted);
  git(root, 'merge-base', '--is-ancestor', base, main);
  const result = spawnSync(
    'git',
    [
      '--no-replace-objects',
      '-C',
      root,
      '-c',
      'merge.renames=false',
      'merge-tree',
      '--write-tree',
      '--name-only',
      '-z',
      '--merge-base=' + base,
      main,
      accepted,
    ],
    { encoding: 'utf8', stdio: 'pipe', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
  );
  assert.ok(!result.error, result.error?.message);
  assert.ok(
    result.status === 0 || result.status === 1,
    'Cannot compose original accepted source: ' + (result.stderr ?? 'unknown Git failure'),
  );
  const [tree, ...records] = result.stdout.split('\0');
  assert.match(tree, SHA, 'Cannot compose original accepted source with published main');
  if (result.status === 1) {
    // Git's conflict tree still contains the exact cleanly merged protected blobs.
    // Only existing policy-exempt conflicts may remain in this comparison tree.
    // It is never a candidate tree: the actual candidate must merge without ANY
    // conflict, and protected bytes/modes/deletions are compared by the callers.
    const end = records.indexOf('');
    assert.ok(end > 0, 'Unclassified source conflict must remain blocked');
    const conflicts = records.slice(0, end);
    assert.ok(Array.isArray(protectedPaths), 'Original protected source paths required');
    protectedPaths.forEach(assertSourcePath);
    const declared = new Set(protectedPaths);
    const known = new Set(git(root, 'ls-tree', '-r', '--name-only', '-z', accepted).split('\0').filter(Boolean));
    const protectedConflicts = conflicts.filter((file) => {
      assertSourcePath(file);
      return !(isTechnicalPath(file) && !declared.has(file) && (known.has(file) || isNewTechnicalPath(file)));
    });
    if (protectedConflicts.length)
      return {
        ...applyAcceptedConflictReview(root, {
          batch,
          accepted,
          main,
          base,
          tree,
          conflicts: protectedConflicts,
          protectedPaths: declared,
        }),
        frozenParent: parent,
      };
  }
  return { tree, frozenParent: parent };
}
export function acceptedCompositionTree(root, accepted, main) {
  return acceptedComposition(root, accepted, main).tree;
}
export function readAcceptedComposition(root, batch, accepted) {
  const directory = location(root, batch),
    pointer = path.join(directory, 'composition.json');
  safe(pointer);
  if (!existsSync(pointer)) return null;
  const reference = JSON.parse(readFileSync(pointer));
  assert.match(reference.proof, /^[a-f0-9]{64}\.json$/, 'Invalid composition proof reference');
  const file = path.join(directory, 'compositions', reference.proof);
  safe(file);
  const bytes = readFileSync(file);
  assert.equal(reference.proof, digest(bytes) + '.json', 'Composition proof changed');
  const proof = JSON.parse(bytes);
  assert.ok([1, 2].includes(proof.version), 'Unrecognized composition proof version');
  assert.equal(proof.batch, batch);
  assert.equal(proof.accepted, accepted);
  const expected = acceptedComposition(root, accepted, proof.main);
  assert.equal(proof.expectedTree, expected.tree, 'Composition is not the original freeze plus trusted main');
  if (proof.version === 2) {
    assert.ok(expected.review, 'Missing reviewed conflict in composition proof');
    assert.deepEqual(proof.review, expected.review, 'Published conflict review changed');
    assertReviewedMergeParents(root, proof.candidateCommit, proof.main, expected.frozenParent, proof.taskHead);
    assert.equal(git(root, 'rev-parse', proof.candidateCommit + '^{tree}'), proof.candidateTree);
  }
  return proof;
}
export function writeAcceptedComposition(root, { batch, accepted, main, taskHead, candidateTree, candidateCommit }) {
  assert.match(taskHead, SHA);
  assert.match(candidateTree, SHA);
  assert.equal(git(root, 'rev-parse', 'HEAD'), taskHead, 'Task moved during composition planning');
  assert.equal(git(root, 'status', '--porcelain'), '', 'Task must be clean before composing main');
  assert.equal(git(root, 'rev-parse', 'origin/main'), main, 'Composition base must be the fetched origin/main');
  assert.equal(
    git(root, 'ls-remote', 'origin', 'refs/heads/main'),
    main + '\trefs/heads/main',
    'Published main changed',
  );
  const previous = readAcceptedComposition(root, batch, accepted);
  if (previous) git(root, 'merge-base', '--is-ancestor', previous.main, main);
  const expected = acceptedComposition(root, accepted, main);
  if (candidateCommit !== undefined) {
    assert.ok(expected.review, 'No protected conflict has a trusted review');
    assertReviewedMergeParents(root, candidateCommit, main, expected.frozenParent, taskHead);
    assert.equal(git(root, 'rev-parse', candidateCommit + '^{tree}'), candidateTree);
  }
  const proof = {
    version: candidateCommit ? 2 : 1,
    batch,
    accepted,
    main,
    taskHead,
    candidateTree,
    expectedTree: expected.tree,
    ...(candidateCommit ? { candidateCommit, review: expected.review } : {}),
    provenance: 'original-immutable-acceptance-and-fresh-origin-main',
  };
  const directory = location(root, batch),
    proofs = path.join(directory, 'compositions');
  mkdirSync(proofs, { recursive: true, mode: 0o700 });
  const bytes = JSON.stringify(proof, null, 2) + '\n',
    name = digest(bytes) + '.json',
    file = path.join(proofs, name);
  safe(file);
  if (existsSync(file)) assert.equal(readFileSync(file, 'utf8'), bytes);
  else writeFileSync(file, bytes, { flag: 'wx', mode: 0o400 });
  const temporary = path.join(directory, 'composition-' + randomUUID() + '.tmp');
  try {
    writeFileSync(temporary, JSON.stringify({ proof: name }) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path.join(directory, 'composition.json'));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return proof;
}
