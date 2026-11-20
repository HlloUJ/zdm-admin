import { createBoardIntake } from './task-board-intake.mjs';
import './task-network.mjs';
import { checkStartMonitoringArgs } from './task-monitor-registration.mjs';
import assert from 'node:assert/strict';
import { observeEntry } from './parallel-task-timing.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';

const entries = {
  start: 'scripts/task-start.mjs',
  'execution-order': 'scripts/task-execution-order-cli.mjs',
  registry: 'scripts/task-registry.mjs',
  preview: 'scripts/task-preview.mjs',
  data: 'scripts/task-data-scope.mjs',
  work: 'scripts/task-development.mjs',
  complete: 'scripts/task-completion.mjs',
  check: 'scripts/dev-task.mjs',
  temporary: 'scripts/dev-task.mjs',
  combination: 'scripts/task-preview-combination.mjs',
};
export function publishedTaskEntry(root, args) {
  const git = (cwd, ...flags) => execFileSync('git', ['-C', cwd, ...flags], { encoding: 'utf8', stdio: 'pipe' }).trim();
  let target = realpathSync(root);
  if (args[0] === '--worktree') {
    assert.ok(args[1]);
    target = realpathSync(args[1]);
    args = args.slice(2);
  }
  assert.ok(
    !args.some((arg) => arg === '--worktree' || arg.startsWith('--worktree=')),
    'Use --worktree once before the command; forwarded task identity cannot override the verified worktree',
  );
  const [command, ...rest] = args;
  assert.ok(
    entries[command],
    'task:entry [--worktree <exact path>] <start|execution-order|registry|preview|data|work|complete|check|temporary|combination> [args]',
  );
  const registry = createTaskRegistry(root),
    targetRegistry = createTaskRegistry(target);
  assert.equal(targetRegistry.commonDir, registry.commonDir, 'Task entry cannot cross repositories');
  const mains = registeredTaskWorktrees(root).filter((item) => item.branch === 'main');
  assert.equal(mains.length, 1, 'Exact main anchor required');
  const main = realpathSync(mains[0].worktree),
    published = git(main, 'rev-parse', 'origin/main');
  assert.equal(git(main, 'rev-parse', 'HEAD'), published, 'Canonical entry must use the published main');
  assert.equal(git(main, 'status', '--porcelain'), '', 'Canonical main source is dirty');
  // The candidate copy cannot impersonate a published entry during bootstrap.
  const actualEntry = realpathSync(fileURLToPath(import.meta.url));
  assert.equal(
    actualEntry,
    path.join(main, 'scripts/task-entry.mjs'),
    'Use the main anchor entry, not a task candidate',
  );
  const script = path.join(main, entries[command]);
  assert.ok(existsSync(script) && lstatSync(script).isFile() && !lstatSync(script).isSymbolicLink());
  git(main, 'cat-file', '-e', published + ':' + entries[command]);
  if (command === 'start') {
    const context = checkStartMonitoringArgs(rest, targetRegistry);
    const option = (flag) => {
      const index = rest.indexOf(flag);
      return index < 0 ? undefined : rest[index + 1];
    };
    const slug = option('--slug');
    if (['codex-thread', 'collaboration-agent'].includes(context?.executionSurface))
      createBoardIntake(targetRegistry.commonDir).require(
        context,
        slug,
        option('--owner') || process.env.CODEX_THREAD_ID,
      );
  }
  if (command === 'registry' && rest[0] === 'register') {
    const index = rest.indexOf('--task');
    assert.ok(
      index >= 0 && targetRegistry.readTask(rest[index + 1]),
      'New task registration must use enrolled start; raw register is restore-only',
    );
  }
  const forwarded =
    command === 'check'
      ? ['--check', '--worktree', target, ...rest]
      : command === 'temporary'
        ? ['--worktree', target, '--temporary', ...rest]
        : command === 'registry' && rest[0] === 'register'
          ? [...rest, '--worktree', target]
          : rest;
  return { script, cwd: target, args: forwarded, published, source: main, command, originalArgs: rest };
}
export function main(root = process.cwd(), args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log(
      'task:entry [--worktree <exact path>] <start|execution-order|registry|preview|data|work|complete|check|temporary|combination> [args]\nUse the clean published main entry for both new and restored task worktrees. No automatic adoption or preview takeover.',
    );
    return;
  }
  const plan = publishedTaskEntry(root, args);
  const result = observeEntry(plan, createTaskRegistry(root), () =>
    spawnSync(process.execPath, [plan.script, ...plan.args], {
      cwd: plan.cwd,
      env: process.env,
      stdio: 'inherit',
    }),
  );
  assert.equal(
    result.status,
    0,
    result.error?.message ?? 'Task command failed; original output and task state retained',
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
