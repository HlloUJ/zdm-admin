import { createTaskRegistry } from './task-registry.mjs';
import { assertTaskCommitOwnership } from './task-commit-ownership.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ACCEPTED_SOURCE_VERSION,
  isTechnicalPath,
  isNewTechnicalPath,
  assertSourcePath,
} from './accepted-source-policy.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const oid = /^[a-f0-9]{40}$/;
import {
  acceptedComposition,
  candidateCompositionTree,
  readAcceptedComposition,
  writeAcceptedComposition,
  assertReviewedMergeParents,
  findReviewedMerge,
} from './accepted-source-composition.mjs';
import {
  CONTINUATION_BATCH,
  CONTINUATION_HOOK,
  continuationDelta,
  inspectContinuationCandidate,
  projectAcceptedContinuation,
} from './accepted-source-continuation.mjs';
export function acceptedGit(root, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
    env: { ...(options.env ?? process.env), GIT_NO_REPLACE_OBJECTS: '1' },
  });
  assert.equal(result.status, 0, `Accepted-source Git operation failed: ${args[0]}: ${result.stderr ?? ''}`);
  return args.includes('-z') ? result.stdout : result.stdout.trim();
}
export function sourceEntries(root, tree, technical = false, baselineTree = tree, protectedPaths = []) {
  const declared = new Set(protectedPaths);
  const known = technical ? null : new Set(sourceEntries(root, baselineTree, true).map((entry) => entry.file));
  assert.match(tree, oid);
  return acceptedGit(root, ['ls-tree', '-r', '-z', tree])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t'),
        header = line.slice(0, tab).split(' '),
        file = line.slice(tab + 1);
      assertSourcePath(file);
      assert.equal(header[1], 'blob', 'Submodules require an explicit business freeze adapter');
      return { file, mode: header[0], object: header[2] };
    })
    .filter(
      (entry) =>
        technical ||
        declared.has(entry.file) ||
        !(isTechnicalPath(entry.file) && (known.has(entry.file) || isNewTechnicalPath(entry.file))),
    )
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
function frozenProtectedEntries(root, { tree, protectedPaths }) {
  assert.ok(Array.isArray(protectedPaths), 'Accepted protected paths missing');
  const declared = new Set(protectedPaths);
  assert.equal(declared.size, protectedPaths.length, 'Duplicate accepted protected path');
  for (const file of declared) assertSourcePath(file);
  // A freeze records its own projection. Use today's policy only when checking candidates.
  const entries = sourceEntries(root, tree, true).filter(({ file }) => declared.has(file));
  assert.equal(entries.length, declared.size, 'Declared protected source absent from snapshot');
  return entries;
}
export function sourceDifference(expected, actual) {
  const before = new Map(expected.map((e) => [e.file, e])),
    after = new Map(actual.map((e) => [e.file, e]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((file) => JSON.stringify(before.get(file)) !== JSON.stringify(after.get(file)));
}
export function acceptedRef(batch) {
  assert.match(batch, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  return 'refs/tags/zdm-accepted/' + batch;
}
function location(root, batch) {
  acceptedRef(batch);
  const common = path.resolve(root, acceptedGit(root, ['rev-parse', '--git-common-dir']));
  return path.join(common, 'task-delivery', batch, 'accepted-source.json');
}
export function readAcceptance(root, batch) {
  const file = location(root, batch);
  if (!existsSync(file)) return null;
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Unsafe acceptance record');
  const record = JSON.parse(readFileSync(file));
  assert.equal(record.version, ACCEPTED_SOURCE_VERSION);
  assert.equal(record.batch, batch);
  assert.match(record.commit, oid);
  const frozen = acceptedGit(root, ['rev-parse', 'refs/zdm/accepted/' + batch]);
  assert.equal(frozen, record.commit, 'Acceptance ref changed');
  const message = acceptedGit(root, ['show', '-s', '--format=%B', record.commit]);
  assert.equal(digest(message), record.messageDigest, 'Acceptance identity changed');
  const metadata = JSON.parse(message.replace(/^zdm-accepted-source-v1\n/, ''));
  assert.equal(metadata.batch, batch);
  assert.equal(metadata.branch, record.branch);
  assert.equal(metadata.tree, record.tree);
  assert.equal(acceptedGit(root, ['rev-parse', record.commit + '^{tree}']), record.tree);
  assert.equal(
    digest(JSON.stringify(frozenProtectedEntries(root, metadata))),
    record.businessDigest,
    'Frozen protected source digest changed',
  );
  return { ...record, protectedPaths: metadata.protectedPaths, developmentState: metadata.developmentState };
}
export function freezeAcceptedSource(root, batch) {
  assert.ok(!batch.previewOnly, 'Temporary combined previews cannot be frozen or delivered');
  assert.equal(
    path.resolve(root),
    path.resolve(batch.worktree),
    'Freeze the registered developer worktree, not main or a retained preview',
  );
  const registered = createTaskRegistry(root).readTask(batch.id);
  assert.ok(!registered?.previewOnly, 'Temporary combined previews cannot be frozen or delivered');
  const prior = readAcceptance(root, batch.id);
  if (prior) return prior; // Never rebuild a baseline from a repaired candidate.
  const head = acceptedGit(root, ['rev-parse', 'HEAD']);
  if (batch.taskRegistryVersion === 2) {
    assert.ok(registered, 'Exact registered task required before freeze');
    assertTaskCommitOwnership(root, registered, head);
  }
  assert.equal(acceptedGit(root, ['branch', '--show-current']), batch.branch);
  let integrationBase, originMainAtFreeze;
  if (batch.taskRegistryVersion === 2) {
    assert.match(batch.base, oid, 'Original task integration base required');
    acceptedGit(root, ['merge-base', '--is-ancestor', batch.base, head]);
    originMainAtFreeze = acceptedGit(root, ['rev-parse', 'refs/remotes/origin/main']);
    integrationBase = acceptedGit(root, ['merge-base', head, originMainAtFreeze]);
    acceptedGit(root, ['merge-base', '--is-ancestor', batch.base, integrationBase]);
  }
  const files = acceptedGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
  for (const file of files) {
    assertSourcePath(file);
    assert.ok(
      !/(?:^|\/)(?:\.env(?!\.example$)|.*\.(?:pem|key)$|data-environment\.json$)/i.test(file),
      'Private input cannot enter accepted source',
    );
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'zdm-accepted-index-'));
  let tree;
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
    acceptedGit(root, ['read-tree', head], { env });
    acceptedGit(root, ['add', '--all', '--', '.'], { env });
    tree = acceptedGit(root, ['write-tree'], { env });
    // A second independent index detects edits during the capture window.
    const second = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'second') };
    acceptedGit(root, ['read-tree', head], { env: second });
    acceptedGit(root, ['add', '--all', '--', '.'], { env: second });
    assert.equal(acceptedGit(root, ['write-tree'], { env: second }), tree, 'Local source moved while freezing');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const protectedEntries = sourceEntries(root, tree);
  for (const entry of protectedEntries) {
    assert.ok(['100644', '100755'].includes(entry.mode), 'Business links require an explicit freeze adapter');
    const bytes = readFileSync(path.join(root, entry.file));
    const rawObject = createHash('sha1')
      .update(Buffer.from('blob ' + bytes.length + '\0'))
      .update(bytes)
      .digest('hex');
    assert.equal(rawObject, entry.object, 'Git conversion changed accepted business bytes: ' + entry.file);
  }
  const message =
    'zdm-accepted-source-v1\n' +
    JSON.stringify({
      version: 1,
      batch: batch.id,
      branch: batch.branch,
      parent: head,
      ...(batch.taskRegistryVersion === 2
        ? { taskRegistryVersion: 2, integrationBase, originalTaskBase: batch.base, originMainAtFreeze }
        : {}),
      tree,
      protectedPaths: protectedEntries.map((entry) => entry.file),
      developmentState: (batch.modules ?? []).map(({ id, status, dependsOn }) => ({
        id,
        status,
        dependsOn: dependsOn ?? [],
      })),
    });
  const commit = acceptedGit(root, ['commit-tree', tree, '-p', head], { input: message + '\n' });
  const record = {
    version: 1,
    batch: batch.id,
    branch: batch.branch,
    commit,
    tree,
    businessDigest: digest(JSON.stringify(protectedEntries)),
    messageDigest: digest(message),
  };
  const file = location(root, batch.id);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  assert.equal(acceptedGit(root, ['rev-parse', 'HEAD']), head, 'Source HEAD moved while freezing');
  assert.equal(acceptedGit(root, ['branch', '--show-current']), batch.branch, 'Source branch moved while freezing');
  acceptedGit(root, ['update-ref', '--stdin'], {
    input: `start\nverify HEAD ${head}\nupdate refs/zdm/accepted/${batch.id} ${commit} ${'0'.repeat(40)}\nprepare\ncommit\n`,
  });
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  return readAcceptance(root, batch.id);
}
export function assertAcceptedSource(root, batch, candidate) {
  const record = readAcceptance(root, batch);
  assert.ok(record, 'Accepted local business snapshot missing; freeze before technical repairs');
  const composition = readAcceptedComposition(root, batch, record.commit);
  const expectedTree = composition?.expectedTree ?? record.tree;
  const changed = sourceDifference(
    sourceEntries(root, expectedTree, false, record.tree, record.protectedPaths),
    sourceEntries(root, candidate, false, record.tree, record.protectedPaths),
  );
  assert.deepEqual(
    changed,
    [],
    'Business/control-plane content differs from accepted local snapshot: ' + changed.join(', '),
  );
  return {
    batch,
    accepted: record.commit,
    businessDigest: record.businessDigest,
    candidate,
    ...(composition ? { composition } : {}),
  };
}
function assertComposedSource(root, record, expected, candidate, label) {
  const changed = sourceDifference(
    sourceEntries(root, expected, false, record.tree, record.protectedPaths),
    sourceEntries(root, candidate, false, record.tree, record.protectedPaths),
  );
  assert.deepEqual(changed, [], label + ': ' + changed.join(', '));
}

function reviewContinuationTree(root, batch, reviewedTree, reviewedBase) {
  assert.equal(batch, CONTINUATION_BATCH, 'Task outside the authorized continuation scope');
  const record = readAcceptance(root, batch);
  assert.ok(record, 'Continuation requires the unchanged original acceptance');
  assert.equal(record.branch, 'codex/' + batch, 'Original acceptance belongs to a different branch');
  const expected = acceptedComposition(root, record.commit, reviewedBase);
  assert.ok(expected.review, 'Exact published protected-conflict review required');
  const protectedEntries = (tree) => sourceEntries(root, tree, false, record.tree, record.protectedPaths);
  const baseProjection = protectedEntries(expected.tree);
  const hook = protectedEntries(reviewedBase).find(({ file }) => file === CONTINUATION_HOOK);
  assert.equal(hook?.mode, '100644', 'Original trusted hook required');
  assert.ok(
    baseProjection.some(({ file }) => file === CONTINUATION_HOOK),
    'Original hook protection missing',
  );
  const expectedProjection = baseProjection.map((entry) => (entry.file === CONTINUATION_HOOK ? hook : entry));
  const changes = sourceDifference(expectedProjection, protectedEntries(reviewedTree));
  assert.deepEqual(changes, [], 'Continuation differs from the original protected projection: ' + changes.join(', '));
  const present = new Set(expectedProjection.map(({ file }) => file));
  const { integrationBase } = JSON.parse(acceptedGit(root, ['cat-file', 'blob', expected.review.blob]));
  const originallyProtected = protectedEntries(integrationBase).map(({ file }) => file);
  const deleted = [...new Set([...originallyProtected, ...record.protectedPaths])]
    .filter((file) => !present.has(file))
    .sort();
  return {
    version: 1,
    batch,
    accepted: record.commit,
    reviewedBase,
    reviewedTree,
    review: expected.review.blob,
    hook: hook.object,
    originalBusinessDigest: record.businessDigest,
    protectedDigest: digest(JSON.stringify(expectedProjection)),
    protectedDeletionDigest: digest(JSON.stringify(deleted)),
    delta: continuationDelta(root, reviewedBase, reviewedTree),
  };
}

// This discovery step is private. Only the independently reviewed record
// published on main can authorize a candidate at either completion gate.
export function reviewLocalAcceptedContinuation(root, batch, candidate, reviewedBase) {
  return reviewContinuationTree(root, batch, inspectContinuationCandidate(root, candidate, reviewedBase), reviewedBase);
}

export function verifyLocalAcceptedContinuation(root, batch, candidate, trustedMain) {
  assert.equal(batch, CONTINUATION_BATCH, 'Task outside the authorized continuation scope');
  const tree = inspectContinuationCandidate(root, candidate, trustedMain);
  const projection = projectAcceptedContinuation(root, trustedMain);
  const reviewed = reviewContinuationTree(root, batch, projection.reviewedTree, projection.record.reviewedBase);
  assert.deepEqual(projection.record, reviewed, 'Published continuation differs from the original private review');
  assert.equal(tree, projection.tree, 'Candidate tree differs from the published continuation');
  return { batch, accepted: reviewed.accepted, trustedMain, candidate, tree, review: projection.recordBlob };
}

export function prepareAcceptedComposition(root, batch, main, candidateCommit) {
  const record = readAcceptance(root, batch);
  assert.ok(record, 'Original accepted source required');
  const head = acceptedGit(root, ['rev-parse', 'HEAD']);
  assertAcceptedSource(root, batch, head);
  const expected = acceptedComposition(root, record.commit, main);
  if (candidateCommit !== undefined) {
    assert.ok(expected.review, 'No protected conflict has a trusted review');
    assertReviewedMergeParents(root, candidateCommit, main, expected.frozenParent, head);
  }
  const candidateTree = candidateCompositionTree(root, candidateCommit ?? head, main);
  assertComposedSource(
    root,
    record,
    expected.tree,
    candidateTree,
    'Composed candidate changes frozen business content beyond published main',
  );
  return writeAcceptedComposition(root, {
    batch,
    accepted: record.commit,
    main,
    taskHead: head,
    candidateTree,
    candidateCommit,
  });
}
export function publishAcceptance(root, batch) {
  assert.notEqual(
    batch,
    CONTINUATION_BATCH,
    'This continuation must use the published review; retain its private acceptance',
  );
  const record = readAcceptance(root, batch);
  assert.ok(record, 'Missing acceptance');
  const ref = acceptedRef(record.branch.slice('codex/'.length)),
    remote = acceptedGit(root, ['ls-remote', 'origin', ref]);
  if (remote) assert.equal(remote.split(/\s/)[0], record.commit, 'Remote acceptance is immutable; never replace it');
  else acceptedGit(root, ['push', 'origin', record.commit + ':' + ref]);
  assert.equal(acceptedGit(root, ['ls-remote', 'origin', ref]).split(/\s/)[0], record.commit);
  return { ref, commit: record.commit };
}

// Execute only from a trusted checkout (never import the candidate's verifier in CI).
export function verifyRemoteAcceptance(root, { candidate, accepted, branch, trustedMain }) {
  assert.match(candidate, oid);
  assert.match(branch, /^codex\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
  if (branch === 'codex/' + CONTINUATION_BATCH) {
    const tree = inspectContinuationCandidate(root, candidate, trustedMain);
    const { record, recordBlob, tree: expected } = projectAcceptedContinuation(root, trustedMain);
    if (accepted !== undefined) assert.equal(accepted, record.accepted, 'Continuation acceptance changed');
    assert.equal(tree, expected, 'Candidate tree differs from the published continuation');
    const mergeTree = candidateCompositionTree(root, candidate, trustedMain);
    assert.equal(mergeTree, expected, 'Actual PR merge tree differs from the published continuation');
    return {
      candidate,
      accepted: record.accepted,
      batch: record.batch,
      trustedMain,
      candidateMergeTree: mergeTree,
      continuationReview: recordBlob,
    };
  }
  assert.match(accepted, oid);
  const message = acceptedGit(root, ['show', '-s', '--format=%B', accepted]);
  assert.ok(message.startsWith('zdm-accepted-source-v1\n'), 'Unrecognized acceptance');
  const metadata = JSON.parse(message.slice('zdm-accepted-source-v1\n'.length));
  assert.equal(metadata.version, ACCEPTED_SOURCE_VERSION);
  const batch = metadata.batch;
  acceptedRef(batch);
  assert.equal(metadata.branch, branch);
  assert.match(metadata.parent, oid);
  assert.match(metadata.tree, oid);
  assert.equal(acceptedGit(root, ['rev-parse', accepted + '^{tree}']), metadata.tree);
  assert.equal(acceptedGit(root, ['show', '-s', '--format=%P', accepted]), metadata.parent);
  acceptedGit(root, ['merge-base', '--is-ancestor', metadata.parent, candidate]);
  if (trustedMain) assert.match(trustedMain, oid);
  const protectedEntries = frozenProtectedEntries(root, metadata);
  const compose = trustedMain && metadata.taskRegistryVersion === 2;
  const expected = compose ? acceptedComposition(root, accepted, trustedMain) : { tree: metadata.tree };
  const candidateTree = compose ? candidateCompositionTree(root, candidate, trustedMain) : candidate;
  assertComposedSource(
    root,
    metadata,
    expected.tree,
    candidateTree,
    'Candidate changed accepted business/control-plane content',
  );
  let reviewedMerge;
  if (expected.review) {
    const { tree, ...merge } = findReviewedMerge(root, candidate, trustedMain, accepted, expected);
    assertComposedSource(root, metadata, tree, merge.commit, 'Reviewed merge changed protected content');
    reviewedMerge = merge;
  }
  return {
    candidate,
    accepted,
    batch,
    businessDigest: digest(JSON.stringify(protectedEntries)),
    ...(compose ? { trustedMain, composedTree: expected.tree, candidateMergeTree: candidateTree } : {}),
    ...(reviewedMerge ? { reviewedMerge, review: expected.review } : {}),
  };
}
