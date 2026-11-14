import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { collectTaskProgress } from './task-progress-collector.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'progress-collector-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(root, 'base'), 'test');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const worktree = path.join(root, 'work');
  git('worktree', 'add', '-b', 'codex/test', worktree);
  const registry = createTaskRegistry(root);
  const task = registry.register({ id: 'test', worktree, owner: 'owner' });
  const file = path.join(registry.commonDir, 'task-registry/tasks/test.json');
  const monitoring = {
    state: 'registered',
    owner: 'owner',
    paused: false,
    taskNumber: '284',
    taskName: 'test',
    taskStableId: 'stable-test',
    roomId: 'room',
    worker: '/root/test',
    rootThreadId: 'root',
    authorizationRef: 'approval',
  };
  const save = (value) => writeFileSync(file, JSON.stringify(value));
  const sessionDir = path.join(registry.commonDir, 'task-delivery/test');
  mkdirSync(sessionDir, { recursive: true });
  const session = path.join(sessionDir, 'completion-session.json');
  return { root, task, file, monitoring, save, session };
}
test('only enrolled tasks; identity metadata, missing context and evidence remain explicit', (t) => {
  const f = fixture(t);
  const old = { ...f.task };
  delete old.monitoring;
  f.save(old);
  assert.deepEqual(collectTaskProgress(f.root), []);
  f.save({ ...old, monitoring: { state: 'pending-context' } });
  assert.equal(collectTaskProgress(f.root)[0].status, 'registration-incomplete');
  f.save({ ...old, monitoring: f.monitoring });
  const result = collectTaskProgress(f.root)[0];
  assert.equal(result.status, 'unknown');
  assert.equal(result.taskNumber, '284');
  assert.equal(result.worker, '/root/test');
  assert.equal(result.roomId, 'room');
});
test('closed, explicit monitoring/session pauses and malformed evidence never alert', (t) => {
  const f = fixture(t);
  const save = (extra = {}) => f.save({ ...f.task, monitoring: f.monitoring, ...extra });
  save({ stage: 'closed' });
  assert.equal(collectTaskProgress(f.root)[0].status, 'closed');
  save({ monitoring: { ...f.monitoring, paused: true } });
  assert.equal(collectTaskProgress(f.root)[0].status, 'paused');
  save({ monitoring: { ...f.monitoring, paused: undefined } });
  assert.equal(collectTaskProgress(f.root)[0].status, 'unknown');
  save();
  writeFileSync(f.session, JSON.stringify({ version: 1, batch: 'test', events: [], pauses: [{ id: 'p' }] }));
  assert.equal(collectTaskProgress(f.root)[0].status, 'paused');
  writeFileSync(f.session, '{bad');
  assert.equal(collectTaskProgress(f.root)[0].status, 'unknown');
});
test('real CLI emits registered metadata snapshot only and does not alter registry or session', (t) => {
  const f = fixture(t);
  f.save({ ...f.task, monitoring: f.monitoring });
  writeFileSync(
    f.session,
    JSON.stringify({ version: 1, batch: 'test', events: [{ id: 'failure', name: 'test', status: 'failure' }] }),
  );
  const before = [readFileSync(f.file, 'utf8'), readFileSync(f.session, 'utf8')];
  const cli = fileURLToPath(new URL('./task-continuity-cli.mjs', import.meta.url));
  const out = JSON.parse(
    execFileSync(process.execPath, [cli, '--once', '--task', 'test'], { cwd: f.root, encoding: 'utf8' }),
  );
  assert.equal(out.tasks[0].status, 'blocked');
  assert.equal(out.tasks[0].taskStableId, 'stable-test');
  assert.equal(out.automaticResumptionEnabled, false);
  assert.deepEqual([readFileSync(f.file, 'utf8'), readFileSync(f.session, 'utf8')], before);
  assert.deepEqual(
    JSON.parse(execFileSync(process.execPath, [cli, '--once', '--task', 'other'], { cwd: f.root, encoding: 'utf8' }))
      .tasks,
    [],
  );
});
test('linked session rejected rather than interpreted as interruption', (t) => {
  const f = fixture(t);
  f.save({ ...f.task, monitoring: f.monitoring });
  symlinkSync(f.file, f.session);
  assert.equal(collectTaskProgress(f.root)[0].status, 'unknown');
});
