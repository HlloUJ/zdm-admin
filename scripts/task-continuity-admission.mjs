import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createTaskRegistry } from './task-registry.mjs';
import { collectTaskContinuity } from './task-continuity.mjs';
import { continuityHandoffs } from './task-continuity-handoff.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function read(file, sources) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    if (fs.existsSync(p)) assert.ok(!fs.lstatSync(p).isSymbolicLink(), 'Linked admission evidence');
    if (p === path.dirname(p)) break;
  }
  assert.ok(fs.lstatSync(file).isFile(), 'Admission evidence must be a regular file');
  const bytes = fs.readFileSync(file);
  sources.set(file, hash(bytes));
  return JSON.parse(bytes);
}
function developmentEvidence(registry, task, binding, sources, directories) {
  assert.match(binding.checkpointId ?? '', /^[a-f0-9-]{36}$/, 'Missing exact development checkpoint');
  const dir = path.join(registry.commonDir, 'task-development-recovery', task.id);
  directories.set(dir, JSON.stringify(fs.readdirSync(dir).sort()));
  const checkpoint = read(path.join(dir, `checkpoint-${binding.checkpointId}.json`), sources);
  for (const [key, expected] of Object.entries({
    taskId: task.id,
    id: binding.checkpointId,
    owner: task.owner,
    worker: binding.worker,
    rootThreadId: binding.rootThreadId,
    authorizationRef: binding.authorizationRef,
    head: task.recordedHead,
    registryRevision: task.revision,
  }))
    assert.equal(checkpoint[key], expected, `Checkpoint ${key} differs`);
  assert.ok(checkpoint.nonce && checkpoint.nextStep, 'Incomplete checkpoint');
  assert.ok(!fs.existsSync(path.join(dir, 'active-attempt.json')), 'Active or unresolved development attempt');
  assert.ok(!fs.existsSync(path.join(dir, 'control-gate')), 'Development control gate unresolved');
  assert.ok(!fs.existsSync(path.join(dir, `attempt-${checkpoint.id}.json`)), 'Checkpoint already consumed');
  const controls = fs.readdirSync(dir).filter((n) => /^control-\d+\.json$/.test(n));
  assert.ok(controls.length, 'Development control missing');
  const revision = Math.max(...controls.map((n) => Number(n.slice(8, -5))));
  const control = read(path.join(dir, `control-${revision}.json`), sources);
  assert.equal(control.taskId, task.id);
  assert.equal(control.revision, revision);
  assert.equal(control.paused, false, 'Development task paused');
  assert.equal(control.authorizationRef, binding.authorizationRef);
  for (const name of fs.readdirSync(dir).filter((n) => /^attempt-.*\.json$/.test(n))) {
    const attempt = read(path.join(dir, name), sources);
    assert.match(attempt.id ?? '', /^[a-f0-9-]{36}$/);
    const outcome = read(path.join(dir, `outcome-${attempt.id}.json`), sources);
    assert.equal(outcome.checkpointId, attempt.id);
    assert.equal(outcome.nonce, attempt.nonce);
    assert.equal(outcome.status, 'completed', 'Previous development effects are unknown');
  }
  return { checkpointId: checkpoint.id, checkpointNonce: checkpoint.nonce, controlRevision: revision };
}

// Read-only candidate selection. Disk metadata is never proof of a live cloud worker,
// authorization semantics, or a lease. The root and original runner must revalidate before action.
export function readContinuityAdmission(root, { now = Date.now() } = {}) {
  const registry = createTaskRegistry(root);
  const directory = path.join(registry.commonDir, 'task-continuity-supervision');
  const sources = new Map();
  const directories = new Map();
  const absent = new Set();
  const result = {
    version: 1,
    observedAt: now,
    canExecute: false,
    observations: [],
    blocked: [],
    handoffs: [],
    sourceFingerprints: {},
  };
  const tasks = registry.list();
  const registryBefore = hash(JSON.stringify(tasks));
  result.observations = collectTaskContinuity(root);
  let policy, activation, bindings;
  try {
    policy = read(path.join(directory, 'controlled-recovery-policy.json'), sources);
    activation = read(path.join(directory, 'activation-receipt.json'), sources);
    bindings = read(path.join(directory, 'bindings.candidate.json'), sources);
    assert.equal(policy.version, 1);
    assert.equal(activation.version, 1);
    assert.equal(bindings.version, 1);
    assert.ok(Array.isArray(bindings.bindings));
    assert.equal(policy.state, 'controlled-handoff-active', 'Supervision not active');
    assert.equal(policy.bindingsFile, 'bindings.candidate.json');
    assert.equal(policy.activationReceipt, 'activation-receipt.json');
    assert.equal(policy.activationReceiptRequired, true);
    assert.equal(policy.canAdoptMissingOwner, false);
    assert.equal(policy.canReplayUnknownEffects, false);
    assert.equal(policy.allowUnregisteredTasks, false);
    assert.equal(activation.enabled, true);
    assert.ok(policy.rootThreadId && policy.roomId && policy.automationId);
    assert.equal(activation.rootThreadId, policy.rootThreadId);
    assert.equal(activation.automationId, policy.automationId);
    assert.equal(bindings.rootThreadId, policy.rootThreadId);
    assert.equal(bindings.roomId, policy.roomId);
    assert.equal(activation.promptSha256, hash(activation.prompt));
    assert.equal(policy.activationPromptSha256, activation.promptSha256);
    // activation.bindingsSha256 is the activation-time audit snapshot, not a permanent freeze.
    // Current bindings are fingerprinted and re-read below; accepting an enrollment cannot activate it.
    assert.equal(bindings.enabled, true, 'Bindings dispatch disabled');
    assert.equal(bindings.pauseAllBusinessResumption, false, 'Global business resumption paused');
  } catch (error) {
    result.blocked.push({ task: null, reason: error.message });
  }
  if (!result.blocked.length) {
    const grouped = new Map();
    for (const binding of bindings.bindings) {
      const list = grouped.get(binding.task) ?? [];
      list.push(binding);
      grouped.set(binding.task, list);
    }
    const seenWorktrees = new Set();
    for (const [taskId, aliases] of grouped) {
      try {
        const task = tasks.find((t) => t.id === taskId);
        assert.ok(task, 'Task not registered');
        assert.notEqual(task.stage, 'closed', 'Task already closed');
        assert.ok(!task.previewOnly && !task.compatibility?.readOnly, 'Unsupported legacy/combined task');
        registry.validateLive(task);
        const sessionFile = path.join(registry.commonDir, 'task-delivery', task.id, 'completion-session.json');
        if (fs.existsSync(sessionFile)) read(sessionFile, sources);
        else absent.add(sessionFile);
        const key = fs.realpathSync(task.worktree);
        assert.ok(!seenWorktrees.has(key), 'Git execution unit already considered');
        seenWorktrees.add(key);
        // Every alias must agree. A paused alias vetoes the entire shared Git task.
        const binding = aliases[0];
        for (const alias of aliases) {
          assert.equal(alias.observationOnly, false, 'Observation-only binding');
          assert.equal(alias.resumeAllowed, true, 'Task resumption not authorized');
          assert.equal(alias.runtimeOwnerVerified, true, 'Original worker identity unverified');
          assert.match(alias.worker ?? '', /^\/root\/[a-z0-9_/]+$/);
          assert.ok(alias.taskStableId && alias.authorizationRef);
          assert.equal(alias.owner, task.owner);
          assert.equal(alias.rootThreadId, policy.rootThreadId);
          assert.equal(alias.head, task.recordedHead, 'Bound HEAD changed');
          assert.equal(alias.registryRevisionObserved, task.revision, 'Registry revision changed');
          for (const field of ['worker', 'owner', 'authorizationRef', 'head', 'checkpointId'])
            assert.equal(alias[field], binding[field], 'Conflicting Git task alias');
        }
        const actualHead = execFileSync('git', ['-C', task.worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        assert.equal(actualHead, binding.head, 'Worktree HEAD changed');
        assert.equal(
          execFileSync('git', ['-C', task.worktree, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
          '',
          'Uncheckpointed changes',
        );
        assert.equal(
          task.stage,
          'developing',
          'Formal recovery effects require original runner reconciliation; no execution handoff',
        );
        assert.ok(!task.frozen, 'Frozen task is not ordinary development');
        const proof = developmentEvidence(registry, task, binding, sources, directories);
        const observation = result.observations.find((o) => o.task === taskId);
        assert.ok(!observation?.verification?.length, 'Legacy verification effects unresolved');
        assert.ok(
          observation && ['unobserved', 'awaiting-continuation'].includes(observation.status),
          'Prior stage or effects unresolved',
        );
        const [event] = continuityHandoffs(
          [observation],
          {
            [taskId]: { ...binding, authorization: binding.authorizationRef },
          },
          now,
        );
        result.handoffs.push({
          ...event,
          ...proof,
          taskStableIds: aliases.map((a) => a.taskStableId),
          action: 'verify-original-worker-and-effects-only',
          canExecute: false,
          requiresIndependentRootVerification: true,
          interruptionProven: false,
        });
      } catch (error) {
        result.blocked.push({ task: taskId, reason: error.message });
      }
    }
  }
  try {
    assert.equal(hash(JSON.stringify(registry.list())), registryBefore, 'Registry changed during observation');
    for (const file of absent) assert.ok(!fs.existsSync(file), 'New completion session appeared during observation');
    for (const [dir, names] of directories)
      assert.equal(
        JSON.stringify(fs.readdirSync(dir).sort()),
        names,
        'Development admission state changed during observation',
      );
    for (const [file, fingerprint] of [...sources]) {
      read(file, sources);
      assert.equal(sources.get(file), fingerprint, 'Admission source changed during observation');
    }
  } catch (error) {
    result.handoffs = [];
    result.blocked.push({ task: null, reason: error.message });
  }
  result.sourceFingerprints = Object.fromEntries(sources);
  return result;
}
