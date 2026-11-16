import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runCompletionWithProgress } from './task-completion-progress.mjs';
import { createOwnerBoardCall } from './task-board-transport.mjs';
assert.ok(process.stdin.isTTY, 'Use private PTY input; no credential argv/file');
assert.equal(process.argv.length, 2, 'All private input arrives through PTY');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stderr.write('Ready for private completion input (hidden).\n');
let raw = '';
process.stdin.on('data', async (chunk) => {
  raw += chunk;
  if (!raw.includes('\n')) return;
  process.stdin.removeAllListeners('data');
  process.stdin.pause();
  try {
    const input = JSON.parse(raw);
    raw = '';
    assert.ok(Array.isArray(input.args) && input.args.every((arg) => typeof arg === 'string'));
    assert.ok(
      input.deferSettle === undefined || typeof input.deferSettle === 'boolean',
      'deferSettle must be explicit boolean',
    );
    const inside = (parent, child) => {
      const relative = path.relative(path.resolve(parent), path.resolve(child));
      return (
        relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
      );
    };
    assert.ok(!inside(input.root, process.cwd()), 'Run from stable main/reviewed carrier cwd, not the removable task');
    assert.ok(!inside(input.root, fileURLToPath(import.meta.url)), 'Control entry must be outside removable task');
    const call = createOwnerBoardCall(input);
    input.token = '';
    const result = await runCompletionWithProgress({
      root: input.root,
      taskId: input.task,
      anchor: process.cwd(),
      args: input.args,
      developmentEvidence: input.developmentEvidence ?? null,
      invalidSupersessions: input.invalidSupersessions ?? [],
      completionOptions: { deferSettle: input.deferSettle ?? false },
      call,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({ status: 'failed', reason: error.message, progress: error.progressDelivery ?? null }),
    );
    process.exitCode = 1;
  } finally {
    process.stdin.setRawMode(false);
  }
});
