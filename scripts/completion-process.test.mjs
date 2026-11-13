import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { tmpdir, hostname } from 'node:os';
import path from 'node:path';
import { openCompletion, completionStage, saveCompletion } from './completion-session.mjs';
import { startCompletionProcess, stopCompletionProcess, runCompletionProcess } from './completion-process.mjs';

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

test('immediate termination after each started proof never leaves a late-spawned descendant', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'candidate-launch-race-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = openCompletion(directory, 'launch-race', { formal: false });
  for (let attempt = 0; attempt < 12; attempt++) {
    await completionStage(
      state,
      'prepare',
      String(attempt),
      async () => {
        const child = startCompletionProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        });
        const deadline = Date.now() + 2000;
        while (JSON.parse(readFileSync(child.completionProof.file)).status === 'pending' && Date.now() < deadline)
          await new Promise((resolve) => setImmediate(resolve));
        assert.equal(JSON.parse(readFileSync(child.completionProof.file)).status, 'started');
        await stopCompletionProcess(child);
        assert.equal(JSON.parse(readFileSync(child.completionProof.file)).status, 'quiescent');
      },
      { save: (current) => saveCompletion(directory, current) },
    );
  }
  assert.equal(state.events.length, 12);
  assert.ok(state.events.every((event) => event.status === 'success'));
});

test('supervised spawn failure remains nonzero and leaves a proved quiescent group', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'candidate-spawn-error-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = openCompletion(directory, 'spawn-error', { formal: false });
  await completionStage(
    state,
    'prepare',
    'missing',
    async () => {
      const result = runCompletionProcess(path.join(directory, 'missing-command'), [], { stdio: 'ignore' });
      assert.notEqual(result.status, 0);
    },
    { save: (current) => saveCompletion(directory, current) },
  );
  const token = state.events[0].processes[0].token;
  const record = JSON.parse(readFileSync(path.join(directory, `process-${token}.json`)));
  assert.equal(record.status, 'quiescent');
  assert.notEqual(record.exitCode, 0);
});

test('supervised completion preserves ordinary exits and never turns a child signal into success', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'candidate-exit-semantics-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = openCompletion(directory, 'exit-semantics', { formal: false });
  for (const [name, script, expectedCode, expectedSignal] of [
    ['success', 'process.exit(0)', 0, null],
    ['failure', 'process.exit(7)', 7, null],
    ['signal', "process.kill(process.pid, 'SIGTERM')", 1, 'SIGTERM'],
  ]) {
    await completionStage(
      state,
      'prepare',
      name,
      async () => {
        const result = runCompletionProcess(process.execPath, ['-e', script], { stdio: 'ignore' });
        assert.equal(result.status, expectedCode);
      },
      { save: (current) => saveCompletion(directory, current) },
    );
    const token = state.events.at(-1).processes[0].token;
    const record = JSON.parse(readFileSync(path.join(directory, `process-${token}.json`)));
    assert.equal(record.status, 'quiescent');
    assert.equal(record.exitCode, expectedCode);
    assert.equal(record.signal, expectedSignal);
  }
});
