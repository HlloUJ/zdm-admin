import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { activatePublishedTaskThreads, createTaskThreadTitles } from './task-thread-titles.mjs';

// This bridge accepts native readback, never invokes an invented platform endpoint.
// Native create/rename/read are performed by the desktop host; secrets use hidden stdin.
assert.ok(process.stdin.isTTY, 'Use a private PTY for host input');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stderr.write('Ready for private title-sync input (hidden).\n');
let raw = '';
process.stdin.on('data', async (chunk) => {
  raw += chunk;
  if (!raw.includes('\n')) return;
  process.stdin.removeAllListeners('data');
  process.stdin.pause();
  try {
    const input = JSON.parse(raw);
    raw = '';
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const commonDir = path.resolve(git('rev-parse', '--git-common-dir'));
    const store = createTaskThreadTitles(commonDir);
    let result;
    if (input.action === 'list') result = { tasks: store.enrolled() };
    else if (input.action === 'activate') {
      assert.equal(
        realpathSync(fileURLToPath(import.meta.url)),
        path.join(realpathSync(git('rev-parse', '--show-toplevel')), 'scripts/task-thread-title-cli.mjs'),
        'Activate only through the actual published main script',
      );
      git('cat-file', '-e', 'HEAD:scripts/task-thread-title-cli.mjs');
      const stat = lstatSync(input.completionFile);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.size < 8388608);
      result = activatePublishedTaskThreads(commonDir, {
        head: git('rev-parse', 'HEAD'),
        remoteHead: git('rev-parse', 'origin/main'),
        branch: git('branch', '--show-current'),
        clean: git('status', '--porcelain') === '',
        completion: JSON.parse(readFileSync(input.completionFile, 'utf8')),
      });
    } else {
      assert.ok(['plan', 'confirm'].includes(input.action));
      const record = store.get(input.task);
      if (!record) result = { status: 'not-applicable', taskId: input.task };
      else {
        assert.equal(input.url, 'https://uj-task-board-preview-nov12.hanjian-uj.chatgpt.site');
        assert.equal(typeof input.token, 'string');
        const readTask = async (id) => {
          const response = await fetch(input.url + '/service/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': 'Bearer ' + input.token },
            body: JSON.stringify({
              operation: 'get_task_progress_receipt',
              args: { id, receipt_id: 'title-sync-' + id },
            }),
            signal: AbortSignal.timeout(30000),
          });
          assert.ok(response.ok, 'Board read failed');
          const body = await response.json();
          assert.ok(!body.error && body.data?.task?.id === id, 'Exact board task readback required');
          return body.data.task;
        };
        result =
          input.action === 'plan'
            ? await store.plan(input.task, readTask)
            : await store.confirm(input.task, input.observation, readTask);
      }
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', reason: error.message }));
    process.exitCode = 1;
  } finally {
    process.stdin.setRawMode(false);
  }
});
