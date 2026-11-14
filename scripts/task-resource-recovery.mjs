import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
const optional = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};
// Read-only diagnosis only: no lock deletion, PID adoption, SIGSTOP/TERM, or replay of saved commands.
export function inspectSchedulerRecovery(directory) {
  const root = path.resolve(directory);
  for (let p = root; ; p = path.dirname(p)) {
    try {
      assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked recovery path refused');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (p === path.dirname(p)) break;
  }
  for (const name of ['state.json', 'scheduler.lock', 'scheduler.lock/owner.json']) {
    try {
      assert.ok(!lstatSync(path.join(root, name)).isSymbolicLink(), 'Linked recovery state refused');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  const state = optional(path.join(root, 'state.json'));
  const owner = optional(path.join(root, 'scheduler.lock', 'owner.json'));
  let lockExists = false;
  try {
    lockExists = lstatSync(path.join(root, 'scheduler.lock')).isDirectory();
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (state) assert.equal(state.version, 1);
  const jobs = state?.jobs ?? [];
  const unresolved = jobs
    .filter((j) => j.runtimeUncertain || ['starting', 'running', 'stopping'].includes(j.status))
    .map((j) => ({
      id: j.id,
      task: j.task,
      status: j.status,
      reason: 'Actual termination and original locks/resources require verification',
    }));
  return {
    lockPresent: lockExists,
    ownerRecorded: !!owner,
    cleanOpenPossible: !lockExists && unresolved.length === 0,
    unresolved,
    orphanedQueued: jobs
      .filter((j) => ['queued', 'waiting-client'].includes(j.status))
      .map((j) => ({ id: j.id, task: j.task })),
    automaticReplay: false,
    automaticUnlock: false,
    guidance: lockExists
      ? 'Do not remove the lock based only on PID absence; reconcile original runner and external resources'
      : unresolved.length
        ? 'Do not release active reservations or adopt saved PIDs'
        : 'Explicit verified task reattachment may open a new coordinator',
  };
}
