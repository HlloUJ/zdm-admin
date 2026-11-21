import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertSourcePath, isAcceptedSourceControlPath } from './accepted-source-policy.mjs';
import { formatEngineeringManifest, manifestInputTree } from './delivery-repairs/pre-ci-composition.mjs';
import {
  REVIEWED_DELIVERY_INPUTS,
  engineeringConsumers,
  engineeringExternalReaderPath,
  engineeringExternalReadersFromSources,
  reflectiveEngineeringReadersFromSources,
} from './engineering-impact.mjs';
import { SCRIPT_INPUT_MANIFEST as MANIFEST } from './script-test-plan.mjs';

export const CONTINUATION_BATCH = 'order-prototype-fixed-preview';
export const CONTINUATION_HOOK = 'scripts/accepted-source-hook.mjs';
const REVIEW_DIRECTORY = '.codex/accepted-source-conflict-reviews/';
const REVIEW = REVIEW_DIRECTORY + CONTINUATION_BATCH + '.json';
const RECORD = '.codex/accepted-source-continuations/' + CONTINUATION_BATCH + '.json';
const IMPACT = 'scripts/engineering-impact.json';
const GENERATED = [IMPACT, MANIFEST];
const OID = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;

const git = (root, args, options) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
    ...options,
  });

function entries(root, tree) {
  return new Map(
    git(root, ['ls-tree', '-r', '-z', tree])
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const tab = entry.indexOf('\t');
        const file = entry.slice(tab + 1);
        const [mode, type, object] = entry.slice(0, tab).split(' ');
        assertSourcePath(file);
        assert.equal(type, 'blob', 'Continuation requires a source tree without submodules');
        return [file, { mode, object }];
      }),
  );
}

function regular(entries, file) {
  const value = entries.get(file);
  assert.equal(value?.mode, '100644', 'Continuation requires an ordinary file at ' + file);
  return value.object;
}

const readJson = (root, object) => JSON.parse(git(root, ['cat-file', 'blob', object]));
const same = (left, right) => left?.mode === right?.mode && left?.object === right?.object;

export function continuationDelta(root, base, tree) {
  const before = entries(root, base);
  const after = entries(root, tree);
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((file) => !same(before.get(file), after.get(file)))
    .map((file) => ({ file, before: before.get(file) ?? null, after: after.get(file) ?? null }));
}

export function inspectContinuationCandidate(root, candidate, main) {
  for (const commit of [candidate, main]) {
    assert.match(commit, OID);
    assert.equal(git(root, ['cat-file', '-t', commit]).trim(), 'commit');
  }
  const parents = git(root, ['cat-file', 'commit', candidate])
    .split('\n\n', 1)[0]
    .split('\n')
    .filter((line) => line.startsWith('parent '));
  assert.deepEqual(parents, ['parent ' + main], 'Continuation must have the exact trusted base as its only parent');
  return git(root, ['rev-parse', candidate + '^{tree}']).trim();
}

function resolveReview(root, record, base, current, projected) {
  assert.equal(regular(base, REVIEW), record.review, 'Continuation review refers to different published source');
  assert.equal(regular(current, REVIEW), record.review, 'Published protected conflict review changed');
  const review = readJson(root, record.review);
  assert.equal(review.version, 2);
  assert.equal(review.batch, record.batch);
  assert.equal(review.accepted, record.accepted, 'Continuation refers to another original freeze');
  assert.ok(review.resolutions.length > 0, 'Published protected conflict review required');
  for (const { file, inputs, result } of review.resolutions) {
    assertSourcePath(file);
    assert.equal(regular(base, file), inputs.main, 'Reviewed baseline input changed at ' + file);
    assert.ok(
      [inputs.main, result.object].includes(regular(current, file)),
      'Published conflict input changed at ' + file,
    );
    assert.equal(result.mode, '100644');
    assert.equal(regular(projected, file), result.object, 'Continuation review result changed at ' + file);
  }
}

function writeVersion(index, file, version) {
  if (version === null) index('update-index', '--force-remove', '--', file);
  else index('update-index', '--add', '--cacheinfo', version.mode, version.object, file);
}

function replaceInIndex(root, index, file, bytes) {
  const object = git(root, ['hash-object', '-w', '--stdin'], { input: bytes }).trim();
  writeVersion(index, file, { mode: '100644', object });
}

function readEngineeringSources(root, tree) {
  const files = [...entries(root, tree)].filter(
    ([file]) => engineeringExternalReaderPath(file) || (file.startsWith('scripts/') && file.endsWith('.mjs')),
  );
  const data = git(root, ['cat-file', '--batch'], {
    input: files.map(([, version]) => version.object + '\n').join(''),
    encoding: null,
  });
  let offset = 0;
  const sources = new Map(
    files.map(([file, version]) => {
      assert.ok(['100644', '100755'].includes(version.mode), 'Engineering scan requires regular source: ' + file);
      const end = data.indexOf(10, offset);
      const header = data.subarray(offset, end).toString('ascii');
      const size = Number(header.split(' ')[2]);
      assert.equal(header, version.object + ' blob ' + size);
      assert.ok(Number.isSafeInteger(size) && size >= 0 && data[end + size + 1] === 10);
      offset = end + size + 2;
      return [file, data.subarray(end + 1, offset - 1).toString('utf8')];
    }),
  );
  assert.equal(offset, data.length);
  return sources;
}

function generatedImpact(root, tree, manifest) {
  const sources = readEngineeringSources(root, tree);
  const inputs = REVIEWED_DELIVERY_INPUTS;
  const consumers = engineeringConsumers(manifest, inputs);
  const topology = (files) =>
    Object.fromEntries(
      files.map((file) => {
        const { imports, dynamicImports } = manifest.files[file];
        return [file, { imports, dynamicImports }];
      }),
    );
  return {
    version: 1,
    inputs: topology(inputs),
    consumers: topology(consumers),
    externalReaders: engineeringExternalReadersFromSources(sources.keys(), consumers, (file) => sources.get(file)),
    reflectiveReaders: reflectiveEngineeringReadersFromSources(manifest, inputs, (file) => sources.get(file)),
  };
}

function validateDelta(record, base, current) {
  assert.ok(Array.isArray(record.delta) && record.delta.length > 0 && record.delta.length <= 32);
  const files = record.delta.map(({ file }) => file);
  assert.deepEqual(files, [...new Set(files)].sort(), 'Continuation delta must list unique sorted paths');
  assert.ok(
    GENERATED.every((file) => files.includes(file)),
    'Continuation engineering outputs must be reviewed',
  );
  for (const { file, before, after } of record.delta) {
    assertSourcePath(file);
    assert.ok(
      !isAcceptedSourceControlPath(file) && !file.startsWith(REVIEW_DIRECTORY),
      'Continuation delta cannot replace a source verification path',
    );
    for (const version of [before, after]) {
      if (version === null) continue;
      assert.deepEqual(Object.keys(version).sort(), ['mode', 'object']);
      assert.ok(['100644', '100755'].includes(version.mode));
      assert.match(version.object, OID);
    }
    if (GENERATED.includes(file))
      assert.ok(before?.mode === '100644' && after?.mode === '100644', 'Generated source must be a regular file');
    assert.ok(!same(before, after), 'Continuation delta contains an unchanged path');
    assert.deepEqual(base.get(file) ?? null, before, 'Reviewed baseline input changed at ' + file);
    assert.ok(
      GENERATED.includes(file) || same(current.get(file), before) || same(current.get(file), after),
      'Published source input changed at ' + file,
    );
  }
}

// The exact trusted base supplies the one-instance authorization. The old
// approved tree can be reproduced from object IDs even when its two old
// generated blobs are absent from today's candidate.
export function projectAcceptedContinuation(root, main) {
  assert.match(main, OID);
  assert.equal(git(root, ['cat-file', '-t', main]).trim(), 'commit');
  const current = entries(root, main);
  const recordBlob = regular(current, RECORD);
  const record = readJson(root, recordBlob);
  assert.equal(record.version, 1);
  assert.equal(record.batch, CONTINUATION_BATCH);
  for (const field of ['accepted', 'reviewedBase', 'reviewedTree', 'review', 'hook']) assert.match(record[field], OID);
  for (const field of ['originalBusinessDigest', 'protectedDigest', 'protectedDeletionDigest'])
    assert.match(record[field], HASH);
  const history = git(root, ['rev-list', '--first-parent', main]).trim().split('\n');
  assert.ok(history.includes(record.reviewedBase), 'Reviewed baseline is absent from trusted main history');
  const base = entries(root, record.reviewedBase);
  assert.equal(regular(base, CONTINUATION_HOOK), record.hook, 'Invalid reviewed hook');
  assert.equal(regular(current, CONTINUATION_HOOK), record.hook, 'Trusted main hook changed since review');
  validateDelta(record, base, current);

  const scratch = mkdtempSync(path.join(tmpdir(), 'zdm-continuation-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') };
    const index = (...args) => git(root, args, { env }).trim();
    index('read-tree', record.reviewedBase);
    for (const { file, after } of record.delta) writeVersion(index, file, after);
    const reviewedTree = index('write-tree', '--missing-ok');
    assert.equal(reviewedTree, record.reviewedTree, 'Reviewed continuation tree does not match its exact delta');

    index('read-tree', main);
    for (const { file, after } of record.delta) if (!GENERATED.includes(file)) writeVersion(index, file, after);
    const projected = index('write-tree');
    resolveReview(root, record, base, current, entries(root, projected));

    const currentManifest = manifestInputTree(root, main);
    assert.deepEqual(
      readJson(root, regular(current, MANIFEST)),
      currentManifest,
      'Published engineering manifest drifted',
    );
    const currentImpact = regular(current, IMPACT);
    const reviewedImpact = record.delta.find(({ file }) => file === IMPACT);
    if (![reviewedImpact.before.object, reviewedImpact.after.object].includes(currentImpact))
      assert.deepEqual(
        readJson(root, currentImpact),
        generatedImpact(root, main, currentManifest),
        'Published engineering scope drifted',
      );

    const impact = generatedImpact(root, projected, manifestInputTree(root, projected));
    replaceInIndex(root, index, IMPACT, formatEngineeringManifest(impact));
    const resolved = index('write-tree');
    replaceInIndex(root, index, MANIFEST, formatEngineeringManifest(manifestInputTree(root, resolved)));
    return { record, recordBlob, reviewedTree, tree: index('write-tree') };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
