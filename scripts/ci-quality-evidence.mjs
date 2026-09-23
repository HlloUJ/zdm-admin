import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { validateNodeTestSummary } from './run-script-tests.mjs';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyChangedFiles } from './verification-impact.mjs';
import { engineeringDomainProof, scriptTestFiles, SOURCE_GUARD_TESTS } from './script-test-plan.mjs';
import { backendReportState, validateBackendReports } from './backend-test-evidence.mjs';
import { validateFrontendTestReport } from './frontend-test-evidence.mjs';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const saveJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

export function revisionIdentity(event, candidateSha, treeSha, env = process.env) {
  return {
    eventName: env.GITHUB_EVENT_NAME ?? 'local',
    sourceHeadSha: event.pull_request?.head?.sha ?? event.after ?? candidateSha,
    baseSha: event.pull_request?.base?.sha ?? event.before ?? null,
    candidateSha,
    treeSha,
    candidateKind: event.pull_request ? 'pull-request-merge' : 'push-head',
    workflowRunId: env.GITHUB_RUN_ID ?? null,
    attempt: env.GITHUB_RUN_ATTEMPT ?? null,
    runnerOS: env.RUNNER_OS ?? process.platform,
    nodeVersion: process.version,
  };
}

export function requireFirstAttempt(identity) {
  if (identity.workflowRunId)
    assert.equal(
      identity.attempt,
      '1',
      'Workflow reruns cannot grant success; preserve the failed run, fix its cause and validate a new candidate on its first attempt',
    );
}

export function verifyFrontendUnitEvidence(metadata) {
  for (const [kind, name, command] of [
    ['unit', 'frontend-unit', 'test:unit'],
    ['source-guards', 'frontend-source-guards', 'test:source-guards'],
  ]) {
    const phases = metadata.phases.filter((phase) => phase.name === name);
    assert.equal(phases.length, 1, `Missing or repeated ${name} phase`);
    const phase = phases[0];
    assert.deepEqual(phase.command, ['npm', 'run', command], `Unexpected ${name} command`);
    assert.equal(phase.exitCode, 0, `${name} did not pass`);
    const report = metadata.frontendResults?.[kind];
    validateFrontendTestReport(report, { kind, runId: phase.runId });
    if (kind === 'source-guards')
      assert.deepEqual(report.files, SOURCE_GUARD_TESTS, 'Incomplete source guard inventory');
  }
}

export function testIdentities(report, executed = false) {
  assert.ok(Array.isArray(report.suites), 'Playwright report is missing suites');
  assert.equal(report.errors?.length ?? 0, 0, 'Playwright report contains global errors');
  const ids = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      assert.ok(spec.id && Array.isArray(spec.tests) && spec.tests.length, 'Invalid Playwright spec');
      for (const item of spec.tests) {
        assert.ok(item.projectName, 'Playwright project identity is missing');
        if (executed) {
          assert.ok(item.results?.length, `Test has no execution result: ${spec.id}`);
          assert.equal(item.status, 'expected', `Test was skipped, flaky or unexpected: ${spec.id}`);
          assert.ok(
            item.results.every((result) => result.status === 'passed'),
            `Every execution must pass without skipped, interrupted or failed attempts: ${spec.id}`,
          );
        }
        ids.push(`${spec.id}:${item.projectName}:${item.repeatEachIndex ?? 0}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  report.suites.forEach(visit);
  assert.ok(ids.length > 0, 'An empty test list cannot pass the coverage gate');
  assert.equal(new Set(ids).size, ids.length, 'Duplicate tests inside a Playwright report');
  return ids.sort();
}

export function verifyFrontendEvidence(needs, groups) {
  const expectedJobs = ['frontend_static', 'frontend_e2e_1', 'frontend_e2e_2'];
  for (const job of expectedJobs) assert.equal(needs[job]?.result, 'success', `${job} did not succeed`);
  assert.equal(groups.length, 3, 'All three frontend evidence artifacts are required');
  const first = groups[0].metadata;
  for (const [index, group] of groups.entries()) {
    const metadata = group.metadata;
    requireFirstAttempt(metadata);
    assert.equal(metadata.status, 'success', `Artifact ${index} did not finish successfully`);
    for (const field of ['sourceHeadSha', 'baseSha', 'candidateSha', 'treeSha', 'workflowRunId', 'attempt']) {
      assert.equal(metadata[field], first[field], `Evidence has a different ${field}`);
    }
    assert.ok(metadata.candidateSha && metadata.sourceHeadSha && metadata.treeSha, 'Missing candidate identity');
    assert.ok(metadata.phases?.length, 'Missing phase timings');
    assert.ok(
      metadata.phases.every((phase) => phase.exitCode === 0),
      'A recorded phase failed',
    );
    const required = index === 0 ? ['frontend-quality', 'frontend-build', 'frontend-test-list'] : [`e2e-${index}`];
    for (const name of required)
      assert.ok(
        metadata.phases.some((phase) => phase.name === name),
        `Missing phase ${name}`,
      );
  }
  verifyFrontendUnitEvidence(groups[0].metadata);
  const expected = testIdentities(groups[0].report);
  const actual = groups
    .slice(1)
    .flatMap((group) => testIdentities(group.report, true))
    .sort();
  assert.equal(new Set(actual).size, actual.length, 'A test ran in more than one shard');
  assert.deepEqual(actual, expected, 'Shard union differs from the complete test list');
  return { status: 'success', identity: first, testCount: actual.length, shardCount: 2 };
}

export function changedPathsFromNameStatus(output) {
  const tokens = output.split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const files = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    assert.match(status, /^(?:[ACDMRTUXB]|[RC]\d+)$/, 'Unknown Git diff status');
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let part = 0; part < count; part++) {
      const file = tokens[index++];
      assert.ok(file, 'Truncated Git diff record');
      files.push(file);
    }
  }
  return [...new Set(files)].sort();
}

function gitRaw(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot record Git identity: ${result.stderr}`);
  return result.stdout;
}
const gitValue = (args) => gitRaw(args).trim();

export function changeScope(event, identity, git = gitRaw, engineeringProof = engineeringDomainProof(process.cwd())) {
  let files;
  let problem = null;
  try {
    const { candidateSha, sourceHeadSha, baseSha, candidateKind } = identity;
    for (const sha of [candidateSha, sourceHeadSha, baseSha]) {
      assert.match(sha ?? '', /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, 'Missing immutable diff identity');
      assert.ok(!/^0+$/.test(sha), 'A new branch has no proven baseline');
      assert.equal(git(['rev-parse', '--verify', `${sha}^{commit}`]).trim(), sha, 'Commit identity unavailable');
    }
    if (event.pull_request) {
      const parents = git(['show', '-s', '--format=%P', candidateSha]).trim().split(' ');
      assert.deepEqual(parents, [baseSha, sourceHeadSha], 'PR candidate does not merge the exact event base and head');
    } else {
      assert.equal(candidateKind, 'push-head');
      assert.equal(candidateSha, sourceHeadSha, 'Push candidate differs from source head');
    }
    files = changedPathsFromNameStatus(
      git(['diff', '--name-status', '-z', '--find-renames', baseSha, candidateSha, '--']),
    );
    assert.ok(files.length, 'Empty differences cannot prove an inapplicable domain');
  } catch (error) {
    problem = error.message;
    files = [];
  }
  return {
    schemaVersion: 1,
    identity,
    proof: problem ? 'fallback' : 'verified',
    problem,
    files,
    engineeringProof,
    classification: classifyChangedFiles(files, { engineeringProof }),
  };
}

export function verifyScope(scope, identity) {
  requireFirstAttempt(identity);
  assert.equal(scope.schemaVersion, 1, 'Unknown classification schema');
  const engineeringProof = engineeringDomainProof(process.cwd());
  assert.deepEqual(scope.engineeringProof, engineeringProof, 'Engineering input proof differs from current candidate');
  for (const field of ['sourceHeadSha', 'baseSha', 'candidateSha', 'treeSha', 'workflowRunId', 'attempt']) {
    assert.equal(scope.identity[field], identity[field], `Classification has a different ${field}`);
  }
  assert.ok(identity.candidateSha && identity.sourceHeadSha && identity.treeSha, 'Missing classification identity');
  assert.ok(['verified', 'fallback'].includes(scope.proof), 'Unproven classification');
  if (scope.proof === 'fallback') assert.equal(scope.files.length, 0, 'Fallback cannot omit a domain');
  assert.deepEqual(
    scope.classification,
    classifyChangedFiles(scope.files, { engineeringProof }),
    'Classification does not match the complete diff',
  );
}

export function domainApplicable(needs, scope, domain, identity) {
  verifyScope(scope, identity);
  for (const job of ['scope', 'formatting']) assert.equal(needs[job]?.result, 'success', `${job} did not succeed`);
  assert.equal(
    needs.engineering?.result,
    scope.classification.engineering ? 'success' : 'skipped',
    'Engineering execution disagrees with scope',
  );
  const jobs = domain === 'frontend' ? ['frontend_static', 'frontend_e2e_1', 'frontend_e2e_2'] : ['backend_full'];
  const applicable = scope.classification[domain];
  for (const job of jobs) {
    assert.equal(
      needs[job]?.result,
      applicable ? 'success' : 'skipped',
      `${job} cannot become not-applicable after failure, cancellation or missing execution`,
    );
  }
  return applicable;
}

export function verifyEngineeringEvidence(scope, metadata, identity) {
  verifyScope(scope, identity);
  verifyScope(scope, metadata);
  assert.equal(metadata.status, 'success', 'Engineering job did not finish successfully');
  validateNodeTestSummary(metadata.engineeringResults?.summary);
  assert.deepEqual(
    metadata.engineeringResults.files,
    metadata.engineeringTests,
    'Executed engineering inventory differs',
  );
  assert.deepEqual(
    metadata.engineeringTests,
    scriptTestFiles(process.cwd(), 'engineering'),
    'Engineering test inventory is incomplete',
  );
  const phase = metadata.phases.find((entry) => entry.name === 'engineering-tests');
  assert.ok(phase, 'Missing engineering test phase');
  assert.ok(phase.runId && metadata.engineeringResults.runId === phase.runId, 'Engineering results are stale');
  assert.deepEqual(phase.command, ['npm', 'run', 'test:engineering'], 'Unexpected engineering command');
  assert.ok(
    metadata.phases.every((entry) => entry.exitCode === 0),
    'An engineering phase failed',
  );
}

function loadMetadata(directory) {
  const file = path.join(directory, 'metadata.json');
  if (existsSync(file)) return readJson(file);
  const event = process.env.GITHUB_EVENT_PATH ? readJson(process.env.GITHUB_EVENT_PATH) : {};
  const candidateSha = gitValue(['rev-parse', 'HEAD']);
  if (process.env.GITHUB_SHA)
    assert.equal(candidateSha, process.env.GITHUB_SHA, 'Checkout differs from workflow candidate');
  return {
    schemaVersion: 1,
    ...revisionIdentity(event, candidateSha, gitValue(['rev-parse', 'HEAD^{tree}'])),
    job: process.env.CI_EVIDENCE_JOB ?? process.env.GITHUB_JOB ?? 'local',
    startedAt: new Date().toISOString(),
    status: 'running',
    phases: [],
  };
}

function main(args) {
  const [mode, name, separator, ...commandArgs] = args;
  const directory = process.env.CI_EVIDENCE_DIR ?? 'coverage/ci-evidence';
  if (mode === 'scope') {
    const identity = loadMetadata(directory);
    requireFirstAttempt(identity);
    const event = process.env.GITHUB_EVENT_PATH ? readJson(process.env.GITHUB_EVENT_PATH) : {};
    const scope = changeScope(event, identity);
    saveJson(path.join(directory, 'scope.json'), scope);
    if (process.env.GITHUB_OUTPUT) {
      for (const key of ['frontend', 'backend', 'engineering', 'docsOnly', 'full', 'runtime'])
        appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${scope.classification[key]}\n`);
    }
    console.log(JSON.stringify(scope.classification));
    if (scope.problem) console.log(`Full fallback: ${scope.problem}`);
    return;
  }
  if (mode === 'aggregate-frontend' || mode === 'aggregate-backend') {
    const domain = mode.slice('aggregate-'.length);
    const current = loadMetadata(directory);
    const scope = readJson(path.join(name, 'ci-validation-scope', 'scope.json'));
    const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}');
    const applicable = domainApplicable(needs, scope, domain, current);
    if (scope.classification.engineering) {
      verifyEngineeringEvidence(scope, readJson(path.join(name, 'ci-engineering', 'metadata.json')), current);
    }
    let result = { status: 'not-applicable', identity: scope.identity, reasons: scope.classification.reasons };
    if (applicable && domain === 'frontend') {
      const groups = ['ci-frontend-static', 'ci-frontend-e2e-1', 'ci-frontend-e2e-2'].map((artifact, index) => ({
        metadata: readJson(path.join(name, artifact, 'metadata.json')),
        report: readJson(path.join(name, artifact, index === 0 ? 'all-tests.json' : 'report.json')),
      }));
      groups.forEach((group) => verifyScope(scope, group.metadata));
      result = verifyFrontendEvidence(needs, groups);
    } else if (applicable) {
      const metadata = readJson(path.join(name, 'ci-backend-full', 'metadata.json'));
      const reports = readJson(path.join(name, 'ci-backend-full', 'backend-tests.json'));
      verifyScope(scope, metadata);
      assert.equal(metadata.status, 'success', 'Backend execution did not finish successfully');
      assert.ok(metadata.phases.some((phase) => phase.name === 'backend-quality' && phase.exitCode === 0));
      assert.ok(
        metadata.phases.every((phase) => phase.exitCode === 0),
        'A backend phase failed',
      );
      assert.ok(reports.tests > 0 && reports.classes > 0, 'Backend tests were not executed');
      for (const key of ['failures', 'errors', 'skipped']) assert.equal(reports[key], 0);
      result = { status: 'success', identity: metadata, reports };
    }
    saveJson(path.join(directory, `${domain}-aggregate.json`), result);
    console.log(
      `${domain} quality: ${result.status}${result.testCount ? `; ${result.testCount} tests` : ''}; ${scope.classification.reasons.join(' ')}`,
    );
    return;
  }
  const metadata = loadMetadata(directory);
  const file = path.join(directory, 'metadata.json');
  if (mode === 'finish') {
    metadata.status = process.env.JOB_STATUS ?? 'failure';
    metadata.finishedAt = new Date().toISOString();
    metadata.observedElapsedMs = Date.parse(metadata.finishedAt) - Date.parse(metadata.startedAt);
    saveJson(file, metadata);
    return;
  }
  assert.ok(
    mode === 'run' && name && separator === '--' && commandArgs.length,
    'Usage: run <phase> -- <command> [args] | finish | aggregate <artifact-directory>',
  );
  saveJson(file, metadata);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const [command, ...childArgs] = commandArgs;
  const backendRoot = name === 'backend-quality' ? gitValue(['rev-parse', '--show-toplevel']) : null;
  const previousReports = backendRoot ? backendReportState(backendRoot) : null;
  if (name === 'engineering-tests') metadata.engineeringTests = scriptTestFiles(process.cwd(), 'engineering');
  const frontendKind = { 'frontend-unit': 'unit', 'frontend-source-guards': 'source-guards' }[name];
  const runId = name === 'engineering-tests' || frontendKind ? randomUUID() : null;
  const result = spawnSync(command, childArgs, {
    stdio: 'inherit',
    env: runId
      ? { ...process.env, CI_EVIDENCE_DIR: directory, ENGINEERING_RUN_ID: runId, FRONTEND_TEST_RUN_ID: runId }
      : process.env,
  });
  let exitCode = result.status ?? 1;
  let reportError = null;
  if (backendRoot && exitCode === 0) {
    try {
      saveJson(
        path.join(directory, 'backend-tests.json'),
        validateBackendReports(backendRoot, { startedAt, previousReports }),
      );
    } catch (error) {
      exitCode = 1;
      reportError = error.message;
      console.error(reportError);
    }
  }
  if (name === 'engineering-tests' && exitCode === 0) {
    try {
      metadata.engineeringResults = readJson(path.join(directory, 'engineering-results.json'));
      assert.equal(metadata.engineeringResults.runId, runId, 'Engineering results are stale');
      assert.deepEqual(
        metadata.engineeringResults.files,
        metadata.engineeringTests,
        'Engineering test inventory differs',
      );
      validateNodeTestSummary(metadata.engineeringResults.summary);
    } catch (error) {
      exitCode = 1;
      reportError = error.message;
      console.error(reportError);
    }
  }
  if (frontendKind && exitCode === 0) {
    try {
      const report = readJson(path.join(directory, `${frontendKind}-results.json`));
      validateFrontendTestReport(report, { kind: frontendKind, runId });
      metadata.frontendResults ??= {};
      metadata.frontendResults[frontendKind] = report;
    } catch (error) {
      exitCode = 1;
      reportError = error.message;
      console.error(reportError);
    }
  }
  metadata.phases.push({
    name,
    ...(runId ? { runId } : {}),
    command: [command, ...childArgs],
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
    exitCode,
    signal: result.signal ?? null,
    error: reportError ?? result.error?.message ?? null,
  });
  saveJson(file, metadata);
  process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
