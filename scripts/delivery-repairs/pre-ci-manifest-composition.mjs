import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertSourcePath, isTechnicalPath } from '../accepted-source-policy.mjs';
import {
  captureReviewedScriptEntries,
  ENGINEERING_EXTRA_INPUTS,
  SCRIPT_INPUT_MANIFEST as manifest,
} from '../script-test-plan.mjs';

const sha = /^[a-f0-9]{40}$/;
const gitArgs = (root, args) => ['--no-replace-objects', '-C', root, ...args];
const options = { encoding: 'utf8', stdio: 'pipe', timeout: 30_000, maxBuffer: 32 * 1024 * 1024 };
const git = (root, args, overrides) => execFileSync('git', gitArgs(root, args), { ...options, ...overrides });

function manifestInputTree(root, tree) {
  const records = git(root, ['ls-tree', '-r', '-z', tree, '--', 'scripts', ...ENGINEERING_EXTRA_INPUTS])
    .split('\0')
    .filter(Boolean);
  const entries = new Map(
    records.map((record) => {
      const [header, file] = record.split('\t');
      const [mode, type, oid] = header.split(' ');
      assertSourcePath(file);
      assert.ok(type === 'blob' && ['100644', '100755'].includes(mode), 'Engineering input must be a regular file');
      assert.match(oid, sha);
      return [file, { mode, oid }];
    }),
  );
  assert.equal(entries.get(manifest)?.mode, '100644', 'Engineering manifest must be an existing regular file');
  assert.ok(
    ENGINEERING_EXTRA_INPUTS.every((file) => entries.has(file)),
    'Missing engineering input in Git tree',
  );

  // Use the published planner to read blobs without checking out or executing the candidate.
  const files = [...entries.keys()].filter((file) => file !== manifest);
  const blobs = git(root, ['cat-file', '--batch'], {
    input: files.map((file) => entries.get(file).oid + '\n').join(''),
    encoding: null,
  });
  let offset = 0;
  const sources = new Map(
    files.map((file) => {
      const end = blobs.indexOf(10, offset);
      const header = blobs.subarray(offset, end).toString('ascii');
      const size = Number(header.split(' ')[2]);
      assert.equal(header, entries.get(file).oid + ' blob ' + size);
      assert.ok(Number.isSafeInteger(size) && size >= 0 && blobs[end + size + 1] === 10);
      offset = end + size + 2;
      return [file, blobs.subarray(end + 1, offset - 1).toString('utf8')];
    }),
  );
  assert.equal(offset, blobs.length);
  return captureReviewedScriptEntries(files, (file) => sources.get(file));
}

function formatManifest(value) {
  return (
    JSON.stringify(value, null, 2).replace(
      /^( +)"(imports|sourceGuards)": (\[\n[\s\S]*?^\1\])(,?)$/gm,
      (line, indent, key, values, comma) => {
        const inline =
          indent +
          JSON.stringify(key) +
          ': [' +
          JSON.parse(values)
            .map((value) => JSON.stringify(value))
            .join(', ') +
          ']' +
          comma;
        return inline.length <= 120 ? inline : line;
      },
    ) + '\n'
  );
}

// This resolver is limited to the generated manifest. All other paths are
// exactly the result of Git's ordinary three-way merge and the frozen verifier.
export function preCiManifestTree(root, { taskHead, main, protectedPaths }) {
  for (const revision of [taskHead, main]) assert.match(revision, sha);
  const merge = spawnSync(
    'git',
    gitArgs(root, ['-c', 'merge.renames=false', 'merge-tree', '--write-tree', '--name-only', '-z', main, taskHead]),
    options,
  );
  if (merge.error) throw merge.error;
  assert.ok([0, 1].includes(merge.status), 'Cannot inspect the original candidate merge');
  if (merge.status === 0) return null;
  const [tree, ...records] = merge.stdout.split('\0');
  assert.match(tree, sha);
  const end = records.indexOf('');
  assert.ok(end > 0, 'Unclassified candidate merge conflict');
  if (end !== 1 || records[0] !== manifest) return null;
  assert.ok(
    isTechnicalPath(manifest) && !protectedPaths.includes(manifest),
    'Frozen engineering manifest cannot be replaced',
  );

  for (const parent of [taskHead, main]) {
    const recorded = JSON.parse(git(root, ['show', parent + ':' + manifest]));
    assert.deepEqual(
      manifestInputTree(root, parent),
      recorded,
      'Parent engineering manifest is not current: ' + parent,
    );
  }
  const formatted = formatManifest(manifestInputTree(root, tree));
  const scratch = mkdtempSync(path.join(tmpdir(), 'zdm-pre-ci-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    const blob = git(root, ['hash-object', '-w', '--stdin'], { input: formatted }).trim();
    git(root, ['read-tree', tree], { env });
    git(root, ['update-index', '--cacheinfo', '100644', blob, manifest], { env });
    return git(root, ['write-tree'], { env }).trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function preCiManifestCommit(root, { candidateTree, taskHead, main }) {
  for (const revision of [candidateTree, taskHead, main]) assert.match(revision, sha);
  const date = git(root, ['show', '-s', '--format=%cI', taskHead]).trim();
  return git(root, ['commit-tree', candidateTree, '-p', taskHead, '-p', main], {
    input: 'Compose published main and regenerate the reviewed engineering manifest\n',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codex',
      GIT_AUTHOR_EMAIL: 'codex@local',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: 'Codex',
      GIT_COMMITTER_EMAIL: 'codex@local',
      GIT_COMMITTER_DATE: date,
    },
  }).trim();
}
