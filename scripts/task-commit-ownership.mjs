import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createTaskRegistry } from './task-registry.mjs';

const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
export function taskCommitOwnership(root, task, head = git(root, 'rev-parse', 'HEAD')) {
  const originMain = git(root, 'rev-parse', 'refs/remotes/origin/main');
  git(root, 'merge-base', '--is-ancestor', task.base, head);
  const commits = git(root, 'rev-list', '--reverse', task.base + '..' + head, '--not', originMain)
    .split('\n')
    .filter(Boolean);
  return {
    head,
    originMain,
    commits,
    missing: commits.filter((commit) => !task.checkpoints.some((entry) => entry.commit === commit)),
  };
}
export function assertTaskCommitOwnership(root, task, head) {
  const plan = taskCommitOwnership(root, task, head);
  assert.equal(plan.missing.length, 0, 'Unassigned task commits before freeze: ' + plan.missing.join(', '));
  return plan;
}
// First-parent proves topology, not authorship. The original owner must still
// review each exact diff and supply a substantive scope/ownership explanation.
export function historicalCommitEvidence(root, task, head) {
  const plan = taskCommitOwnership(root, task, head);
  const first = new Set(git(root, 'rev-list', '--first-parent', task.base + '..' + head).split('\n'));
  const siblings = createTaskRegistry(root)
    .list()
    .filter((other) => other.id !== task.id);
  const entries = plan.missing.map((commit) => {
    assert.ok(first.has(commit), 'Unassigned side-branch commit cannot be adopted: ' + commit);
    assert.ok(
      !siblings.some((other) => other.checkpoints.some((entry) => entry.commit === commit)),
      'Commit already belongs to another task: ' + commit,
    );
    const parents = git(root, 'show', '-s', '--format=%P', commit).split(' ');
    assert.ok(parents.length >= 1 && parents.length <= 2, 'Unsupported historical commit topology');
    for (const parent of parents.slice(1)) git(root, 'merge-base', '--is-ancestor', parent, plan.originMain);
    const diff = execFileSync(
      'git',
      ['--no-replace-objects', '-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--binary', parents[0], commit],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return { commit, parents, diffSha256: createHash('sha256').update(diff).digest('hex') };
  });
  return { ...plan, entries };
}
