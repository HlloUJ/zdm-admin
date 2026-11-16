import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateNpmAuditRegistration, verifyNpmPackageTree } from './delivery-repairs/task-cleanup-npm-proof.mjs';

export const E2E_CLEANUP_DIRECTORY = '.task-runtime/e2e-app';
export const CREATED_CLEANUP_DIRECTORY = '.task-runtime/cleanup-created';
export const FIXTURE_TEMPLATE_DIRECTORY = 'scripts/test-support/cleanup-templates/';
const HEX = /^[a-f0-9]{64}$/;
export const cleanupDataDigest = (value) => createHash('sha256').update(value).digest('hex');
export const cleanupJsonDigest = (value) => cleanupDataDigest(JSON.stringify(value));
function preservedFile(file) {
  assert.ok(path.isAbsolute(file) && path.resolve(file) === file);
  for (let p = file; ; p = path.dirname(p)) {
    assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked preservation source refused');
    if (p === path.dirname(p)) break;
  }
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077), 'Owner-only private preserved file required');
  return stat;
}
export function validatePreservedDuplicate(record, registration, common) {
  assert.ok(
    ['test-results', 'playwright-report', 'coverage'].includes(registration.relative),
    'Only known extra report roots may be duplicates',
  );
  assert.equal(registration.producer, 'preserved-report-duplicate-v1');
  const proof = registration.preservation;
  assert.match(proof?.digest ?? '', HEX);
  assert.equal(registration.sourceDigest, proof.digest);
  const base = path.join(common, 'task-assets', record.task);
  assert.equal(proof.manifest, path.join(base, 'assets-' + proof.digest + '.json'));
  preservedFile(proof.manifest);
  const bytes = readFileSync(proof.manifest);
  assert.equal(cleanupDataDigest(bytes), proof.digest, 'Preserved manifest bytes changed');
  const manifest = JSON.parse(bytes);
  assert.ok(Array.isArray(manifest));
  const prefix = registration.relative + '/',
    entries = manifest.filter((e) => typeof e.file === 'string' && e.file.startsWith(prefix));
  assert.ok(entries.length > 0 && entries.length <= 100000);
  assert.ok(Array.isArray(proof.files) && proof.files.length === entries.length);
  assert.equal(new Set(entries.map((e) => e.file)).size, entries.length);
  assert.deepEqual(
    proof.files.map((e) => e.relative),
    entries.map((e) => e.file).sort(),
    'Preserved report selection is not complete',
  );
  const byName = new Map(entries.map((e) => [e.file, e])),
    checked = new Set();
  for (const file of proof.files) {
    assert.deepEqual(Object.keys(file).sort(), ['blob', 'mode', 'relative', 'sha256']);
    cleanupRelative(file.relative);
    const original = byName.get(file.relative);
    assert.ok(original);
    assert.equal(original.kind, 'generated-output');
    assert.match(file.sha256, HEX);
    assert.equal(file.sha256, original.digest);
    assert.ok(Number.isSafeInteger(file.mode) && (file.mode & 0o170000) === 0o100000);
    assert.equal(file.blob, path.join(base, 'blobs', file.sha256));
    const stat = preservedFile(file.blob);
    assert.equal(stat.size, original.bytes);
    if (!checked.has(file.sha256)) {
      assert.equal(cleanupDataDigest(readFileSync(file.blob)), file.sha256, 'Preserved report blob changed');
      checked.add(file.sha256);
    }
  }
  return proof.files;
}
export const gitBlobDigest = (bytes) =>
  createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0'))
    .update(bytes)
    .digest('hex');
export function cleanupRelative(file) {
  assert.ok(
    typeof file === 'string' &&
      file &&
      !path.posix.isAbsolute(file) &&
      path.posix.normalize(file) === file &&
      !file.includes('\\') &&
      !file.split('/').some((p) => !p || p === '.' || p === '..'),
    'Unsafe artifact member path',
  );
  return file;
}
export function cleanupGit(common, ...args) {
  return execFileSync('git', ['--no-replace-objects', '--git-dir', common, ...args], {
    maxBuffer: 192 * 1024 ** 2,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
export function cleanupGitTree(common, head) {
  assert.match(head, /^[a-f0-9]{40}$/);
  return cleanupGit(common, 'ls-tree', '-rz', '--full-tree', head)
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [, mode, type, blob, file] = /^(\d+) (\w+) ([a-f0-9]{40})\t(.+)$/.exec(line) ?? [];
      cleanupRelative(file);
      return { path: file, mode, type, blob };
    });
}
export const e2eCleanupInput = (file) =>
  /^(?:src\/|public\/|tests\/fixtures\/|scripts\/|index\.html$|package(?:-lock)?\.json$|vite(?:\.e2e)?\.config\.(?:js|mjs)$|ci\/e2e-app\.json$|\.env(?:\.|$))/.test(
    file,
  ) &&
  !file.endsWith('.test.mjs') &&
  !['scripts/test-domain-manifest.json', 'scripts/engineering-impact.json'].includes(file);
export const cleanupRegularSources = (entries) =>
  entries
    .map(({ path: file, mode, type, blob }) => {
      assert.ok(
        type === 'blob' && ['100644', '100755'].includes(mode),
        'Linked/submodule source cannot prove an ordinary-file copy',
      );
      return { path: file, mode, blob };
    })
    .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
function sourceInputs(registration, common, head, select) {
  const expected = cleanupRegularSources(cleanupGitTree(common, head).filter((e) => select(e.path)));
  assert.deepEqual(registration.sourceInputs, expected, 'Rebuild input set differs from exact delivered Git object');
  assert.equal(registration.sourceDigest, cleanupJsonDigest(expected), 'Rebuild source digest differs');
  return expected;
}
export function renderCleanupFixture(template, seed) {
  assert.match(seed, /^[a-f0-9]{32}$/);
  assert.equal(template.version, 1);
  assert.equal(template.kind, 'generated-fixture-v1');
  assert.deepEqual(Object.keys(template).sort(), ['files', 'kind', 'version']);
  assert.ok(Array.isArray(template.files) && template.files.length > 0 && template.files.length <= 1000);
  const files = new Map();
  let bytes = 0;
  for (const file of template.files) {
    assert.deepEqual(Object.keys(file).sort(), ['path', 'text']);
    cleanupRelative(file.path);
    assert.match(file.path, /\.(?:mjs|js|ts|json|txt|html|css)$/);
    assert.ok(!file.path.split('/').some((part) => ['.git', 'node_modules', '.task-verification'].includes(part)));
    assert.ok(typeof file.text === 'string' && !file.text.includes('\0') && !/\{\{(?!seed\}\})/.test(file.text));
    assert.ok(!files.has(file.path));
    const data = Buffer.from(file.text.replaceAll('{{seed}}', seed));
    bytes += data.length;
    assert.ok(bytes <= 10 * 1024 ** 2, 'Fixture recipe output exceeds bounded generated text');
    files.set(file.path, { bytes: data, mode: '100644' });
  }
  for (const name of files.keys())
    for (let p = path.posix.dirname(name); p !== '.'; p = path.posix.dirname(p))
      assert.ok(!files.has(p), 'Fixture file/directory paths overlap');
  return files;
}
function fixtureSources(record, registration, common) {
  const recipe = registration.recipe;
  assert.equal(recipe?.version, 1);
  assert.equal(recipe.template.startsWith(FIXTURE_TEMPLATE_DIRECTORY), true);
  cleanupRelative(recipe.template);
  assert.match(recipe.template, /\.json$/);
  const sources = sourceInputs(registration, common, record.proof.head, (file) => file === recipe.template);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].blob, recipe.templateBlob);
  const bytes = cleanupGit(common, 'cat-file', 'blob', recipe.templateBlob);
  assert.ok(bytes.length <= 1024 ** 2);
  return renderCleanupFixture(JSON.parse(bytes), recipe.seed);
}
export function validateCleanupTypeRegistration(record, registration, common, { phase = 'consume' } = {}) {
  assert.equal(registration.version, 1);
  assert.equal(registration.task, record.task);
  assert.equal(registration.worktree, record.proof.worktree);
  assert.deepEqual(registration.identity, record.identity);
  assert.match(registration.sourceDigest, HEX);
  const kind = record.proof.rebuild.kind;
  assert.equal(
    record.disposition,
    kind === 'duplicate-preserved-v1' ? 'preserved-duplicate' : 'rebuildable',
    'Artifact disposition does not match its independent proof type',
  );
  if (kind === 'vite-dist-v1') {
    assert.equal(registration.relative, 'dist');
    assert.equal(registration.producer, 'vite-build-success-v1');
    assert.deepEqual(registration.command, ['npm', 'run', 'build:app']);
    assert.equal(registration.exitCode, 0);
  } else if (kind === 'e2e-test-build-v1') {
    assert.equal(registration.relative, E2E_CLEANUP_DIRECTORY);
    assert.equal(registration.producer, 'e2e-build-success-v1');
    assert.deepEqual(registration.command, [
      'node',
      'node_modules/vite/bin/vite.js',
      'build',
      '--config',
      'vite.e2e.config.mjs',
    ]);
    assert.equal(registration.exitCode, 0);
    for (const field of ['source', 'artifact', 'policy']) assert.match(registration.buildProof?.[field] ?? '', HEX);
    assert.equal(registration.buildProof.version, 1);
    const inputs = sourceInputs(registration, common, record.proof.head, e2eCleanupInput);
    const policy = inputs.find((e) => e.path === 'ci/e2e-app.json');
    assert.ok(policy);
    assert.equal(
      cleanupDataDigest(cleanupGit(common, 'cat-file', 'blob', policy.blob)),
      registration.buildProof.policy,
      'E2E policy proof differs from delivered source',
    );
    assert.ok(
      inputs.some((e) => e.path === 'package-lock.json') && inputs.some((e) => e.path === 'vite.e2e.config.mjs'),
    );
  } else if (kind === 'generated-fixture-v1') {
    assert.equal(registration.producer, 'explicit-fixture-creator-v1');
    assert.match(registration.relative, /^\.task-runtime\/cleanup-created\/fixture\/[a-f0-9-]{36}$/);
    fixtureSources(record, registration, common);
  } else if (kind === 'git-source-copy-v1') {
    assert.equal(registration.producer, 'exact-git-copy-creator-v1');
    assert.match(registration.relative, /^\.task-runtime\/cleanup-created\/source\/[a-f0-9-]{36}$/);
    assert.equal(registration.recipe?.version, 1);
    assert.equal(
      registration.externalSource,
      path.join(
        common,
        'task-cleanup/created-sources',
        record.task,
        path.posix.basename(registration.relative),
        'content',
      ),
      'Foreign external source container',
    );
    cleanupGit(common, 'merge-base', '--is-ancestor', registration.recipe.sourceHead, record.proof.head);
    cleanupGit(common, 'merge-base', '--is-ancestor', registration.recipe.sourceHead, record.proof.main);
    const inputs = sourceInputs(registration, common, registration.recipe.sourceHead, () => true);
    assert.ok(inputs.length > 0 && inputs.length < 100000);
  } else if (kind === 'npm-pristine-package-v1')
    validateNpmAuditRegistration(record, registration, common, { readArchive: phase !== 'handoff' });
  else if (kind === 'duplicate-preserved-v1') validatePreservedDuplicate(record, registration, common);
  else throw Error('No supported rebuild registration: ' + kind);
}
function treeFiles(directory) {
  const files = new Map(),
    directories = new Set(['']);
  let count = 0;
  const walk = (absolute, relative) => {
    const s = lstatSync(absolute);
    assert.ok(++count <= 100000);
    assert.ok(
      !s.isSymbolicLink() && (s.isDirectory() || (s.isFile() && s.nlink === 1)),
      'Linked/shared artifact member refused',
    );
    if (s.isDirectory()) {
      if (relative) directories.add(relative);
      for (const name of readdirSync(absolute).sort())
        walk(path.join(absolute, name), relative ? relative + '/' + name : name);
    } else files.set(relative, { path: absolute, mode: s.mode });
  };
  walk(directory, '');
  return { files, directories };
}
function expectedDirectories(files) {
  const dirs = new Set(['']);
  for (const file of files.keys())
    for (let p = path.posix.dirname(file); p !== '.'; p = path.posix.dirname(p)) dirs.add(p);
  return dirs;
}
// Match the existing hashPaths APP_DIRECTORY alias without moving or altering its proof contract.
export function e2eArtifactDigest(directory) {
  const hash = createHash('sha256');
  const visit = (file, relative) => {
    const s = lstatSync(file);
    assert.ok(!s.isSymbolicLink() && (s.isDirectory() || (s.isFile() && s.nlink === 1)));
    hash.update(JSON.stringify(relative));
    hash.update(String(s.mode));
    if (s.isDirectory())
      for (const name of readdirSync(file).sort()) visit(path.join(file, name), relative + '/' + name);
    else hash.update(cleanupDataDigest(readFileSync(file)));
  };
  visit(directory, E2E_CLEANUP_DIRECTORY);
  return hash.digest('hex');
}
export function validateCleanupExpectedTree(expected, directory, { partial = false } = {}) {
  const actual = treeFiles(directory),
    dirs = expectedDirectories(expected);
  for (const dir of actual.directories) assert.ok(dirs.has(dir), 'Unexpected artifact directory: ' + dir);
  if (!partial) assert.deepEqual([...actual.directories].sort(), [...dirs].sort(), 'Artifact directory set differs');
  for (const [name, file] of actual.files) {
    const entry = expected.get(name);
    assert.ok(entry, 'Unexpected unique artifact file: ' + name);
    const bytes = readFileSync(file.path);
    if (entry.bytes) assert.deepEqual(bytes, entry.bytes, 'Generated fixture content changed');
    else if (entry.sha256)
      assert.equal(cleanupDataDigest(bytes), entry.sha256, 'Report duplicate has unique or modified content');
    else assert.equal(gitBlobDigest(bytes), entry.blob, 'Git source copy contains unique modified bytes');
    if (entry.sha256) assert.equal(file.mode, entry.mode, 'Report duplicate permissions changed');
    else
      assert.equal(
        file.mode & 0o777,
        entry.mode === '100755' ? 0o700 : 0o600,
        'Generated artifact permissions changed',
      );
  }
  if (!partial)
    assert.deepEqual([...actual.files.keys()].sort(), [...expected.keys()].sort(), 'Artifact file set differs');
}
export function validateCleanupTypeContent(record, registration, directory, common, { partial = false } = {}) {
  const kind = record.proof.rebuild.kind;
  if (kind === 'npm-pristine-package-v1') {
    verifyNpmPackageTree(directory, validateNpmAuditRegistration(record, registration, common), { partial });
    return;
  }
  if (kind === 'vite-dist-v1') return;
  if (kind === 'e2e-test-build-v1') {
    if (!partial)
      assert.equal(
        e2eArtifactDigest(directory),
        registration.buildProof.artifact,
        'E2E generated artifact differs from successful build',
      );
    return;
  }
  const expected =
    kind === 'duplicate-preserved-v1'
      ? new Map(
          validatePreservedDuplicate(record, registration, common).map((e) => [
            e.relative.slice(registration.relative.length + 1),
            e,
          ]),
        )
      : kind === 'generated-fixture-v1'
        ? fixtureSources(record, registration, common)
        : new Map(registration.sourceInputs.map((e) => [e.path, e]));
  validateCleanupExpectedTree(expected, directory, { partial });
}
