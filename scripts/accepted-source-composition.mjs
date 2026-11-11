import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { isTechnicalPath, isNewTechnicalPath, assertSourcePath } from './accepted-source-policy.mjs';
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
} from 'node:fs';
import path from 'node:path';
const SHA = /^[a-f0-9]{40}$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  }).trim();
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
  return { base: metadata.integrationBase, protectedPaths: metadata.protectedPaths };
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
export function acceptedCompositionTree(root, accepted, main) {
  assert.match(accepted, SHA);
  assert.match(main, SHA);
  const { base, protectedPaths } = frozenBase(root, accepted);
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
    for (const file of conflicts) {
      assertSourcePath(file);
      assert.ok(
        isTechnicalPath(file) && !declared.has(file) && (known.has(file) || isNewTechnicalPath(file)),
        'Frozen business/control-plane conflict requires explicit resolution: ' + file,
      );
    }
  }
  return tree;
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
  assert.equal(proof.version, 1);
  assert.equal(proof.batch, batch);
  assert.equal(proof.accepted, accepted);
  assert.equal(
    proof.expectedTree,
    acceptedCompositionTree(root, accepted, proof.main),
    'Composition is not the original freeze plus trusted main',
  );
  return proof;
}
export function writeAcceptedComposition(root, { batch, accepted, main, taskHead, candidateTree }) {
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
  const proof = {
    version: 1,
    batch,
    accepted,
    main,
    taskHead,
    candidateTree,
    expectedTree: acceptedCompositionTree(root, accepted, main),
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
