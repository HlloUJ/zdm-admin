import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { main as verifyMain } from './verify.mjs';
import { createScheduledPlanExecutor } from './task-resource-plan-entry.mjs';
import { callScheduler } from './task-resource-service.mjs';
export function parseSchedulerEntry(args) {
  const options = {};
  let index = 0;
  for (; index < args.length && args[index] !== '--'; index += 2) {
    const key = args[index];
    assert.ok(
      ['--task', '--socket', '--capability-file'].includes(key),
      'Expected --task, --socket or --capability-file, then -- verification arguments',
    );
    assert.ok(!options[key] && args[index + 1] && !args[index + 1].startsWith('--'), 'Duplicate or missing option');
    options[key] = args[index + 1];
  }
  assert.ok(options['--task'], 'Stable registered task ID required');
  const verificationArgs = args.slice(index + 1);
  return {
    taskId: options['--task'],
    socketPath: options['--socket'],
    capabilityFile: options['--capability-file'],
    verificationArgs,
  };
}
function privatePath(file, socket) {
  assert.ok(path.isAbsolute(file), 'Absolute private endpoint required');
  for (let p = file; ; p = path.dirname(p)) {
    assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked endpoint refused');
    if (p === path.dirname(p)) break;
  }
  const stat = lstatSync(file),
    parent = lstatSync(path.dirname(file));
  assert.equal(stat.uid, process.getuid());
  assert.equal(parent.uid, process.getuid());
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(parent.mode & 0o077, 0);
  assert.ok(socket ? stat.isSocket() : stat.isFile());
}
export function createSchedulerClient({
  socketPath,
  secret,
  request = callScheduler,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const invoke = async (method, args, id = randomUUID()) => {
    try {
      return await request({ socketPath, secret, id, method, args, timeoutMs: 30000 });
    } catch (error) {
      error.schedulerRequest = { id, method };
      throw error;
    }
  };
  const client = Object.fromEntries(
    ['enqueue', 'assertAdmission', 'recordSpawn', 'complete', 'block'].map((method) => [
      method,
      (...args) => invoke(method, args),
    ]),
  );
  client.waitAdmission = async (ticket) => {
    const claimId = randomUUID();
    for (;;) {
      const id = randomUUID();
      let response;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await invoke('pollAdmission', [ticket, claimId], id);
          break;
        } catch (error) {
          if (attempt >= 2 || !['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(error.code)) throw error;
          await sleep(1000); // Same request ID, only idempotent poll, bounded recovery.
        }
      }
      if (response?.status === 'admitted') return response.admission;
      assert.equal(response?.status, 'pending', 'Unknown scheduler wait response');
      await sleep(5000);
    }
  };
  return client;
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseSchedulerEntry(args);
  const readOnly = parsed.verificationArgs.includes('--list') || parsed.verificationArgs.includes('--help');
  let broker;
  if (!readOnly) {
    assert.ok(
      parsed.socketPath && parsed.capabilityFile,
      'Existing verified coordinator required; no automatic installation',
    );
    privatePath(parsed.socketPath, true);
    privatePath(parsed.capabilityFile, false);
    const secret = readFileSync(parsed.capabilityFile, 'utf8').trim();
    assert.ok(secret.length >= 32);
    broker = createSchedulerClient({ socketPath: parsed.socketPath, secret });
  }
  // verifyMain still performs original business contracts, impact/CI checks, reporter and planning.
  return verifyMain(parsed.verificationArgs, {
    execute: (plan, options) =>
      createScheduledPlanExecutor({ taskId: parsed.taskId, owner: process.env.CODEX_THREAD_ID, broker })(plan, options),
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
