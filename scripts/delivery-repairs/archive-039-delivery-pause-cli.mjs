import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTaskRegistry, registeredTaskWorktrees } from '../task-registry.mjs';
import { createExecutionOrder } from '../task-execution-order.mjs';
import { assertDeliveredDependencies } from '../task-context.mjs';
import { correct039DeliveryPause } from './archive-039-delivery-pause.mjs';

assert.ok(process.stdin.isTTY, 'Use a private PTY for native observations');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stderr.write('Ready for private 039 correction observations (hidden).\n');
let raw = '';
process.stdin.on('data', async (chunk) => {
  raw += chunk;
  if (!raw.includes('\n')) return;
  process.stdin.removeAllListeners('data');
  process.stdin.pause();
  try {
    const input = JSON.parse(raw);
    raw = '';
    const mains = registeredTaskWorktrees(process.cwd()).filter((entry) => entry.branch === 'main');
    assert.equal(mains.length, 1);
    const main = realpathSync(mains[0].worktree);
    assert.equal(
      realpathSync(fileURLToPath(import.meta.url)),
      path.join(main, 'scripts/delivery-repairs/archive-039-delivery-pause-cli.mjs'),
      'Execute only from the published main anchor',
    );
    const git = (...args) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8' }).trim();
    assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
    assert.equal(git('status', '--porcelain'), '');
    const registry = createTaskRegistry(main);
    const result = await correct039DeliveryPause(input, {
      registry,
      queue: createExecutionOrder(registry.commonDir),
      dependenciesReady: (task) => assertDeliveredDependencies(main, task),
    });
    console.log(
      JSON.stringify({
        status: result.status,
        packetIds: result.records.map((entry) => entry.receipt_id),
        auditDigest: result.auditDigest,
        replay: result.replay,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    process.stdin.setRawMode(false);
  }
});
