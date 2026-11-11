import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';

const entries = {
  start: 'scripts/task-start.mjs',
  registry: 'scripts/task-registry.mjs',
  preview: 'scripts/task-preview.mjs',
  data: 'scripts/task-data-scope.mjs',
  work: 'scripts/task-development.mjs',
  complete: 'scripts/task-completion.mjs',
  check: 'scripts/dev-task.mjs',
  temporary: 'scripts/dev-task.mjs',
  combination: 'scripts/preview-combination.mjs',
};
export function previewEntryArguments(command, target, rest) {
  const values = command === 'check' ? ['--port'] : ['--mode', '--api', '--backend-port'];
  const switches = command === 'temporary' ? ['--database-risk'] : [];
  const seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    assert.ok(values.includes(flag) || switches.includes(flag), 'Unsupported ' + command + ' option: ' + flag);
    assert.ok(!seen.has(flag), 'Duplicate ' + command + ' option: ' + flag);
    seen.add(flag);
    if (values.includes(flag)) {
      assert.ok(rest[i + 1] && !rest[i + 1].startsWith('--'), 'Missing value for ' + flag);
      i++;
    }
  }
  return command === 'check'
    ? ['--check', '--worktree', target, ...rest]
    : ['--worktree', target, '--temporary', ...rest];
}
export function publishedTaskEntry(root, args) {
  const git = (cwd, ...flags) => execFileSync('git', ['-C', cwd, ...flags], { encoding: 'utf8', stdio: 'pipe' }).trim();
  let target = realpathSync(root);
  if (args[0] === '--worktree') {
    assert.ok(args[1]);
    target = realpathSync(args[1]);
    args = args.slice(2);
  }
  const [command, ...rest] = args;
  assert.ok(
    entries[command],
    'task:entry [--worktree <exact path>] <start|registry|preview|data|work|complete|check|temporary|combination> [args]',
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
  const forwarded = ['check', 'temporary'].includes(command) ? previewEntryArguments(command, target, rest) : rest;
  return { script, cwd: target, args: forwarded, published, source: main };
}
export function main(root = process.cwd(), args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log(
      'task:entry [--worktree <exact path>] <start|registry|preview|data|work|complete|check|temporary|combination> [args]\ncheck [--port <5175-5199>]\ntemporary [--mode auto|frontend|full] [--api <isolated-origin>] [--backend-port <8081-8099>] [--database-risk]\ncombination plan|create <id> --member <task@full-sha> --member <task@full-sha> | status|run|stop <id>\nUse the clean published main entry for both new and restored task worktrees. No automatic adoption or preview takeover.',
    );
    return;
  }
  const plan = publishedTaskEntry(root, args);
  const result = spawnSync(process.execPath, [plan.script, ...plan.args], {
    cwd: plan.cwd,
    env: process.env,
    stdio: 'inherit',
  });
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
