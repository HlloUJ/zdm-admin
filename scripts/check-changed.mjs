import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { createValidationPlan, normalizeFiles } from './check-changed-plan.mjs';
import { runVerificationTask } from './verification-runner.mjs';
import { captureSource } from './verification-evidence.mjs';

const root = process.cwd();
const rawArgs = process.argv.slice(2);
const listOnly = rawArgs.includes('--list');
const showHelp = rawArgs.includes('--help') || rawArgs.includes('-h');
const explicitFiles = rawArgs.filter((arg) => !arg.startsWith('--'));

if (showHelp) {
  console.log(`Usage:
  npm run check:changed -- [--list] [--force|--no-reuse] [files...]

Without file arguments, checks staged, unstaged, deleted, and untracked files.
With file arguments, checks only files from the current task.
--list prints selected checks without running them.
--force / --no-reuse executes checks without reusing previous results.`);
  process.exit(0);
}

function gitFiles(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
}

const plannedCandidate = listOnly ? null : captureSource(root);
const discoveredFiles =
  explicitFiles.length > 0
    ? explicitFiles
    : [
        ...gitFiles(['diff', '--name-only', '--diff-filter=ACMRD', 'HEAD']),
        ...gitFiles(['ls-files', '--others', '--exclude-standard']),
      ];
const files = normalizeFiles(root, discoveredFiles);

function sameCandidate(left, right) {
  return ['digest', 'baseline', 'mergeBase', 'mutationStamp'].every((field) => left[field] === right[field]);
}

if (plannedCandidate && !sameCandidate(plannedCandidate, captureSource(root))) {
  console.error('Candidate changed during changed-file planning.');
  process.exit(1);
}

if (files.length === 0) {
  console.log('No changed files require validation.');
  process.exit(0);
}

const plan = createValidationPlan(files, (file) => existsSync(path.resolve(root, file)), { root });

console.log(`Changed files: ${files.length}`);
for (const task of plan.tasks)
  console.log(`- ${task.name}: npm ${task.args.join(' ')}${task.reason ? ` (${task.reason})` : ''}`);
if (plan.backendPlan?.mode !== 'none' && plan.backendPlan)
  console.log(`Backend coverage: ${plan.backendPlan.mode}; ${plan.backendPlan.reason}`);
if (plan.browserPlan?.mode === 'full') {
  console.log(`Follow-up E2E: npm run test:e2e:chrome (${plan.browserPlan.reason})`);
} else if (plan.e2eFiles.length > 0) {
  console.log(`Follow-up E2E: npm run test:e2e:chrome -- ${plan.e2eFiles.join(' ')}`);
}

if (listOnly || plan.tasks.length === 0) process.exit(0);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runTask(task) {
  return runVerificationTask(
    {
      ...task,
      root,
      command: npmCommand,
      kind: task.args.includes('backend:test') ? 'backend' : 'node',
      reuse: task.args.includes('backend:test'),
      ...(task.args.includes('build:app') ? { artifacts: ['dist'] } : {}),
    },
    { force: rawArgs.includes('--force') || rawArgs.includes('--no-reuse') },
  );
}

const candidateBefore = captureSource(root);
if (!sameCandidate(plannedCandidate, candidateBefore)) {
  console.error('Candidate changed after changed-file planning.');
  process.exit(1);
}
const results = await Promise.all(plan.tasks.map(runTask));
const candidateAfter = captureSource(root);
if (!sameCandidate(candidateBefore, candidateAfter)) {
  console.error('Candidate changed across changed-file checks.');
  process.exit(1);
}
if (results.some((result) => result.exitCode !== 0)) process.exit(1);
console.log('Changed-file checks passed.');
