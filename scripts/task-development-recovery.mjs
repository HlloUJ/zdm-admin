import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';

// Only a currently waiting invocation can consume a waiting-worker grant.
const waitingInvocations = new WeakMap();
import { createTaskRegistry } from './task-registry.mjs';
import {
  completionDirectory,
  processScope,
  startCompletionProcess,
  stopCompletionProcess,
} from './completion-process.mjs';

const read = (file) => {
  safe(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
function safe(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if (fs.existsSync(p)) assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Linked development recovery state');
    if (p === path.dirname(p)) break;
  }
}
function create(file, value) {
  safe(file);
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const parent = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
function context(root, taskId, requireOwner = true) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id: taskId });
  if (requireOwner) assert.equal(task.owner, process.env.CODEX_THREAD_ID, 'Original runtime owner required');
  assert.equal(task.stage, 'developing', 'Only ordinary developing tasks supported');
  assert.ok(!task.frozen && !task.previewOnly && !task.compatibility?.readOnly);
  const directory = path.join(registry.commonDir, 'task-development-recovery', task.id);
  safe(directory);
  if (requireOwner) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  else assert.ok(fs.statSync(directory).isDirectory(), 'Recovery evidence directory missing');
  return { registry, task, directory };
}
const git = (task, ...args) => execFileSync('git', ['-C', task.worktree, ...args], { encoding: 'utf8' }).trim();
function cleanHead(task) {
  assert.equal(git(task, 'status', '--porcelain'), '', 'Save an exact clean code checkpoint first');
  const head = git(task, 'rev-parse', 'HEAD');
  assert.equal(head, task.recordedHead, 'Save original task checkpoint through its formal work entry');
  return head;
}
export function createDevelopmentCheckpoint(root, { taskId, worker, rootThreadId, authorizationRef, nextStep }) {
  const { task, directory } = context(root, taskId);
  assert.ok(!fs.existsSync(path.join(directory, 'active-attempt.json')), 'Active or unresolved continuation');
  assert.match(worker, /^\/root\/[a-z0-9_/]+$/);
  for (const value of [rootThreadId, authorizationRef, nextStep]) assert.ok(typeof value === 'string' && value.trim());
  // An unresolved prior attempt cannot be erased by issuing a fresh checkpoint.
  for (const name of fs.readdirSync(directory).filter((n) => n.startsWith('attempt-') && n.endsWith('.json'))) {
    const attempt = read(path.join(directory, name));
    assert.ok(fs.existsSync(path.join(directory, `outcome-${attempt.id}.json`)), 'Prior attempt outcome unknown');
    assert.equal(
      read(path.join(directory, `outcome-${attempt.id}.json`)).status,
      'completed',
      'Resolve failed attempt explicitly',
    );
  }
  const checkpoint = {
    version: 1,
    id: randomUUID(),
    nonce: randomUUID(),
    taskId,
    owner: task.owner,
    worker,
    rootThreadId,
    authorizationRef,
    nextStep,
    head: cleanHead(task),
    registryRevision: task.revision,
    createdAt: Date.now(),
  };
  create(path.join(directory, `checkpoint-${checkpoint.id}.json`), checkpoint);
  if (!fs.existsSync(path.join(directory, 'control-0.json')))
    create(path.join(directory, 'control-0.json'), { revision: 0, paused: true, authorizationRef, taskId });
  return checkpoint;
}

function controlGate(directory, action) {
  const lock = path.join(directory, 'control-gate');
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    return action();
  } finally {
    fs.rmdirSync(lock);
  }
}

function control(directory) {
  const revisions = fs
    .readdirSync(directory)
    .filter((n) => /^control-\d+\.json$/.test(n))
    .map((n) => Number(n.slice(8, -5)));
  assert.ok(revisions.length, 'Explicit control missing');
  return read(path.join(directory, `control-${Math.max(...revisions)}.json`));
}
export function setDevelopmentControl(root, { taskId, expectedRevision, paused, authorizationRef }) {
  const { directory } = context(root, taskId);
  return controlGate(directory, () => {
    const current = control(directory);
    assert.equal(current.revision, expectedRevision, 'Control revision changed');
    assert.equal(typeof paused, 'boolean');
    assert.ok(authorizationRef);
    const next = { taskId, revision: expectedRevision + 1, paused, authorizationRef, at: Date.now() };
    create(path.join(directory, `control-${next.revision}.json`), next);
    return next;
  });
}
// The root verifies the live original worker and this request while this invocation
// is waiting. Its fresh receipt is consumed locally, not after another cloud wake.
export async function runWaitingDevelopmentContinuation(root, options) {
  const { task, directory } = context(root, options.taskId);
  assert.match(options.checkpointId, /^[a-f0-9-]{36}$/);
  const checkpoint = read(path.join(directory, `checkpoint-${options.checkpointId}.json`));
  for (const key of ['taskId', 'worker', 'rootThreadId', 'authorizationRef'])
    assert.equal(checkpoint[key], options[key]);
  assert.equal(checkpoint.owner, task.owner);
  assert.equal(checkpoint.registryRevision, task.revision);
  assert.equal(checkpoint.head, cleanHead(task));
  const allowed = control(directory);
  assert.equal(allowed.paused, false, 'Task explicitly paused');
  assert.equal(allowed.authorizationRef, options.authorizationRef);
  assert.ok(!fs.existsSync(path.join(directory, 'active-attempt.json')), 'Active or unresolved continuation');
  assert.ok(!fs.existsSync(path.join(directory, `attempt-${checkpoint.id}.json`)), 'Checkpoint already consumed');
  const waitMs = options.waitMs ?? 300000;
  assert.ok(Number.isInteger(waitMs) && waitMs > 0 && waitMs <= 600000, 'Bounded handoff wait required');
  const id = randomUUID();
  const request = {
    version: 1,
    id,
    checkpoint,
    controlRevision: allowed.revision,
    workerState: 'waiting-for-handoff',
    pid: process.pid,
    host: os.hostname(),
    createdAt: Date.now(),
    expiresAt: Date.now() + waitMs,
  };
  const requestFile = path.join(directory, `handoff-${id}.json`);
  const receiptFile = path.join(directory, `handoff-${id}.receipt.json`);
  create(requestFile, request);
  const token = {};
  waitingInvocations.set(token, request);
  try {
    // Publication is only a request, never execution evidence.
    const publication = options.onWaiting?.({ request, requestFile, receiptFile });
    assert.ok(!publication || typeof publication.then !== 'function', 'Waiting publication must return synchronously');
    while (Date.now() <= request.expiresAt) {
      assert.deepEqual(control(directory), allowed, 'Control changed while waiting');
      if (fs.existsSync(receiptFile)) {
        const reachability = read(receiptFile);
        assert.equal(reachability.handoffId, id, 'Wrong waiting handoff');
        assert.equal(reachability.receiverPid, process.pid, 'Wrong waiting receiver');
        assert.equal(reachability.receiverHost, os.hostname(), 'Wrong waiting host');
        assert.ok(reachability.observedAt >= request.createdAt, 'Receipt predates request');
        return await runDevelopmentContinuation(root, { ...options, reachability, waitingToken: token });
      }
      await pause(50);
    }
    throw Error('Waiting handoff expired; no continuation executed');
  } finally {
    waitingInvocations.delete(token);
    create(path.join(directory, `handoff-${id}.closed.json`), { id, closedAt: Date.now() });
  }
}

export async function runDevelopmentContinuation(
  root,
  { taskId, checkpointId, worker, rootThreadId, authorizationRef, reachability, execute, waitingToken },
) {
  const { task, directory } = context(root, taskId);
  assert.match(checkpointId, /^[a-f0-9-]{36}$/);
  const checkpoint = read(path.join(directory, `checkpoint-${checkpointId}.json`));
  assert.equal(checkpoint.taskId, taskId);
  assert.equal(checkpoint.id, checkpointId);
  assert.equal(checkpoint.owner, task.owner);
  assert.equal(checkpoint.worker, worker);
  assert.equal(checkpoint.rootThreadId, rootThreadId);
  assert.equal(checkpoint.authorizationRef, authorizationRef);
  assert.equal(checkpoint.registryRevision, task.revision);
  assert.equal(checkpoint.head, cleanHead(task));
  const allowed = control(directory);
  assert.equal(allowed.paused, false, 'Task explicitly paused');
  assert.equal(allowed.authorizationRef, authorizationRef);
  const waiting = waitingInvocations.get(waitingToken);
  const validWorkerState = waiting
    ? reachability?.workerState === 'waiting-for-handoff' &&
      reachability.handoffId === waiting.id &&
      Date.now() <= waiting.expiresAt
    : reachability?.workerState === 'idle';
  // The trusted root must independently obtain this receipt using native collaboration tools.
  // This local module cannot prove cloud identity; no caller-supplied owner replacement is allowed.
  assert.ok(
    reachability &&
      reachability.worker === worker &&
      reachability.rootThreadId === rootThreadId &&
      reachability.authorizationRef === authorizationRef &&
      reachability.taskId === taskId &&
      reachability.owner === task.owner &&
      reachability.checkpointId === checkpointId &&
      reachability.head === checkpoint.head &&
      reachability.nonce === checkpoint.nonce &&
      typeof reachability.receiptId === 'string' &&
      reachability.receiptId.length > 0 &&
      validWorkerState &&
      reachability.interruptionConfirmed === true &&
      reachability.effectsReconciled === true &&
      reachability.resourcesResolved === true &&
      Number.isFinite(reachability.observedAt) &&
      Date.now() >= reachability.observedAt &&
      Date.now() - reachability.observedAt <= 5000,
    'Fresh independently verified original worker handoff required',
  );
  assert.equal(typeof execute, 'function');
  const attempt = {
    id: checkpointId,
    checkpoint,
    reachability,
    controlRevision: allowed.revision,
    nonce: randomUUID(),
    startedAt: Date.now(),
  };
  // Exclusive per-checkpoint admission; an unknown crash never becomes automatic replay.
  assert.ok(!fs.existsSync(path.join(directory, `attempt-${checkpointId}.json`)), 'Checkpoint already consumed');
  create(path.join(directory, 'active-attempt.json'), { checkpointId, nonce: attempt.nonce });
  create(path.join(directory, `attempt-${checkpointId}.json`), attempt);
  const event = { id: randomUUID(), processTracking: 1, processes: [] },
    state = { events: [event] };
  state[completionDirectory] = directory;
  const save = () => {
    const file = path.join(directory, `process-state-${checkpointId}.json`),
      temporary = file + '.' + randomUUID();
    create(temporary, { nonce: attempt.nonce, checkpointId, event });
    fs.renameSync(temporary, file);
  };
  let starts = 0;
  let child;
  try {
    assert.deepEqual(control(directory), allowed, 'Control changed before entry');
    await processScope(state, event, save, () =>
      execute({
        start(command, args, options = {}) {
          assert.equal(starts++, 0, 'One supervised entry per continuation');
          return controlGate(directory, () => {
            assert.deepEqual(control(directory), allowed, 'Control changed before spawn');
            child = startCompletionProcess(command, args, { ...options, cwd: task.worktree });
            return child;
          });
        },
      }),
    );
    assert.equal(starts, 1, 'No actual supervised work started');
    for (const p of event.processes) {
      const journal = read(path.join(directory, `process-${p.token}.json`));
      assert.equal(journal.host, os.hostname());
      assert.equal(journal.status, 'exited');
      assert.equal(journal.exitCode, 0);
    }
    const outcome = { status: 'completed', checkpointId, nonce: attempt.nonce, finishedAt: Date.now() };
    create(path.join(directory, `outcome-${checkpointId}.json`), outcome);
    assert.equal(read(path.join(directory, 'active-attempt.json')).nonce, attempt.nonce);
    fs.unlinkSync(path.join(directory, 'active-attempt.json'));
    return outcome;
  } catch (error) {
    if (child) {
      try {
        await stopCompletionProcess(child);
      } catch {
        /* Preserve unknown outcome and original process evidence. */
      }
    }
    create(path.join(directory, `outcome-${checkpointId}.json`), {
      status: 'unknown',
      checkpointId,
      nonce: attempt.nonce,
      reason: error.message,
      at: Date.now(),
    });
    throw error;
  }
}
export function readDevelopmentStart(root, { taskId, checkpointId }) {
  const { task, directory } = context(root, taskId, false);
  assert.match(checkpointId, /^[a-f0-9-]{36}$/);
  const attempt = read(path.join(directory, `attempt-${checkpointId}.json`));
  assert.equal(attempt.id, checkpointId);
  assert.equal(attempt.checkpoint.id, checkpointId);
  assert.equal(attempt.checkpoint.taskId, taskId);
  assert.equal(attempt.checkpoint.owner, task.owner);
  assert.equal(control(directory).paused, false, 'Paused notification');
  const outcomeFile = path.join(directory, `outcome-${checkpointId}.json`);
  if (fs.existsSync(outcomeFile)) assert.equal(read(outcomeFile).status, 'completed', 'Unknown or failed continuation');
  const state = read(path.join(directory, `process-state-${checkpointId}.json`));
  assert.equal(state.nonce, attempt.nonce);
  assert.equal(state.checkpointId, checkpointId);
  assert.equal(state.event.processes.length, 1);
  const token = state.event.processes[0].token;
  assert.match(token, /^[a-f0-9-]{36}$/);
  const journal = read(path.join(directory, `process-${token}.json`));
  assert.equal(journal.token, token);
  assert.equal(journal.host, os.hostname());
  assert.equal(journal.status, 'started', 'Actual spawn not currently proven');
  return {
    eventId: attempt.nonce,
    taskId,
    checkpointId,
    owner: attempt.checkpoint.owner,
    worker: attempt.checkpoint.worker,
    stageId: state.event.id,
    token,
    status: 'started',
    taskCompleted: false,
  };
}

// Root transport reuses the formal recovery-notice outbox; this is only its ordinary-development source.
export function readDevelopmentNotice(root, binding) {
  try {
    for (const key of [
      'taskId',
      'checkpointId',
      'owner',
      'worker',
      'rootThreadId',
      'authorizationRef',
      'taskNumber',
      'taskName',
      'roomId',
    ])
      assert.ok(binding[key]);
    const { task, directory } = context(root, binding.taskId, false);
    assert.match(binding.checkpointId, /^[a-f0-9-]{36}$/);
    const attempt = read(path.join(directory, `attempt-${binding.checkpointId}.json`));
    const c = attempt.checkpoint;
    assert.equal(attempt.id, binding.checkpointId);
    assert.equal(c.id, binding.checkpointId);
    assert.equal(c.taskId, task.id);
    assert.equal(c.owner, task.owner);
    for (const key of ['owner', 'worker', 'rootThreadId', 'authorizationRef']) assert.equal(c[key], binding[key]);
    assert.equal(control(directory).paused, false);
    const outcomeFile = path.join(directory, `outcome-${binding.checkpointId}.json`);
    const outcome = fs.existsSync(outcomeFile) ? read(outcomeFile) : null;
    if (outcome) {
      assert.equal(outcome.nonce, attempt.nonce);
      assert.equal(outcome.checkpointId, c.id);
    }
    let success;
    if (outcome?.status === 'unknown') success = false;
    else if (outcome?.status === 'completed') success = true;
    else {
      readDevelopmentStart(root, { taskId: task.id, checkpointId: c.id });
      success = true;
    }
    const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const identity = {
      task: task.id,
      owner: task.owner,
      checkpointId: c.id,
      nonce: attempt.nonce,
      head: c.head,
      worker: c.worker,
      rootThreadId: c.rootThreadId,
      authorizationRef: c.authorizationRef,
      roomId: binding.roomId,
      taskNumber: binding.taskNumber,
      taskName: binding.taskName,
    };
    const reason = success ? null : '续接执行未完成，具体原因待查';
    return {
      status: 'ready',
      eventId: hash({ ...identity, success }),
      identityDigest: hash(identity),
      evidenceDigest: hash({ attempt, outcome }),
      task: task.id,
      originalOwner: task.owner,
      interruptionEventId: c.id,
      attemptId: attempt.nonce,
      success,
      reason,
      roomId: binding.roomId,
      text: `${binding.taskNumber}｜${binding.taskName}：${success ? '已成功续接。' : `续接失败。${reason}。`}`,
      taskCompleted: false,
    };
  } catch (error) {
    return { status: 'blocked', reason: error.message };
  }
}
