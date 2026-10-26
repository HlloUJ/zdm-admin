import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const SHARD_PLAN = 'ci/e2e-shards.json';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function testFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = prefix + entry.name;
      return entry.isDirectory()
        ? testFiles(path.join(directory, entry.name), file + '/')
        : /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)
          ? [file]
          : [];
    })
    .sort();
}
export function readShardPlan(root) {
  const bytes = readFileSync(path.join(root, SHARD_PLAN));
  const plan = JSON.parse(bytes);
  assert.equal(plan.version, 1);
  assert.equal(plan.total, 2);
  assert.equal(plan.strategy, 'whole-file-duration-v1');
  assert.ok(Array.isArray(plan.sources) && plan.sources.length >= 2);
  assert.equal(
    new Set(plan.sources.map((s) => s.runId)).size,
    plan.sources.length,
    'Distinct successful source runs required',
  );
  for (const source of plan.sources) {
    assert.match(source.runId, /^\d+$/);
    assert.equal(source.reports.length, 2);
    source.reports.forEach((hash) => assert.match(hash, /^[a-f0-9]{64}$/));
  }
  assert.equal(new Set(plan.files.map((f) => f.file)).size, plan.files.length, 'Duplicate planned file');
  for (const f of plan.files) {
    assert.match(f.file, /^(?!\/)(?!.*\.\.)(?!.*[\\>\r\n])[^\s]+\.spec\.ts$/);
    assert.ok([1, 2].includes(f.shard));
    assert.ok(Number.isFinite(f.estimatedMs) && f.estimatedMs >= 0);
  }
  assert.deepEqual(
    plan.files.map((f) => f.file).sort(),
    testFiles(path.join(root, 'tests/e2e')),
    'Shard plan file inventory changed; review all files before updating',
  );
  for (const n of [1, 2])
    assert.ok(
      plan.files.some((f) => f.shard === n),
      'Empty shard',
    );
  return { plan, digest: sha(bytes) };
}
export function selectShardArgs(root, args, directory) {
  const shardArgs = args.filter((a) => a === '--shard' || a.startsWith('--shard='));
  if (!shardArgs.length) return { args };
  assert.equal(shardArgs.length, 1);
  assert.match(shardArgs[0], /^--shard=[12]\/2$/, 'Only the reviewed two shards are supported');
  assert.ok(
    args.every((a) => /^(?:--shard=[12]\/2|--workers=1|--reporter=[a-zA-Z0-9_,]+|--list|--forbid-only)$/.test(a)),
    'Unreviewed shard filter or option',
  );
  assert.ok(
    !args.some((a) => /^(?:--grep|--test-list|--last-failed|--only-changed|--repeat-each)/.test(a)),
    'Additional filters cannot shrink a balanced shard',
  );
  for (const worker of args.filter((a) => a.startsWith('--workers'))) assert.equal(worker, '--workers=1');
  const { plan, digest } = readShardPlan(root);
  const current = Number(shardArgs[0].match(/=(\d)/)[1]);
  const files = plan.files
    .filter((f) => f.shard === current)
    .map((f) => f.file)
    .sort();
  mkdirSync(directory, { recursive: true });
  const list = path.join(directory, 'selected-files.txt');
  // Public Playwright test-list syntax: paths relative to testDir, no title filtering.
  writeFileSync(list, files.join('\n') + '\n');
  const selection = { version: 1, digest, current, total: 2, files, strategy: plan.strategy };
  writeFileSync(path.join(directory, 'shard-selection.json'), JSON.stringify(selection, null, 2) + '\n');
  return { args: [...args.filter((a) => !a.startsWith('--shard=')), '--test-list', list, '--workers=1'], selection };
}
