import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';

export function inspectProcess(pid, exec = execFileSync) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  try {
    const text = exec('/bin/ps', ['-p', String(pid), '-o', 'pid=,pgid=,lstart='], { encoding: 'utf8' }).trim();
    if (!text) return null;
    const match = /^(\d+)\s+(\d+)\s+(.+)$/.exec(text);
    assert.ok(match, 'Cannot parse process identity');
    return { pid: Number(match[1]), pgid: Number(match[2]), startTime: match[3] };
  } catch (error) {
    if (error.status === 1 && !String(error.stdout ?? '').trim() && !String(error.stderr ?? '').trim()) return null;
    throw error;
  }
}
export function processGroupEmpty(pgid, exec = execFileSync) {
  const lines = exec('/bin/ps', ['-axo', 'pgid='], { encoding: 'utf8' }).trim().split(/\s+/);
  assert.ok(
    lines.every((s) => /^\d+$/.test(s)),
    'Process group inspection unavailable',
  );
  return !lines.some((value) => Number(value) === pgid);
}
// This controller owns only children created in THIS process. It never adopts saved PIDs.
// Existing gates with Docker/browser lifetimes stay non-preemptible until a cooperative adapter is verified.
export function createOwnedRunner({
  launch = spawn,
  inspect = inspectProcess,
  groupEmpty = processGroupEmpty,
  signal = (pgid) => process.kill(-pgid, 'SIGTERM'),
  fingerprint,
  saveIntent,
  saveIdentity,
  appendLog,
} = {}) {
  for (const fn of [fingerprint, saveIntent, saveIdentity, appendLog]) assert.equal(typeof fn, 'function');
  const handles = new Map();
  const pending = new Set();
  return {
    async start(spec) {
      spec = structuredClone(spec);
      assert.ok(spec.id && spec.worktree && spec.fingerprint);
      assert.equal(handles.has(spec.id) || pending.has(spec.id), false, 'Job already has a live controller');
      assert.ok(Array.isArray(spec.args) && spec.args.every((v) => typeof v === 'string'));
      pending.add(spec.id);
      try {
        assert.equal(await fingerprint(spec), spec.fingerprint, 'Candidate changed before launch');
        const runToken = randomUUID();
        await saveIntent({ id: spec.id, runToken, fingerprint: spec.fingerprint, status: 'launch-intent' });
        const child = launch(spec.command, spec.args, {
          cwd: spec.worktree,
          env: { ...spec.env, ZDM_SCHEDULER_RUN_TOKEN: runToken },
          detached: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const handle = { child, spec, runToken, identity: null, exited: false };
        handles.set(spec.id, handle);
        // Attach listeners before awaiting spawn, including extremely short commands.
        const completion = new Promise((resolve) => {
          child.once('error', (error) => {
            handle.error = error;
          });
          child.once('exit', () => {
            handle.exited = true;
          });
          child.once('close', (code, exitSignal) =>
            resolve({ code, signal: exitSignal, error: handle.error?.message }),
          );
        });
        for (const [stream, name] of [
          [child.stdout, 'stdout'],
          [child.stderr, 'stderr'],
        ]) {
          stream.on('data', (chunk) => {
            try {
              appendLog({ id: spec.id, runToken, stream: name, chunk });
            } catch (error) {
              handle.logError = error.message;
            }
          });
        }
        try {
          await once(child, 'spawn');
          const identity = inspect(child.pid);
          assert.ok(
            identity && identity.pid === child.pid && identity.pgid === child.pid,
            'Owned group identity not proved',
          );
          handle.identity = { ...identity, runToken, fingerprint: spec.fingerprint };
          await saveIdentity({ id: spec.id, ...handle.identity });
        } catch (error) {
          // Do not hide a child launched before a persistence/inspection failure. Keep controller for diagnosis.
          error.runnerJob = spec.id;
          throw error;
        }
        return {
          identity: handle.identity,
          completion: completion.then(async (result) => ({
            ...result,
            commandExitCode: result.code,
            code: handle.logError ? 1 : result.code,
            logError: handle.logError,
            runToken,
            fingerprint: await fingerprint(spec),
            processesEnded: groupEmpty(handle.identity.pgid),
          })),
        };
      } finally {
        pending.delete(spec.id);
      }
    },
    stop(id, runToken) {
      const handle = handles.get(id);
      assert.ok(handle && handle.runToken === runToken, 'No owned live controller for this run');
      assert.equal(handle.spec.restartable, true, 'Stage is not safely restartable');
      assert.equal(handle.spec.externalResources, false, 'External process/container lifecycle not supported');
      assert.equal(handle.exited, false, 'Leader exited; do not signal a potentially reused group');
      assert.ok(handle.identity, 'Launch identity was not recorded');
      const actual = inspect(handle.child.pid);
      for (const field of ['pid', 'pgid', 'startTime'])
        assert.equal(actual?.[field], handle.identity[field], 'Process identity changed');
      assert.equal(handle.stopRequested, undefined, 'Stop already requested; await termination');
      signal(actual.pgid);
      handle.stopRequested = true; // one TERM only; no SIGSTOP/SIGKILL or global name-based termination
    },
    release(id) {
      const handle = handles.get(id);
      assert.ok(
        handle?.exited && handle.identity && groupEmpty(handle.identity.pgid),
        'Owned processes still active or unknown',
      );
      handles.delete(id);
    },
    describe(id) {
      const h = handles.get(id);
      return h ? { id, runToken: h.runToken, identity: h.identity, exited: h.exited, error: h.error?.message } : null;
    },
  };
}
