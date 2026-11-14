import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { assessCiContinuation } from './task-continuity-ci.mjs';
import { probeOwner } from './task-continuity.mjs';
const head = 'a'.repeat(40);
const input = () => ({
  intent: { task: 'task-a', head, owner: 'original-owner', mode: 'wait-existing-ci', runId: '123' },
  task: { id: 'task-a', owner: 'original-owner', recordedHead: head, frozen: { accepted: head }, stage: 'pr-pending' },
  session: { batch: 'task-a', startedAt: 1, events: [{ name: 'ci', key: head + ':123', status: 'running' }] },
  currentOwner: 'original-owner',
  currentHead: head,
  clean: true,
  remote: { headSha: head, databaseId: 123, event: 'pull_request' },
  resourcesEnded: true,
});
test('only already-created exact CI wait is eligible, not PR/CI creation or merge', () => {
  assert.equal(assessCiContinuation(input()).ready, true);
  for (const mode of ['merge', 'retry-ci', 'deliver', 'delete-data']) {
    const data = input();
    data.intent.mode = mode;
    assert.equal(assessCiContinuation(data).ready, false);
  }
});
test('owner, remote run, candidate, resources and pause are mandatory', () => {
  for (const change of [
    (x) => {
      x.currentOwner = 'other';
    },
    (x) => {
      x.remote.databaseId = 456;
    },
    (x) => {
      x.currentHead = 'b'.repeat(40);
    },
    (x) => {
      x.clean = false;
    },
    (x) => {
      x.resourcesEnded = false;
    },
    (x) => {
      x.session.pauses = [{ startedAt: 1 }];
    },
  ]) {
    const data = input();
    change(data);
    assert.equal(assessCiContinuation(data).ready, false);
  }
});
test('756 prepare failure and silent gap remains blocked without replay', () => {
  const data = input();
  data.session.events = [{ name: 'prepare', status: 'failure', finishedAt: 1 }];
  const result = assessCiContinuation(data);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.includes('Existing failure needs original diagnosis'));
});
test('real isolated process exit yields absent owner, not success or an automatic retry', () => {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(child.status, 0);
  assert.equal(probeOwner({ host: os.hostname(), pid: child.pid }), 'absent');
});

test('same candidate with another CI run is never resumed as the original run', () => {
  const data = input();
  data.session.events[0].key = head + ':456';
  assert.equal(assessCiContinuation(data).ready, false);
});
