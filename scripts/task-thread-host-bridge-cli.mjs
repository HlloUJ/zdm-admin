import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { advanceTaskThread } from './task-thread-host-bridge.mjs';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';
const execute = promisify(execFile);
assert.ok(process.stdin.isTTY, 'Use a private PTY for authenticated host input');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stderr.write('Ready for private native-host step (hidden).\n');
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
    const git = (...args) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8' }).trim();
    assert.equal(
      realpathSync(fileURLToPath(import.meta.url)),
      path.join(main, 'scripts/task-thread-host-bridge-cli.mjs'),
      'Only the published main host bridge may operate real tasks',
    );
    assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(input.url, 'https://uj-task-board-preview-nov12.hanjian-uj.chatgpt.site');
    assert.equal(typeof input.token, 'string');
    const registry = createTaskRegistry(main);
    const result = await advanceTaskThread(input, {
      commonDir: registry.commonDir,
      readTask: async (id) => {
        const response = await fetch(input.url + '/service/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': 'Bearer ' + input.token },
          body: JSON.stringify({
            operation: 'get_task_progress_receipt',
            args: { id, receipt_id: 'title-sync-' + id },
          }),
          signal: AbortSignal.timeout(30000),
        });
        assert.ok(response.ok, 'Board read failed; do not infer an absent task');
        const body = await response.json();
        assert.ok(!body.error && body.data?.task?.id === id, 'Exact board task required');
        return body.data.task;
      },
      start: async ({ taskId, owner, monitorContext, admission }) => {
        await execute(
          process.execPath,
          [
            path.join(main, 'scripts/task-entry.mjs'),
            'start',
            '--slug',
            taskId,
            '--owner',
            owner,
            '--kind',
            input.task.kind ?? 'business',
            '--monitor-context',
            JSON.stringify(monitorContext),
          ],
          { cwd: main, env: { ...process.env, ZDM_EXECUTION_ADMISSION: admission }, maxBuffer: 8388608 },
        );
        const task = registry.readTask(taskId);
        assert.ok(task, 'Read back actual registry after published start');
        return { task };
      },
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', reason: error.message }));
    process.exitCode = 1;
  } finally {
    process.stdin.setRawMode(false);
  }
});
