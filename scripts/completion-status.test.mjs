import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCompletion, saveCompletion } from './completion-session.mjs';
import { deliveryStatus, backfillDeliveryStatus } from './completion-status.mjs';
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-status-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const state = openCompletion(dir, 'example', { now: 0 });
  const main = 'a'.repeat(40),
    key = main + ':42';
  state.events = [
    {
      id: 'ci',
      name: 'ci',
      key,
      status: 'success',
      startedAt: 10,
      finishedAt: 80,
      result: {
        runId: '42',
        headSha: main,
        attempt: 1,
        conclusion: 'success',
        branch: 'main',
        jobs: ['Frontend quality', 'Backend quality'].map((name) => ({
          name,
          status: 'completed',
          conclusion: 'success',
        })),
      },
    },
    ...['evidence', 'handoff', 'preserve', 'cleanup', 'close'].map((name, i) => ({
      id: name,
      name,
      key,
      status: 'success',
      startedAt: 81 + i,
      finishedAt: 82 + i,
    })),
  ];
  state.repairs = [{ id: 'restore', category: 'stage-restoration', startedAt: 20, finishedAt: 90 }];
  state.closedAt = 100;
  saveCompletion(dir, state);
  const registry = { id: 'example', closedAt: new Date(100).toISOString(), main: { local: main, remote: main } };
  const receipt = {
    results: { close: { result: { batch: 'example', main: registry.main } } },
    summary: { repairMs: 70 },
    remoteSnapshot: { main, checkedAt: new Date(100).toISOString() },
  };
  writeFileSync(path.join(dir, 'completion-receipt.json'), JSON.stringify(receipt));
  return { dir, state, registry, receipt, main };
}
test('local ready and intermediate states never claim formal delivery or create state sources', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-local-status-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const status = deliveryStatus(dir, 'example', { modules: [{ status: 'ready' }] });
  assert.equal(status.localReady, true);
  assert.equal(status.formalDeliveryComplete, false);
  assert.equal(status.phase, 'local-validation');
  assert.deepEqual(readdirSync(dir), []);
});
test('historical backfill derives corrected timing without rewriting source evidence or requiring executable callbacks', (t) => {
  const f = fixture(t),
    files = ['completion-session.json', 'completion-receipt.json'];
  const before = files.map((file) => readFileSync(path.join(f.dir, file), 'utf8'));
  const result = backfillDeliveryStatus(f.dir, 'example', f.registry);
  assert.equal(result.formalDeliveryComplete, true);
  assert.equal(result.phase, 'delivered');
  assert.equal(result.summary.repairMs, 0);
  assert.equal(result.originalReceiptTiming.repairMs, 70);
  assert.equal(result.summary.restorationWindowMs, 70);
  assert.equal(result.summary.recoveryMs, 10);
  assert.equal(result.historical, true);
  backfillDeliveryStatus(f.dir, 'example', f.registry);
  assert.deepEqual(
    files.map((file) => readFileSync(path.join(f.dir, file), 'utf8')),
    before,
  );
});
test('close flag cannot replace final stages, required CI success, receipt or matching main', (t) => {
  const f = fixture(t);
  f.state.events = f.state.events.filter((e) => e.name !== 'cleanup');
  writeFileSync(path.join(f.dir, 'completion-session.json'), JSON.stringify(f.state));
  assert.equal(deliveryStatus(f.dir, 'example', f.registry).formalDeliveryComplete, false);
  const g = fixture(t);
  g.state.events[0].result.conclusion = 'failure';
  saveCompletion(g.dir, g.state);
  assert.throws(() => backfillDeliveryStatus(g.dir, 'example', g.registry));
  assert.equal(existsSync(path.join(g.dir, 'completion-status.json')), false);
  const h = fixture(t);
  h.registry.main.local = 'b'.repeat(40);
  assert.throws(() => backfillDeliveryStatus(h.dir, 'example', h.registry));
});
test('changed original receipt preserves the prior index and cannot be silently reinterpreted', (t) => {
  const f = fixture(t);
  backfillDeliveryStatus(f.dir, 'example', f.registry);
  const before = readFileSync(path.join(f.dir, 'completion-status.json'), 'utf8');
  writeFileSync(path.join(f.dir, 'completion-receipt.json'), JSON.stringify(f.receipt) + '\n');
  assert.throws(() => backfillDeliveryStatus(f.dir, 'example', f.registry), /receipt changed/);
  assert.equal(readFileSync(path.join(f.dir, 'completion-status.json'), 'utf8'), before);
});

test('legitimate missing-receipt reconstruction retains prior index while refreshing only the derived view', (t) => {
  const f = fixture(t);
  const old = backfillDeliveryStatus(f.dir, 'example', f.registry);
  const bytes = readFileSync(path.join(f.dir, 'completion-status.json'), 'utf8');
  writeFileSync(path.join(f.dir, 'completion-receipt.json'), JSON.stringify({ ...f.receipt, historical: true }));
  assert.throws(() => backfillDeliveryStatus(f.dir, 'example', f.registry), /receipt changed/);
  const restored = backfillDeliveryStatus(f.dir, 'example', f.registry, { receiptRestored: true });
  assert.equal(restored.receiptReconstructed, true);
  assert.equal(restored.previousReceiptDigest, old.sourceReceiptDigest);
  assert.equal(
    readFileSync(path.join(f.dir, 'completion-status-before-restoration-' + old.sourceReceiptDigest + '.json'), 'utf8'),
    bytes,
  );
});
