import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createValidationPlan, normalizeFiles } from './check-changed-plan.mjs';
import { runVerificationTask } from './verification-runner.mjs';
import { captureSource } from './verification-evidence.mjs';

export function parseChangedArgs(args) {
  const options = { listOnly: false, showHelp: false, force: false, files: [] };
  let pathsOnly = false;
  for (const arg of args) {
    if (pathsOnly) options.files.push(arg);
    else if (arg === '--') pathsOnly = true;
    else if (arg === '--list') options.listOnly = true;
    else if (arg === '--help' || arg === '-h') options.showHelp = true;
    else if (arg === '--force' || arg === '--no-reuse') options.force = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown argument: ${arg}`);
    else options.files.push(arg);
  }
  return options;
}

export function collectChangedFiles(root) {
  const gitFiles = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0)
      throw new Error(`Cannot establish changed files (${args[0]}): ${result.error?.message ?? result.stderr?.trim()}`);
    if (!result.stdout) return [];
    if (!result.stdout.endsWith('\0')) throw new Error('Incomplete NUL-delimited Git file list');
    const files = result.stdout.slice(0, -1).split('\0');
    if (files.some((file) => !file)) throw new Error('Invalid empty path in Git file list');
    return files;
  };
  return normalizeFiles(root, [
    ...gitFiles(['diff', '--name-only', '-z', '--no-renames', '--cached', 'HEAD', '--']),
    ...gitFiles(['diff', '--name-only', '-z', '--no-renames', '--']),
    ...gitFiles(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
}

function explicitChangedFiles(root, files) {
  const selected = normalizeFiles(root, files);
  let changed;
  for (const file of selected) {
    let stat;
    try {
      stat = lstatSync(path.resolve(root, file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (stat && !stat.isFile() && !stat.isSymbolicLink())
      throw new Error(`Explicit path must name a file: ${JSON.stringify(file)}`);
    if (!stat) {
      changed ??= new Set(collectChangedFiles(root));
      if (!changed.has(file)) throw new Error(`Unknown explicit file: ${JSON.stringify(file)}`);
    }
  }
  return selected;
}

function sameCandidate(left, right) {
  return ['digest', 'baseline', 'mergeBase', 'mutationStamp'].every((field) => left[field] === right[field]);
}

export async function main(
  args = process.argv.slice(2),
  { root = process.cwd(), capture = captureSource, run = runVerificationTask, report = console.log } = {},
) {
  const options = parseChangedArgs(args);
  if (options.showHelp) {
    report(`Usage:
  npm run check:changed -- [--list] [--force|--no-reuse] [files...]

Without file arguments, checks staged, unstaged, deleted, and untracked files.
With file arguments, checks only files from the current task.
--list prints selected checks without running them.
--force / --no-reuse executes checks without reusing previous results.
-- treats following arguments as literal file paths.`);
    return 0;
  }

  const plannedCandidate = options.listOnly ? null : capture(root);
  const files = options.files.length ? explicitChangedFiles(root, options.files) : collectChangedFiles(root);
  if (plannedCandidate && !sameCandidate(plannedCandidate, capture(root)))
    throw new Error('Candidate changed during changed-file planning.');
  if (files.length === 0) {
    report('No changed files require validation.');
    return 0;
  }
  const plan = createValidationPlan(files, (file) => existsSync(path.resolve(root, file)), { root });
  report(`Changed files: ${files.length}`);
  for (const task of plan.tasks)
    report(`- ${task.name}: npm ${task.args.join(' ')}${task.reason ? ` (${task.reason})` : ''}`);
  if (plan.backendPlan?.mode !== 'none' && plan.backendPlan)
    report(`Backend coverage: ${plan.backendPlan.mode}; ${plan.backendPlan.reason}`);
  if (plan.browserPlan?.mode === 'full') {
    report(`Follow-up E2E: npm run test:e2e:chrome (${plan.browserPlan.reason})`);
  } else if (plan.e2eFiles.length > 0) {
    report(`Follow-up E2E: npm run test:e2e:chrome -- ${plan.e2eFiles.join(' ')}`);
  }
  if (options.listOnly || plan.tasks.length === 0) return 0;

  const candidateBefore = capture(root);
  if (!sameCandidate(plannedCandidate, candidateBefore))
    throw new Error('Candidate changed after changed-file planning.');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const results = await Promise.all(
    plan.tasks.map((task) =>
      run(
        {
          ...task,
          root,
          command: npmCommand,
          kind: task.kind ?? (task.args.includes('backend:test') ? 'backend' : 'node'),
          reuse: task.args.includes('backend:test'),
          ...(task.args.includes('build:app') ? { artifacts: ['dist'] } : {}),
        },
        { force: options.force },
      ),
    ),
  );
  if (!sameCandidate(candidateBefore, capture(root))) throw new Error('Candidate changed across changed-file checks.');
  if (results.some((result) => result.exitCode !== 0)) return 1;
  report('Changed-file checks passed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
