import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCompletion, saveCompletion, completionStage, completionSummary } from './completion-session.mjs';
import {
  recoverInterrupted,
  recoverWriter,
  trackStageRestoration,
  finishStageRestorations,
} from './completion-recovery.mjs';
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-recovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, state: openCompletion(dir, 'example') };
}
const gone = () => {
  throw Object.assign(new Error('gone'), { code: 'ESRCH' });
};
test('live, unknown or foreign owners cannot be interrupted; only proven local dead owner becomes preserved failure', (t) => {
  const { dir, state } = fixture(t);
  state.events.push({
    id: 'event',
    name: 'ci',
    key: 'head:1',
    startedAt: Date.now(),
    status: 'running',
    owner: { host: os.hostname(), pid: 1234 },
  });
  saveCompletion(dir, state);
  assert.throws(() => recoverInterrupted(state, dir, { probe: () => {} }), /alive/);
  assert.throws(() => recoverInterrupted(state, dir, { host: 'other', probe: gone }), /foreign/);
  recoverInterrupted(state, dir, { probe: gone });
  assert.equal(state.events[0].status, 'failure');
  assert.match(state.events[0].durationBasis, /unknown/);
});
test('writer recovery removes only a proven dead private index lock; never steals a live or legacy lock', (t) => {
  const { dir } = fixture(t),
    file = path.join(dir, 'completion-session.json.lock');
  writeFileSync(file, JSON.stringify({ host: os.hostname(), pid: 1234 }));
  assert.throws(() => recoverWriter(dir, { probe: () => {} }), /alive/);
  assert.ok(existsSync(file));
  recoverWriter(dir, { probe: gone });
  assert.equal(existsSync(file), false);
  writeFileSync(file, '1234');
  assert.throws(() => recoverWriter(dir, { probe: gone }));
  assert.ok(existsSync(file));
});
test('non-CI stage restoration is linked and counted only after that exact stage re-verifies successfully', async (t) => {
  const { dir, state } = fixture(t);
  const save = (s) => saveCompletion(dir, s);
  await assert.rejects(
    completionStage(
      state,
      'handoff',
      'head',
      async () => {
        throw Error('failure');
      },
      { save },
    ),
  );
  trackStageRestoration(state, dir);
  assert.equal(state.repairs.length, 1);
  finishStageRestorations(state, dir);
  assert.equal(state.repairs[0].finishedAt, undefined);
  await completionStage(state, 'handoff', 'other', async () => ({ ok: true }), { save });
  finishStageRestorations(state, dir);
  assert.equal(state.repairs[0].finishedAt, undefined);
  await completionStage(state, 'handoff', 'head', async () => ({ ok: true }), { save });
  finishStageRestorations(state, dir);
  assert.ok(state.repairs[0].finishedAt);
  assert.equal(state.events[0].status, 'failure');
  const bytes = readFileSync(state.repairs[0].evidence, 'utf8');
  assert.match(bytes, /unclassified/);
});
test('gaps are an explicit interval union including stage adjacency, not inferred execution', () => {
  const s = {
    batch: 'x',
    startedAt: 0,
    closedAt: 100,
    repairs: [],
    events: [
      { name: 'ci', key: 'x', startedAt: 10, finishedAt: 30, status: 'success' },
      { name: 'handoff', key: 'x', startedAt: 50, finishedAt: 90, status: 'success' },
    ],
  };
  const r = completionSummary(s);
  assert.deepEqual(
    r.gaps.map((g) => g.durationMs),
    [10, 20, 10],
  );
  assert.equal(r.gaps[1].previous, 'ci');
  assert.equal(r.gaps[1].next, 'handoff');
  assert.equal(r.unattributedMs, 40);
});
