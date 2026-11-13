import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync, spawn } from 'node:child_process';
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
import { forwardIntegrationEnvironment } from ${JSON.stringify(new URL('./integration-resource.mjs', import.meta.url).href)};
import os from 'node:os';
const [file, token, command, ...args] = process.argv.slice(1);
const intent = JSON.parse(readFileSync(file, 'utf8'));
if (intent.token !== token || intent.status !== 'pending') throw Error('Invalid child intent');
const record = { token, host: os.hostname(), pgid: process.pid, status: 'started' };
const publish = () => { writeFileSync(file + '.tmp', JSON.stringify(record), { mode: 0o600, flag: 'wx' }); renameSync(file + '.tmp', file); };
publish();
let result;
try { result = spawnSync(command, args, { stdio: 'inherit', env: forwardIntegrationEnvironment() }); }
catch (error) { process.stderr.write(error.message + '\\n'); result = {status:1,signal:null}; }
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
export function startCompletionProcess(command, args, options = {}) {
  const current = scope.getStore();
  assert.ok(current, 'Long-lived validation process requires its exact completion stage');
  const { state, event, save } = current,
    directory = state[completionDirectory];
  assert.ok(directory && process.platform !== 'win32');
  const token = randomUUID(),
    file = path.join(directory, 'process-' + token + '.json');
  writeFileSync(file, JSON.stringify({ token, status: 'pending' }), { flag: 'wx', mode: 0o600 });
  (event.processes ??= []).push({ token });
  save(state);
  const child = spawn(process.execPath, ['--input-type=module', '-e', supervisor, file, token, command, ...args], {
    ...options,
    detached: true,
  });
  child.completionProof = { directory, token, file };
  return child;
}
export async function stopCompletionProcess(child) {
  if (!child) return;
  const proof = child.completionProof;
  assert.ok(proof && Number.isSafeInteger(child.pid), 'Validation child launch is not proved');
  const record = JSON.parse(readFileSync(proof.file));
  assert.ok(
    record.token === proof.token && record.host === os.hostname() && record.pgid === child.pid,
    'Validation process group identity is unknown; retain it',
  );
  const alive = () => {
    try {
      process.kill(-record.pgid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  if (alive()) process.kill(-record.pgid, 'SIGTERM');
  // Reap our exact supervisor before probing its group again. Darwin can report
  // EPERM for the zombie-only group until Node dispatches this child's exit.
  // This is not proof that descendants are gone: the group check below remains
  // mandatory and still fails closed on EPERM or any other unknown error.
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve, reject) => {
      const onExit = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.removeListener('exit', onExit);
        reject(new Error('Validation supervisor did not exit; retain its original process proof'));
      }, 5000);
      child.once('exit', onExit);
    });
  }
  const deadline = Date.now() + 5000;
  while (alive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  // Do not kill an unknown/reused group after its supervisor disappeared.
  assert.equal(alive(), false, 'Validation descendants remain; retain their original process proof');
  assertProcessesGone({ processTracking: 1, processes: [{ token: proof.token }] }, proof.directory);
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
