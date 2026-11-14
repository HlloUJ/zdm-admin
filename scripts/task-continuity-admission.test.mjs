import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createTaskRegistry } from './task-registry.mjs';
import { readContinuityAdmission } from './task-continuity-admission.mjs';
const hash = (v) => createHash('sha256').update(v).digest('hex');
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-admission-')));
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
  git('worktree', 'add', '-b', 'codex/admission', worktree);
  const registry = createTaskRegistry(root);
  registry.register({ id: 'admission', owner: 'fixture-owner', worktree });
  const task = registry.readTask('admission');
  const directory = path.join(registry.commonDir, 'task-continuity-supervision');
  const dev = path.join(registry.commonDir, 'task-development-recovery', task.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(dev, { recursive: true });
  const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  const patch = (name, mutate) => {
    const value = JSON.parse(fs.readFileSync(path.join(directory, name)));
    mutate(value);
    write(name, value);
  };
  const binding = {
    task: task.id,
    taskStableId: 'fixture-board',
    worker: '/root/fixture',
    owner: task.owner,
    rootThreadId: 'fixture-root',
    authorizationRef: 'fixture-authorized',
    head: task.recordedHead,
    registryRevisionObserved: task.revision,
    observationOnly: false,
    resumeAllowed: true,
    runtimeOwnerVerified: true,
    checkpointId: randomUUID(),
  };
  write('controlled-recovery-policy.json', {
    version: 1,
    state: 'controlled-handoff-active',
    bindingsFile: 'bindings.candidate.json',
    activationReceipt: 'activation-receipt.json',
    activationReceiptRequired: true,
    canAdoptMissingOwner: false,
    canReplayUnknownEffects: false,
    allowUnregisteredTasks: false,
    rootThreadId: 'fixture-root',
    roomId: 'fixture-room',
    automationId: 'fixture-auto',
    activationPromptSha256: hash('fixture-prompt'),
  });
  write('activation-receipt.json', {
    version: 1,
    enabled: true,
    rootThreadId: 'fixture-root',
    automationId: 'fixture-auto',
    prompt: 'fixture-prompt',
    promptSha256: hash('fixture-prompt'),
    bindingsSha256: 'historical-audit-only',
  });
  write('bindings.candidate.json', {
    version: 1,
    enabled: true,
    pauseAllBusinessResumption: false,
    rootThreadId: 'fixture-root',
    roomId: 'fixture-room',
    bindings: [binding],
  });
  fs.writeFileSync(
    path.join(dev, `checkpoint-${binding.checkpointId}.json`),
    JSON.stringify({
      version: 1,
      id: binding.checkpointId,
      taskId: task.id,
      owner: task.owner,
      worker: binding.worker,
      rootThreadId: binding.rootThreadId,
      authorizationRef: binding.authorizationRef,
      head: task.recordedHead,
      registryRevision: task.revision,
      nonce: randomUUID(),
      nextStep: 'fixture-only',
    }),
  );
  fs.writeFileSync(
    path.join(dev, 'control-1.json'),
    JSON.stringify({ taskId: task.id, revision: 1, paused: false, authorizationRef: binding.authorizationRef }),
  );
  return { root, worktree, registry, directory, dev, binding, patch };
}
test('real registry reads produce only root-verification candidate without writing evidence', () => {
  const f = fixture();
  const before = JSON.stringify(fs.readdirSync(f.dev));
  const registryBefore = JSON.stringify(f.registry.list());
  const result = readContinuityAdmission(f.root);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.handoffs.length, 1);
  assert.equal(result.canExecute, false);
  assert.equal(result.handoffs[0].interruptionProven, false);
  assert.equal(result.handoffs[0].requiresIndependentRootVerification, true);
  assert.equal(JSON.stringify(fs.readdirSync(f.dev)), before);
  assert.equal(JSON.stringify(f.registry.list()), registryBefore);
});
test('global pause, disabled, observation-only and task denial never yield handoff', () => {
  for (const mutate of [
    (v) => (v.pauseAllBusinessResumption = true),
    (v) => (v.enabled = false),
    (v) => (v.bindings[0].observationOnly = true),
    (v) => (v.bindings[0].resumeAllowed = false),
  ]) {
    const f = fixture();
    f.patch('bindings.candidate.json', mutate);
    const result = readContinuityAdmission(f.root);
    assert.equal(result.handoffs.length, 0);
    assert.ok(result.blocked.length);
    assert.ok(result.observations.length);
  }
});
test('shared Git task aliases produce one candidate and any paused alias vetoes both', () => {
  const f = fixture();
  f.patch('bindings.candidate.json', (v) => v.bindings.push({ ...v.bindings[0], taskStableId: 'alias' }));
  assert.equal(readContinuityAdmission(f.root).handoffs.length, 1);
  f.patch('bindings.candidate.json', (v) => (v.bindings[1].resumeAllowed = false));
  assert.equal(readContinuityAdmission(f.root).handoffs.length, 0);
});
test('unknown worker, wrong owner and changed head reject handoff', () => {
  for (const mutate of [
    (v) => (v.bindings[0].worker = null),
    (v) => (v.bindings[0].runtimeOwnerVerified = false),
    (v) => (v.bindings[0].owner = 'foreign'),
    (v) => (v.bindings[0].head = 'a'.repeat(40)),
  ]) {
    const f = fixture();
    f.patch('bindings.candidate.json', mutate);
    assert.equal(readContinuityAdmission(f.root).handoffs.length, 0);
  }
});
test('closed registry task and actual uncheckpointed work never resume', () => {
  const f = fixture();
  const old = f.registry.readTask('admission');
  f.registry.revise(old.id, old.revision, (v) => {
    v.stage = 'closed';
  });
  assert.equal(readContinuityAdmission(f.root).handoffs.length, 0);
  const g = fixture();
  fs.writeFileSync(path.join(g.worktree, 'uncommitted'), 'pending');
  assert.equal(readContinuityAdmission(g.root).handoffs.length, 0);
});
test('activation prompt mismatch blocks but historical bindings digest does not freeze new records', () => {
  const f = fixture();
  assert.equal(readContinuityAdmission(f.root).handoffs.length, 1);
  f.patch('activation-receipt.json', (v) => (v.prompt = 'changed'));
  assert.equal(readContinuityAdmission(f.root).handoffs.length, 0);
});
test('development control, missing checkpoint and unknown attempt effects fail closed', () => {
  for (const change of [
    (f) =>
      fs.writeFileSync(
        path.join(f.dev, 'control-2.json'),
        JSON.stringify({
          taskId: 'admission',
          revision: 2,
          paused: true,
          authorizationRef: f.binding.authorizationRef,
        }),
      ),
    (f) =>
      fs.renameSync(
        path.join(f.dev, `checkpoint-${f.binding.checkpointId}.json`),
        path.join(f.dev, 'retained-checkpoint'),
      ),
    (f) => {
      const id = randomUUID();
      fs.writeFileSync(path.join(f.dev, `attempt-${id}.json`), JSON.stringify({ id, nonce: 'original' }));
      fs.writeFileSync(
        path.join(f.dev, `outcome-${id}.json`),
        JSON.stringify({ checkpointId: id, nonce: 'original', status: 'unknown' }),
      );
    },
  ]) {
    const f = fixture();
    change(f);
    assert.equal(readContinuityAdmission(f.root).handoffs.length, 0);
  }
});

test('legacy running verification and linked policy stay observable but never dispatch', () => {
  const f = fixture();
  const dir = path.join(f.worktree, '.task-verification');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'a'.repeat(64) + '.json'),
    JSON.stringify({ status: 'running', attemptId: 'old', identity: { root: f.worktree } }),
  );
  assert.equal(readContinuityAdmission(f.root).handoffs.length, 0);
  const g = fixture();
  const policy = path.join(g.directory, 'controlled-recovery-policy.json');
  fs.renameSync(policy, policy + '.original');
  fs.symlinkSync(policy + '.original', policy);
  const result = readContinuityAdmission(g.root);
  assert.equal(result.handoffs.length, 0);
  assert.ok(result.observations.length);
});
