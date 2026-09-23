import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { runVerificationTask } from './verification-runner.mjs';
import { captureSource } from './verification-evidence.mjs';
import { createValidationPlan } from './check-changed-plan.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';
import { engineeringDomainProof } from './script-test-plan.mjs';

export function collectDeliveryChanges(root) {
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Cannot establish complete delivery diff');
    return result.stdout;
  };
  try {
    const base = git(['merge-base', 'HEAD', 'refs/remotes/origin/main']).trim();
    const files = [
      ...new Set(
        [
          ...git(['diff', '--name-only', '-z', '--no-renames', base, 'HEAD']).split('\0'),
          ...git(['diff', '--name-only', '-z', '--no-renames', 'HEAD']).split('\0'),
          ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
        ].filter(Boolean),
      ),
    ].sort();
    return { files, impact: classifyChangedFiles(files, { engineeringProof: engineeringDomainProof(root) }), base };
  } catch {
    return { files: [], impact: classifyChangedFiles(['<unknown>']), base: null };
  }
}

export function createVerificationPlan({
  root,
  browser,
  env = process.env,
  affected = false,
  files = [],
  impact = classifyChangedFiles(files, { engineeringProof: engineeringDomainProof(root) }),
  runtime = false,
  plannedCandidate = null,
}) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const task = (name, script, extra = {}) => ({ root, name, command, args: ['run', script], env, ...extra });
  const browserEnv = browser ? { ...env, PLAYWRIGHT_CHANNEL: browser } : env;
  const plan = {
    preflight: task('format check', 'format:check', { reuse: false }),
    frontend: [
      task('frontend quality', 'quality:checks'),
      task('frontend build', 'build:app', { artifacts: ['dist'], reuse: false }),
      task('browser tests', 'test:e2e', {
        kind: 'browser',
        env: browserEnv,
      }),
    ],
    engineering: [task('engineering tests', 'test:engineering', { reuse: false })],
    backend: [
      task('backend tests', 'backend:test', { kind: 'backend' }),
      task('backend static quality', 'backend:quality:static', { kind: 'backend' }),
    ],
    runtime:
      runtime || (affected && impact.runtime)
        ? task('task runtime identity', 'dev:task:check', {
            args: ['run', 'dev:task:check', '--', '--worktree', root],
            kind: 'runtime',
          })
        : null,
    affected,
    impact,
    plannedCandidate,
  };
  if (affected && !impact.full) {
    const selected = createValidationPlan(files, (file) => existsSync(path.resolve(root, file)), { root });
    const existing = files.filter((file) => existsSync(path.resolve(root, file)));
    plan.preflight = existing.length
      ? task('changed format check', 'format:changed', {
          args: ['run', 'format:changed', '--', ...existing],
          reuse: false,
        })
      : { root, name: 'diff check', command: 'git', args: ['diff', '--check'], env, reuse: false };
    plan.frontend = [];
    plan.backend = [];
    plan.engineering = impact.engineering ? plan.engineering : [];
    for (const entry of selected.tasks) {
      const scriptSuite = entry.args.some((arg) => ['test:scripts', 'test:scripts:files'].includes(arg));
      if (scriptSuite) {
        if (!plan.engineering.length)
          plan.engineering.push(task('engineering tests', 'test:engineering', { reuse: false }));
        if (!plan.frontend.some((entry) => entry.args.includes('test:source-guards')))
          plan.frontend.push(task('source guards', 'test:source-guards', { reuse: false }));
        continue;
      }
      const backend = entry.args.includes('backend:test');
      plan[backend ? 'backend' : 'frontend'].push({
        ...entry,
        root,
        command,
        env,
        kind: backend ? 'backend' : 'node',
        reuse: backend,
      });
    }
    if (impact.frontend) {
      plan.frontend.push(task('frontend build', 'build:app', { reuse: false }));
      if (selected.e2eFiles.length || selected.browserPlan.mode === 'full')
        plan.frontend.push(
          task('affected browser tests', 'test:e2e', {
            args: ['run', 'test:e2e', '--', ...selected.e2eFiles],
            kind: 'browser',
            env: browserEnv,
          }),
        );
    }
    if (impact.backend)
      plan.backend.push(task('backend static quality', 'backend:quality:static', { kind: 'backend' }));
  }
  return plan;
}

export async function executeVerification(
  plan,
  { run = runVerificationTask, force = false, report = console.log, capture = captureSource } = {},
) {
  const started = performance.now();
  const before = capture(plan.preflight.root);
  if (
    plan.plannedCandidate &&
    ['digest', 'baseline', 'mergeBase', 'mutationStamp'].some((key) => plan.plannedCandidate[key] !== before[key])
  ) {
    report('Candidate changed after impact planning; regenerate the validation plan.');
    return 1;
  }
  const execute = (task) => run(task, { force, report });
  if ((await execute(plan.preflight)).exitCode !== 0) return 1;
  // Mock browser / isolated Testcontainers checks do not start or reconfigure the shared backend.
  if (plan.runtime && (await execute(plan.runtime)).exitCode !== 0) return 1;
  const pipeline = async (tasks) => {
    for (const task of tasks) if ((await execute(task)).exitCode !== 0) return 1;
    return 0;
  };
  const results = await Promise.all([
    pipeline(plan.frontend),
    pipeline(plan.backend),
    pipeline(plan.engineering ?? []),
  ]);
  const after = capture(plan.preflight.root);
  const stable = ['digest', 'baseline', 'mergeBase', 'mutationStamp'].every((key) => before[key] === after[key]);
  if (!stable) report('Candidate changed across verification stages; rerun the affected gate.');
  const code = results.some(Boolean) || !stable ? 1 : 0;
  report(
    `Local ${plan.affected ? 'affected' : 'full'} checks ${code ? 'failed' : 'passed'} in ${((performance.now() - started) / 1000).toFixed(1)}s. Runtime ${plan.runtime ? 'checked' : 'not required by this plan'}; local evidence is disabled in CI.`,
  );
  if (plan.affected)
    report(
      'This is local evidence only. Required CI must pass on the final candidate before merge; CI unavailable requires the full local fallback.',
    );
  return code;
}

export async function main(args = process.argv.slice(2)) {
  const allowed = new Set(['--list', '--force', '--no-reuse', '--browser', '--affected', '--runtime', '--help', '-h']);
  let browser;
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index])) throw new Error(`Unknown argument: ${args[index]}`);
    if (args[index] === '--browser') {
      browser = args[++index];
      if (!browser || browser.startsWith('-')) throw new Error('--browser requires a channel');
    }
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: node scripts/verify.mjs [--affected] [--runtime] [--browser chrome] [--list] [--force|--no-reuse]',
    );
    return 0;
  }
  const affected = args.includes('--affected');
  const plannedCandidate = args.includes('--list') ? null : captureSource(process.cwd());
  const changes = affected ? collectDeliveryChanges(process.cwd()) : {};
  const plan = createVerificationPlan({
    root: process.cwd(),
    browser,
    affected,
    ...changes,
    runtime: args.includes('--runtime'),
    plannedCandidate,
  });
  if (args.includes('--list')) {
    console.log(`Mode: ${affected ? 'affected delivery checks; final CI still required' : 'full automated checks'}`);
    if (affected) console.log(`Impact: ${JSON.stringify(plan.impact)}`);
    console.log(`Preflight: ${plan.preflight.command} ${plan.preflight.args.join(' ')}`);
    console.log(
      plan.runtime
        ? `Runtime: ${plan.runtime.command} ${plan.runtime.args.join(' ')}`
        : 'Runtime: not required; no shared backend startup.',
    );
    for (const name of ['frontend', 'backend', 'engineering']) {
      console.log(`${name} pipeline (independent pipelines run concurrently):`);
      for (const task of plan[name])
        console.log(
          `- ${task.name}: ${task.command} ${task.args.join(' ')}${task.env.PLAYWRIGHT_CHANNEL ? ` [PLAYWRIGHT_CHANNEL=${task.env.PLAYWRIGHT_CHANNEL}]` : ''}`,
        );
    }
    if (plan.backend.length) console.log('Backend identity probes access Docker.');
    if (plan.frontend.some((task) => task.kind === 'browser')) console.log('Browser tests listen on local port 5174.');
    console.log('--list only prints this plan.');
    return 0;
  }
  return executeVerification(plan, { force: args.includes('--force') || args.includes('--no-reuse') });
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
