import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
