import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  renameSync,
  readdirSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCleanupQueue, cleanupIdentity, cleanupObjectId } from './task-cleanup-queue.mjs';
import { inspectProcess } from './verification-process-identity.mjs';
import { pinCleanupFixture } from './delivery-repairs/test-support/task-cleanup-scope-fixture.mjs';
const sourceHead = 'a'.repeat(40),
  now = Date.parse('2026-11-17T01:00:00+08:00');
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('Timed out waiting for ' + label);
}
const groupGone = (pid) => {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
};
async function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-real-interruption-'))),
    common = path.join(root, 'common');
  mkdirSync(common);
  const source = path.join(root, 'generated');
  mkdirSync(source);
  writeFileSync(path.join(source, 'a.js'), 'first-generated');
  writeFileSync(path.join(source, 'b.js'), 'second-generated');
  const record = {
    version: 1,
    task: 'isolated-task',
    identity: cleanupIdentity(source),
    producer: 'task-completion-handoff-v1',
    disposition: 'rebuildable',
    notBefore: new Date(0).toISOString(),
    proof: { worktree: path.join(root, 'task'), head: 'a'.repeat(40), accepted: 'b'.repeat(40), main: 'c'.repeat(40) },
  };
  const registration = {
    version: 1,
    task: record.task,
    worktree: record.proof.worktree,
    relative: 'dist',
    identity: record.identity,
    sourceDigest: 'd'.repeat(64),
    producer: 'vite-build-success-v1',
    command: ['npm', 'run', 'build:app'],
    exitCode: 0,
  };
  const bytes = JSON.stringify(registration) + '\n',
    digest = createHash('sha256').update(bytes).digest('hex'),
    proof = path.join(common, 'task-cleanup/proofs', record.task, digest + '.json');
  mkdirSync(path.dirname(proof), { recursive: true, mode: 0o700 });
  writeFileSync(proof, bytes, { mode: 0o600 });
  record.proof.rebuild = { kind: 'vite-dist-v1', record: proof, digest };
  const key = cleanupObjectId(record),
    carrier = path.join(common, 'task-cleanup/staging', record.task, key);
  mkdirSync(carrier, { recursive: true, mode: 0o700 });
  record.carrier = carrier;
  record.path = path.join(carrier, 'content');
  writeFileSync(path.join(carrier, 'manifest.json'), JSON.stringify(record), { mode: 0o600 });
  renameSync(source, record.path);
  const queue = createCleanupQueue(common);
  queue.handoff(record);
  const marker = path.join(root, 'partial.json'),
    config = path.join(root, 'worker.json');
  writeFileSync(config, JSON.stringify({ root, common, sourceHead, now, marker }));
  const f = { root, common, queue, record, key, carrier, marker, config, child: null, deletion: null };
  t.after(async () => {
    if (f.child && f.child.exitCode === null && !f.child.signalCode) {
      const ended = once(f.child, 'exit');
      f.child.kill('SIGTERM');
      await ended;
    }
    if (f.deletion) {
      const actual = inspectProcess(f.deletion.pid);
      if (actual) {
        assert.deepEqual(actual, f.deletion, 'Never signal a reused deletion PID');
        process.kill(actual.pid, 'SIGTERM');
      }
    }
    if (f.group) await until(() => groupGone(f.group), 'owned deletion group exit during cleanup');
    rmSync(root, { recursive: true, force: true });
  });
  f.pinned = await pinCleanupFixture(root, common, record.task, [record]);
  return f;
}
for (const extra of [false, true])
  test(`real SIGTERM preserves both locks and resumes only after deletion group ends; extra unique=${extra}`, async (t) => {
    const f = await fixture(t);
    f.child = spawn(
      process.execPath,
      [path.join(f.pinned.runtime, 'scripts/test-support/cleanup-interruption-worker.mjs'), f.config],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let errors = '';
    f.child.stderr.on('data', (bytes) => (errors += bytes));
    await until(() => existsSync(f.marker) || f.child.exitCode !== null, 'first real descriptor unlink');
    assert.ok(existsSync(f.marker), errors);
    const partial = JSON.parse(readFileSync(f.marker));
    f.deletion = inspectProcess(partial.pid);
    assert.ok(f.deletion);
    const ownerFile = path.join(f.queue.base, 'run.lock/owner.json'),
      owner = JSON.parse(readFileSync(ownerFile)),
      childFile = path.join(f.queue.base, 'run.lock', 'process-' + owner.event.processes[0].token + '.json');
    f.group = JSON.parse(readFileSync(childFile)).pgid;
    const ended = once(f.child, 'exit');
    f.child.kill('SIGTERM');
    const [, signal] = await ended;
    assert.equal(signal, 'SIGTERM');
    assert.equal(inspectProcess(owner.pid), null);
    assert.ok(!groupGone(f.group));
    const dependencies = {
      now,
      hostTimezone: 'Asia/Shanghai',
      verifyRuntime: () => ({ root: f.root, commonDir: f.common, sourceHead }),
      notify: async () => ({ status: 'idle' }),
      runCleanup: () =>
        f.pinned.queue.run({
          ...f.pinned.policy,
          scope: f.pinned.scope(),
          apply: true,
          verify: async () => ({ ready: true }),
          unreferenced: async () => {},
        }),
    };
    await assert.rejects(f.pinned.runScheduledCleanup(f.pinned.runtime, dependencies), /Subprocess group is alive/);
    assert.ok(existsSync(path.join(f.queue.base, 'scheduler.lock/owner.json')));
    assert.ok(existsSync(ownerFile));
    process.kill(f.deletion.pid, 'SIGTERM');
    await until(() => groupGone(f.group), 'original deletion group exit');
    f.deletion = null;
    const quarantine = path.join(f.carrier, 'deleting'),
      remaining = readdirSync(quarantine).reduce((n, file) => n + statSync(path.join(quarantine, file)).size, 0);
    assert.ok(remaining > 0 && remaining < f.record.identity.bytes);
    if (extra) writeFileSync(path.join(quarantine, 'unique.txt'), 'retain new unique bytes');
    const result = await f.pinned.runScheduledCleanup(f.pinned.runtime, dependencies);
    assert.equal(result.slot, new Date(now).toISOString());
    assert.ok(result.recoveredFrom);
    const state = JSON.parse(readFileSync(path.join(f.queue.base, 'scheduler-state.json')));
    assert.equal(state.firstFailure.status, 'interrupted');
    assert.ok(existsSync(path.join(result.recoveredFrom, 'scheduler-state.interrupted.json')));
    if (extra) {
      assert.equal(result.status, 'blocked');
      assert.equal(readFileSync(path.join(quarantine, 'unique.txt'), 'utf8'), 'retain new unique bytes');
    } else {
      assert.equal(result.status, 'completed');
      assert.ok(!existsSync(quarantine));
      const receipt = JSON.parse(readFileSync(path.join(f.queue.base, 'results', f.key + '.json')));
      assert.equal(receipt.deletedLogicalBytes, remaining);
    }
    assert.equal((await f.pinned.runScheduledCleanup(f.pinned.runtime, dependencies)).status, 'already-ran');
  });
