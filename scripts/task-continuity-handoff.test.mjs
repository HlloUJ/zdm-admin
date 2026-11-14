import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { continuityHandoffs, claimContinuityHandoff, receiptContinuityHandoff } from './task-continuity-handoff.mjs';
const observations = [
  { task: 'task-a', status: 'interrupted', reason: 'stage-owner-ended', observations: [{ id: 'stage-a' }] },
];
const bindings = {
  'task-a': {
    worker: '/root/worker_a',
    owner: 'original-owner',
    taskStableId: 'stable-task-a',
    authorization: 'explicit execute request',
  },
};
const directory = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), 'continuity-handoff-')));
test('root handoff preserves exact identity and does not pretend to wake an agent', () => {
  const [event] = continuityHandoffs(observations, bindings, 10);
  assert.equal(event.worker, '/root/worker_a');
  assert.equal(event.canReplayCommands, false);
  assert.equal(event.action, 'inspect-original-worker-before-followup');
});
test('missing mapping, stale observation and duplicate delivery cannot wake another worker', () => {
  const [unknown] = continuityHandoffs(observations, {}, 10);
  assert.equal(unknown.worker, null);
  assert.throws(() => claimContinuityHandoff(unknown, directory(), { now: 11 }));
  const [event] = continuityHandoffs(observations, bindings, 10),
    dir = directory();
  assert.throws(() => claimContinuityHandoff(event, dir, { now: 130000 }));
  assert.equal(claimContinuityHandoff(event, dir, { now: 11 }).claimed, true);
  assert.equal(claimContinuityHandoff(event, dir, { now: 12 }).claimed, false);
});
test('unknown wake outcome is preserved across restart, never task success', () => {
  const [event] = continuityHandoffs(observations, bindings, 10),
    dir = directory();
  claimContinuityHandoff(event, dir, { now: 11 });
  receiptContinuityHandoff(event, dir, {
    status: 'unknown',
    evidence: 'connector reply lost; read worker before retry',
  });
  assert.equal(claimContinuityHandoff(event, dir, { now: 12 }).claimed, false);
  const receipt = JSON.parse(readFileSync(path.join(dir, event.eventId + '.receipt.json')));
  assert.equal(receipt.taskCompleted, false);
});
test('new stage receives a distinct event; unchanged observation does not spam', () => {
  const [a] = continuityHandoffs(observations, bindings, 10);
  const [b] = continuityHandoffs(observations, bindings, 20);
  const [c] = continuityHandoffs([{ ...observations[0], observations: [{ id: 'stage-b' }] }], bindings, 20);
  assert.equal(a.eventId, b.eventId);
  assert.notEqual(a.eventId, c.eventId);
});
