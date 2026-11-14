import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  fsyncSync,
  closeSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTaskRegistry } from './task-registry.mjs';
import { submitMacNotification } from './task-resource-notifications.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function durableCreate(file, value) {
  const fd = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const parent = openSync(path.dirname(file), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

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

// The supervisor only orchestrates a supported original runner. It never stores/replays shell
// commands. A task-specific adapter must produce fresh exact-identity proof and obtain its own
// original queue/lease before it can continue. Unsupported legacy tasks remain visibly blocked.
export async function continueVerifiedTask({ intent, inspect, executeOriginal, directory, now = Date.now }) {
  assert.ok(intent?.task && /^[a-f0-9]{40}$/.test(intent.head ?? '') && intent.owner && intent.authorization);
  noLinks(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const key = digest(intent),
    claim = path.join(directory, key + '.claim.json');
  if (existsSync(claim)) return { status: 'blocked', reason: 'Prior continuation outcome must be reconciled', key };
  const proof = await inspect(intent);
  const valid =
    proof?.task === intent.task &&
    proof?.head === intent.head &&
    proof?.owner === intent.owner &&
    proof?.authorization === intent.authorization &&
    proof?.supported === true &&
    proof?.runnerAbsent === true &&
    proof?.resourcesResolved === true &&
    proof?.effectsReconciled === true &&
    proof?.candidateUnchanged === true &&
    proof?.paused === false &&
    proof?.requiresConfirmation === false &&
    proof?.ready === true &&
    Number.isFinite(proof?.observedAt) &&
    proof.observedAt <= now() &&
    now() - proof.observedAt <= 5000;
  if (!valid) return { status: 'blocked', reason: 'Fresh original-runner safety proof incomplete', key };
  // Persist before execution. A crash after this point is unknown, never an automatic replay.
  try {
    durableCreate(claim, { version: 1, key, intent, status: 'starting', at: now() });
  } catch (error) {
    if (error.code === 'EEXIST') return { status: 'blocked', reason: 'Another continuation claimed this intent', key };
    throw error;
  }
  let result;
  try {
    // Adapter must revalidate under the original runner's own ownership/queue lock. The observation
    // is not a lease and cannot grant admission. No generic command executor is provided.
    result = await executeOriginal(intent, proof);
  } catch (error) {
    result = { status: 'unknown', reason: error.message };
  }
  const outcome = { version: 1, key, result, at: now() };
  writeFileSync(path.join(directory, key + '.outcome.json'), JSON.stringify(outcome), { flag: 'wx', mode: 0o600 });
  return outcome;
}

export async function notifyContinuityChanges(observations, directory, { send = submitMacNotification } = {}) {
  noLinks(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const outcomes = [];
  for (const value of observations.filter((v) => ['interrupted', 'blocked'].includes(v.status))) {
    const eventId = digest(value),
      file = path.join(directory, eventId + '.json');
    try {
      // An unknown OS receipt is never retried blindly, including after this observer restarts.
      durableCreate(file, { eventId, status: 'submitting' });
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    let receipt;
    try {
      receipt = await send({
        eventId,
        title: '装点猫任务需要续接',
        body: `${value.task}：${value.status}\n${value.reason}`,
      });
    } catch (error) {
      receipt = { status: 'unknown', reason: error.message };
    }
    durableCreate(file + '.receipt', receipt);
    outcomes.push({ task: value.task, ...receipt });
  }
  return outcomes;
}
