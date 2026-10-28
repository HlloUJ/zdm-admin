import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTimeline, refreshTimeline, recordValidationTiming } from './batch-timing-store.mjs';
import { requireBatchTiming } from './batch-timing-runtime.mjs';
import { runVerificationTask } from './verification-runner.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'batch-timing-entry-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
