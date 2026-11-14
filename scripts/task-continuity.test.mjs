import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inspectTaskContinuity,
  probeOwner,
  continueVerifiedTask,
  notifyContinuityChanges,
} from './task-continuity.mjs';
const task = { id: 'test-task', stage: 'validating' };
const session = {
  version: 1,
  batch: task.id,
  events: [{ id: 'stage1', name: 'verify', status: 'running', owner: { host: os.hostname(), pid: 1234 } }],
};
const directory = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), 'continuity-test-')));
const intent = { task: task.id, head: 'a'.repeat(40), owner: 'owner', authorization: 'approved-task' };
const proof = () => ({
  ...intent,
  supported: true,
  runnerAbsent: true,
  resourcesResolved: true,
  effectsReconciled: true,
  candidateUnchanged: true,
  paused: false,
  requiresConfirmation: false,
  ready: true,
  observedAt: Date.now(),
});
test('process loss is interrupted, not success; original records unchanged', () => {
  const before = JSON.stringify(session);
  assert.equal(inspectTaskContinuity(task, session, { observeOwner: () => 'absent' }).status, 'interrupted');
  assert.equal(JSON.stringify(session), before);
});
test('PID reuse, denied probe and missing instrumentation never imply safe continuation', () => {
  assert.equal(probeOwner(session.events[0].owner, { probe() {} }), 'present-unverified');
  assert.equal(
    probeOwner(session.events[0].owner, {
      probe() {
        throw Object.assign(new Error(), { code: 'EPERM' });
      },
    }),
    'unknown',
  );
  assert.equal(inspectTaskContinuity(task, null).status, 'unobserved');
});
test('explicit pause remains paused and foreign task journal rejected', () => {
  assert.equal(inspectTaskContinuity(task, { ...session, pauses: [{ id: 'p' }] }).status, 'paused');
  assert.throws(() => inspectTaskContinuity(task, { ...session, batch: 'other' }));
});
test('bounded verified continuation invokes original adapter only once across restarts', async () => {
  let calls = 0;
  const dir = directory();
  const args = {
    intent,
    directory: dir,
    inspect: async () => proof(),
    executeOriginal: async () => {
      calls++;
      return { status: 'continued' };
    },
  };
  assert.equal((await continueVerifiedTask(args)).result.status, 'continued');
  assert.equal((await continueVerifiedTask(args)).status, 'blocked');
  assert.equal(calls, 1);
});
test('unknown effect, missing resource proof, pause, approval and stale observations block', async () => {
  for (const override of [
    { effectsReconciled: false },
    { resourcesResolved: false },
    { paused: true },
    { requiresConfirmation: true },
    { observedAt: 0 },
    { head: 'b'.repeat(40) },
  ]) {
    const result = await continueVerifiedTask({
      intent,
      directory: directory(),
      inspect: async () => ({ ...proof(), ...override }),
      executeOriginal: () => assert.fail('must not execute'),
    });
    assert.equal(result.status, 'blocked');
  }
});
test('adapter failure retains unknown receipt and cannot replay', async () => {
  const dir = directory();
  const args = {
    intent,
    directory: dir,
    inspect: async () => proof(),
    executeOriginal: async () => {
      throw new Error('lost connection');
    },
  };
  const result = await continueVerifiedTask(args);
  assert.equal(result.result.status, 'unknown');
  assert.equal(JSON.parse(readFileSync(path.join(dir, result.key + '.claim.json'))).status, 'starting');
  assert.equal((await continueVerifiedTask(args)).status, 'blocked');
});
test('simultaneous observers cannot duplicate a continuation', async () => {
  let calls = 0;
  const args = {
    intent,
    directory: directory(),
    inspect: async () => proof(),
    executeOriginal: async () => {
      calls++;
      return { status: 'continued' };
    },
  };
  await Promise.all([continueVerifiedTask(args), continueVerifiedTask(args)]);
  assert.equal(calls, 1);
});
test('notification unknown outcome dedupes across restart without declaring visible', async () => {
  let calls = 0;
  const dir = directory();
  const observations = [{ task: '284', status: 'interrupted', reason: 'ended' }];
  const options = {
    send: async () => {
      calls++;
      return { status: 'unknown' };
    },
  };
  assert.equal((await notifyContinuityChanges(observations, dir, options))[0].status, 'unknown');
  assert.deepEqual(await notifyContinuityChanges(observations, dir, options), []);
  assert.equal(calls, 1);
});
test('legacy validation running records are surfaced without inventing a live process', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { verificationObservations } = await import('./task-continuity.mjs');
  const root = directory(),
    dir = path.join(root, '.task-verification');
  mkdirSync(dir);
  const file = path.join(dir, 'a'.repeat(64) + '.json');
  const original = JSON.stringify({
    status: 'running',
    attemptId: 'original-attempt',
    name: 'engineering',
    identity: { root, source: { digest: 'old-candidate' } },
  });
  writeFileSync(file, original);
  const [result] = verificationObservations(root);
  assert.equal(result.status, 'recorded-running-unverified');
  assert.equal(result.candidateDigest, 'old-candidate');
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('separate observer sessions retain state and refuse active, completed and unreachable-owner replay', async () => {
  const { spawnSync } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const { performance } = await import('node:perf_hooks');
  const dir = directory();
  const file = path.join(dir, 'cross-session.json');
  const moduleUrl = new URL('./task-continuity.mjs', import.meta.url).href;
  const scenarios = [
    {
      name: 'active',
      stage: 'validating',
      state: 'running',
      owner: 'present-unverified',
      expected: 'unverified-running',
    },
    { name: 'blocked', stage: 'validating', state: 'failure', owner: 'absent', expected: 'blocked' },
    { name: 'completed', stage: 'closed', state: 'success', owner: 'absent', expected: 'closed' },
    { name: 'unreachable', stage: 'validating', state: 'running', owner: 'unknown', expected: 'unverified-running' },
  ];
  const measurements = [];
  for (const scenario of scenarios) {
    const input = {
      task: { id: 'isolated-session', stage: scenario.stage },
      session: {
        version: 1,
        batch: 'isolated-session',
        events: [{ id: scenario.name, name: 'verify', status: scenario.state }],
      },
      ownerObservation: scenario.owner,
    };
    const bytes = JSON.stringify(input);
    writeFileSync(file, bytes);
    for (let sessionNumber = 1; sessionNumber <= 2; sessionNumber++) {
      const start = performance.now();
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import { readFileSync } from 'node:fs';
        import { inspectTaskContinuity, continueVerifiedTask } from ${JSON.stringify(moduleUrl)};
        const input = JSON.parse(readFileSync(process.argv[1]));
        const observed = inspectTaskContinuity(input.task, input.session, { observeOwner: () => input.ownerObservation });
        let executions = 0;
        const outcome = await continueVerifiedTask({ intent: { task: input.task.id, head: 'a'.repeat(40),
          owner: 'original-fixture-owner', authorization: 'fixture-only' }, directory: process.argv[2],
          inspect: async () => ({ supported: false }), executeOriginal: async () => { executions++; } });
        console.log(JSON.stringify({ observed, outcome, executions }));
      `,
          file,
          path.join(dir, scenario.name),
        ],
        { encoding: 'utf8' },
      );
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.observed.status, scenario.expected);
      assert.equal(result.outcome.status, 'blocked');
      assert.equal(result.executions, 0);
      measurements.push({
        scenario: scenario.name,
        sessionNumber,
        detectionAndDecisionMs: performance.now() - start,
        recoveryLatencyMs: null,
        reason: 'No supported original-owner proof; no recovery attempted',
      });
      assert.equal(readFileSync(file, 'utf8'), bytes);
    }
  }
  // These are local process/read/decision measurements, not automation polling or production SLA.
  console.log('isolated cross-session timing ' + JSON.stringify(measurements));
});

test('CLI refuses linked state ancestor before creating state directory', async () => {
  const { symlinkSync, readdirSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cwd = directory(),
    outside = directory();
  symlinkSync(outside, path.join(cwd, '.task-runtime'));
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./task-continuity-cli.mjs', import.meta.url)), '--once'],
    { cwd, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Linked observer state path/);
  assert.deepEqual(readdirSync(outside), []);
});
