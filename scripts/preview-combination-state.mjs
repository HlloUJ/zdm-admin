import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { previewDescriptor } from './preview-policy.mjs';

export const combinationDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const combinationGit = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
export function combinationDirectory(common, id) {
  assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const directory = path.join(common, 'task-previews', 'combinations', id);
  for (const file of [path.join(common, 'task-previews'), path.dirname(directory), directory])
    if (existsSync(file))
      assert.ok(
        lstatSync(file).isDirectory() && !lstatSync(file).isSymbolicLink(),
        'Unsafe combination directory; preserve it',
      );
  return directory;
}
export function readPreviewCombination(root, task, { required = true } = {}) {
  assert.equal(task.previewOnly, true, 'An immutable preview-only task is required');
  const common = createTaskRegistry(root).commonDir,
    reference = task.resources?.previewCombination;
  if (!reference) {
    assert.ok(!required, 'Combination source preparation is incomplete; no preview can start');
    return null;
  }
  assert.match(reference.sha256, /^[a-f0-9]{64}$/);
  const file = path.join(combinationDirectory(common, task.id), 'combination-' + reference.sha256 + '.json');
  assert.equal(reference.file, file, 'Combination manifest does not belong to this exact task');
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Unsafe combination manifest');
  assert.equal(realpathSync(file), file, 'Linked combination manifest is unsafe');
  const bytes = readFileSync(file);
  assert.equal(combinationDigest(bytes), reference.sha256, 'Combination manifest changed');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.version, 1);
  for (const [key, expected] of Object.entries({
    task: task.id,
    owner: task.owner,
    worktree: task.worktree,
    branch: task.branch,
    base: task.base,
    eligibleForTaskDelivery: false,
  }))
    assert.equal(manifest[key], expected, 'Combination identity changed: ' + key);
  assert.ok(Array.isArray(manifest.members) && manifest.members.length >= 2);
  assert.equal(new Set(manifest.members.map((m) => m.task)).size, manifest.members.length);
  assert.match(manifest.head, /^[a-f0-9]{40}$/);
  assert.match(manifest.tree, /^[a-f0-9]{40}$/);
  for (const member of manifest.members) {
    assert.match(member.task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.match(member.commit, /^[a-f0-9]{40}$/);
  }
  return { ...manifest, manifestSha256: reference.sha256 };
}
export function assertCombinationPreview(root, task, { temporary = false, port = null } = {}) {
  assert.ok(
    temporary || (Number.isInteger(port) && port >= 5177 && port <= 5199),
    'Preview-only combinations cannot use fixed ports',
  );
  const manifest = readPreviewCombination(root, task);
  assert.equal(combinationGit(task.worktree, 'branch', '--show-current'), manifest.branch);
  assert.equal(
    combinationGit(task.worktree, 'rev-parse', 'HEAD'),
    manifest.head,
    'Combination HEAD changed; create a new exact combination',
  );
  assert.equal(combinationGit(task.worktree, 'rev-parse', 'HEAD^{tree}'), manifest.tree);
  assert.equal(
    combinationGit(task.worktree, 'status', '--porcelain'),
    '',
    'Combination source changed; retain it and create a new version',
  );
  for (const member of manifest.members)
    combinationGit(task.worktree, 'merge-base', '--is-ancestor', member.commit, manifest.head);
  return {
    ...manifest,
    ...(port ? { preview: previewDescriptor('combination', { port, members: manifest.members }) } : {}),
  };
}
