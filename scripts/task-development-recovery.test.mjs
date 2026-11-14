import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { createTaskRegistry } from './task-registry.mjs';
import {
  createDevelopmentCheckpoint,
  setDevelopmentControl,
  runDevelopmentContinuation,
  readDevelopmentStart,
} from './task-development-recovery.mjs';
const owner = process.env.CODEX_THREAD_ID || 'isolated-development-test-owner';
function fixture() {
  process.env.CODEX_THREAD_ID = owner;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'development-recovery-')));
  const root = path.join(base, 'main'),
    worktree = path.join(base, 'task');
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(root, 'base'), 'base');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('worktree', 'add', '-b', 'codex/development-test', worktree);
  const registry = createTaskRegistry(root);
  registry.register({ id: 'development-test', owner, worktree });
  const input = {
    taskId: 'development-test',
    worker: '/root/original_worker',
    rootThreadId: 'original-root',
    authorizationRef: 'verified-user-instruction',
    nextStep: 'Run isolated validation only',
  };
  const checkpoint = createDevelopmentCheckpoint(root, input);
  const enable = () =>
    setDevelopmentControl(root, {
      taskId: input.taskId,
      expectedRevision: 0,
      paused: false,
      authorizationRef: input.authorizationRef,
    });
  const options = (cp = checkpoint) => ({
    ...input,
    checkpointId: cp.id,
    reachability: {
      ...input,
      checkpointId: cp.id,
      head: cp.head,
      nonce: cp.nonce,
      owner,
      receiptId: 'root-verified-receipt',
      observedAt: Date.now(),
      workerState: 'idle',
      effectsReconciled: true,
      resourcesResolved: true,
      interruptionConfirmed: true,
    },
  });
  return { root, worktree, input, checkpoint, options, enable };
}
test('default pause and revision CAS fail closed', async () => {
  const f = fixture();
  let called = false;
  await assert.rejects(
    runDevelopmentContinuation(f.root, {
      ...f.options(),
      execute: () => {
        called = true;
      },
    }),
    /paused/,
  );
  assert.equal(called, false);
  f.enable();
  assert.throws(f.enable, /revision/);
});
test('original runtime owner and clean checkpoint are mandatory', async () => {
  const f = fixture();
  f.enable();
  process.env.CODEX_THREAD_ID = 'foreign';
  await assert.rejects(runDevelopmentContinuation(f.root, { ...f.options(), execute() {} }), /owner/);
  process.env.CODEX_THREAD_ID = owner;
  fs.writeFileSync(path.join(f.worktree, 'dirty'), 'unsaved');
  await assert.rejects(runDevelopmentContinuation(f.root, { ...f.options(), execute() {} }), /clean/);
});
test('stale or differently bound reachability never enters callback', async () => {
  const f = fixture();
  f.enable();
  for (const delta of [
    { observedAt: Date.now() - 6000 },
    { nonce: 'old' },
    { owner: 'other' },
    { workerState: 'running' },
    { effectsReconciled: false },
    { resourcesResolved: false },
    { head: 'wrong' },
    { taskId: 'wrong-task' },
    { interruptionConfirmed: false },
  ]) {
    const options = f.options();
    let called = false;
    await assert.rejects(
      runDevelopmentContinuation(f.root, {
        ...options,
        reachability: { ...options.reachability, ...delta },
        execute() {
          called = true;
        },
      }),
      /handoff/,
    );
    assert.equal(called, false);
  }
});
test('callback exception is durable unknown, not replayable or erasable by new checkpoint', async () => {
  const f = fixture();
  f.enable();
  let calls = 0;
  const execute = () => {
    calls++;
    throw Error('lost outcome');
  };
  await assert.rejects(runDevelopmentContinuation(f.root, { ...f.options(), execute }), /lost outcome/);
  await assert.rejects(runDevelopmentContinuation(f.root, { ...f.options(), execute }));
  assert.throws(() => createDevelopmentCheckpoint(f.root, f.input), /continuation|attempt/);
  assert.equal(calls, 1);
});
test('pre-created second checkpoint cannot bypass unresolved first attempt', async () => {
  const f = fixture(),
    second = createDevelopmentCheckpoint(f.root, f.input);
  f.enable();
  await assert.rejects(
    runDevelopmentContinuation(f.root, {
      ...f.options(),
      execute() {
        throw Error('unknown');
      },
    }),
  );
  let called = false;
  await assert.rejects(
    runDevelopmentContinuation(f.root, {
      ...f.options(second),
      execute() {
        called = true;
      },
    }),
  );
  assert.equal(called, false);
});
test('concurrent same-checkpoint admission enters exactly once', async () => {
  const f = fixture();
  f.enable();
  let calls = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = runDevelopmentContinuation(f.root, {
    ...f.options(),
    execute: async () => {
      calls++;
      await gate;
      throw Error('isolated unknown');
    },
  });
  await assert.rejects(
    runDevelopmentContinuation(f.root, {
      ...f.options(),
      execute() {
        calls++;
      },
    }),
  );
  release();
  await assert.rejects(first);
  assert.equal(calls, 1);
});
test('actual original supervisor spawn is observable before completion and not task completion', async () => {
  const f = fixture();
  f.enable();
  const result = await runDevelopmentContinuation(f.root, {
    ...f.options(),
    execute: async ({ start }) => {
      const child = start(process.execPath, ['-e', 'setTimeout(()=>process.exit(0),500)'], { stdio: 'ignore' });
      const exited = once(child, 'exit');
      try {
        const deadline = Date.now() + 3000;
        while (JSON.parse(fs.readFileSync(child.completionProof.file)).status === 'pending' && Date.now() < deadline)
          await pause(10);
        const proof = readDevelopmentStart(f.root, { taskId: f.input.taskId, checkpointId: f.checkpoint.id });
        assert.equal(proof.status, 'started');
        assert.equal(proof.taskCompleted, false);
        assert.equal(proof.owner, owner);
      } finally {
        await exited;
      }
    },
  });
  assert.equal(result.status, 'completed');
  assert.throws(() => readDevelopmentStart(f.root, { taskId: f.input.taskId, checkpointId: f.checkpoint.id }), /spawn/);
});
test('returning while supervised work is alive leaves unknown and blocks new checkpoint', async () => {
  const f = fixture();
  f.enable();
  let exited;
  await assert.rejects(
    runDevelopmentContinuation(f.root, {
      ...f.options(),
      execute: async ({ start }) => {
        const child = start(process.execPath, ['-e', 'setTimeout(()=>process.exit(0),500)'], { stdio: 'ignore' });
        exited = once(child, 'exit');
        while (JSON.parse(fs.readFileSync(child.completionProof.file)).status === 'pending') await pause(10);
      },
    }),
  );
  try {
    assert.throws(() => createDevelopmentCheckpoint(f.root, f.input), /continuation|attempt/);
  } finally {
    await exited;
  }
});

test('different pre-created checkpoints cannot run concurrently', async () => {
  const f = fixture(),
    second = createDevelopmentCheckpoint(f.root, f.input);
  f.enable();
  let release,
    calls = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = runDevelopmentContinuation(f.root, {
    ...f.options(),
    execute: async () => {
      calls++;
      await gate;
      throw Error('unknown');
    },
  });
  await assert.rejects(
    runDevelopmentContinuation(f.root, {
      ...f.options(second),
      execute() {
        calls++;
      },
    }),
  );
  release();
  await assert.rejects(first);
  assert.equal(calls, 1);
});
test('pause after admission prevents actual spawn', async () => {
  const f = fixture();
  f.enable();
  await assert.rejects(
    runDevelopmentContinuation(f.root, {
      ...f.options(),
      execute: async ({ start }) => {
        setDevelopmentControl(f.root, {
          taskId: f.input.taskId,
          expectedRevision: 1,
          paused: true,
          authorizationRef: f.input.authorizationRef,
        });
        start(process.execPath, ['-e', 'process.exit(0)']);
      },
    }),
    /Control changed/,
  );
});
test('no supervised execution cannot count as a completed continuation', async () => {
  const f = fixture();
  f.enable();
  await assert.rejects(runDevelopmentContinuation(f.root, { ...f.options(), execute() {} }), /No actual/);
});

test('development source uses original notification durable delivery and dedup across completion', async () => {
  const { dispatchRecoveryNotice, readRecoveryNotice } = await import('./task-recovery-notice.mjs');
  const f = fixture();
  f.enable();
  let sent = 0;
  const binding = {
    ...f.input,
    kind: 'development',
    checkpointId: f.checkpoint.id,
    owner,
    taskNumber: '284',
    taskName: '隔离普通开发',
    roomId: 'isolated-room',
  };
  const directory = path.join(path.dirname(f.root), 'outbox');
  const send = async (n) => {
    sent++;
    return { status: 'delivered', roomId: n.roomId, eventId: n.eventId, messageId: 'isolated-message' };
  };
  await runDevelopmentContinuation(f.root, {
    ...f.options(),
    execute: async ({ start }) => {
      const releaseFile = path.join(path.dirname(f.root), 'release-child');
      const child = start(
        process.execPath,
        [
          '-e',
          `const fs=require('fs'); const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(releaseFile)})){clearInterval(t);process.exit(0)}},10);setTimeout(()=>process.exit(2),10000).unref()`,
        ],
        { stdio: 'ignore' },
      );
      const exited = once(child, 'exit');
      try {
        while (JSON.parse(fs.readFileSync(child.completionProof.file)).status === 'pending') await pause(10);
        for (const key of ['owner', 'worker', 'rootThreadId', 'authorizationRef'])
          assert.equal(readRecoveryNotice(f.root, { ...binding, [key]: 'wrong' }).status, 'blocked');
        assert.equal((await dispatchRecoveryNotice({ root: f.root, binding, directory, send })).status, 'delivered');
      } finally {
        fs.writeFileSync(releaseFile, 'release');
        await exited;
      }
    },
  });
  assert.equal((await dispatchRecoveryNotice({ root: f.root, binding, directory, send })).status, 'reconcile-existing');
  assert.equal(sent, 1);
});
test('development unknown result emits truthful failure, not success, and unknown delivery is not retried', async () => {
  const { dispatchRecoveryNotice, readRecoveryNotice } = await import('./task-recovery-notice.mjs');
  const f = fixture();
  f.enable();
  await assert.rejects(
    runDevelopmentContinuation(f.root, {
      ...f.options(),
      execute() {
        throw Error('unclassified');
      },
    }),
  );
  const binding = {
    ...f.input,
    kind: 'development',
    checkpointId: f.checkpoint.id,
    owner,
    taskNumber: '284',
    taskName: '隔离普通开发',
    roomId: 'isolated-room',
  };
  const notice = readRecoveryNotice(f.root, binding);
  assert.equal(notice.success, false);
  assert.match(notice.text, /284.*隔离普通开发.*续接失败.*待查/);
  let sent = 0;
  const options = {
    root: f.root,
    binding,
    directory: path.join(path.dirname(f.root), 'outbox'),
    send() {
      sent++;
      throw Error('lost delivery result');
    },
  };
  assert.equal((await dispatchRecoveryNotice(options)).status, 'unknown');
  assert.equal((await dispatchRecoveryNotice(options)).status, 'reconcile-existing');
  assert.equal(sent, 1);
});

test('wrong-task checkpoint and linked evidence fail closed', async () => {
  for (const mode of ['task', 'symlink']) {
    const f = fixture();
    f.enable();
    const registry = createTaskRegistry(f.root);
    const file = path.join(
      registry.commonDir,
      'task-development-recovery',
      f.input.taskId,
      `checkpoint-${f.checkpoint.id}.json`,
    );
    if (mode === 'task') {
      const record = JSON.parse(fs.readFileSync(file));
      record.taskId = 'foreign-task';
      fs.writeFileSync(file, JSON.stringify(record));
    } else {
      const target = file + '.original';
      fs.renameSync(file, target);
      fs.symlinkSync(target, file);
    }
    let called = false;
    await assert.rejects(
      runDevelopmentContinuation(f.root, {
        ...f.options(),
        execute() {
          called = true;
        },
      }),
    );
    assert.equal(called, false);
  }
});
