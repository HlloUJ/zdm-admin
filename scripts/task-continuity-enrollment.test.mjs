import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createTaskRegistry } from './task-registry.mjs';
import { createDevelopmentCheckpoint } from './task-development-recovery.mjs';
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
    rootThreadId: rootOwner,
    bindingsFile: 'bindings.candidate.json',
    activationReceipt: 'activation-receipt.json',
  });
  write('activation-receipt.json', { version: 1, rootThreadId: rootOwner, fixtureOnly: true });
  write('bindings.candidate.json', {
    version: 1,
    rootThreadId: rootOwner,
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
test('changed control and forged receipt fields fail closed', () => {
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
  const controls = path.join(f.registry.commonDir, 'task-development-recovery', f.input.taskId);
  fs.mkdirSync(controls, { recursive: true });
  fs.writeFileSync(path.join(controls, 'control-0.json'), JSON.stringify({ paused: true, revision: 0 }));
  process.env.CODEX_THREAD_ID = rootOwner;
  assert.throws(() =>
    acceptContinuityEnrollment(f.root, { requestId: request.id, expectedSnapshot, platformReceipt: receipt(request) }),
  );
  process.env.CODEX_THREAD_ID = owner;
});

test('optional ordinary checkpoint is read and preserved, never fabricated', () => {
  const f = fixture();
  const checkpoint = createDevelopmentCheckpoint(f.root, { ...f.input, nextStep: 'Isolated validation only' });
  const expectedSnapshot = readEnrollmentSnapshot(f.root, { taskId: f.input.taskId });
  assert.throws(() =>
    requestContinuityEnrollment(f.root, {
      ...f.input,
      checkpointId: '00000000-0000-0000-0000-000000000000',
      expectedSnapshot,
    }),
  );
  const request = requestContinuityEnrollment(f.root, { ...f.input, checkpointId: checkpoint.id, expectedSnapshot });
  process.env.CODEX_THREAD_ID = rootOwner;
  const result = acceptContinuityEnrollment(f.root, {
    requestId: request.id,
    expectedSnapshot,
    platformReceipt: receipt(request),
  });
  assert.equal(result.binding.checkpointId, checkpoint.id);
  assert.equal(result.binding.resumeAllowed, false);
  process.env.CODEX_THREAD_ID = owner;
});
