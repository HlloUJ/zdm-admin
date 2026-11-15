import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { collectTaskProgress } from './task-progress-collector.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import {
  readEnrollmentSnapshot,
  requestContinuityEnrollment,
  acceptContinuityEnrollment,
} from './task-continuity-enrollment.mjs';

const owner = process.env.CODEX_THREAD_ID || 'fixture-owner';
const rootOwner = 'fixture-root';
function fixture() {
  process.env.CODEX_THREAD_ID = owner;
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-enrollment-')));
  const root = path.join(base, 'main'),
    worktree = path.join(base, 'task');
  fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  fs.writeFileSync(path.join(root, 'base'), 'base');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('worktree', 'add', '-b', 'codex/enrollment-test', worktree);
  const registry = createTaskRegistry(root);
  registry.register({ id: 'enrollment-test', owner, worktree });
  const directory = path.join(registry.commonDir, 'task-continuity-supervision');
  fs.mkdirSync(directory, { recursive: true });
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  write('controlled-recovery-policy.json', {
    version: 1,
    state: 'controlled-handoff-active',
    roomId: 'fixture-room',
    rootThreadId: rootOwner,
    bindingsFile: 'bindings.candidate.json',
    activationReceipt: 'activation-receipt.json',
  });
  write('activation-receipt.json', { version: 1, rootThreadId: rootOwner, fixtureOnly: true });
  write('bindings.candidate.json', {
    version: 1,
    rootThreadId: rootOwner,
    roomId: 'fixture-room',
    pauseAllBusinessResumption: true,
    bindings: [],
  });
  const input = {
    taskId: 'enrollment-test',
    worker: '/root/original_worker',
    rootThreadId: rootOwner,
    authorizationRef: 'fixture-explicit-instruction',
    taskStableId: 'fixture-stable-id',
    taskNumber: '284',
    taskName: 'Isolated enrollment',
  };
  return { root, worktree, registry, directory, write, input };
}
// Fixture receipts model the root trust boundary, not a production platform verification.
test('snapshot is read from the original registered task', () => {
  const f = fixture();
  const snapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  assert.ok(snapshot);
  const before = fs.readFileSync(path.join(f.directory, 'bindings.candidate.json'), 'utf8');
  requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot: snapshot });
  assert.equal(fs.readFileSync(path.join(f.directory, 'bindings.candidate.json'), 'utf8'), before);
});
test('foreign runtime owner cannot enroll a task', () => {
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  process.env.CODEX_THREAD_ID = 'foreign';
  assert.throws(() => requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot }));
  process.env.CODEX_THREAD_ID = owner;
});
test('pause changes invalidate the captured request snapshot', () => {
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  f.write('bindings.candidate.json', {
    version: 1,
    rootThreadId: rootOwner,
    pauseAllBusinessResumption: false,
    bindings: [],
  });
  assert.throws(() => requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot }));
});
test('unverified root receipt never accepts a request', () => {
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
  process.env.CODEX_THREAD_ID = rootOwner;
  assert.throws(() =>
    acceptContinuityEnrollment(f.root, { requestId: request.id, expectedSnapshot, platformReceipt: {} }),
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory, 'bindings.candidate.json'))).bindings, []);
  process.env.CODEX_THREAD_ID = owner;
});

function receipt(request) {
  return {
    requestId: request.id,
    taskId: request.taskId,
    owner: request.owner,
    worker: request.worker,
    rootThreadId: request.rootThreadId,
    authorizationRef: request.authorizationRef,
    snapshotDigest: request.snapshot.digest,
    originalWorkerVerified: true,
    formalStartVerified: true,
    worktree: request.snapshot.task.worktree,
    head: request.snapshot.head,
    taskStableId: request.taskStableId,
    taskNumber: request.taskNumber,
    taskName: request.taskName,
    roomId: 'fixture-room',
    paused: false,
    pauseEvidenceRef: 'fixture-current-user-pause-readback',
    receiptId: 'fixture-platform-readback',
    observedAt: Date.now(),
  };
}
test('root acceptance appends only observe binding and preserves global pause', () => {
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
  process.env.CODEX_THREAD_ID = rootOwner;
  const result = acceptContinuityEnrollment(f.root, {
    requestId: request.id,
    expectedSnapshot,
    platformReceipt: receipt(request),
  });
  assert.equal(result.businessExecutions, 0);
  const bindings = JSON.parse(fs.readFileSync(path.join(f.directory, 'bindings.candidate.json')));
  assert.equal(bindings.pauseAllBusinessResumption, true);
  assert.equal(bindings.bindings.length, 1);
  assert.equal(bindings.bindings[0].resumeAllowed, false);
  assert.equal(bindings.bindings[0].observationOnly, true);
  process.env.CODEX_THREAD_ID = owner;
});
test('changed policy after request rejects acceptance without overwrite', () => {
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
  const policy = JSON.parse(fs.readFileSync(path.join(f.directory, 'controlled-recovery-policy.json')));
  policy.state = 'disabled';
  f.write('controlled-recovery-policy.json', policy);
  process.env.CODEX_THREAD_ID = rootOwner;
  assert.throws(() =>
    acceptContinuityEnrollment(f.root, { requestId: request.id, expectedSnapshot, platformReceipt: receipt(request) }),
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'bindings.candidate.json'))).bindings.length, 0);
  process.env.CODEX_THREAD_ID = owner;
});
test('leftover lock is never cleared or replayed', () => {
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
  fs.mkdirSync(path.join(f.directory, 'enrollment.lock'));
  process.env.CODEX_THREAD_ID = rootOwner;
  assert.throws(() =>
    acceptContinuityEnrollment(f.root, { requestId: request.id, expectedSnapshot, platformReceipt: receipt(request) }),
  );
  assert.ok(fs.existsSync(path.join(f.directory, 'enrollment.lock')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'bindings.candidate.json'))).bindings.length, 0);
  process.env.CODEX_THREAD_ID = owner;
});
test('successful acceptance reconciles without a second binding', () => {
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
  process.env.CODEX_THREAD_ID = rootOwner;
  const options = { requestId: request.id, expectedSnapshot, platformReceipt: receipt(request) };
  acceptContinuityEnrollment(f.root, options);
  const before = fs.readFileSync(path.join(f.directory, 'bindings.candidate.json'), 'utf8');
  assert.equal(acceptContinuityEnrollment(f.root, options).status, 'reconciled-existing');
  assert.equal(fs.readFileSync(path.join(f.directory, 'bindings.candidate.json'), 'utf8'), before);
  process.env.CODEX_THREAD_ID = owner;
});
test('dirty work cannot be enrolled as an exact checkpoint', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.worktree, 'uncheckpointed'), 'unsaved');
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  assert.throws(() => requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot }));
});
test('changed completion and forged receipt fields fail closed', () => {
  for (const key of ['owner', 'worker', 'authorizationRef', 'rootThreadId', 'snapshotDigest']) {
    const f = fixture();
    const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
    const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
    process.env.CODEX_THREAD_ID = rootOwner;
    assert.throws(() =>
      acceptContinuityEnrollment(f.root, {
        requestId: request.id,
        expectedSnapshot,
        platformReceipt: { ...receipt(request), [key]: 'wrong' },
      }),
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory, 'bindings.candidate.json'))).bindings.length, 0);
  }
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
  const completion = path.join(f.registry.commonDir, 'task-delivery', f.input.taskId);
  fs.mkdirSync(completion, { recursive: true });
  fs.writeFileSync(
    path.join(completion, 'completion-session.json'),
    JSON.stringify({ version: 1, batch: f.input.taskId, events: [], pauses: [{ startedAt: Date.now() }] }),
  );
  process.env.CODEX_THREAD_ID = rootOwner;
  assert.throws(() =>
    acceptContinuityEnrollment(f.root, { requestId: request.id, expectedSnapshot, platformReceipt: receipt(request) }),
  );
  process.env.CODEX_THREAD_ID = owner;
});

test('enrollment remains observation-only without any execution capability fields', () => {
  const f = fixture();
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
  process.env.CODEX_THREAD_ID = rootOwner;
  const result = acceptContinuityEnrollment(f.root, {
    requestId: request.id,
    expectedSnapshot,
    platformReceipt: receipt(request),
  });
  assert.equal(result.binding.enrollmentScope, 'observe-only');
  assert.equal(result.binding.observationOnly, true);
  assert.equal(result.binding.resumeAllowed, false);
  assert.equal(result.businessExecutions, 0);
  assert.equal(result.pauseStateChanged, false);
  assert.deepEqual(Object.keys(expectedSnapshot.inputs).sort(), [
    'activation-receipt.json',
    'bindings.candidate.json',
    'completion',
    'controlled-recovery-policy.json',
  ]);
  process.env.CODEX_THREAD_ID = owner;
});

function enroll(f, extra = {}) {
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  const request = requestContinuityEnrollment(f.root, { ...f.input, expectedSnapshot });
  process.env.CODEX_THREAD_ID = rootOwner;
  const options = { requestId: request.id, expectedSnapshot, platformReceipt: { ...receipt(request), ...extra } };
  return { options, result: acceptContinuityEnrollment(f.root, options) };
}
test('old pending-context task becomes visible to actual collector without execution or stage change', () => {
  const f = fixture();
  assert.equal(collectTaskProgress(f.root)[0].status, 'registration-incomplete');
  const before = f.registry.resolve({ id: f.input.taskId });
  const { result } = enroll(f);
  const after = f.registry.resolve({ id: f.input.taskId });
  assert.equal(after.stage, before.stage);
  assert.equal(after.owner, before.owner);
  assert.deepEqual(after.checkpoints, before.checkpoints);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(result.businessExecutions, 0);
  const observed = collectTaskProgress(f.root)[0];
  assert.notEqual(observed.status, 'registration-incomplete');
  assert.equal(observed.taskStableId, f.input.taskStableId);
  assert.equal(observed.automaticResumptionEnabled, false);
});
test('explicitly paused historical task stays paused and silent in actual collector', () => {
  const f = fixture();
  f.registry.revise(f.input.taskId, 1, (r) => {
    r.monitoring.paused = true;
  });
  enroll(f, { paused: true });
  assert.equal(collectTaskProgress(f.root)[0].status, 'paused');
});
test('existing registered monitoring refuses duplicate enrollment and remains byte-equivalent', () => {
  const f = fixture();
  const { options } = enroll(f);
  const before = f.registry.resolve({ id: f.input.taskId });
  assert.equal(acceptContinuityEnrollment(f.root, options).status, 'reconciled-existing');
  process.env.CODEX_THREAD_ID = owner;
  assert.throws(
    () =>
      requestContinuityEnrollment(f.root, {
        ...f.input,
        expectedSnapshot: readEnrollmentSnapshot(f.root, { taskId: f.input.taskId }),
      }),
    /Existing monitoring/,
  );
  assert.deepEqual(f.registry.resolve({ id: f.input.taskId }), before);
});
test('queued-only task is excluded even with an existing formal worktree', () => {
  const f = fixture();
  const q = createExecutionOrder(f.registry.commonDir);
  const event = (sequence) => ({
    sequence,
    messageId: 'fixture-' + sequence,
    roomId: 'fixture-room',
    authorId: 'fixture-user',
  });
  q.initialize(event(1));
  q.enqueue({ lane: 'development', task: f.input.taskId, owner, request: event(2) });
  assert.throws(
    () =>
      requestContinuityEnrollment(f.root, {
        ...f.input,
        expectedSnapshot: readEnrollmentSnapshot(f.root, { taskId: f.input.taskId }),
      }),
    /Queued-only/,
  );
});
test('missing start evidence and mismatched board identity cannot enroll', () => {
  for (const extra of [
    { formalStartVerified: false },
    { taskStableId: 'wrong' },
    { roomId: 'wrong' },
    { head: 'wrong' },
    { paused: undefined },
  ]) {
    const f = fixture();
    assert.throws(() => enroll(f, extra));
    assert.equal(f.registry.resolve({ id: f.input.taskId }).monitoring.state, 'pending-context');
  }
});
test('lost receipt after successful writes never replays registry update or execution', () => {
  const f = fixture();
  const { options } = enroll(f);
  const requests = path.join(f.directory, 'enrollment-requests');
  fs.unlinkSync(path.join(requests, options.requestId + '.accepted.json'));
  fs.renameSync(path.join(requests, options.requestId + '.transaction'), path.join(f.directory, 'enrollment.lock'));
  const before = f.registry.resolve({ id: f.input.taskId });
  assert.throws(() => acceptContinuityEnrollment(f.root, options), /snapshot changed/);
  assert.deepEqual(f.registry.resolve({ id: f.input.taskId }), before);
  assert.ok(fs.existsSync(path.join(f.directory, 'enrollment.lock')));
});

test('registry write succeeded but legacy publication failed preserves transaction without repeating CAS', () => {
  const f = fixture();
  const rename = fs.renameSync;
  let result;
  fs.renameSync = (source, target) => {
    if (target === path.join(f.directory, 'bindings.candidate.json')) throw new Error('fixture publication failure');
    return rename(source, target);
  };
  try {
    assert.throws(() => {
      result = enroll(f);
    }, /fixture publication failure/);
  } finally {
    fs.renameSync = rename;
  }
  const before = f.registry.resolve({ id: f.input.taskId });
  assert.equal(before.monitoring.state, 'registered');
  const tx = JSON.parse(fs.readFileSync(path.join(f.directory, 'enrollment.lock', 'transaction.json')));
  assert.throws(() => acceptContinuityEnrollment(f.root, { requestId: tx.requestId }), /snapshot/);
  assert.deepEqual(f.registry.resolve({ id: f.input.taskId }), before);
  assert.ok(fs.existsSync(path.join(f.directory, 'enrollment.lock')));
  assert.equal(result, undefined);
});
test('historical record without monitoring is enrolled through the same supported CAS', () => {
  const f = fixture();
  f.registry.revise(f.input.taskId, 1, (r) => {
    delete r.monitoring;
  });
  assert.equal(collectTaskProgress(f.root).length, 0);
  enroll(f, { paused: true });
  assert.equal(collectTaskProgress(f.root)[0].status, 'paused');
});
test('pause proof cannot clear a previously recorded pause', () => {
  const f = fixture();
  f.registry.revise(f.input.taskId, 1, (r) => {
    r.monitoring.paused = true;
  });
  assert.throws(() => enroll(f, { paused: false }), /pause cannot be cleared/);
  assert.equal(f.registry.resolve({ id: f.input.taskId }).monitoring.paused, true);
});
