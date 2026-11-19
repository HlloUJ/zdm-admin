import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCompletion, saveCompletion } from './completion-session.mjs';
import { deliveryStatus } from './completion-status.mjs';
import { runScheduledCleanup } from './task-cleanup-scheduled-cli.mjs';
import { runOwnershipCleanup } from './task-cleanup-ownership.mjs';
import { cleanupTestResources, TEST_CLEANUP_LABELS } from './task-cleanup-test-resources.mjs';
import { assertCleanupUnreferenced } from './task-cleanup-cli.mjs';

const GiB = 1024 ** 3;
const here = Date.parse('2026-11-19T01:00:00+08:00');
const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const artifact = (file, bytes = 1) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const fd = openSync(file, 'wx');
  try {
    ftruncateSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
  return file;
};

function fixture(t, { historical = false } = {}) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-ownership-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo');
  const remote = path.join(base, 'remote.git');
  mkdirSync(root);
  mkdirSync(remote);
  git(remote, 'init', '--bare', '-b', 'main');
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'core.logAllRefUpdates', 'true');
  writeFileSync(path.join(root, '.gitignore'), 'output/\n');
  writeFileSync(path.join(root, 'source'), 'delivered\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'delivered');
  git(root, 'remote', 'add', 'origin', remote);
  const head = git(root, 'rev-parse', 'HEAD');
  git(root, 'push', 'origin', 'main');
  const id = historical ? 'old-delivered' : 'new-delivered';
  const branch = 'codex/' + id,
    worktree = path.join(base, 'repo-worktrees', id);
  git(root, 'worktree', 'add', '-b', branch, worktree, head);
  git(root, 'push', 'origin', branch);
  const commonDir = path.join(root, '.git');
  const task = {
    id,
    owner: 'isolated-owner',
    worktree,
    branch,
    stage: 'closed',
    recordedHead: head,
    closedAt: new Date().toISOString(),
    main: { local: head, remote: head },
    repository: { commonDir },
  };
  if (historical) {
    const archive = path.join(commonDir, 'task-batches/archive', id + '.json');
    mkdirSync(path.dirname(archive), { recursive: true });
    writeFileSync(archive, JSON.stringify(task));
    git(root, 'worktree', 'remove', worktree);
  }
  const directory = path.join(commonDir, 'task-delivery', id);
  const session = openCompletion(directory, id, { now: 0 });
  const key = head + ':42';
  session.events = [
    {
      id: 'ci',
      name: 'ci',
      key,
      status: 'success',
      startedAt: 10,
      finishedAt: 80,
      result: {
        runId: '42',
        headSha: head,
        attempt: 1,
        conclusion: 'success',
        branch: 'main',
        jobs: ['Frontend quality', 'Backend quality'].map((name) => ({
          name,
          status: 'completed',
          conclusion: 'success',
        })),
      },
    },
    ...['evidence', 'handoff', 'preserve', 'cleanup', 'close'].map((name, i) => ({
      id: name,
      name,
      key,
      status: 'success',
      startedAt: 81 + i,
      finishedAt: 82 + i,
    })),
  ];
  session.closedAt = 100;
  saveCompletion(directory, session);
  const receipt = path.join(directory, 'completion-receipt.json');
  writeFileSync(receipt, JSON.stringify({ results: { close: { result: { batch: id, main: task.main } } } }));
  const cleanupBase = path.join(commonDir, 'task-cleanup');
  mkdirSync(cleanupBase, { mode: 0o700 });
  const policy = {
    version: 1,
    ownershipV2: true,
    limit: 10,
    budgetMs: 30000,
    maxLogicalBytes: GiB,
    scheduler: { historyLimit: 20, maxSummaryBytes: 4096 },
  };
  writeFileSync(path.join(cleanupBase, 'policy.json'), JSON.stringify(policy), { mode: 0o600 });
  const registry = { commonDir, list: () => (historical ? [] : [task]) };
  let sealed = historical;
  const seal = () => {
    if (sealed) return;
    task.closedAt = new Date().toISOString();
    sealed = true;
  };
  const run = (options = {}) => {
    seal();
    return runOwnershipCleanup(root, { registry, policy, unreferenced: () => {}, apply: true, ...options });
  };
  const assets = path.join(commonDir, 'task-assets', id);
  const state = () => JSON.parse(readFileSync(path.join(cleanupBase, 'ownership-v2', id + '.json')));
  return { root, commonDir, task, directory, receipt, worktree, branch, assets, policy, run, seal, state };
}
test('calendar slot consumes completed task, actual worktree and branch refs, and preserves final receipt', async (t) => {
  const f = fixture(t);
  const privateFile = artifact(path.join(f.worktree, 'output', 'new-kind.tmp'));
  const shared = artifact(path.join(f.root, 'shared-asset'));
  symlinkSync(shared, path.join(f.worktree, 'output', 'linked-tool'));
  const deliveryCopy = artifact(path.join(f.directory, 'external-observations', 'review.txt'));
  const preserved = artifact(path.join(f.assets, 'preserved', 'private-copy'));
  const receipt = readFileSync(f.receipt);
  let runs = 0;
  const schedule = {
    now: here,
    hostTimezone: 'Asia/Shanghai',
    verifyRuntime: () => ({ sourceHead: 'a'.repeat(40), commonDir: f.commonDir, root: f.root }),
    runCleanup: async (_root, args) => {
      assert.deepEqual(args, ['run-ownership']);
      runs += 1;
      return f.run();
    },
    notify: async () => ({ status: 'idle' }),
  };
  assert.equal((await runScheduledCleanup(f.root, schedule)).status, 'completed', JSON.stringify(f.state().pending));
  assert.equal((await runScheduledCleanup(f.root, { ...schedule, now: here + 10000 })).status, 'already-ran');
  assert.equal(runs, 1);
  for (const file of [privateFile, deliveryCopy, preserved, f.worktree]) assert.equal(existsSync(file), false, file);
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/heads/' + f.branch), '');
  assert.equal(git(f.root, 'branch', '--list', f.branch), '');
  assert.deepEqual(readFileSync(f.receipt), receipt);
  assert.equal(deliveryStatus(f.directory, f.task.id, f.task).formalDeliveryComplete, true);
  assert.equal(f.state().outcome, 'cleaned');
  assert.ok(existsSync(shared), 'Cleanup does not follow outgoing symlinks');
});

test('historical record finds an unregistered nested clone after its original worktree is gone', async (t) => {
  const f = fixture(t, { historical: true });
  const copy = path.join(f.directory, 'retained', '.sites-checkout');
  mkdirSync(path.dirname(copy), { recursive: true });
  git(f.root, 'clone', '--no-local', git(f.root, 'remote', 'get-url', 'origin'), copy);
  assert.equal(existsSync(f.worktree), false);
  assert.equal((await f.run()).processed[0].state, 'cleaned', JSON.stringify(f.state().pending));
  assert.equal(existsSync(copy), false);
  assert.equal(git(f.root, 'ls-remote', 'origin', 'refs/heads/' + f.branch), '');
});

test('large filesystem objects respect logical budget; remaining known files continue after an interrupted unlink', async (t) => {
  const f = fixture(t);
  const files = (root, prefix, count) =>
    Array.from({ length: count }, (_, i) => artifact(path.join(root, prefix, String(i)), GiB * 0.75));
  const inside = files(f.worktree, 'output', 2);
  const outside = files(f.directory, 'delivery-log', 4);
  const first = await f.run();
  assert.equal(first.deletedLogicalBytes, GiB * 0.75, JSON.stringify(first.processed));
  assert.notEqual(f.state().outcome, 'cleaned');
  assert.equal(existsSync(outside[0]), false);
  unlinkSync(outside[1]); // Simulate a process ending after unlink but before persisting its cursor.
  let previous;
  for (let i = 0; i < 6 && f.state().outcome !== 'cleaned'; i += 1) {
    previous = await f.run();
    assert.ok(previous.deletedLogicalBytes <= GiB);
  }
  assert.equal(previous.remaining, 0);
  for (const file of [...inside, ...outside]) assert.equal(existsSync(file), false);
  assert.equal(f.state().outcome, 'cleaned');
});

test('reference is rechecked and recovers; protected paths, changed worktrees and advanced branches are kept', async (t) => {
  const f = fixture(t);
  const retained = artifact(path.join(f.assets, 'private', 'artifact'));
  const backup = artifact(path.join(f.directory, 'backups', 'db'));
  const media = artifact(path.join(f.directory, 'uploads', 'media'));
  const check = (target) =>
    assertCleanupUnreferenced(target, {
      env: { DOCKER_HOST: 'unix:///fixture' },
      exec: () => '',
    });
  const descriptor = openSync(retained, 'r');
  try {
    assert.equal((await f.run({ unreferenced: check })).processed[0].state, 'blocked');
    assert.ok(existsSync(retained));
  } finally {
    closeSync(descriptor);
  }
  await f.run({ unreferenced: check });
  assert.equal(existsSync(retained), false, JSON.stringify(f.state().pending));
  for (const file of [backup, media]) assert.ok(existsSync(file));
  const g = fixture(t);
  const dirty = path.join(g.worktree, 'source');
  writeFileSync(dirty, 'new local work');
  await g.run();
  assert.equal(readFileSync(dirty, 'utf8'), 'new local work');
  git(g.worktree, 'add', 'source');
  git(g.worktree, 'commit', '-m', 'later work');
  git(g.worktree, 'push', 'origin', g.branch);
  await g.run();
  assert.ok(existsSync(g.worktree));
  assert.notEqual(git(g.root, 'ls-remote', 'origin', 'refs/heads/' + g.branch), '');
});

test('MySQL fixture uses live references, schema and exact volume ownership before removal', () => {
  const task = { id: 'isolated-fixture', owner: 'owner-id' };
  const id = 'a'.repeat(64),
    volume = 'zdm-cleanup-test-fixture';
  const label = TEST_CLEANUP_LABELS;
  const labels = {
    [label.task]: task.id,
    [label.owner]: task.owner,
    [label.purpose]: 'mysql-fixture',
    [label.database]: 'zdm_cleanup_test_fixture',
  };
  let volumes = true,
    present = true,
    running = true,
    schema = labels[label.database],
    attached = true;
  const docker = ([cmd, action, ...args]) => {
    if (cmd === 'context') return JSON.stringify('unix:///fixture');
    if (cmd === 'ps') return attached && args.includes('volume=' + volume) ? 'b'.repeat(64) : present ? id : '';
    if (cmd === 'container')
      return JSON.stringify([
        {
          Id: id,
          Config: { Labels: labels, Image: 'mysql:8.0' },
          HostConfig: { Privileged: false, RestartPolicy: { Name: 'no' }, NetworkMode: 'bridge' },
          Mounts: [{ Name: volume, Destination: '/var/lib/mysql' }],
          State: { Running: running },
        },
      ]);
    if (cmd === 'volume' && action === 'ls') return volumes ? volume : '';
    if (cmd === 'volume' && action === 'inspect')
      return JSON.stringify([{ Labels: labels, Driver: 'local', Options: null }]);
    if (cmd === 'volume' && action === 'rm') {
      volumes = false;
      return volume;
    }
    if (cmd === 'exec') {
      const query = args.at(-1);
      if (query.includes('PROCESSLIST')) return '0';
      if (query.startsWith('DROP DATABASE')) {
        schema = '';
        return '';
      }
      return schema;
    }
    if (cmd === 'stop') {
      running = false;
      return id;
    }
    if (cmd === 'rm') {
      present = false;
      return id;
    }
    throw Error('Unexpected fixture request ' + cmd + ' ' + action);
  };
  const options = { deadline: Date.now() + 20000, apply: true, docker, env: {} };
  assert.ok(cleanupTestResources(task, options).length);
  assert.ok(present && volumes && schema);
  attached = false;
  assert.deepEqual(cleanupTestResources(task, options), []);
  assert.ok(!present && !volumes && !schema);
});

test('interrupted cleanup owner is recovered and the next round completes the remaining directory', async (t) => {
  const f = fixture(t);
  const deleted = artifact(path.join(f.directory, 'records', 'already-processed'));
  const waiting = artifact(path.join(f.assets, 'records', 'next-object'));
  f.seal();
  const worker = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { runOwnershipCleanup } from './scripts/task-cleanup-ownership.mjs';
    const { root, commonDir, task, policy, pauseAt } = JSON.parse(process.argv[1]);
    await runOwnershipCleanup(root, {
      registry: { commonDir, list: () => [task] }, policy, apply: true,
      unreferenced: ({ path }) => {
        if (path === pauseAt) {
          process.stdout.write('Paused before next object\\n');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
        }
      }
    });
  `,
      JSON.stringify({ root: f.root, commonDir: f.commonDir, task: f.task, policy: f.policy, pauseAt: f.assets }),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const done = once(worker, 'exit');
  t.after(() => {
    if (worker.exitCode === null) worker.kill('SIGKILL');
  });
  const outcome = await Promise.race([once(worker.stdout, 'data'), done]);
  assert.equal(String(outcome[0]).trim(), 'Paused before next object');
  assert.equal(existsSync(deleted), false);
  assert.ok(existsSync(waiting));
  worker.kill('SIGKILL');
  assert.deepEqual(await done, [null, 'SIGKILL']);
  assert.equal((await f.run()).remaining, 0);
  assert.equal(existsSync(waiting), false);
  assert.equal(f.state().outcome, 'cleaned');
});

test('an ignored file written after formal closure keeps the worktree and branch protected', async (t) => {
  const f = fixture(t);
  const original = artifact(path.join(f.worktree, 'output', 'completed-task-cache'));
  f.seal();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const next = path.join(f.worktree, 'output', 'new-uncommitted-input');
  writeFileSync(next, 'new local content');
  assert.equal((await f.run()).processed[0].state, 'blocked');
  assert.equal(existsSync(original), false);
  assert.equal(readFileSync(next, 'utf8'), 'new local content');
  assert.ok(git(f.root, 'ls-remote', 'origin', 'refs/heads/' + f.branch));
});
