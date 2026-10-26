import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scope = new AsyncLocalStorage();
export const completionDirectory = Symbol('completionDirectory');
export function processScope(state, event, save, run) {
  return scope.run({ state, event, save }, run);
}
// The supervisor starts a new POSIX session before launching any command. Its
// foreground descendants inherit the group even if the completion owner exits.
// No command arguments, environment values or command output enter the journal.
const supervisor = `
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import os from 'node:os';
const [file, token, command, ...args] = process.argv.slice(1);
const intent = JSON.parse(readFileSync(file, 'utf8'));
if (intent.token !== token || intent.status !== 'pending') throw Error('Invalid child intent');
const record = { token, host: os.hostname(), pgid: process.pid, status: 'started' };
const publish = () => { writeFileSync(file + '.tmp', JSON.stringify(record), { mode: 0o600, flag: 'wx' }); renameSync(file + '.tmp', file); };
publish();
const result = spawnSync(command, args, { stdio: 'inherit' });
record.status = 'exited'; record.exitCode = result.status; record.signal = result.signal;
publish();
process.exit(result.status ?? 1);
`;
export function runCompletionProcess(command, args, options = {}) {
  const current = scope.getStore();
  if (!current) return spawnSync(command, args, options);
  assert.notEqual(process.platform, 'win32', 'Completion recovery requires POSIX process groups');
  const { state, event, save } = current;
  const directory = state[completionDirectory];
  assert.ok(directory, 'Missing private process journal directory');
  const token = randomUUID(),
    file = path.join(directory, 'process-' + token + '.json');
  writeFileSync(file, JSON.stringify({ token, status: 'pending' }), { flag: 'wx', mode: 0o600 });
  (event.processes ??= []).push({ token });
  save(state); // Commit intent before spawn. A crash in this window blocks recovery.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', supervisor, file, token, command, ...args], {
    ...options,
    detached: true,
  });
  assertProcessesGone({ processTracking: 1, processes: [{ token }] }, directory);
  return result;
}
export function assertProcessesGone(
  event,
  directory,
  { host = os.hostname(), probe = (pid) => process.kill(pid, 0) } = {},
) {
  assert.equal(event.processTracking, 1, 'Legacy stage lacks subprocess proof; preserve state');
  assert.ok(Array.isArray(event.processes), 'Missing subprocess inventory; preserve state');
  for (const child of event.processes) {
    assert.match(child.token, /^[a-f0-9-]{36}$/);
    const file = path.join(directory, 'process-' + child.token + '.json');
    assert.ok(
      existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(),
      'Missing child journal',
    );
    assert.equal(lstatSync(file).mode & 0o077, 0, 'Child journal must be owner-only');
    const record = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(
      record.token === child.token &&
        record.host === host &&
        Number.isSafeInteger(record.pgid) &&
        record.pgid > 1 &&
        ['started', 'exited', 'quiescent'].includes(record.status),
      'Unknown subprocess launch; preserve state',
    );
    if (record.status === 'quiescent') continue; // Proven absence seals this unique launch, even after PID reuse.
    try {
      probe(-record.pgid); // A live/reused group or permission error always blocks.
    } catch (error) {
      if (error.code === 'ESRCH') {
        const sealed = file + '.' + randomUUID() + '.tmp';
        writeFileSync(sealed, JSON.stringify({ ...record, status: 'quiescent' }), { mode: 0o600, flag: 'wx' });
        renameSync(sealed, file);
        continue;
      }
      throw error;
    }
    throw Error('Subprocess group is alive; preserve state');
  }
}
