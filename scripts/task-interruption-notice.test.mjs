import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { interruptionNotice, claimInterruptionNotice, receiptInterruptionNotice } from './task-interruption-notice.mjs';
// Isolated test process only; never a production identity or platform proof.
process.env.CODEX_THREAD_ID ??= 'isolated-ci-notice-fixture';
const binding = {
  task: 'new-task',
  taskNumber: '999',
  taskName: '隔离测试',
  owner: 'owner',
  worker: '/root/worker',
  rootThreadId: process.env.CODEX_THREAD_ID,
  roomId: 'isolated-room',
  authorizationRef: 'isolated-authorization',
  monitoringMode: 'confirmed-interruption-notice-only',
  resumeAllowed: false,
};
const context = { connected: true, paused: false, now: 1000, observedAt: 999 };
const observation = {
  task: 'new-task',
  status: 'interrupted',
  observations: [{ id: 'execution-1', stage: 'prepare', owner: 'absent' }],
};
test('confirmed recorded interruption produces notice without recovery', () => {
  const n = interruptionNotice(binding, observation, context);
  assert.ok(n.text.includes('999'));
  assert.ok(n.text.includes('隔离测试'));
  assert.equal(n.automaticResumptionEnabled, false);
});
test('missing data, offline, pause, closure, live/unknown identity never become interruption', () => {
  for (const status of ['unobserved', 'paused', 'closed', 'unverified-running', 'awaiting-continuation'])
    assert.equal(interruptionNotice(binding, { task: binding.task, status }, context), null);
  for (const delta of [
    { connected: false },
    { connected: undefined },
    { paused: true },
    { paused: undefined },
    { observedAt: -100000 },
    { observedAt: 1001 },
  ])
    assert.equal(interruptionNotice(binding, observation, { ...context, ...delta }), null);
  for (const owner of ['unknown', 'present-unverified'])
    assert.equal(
      interruptionNotice(binding, { ...observation, observations: [{ id: 'x', stage: 'x', owner }] }, context),
      null,
    );
});
test('observer read errors are not stage failures', () => {
  assert.equal(
    interruptionNotice(binding, { task: binding.task, status: 'blocked', reason: 'Permission denied' }, context),
    null,
  );
});
test('actual failure event is separately identified, unknown cause not guessed', () => {
  const n = interruptionNotice(
    binding,
    {
      task: binding.task,
      status: 'blocked',
      failureEvent: { id: 'failed-1', name: 'ci', status: 'failure', finishedAt: 900 },
    },
    context,
  );
  assert.match(n.text, /待核实/);
});
test('unregistered or incomplete context cannot send', () => {
  assert.equal(interruptionNotice({ ...binding, monitoringMode: undefined }, observation, context), null);
  assert.throws(() => interruptionNotice({ ...binding, taskName: '' }, observation, context));
});
test('persistent claim prevents duplicate after uncertain send and requires exact readback', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'notice-284-')),
    n = interruptionNotice(binding, observation, context);
  try {
    assert.equal(claimInterruptionNotice(dir, n).status, 'send-once');
    assert.equal(claimInterruptionNotice(dir, n).status, 'reconcile-existing');
    assert.throws(() =>
      receiptInterruptionNotice(dir, n, { messageId: 'fixture', readbackText: 'wrong', readbackRoom: n.roomId }),
    );
    receiptInterruptionNotice(dir, n, { messageId: 'fixture', readbackText: n.text, readbackRoom: n.roomId });
    assert.equal(claimInterruptionNotice(dir, n).status, 'reconcile-existing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
