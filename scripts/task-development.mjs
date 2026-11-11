import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { deliveryStatus } from './completion-status.mjs';

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { encoding: 'utf8' }).trim();

function owned(task, owner) {
  assert.equal(task.owner, owner, 'Current chat must own this exact task');
  assert.ok(!task.previewOnly, 'Preview-only combinations are not development or delivery tasks');
  assert.ok(
    ['developing', 'dev-validated', 'blocked'].includes(task.stage),
    'Formal delivery source is frozen; development cannot reset it',
  );
  assert.ok(
    !existsSync(path.join(task.repository.commonDir, 'task-delivery', task.id, 'accepted-source.json')),
    'Accepted source already exists; preserve the original freeze',
  );
}

export function taskWorkStatus(root, { id, owner }) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  assert.equal(task.owner, owner, 'Current chat must own this exact task');
  const currentHead = git(root, 'rev-parse', 'HEAD');
  return {
    task: id,
    stage: task.stage,
    currentHead,
    recordedHead: task.recordedHead,
    recordedHeadMatches: currentHead === task.recordedHead,
    clean: git(root, 'status', '--porcelain') === '',
    frozen: Boolean(task.frozen),
    verificationProven: false,
    formalDeliveryComplete: deliveryStatus(path.join(registry.commonDir, 'task-delivery', id), id, task)
      .formalDeliveryComplete,
  };
}

export function checkpointTask(root, { id, owner, commit, verification }) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id, worktree: root });
  owned(task, owner);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.ok(text(verification), 'Checkpoint notes required; WIP may explicitly remain unverified');
  git(root, 'merge-base', '--is-ancestor', task.base, commit);
  git(root, 'merge-base', '--is-ancestor', commit, 'HEAD');
  return registry.revise(id, task.revision, (record) => {
    // An old lifecycle label must not certify newly checkpointed source.
    // Retain the original metadata and history rather than rewriting it.
    if (record.stage === 'dev-validated') record.stage = 'developing';
    if (!record.checkpoints.some((entry) => entry.commit === commit))
      record.checkpoints.push({ commit, verification, recordedAt: new Date().toISOString() });
    record.recordedHead = git(root, 'rev-parse', 'HEAD');
  });
}

export function taskWorkCommand(root, args, owner = process.env.CODEX_THREAD_ID) {
  const [command, id, commit, verification] = args;
  assert.ok(
    (command === 'status' && args.length === 2) || (command === 'checkpoint' && args.length === 4),
    'task:work <checkpoint task-id commit verification-note|status task-id>',
  );
  return command === 'status'
    ? taskWorkStatus(root, { id, owner })
    : checkpointTask(root, { id, owner, commit, verification });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(taskWorkCommand(process.cwd(), process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
