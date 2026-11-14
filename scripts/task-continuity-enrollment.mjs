import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createTaskRegistry } from './task-registry.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function safe(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    try {
      assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Linked enrollment state refused');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (p === path.dirname(p)) break;
  }
}
function bytes(file, optional = false) {
  safe(file);
  try {
    assert.ok(fs.statSync(file).isFile(), 'Regular enrollment input required');
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  }
}
const read = (file) => JSON.parse(bytes(file));
function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function create(file, value) {
  safe(file);
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDirectory(path.dirname(file));
}
function context(root, taskId) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id: taskId });
  const directory = path.join(registry.commonDir, 'task-continuity-supervision');
  safe(directory);
  return { registry, task, directory };
}
function snapshot(root, taskId) {
  const { registry, task, directory } = context(root, taskId);
  const inputs = {};
  for (const name of ['controlled-recovery-policy.json', 'activation-receipt.json', 'bindings.candidate.json'])
    inputs[name] = bytes(path.join(directory, name));
  const policy = JSON.parse(inputs['controlled-recovery-policy.json']),
    activation = JSON.parse(inputs['activation-receipt.json']),
    bindings = JSON.parse(inputs['bindings.candidate.json']);
  assert.equal(policy.version, 1);
  assert.equal(policy.bindingsFile, 'bindings.candidate.json');
  assert.equal(policy.activationReceipt, 'activation-receipt.json');
  assert.equal(activation.version, 1);
  assert.equal(bindings.version, 1);
  assert.ok(Array.isArray(bindings.bindings));
  assert.equal(policy.rootThreadId, bindings.rootThreadId);
  assert.equal(activation.rootThreadId, bindings.rootThreadId);
  assert.equal(policy.roomId, bindings.roomId);
  const controls = path.join(registry.commonDir, 'task-development-recovery', taskId);
  safe(controls);
  const controlFiles = fs.existsSync(controls)
    ? fs
        .readdirSync(controls)
        .filter((n) => /^control-\d+\.json$/.test(n))
        .sort()
    : [];
  for (const name of controlFiles) inputs['control/' + name] = bytes(path.join(controls, name));
  const checkpointFiles = fs.existsSync(controls)
    ? fs
        .readdirSync(controls)
        .filter((n) => /^checkpoint-[a-f0-9-]{36}\.json$/.test(n))
        .sort()
    : [];
  for (const name of checkpointFiles) inputs['checkpoint/' + name] = bytes(path.join(controls, name));
  inputs.completion = bytes(path.join(registry.commonDir, 'task-delivery', taskId, 'completion-session.json'), true);
  const head = execFileSync('git', ['-C', task.worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const worktreeStatus = execFileSync('git', ['-C', task.worktree, 'status', '--porcelain'], { encoding: 'utf8' });
  const value = { version: 1, task, head, worktreeStatus, inputs };
  return { ...value, digest: digest(value) };
}
export function readEnrollmentSnapshot(root, { taskId }) {
  return snapshot(root, taskId);
}
function exact(current, expected) {
  assert.ok(expected && expected.digest, 'Expected enrollment snapshot required');
  assert.equal(current.digest, expected.digest, 'Enrollment snapshot changed');
  assert.deepEqual(current, expected, 'Exact full snapshot required');
}
export function requestContinuityEnrollment(root, options) {
  const {
    taskId,
    worker,
    rootThreadId,
    authorizationRef,
    taskStableId,
    taskNumber,
    taskName,
    expectedSnapshot,
    checkpointId,
  } = options;
  const current = snapshot(root, taskId);
  exact(current, expectedSnapshot);
  assert.equal(process.env.CODEX_THREAD_ID, current.task.owner, 'Original runtime owner required');
  assert.notEqual(current.task.stage, 'closed', 'Closed task cannot enroll');
  assert.ok(!current.task.frozen, 'Frozen task cannot enroll');
  assert.equal(
    execFileSync('git', ['-C', current.task.worktree, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
    '',
    'Clean worktree required',
  );
  assert.match(worker, /^\/root\/[a-z0-9_/]+$/);
  for (const field of [rootThreadId, authorizationRef, taskStableId, taskNumber, taskName])
    assert.ok(typeof field === 'string' && field.trim(), 'Explicit enrollment binding required');
  assert.equal(JSON.parse(current.inputs['bindings.candidate.json']).rootThreadId, rootThreadId);
  assert.equal(current.head, current.task.recordedHead, 'Official code checkpoint required');
  if (checkpointId !== undefined) {
    assert.match(checkpointId, /^[a-f0-9-]{36}$/);
    const raw = current.inputs[`checkpoint/checkpoint-${checkpointId}.json`];
    assert.ok(raw, 'Original development checkpoint required');
    const checkpoint = JSON.parse(raw);
    assert.equal(checkpoint.version, 1);
    assert.equal(checkpoint.id, checkpointId);
    for (const [key, value] of Object.entries({
      taskId,
      owner: current.task.owner,
      worker,
      rootThreadId,
      authorizationRef,
      head: current.head,
      registryRevision: current.task.revision,
    }))
      assert.equal(checkpoint[key], value, 'Exact original development checkpoint binding required');
  }
  const { directory } = context(root, taskId),
    requests = path.join(directory, 'enrollment-requests');
  safe(requests);
  fs.mkdirSync(requests, { recursive: true, mode: 0o700 });
  syncDirectory(directory);
  const request = {
    version: 1,
    id: randomUUID(),
    taskId,
    owner: current.task.owner,
    worker,
    rootThreadId,
    authorizationRef,
    taskStableId,
    taskNumber,
    taskName,
    ...(checkpointId === undefined ? {} : { checkpointId }),
    snapshot: current,
    createdAt: Date.now(),
    observationOnly: true,
    resumeAllowed: false,
  };
  create(path.join(requests, request.id + '.json'), request);
  return request;
}
export function acceptContinuityEnrollment(root, { requestId, expectedSnapshot, platformReceipt }) {
  assert.match(requestId, /^[a-f0-9-]{36}$/);
  const registry = createTaskRegistry(root),
    directory = path.join(registry.commonDir, 'task-continuity-supervision');
  const requests = path.join(directory, 'enrollment-requests'),
    request = read(path.join(requests, requestId + '.json'));
  assert.equal(request.version, 1);
  assert.equal(request.id, requestId);
  assert.equal(process.env.CODEX_THREAD_ID, request.rootThreadId, 'Original runtime root required');
  const acceptedFile = path.join(requests, requestId + '.accepted.json');
  if (bytes(acceptedFile, true) !== null) {
    const accepted = read(acceptedFile);
    assert.equal(accepted.requestId, requestId);
    const bindings = read(path.join(directory, 'bindings.candidate.json'));
    const matches = bindings.bindings.filter((b) => b.task === request.taskId);
    assert.equal(matches.length, 1, 'Accepted binding missing or duplicated');
    assert.deepEqual(matches[0], accepted.binding, 'Accepted binding changed; reconcile');
    assert.equal(accepted.binding.owner, request.owner);
    assert.equal(accepted.binding.rootThreadId, request.rootThreadId);
    assert.equal(accepted.binding.authorizationRef, request.authorizationRef);
    assert.equal(accepted.binding.enrollmentRequestId, requestId);
    return { ...accepted, status: 'reconciled-existing' };
  }
  const current = snapshot(root, request.taskId);
  exact(current, expectedSnapshot);
  exact(current, request.snapshot);
  assert.equal(current.task.owner, request.owner);
  assert.equal(current.head, current.task.recordedHead);
  // The root obtains this evidence from the platform independently. This object is
  // not a local proof of cloud identity and never grants execution permission.
  for (const key of ['taskId', 'owner', 'worker', 'rootThreadId', 'authorizationRef'])
    assert.equal(platformReceipt?.[key], request[key], 'Exact original platform binding required');
  assert.equal(platformReceipt.requestId, request.id);
  assert.equal(platformReceipt.snapshotDigest, current.digest);
  assert.equal(platformReceipt.originalWorkerVerified, true);
  assert.ok(typeof platformReceipt.receiptId === 'string' && platformReceipt.receiptId.trim());
  assert.ok(
    Number.isFinite(platformReceipt.observedAt) &&
      platformReceipt.observedAt >= request.createdAt &&
      Date.now() >= platformReceipt.observedAt &&
      Date.now() - platformReceipt.observedAt <= 60000,
    'Fresh root platform evidence required',
  );
  assert.equal(current.worktreeStatus.trim(), '', 'Clean worktree required at acceptance');
  assert.ok(
    !JSON.parse(current.inputs['bindings.candidate.json']).bindings.some((b) => b.task === request.taskId),
    'Existing binding must not be overwritten',
  );
  const lock = path.join(directory, 'enrollment.lock');
  safe(lock);
  fs.mkdirSync(lock, { mode: 0o700 });
  syncDirectory(directory);
  const transaction = {
    requestId,
    nonce: randomUUID(),
    snapshotDigest: current.digest,
    platformReceipt,
    startedAt: Date.now(),
  };
  // Any failure after admission retains the lock/transaction for reconciliation.
  create(path.join(lock, 'transaction.json'), transaction);
  exact(snapshot(root, request.taskId), current);
  const target = path.join(directory, 'bindings.candidate.json'),
    bindings = JSON.parse(current.inputs['bindings.candidate.json']);
  assert.ok(!bindings.bindings.some((b) => b.task === request.taskId), 'Existing binding must not be overwritten');
  const binding = {
    task: request.taskId,
    taskNumber: request.taskNumber,
    taskName: request.taskName,
    taskStableId: request.taskStableId,
    worker: request.worker,
    owner: request.owner,
    rootThreadId: request.rootThreadId,
    authorization: request.authorizationRef,
    authorizationRef: request.authorizationRef,
    head: current.head,
    ...(request.checkpointId === undefined ? {} : { checkpointId: request.checkpointId }),
    developmentCheckpointVerified: request.checkpointId !== undefined,
    enrollmentScope:
      request.checkpointId === undefined ? 'observe-only-no-development-checkpoint' : 'observe-only-checkpoint-bound',
    runtimeOwnerVerified: true,
    observationOnly: true,
    resumeAllowed: false,
    registryRevisionObserved: current.task.revision,
    stageAtBinding: current.task.stage,
    closedExcluded: current.task.stage === 'closed',
    enrollmentRequestId: requestId,
  };
  const next = { ...bindings, bindings: [...bindings.bindings, binding] };
  const temporary = path.join(directory, `bindings-enrollment-${transaction.nonce}.json`);
  create(temporary, next);
  exact(snapshot(root, request.taskId), current);
  fs.renameSync(temporary, target);
  syncDirectory(directory);
  assert.deepEqual(read(target), next, 'Enrollment result changed; reconcile original transaction');
  const receipt = {
    version: 1,
    requestId,
    binding,
    beforeDigest: current.digest,
    bindingsDigest: digest(next),
    acceptedAt: Date.now(),
    observationOnly: true,
    resumeAllowed: false,
    pauseStateChanged: false,
    businessExecutions: 0,
  };
  create(path.join(requests, requestId + '.accepted.json'), receipt);
  // Preserve transaction audit, remove only our fully committed admission.
  fs.renameSync(lock, path.join(requests, requestId + '.transaction'));
  syncDirectory(requests);
  syncDirectory(directory);
  return receipt;
}
