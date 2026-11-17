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
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { forwardIntegrationEnvironment } from ${JSON.stringify(new URL('./integration-resource.mjs', import.meta.url).href)};
import os from 'node:os';
const [file, token, stopMode, command, ...args] = process.argv.slice(1);
const intent = JSON.parse(readFileSync(file, 'utf8'));
if (!['group', 'direct'].includes(stopMode) || intent.token !== token || intent.status !== 'pending') throw Error('Invalid child intent');
const record = { token, host: os.hostname(), pgid: process.pid, status: 'started' };
const publish = () => { writeFileSync(file + '.tmp', JSON.stringify(record), { mode: 0o600, flag: 'wx' }); renameSync(file + '.tmp', file); };
// A started record authorizes group termination, so publish it only after the
// child exists. Publishing before spawn allows TERM to race with a later fork.
let child;
let stopping = false;
// Keep the supervisor alive to reap its direct child. The outer stop already
// signals the entire owned group, including the child, exactly once.
if (stopMode === 'group') process.on('SIGTERM', () => {
  stopping = true;
});
try { child = spawn(command, args, { stdio: 'inherit', env: forwardIntegrationEnvironment() }); }
catch (error) {
  record.status = 'exited'; record.exitCode = 1; record.signal = null;
  publish(); process.stderr.write(error.message + '\\n'); process.exit(1);
}
child.once('spawn', () => {
  publish();
  // Notification is advisory: the parent may disappear between this check and send.
  // The callback consumes asynchronous IPC errors; catch covers synchronous ones.
  if (process.send && process.connected) {
    try { process.send({ token, childPid: child.pid }, () => {}); } catch {}
  }
});
child.once('error', (error) => { process.stderr.write(error.message + '\\n'); });
child.once('close', (code, signal) => {
  record.status = 'exited'; record.exitCode = code ?? 1; record.signal = signal;
  publish(); process.exit(stopping && code === 0 ? 143 : (code ?? 1));
});
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
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', supervisor, file, token, 'direct', command, ...args],
    {
      ...options,
      detached: true,
    },
  );
  assertProcessesGone({ processTracking: 1, processes: [{ token }] }, directory);
  return result;
}
export function startCompletionProcess(command, args, options = {}) {
  assert.ok(!options.timeout && !options.signal, 'Owned group processes must be stopped through stopCompletionProcess');
  const { onCommandSpawn, ...spawnOptions } = options;
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
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', supervisor, file, token, 'group', command, ...args],
    {
      ...spawnOptions,
      ...(onCommandSpawn ? { stdio: [...(spawnOptions.stdio ?? ['pipe', 'pipe', 'pipe']), 'ipc'] } : {}),
      detached: true,
    },
  );
  if (onCommandSpawn) {
    let observed = false;
    child.on('message', (message) => {
      if (observed || message?.token !== token || !Number.isSafeInteger(message.childPid) || message.childPid <= 1)
        return;
      observed = true;
      try {
        Promise.resolve(onCommandSpawn({ pid: message.childPid })).catch(() => {});
      } catch {
        /* Advisory observers cannot change command results. */
      }
    });
  }
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
        typeof record.host === 'string' &&
        record.host.trim().length > 0 &&
        Number.isSafeInteger(record.pgid) &&
        record.pgid > 1 &&
        ['started', 'exited', 'quiescent'].includes(record.status),
      'Unknown subprocess launch; preserve state',
    );
    if (record.host !== host) {
      // A foreign PID cannot be probed locally. Only a previously sealed launch
      // with its exact, unique persisted session reference can cross host names.
      assert.equal(record.status, 'quiescent', 'Unknown subprocess launch; preserve state');
      assert.ok(
        Number.isSafeInteger(record.exitCode) &&
          record.exitCode >= 0 &&
          (record.signal === null || (typeof record.signal === 'string' && /^SIG[A-Z0-9]+$/.test(record.signal))),
        'Incomplete sealed subprocess outcome; preserve state',
      );
      const sessionFile = path.join(directory, 'completion-session.json');
      assert.ok(
        existsSync(sessionFile) &&
          lstatSync(sessionFile).isFile() &&
          !lstatSync(sessionFile).isSymbolicLink() &&
          (lstatSync(sessionFile).mode & 0o077) === 0,
        'Missing private subprocess session reference; preserve state',
      );
      const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
      assert.ok(session.version === 1 && Array.isArray(session.events), 'Invalid subprocess session; preserve state');
      const references = session.events.flatMap((stage) =>
        (stage.processes ?? []).filter((process) => process.token === child.token).map(() => stage),
      );
      assert.equal(references.length, 1, 'Subprocess must have one session reference; preserve state');
      assert.ok(
        typeof event.id === 'string' &&
          event.id.length > 0 &&
          typeof event.name === 'string' &&
          event.name.length > 0 &&
          typeof event.key === 'string' &&
          event.key.length > 0,
        'Unknown subprocess stage identity; preserve state',
      );
      assert.deepEqual(references[0], event, 'Subprocess session reference changed; preserve state');
    }
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
