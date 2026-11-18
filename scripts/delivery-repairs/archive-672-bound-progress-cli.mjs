import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTaskRegistry, registeredTaskWorktrees } from '../task-registry.mjs';
import { createExecutionOrder } from '../task-execution-order.mjs';
import { assertDeliveredDependencies } from '../task-context.mjs';
import { readTaskCoordination } from '../task-coordination.mjs';
import { createOwnerBoardCall } from '../task-board-transport.mjs';
import { runBound672 } from './archive-672-bound-progress.mjs';

assert.ok(
  process.stdin.isTTY && process.argv.length === 2,
  'Use a private PTY for Site credentials and exact evidence',
);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stderr.write('Ready for private bound-receipt input (hidden).\n');
let raw = '';
process.stdin.on('data', async (chunk) => {
  raw += chunk;
  if (!raw.includes('\n')) return;
  process.stdin.removeAllListeners('data');
  process.stdin.pause();
  try {
    const input = JSON.parse(raw);
    raw = '';
    const mains = registeredTaskWorktrees(process.cwd()).filter((item) => item.branch === 'main');
    assert.equal(mains.length, 1);
    const main = realpathSync(mains[0].worktree);
    assert.equal(
      realpathSync(fileURLToPath(import.meta.url)),
      path.join(main, 'scripts/delivery-repairs/archive-672-bound-progress-cli.mjs'),
      'Execute only from the published main anchor',
    );
    const git = (...args) =>
      execFileSync('git', ['--no-optional-locks', '-C', main, ...args], { encoding: 'utf8' }).trim();
    assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
    assert.equal(git('status', '--porcelain'), '');
    const registry = createTaskRegistry(main);
    const { commonDir } = registry;
    const call = createOwnerBoardCall(input);
    input.token = '';
    const result = await runBound672(
      { action: input.action, actor: process.env.CODEX_THREAD_ID, attestation: input.attestation },
      {
        registry,
        queue: createExecutionOrder(commonDir),
        readCoordination: () => readTaskCoordination(commonDir),
        dependenciesReady: (task) => assertDeliveredDependencies(main, task),
        call,
      },
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    process.stdin.setRawMode(false);
  }
});
