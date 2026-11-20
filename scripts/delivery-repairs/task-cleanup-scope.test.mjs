import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scopeFixture } from './test-support/task-cleanup-scope-fixture.mjs';

const outsideState = (f) => [
  fs.readFileSync(path.join(f.outside.target, 'app.js')),
  fs.readFileSync(f.outside.manifestPath),
  fs.readFileSync(path.join(f.base, 'pending', f.outside.key + '.json')),
];
const runHelper = (file, request) =>
  spawnSync('python3', ['-I', file], {
    input: JSON.stringify(request),
    encoding: 'utf8',
  });

test('manual planning and deletion select only the exact member, including among the same producer and task', async (t) => {
  const f = await scopeFixture(t);
  const outside = outsideState(f);
  const plan = await f.run(['plan']);
  assert.deepEqual(
    plan.processed.map(({ key, state }) => [key, state]),
    [[f.approved.key, 'eligible']],
  );
  assert.equal(fs.readFileSync(path.join(f.approved.target, 'app.js'), 'utf8'), 'approved');
  const result = await f.run(['run']);
  assert.deepEqual(result.cleanupScope, f.policy.scope);
  assert.deepEqual(
    result.processed.map(({ key, state, deletedLogicalBytes }) => [key, state, deletedLogicalBytes]),
    [[f.approved.key, 'cleaned', Buffer.byteLength('approved')]],
  );
  assert.equal(fs.existsSync(f.approved.target), false);
  assert.deepEqual(outsideState(f), outside);
  const exhausted = await f.run(['run']);
  assert.deepEqual(exhausted.processed, []);
  assert.equal(exhausted.remaining, 0);
  assert.deepEqual(outsideState(f), outside);
});

for (const slot of ['2026-01-01T17:00:00.000Z', '2026-01-02T05:00:00.000Z']) {
  test('scheduled scope uses the real consumer and claims the Beijing calendar slot once at ' + slot, async (t) => {
    const f = await scopeFixture(t);
    const outside = outsideState(f);
    const now = Date.parse(slot);
    const outcome = await f.schedule(now);
    assert.equal(outcome.status, 'completed', outcome.reason);
    assert.equal(outcome.slot, slot);
    assert.equal(outcome.metadata, 'retained');
    assert.deepEqual(outcome.cleanupScope, f.policy.scope);
    assert.deepEqual(outcome.processed, [{ key: f.approved.key, state: 'cleaned' }]);
    assert.equal(fs.existsSync(f.approved.target), false);
    assert.equal((await f.schedule(now)).status, 'already-ran');
    assert.deepEqual(outsideState(f), outside);
  });
}

test('manual and scheduled routes reject mixing exact scope with whole-task cleanup', async (t) => {
  const f = await scopeFixture(t);
  const outside = outsideState(f);
  await assert.rejects(f.run(['run-ownership']), /Exact scope cannot enter whole-task ownership/);
  f.setPolicy({ ...f.policy, ownershipV2: true });
  await assert.rejects(f.run(['run']), /Exact scope cannot activate whole-task ownership/);
  await assert.rejects(
    f.schedule(Date.parse('2026-01-02T05:00:00Z')),
    /Exact scope cannot activate whole-task ownership/,
  );
  const policy = { ...f.policy };
  delete policy.scope;
  f.setPolicy({ ...policy, ownershipV2: true });
  await assert.rejects(f.schedule(Date.parse('2026-01-02T05:00:00Z')), /This schedule requires exact scope/);
  assert.equal(fs.existsSync(f.approved.target), true);
  assert.deepEqual(outsideState(f), outside);
});

test('missing original paths preserve historical records and never write a new cleanup receipt', async (t) => {
  const f = await scopeFixture(t);
  const outside = outsideState(f);
  const pendingFile = path.join(f.base, 'pending', f.approved.key + '.json');
  const resultFile = path.join(f.base, 'results', f.approved.key + '.json');
  const historicalKey = JSON.parse(fs.readFileSync(f.scopeFile)).entries.find(({ key }) => key !== f.approved.key).key;
  const historicalReceipt = path.join(f.base, 'results', historicalKey + '.json');
  const receipt = Buffer.from('{"legacy":"retained exactly"}\n');
  fs.writeFileSync(historicalReceipt, receipt, { mode: 0o600 });
  const pending = fs.readFileSync(pendingFile);
  const index = fs.readFileSync(path.join(f.base, 'index.json'));
  fs.renameSync(f.approved.record.carrier, path.join(f.root, 'moved-fixture'));
  const run = await f.run(['run']);
  assert.deepEqual(run.processed, []);
  assert.deepEqual(run.observedMissing, [f.approved.key]);
  assert.equal(run.remaining, 0);
  const schedule = await f.schedule(Date.parse('2026-01-02T05:00:00Z'));
  assert.equal(schedule.status, 'completed', schedule.reason);
  assert.equal(schedule.observedMissing, 1);
  assert.equal(fs.existsSync(resultFile), false);
  assert.deepEqual(fs.readFileSync(historicalReceipt), receipt);
  assert.deepEqual(fs.readFileSync(pendingFile), pending);
  assert.deepEqual(fs.readFileSync(path.join(f.base, 'index.json')), index);
  assert.deepEqual(outsideState(f), outside);
});

test('the descriptor helper refuses unrelated targets, an unpinned proof, and replaced inventory', async (t) => {
  const f = await scopeFixture(t);
  const proof = f.scope().assertRecord(f.approved.key, { ...f.approved.record, key: f.approved.key, state: 'pending' });
  const target = path.join(f.approved.record.carrier, 'deleting');
  fs.renameSync(f.approved.target, target);
  const file = path.join(target, 'new-unapproved.js');
  fs.writeFileSync(file, 'keep');
  const inventory = [
    ['', target],
    ['app.js', path.join(target, 'app.js')],
    ['new-unapproved.js', file],
  ].map(([relative, name]) => {
    const s = fs.lstatSync(name, { bigint: true });
    return {
      path: relative,
      kind: relative ? 'file' : 'directory',
      dev: String(s.dev),
      ino: String(s.ino),
      size: Number(s.size),
      mtimeNs: String(s.mtimeNs),
      ctimeNs: relative ? String(s.ctimeNs) : null,
      mode: Number(s.mode),
    };
  });
  const outside = runHelper(f.helper, { path: f.outside.target, entries: inventory, scopeProof: proof });
  assert.match(outside.stderr, /Deletion path reused or substituted/);
  const production = fileURLToPath(new URL('../task-cleanup-delete.py', import.meta.url));
  assert.match(
    runHelper(production, { path: target, entries: inventory, scopeProof: proof }).stderr,
    /Wrong deletion scope identity/,
  );
  assert.match(runHelper(f.helper, { path: target, entries: inventory }).stderr, /Exact deletion scope proof required/);
  const forged = runHelper(f.helper, { path: target, entries: inventory, scopeProof: proof });
  assert.notEqual(forged.status, 0, forged.stdout);
  assert.match(forged.stderr, /Inventory differs from approved manifest/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(target, 'app.js'), 'utf8'), 'approved');
});
