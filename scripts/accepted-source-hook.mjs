import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readActiveBatch } from './task-batch.mjs';
import { readAcceptance, assertAcceptedSource, acceptedGit } from './accepted-source.mjs';
export function checkAcceptedIndex(root, batch = readActiveBatch(root)) {
  if (!batch || !readAcceptance(root, batch.id)) return false;
  assert.equal(path.resolve(root), path.resolve(batch.worktree), 'Only commit from the registered source worktree');
  assertAcceptedSource(root, batch.id, acceptedGit(root, ['write-tree']));
  return true;
}
export function runAcceptedPrecommit(root) {
  const command = (program, args) => {
    const result = spawnSync(program, args, { cwd: root, stdio: 'inherit' });
    assert.equal(result.status, 0, 'Read-only accepted-source commit check failed');
  };
  if (!checkAcceptedIndex(root)) {
    command('npx', ['lint-staged']);
    return;
  }
  const files = acceptedGit(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter((file) => existsSync(path.join(root, file)));
  const lint = files.filter((f) => /\.(?:js|ts|vue)$/.test(f));
  const format = files.filter((f) => /\.(?:js|ts|vue|css|md|json|yml|yaml)$/.test(f));
  // Keep the existing checks but never run --fix/--write on accepted business.
  if (lint.length) command('npx', ['eslint', '--max-warnings=0', ...lint]);
  if (format.length) command('npx', ['prettier', '--check', ...format]);
  checkAcceptedIndex(root);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runAcceptedPrecommit(process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
