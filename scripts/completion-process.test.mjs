import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { tmpdir, hostname } from 'node:os';
import path from 'node:path';
import { openCompletion, completionStage, saveCompletion } from './completion-session.mjs';
import { startCompletionProcess, stopCompletionProcess } from './completion-process.mjs';

test('long-lived candidate processes publish original group proof and stop all foreground descendants before stage success', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'candidate-process-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = openCompletion(directory, 'owned-runtime', { formal: false });
  let child;
  t.after(() => {
    if (child?.exitCode === null && !child.signalCode) child.kill('SIGTERM');
  });
  await completionStage(
    state,
    'prepare',
    'runtime',
    async () => {
      child = startCompletionProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      const proof = child.completionProof,
        deadline = Date.now() + 2000;
      while (JSON.parse(readFileSync(proof.file)).status === 'pending' && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      const started = JSON.parse(readFileSync(proof.file));
      assert.equal(started.status, 'started');
      assert.equal(started.pgid, child.pid);
      await stopCompletionProcess(child);
      assert.equal(JSON.parse(readFileSync(proof.file)).status, 'quiescent');
    },
    { save: (current) => saveCompletion(directory, current) },
  );
  assert.equal(state.events[0].status, 'success');
  assert.equal(state.events[0].processes.length, 1);
});

test('stop reaps its supervisor before probing the group and still rejects post-exit EPERM', async (t) => {
  for (const finalError of ['ESRCH', 'EPERM']) {
    const directory = mkdtempSync(path.join(tmpdir(), 'candidate-process-order-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const token = randomUUID(),
      file = path.join(directory, `process-${token}.json`),
      child = new EventEmitter();
    Object.assign(child, {
      pid: 123456,
      exitCode: null,
      signalCode: null,
      completionProof: { directory, token, file },
    });
    writeFileSync(file, JSON.stringify({ token, host: hostname(), pgid: child.pid, status: 'started' }), {
      mode: 0o600,
    });
    const originalKill = process.kill;
    let signaled = false,
      reaped = false,
      postExitProbes = 0;
    process.kill = (pid, signal) => {
      assert.equal(pid, -child.pid);
      if (signal === 'SIGTERM') {
        signaled = true;
        setImmediate(() => {
          reaped = true;
          child.signalCode = 'SIGTERM';
          child.emit('exit', null, 'SIGTERM');
        });
        return true;
      }
      assert.equal(signal, 0);
      if (!signaled) return true;
      assert.equal(reaped, true, 'Must reap the exact supervisor before the next group probe');
      postExitProbes++;
      throw Object.assign(new Error(finalError), { code: finalError });
    };
    try {
      if (finalError === 'EPERM') {
        await assert.rejects(stopCompletionProcess(child), { code: 'EPERM' });
        assert.equal(JSON.parse(readFileSync(file)).status, 'started');
      } else {
        await stopCompletionProcess(child);
        assert.equal(JSON.parse(readFileSync(file)).status, 'quiescent');
      }
      assert.ok(postExitProbes > 0);
    } finally {
      process.kill = originalKill;
    }
  }
});
