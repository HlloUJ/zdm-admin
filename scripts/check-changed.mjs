import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { createValidationPlan, normalizeFiles } from './check-changed-plan.mjs';

const root = process.cwd();
const rawArgs = process.argv.slice(2);
const listOnly = rawArgs.includes('--list');
const showHelp = rawArgs.includes('--help') || rawArgs.includes('-h');
const explicitFiles = rawArgs.filter((arg) => !arg.startsWith('--'));

if (showHelp) {
  console.log(`Usage:
  npm run check:changed -- [--list] [files...]

Without file arguments, checks staged, unstaged, deleted, and untracked files.
With file arguments, checks only files from the current task.
--list prints selected checks without running them.`);
  process.exit(0);
}

function gitFiles(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
}

const discoveredFiles =
  explicitFiles.length > 0
    ? explicitFiles
    : [
        ...gitFiles(['diff', '--name-only', '--diff-filter=ACMRD', 'HEAD']),
        ...gitFiles(['ls-files', '--others', '--exclude-standard']),
      ];
const files = normalizeFiles(root, discoveredFiles);

if (files.length === 0) {
  console.log('No changed files require validation.');
  process.exit(0);
}

const plan = createValidationPlan(files, (file) => existsSync(path.resolve(root, file)));

console.log(`Changed files: ${files.length}`);
for (const task of plan.tasks) console.log(`- ${task.name}`);
if (plan.e2eFiles.length > 0) {
  console.log(`Follow-up E2E: npm run test:e2e:chrome -- ${plan.e2eFiles.join(' ')}`);
}

if (listOnly || plan.tasks.length === 0) process.exit(0);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runTask(task) {
  return new Promise((resolve) => {
    const child = spawn(npmCommand, task.args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const results = await Promise.all(plan.tasks.map(runTask));
if (results.some((code) => code !== 0)) process.exit(1);
console.log('Changed-file checks passed.');
