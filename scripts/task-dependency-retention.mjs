import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export function dependencyTreeDigest(directory) {
  const hash = createHash('sha256');
  function visit(file, relative) {
    const stat = lstatSync(file);
    hash.update(JSON.stringify([relative, stat.mode]));
    if (stat.isSymbolicLink())
      hash.update(readlinkSync(file)); // Never follow dependency links.
    else if (stat.isDirectory())
      for (const name of readdirSync(file).sort()) visit(path.join(file, name), relative + '/' + name);
    else {
      assert.ok(stat.isFile(), 'Unknown dependency asset type; retain original');
      hash.update(readFileSync(file));
    }
  }
  assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  visit(directory, 'node_modules');
  return hash.digest('hex');
}
export function retainTaskDependencies(root, destination) {
  const source = path.join(root, 'node_modules'),
    retained = path.join(destination, 'private-dependencies');
  assert.equal(lstatSync(destination).mode & 0o077, 0, 'Dependency retention must be owner-only');
  const intentFile = path.join(destination, 'dependency-retention.json');
  if (!existsSync(source) && existsSync(retained)) {
    assert.ok(lstatSync(intentFile).isFile() && !lstatSync(intentFile).isSymbolicLink());
    const intent = JSON.parse(readFileSync(intentFile));
    assert.equal(intent.source, source);
    assert.equal(intent.digest, dependencyTreeDigest(retained), 'Interrupted dependency retention changed');
    return { file: 'node_modules', kind: 'private-dependencies-retained', digest: intent.digest };
  }
  if (lstatSync(source).isSymbolicLink()) {
    assert.equal(realpathSync(source), retained, 'Cannot adopt an unknown dependency link');
    return { file: 'node_modules', kind: 'private-dependencies-retained', digest: dependencyTreeDigest(retained) };
  }
  assert.ok(!existsSync(retained), 'Previously retained dependencies exist; do not replace them');
  const digest = dependencyTreeDigest(source);
  const intent = JSON.stringify({ source, digest }) + '\n';
  if (existsSync(intentFile)) {
    assert.ok(!lstatSync(intentFile).isSymbolicLink());
    assert.equal(readFileSync(intentFile, 'utf8'), intent, 'Dependency retention intent changed');
  } else writeFileSync(intentFile, intent, { flag: 'wx', mode: 0o600 });
  renameSync(source, retained); // Preserve the entire directory, including unknown package-local files.
  // No source link is needed after handoff. Leaving a node_modules symlink can
  // become an untracked Git path when .gitignore uses node_modules/.
  assert.equal(dependencyTreeDigest(retained), digest, 'Dependency contents changed during retention');
  return { file: 'node_modules', kind: 'private-dependencies-retained', digest };
}
export function verifyRetainedDependencies(entry, destination) {
  assert.equal(entry.file, 'node_modules');
  assert.match(entry.digest, /^[a-f0-9]{64}$/);
  assert.equal(
    dependencyTreeDigest(path.join(destination, 'private-dependencies')),
    entry.digest,
    'Retained dependencies changed',
  );
}
