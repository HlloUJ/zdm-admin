import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

function manifestInputTree(root, tree, extraInputs = ENGINEERING_EXTRA_INPUTS) {
  const records = git(root, ['ls-tree', '-r', '-z', tree, '--', 'scripts', ...extraInputs])
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
    extraInputs.every((file) => entries.has(file)),
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

export function formatEngineeringManifest(value) {
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

function fileVersion(root, revision, file) {
  const entry = git(root, ['--literal-pathspecs', 'ls-tree', '-z', revision, '--', file]);
  const match = /^(100644) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(entry);
  assert.equal(match?.[3], file, 'Composition review requires an existing normal file: ' + file);
  const [, mode, object] = match;
  return { mode, object };
}

function reviewedFiles(root, { accepted, taskHead, main, protectedPaths }, review, conflicts) {
  assert.equal(review?.version, 1, 'Exact engineering conflict review required');
  assert.deepEqual(
    { accepted: review.accepted, taskHead: review.taskHead, main: review.main },
    { accepted, taskHead, main },
    'Engineering review binds the original freeze and exact task/main parents',
  );
  assert.match(review.candidate, sha);
  assert.deepEqual(
    git(root, ['show', '-s', '--format=%P', review.candidate]).trim().split(' '),
    [taskHead, main],
    'Reviewed candidate must have the exact task and main parents',
  );
  assert.ok(Array.isArray(review.files));
  assert.deepEqual(
    review.files.map((entry) => entry.file).sort(),
    [...conflicts].sort(),
    'Engineering review must cover exactly the non-manifest conflicts',
  );
  const base = git(root, ['merge-base', '--all', taskHead, main]).trim();
  assert.match(base, sha, 'Engineering review requires one exact Git merge base');
  return review.files.map(({ file, inputs, result, reason }) => {
    assertSourcePath(file);
    assert.ok(
      isTechnicalPath(file) && !protectedPaths.includes(file),
      'Frozen conflict cannot use engineering review: ' + file,
    );
    fileVersion(root, accepted, file);
    assert.ok(
      typeof reason === 'string' && reason.trim() && reason.length <= 4000,
      'Reviewed preservation reason required: ' + file,
    );
    assert.deepEqual(
      inputs,
      {
        base: fileVersion(root, base, file),
        task: fileVersion(root, taskHead, file),
        main: fileVersion(root, main, file),
      },
      'Engineering conflict inputs drifted: ' + file,
    );
    assert.deepEqual(result, fileVersion(root, review.candidate, file), 'Reviewed output drifted: ' + file);
    const bytes = git(root, ['cat-file', 'blob', result.object], { encoding: null });
    assert.ok(
      !bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes),
      'Engineering review requires exact UTF-8 text: ' + file,
    );
    return { file, ...result };
  });
}

export function readPreCiReview(root, file) {
  assert.ok(
    path.isAbsolute(file) && file.startsWith(path.join(root, '.task-verification') + path.sep),
    'Exact task-private engineering review required',
  );
  assert.equal(realpathSync(file), file, 'Linked engineering review is unsafe');
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && stat.size <= 1024 * 1024, 'Invalid engineering review file');
  return JSON.parse(readFileSync(file, 'utf8'));
}

const digest = (content) => createHash('sha256').update(content).digest('hex');
function storedReviewPath(root, proof, create = false) {
  assert.match(proof.batch, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const inputs = [proof.accepted, proof.taskHead, proof.main, proof.candidateTree];
  inputs.forEach((value) => assert.match(value, sha));
  const common = realpathSync(path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim()));
  const directory = path.join(common, 'task-delivery', proof.batch, 'pre-ci-reviews');
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(directory)) return null;
  assert.equal(realpathSync(directory), directory, 'Linked persisted review is unsafe');
  const file = path.join(directory, digest(JSON.stringify(inputs)) + '.json');
  if (existsSync(file))
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Invalid persisted review');
  return file;
}
export function storedPreCiReview(root, proof) {
  const file = storedReviewPath(root, proof);
  if (!file || !existsSync(file)) return undefined;
  const { hash, review } = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(hash, digest(JSON.stringify(review)), 'Persisted engineering review changed');
  return review;
}
export function persistPreCiReview(root, proof, review) {
  const file = storedReviewPath(root, proof, true);
  if (existsSync(file)) assert.deepEqual(storedPreCiReview(root, proof), review, 'Original engineering review changed');
  else
    writeFileSync(file, JSON.stringify({ hash: digest(JSON.stringify(review)), review }) + '\n', {
      flag: 'wx',
      mode: 0o400,
    });
}

// Older task parents can predate additions to the shared engineering input
// list. The candidate's own manifest cannot decide which inputs to omit.
export function verifyParentEngineeringManifests(root, taskHead, main) {
  for (const revision of [taskHead, main]) assert.match(revision, sha);
  const recorded = (revision) => JSON.parse(git(root, ['show', revision + ':' + manifest]));
  assert.deepEqual(
    manifestInputTree(root, main),
    recorded(main),
    'Parent engineering manifest is not current: ' + main,
  );
  const presentIn = (revision) =>
    new Set(git(root, ['ls-tree', '-r', '--name-only', '-z', revision, '--', ...ENGINEERING_EXTRA_INPUTS]).split('\0'));
  const oldPaths = presentIn(taskHead);
  const missing = ENGINEERING_EXTRA_INPUTS.filter((file) => !oldPaths.has(file));
  let taskInputs = ENGINEERING_EXTRA_INPUTS;
  if (missing.length) {
    const base = git(root, ['merge-base', '--all', taskHead, main]).trim();
    assert.match(base, sha, 'Historical manifest requires one exact merge base');
    const publishedHistory = git(root, ['rev-list', '--first-parent', main]).trim().split('\n');
    assert.ok(publishedHistory.includes(base), 'Historical manifest baseline was not published on main');
    const historical = recorded(base);
    const historicalInputs = Object.keys(historical.files).filter((file) => !file.startsWith('scripts/'));
    assert.deepEqual(
      [...historicalInputs].sort(),
      ENGINEERING_EXTRA_INPUTS.filter((file) => oldPaths.has(file)).sort(),
      'Old task may omit only inputs added after its published main baseline',
    );
    const historicalPaths = presentIn(base);
    assert.ok(
      missing.every((file) => !historicalPaths.has(file)),
      'An old task removed a published engineering input',
    );
    assert.deepEqual(
      manifestInputTree(root, base, historicalInputs),
      historical,
      'Historical published input manifest is not current',
    );
    taskInputs = historicalInputs;
  }
  assert.deepEqual(
    manifestInputTree(root, taskHead, taskInputs),
    recorded(taskHead),
    'Parent engineering manifest is not current: ' + taskHead,
  );
}

// The exact merge tree supplies every cleanly merged path. The only generated
// resolution is the manifest. An explicit review must account for all others.
export function preCiCompositionTree(root, inputs, review) {
  const { taskHead, main, protectedPaths, rejectUnreviewed = false } = inputs;
  for (const revision of [taskHead, main]) assert.match(revision, sha);
  const merge = spawnSync(
    'git',
    gitArgs(root, ['-c', 'merge.renames=false', 'merge-tree', '--write-tree', '--name-only', '-z', main, taskHead]),
    options,
  );
  if (merge.error) throw merge.error;
  assert.ok([0, 1].includes(merge.status), 'Cannot inspect the original candidate merge');
  if (merge.status === 0) {
    assert.equal(review, undefined, 'Engineering review no longer matches a conflict');
    return null;
  }
  const [tree, ...records] = merge.stdout.split('\0');
  assert.match(tree, sha);
  const end = records.indexOf('');
  assert.ok(end > 0, 'Unclassified candidate merge conflict');
  const conflicts = records.slice(0, end).filter((file) => file !== manifest);
  if (conflicts.length && review === undefined) {
    assert.ok(!rejectUnreviewed, 'Exact engineering review required for conflicts: ' + conflicts.join(', '));
    return null;
  }
  assert.ok(
    isTechnicalPath(manifest) && !protectedPaths.includes(manifest),
    'Frozen engineering manifest cannot be replaced',
  );
  assert.equal(Boolean(conflicts.length), review !== undefined, 'No non-manifest conflict requires review');
  const resolutions = review === undefined ? [] : reviewedFiles(root, inputs, review, conflicts);

  verifyParentEngineeringManifests(root, taskHead, main);
  const scratch = mkdtempSync(path.join(tmpdir(), 'zdm-pre-ci-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
  try {
    git(root, ['read-tree', tree], { env });
    for (const { file, mode, object } of resolutions)
      git(root, ['update-index', '--cacheinfo', mode, object, file], { env });
    const resolved = git(root, ['write-tree'], { env }).trim();
    const bytes = formatEngineeringManifest(manifestInputTree(root, resolved));
    const blob = git(root, ['hash-object', '-w', '--stdin'], { input: bytes }).trim();
    git(root, ['update-index', '--cacheinfo', '100644', blob, manifest], { env });
    const result = git(root, ['write-tree'], { env }).trim();
    if (review)
      assert.equal(
        git(root, ['rev-parse', review.candidate + '^{tree}']).trim(),
        result,
        'Reviewed candidate alters paths beyond its exact conflict resolutions',
      );
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function preCiCompositionCommit(root, { candidateTree, taskHead, main }) {
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
