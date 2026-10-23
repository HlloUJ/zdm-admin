// Main may reuse only an exact, successful same-repository PR merge candidate.
// Every uncertainty is a miss: the unchanged normal CI commands then run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';
import { SOURCE_GUARD_TESTS } from './script-test-plan.mjs';
import { hashPaths } from './verification-evidence.mjs';

export const REUSABLE_JOBS = {
  formatting: 'ci-formatting',
  frontend_static: 'ci-frontend-static',
  frontend_e2e_1: 'ci-frontend-e2e-1',
  frontend_e2e_2: 'ci-frontend-e2e-2',
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function executionEnvironment(env) {
  // These jobs execute under the same reviewed environment on PR and main.
  // API tokens and event-specific GitHub identities never reach test processes.
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key]) =>
        /^(?:PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_ALL|TZ|DISPLAY|CI|GITHUB_ACTIONS|CI_EVIDENCE_DIR|XDG_.*|PLAYWRIGHT_.*|VITE_.*|VITEST_.*|NODE_.*|NPM_CONFIG_.*)$/.test(
          key,
        ),
      )
      .sort(),
  );
}
function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `${program} identity or evidence unavailable`);
  return result.stdout.trim();
}
const git = (...args) => command('git', args);
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
export function environmentProof(env = process.env) {
  assert.equal(process.platform, 'linux', 'Only reviewed hosted Linux jobs support CI reuse');
  assert.ok(REUSABLE_JOBS[env.GITHUB_JOB], 'This domain has no equivalence contract; execute normally');
  assert.equal(env.GITHUB_RUN_ATTEMPT, '1', 'Reruns cannot reuse evidence');
  assert.ok(env.ImageOS && env.ImageVersion, 'Missing immutable runner image identity');
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Sources changed during setup');
  const browser = env.GITHUB_JOB.startsWith('frontend_e2e');
  if (browser) assert.ok(existsSync('/opt/google/chrome/chrome'), 'Actual Chrome runtime cannot be proven');
  return {
    version: 1,
    contract: 'reviewed-frontend-environment-v1',
    job: env.GITHUB_JOB,
    image: [env.ImageOS, env.ImageVersion],
    platform: [process.platform, process.arch, os.release()],
    hardware: [os.cpus().length, os.cpus()[0]?.model, os.totalmem()],
    node: [process.version, digest(readFileSync(process.execPath))],
    packages: digest(command('dpkg-query', ['-W', '-f=${Package}=${Version}\n'])),
    inputs: hashPaths(process.cwd(), ['node_modules'], { dependency: true }),
    systemFiles: hashPaths('/', ['/etc/os-release', '/etc/fonts', '/usr/share/fonts']),
    browser: browser ? hashPaths('/', ['/opt/google/chrome']) : null,
    environment: digest(JSON.stringify(executionEnvironment(env))),
  };
}
export function validateProvenance({ current, original, run, pull, commit, repository, parents, proof }) {
  assert.ok(REUSABLE_JOBS[original.job], 'Unsupported reuse domain');
  assert.equal(proof?.version, 1);
  assert.equal(proof?.contract, 'reviewed-frontend-environment-v1');
  assert.equal(proof?.job, original.job);
  assert.ok(proof.image?.length === 2 && proof.image.every(Boolean));
  assert.ok(proof.platform?.length === 3 && proof.platform.every(Boolean));
  assert.ok(proof.hardware?.length === 3 && proof.hardware.every(Boolean));
  for (const key of ['packages', 'inputs', 'systemFiles', 'environment'])
    assert.match(proof[key] ?? '', /^[a-f0-9]{64}$/);
  assert.ok(proof.node?.length === 2 && proof.node.every(Boolean));
  if (original.job.startsWith('frontend_e2e')) assert.match(proof.browser ?? '', /^[a-f0-9]{64}$/);
  const required = {
    formatting: ['npm-ci', 'formatting'],
    frontend_static: [
      'npm-ci',
      'frontend-quality',
      'frontend-unit',
      'frontend-source-guards',
      'frontend-build',
      'frontend-test-list',
    ],
    frontend_e2e_1: ['npm-ci', 'chrome-install', 'e2e-1'],
    frontend_e2e_2: ['npm-ci', 'chrome-install', 'e2e-2'],
  }[original.job];
  assert.deepEqual(
    original.phases?.map((phase) => phase.name),
    required,
    'Source phase inventory differs',
  );
  assert.equal(current.eventName, 'push');
  assert.equal(current.attempt, '1');
  assert.equal(parents.length, 2, 'Only an ordinary exact two-parent merge supports reuse');
  assert.equal(current.sourceHeadSha, current.candidateSha);
  assert.equal(current.baseSha, parents[0], 'Main advanced by more than the tested merge');
  assert.equal(pull.state, 'closed');
  assert.equal(pull.merged, true);
  assert.equal(pull.base?.ref, 'main');
  assert.equal(pull.base?.repo?.full_name, repository);
  assert.equal(pull.head?.repo?.full_name, repository, 'Fork evidence is not trusted for reuse');
  assert.equal(pull.merge_commit_sha, current.candidateSha);
  assert.equal(pull.head?.sha, parents[1]);
  assert.equal(run.event, 'pull_request');
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.equal(run.run_attempt, 1);
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.path, '.github/workflows/quality.yml');
  assert.equal(run.head_sha, parents[1]);
  assert.equal(String(run.id), original.workflowRunId);
  assert.equal(original.attempt, '1');
  assert.equal(original.status, 'success');
  assert.equal(original.eventName, 'pull_request');
  assert.equal(original.sourceHeadSha, parents[1]);
  assert.equal(original.baseSha, parents[0]);
  assert.equal(original.treeSha, current.treeSha);
  assert.equal(commit.sha, original.candidateSha);
  assert.equal(commit.tree?.sha, current.treeSha);
  assert.deepEqual(
    commit.parents.map((entry) => entry.sha),
    parents,
  );
  assert.deepEqual(original.environmentProof, proof, 'Installed dependencies, runtime or execution environment differ');
  assert.equal(original.reusedFrom, undefined, 'Chained evidence is prohibited');
  assert.ok(original.phases?.length && original.phases.every((phase) => phase.exitCode === 0), 'Failed source phases');
  return true;
}
export function validateSourceArtifact(directory, metadata) {
  if (metadata.job === 'formatting') return;
  const listed = metadata.job === 'frontend_static';
  const report = json(path.join(directory, listed ? 'all-tests.json' : 'report.json'));
  assert.ok(Array.isArray(report.suites) && report.suites.length, 'Missing test inventory');
  assert.equal(report.errors?.length ?? 0, 0);
  const ids = [];
  function visit(suite) {
    for (const spec of suite.specs ?? [])
      for (const item of spec.tests ?? []) {
        assert.ok(spec.id && item.projectName, 'Missing test identity');
        ids.push(`${spec.id}:${item.projectName}:${item.repeatEachIndex ?? 0}`);
        if (!listed) {
          assert.equal(item.expectedStatus ?? 'passed', 'passed');
          assert.equal(item.status, 'expected');
          assert.equal(item.results?.length, 1);
          assert.equal(item.results[0].status, 'passed');
          assert.equal(item.results[0].retry ?? 0, 0);
        }
      }
    for (const child of suite.suites ?? []) visit(child);
  }
  report.suites.forEach(visit);
  assert.ok(ids.length);
  assert.equal(new Set(ids).size, ids.length);
  if (listed)
    for (const kind of ['unit', 'source-guards']) {
      const phase = metadata.phases.find(
        (item) => item.name === `frontend-${kind === 'unit' ? 'unit' : 'source-guards'}`,
      );
      validateFrontendTestReport(metadata.frontendResults?.[kind], { kind, runId: phase?.runId });
      if (kind === 'source-guards') assert.deepEqual(metadata.frontendResults[kind].files, SOURCE_GUARD_TESTS);
    }
}

export function validateReusedMetadata(metadata) {
  if (!metadata.reusedFrom) return;
  const p = metadata.reusedFrom;
  assert.equal(metadata.job, p.original.job);
  validateProvenance({ ...p, current: metadata, proof: metadata.environmentProof });
  // Replayed reports retain original run IDs, commands and results; no fabricated execution.
  assert.deepEqual(metadata.phases, p.original.phases);
  assert.deepEqual(metadata.frontendResults, p.original.frontendResults);
}
export async function tryReuse(directory, env = process.env, dependencies = {}) {
  let reused = false;
  const job = env.GITHUB_JOB;
  let proof = null;
  try {
    assert.notEqual(env.CI_EQUIVALENCE_DISABLED, 'true', 'Operator disabled equivalence reuse');
    proof = (dependencies.environmentProof ?? environmentProof)(env);
    writeFileSync(path.join(directory, 'environment-proof.json'), JSON.stringify(proof));
    if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main')
      throw new Error('Fresh PR/dev execution');
    const repository = env.GITHUB_REPOSITORY;
    assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/);
    const current = json(path.join(directory, 'metadata.json'));
    const parents = dependencies.parents ? dependencies.parents() : git('show', '-s', '--format=%P', 'HEAD').split(' ');
    assert.equal(parents.length, 2);
    const api = dependencies.api ?? ((suffix) => JSON.parse(command('gh', ['api', `repos/${repository}/${suffix}`])));
    const pulls = api(`commits/${current.candidateSha}/pulls`);
    const pull = pulls.find((item) => item.merged_at && item.merge_commit_sha === current.candidateSha);
    assert.ok(pull, 'No exact merged PR');
    const fullPull = api(`pulls/${pull.number}`);
    const runs = api(
      `actions/workflows/quality.yml/runs?event=pull_request&head_sha=${parents[1]}&per_page=20`,
    ).workflow_runs;
    // GitHub may clear pull_requests after merge. Bind by exact source head and
    // independently verify the tested merge parents/tree below. Never prefer an older green.
    const run = runs
      .filter((item) => item.event === 'pull_request' && item.head_sha === parents[1])
      .sort((a, b) => b.run_number - a.run_number)[0];
    assert.ok(run, 'No source workflow');
    assert.equal(run.status, 'completed');
    assert.equal(run.conclusion, 'success');
    assert.equal(run.run_attempt, 1);
    const jobs = api(`actions/runs/${run.id}/jobs?filter=all&per_page=100`).jobs;
    for (const name of ['Frontend quality', 'Backend quality'])
      assert.equal(
        jobs.filter((item) => item.name === name && item.conclusion === 'success').length,
        1,
        'Required source gate missing',
      );
    assert.ok(
      jobs.every((item) => ['success', 'skipped'].includes(item.conclusion)),
      'Unsuccessful source workflow',
    );
    const staging = dependencies.staging ?? path.join(os.tmpdir(), `zdm-ci-${env.GITHUB_RUN_ID}-${job}`);
    mkdirSync(staging, { recursive: true });
    (dependencies.download ?? ((args) => command('gh', args)))([
      'run',
      'download',
      String(run.id),
      '--repo',
      repository,
      '--name',
      REUSABLE_JOBS[job],
      '--dir',
      staging,
    ]);
    const original = json(path.join(staging, 'metadata.json'));
    assert.equal(original.job, job);
    validateSourceArtifact(staging, original);
    assert.match(original.candidateSha ?? '', /^[a-f0-9]{40}$/);
    const commit = api(`git/commits/${original.candidateSha}`);
    const provenance = { original, run, pull: fullPull, commit, repository, parents };
    validateProvenance({ ...provenance, current, proof });
    const replay = {
      ...original,
      ...Object.fromEntries(
        [
          'eventName',
          'sourceHeadSha',
          'baseSha',
          'candidateSha',
          'treeSha',
          'candidateKind',
          'workflowRunId',
          'attempt',
          'runnerOS',
          'nodeVersion',
        ].map((key) => [key, current[key]]),
      ),
      startedAt: current.startedAt,
      setupPhases: current.phases,
      execution: 'reused',
      environmentProof: proof,
      reusedFrom: provenance,
    };
    validateReusedMetadata(replay);
    cpSync(staging, directory, { recursive: true });
    writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify(replay, null, 2) + '\n');
    reused = true;
    console.log(`Equivalent ${job} evidence reused from successful PR run ${run.id}; reports retained unchanged.`);
  } catch (error) {
    console.log(`CI equivalence miss: ${error.message}; run normal checks.`);
  }
  if (!reused && proof) {
    const file = path.join(directory, 'metadata.json');
    const metadata = json(file);
    metadata.environmentProof = proof;
    writeFileSync(file, JSON.stringify(metadata, null, 2) + '\n');
  }
  if (env.GITHUB_OUTPUT) writeFileSync(env.GITHUB_OUTPUT, `reused=${reused}\n`, { flag: 'a' });
  return reused;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  tryReuse(process.env.CI_EVIDENCE_DIR ?? 'coverage/ci-evidence').catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
