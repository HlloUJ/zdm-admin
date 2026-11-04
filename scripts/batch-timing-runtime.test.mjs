import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTimeline, refreshTimeline, recordValidationTiming } from './batch-timing-store.mjs';
import {
  requireBatchTiming,
  requireBatchTimingForCleanup,
  reconcileInterruptedValidationTiming,
  inspectValidationProcesses,
} from './batch-timing-runtime.mjs';
import { runVerificationTask } from './verification-runner.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'batch-timing-entry-')));
  const anchor = path.join(root, 'main'),
    task = path.join(root, 'task');
  mkdirSync(anchor);
  const git = (...args) => execFileSync('git', args, { cwd: anchor, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(anchor, '.gitignore'), '.task-verification/\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('worktree', 'add', '-b', 'codex/timing', task);
  const home = path.join(root, 'codex'),
    sessions = path.join(home, 'sessions');
  mkdirSync(sessions, { recursive: true });
  const thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    file = path.join(sessions, 'rollout-entry-' + thread + '.jsonl'),
    at = Date.now() - 100;
  const row = (type, payload, time) =>
    JSON.stringify({ timestamp: new Date(time).toISOString(), type, payload }) + '\n';
  writeFileSync(
    file,
    row('session_meta', { id: thread, cwd: anchor }, at - 1) +
      row('event_msg', { type: 'task_started', turn_id: 'one' }, at) +
      row('turn_context', { turn_id: 'one', cwd: anchor }, at) +
      row(
        'event_msg',
        { type: 'item_completed', turn_id: 'one', item: { type: 'UserMessage', id: 'request', content: [] } },
        at + 1,
      ),
  );
  const env = { PATH: process.env.PATH, HOME: os.homedir(), CODEX_HOME: home, CODEX_THREAD_ID: thread };
  const cli = (file, args = []) =>
    spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], {
      cwd: task,
      env,
      encoding: 'utf8',
    });
  const registration = cli('./task-batch.mjs', ['register', '--id', 'timing', '--kind', 'infrastructure']);
  assert.equal(registration.status, 0, registration.stderr);
  const common = path.join(anchor, '.git');
  t.after(() => {
    try {
      const owner = JSON.parse(readFileSync(path.join(common, 'task-timing/timing/observer.json')));
      process.kill(owner.pid, 'SIGTERM');
    } catch {
      /* stopped collector */
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, anchor, task, common, cli, env, file, row, at };
}
test('actual registration CLI automatically starts timing; real failed verification enters batch report without zero repair claim', async (t) => {
  const f = fixture(t);
  const initial = readTimeline(f.common, 'timing');
  assert.equal(initial.requestId, 'request');
  const result = await runVerificationTask(
    {
      root: f.task,
      name: 'intentional failure',
      command: process.execPath,
      args: ['-e', 'process.exit(7)'],
      env: f.env,
      reuse: false,
    },
    { report: () => {} },
  );
  assert.equal(result.exitCode, 7);
  const { summary, state } = refreshTimeline(f.common, 'timing');
  assert.equal(state.validations.length, 1);
  assert.equal(summary.localFailedAttempts, 1);
  assert.equal(summary.localPendingAttempts, 0);
  assert.ok(summary.localValidationMs >= 0);
  assert.equal(summary.localRepairMs, null);
  const report = f.cli('./task-timing.mjs', ['--batch', 'timing', '--json']);
  assert.equal(report.status, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).batch, 'timing');
  assert.equal(JSON.parse(report.stdout).localFailedAttempts, 1);
  assertTimingReadyWithUnfinished(f);
});
function assertTimingReadyWithUnfinished(f) {
  recordValidationTiming(f.common, 'timing', {
    attemptId: 'unclosed',
    startedAt: new Date().toISOString(),
    status: 'running',
  });
  assert.throws(() => requireBatchTiming(f.common, 'timing'), /Unfinished local validation/);
}
test('source damage is blocked by the actual cleanup precondition and original completion receipts remain untouched', (t) => {
  const f = fixture(t);
  const directory = path.join(f.common, 'task-delivery/timing');
  mkdirSync(directory, { recursive: true });
  const receipt = path.join(directory, 'completion-receipt.json');
  const original = JSON.stringify({ summary: { timingVersion: 2, wallMs: 123 }, historical: true });
  writeFileSync(receipt, original);
  writeFileSync(f.file, '');
  assert.throws(() => requireBatchTiming(f.common, 'timing'), /boundary proof incomplete/);
  assert.equal(readFileSync(receipt, 'utf8'), original);
});
test('wrong thread cannot silently observe or take over an active batch', (t) => {
  const f = fixture(t);
  appendFileSync(f.file, f.row('event_msg', { type: 'task_complete', turn_id: 'one' }, Date.now()));
  assert.equal(refreshTimeline(f.common, 'timing').state.turns[0].finishedAt != null, true);
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {refreshCurrentTiming}from${JSON.stringify(new URL('./batch-timing-runtime.mjs', import.meta.url).href)};refreshCurrentTiming(${JSON.stringify(f.task)});`,
    ],
    { cwd: f.task, env: { ...f.env, CODEX_THREAD_ID: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not bound/);
});

test('a new timing record cannot disappear into legacy compatibility or silently reset its authorization', (t) => {
  const f = fixture(t);
  rmSync(path.join(f.common, 'task-timing/timing/timeline.json'));
  assert.throws(() => requireBatchTiming(f.common, 'timing'), /New batch timing proof missing/);
  const result = f.cli('./task-batch.mjs', ['register', '--id', 'timing', '--kind', 'infrastructure']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /never reset authorization/);
});

test('authorization tampering cannot pass the report/cleanup proof', (t) => {
  const f = fixture(t),
    file = path.join(f.common, 'task-timing/timing/timeline.json'),
    state = JSON.parse(readFileSync(file));
  state.authorizedAt += 10;
  writeFileSync(file, JSON.stringify(state));
  assert.throws(() => requireBatchTiming(f.common, 'timing'), /Authorization boundary changed/);
});

function interruptedFixture(t) {
  const f = fixture(t),
    now = Date.now(),
    startedAt = new Date(now - 20).toISOString();
  const original = { attemptId: 'legacy', fingerprint: 'f'.repeat(64), status: 'running', startedAt };
  recordValidationTiming(f.common, 'timing', original);
  const file = '.task-verification/attempts/' + 'f'.repeat(64) + '/legacy.started.json';
  mkdirSync(path.dirname(path.join(f.task, file)), { recursive: true });
  const bytes = JSON.stringify(original);
  writeFileSync(path.join(f.task, file), bytes);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const directory = path.join(f.common, 'task-assets/timing');
  mkdirSync(path.join(directory, 'blobs'), { recursive: true });
  writeFileSync(path.join(directory, 'blobs', digest(bytes)), bytes);
  const assets = JSON.stringify([{ file, digest: digest(bytes) }]);
  const manifest = path.join(directory, 'assets-' + digest(assets) + '.json');
  writeFileSync(manifest, assets);
  const head = 'a'.repeat(40),
    key = head + ':123';
  const completion = {
    events: [
      {
        name: 'ci',
        key,
        status: 'success',
        startedAt: now - 10,
        finishedAt: now - 5,
        result: {
          headSha: head,
          runId: '123',
          branch: 'main',
          attempt: 1,
          conclusion: 'success',
          jobs: ['Frontend quality', 'Backend quality'].map((name) => ({
            name,
            status: 'completed',
            conclusion: 'success',
          })),
        },
      },
      {
        name: 'evidence',
        key,
        status: 'success',
        result: { head, runId: '123', coverage: { frontend: 1, backend: { tests: 1 } } },
      },
      {
        name: 'handoff',
        key,
        status: 'success',
        result: { runtimeHealthy: true, integrationHealthy: true, backupRetained: true },
      },
      { name: 'preserve', key, status: 'success', result: { manifest } },
    ],
  };
  return { ...f, file, bytes, manifest, options: { root: f.task, completion, key, now } };
}
test('cleanup reconciliation preserves immutable starts, requires gates and preservation, and is idempotent', (t) => {
  const f = interruptedFixture(t);
  for (const missing of ['ci', 'evidence', 'handoff', 'preserve']) {
    const options = structuredClone(f.options);
    options.completion.events = options.completion.events.filter((e) => e.name !== missing);
    assert.throws(() => reconcileInterruptedValidationTiming(f.common, 'timing', options), /required/);
  }
  const failed = structuredClone(f.options);
  failed.completion.events[0].result.jobs[0].conclusion = 'failure';
  assert.throws(() => reconcileInterruptedValidationTiming(f.common, 'timing', failed));
  const wrongHead = structuredClone(f.options);
  wrongHead.completion.events[1].result.head = 'b'.repeat(40);
  assert.throws(() => reconcileInterruptedValidationTiming(f.common, 'timing', wrongHead));
  const later = structuredClone(f.options);
  later.completion.events[0].startedAt = Date.parse(JSON.parse(f.bytes).startedAt) - 1;
  assert.throws(() => reconcileInterruptedValidationTiming(f.common, 'timing', later), /newer validation/);
  assert.throws(() => requireBatchTiming(f.common, 'timing'), /Unfinished local validation/);
  const result = reconcileInterruptedValidationTiming(f.common, 'timing', f.options);
  assert.deepEqual(result, { interrupted: 1, durationMs: null });
  assert.equal(readFileSync(path.join(f.task, f.file), 'utf8'), f.bytes);
  const state = readTimeline(f.common, 'timing');
  assert.equal(state.validations[0].finishedAt, null);
  assert.equal(state.validationInterruptions[0].durationMs, null);
  assert.equal(requireBatchTiming(f.common, 'timing').localUnknownDurationAttempts[0], 'legacy');
  assert.deepEqual(reconcileInterruptedValidationTiming(f.common, 'timing', f.options), { interrupted: 0 });
});
test('a real active task process blocks reconciliation; exit permits the same preserved record', async (t) => {
  const f = interruptedFixture(t);
  const child = spawn(process.execPath, ['-e', "process.send('ready');setInterval(()=>{},1000)"], {
    cwd: f.task,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  await once(child, 'message');
  try {
    assert.throws(() => inspectValidationProcesses(f.task), /processes remain active/);
    assert.throws(() => reconcileInterruptedValidationTiming(f.common, 'timing', f.options), /processes remain active/);
    assert.equal(readTimeline(f.common, 'timing').validationInterruptions, undefined);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  assert.equal(reconcileInterruptedValidationTiming(f.common, 'timing', f.options).interrupted, 1);
});
test('unknown process inspection, damaged preservation and real completion never become interrupted success', (t) => {
  const f = interruptedFixture(t),
    previous = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.throws(() => inspectValidationProcesses(f.task), /inspection unavailable/);
  } finally {
    process.env.PATH = previous;
  }
  const completion = path.join(f.task, f.file.replace('.started.json', '.json'));
  writeFileSync(completion, '{}');
  assert.throws(() => reconcileInterruptedValidationTiming(f.common, 'timing', f.options), /Completion exists/);
  rmSync(completion);
  writeFileSync(f.manifest, '[]');
  assert.throws(() => reconcileInterruptedValidationTiming(f.common, 'timing', f.options));
  assert.equal(readTimeline(f.common, 'timing').validationInterruptions, undefined);
  assert.equal(readFileSync(path.join(f.task, f.file), 'utf8'), f.bytes);
});

test('optional timing observation reports errors without hiding actual verification failures', async (t) => {
  const f = fixture(t);
  const { observeCurrentTiming } = await import('./batch-timing-runtime.mjs');
  const reports = [];
  const observed = observeCurrentTiming(f.task, { env: { ...f.env, CODEX_THREAD_ID: 'unbound' } }, (s) =>
    reports.push(s),
  );
  assert.equal(observed.status, 'unavailable');
  assert.equal(
    observeCurrentTiming(f.task, { env: { ...f.env, CODEX_THREAD_ID: 'unbound' } }, () => {
      throw new Error('report unavailable');
    }).status,
    'unavailable',
  );
  assert.match(reports[0], /not bound/);
  const result = await runVerificationTask(
    {
      root: f.task,
      name: 'quality still fails',
      command: process.execPath,
      args: ['-e', 'process.exit(9)'],
      env: f.env,
      reuse: false,
    },
    { report: () => {} },
  );
  assert.equal(result.exitCode, 9);
  assert.equal(readTimeline(f.common, 'timing').sources.length, 1);
});

test('another worktree never observes or writes the active business timeline', async (t) => {
  const f = fixture(t);
  const { refreshCurrentTiming, observeValidationTiming, currentTimingSummary } =
    await import('./batch-timing-runtime.mjs');
  const before = readFileSync(path.join(f.common, 'task-timing/timing/timeline.json'), 'utf8');
  assert.equal(refreshCurrentTiming(f.anchor, { env: f.env }).status, 'outside-active-batch');
  observeValidationTiming(
    f.anchor,
    { attemptId: 'foreign', startedAt: new Date().toISOString(), status: 'running' },
    f.env,
  );
  assert.equal(currentTimingSummary(f.anchor), null);
  assert.equal(readFileSync(path.join(f.common, 'task-timing/timing/timeline.json'), 'utf8'), before);
});

test('actual changed-check CLI continues after timing damage and preserves its quality exit code', (t) => {
  const f = fixture(t);
  writeFileSync(
    path.join(f.task, 'package.json'),
    JSON.stringify({ scripts: { 'verify:local': 'node -e "process.exit(7)"' } }),
  );
  const env = { ...f.env, CODEX_THREAD_ID: 'unbound' };
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./check-changed.mjs', import.meta.url)), 'package.json'],
    { cwd: f.task, env, encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Batch timing observation unavailable/);
  assert.match(result.stdout, /shared configuration checks/);
  assert.doesNotMatch(result.stdout, /Missing script/);
  const failedAttempt = refreshTimeline(f.common, 'timing').state.validations.find((v) => v.status === 'failed');
  assert.ok(failedAttempt);
  assert.doesNotMatch(result.stderr, /AssertionError/);
});

test('cleanup accepts only a proved historical boundary gap while strict reports, identity and concurrency checks remain intact', (t) => {
  const f = fixture(t),
    file = path.join(f.common, 'task-timing/timing/timeline.json');
  appendFileSync(f.file, f.row('event_msg', { type: 'turn_aborted', turn_id: 'one' }, f.at + 20));
  const state = refreshTimeline(f.common, 'timing').state;
  state.registeredAt = f.at + 50;
  writeFileSync(file, JSON.stringify(state));
  assert.throws(() => requireBatchTiming(f.common, 'timing'), /authorization-turn-ended-before-registration/);
  const result = requireBatchTimingForCleanup(f.common, 'timing');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.wallMs, null);
  assert.ok(result.issues.includes('authorization-turn-ended-before-registration'));
  const original = readFileSync(file);
  const tampered = JSON.parse(original);
  tampered.authorizedAt += 1;
  writeFileSync(file, JSON.stringify(tampered));
  assert.throws(() => requireBatchTimingForCleanup(f.common, 'timing'), /Authorization boundary changed/);
  writeFileSync(file, original);
  const concurrent = JSON.parse(original);
  concurrent.turns.push(
    ...['two', 'three'].map((id) => ({
      id,
      thread: 'foreign',
      startedAt: Date.now(),
      finishedAt: null,
      projectVerified: true,
    })),
  );
  writeFileSync(file, JSON.stringify(concurrent));
  assert.throws(() => requireBatchTimingForCleanup(f.common, 'timing'), /Multiple open execution turns/);
  writeFileSync(file, original);
  const damaged = JSON.parse(original);
  damaged.issues.push('native-source-unavailable:ENOENT');
  writeFileSync(file, JSON.stringify(damaged));
  assert.throws(() => requireBatchTimingForCleanup(f.common, 'timing'), /native-source-unavailable/);
});
