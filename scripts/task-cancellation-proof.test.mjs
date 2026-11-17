import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync } from 'node:fs';
import { createTaskRegistry } from './task-registry.mjs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createExecutionOrder } from './task-execution-order.mjs';
import { verifyCancellation, observeCancellationHost, parseCancellationOpenFiles } from './task-cancellation-proof.mjs';
const event = (sequence) => ({ sequence, messageId: `user-${sequence}`, roomId: 'room', authorId: 'user' });
function fixture(t) {
  const commonDir = mkdtempSync(path.join(realpathSync(tmpdir()), 'cancel-order-'));
  t.after(() => rmSync(commonDir, { recursive: true, force: true }));
  const task = {
    id: 'fixture-task',
    owner: 'fixture-owner',
    worktree: path.join(commonDir, 'removed-worktree'),
    branch: 'codex/fixture-task',
    recordedHead: 'a'.repeat(40),
    repository: { commonDir },
  };
  const registry = { commonDir, readTask: (id) => (id === task.id ? structuredClone(task) : null) };
  const write = (file, value) => {
    const p = path.join(commonDir, file);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(value));
    return p;
  };
  write('task-registry/start-intents/fixture-task.json', {
    task: task.id,
    owner: task.owner,
    branch: task.branch,
    worktree: task.worktree,
    state: 'registered',
  });
  const queue = createExecutionOrder(commonDir);
  queue.initialize(event(1));
  queue.direct({ action: 'resume-all', request: event(2) });
  for (const [i, id] of [task.id, 'another-task', 'waiting-task', 'later-task'].entries())
    queue.enqueue({ task: id, lane: 'development', owner: task.owner, request: event(i + 3) });
  const first = queue.claim({ task: task.id, lane: 'development', owner: task.owner });
  queue.claim({ task: 'another-task', lane: 'development', owner: task.owner });
  queue.claim({ task: 'waiting-task', lane: 'development', owner: task.owner });
  queue.block({ task: task.id, lane: 'development', owner: task.owner, reason: 'original failure retained' });
  const command = {
    task: task.id,
    lane: 'development',
    owner: task.owner,
    admission: first.admission,
    request: event(20),
  };
  const snapshot = {
    processes: [{ pid: process.pid, ppid: 1, command: 'isolated-proof-test' }],
    files: [{ pid: process.pid, name: '/unrelated-fixture-file' }],
    containers: [],
  };
  const verify = (ticket) => verifyCancellation(registry, ticket, { observe: () => structuredClone(snapshot) });
  return { commonDir, task, registry, queue, write, command, snapshot, verify };
}
test('exact cancellation of absent-source blocked slot preserves audit/order; does not dispatch', (t) => {
  const f = fixture(t);
  const before = f.queue.read();
  const result = f.queue.cancel(f.command, f.verify);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellation.proof.sourcePresent, false);
  assert.equal(result.reason, 'original failure retained');
  for (const key of ['task', 'owner', 'lane', 'admission', 'request', 'order'])
    assert.deepEqual(result[key], before.tickets[0][key]);
  assert.deepEqual(f.queue.read().tickets.slice(1), before.tickets.slice(1));
  assert.deepEqual(f.queue.read().events.slice(0, -1), before.events);
  assert.equal(f.queue.read().tickets[3].status, 'queued');
  const bytes = readFileSync(path.join(f.commonDir, 'task-registry/execution-order/state.json'), 'utf8');
  f.queue.cancel(f.command, () => {
    throw Error('replay must not re-probe');
  });
  assert.equal(readFileSync(path.join(f.commonDir, 'task-registry/execution-order/state.json'), 'utf8'), bytes);
  assert.throws(() => f.queue.claim(f.command));
  assert.throws(() => f.queue.assertAdmission(f.command));
  assert.throws(() => f.queue.direct({ action: 'resume-task', ...f.command, request: event(21) }));
});
test('denials never mutate queue: running, wrong owner/admission/lane/user/sequence and untrusted booleans', (t) => {
  const f = fixture(t);
  const before = f.queue.read();
  const invalid = [
    { owner: 'other' },
    { admission: 'other' },
    { lane: 'delivery' },
    { request: { ...event(21), authorId: 'other' } },
    { request: { ...event(21), roomId: 'other' } },
    { request: event(5) },
    { task: 'another-task' },
  ];
  for (const change of invalid) assert.throws(() => f.queue.cancel({ ...f.command, ...change }, f.verify));
  assert.throws(() => f.queue.cancel(f.command, () => true));
  assert.throws(() => f.queue.cancel(f.command));
  assert.deepEqual(f.queue.read(), before);
});
test('live task process, open deleted file, container and inspection failure all refuse absent source', (t) => {
  for (const type of ['process', 'file', 'container', 'permission', 'empty']) {
    const f = fixture(t);
    const before = f.queue.read();
    if (type === 'process')
      f.snapshot.processes.push({ pid: 123, ppid: 1, command: `node ${f.task.worktree}/run.mjs` });
    if (type === 'file') f.snapshot.files.push({ pid: 123, name: f.task.worktree + '/deleted.log (deleted)' });
    if (type === 'container') f.snapshot.containers.push({ labels: {}, mounts: [{ Source: f.task.worktree }] });
    if (type === 'empty') f.snapshot.processes = [];
    const verify =
      type === 'permission'
        ? () => {
            throw Object.assign(Error('permission denied'), { code: 'EPERM' });
          }
        : f.verify;
    assert.throws(() => f.queue.cancel(f.command, verify));
    assert.deepEqual(f.queue.read(), before);
  }
});
test('retained locks, pending launch journals, resources, start uncertainty and main tickets are preserved', (t) => {
  for (const type of ['lock', 'journal', 'lease', 'unknownLease', 'start', 'main', 'linked']) {
    const f = fixture(t);
    const before = f.queue.read();
    if (type === 'lock') mkdirSync(path.join(f.task.worktree, '.task-verification/test.lock'), { recursive: true });
    if (type === 'journal') f.write('removed-worktree/.task-runtime/process-x.json', { status: 'pending' });
    if (type === 'lease')
      f.write('task-registry/resource-leases/task-preview-fixture-task/owner.json', {
        task: f.task.id,
        token: 'x',
        pid: 1,
      });
    if (type === 'unknownLease')
      mkdirSync(path.join(f.commonDir, 'task-registry/resource-leases/main-sync'), { recursive: true });
    if (type === 'start') f.write('task-registry/start-intents/fixture-task.json', { task: f.task.id });
    if (type === 'main') f.write('task-registry/delivery-queue.json', { tickets: [{ task: f.task.id }] });
    if (type === 'linked') symlinkSync('/tmp', f.task.worktree);
    assert.throws(() => f.queue.cancel(f.command, f.verify));
    assert.deepEqual(f.queue.read(), before);
  }
});
test('resources changing between live probes refuse cancellation without modifying first failure', (t) => {
  const f = fixture(t);
  const before = f.queue.read();
  let calls = 0;
  assert.throws(() =>
    f.queue.cancel(f.command, (ticket) =>
      verifyCancellation(f.registry, ticket, {
        observe: () => {
          if (++calls === 2)
            f.write('task-registry/resource-leases/main-sync/owner.json', { task: f.task.owner, token: 'x', pid: 12 });
          return structuredClone(f.snapshot);
        },
      }),
    ),
  );
  assert.deepEqual(f.queue.read(), before);
});
test('CLI production adapter cannot take caller safe=true; observations fail closed on unknown host output', () => {
  const cli = readFileSync(new URL('./task-execution-order-cli.mjs', import.meta.url), 'utf8');
  assert.match(cli, /queue.cancel\(input, \(ticket\) => verifyCancellation\(registry, ticket\)\)/);
  assert.throws(() => observeCancellationHost(() => '', { DOCKER_HOST: 'unix:///fixture.sock' }), /process|inventory/);
  assert.throws(() => observeCancellationHost(() => 'garbled', { DOCKER_HOST: 'unix:///fixture.sock' }), /inventory/);
});

test('remote Docker context refused before process inventory; similar task names are not this task', (t) => {
  assert.throws(
    () =>
      observeCancellationHost(
        () => {
          throw Error('must not query');
        },
        { DOCKER_HOST: 'ssh://remote-host' },
      ),
    /local Unix/,
  );
  assert.throws(
    () => observeCancellationHost(() => JSON.stringify('tcp://localhost:2375'), { DOCKER_CONTEXT: 'remote' }),
    /local Unix/,
  );
  const f = fixture(t);
  f.snapshot.processes.push({ pid: 123, ppid: 1, command: 'node /other/fixture-task-extra/run.js' });
  assert.equal(f.queue.cancel(f.command, f.verify).status, 'cancelled');
});

test('published entry on isolated real Git/FIFO routes plan and cancel, fails closed and replays without mutation', (t) => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'cancel-entry-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'main');
  mkdirSync(root);
  cpSync(new URL('.', import.meta.url), path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, '.codex'));
  writeFileSync(path.join(root, '.codex/zdm-project-workflow.yaml'), 'batch:\n  mode: parallel-independent\n');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.');
  git('commit', '-m', 'isolated published entry');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const worktree = path.join(base, 'task');
  git('worktree', 'add', '-b', 'codex/task', worktree);
  const registry = createTaskRegistry(root);
  registry.register({ id: 'task', worktree, owner: 'fixture-owner' });
  const queue = createExecutionOrder(registry.commonDir);
  queue.initialize(event(1));
  queue.direct({ action: 'resume-all', request: event(2) });
  queue.enqueue({ lane: 'development', task: 'task', owner: 'fixture-owner', request: event(3) });
  const ticket = queue.claim({ lane: 'development', task: 'task', owner: 'fixture-owner' });
  queue.block({ ...ticket, reason: 'fixture failure' });
  const command = { ...ticket, request: event(4) };
  const run = (action) =>
    spawnSync(
      process.execPath,
      [path.join(root, 'scripts/task-entry.mjs'), 'execution-order', action, JSON.stringify(command)],
      { cwd: root, encoding: 'utf8' },
    );
  const original = queue.read();
  for (const action of ['cancel-plan', 'cancel']) {
    const result = run(action);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Original formal start intent missing/);
    assert.deepEqual(queue.read(), original);
  }
  // Only the isolated library fixture supplies its verifier. Real CLI has no injection route.
  queue.cancel(command, (current) => ({
    version: 1,
    ...current,
    outcome: 'quiescent',
    host: 'fixture-host',
    observedAt: '2026-01-01T00:00:00Z',
    observationDigest: 'a'.repeat(64),
  }));
  const cancelled = queue.read();
  const replay = run('cancel');
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).status, 'cancelled');
  assert.deepEqual(queue.read(), cancelled);
});

test('readonly target/proof does not mutate paused state; delivery cancellation does not alter development order', (t) => {
  const f = fixture(t);
  mkdirSync(f.task.worktree);
  f.queue.enqueue({ task: f.task.id, lane: 'delivery', owner: f.task.owner, request: event(7) });
  const delivery = f.queue.claim({ task: f.task.id, lane: 'delivery', owner: f.task.owner });
  f.queue.block({ ...delivery, reason: 'delivery not started' });
  f.queue.direct({ action: 'pause-all', request: event(8) });
  const before = f.queue.read();
  const proof = f.verify(f.queue.cancellationTarget(f.command));
  assert.equal(proof.sourcePresent, true);
  assert.deepEqual(f.queue.read(), before);
  f.queue.cancel({ ...delivery, request: event(20) }, f.verify);
  assert.equal(f.queue.read().paused, true);
  assert.deepEqual(
    f.queue.read().tickets.filter((t) => t.lane === 'development'),
    before.tickets.filter((t) => t.lane === 'development'),
  );
});

test('formal delivery session blocks cancellation because local probes do not prove remote CI ended', (t) => {
  const f = fixture(t);
  const before = f.queue.read();
  f.write('task-delivery/fixture-task/completion-session.json', { batch: f.task.id, events: [] });
  assert.throws(() => f.queue.cancel(f.command, f.verify), /remote CI/);
  assert.deepEqual(f.queue.read(), before);
});

test('NUL lsof parser accepts mandatory p/f/n records and preserves newline-containing names', () => {
  const output =
    'p123\0\nfcwd\0tDIR\0n/work/task\0\nf3u\0tREG\0n/work/a\nb (deleted)\0\np456\0\nftxt\0tREG\0n/bin/node\0\n';
  assert.deepEqual(parseCancellationOpenFiles(output), [
    { pid: 123, descriptor: 'cwd', type: 'DIR', name: '/work/task', opaque: false },
    { pid: 123, descriptor: '3u', type: 'REG', name: '/work/a\nb (deleted)', opaque: false },
    { pid: 456, descriptor: 'txt', type: 'REG', name: '/bin/node', opaque: false },
  ]);
});

test('NUL lsof parser rejects missing descriptors, broken records, unknown fields and truncation', () => {
  for (const output of [
    '',
    'p123\0\nn/path\0\n',
    'fcwd\0n/path\0\n',
    'p123\0\nfcwd\0\n',
    'p123\0\nfcwd\0n/path\0n/other\0\n',
    'p123\0\nfcwd\0n/path',
    'p123\0\nfcwd\0n/path\0',
    'p123\0\nfcwd\0xunknown\0n/path\0\n',
    'p123\0fcwd\0n/path\0\n',
    'p123junk\0\nfcwd\0n/path\0\n',
    'p123\0\nfcwd\0n/path\0\np123\0\n',
  ]) {
    assert.throws(() => parseCancellationOpenFiles(output));
  }
});

test('host adapter requests NUL lsof inventory and parses its actual record pattern', () => {
  const calls = [];
  const snapshot = observeCancellationHost(
    (command, args) => {
      calls.push([command, args]);
      if (command === '/bin/ps') return `${process.pid} 1 fixture-reader\n`;
      if (command === '/usr/sbin/lsof') return `p${process.pid}\0\nfcwd\0tDIR\0n/fixture\0\nf3u\0tREG\0n/file\0\n`;
      if (command === 'docker' && args[0] === 'ps') return '';
      throw Error('unexpected command');
    },
    { DOCKER_HOST: 'unix:///fixture.sock' },
  );
  assert.deepEqual(calls.find(([command]) => command === '/usr/sbin/lsof')[1], ['-nP', '-F0pftn']);
  assert.equal(snapshot.files.length, 2);
});

test('explicit macOS non-filesystem objects may have present empty n fields but remain in evidence', () => {
  const output = 'p123\0\n' + ['NPOLICY', 'NEXUS', 'PIPE'].map((type, i) => `f${i + 3}u\0t${type}\0n\0\n`).join('');
  const files = parseCancellationOpenFiles(output);
  assert.deepEqual(
    files.map(({ type, name, opaque }) => ({ type, name, opaque })),
    ['NPOLICY', 'NEXUS', 'PIPE'].map((type) => ({ type, name: '', opaque: true })),
  );
  assert.equal(files.length, 3);
});

test('unknown or filesystem empty names, missing names/types and malformed typed binding still refuse', () => {
  for (const body of [
    'f3u\0tREG\0n\0',
    'f3u\0tDIR\0n\0',
    'f3u\0tUNKNOWN\0n\0',
    'f3u\0tPIPE\0',
    'f3u\0n\0',
    'f3u\0n/path\0',
    'f3u\0tPIPE\0tPIPE\0n\0',
    'fcwd\0tPIPE\0n\0',
    'tPIPE\0f3u\0n\0',
  ]) {
    assert.throws(() => parseCancellationOpenFiles('p123\0\n' + body + '\n'));
  }
});

test('opaque non-filesystem descriptors do not exempt their owning process from cancellation checks', (t) => {
  const f = fixture(t);
  f.snapshot.files.push(...parseCancellationOpenFiles('p456\0\nf3u\0tPIPE\0n\0\n'));
  f.snapshot.processes.push({ pid: 456, ppid: 1, command: `node ${f.task.worktree}/run.mjs` });
  assert.throws(() => f.queue.cancel(f.command, f.verify), /process/);
});
