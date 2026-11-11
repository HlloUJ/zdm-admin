import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { validateTaskDependencies } from './task-dependencies.mjs';
import { isPreservedReadOnlyTask } from './task-registry.mjs';
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
function directory(root, relative) {
  let current = root;
  for (const segment of relative.split('/')) {
    assert.ok(segment && !['.', '..'].includes(segment), 'Invalid artifact path');
    current = path.join(current, segment);
    if (existsSync(current))
      assert.ok(
        !lstatSync(current).isSymbolicLink() && lstatSync(current).isDirectory(),
        'Shared or linked artifact path; preserve it: ' + current,
      );
    else mkdirSync(current, { mode: 0o700 });
  }
  return current;
}
function present(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
export function prepareTaskArtifacts(task, { install = true, execute = spawnSync } = {}) {
  assert.equal(task.version, 2);
  assert.ok(!isPreservedReadOnlyTask(task), 'Legacy task requires reviewed preparation');
  const root = realpathSync(task.worktree);
  assert.equal(root, task.worktree, 'Task worktree path changed');
  const modules = path.join(root, 'node_modules');
  const moduleStat = present(modules);
  if (moduleStat)
    assert.ok(
      moduleStat.isDirectory() && !moduleStat.isSymbolicLink(),
      'Shared dependency symlink or non-directory must be preserved; do not install through it',
    );
  const dirs = Object.fromEntries(
    [
      '.task-runtime/cache',
      '.task-verification',
      'test-results',
      'playwright-report',
      'coverage',
      'dist',
      'backend/target',
    ].map((p) => [p, directory(root, p)]),
  );
  const packageFile = path.join(root, 'package.json'),
    lockFile = path.join(root, 'package-lock.json');
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8')),
    lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  assert.ok(lock.packages?.[''], 'Task lockfile is not indexed');
  let dependencies,
    backup = null;
  const noDependencies =
    Object.keys(lock.packages).length === 1 &&
    dependencyFields.every(
      (field) => !Object.keys(manifest[field] ?? {}).length && !Object.keys(lock.packages[''][field] ?? {}).length,
    );
  if (noDependencies) dependencies = { status: 'none-required', packagesChecked: 0 };
  else {
    try {
      const proof = validateTaskDependencies(root);
      assert.equal(proof.modules, modules, 'Dependencies point outside task');
      dependencies = { status: 'private-validated', ...proof };
    } catch {
      if (!install)
        return {
          ready: false,
          task: task.id,
          worktree: root,
          directories: dirs,
          dependencies: { status: 'private-install-required', command: 'npm ci', cwd: root },
        };
      if (existsSync(modules)) {
        const retained = directory(root, '.task-runtime/dependency-backups');
        backup = path.join(retained, randomUUID());
        renameSync(modules, backup);
      }
      const result = execute('npm', ['ci'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          npm_config_cache: directory(root, '.task-runtime/npm-cache'),
          npm_config_audit: 'false',
          npm_config_fund: 'false',
        },
      });
      const receipt = {
        task: task.id,
        command: 'npm ci',
        worktree: root,
        exitCode: result.status,
        backup,
        completedAt: new Date().toISOString(),
      };
      writeFileSync(
        path.join(root, '.task-runtime/dependency-install-result.json'),
        JSON.stringify(receipt, null, 2) + '\n',
        { mode: 0o600 },
      );
      assert.equal(result.status, 0, 'Private dependency installation failed; preserve receipt and backup');
      const proof = validateTaskDependencies(root);
      assert.equal(proof.modules, modules, 'Dependencies point outside task');
      dependencies = { status: 'private-validated', ...proof };
    }
  }
  const proof = {
    version: 1,
    ready: true,
    task: task.id,
    worktree: root,
    branch: task.branch,
    directories: dirs,
    dependencies,
    dependencyBackup: backup,
    lockDigest: createHash('sha256').update(readFileSync(lockFile)).digest('hex'),
  };
  writeFileSync(path.join(root, '.task-runtime/task-artifacts.json'), JSON.stringify(proof, null, 2) + '\n', {
    mode: 0o600,
  });
  return proof;
}
