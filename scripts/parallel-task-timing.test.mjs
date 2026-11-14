import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  summarizeProcessTiming,
  observeEntry,
  observeBinding,
  observeValidation,
  readParallelTiming,
  entryPhase,
} from './parallel-task-timing.mjs';
const row = (id, start, end) => ({ task: { id, createdAt: 0 }, intervals: [{ phase: 'validation', start, end }] });
test('parallel wall uses union, overlap counts distinct tasks, not sum or nested steps', () => {
  const a = row('a', 0, 100);
  a.intervals.push({ phase: 'ci', start: 20, end: 60 });
  const report = summarizeProcessTiming([a, row('b', 50, 150)], { now: 200 });
  assert.equal(report.observedProcessWallMs, 150);
  assert.equal(report.parallelOverlapMs, 50);
  assert.equal(report.sumTaskProcessMs, 200);
  assert.equal(report.waitingWallMs, 40);
  assert.equal(report.tasks[0].unknownMs, 100);
  assert.equal(report.tasks[0].wholeTaskWallMs, null);
});
test('unfinished process is unknown, not timed until now; duplicate or conflicting endpoints rejected', () => {
  const events = [{ task: 'a', id: 'one', kind: 'start', phase: 'development', at: 1 }];
  let r = summarizeProcessTiming([{ task: { id: 'a', createdAt: 0 }, events }], { now: 100 });
  assert.equal(r.tasks[0].pending.length, 1);
  assert.equal(r.observedProcessWallMs, 0);
  r = summarizeProcessTiming([{ task: { id: 'a', createdAt: 0 }, events: [...events, ...events] }], { now: 100 });
  assert.equal(r.tasks[0].status, 'incomplete');
  assert.equal(r.observedProcessWallMs, 0);
});
function fixture(t) {
  const common = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'parallel-timing-')));
  t.after(() => rmSync(common, { recursive: true, force: true }));
  return common;
}
test('entry records isolated task success/failure without arguments, read queries do not record', (t) => {
  const common = fixture(t),
    registry = { commonDir: common, resolve: () => ({ id: 'a' }) };
  let at = 0;
  const run = (command, args, result) =>
    observeEntry({ command, originalArgs: args, cwd: common }, registry, () => result, { now: () => ++at });
  assert.equal(run('work', ['checkpoint', '--verification', 'PRIVATE'], { status: 0 }).status, 0);
  assert.equal(run('complete', ['deliver'], { status: 1 }).status, 1);
  run('work', ['status'], { status: 0 });
  const dir = path.join(common, 'task-timing-events/a'),
    files = readdirSync(dir);
  assert.equal(files.length, 4);
  assert.ok(files.every((f) => !readFileSync(path.join(dir, f), 'utf8').includes('PRIVATE')));
  const r = readParallelTiming(common, [{ id: 'a', createdAt: 0, worktree: path.join(common, 'missing') }], {
    now: 10,
  });
  assert.equal(r.tasks[0].phases.length, 2);
  assert.equal(r.tasks[0].phases[1].status, 'failed');
  assert.equal(entryPhase('complete', ['plan']), null);
});
test('missing native binding persists explicit reason, never synthesizes user authorization', (t) => {
  const common = fixture(t),
    messages = [];
  observeBinding(
    { id: 'a', repository: { commonDir: common } },
    { status: 'unavailable', reason: 'Native timing session missing' },
    (m) => messages.push(m),
  );
  const r = readParallelTiming(common, [{ id: 'a', createdAt: 0, worktree: path.join(common, 'missing') }]);
  assert.equal(r.tasks[0].binding.reason, 'Native timing session missing');
  assert.equal(r.tasks[0].wholeTaskWallMs, null);
  assert.equal(messages.length, 1);
});
test('reads existing formal data without mutation; unknown upper bounds not execution durations', (t) => {
  const common = fixture(t),
    dir = path.join(common, 'task-delivery/a');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'completion-session.json'),
    bytes = JSON.stringify({
      version: 1,
      batch: 'a',
      startedAt: 10,
      events: [
        { name: 'ci', startedAt: 10, finishedAt: 50 },
        { name: 'prepare', startedAt: 0, finishedAt: 60, durationBasis: 'upper-bound-until-recovery' },
        { name: 'merge', startedAt: 50 },
      ],
    });
  writeFileSync(file, bytes);
  const r = readParallelTiming(common, [{ id: 'a', createdAt: 0, worktree: path.join(common, 'missing') }], {
    now: 100,
  });
  assert.equal(r.observedProcessWallMs, 40);
  assert.equal(r.waitingWallMs, 40);
  assert.equal(r.tasks[0].issues.length, 2);
  assert.equal(readFileSync(file, 'utf8'), bytes);
});
test('malformed and symlinked evidence never becomes zero-error successful timing', (t) => {
  const common = fixture(t),
    dir = path.join(common, 'task-timing-events/a');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bad.json'), '{');
  let r = readParallelTiming(common, [{ id: 'a', createdAt: 0, worktree: common }], { now: 100 });
  assert.equal(r.tasks[0].status, 'incomplete');
  symlinkSync(dir, path.join(common, 'task-timing-events/b'));
  r = readParallelTiming(common, [{ id: 'b', createdAt: 0, worktree: common }], { now: 100 });
  assert.equal(r.tasks[0].status, 'incomplete');
});
test('completed native report retained separately; empty selection and future times not invented', () => {
  let r = summarizeProcessTiming([], { now: 100 });
  assert.equal(r.observedProcessWallMs, 0);
  r = summarizeProcessTiming([{ ...row('a', 0, 200), native: { status: 'completed', wallMs: 90 } }], { now: 100 });
  assert.equal(r.tasks[0].wholeTaskWallMs, 90);
  assert.equal(r.tasks[0].status, 'incomplete');
  assert.equal(r.observedProcessWallMs, 0);
});

test('validation lifecycle survives worktree cleanup and duplicate observation is idempotent', (t) => {
  const common = fixture(t),
    task = { id: 'a', createdAt: 0, worktree: path.join(common, 'gone'), repository: { commonDir: common } };
  const attempt = { attemptId: 'validation-one', startedAt: new Date(10).toISOString(), status: 'running' };
  observeValidation(task, attempt);
  observeValidation(task, attempt);
  observeValidation(task, { ...attempt, completedAt: new Date(30).toISOString(), status: 'passed' });
  const r = readParallelTiming(common, [task], { now: 100 });
  assert.equal(r.tasks[0].pending.length, 0);
  assert.equal(r.observedProcessWallMs, 20);
  assert.equal(readdirSync(path.join(common, 'task-timing-events/a')).length, 2);
});
test('measure accepts only explicit phases and does not turn status queries into work', () => {
  assert.equal(entryPhase('measure', ['resource-wait']), 'resource-wait');
  assert.throws(() => entryPhase('measure', ['arbitrary']));
});

test('observation and broken logger cannot replace a command result', () => {
  const registry = {
    commonDir: '/missing',
    resolve() {
      throw Error('unavailable');
    },
  };
  const result = observeEntry(
    { command: 'work', originalArgs: ['checkpoint'], cwd: '/missing' },
    registry,
    () => ({ status: 17 }),
    {
      report() {
        throw Error('closed output');
      },
    },
  );
  assert.equal(result.status, 17);
});

test('actual CLI measures registered task command, preserves exit code and reads parallel report without mutation', (t) => {
  const dir = fixture(t),
    root = path.join(dir, 'main');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'base'), 'base');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const worktree = path.join(dir, 'task-a');
  git('worktree', 'add', '-b', 'codex/a', worktree);
  const registry = createTaskRegistry(root);
  registry.register({ id: 'a', worktree, owner: 'fixture' });
  const script = fileURLToPath(new URL('./task-timing.mjs', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [script, '--measure', 'development', '--', process.execPath, '-e', 'process.exit(7)', 'PRIVATE-ARG'],
    { cwd: worktree, encoding: 'utf8' },
  );
  assert.equal(result.status, 7, result.stderr);
  const eventDir = path.join(registry.commonDir, 'task-timing-events/a'),
    before = readdirSync(eventDir).sort();
  assert.ok(before.every((f) => !readFileSync(path.join(eventDir, f), 'utf8').includes('PRIVATE-ARG')));
  const report = spawnSync(process.execPath, [script, '--parallel', '--json'], { cwd: worktree, encoding: 'utf8' });
  assert.equal(report.status, 0, report.stderr);
  const data = JSON.parse(report.stdout);
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].phases[0].status, 'failed');
  assert.equal(data.tasks[0].wholeTaskWallMs, null);
  assert.deepEqual(readdirSync(eventDir).sort(), before);
});

test('old verification starts remain pending and persistent duplicate records count once', (t) => {
  const common = fixture(t),
    worktree = path.join(common, 'worktree'),
    dir = path.join(worktree, '.task-verification/attempts/key');
  mkdirSync(dir, { recursive: true });
  const a = {
    identity: { root: worktree },
    attemptId: 'old',
    startedAt: new Date(10).toISOString(),
    status: 'running',
  };
  writeFileSync(path.join(dir, 'old.started.json'), JSON.stringify(a));
  const task = { id: 'a', createdAt: 0, worktree, repository: { commonDir: common } };
  let r = readParallelTiming(common, [task], { now: 100 });
  assert.equal(r.tasks[0].pending.length, 1);
  assert.equal(r.observedProcessWallMs, 0);
  const completed = { ...a, completedAt: new Date(30).toISOString(), status: 'passed' };
  writeFileSync(path.join(dir, 'old.json'), JSON.stringify(completed));
  observeValidation(task, completed);
  r = readParallelTiming(common, [task], { now: 100 });
  assert.equal(r.tasks[0].pending.length, 0);
  assert.equal(r.tasks[0].phases.length, 1);
  assert.equal(r.observedProcessWallMs, 20);
});

test('persisted start recovers verified local end; foreign and unidentified reports remain unknown', (t) => {
  const common = fixture(t),
    worktree = path.join(common, 'w'),
    dir = path.join(worktree, '.task-verification/attempts/k');
  mkdirSync(dir, { recursive: true });
  const task = { id: 'a', createdAt: 0, worktree, repository: { commonDir: common } };
  const a = {
    attemptId: 'recover',
    identity: { root: worktree },
    startedAt: new Date(10).toISOString(),
    completedAt: new Date(30).toISOString(),
    status: 'passed',
  };
  observeValidation(task, { ...a, completedAt: null });
  writeFileSync(path.join(dir, 'done.json'), JSON.stringify(a));
  writeFileSync(
    path.join(dir, 'foreign.json'),
    JSON.stringify({ ...a, attemptId: 'foreign', identity: { root: path.join(common, 'other') } }),
  );
  writeFileSync(path.join(dir, 'unknown.json'), JSON.stringify({ ...a, attemptId: 'unknown', identity: undefined }));
  const r = readParallelTiming(common, [task], { now: 100 });
  assert.equal(r.observedProcessWallMs, 20);
  assert.equal(r.tasks[0].pending.length, 0);
  assert.equal(r.tasks[0].phases.length, 1);
  assert.equal(r.tasks[0].issues.filter((x) => x.startsWith('unverified-validation-identity:')).length, 2);
});

test('conflicting completed evidence is excluded rather than counted as certain work', (t) => {
  const common = fixture(t),
    worktree = path.join(common, 'w'),
    dir = path.join(worktree, '.task-verification/attempts/k');
  mkdirSync(dir, { recursive: true });
  const task = { id: 'a', createdAt: 0, worktree, repository: { commonDir: common } };
  const a = {
    attemptId: 'conflict',
    identity: { root: worktree },
    startedAt: new Date(10).toISOString(),
    completedAt: new Date(30).toISOString(),
    status: 'passed',
  };
  observeValidation(task, a);
  writeFileSync(path.join(dir, 'done.json'), JSON.stringify({ ...a, completedAt: new Date(40).toISOString() }));
  const r = readParallelTiming(common, [task], { now: 100 });
  assert.equal(r.observedProcessWallMs, 0);
  assert.ok(r.tasks[0].issues.includes('conflicting-validation:conflict'));
});
