import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openCompletion,
  saveCompletion,
  completionStage,
  completionSummary,
  settleCompletion,
  recordRepair,
  finishRepair,
} from './completion-session.mjs';
import { assertCompletionQuality } from './completion-ci-evidence.mjs';
import { waitQuality } from './wait-quality.mjs';
const state = () => ({ version: 1, batch: 'example', startedAt: 0, events: [], repairs: [] });
test('one private session survives resume and never resets whole completion start', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = openCompletion(dir, 'example', { now: 100 });
  assert.equal(openCompletion(dir, 'example', { now: 200 }).startedAt, 100);
  a.events.push({ name: 'prepare', startedAt: 110, finishedAt: 130, status: 'success' });
  saveCompletion(dir, a);
  assert.equal(openCompletion(dir, 'example').events.length, 1);
  assert.throws(() => openCompletion(dir, 'other'), /equal/);
});
test('linked or public session destinations are rejected', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-private-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'public'), { mode: 0o755 });
  assert.throws(() => openCompletion(path.join(dir, 'public'), 'example'), /owner-only/);
  symlinkSync(path.join(dir, 'elsewhere'), path.join(dir, 'link'));
  assert.throws(() => openCompletion(path.join(dir, 'link'), 'example'));
});
test('happy post-CI closure orders evidence, handoff, preservation, cleanup and registry exactly once', async () => {
  const s = state(),
    calls = [],
    stages = Object.fromEntries(
      ['evidence', 'handoff', 'preserve', 'cleanup', 'close'].map((name) => [
        name,
        {
          run: async () => {
            calls.push(name);
            return { name };
          },
        },
      ]),
    );
  await settleCompletion(s, 'main:1', stages, { now: () => 10 });
  assert.deepEqual(calls, ['evidence', 'handoff', 'preserve', 'cleanup', 'close']);
  assert.equal(s.closedAt, 10);
});
for (const failure of ['evidence', 'handoff', 'preserve', 'cleanup', 'close'])
  test(`closure stops at ${failure} and preserves failed stage instead of declaring completion`, async () => {
    const s = state(),
      calls = [],
      names = ['evidence', 'handoff', 'preserve', 'cleanup', 'close'];
    const stages = Object.fromEntries(
      names.map((name) => [
        name,
        {
          run: () => {
            calls.push(name);
            if (name === failure) throw Error('failure');
            return {};
          },
        },
      ]),
    );
    await assert.rejects(settleCompletion(s, 'main:1', stages));
    assert.deepEqual(calls, names.slice(0, names.indexOf(failure) + 1));
    assert.equal(s.closedAt, undefined);
    assert.equal(s.events.at(-1).status, 'failure');
  });
test('reuse needs both matching candidate and an independent verifier, without rewriting original timing', async () => {
  const s = state();
  let n = 0,
    time = 1;
  const run = () => ({ counter: ++n }),
    options = { now: () => time++, reuse: (r) => r.counter === 1 };
  await completionStage(s, 'preserve', 'main-A', run, options);
  const original = structuredClone(s.events);
  const reused = await completionStage(s, 'preserve', 'main-A', run, options);
  assert.equal(reused.reused, true);
  assert.deepEqual(s.events, original);
  await completionStage(s, 'preserve', 'main-B', run, options);
  assert.equal(n, 2);
  await completionStage(s, 'preserve', 'main-B', run, { ...options, reuse: () => false });
  assert.equal(n, 3);
});
test('wall time, overlapping CI waits and repairs use interval union; gaps remain unattributed', () => {
  const s = state();
  s.events = [
    { name: 'ci', startedAt: 10, finishedAt: 60, status: 'failure' },
    { name: 'handoff', startedAt: 20, finishedAt: 50, status: 'success' },
    { name: 'ci', startedAt: 55, finishedAt: 90, status: 'success' },
  ];
  s.repairs = [{ id: 'fix', startedAt: 40, finishedAt: 95 }];
  const r = completionSummary(s, 100);
  assert.equal(r.wallMs, 100);
  assert.equal(r.measuredStageMs, 80);
  assert.equal(r.ciWaitMs, 80);
  assert.equal(r.unattributedMs, 20);
  assert.equal(r.repairMs, 55);
  assert.equal(r.postFinalCiMs, 10);
});
test('failed CI identity is recorded from remote evidence and retained through a verified repair', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-repair-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const evidence = path.join(dir, 'failure.log');
  writeFileSync(evidence, 'standalone upload missing');
  const s = state();
  await assert.rejects(
    completionStage(s, 'ci', 'old:1', () => {
      throw Object.assign(Error('CI failed'), {
        ciFailure: { runId: '1', headSha: 'old', attempt: 1, conclusion: 'failure' },
      });
    }),
  );
  recordRepair(s, { id: 'upload', failureRun: 1, category: 'upload', evidence, now: 10 });
  assert.throws(() => finishRepair(s, 'upload', { now: 20 }), /new-candidate/);
  s.events.push({
    name: 'ci',
    status: 'success',
    startedAt: 15,
    finishedAt: 25,
    result: { headSha: 'new', eventName: 'push', branch: 'main' },
  });
  finishRepair(s, 'upload', { now: 30 });
  assert.equal(s.events[0].status, 'failure');
  assert.equal(s.repairs[0].finishedAt, 30);
  assert.throws(() => recordRepair(s, { id: 'other', failureRun: 999, category: 'upload', evidence }), /recorded/);
});
test('CI acceptance rejects stale head, retries, missing gates and failed or unfinished jobs', () => {
  const good = {
    runId: 1,
    headSha: 'main',
    attempt: 1,
    conclusion: 'success',
    jobs: ['Frontend quality', 'Backend quality'].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
  };
  assertCompletionQuality(good, 'main', 1);
  for (const change of [
    { attempt: 2 },
    { headSha: 'old' },
    { conclusion: 'failure' },
    { jobs: [] },
    { jobs: [...good.jobs, { name: 'partial', status: 'in_progress', conclusion: 'success' }] },
  ])
    assert.throws(() => assertCompletionQuality({ ...good, ...change }, 'main', 1));
});
test('remote CI failure exposes accurate identity without guessing a test or upload cause', async () => {
  await assert.rejects(
    waitQuality({
      runId: 1,
      expectedHead: 'a'.repeat(40),
      readRun: async () => ({
        id: 1,
        head_sha: 'a'.repeat(40),
        run_attempt: 1,
        path: '.github/workflows/quality.yml',
        status: 'completed',
        conclusion: 'failure',
      }),
      readJobs: async () => [],
      wait: async () => {},
      report: () => {},
    }),
    (error) => error.ciFailure?.runId === '1' && error.ciFailure.conclusion === 'failure',
  );
});

test('development CI evidence is retained but formal wall time starts only on begin', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-start-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = openCompletion(dir, 'example', { now: 10, formal: false });
  s.events.push({ name: 'ci', key: 'pr:1', startedAt: 10, finishedAt: 20, status: 'success' });
  saveCompletion(dir, s);
  assert.equal(completionSummary(s, 30).status, 'not-started');
  const formal = openCompletion(dir, 'example', { now: 50, formal: true });
  const r = completionSummary(formal, 70);
  assert.equal(r.wallMs, 20);
  assert.equal(r.ciWaitMs, 0);
  assert.equal(r.postFinalCiMs, 20);
  assert.equal(formal.events.length, 1);
});

test('overlapping writers merge their stage records without losing formal start or reverting completed events', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-writers-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = openCompletion(dir, 'example', { now: 10, formal: false }),
    b = openCompletion(dir, 'example', { now: 50, formal: true });
  let release;
  const pending = completionStage(
    a,
    'ci',
    'one',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    { save: (s) => saveCompletion(dir, s), now: () => 60 },
  );
  await completionStage(b, 'handoff', 'two', async () => ({ ok: true }), {
    save: (s) => saveCompletion(dir, s),
    now: () => 70,
  });
  release({ ok: true });
  await pending;
  const merged = openCompletion(dir, 'example', { formal: false });
  assert.equal(merged.startedAt, 50);
  assert.equal(merged.events.length, 2);
  assert.ok(merged.events.every((e) => e.status === 'success'));
});

test('a completed failed event cannot be rewritten as a successful event', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-immutable-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = openCompletion(dir, 'example', { now: 1 });
  s.events.push({ id: 'first-failure', name: 'ci', key: 'head:1', startedAt: 1, finishedAt: 2, status: 'failure' });
  saveCompletion(dir, s);
  s.events[0].status = 'success';
  s.events[0].finishedAt = 3;
  assert.throws(() => saveCompletion(dir, s), /immutable/);
  assert.equal(openCompletion(dir, 'example').events[0].status, 'failure');
});

test('single CI wait reports changed job steps at bounded cadence and still queries final required gates', async () => {
  let clock = 0,
    reads = 0;
  const messages = [];
  const head = 'a'.repeat(40);
  const result = await waitQuality({
    runId: 42,
    expectedHead: head,
    now: () => clock,
    readRun: async () => ({
      id: 42,
      head_sha: head,
      run_attempt: 1,
      path: '.github/workflows/quality.yml',
      status: clock >= 140000 ? 'completed' : 'in_progress',
      conclusion: clock >= 140000 ? 'success' : null,
    }),
    readJobs: async () => {
      reads++;
      return clock >= 140000
        ? ['Frontend quality', 'Backend quality'].map((name) => ({ name, conclusion: 'success' }))
        : [
            {
              name: 'E2E',
              status: 'in_progress',
              steps: [{ name: clock < 60000 ? 'prepare' : 'test', status: 'in_progress' }],
            },
          ];
    },
    wait: async (ms) => {
      clock += ms;
    },
    report: (s) => messages.push(s),
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(reads, 4, 'three bounded progress reads plus mandatory final gate read');
  assert.equal(messages.filter((m) => m.includes(' jobs: ')).length, 2, 'unchanged progress is quiet');
  assert.ok(messages.some((m) => m.includes('prepare')));
  assert.ok(messages.some((m) => m.includes('test')));
});

test('connection recovery is timed separately and never becomes a test retry', async () => {
  let clock = 0,
    reads = 0;
  const result = await waitQuality({
    runId: 1,
    expectedHead: 'a'.repeat(40),
    now: () => clock,
    readRun: async () => {
      if (++reads === 1) throw Error('connection');
      return {
        id: 1,
        head_sha: 'a'.repeat(40),
        run_attempt: 1,
        path: '.github/workflows/quality.yml',
        status: 'completed',
        conclusion: 'success',
      };
    },
    readJobs: async () => ['Frontend quality', 'Backend quality'].map((name) => ({ name, conclusion: 'success' })),
    wait: async (ms) => {
      clock += ms;
    },
    report: () => {},
  });
  assert.equal(result.attempt, 1);
  assert.equal(result.networkObservations[0].durationMs, 10000);
  assert.equal(result.networkObservations[0].recovered, true);
});
