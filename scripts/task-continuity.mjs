import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTaskRegistry } from './task-registry.mjs';

function noLinks(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if (existsSync(p)) assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked continuity input refused');
    if (p === path.dirname(p)) break;
  }
}
function read(file) {
  noLinks(file);
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function probeOwner(owner, { host = os.hostname(), probe = (pid) => process.kill(pid, 0) } = {}) {
  if (owner?.host !== host || !Number.isSafeInteger(owner.pid) || owner.pid < 2) return 'unknown';
  try {
    probe(owner.pid);
    // Legacy owner records have no start time. Never infer identity from a live PID alone.
    return 'present-unverified';
  } catch (error) {
    return error.code === 'ESRCH' ? 'absent' : 'unknown';
  }
}
// Side-effect free: never seals journals, marks success, releases leases or mutates task registry.
export function inspectTaskContinuity(task, completion, { observeOwner = probeOwner } = {}) {
  const base = { task: task.id, registeredStage: task.stage, resumeAutomatically: false };
  if (task.stage === 'closed') return { ...base, status: 'closed', reason: 'Registered final closure' };
  if (!completion)
    return { ...base, status: 'unobserved', reason: 'No instrumented completion session; not proof of an idle task' };
  assert.equal(completion.version, 1);
  assert.equal(completion.batch, task.id);
  assert.ok(Array.isArray(completion.events));
  if ((completion.pauses ?? []).some((p) => !p.finishedAt && !p.resumedAt))
    return { ...base, status: 'paused', reason: 'Explicit pause retained' };
  const running = completion.events.filter((e) => e.status === 'running');
  const observations = running.map((e) => ({ id: e.id, stage: e.name, owner: observeOwner(e.owner) }));
  if (observations.some((e) => e.owner === 'absent'))
    return {
      ...base,
      status: 'interrupted',
      reason: 'Recorded stage owner ended; effects/resources must be reconciled',
      observations,
    };
  if (observations.length)
    return {
      ...base,
      status: 'unverified-running',
      reason: 'PID presence is not verified execution identity',
      observations,
    };
  const last = completion.events.at(-1);
  if (last?.status === 'failure')
    return {
      ...base,
      status: 'blocked',
      reason: 'Original stage failure retained',
      stage: last.name,
      failureEvent: last,
    };
  return { ...base, status: 'awaiting-continuation', reason: 'No active stage proved; completion is not implied' };
}
export function verificationObservations(worktree) {
  const directory = path.join(worktree, '.task-verification');
  noLinks(directory);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .flatMap((name) => {
      const record = read(path.join(directory, name));
      if (record.status !== 'running') return [];
      assert.equal(record.identity?.root, worktree, 'Verification belongs to another worktree');
      return [
        {
          attemptId: record.attemptId,
          name: record.name,
          startedAt: record.startedAt,
          status: 'recorded-running-unverified',
          candidateDigest: record.identity?.source?.digest ?? null,
          reason: 'Legacy verification has no authoritative live owner; original worker must reconcile this attempt',
        },
      ];
    });
}
export function collectTaskContinuity(root, options = {}) {
  const registry = createTaskRegistry(root);
  return registry
    .list()
    .filter((t) => t.stage !== 'closed')
    .map((task) => {
      try {
        const file = path.join(registry.commonDir, 'task-delivery', task.id, 'completion-session.json');
        const observed = inspectTaskContinuity(task, existsSync(file) ? read(file) : null, options);
        const verification = verificationObservations(task.worktree);
        return verification.length ? { ...observed, verification } : observed;
      } catch (error) {
        return {
          task: task.id,
          registeredStage: task.stage,
          status: 'blocked',
          reason: error.message,
          resumeAutomatically: false,
        };
      }
    });
}
