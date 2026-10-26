import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readShardPlan, selectShardArgs } from './e2e-shards.mjs';
import { performanceSummary } from './e2e-performance.mjs';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'e2e-shards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'tests/e2e'), { recursive: true });
  mkdirSync(path.join(root, 'ci'));
  const plan = {
    version: 1,
    total: 2,
    strategy: 'whole-file-duration-v1',
    sources: ['1', '2'].map((runId) => ({ runId, reports: ['a'.repeat(64), 'b'.repeat(64)] })),
    files: [
      { file: 'long.spec.ts', shard: 1, estimatedMs: 100 },
      { file: 'short.spec.ts', shard: 2, estimatedMs: 100 },
    ],
  };
  for (const f of plan.files) writeFileSync(path.join(root, 'tests/e2e', f.file), '');
  const save = () => writeFileSync(path.join(root, 'ci/e2e-shards.json'), JSON.stringify(plan));
  save();
  return { root, plan, save };
}
test('two selections retain whole files, disjoint union and single worker using public test-list syntax', (t) => {
  const f = fixture(t),
    selected = [];
  for (const n of [1, 2]) {
    const out = selectShardArgs(f.root, [`--shard=${n}/2`, '--workers=1'], path.join(f.root, 'out' + n));
    assert.ok(!out.args.some((a) => a.startsWith('--shard')));
    assert.ok(out.args.includes('--test-list'));
    assert.equal(out.selection.current, n);
    const list = readFileSync(out.args[out.args.indexOf('--test-list') + 1], 'utf8')
      .trim()
      .split('\n');
    assert.deepEqual(list, out.selection.files);
    selected.push(...list);
  }
  assert.deepEqual(selected.sort(), f.plan.files.map((f) => f.file).sort());
  assert.equal(new Set(selected).size, selected.length);
});
test('unknown files, duplicate or empty assignments, extra filters and changed worker/shard counts fail closed', (t) => {
  const f = fixture(t);
  for (const args of [
    ['--shard=1/4'],
    ['--shard=1/2', '--workers=2'],
    ['--shard=1/2', '--grep=one'],
    ['--shard=1/2', '--test-list-invert=x'],
  ])
    assert.throws(() => selectShardArgs(f.root, args, path.join(f.root, 'out')));
  f.plan.files[1].shard = 1;
  f.save();
  assert.throws(() => readShardPlan(f.root));
  f.plan.files[1].shard = 2;
  f.save();
  writeFileSync(path.join(f.root, 'tests/e2e/new.spec.ts'), '');
  assert.throws(() => readShardPlan(f.root));
});
test('changing an assignment changes exact plan digest; source reports and unknown paths are rejected', (t) => {
  const f = fixture(t),
    before = readShardPlan(f.root).digest;
  f.plan.files.forEach((x) => {
    x.shard = 3 - x.shard;
  });
  f.save();
  assert.notEqual(readShardPlan(f.root).digest, before);
  f.plan.sources[0].reports[0] = 'unknown';
  f.save();
  assert.throws(() => readShardPlan(f.root));
});
test('performance observations retain category limitations and resource deltas without claiming a cause', () => {
  const r = performanceSummary(
    [{ id: 'x', durationMs: 100, hookMs: 20, navigationMs: 40 }],
    { containerCpu: { usage_usec: 100 } },
    { containerCpu: { usage_usec: 150 } },
  );
  assert.equal(r.containerCpuDelta.usage_usec, 50);
  assert.match(r.interpretation, /may overlap/);
  assert.equal(performanceSummary([], { containerCpu: null }, { containerCpu: null }).containerCpuDelta, null);
});
