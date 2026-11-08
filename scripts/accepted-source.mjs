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
  acceptedCompositionTree,
  candidateCompositionTree,
  readAcceptedComposition,
  writeAcceptedComposition,
} from './accepted-source-composition.mjs';
export function acceptedGit(root, args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
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
  assert.equal(digest(JSON.stringify(sourceEntries(root, record.tree))), record.businessDigest);
  return { ...record, protectedPaths: metadata.protectedPaths, developmentState: metadata.developmentState };
}
export function freezeAcceptedSource(root, batch) {
  assert.equal(
    path.resolve(root),
    path.resolve(batch.worktree),
    'Freeze the registered developer worktree, not main or a retained preview',
  );
  const prior = readAcceptance(root, batch.id);
  if (prior) return prior; // Never rebuild a baseline from a repaired candidate.
  assert.equal(acceptedGit(root, ['branch', '--show-current']), batch.branch);
  const head = acceptedGit(root, ['rev-parse', 'HEAD']);
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
  for (const entry of sourceEntries(root, tree)) {
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
      protectedPaths: sourceEntries(root, tree).map((entry) => entry.file),
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
    businessDigest: digest(JSON.stringify(sourceEntries(root, tree))),
    messageDigest: digest(message),
  };
  const file = location(root, batch.id);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  acceptedGit(root, ['update-ref', 'refs/zdm/accepted/' + batch.id, commit, '0'.repeat(40)]);
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
export function prepareAcceptedComposition(root, batch, main) {
  const record = readAcceptance(root, batch);
  assert.ok(record, 'Original accepted source required');
  const head = acceptedGit(root, ['rev-parse', 'HEAD']);
  assertAcceptedSource(root, batch, head);
  const candidateTree = acceptedGit(root, [
    '-c',
    'merge.renames=false',
    'merge-tree',
    '--write-tree',
    main,
    head,
  ]).split('\n')[0];
  const expectedTree = acceptedCompositionTree(root, record.commit, main);
  const changed = sourceDifference(
    sourceEntries(root, expectedTree, false, record.tree, record.protectedPaths),
    sourceEntries(root, candidateTree, false, record.tree, record.protectedPaths),
  );
  assert.deepEqual(
    changed,
    [],
    'Composed candidate changes frozen business content beyond published main: ' + changed.join(', '),
  );
  return writeAcceptedComposition(root, { batch, accepted: record.commit, main, taskHead: head, candidateTree });
}
export function publishAcceptance(root, batch) {
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
  assert.match(accepted, oid);
  assert.match(branch, /^codex\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
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
  assert.ok(Array.isArray(metadata.protectedPaths), 'Accepted protected paths missing');
  const all = new Set(sourceEntries(root, metadata.tree, true).map((entry) => entry.file));
  for (const file of metadata.protectedPaths) {
    assertSourcePath(file);
    assert.ok(all.has(file), 'Declared protected source absent from snapshot');
  }
  const compose = trustedMain && metadata.taskRegistryVersion === 2;
  const expectedTree = compose ? acceptedCompositionTree(root, accepted, trustedMain) : metadata.tree;
  const candidateTree = compose ? candidateCompositionTree(root, candidate, trustedMain) : candidate;
  const changed = sourceDifference(
    sourceEntries(root, expectedTree, false, metadata.tree, metadata.protectedPaths),
    sourceEntries(root, candidateTree, false, metadata.tree, metadata.protectedPaths),
  );
  assert.deepEqual(changed, [], 'Candidate changed accepted business/control-plane content: ' + changed.join(', '));
  return {
    candidate,
    accepted,
    batch,
    businessDigest: digest(JSON.stringify(sourceEntries(root, metadata.tree))),
    ...(compose ? { trustedMain, composedTree: expectedTree, candidateMergeTree: candidateTree } : {}),
  };
}
