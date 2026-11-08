import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { assertAcceptedSource, prepareAcceptedComposition, readAcceptance } from './accepted-source.mjs';
import { readAcceptedComposition } from './accepted-source-composition.mjs';
import { createTaskRegistry } from './task-registry.mjs';

const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

// The immutable composition proof is also the recovery intent. Never reset an
// edited worktree, resolve a business conflict, or rebuild the original freeze.
export function applyTaskComposition(root, id, main, { recover = false } = {}) {
  const registry = createTaskRegistry(root),
    task = registry.resolve({ id });
  assert.equal(git(task.worktree, 'status', '--porcelain'), '', 'Composition requires a clean owned task');
  const accepted = readAcceptance(root, id);
  assert.equal(task.frozen?.accepted, accepted?.commit, 'Original task freeze required');
  let proof = readAcceptedComposition(root, id, accepted.commit);
  if (!recover) proof = prepareAcceptedComposition(task.worktree, id, main);
  if (!proof) return task;
  let head = git(task.worktree, 'rev-parse', 'HEAD');
  if (head === proof.taskHead && git(task.worktree, 'rev-list', '-n', '1', proof.main, '--not', head)) {
    // This tree was already proven against the original freeze and fresh main.
    // Hooks remain enabled; a failure leaves the exact Git operation intact.
    git(task.worktree, 'merge', '--no-ff', '--no-edit', proof.main);
    head = git(task.worktree, 'rev-parse', 'HEAD');
  }
  git(task.worktree, 'merge-base', '--is-ancestor', proof.taskHead, head);
  git(task.worktree, 'merge-base', '--is-ancestor', proof.main, head);
  assert.equal(
    git(task.worktree, 'rev-parse', head + '^{tree}'),
    proof.candidateTree,
    'Composition recovery cannot adopt another tree',
  );
  assertAcceptedSource(task.worktree, id, head);
  if (task.recordedHead === head) return task;
  // Never claim upstream commits as this task's changes. Record only the merge
  // that composed its already-owned source with the trusted main input.
  const parents = git(task.worktree, 'show', '-s', '--format=%P', head).split(' ');
  assert.deepEqual(parents, [proof.taskHead, proof.main], 'Exact owned composition merge required');
  assert.equal(task.recordedHead, proof.taskHead, 'Task moved outside its composition intent');
  return registry.revise(task.id, task.revision, (record) => {
    record.recordedHead = head;
    record.checkpoints.push({
      commit: head,
      verification: 'Original frozen source plus trusted main; candidate CI still required',
      recordedAt: new Date().toISOString(),
    });
    record.composition = { main: proof.main, before: proof.taskHead, head, tree: proof.candidateTree };
  });
}
