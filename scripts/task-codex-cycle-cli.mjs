import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createTaskThreadTitles } from './task-thread-titles.mjs';
import { syncCodexCycle } from './task-codex-cycle.mjs';

// Credentials arrive through hidden stdin from the authenticated owner host, never argv or disk.
assert.ok(process.stdin.isTTY, 'Use a private PTY for credential input');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stderr.write('Ready for private cycle input (hidden).\n');
let raw = '';
process.stdin.on('data', async (chunk) => {
  raw += chunk;
  if (!raw.includes('\n')) return;
  process.stdin.removeAllListeners('data');
  process.stdin.pause();
  try {
    const input = JSON.parse(raw);
    raw = '';
    assert.equal(input.url, 'https://uj-task-board-preview-nov12.hanjian-uj.chatgpt.site');
    assert.equal(typeof input.token, 'string');
    assert.match(input.runId, /^[a-zA-Z0-9-]+$/);
    const call = async (operation, args) => {
      const response = await fetch(input.url + '/service/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': 'Bearer ' + input.token },
        body: JSON.stringify({ operation, args }),
        signal: AbortSignal.timeout(30000),
      }).catch((cause) => {
        const error = Error('Board transport failed');
        const code = String(cause.cause?.code ?? cause.name ?? 'unavailable').toLowerCase();
        error.code = /^[a-z0-9_-]{1,60}$/.test(code) ? 'transport_' + code : 'transport_unavailable';
        throw error;
      });
      if (!response.headers.get('content-type')?.includes('application/json')) {
        const error = Error('Board returned non-JSON');
        error.code = 'transport_http_' + response.status;
        throw error;
      }
      const body = await response.json();
      if (!response.ok || body.error) {
        const error = Error('Board receipt operation failed');
        error.code = body.code ?? 'transport-unavailable';
        throw error;
      }
      return body.data;
    };
    const commonDir = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
    const titles = createTaskThreadTitles(commonDir);
    const result = await syncCodexCycle(input, call);
    if (titles.get(input.task)) {
      result.threadTitle = await titles.plan(
        input.task,
        async (id) => (await call('get_task_progress_receipt', { id, receipt_id: 'title-sync-' + id })).task,
      );
      result.status = 'needs-native-title-readback';
    }
    const proof = { runId: input.runId, checkedAt: new Date().toISOString(), ...result };
    if (input.proofFile) writeFileSync(input.proofFile, JSON.stringify(proof) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(proof));
    if (result.status !== 'confirmed') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', reason: error.message }));
    process.exitCode = 1;
  } finally {
    process.stdin.setRawMode(false);
  }
});
