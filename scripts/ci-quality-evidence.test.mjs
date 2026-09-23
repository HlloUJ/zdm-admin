import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyChangedFiles } from './verification-impact.mjs';
import { engineeringDomainProof, scriptTestFiles } from './script-test-plan.mjs';
import {
  revisionIdentity,
  testIdentities,
  verifyFrontendEvidence,
  changedPathsFromNameStatus,
  changeScope,
  verifyScope,
  domainApplicable,
  verifyEngineeringEvidence,
} from './ci-quality-evidence.mjs';

const report = (ids, executed = false) => ({
  suites: [
    {
      specs: ids.map((id) => ({
        id,
        tests: [
          { projectName: 'chromium', ...(executed ? { status: 'expected', results: [{ status: 'passed' }] } : {}) },
        ],
      })),
    },
  ],
  errors: [],
});
function fixture() {
  const names = ['frontend_static', 'frontend_e2e_1', 'frontend_e2e_2'];
  const phases = [['frontend-quality', 'frontend-build', 'frontend-test-list'], ['e2e-1'], ['e2e-2']];
  return {
    needs: Object.fromEntries(names.map((name) => [name, { result: 'success' }])),
    groups: [report(['a', 'b']), report(['a'], true), report(['b'], true)].map((value, index) => ({
      metadata: {
        sourceHeadSha: 'head',
        baseSha: 'base',
        candidateSha: 'merge',
        treeSha: 'tree',
        status: 'success',
        workflowRunId: 'run',
        attempt: '1',
        phases: phases[index].map((name) => ({ name, exitCode: 0 })),
      },
      report: value,
    })),
  };
}

test('PR source head, base and checked merge candidate remain separate', () => {
  const identity = revisionIdentity(
    { pull_request: { head: { sha: 'head' }, base: { sha: 'base' } } },
    'merge',
    'tree',
    {},
  );
  assert.equal(identity.sourceHeadSha, 'head');
  assert.equal(identity.baseSha, 'base');
  assert.equal(identity.candidateSha, 'merge');
  assert.equal(identity.candidateKind, 'pull-request-merge');
});

test('all successful jobs and an exact disjoint shard union pass', () => {
  const { needs, groups } = fixture();
  assert.equal(verifyFrontendEvidence(needs, groups).testCount, 2);
});

test('any failed, cancelled, skipped or absent job fails the required aggregate', () => {
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    for (const job of ['frontend_static', 'frontend_e2e_1', 'frontend_e2e_2']) {
      const { needs, groups } = fixture();
      needs[job].result = result;
      assert.throws(() => verifyFrontendEvidence(needs, groups), /did not succeed/);
    }
  }
});

test('missing, duplicated, extra and unexecuted tests fail the aggregate', () => {
  for (const replacement of [report(['c'], true), report(['a'], true), report(['b', 'c'], true), report(['b'])]) {
    const { needs, groups } = fixture();
    groups[2].report = replacement;
    assert.throws(() => verifyFrontendEvidence(needs, groups));
  }
});

test('evidence cannot be borrowed from another candidate or an incomplete run', () => {
  for (const field of ['sourceHeadSha', 'baseSha', 'candidateSha', 'treeSha', 'workflowRunId', 'attempt', 'status']) {
    const { needs, groups } = fixture();
    groups[1].metadata[field] = 'other';
    assert.throws(() => verifyFrontendEvidence(needs, groups));
  }
  const { needs, groups } = fixture();
  groups[1].metadata.phases[0].exitCode = 1;
  assert.throws(() => verifyFrontendEvidence(needs, groups), /phase failed/);
});

test('report errors, interrupted results and missing required phases cannot pass', () => {
  const broken = report(['a'], true);
  broken.suites[0].specs[0].tests[0].results[0].status = 'interrupted';
  assert.throws(() => testIdentities(broken, true), /Every execution must pass/);
  assert.throws(
    () => testIdentities({ ...report(['a']), errors: [{ message: 'collection failed' }] }),
    /global errors/,
  );
  const { needs, groups } = fixture();
  groups[0].metadata.phases.pop();
  assert.throws(() => verifyFrontendEvidence(needs, groups), /Missing phase/);
});

test('the CLI records command failure, duration and final status without hiding the exit code', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zdm-ci-evidence-test-'));
  try {
    const env = { ...process.env, CI_EVIDENCE_DIR: directory };
    const child = spawnSync(
      process.execPath,
      [
        'scripts/ci-quality-evidence.mjs',
        'run',
        'intentional-test-failure',
        '--',
        process.execPath,
        '-e',
        'process.exit(7)',
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(child.status, 7, child.stderr);
    const finish = spawnSync(process.execPath, ['scripts/ci-quality-evidence.mjs', 'finish'], {
      env: { ...env, JOB_STATUS: 'failure' },
      encoding: 'utf8',
    });
    assert.equal(finish.status, 0, finish.stderr);
    const metadata = JSON.parse(readFileSync(path.join(directory, 'metadata.json'), 'utf8'));
    assert.equal(metadata.status, 'failure');
    assert.equal(metadata.phases[0].exitCode, 7);
    assert.ok(metadata.phases[0].durationMs >= 0);
    assert.ok(metadata.observedElapsedMs >= metadata.phases[0].durationMs);
    assert.ok(metadata.candidateSha && metadata.treeSha && metadata.finishedAt);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('skipped, flaky, expected failures and hidden retry failures never grant frontend success', () => {
  for (const [status, results] of [
    ['skipped', [{ status: 'skipped' }]],
    ['flaky', [{ status: 'failed' }, { status: 'passed' }]],
    ['unexpected', [{ status: 'failed' }]],
    ['expected', [{ status: 'failed' }]],
    ['expected', [{ status: 'failed' }, { status: 'passed' }]],
    ['expected', [{ status: 'timedOut' }, { status: 'passed' }]],
    ['expected', [{ status: 'skipped' }]],
  ]) {
    const { needs, groups } = fixture();
    Object.assign(groups[1].report.suites[0].specs[0].tests[0], { status, results });
    assert.throws(() => verifyFrontendEvidence(needs, groups), /skipped|Every execution/);
  }
});

// A passing spec captured from this task's Playwright 1.62.0 JSON reporter.
const realPlaywrightSpec = {
  title: 'keeps foundation pagination spacing consistent inside list layouts',
  ok: true,
  tags: [],
  tests: [
    {
      timeout: 30000,
      annotations: [],
      expectedStatus: 'passed',
      projectId: 'chromium',
      projectName: 'chromium',
      results: [
        {
          workerIndex: 0,
          parallelIndex: 0,
          status: 'passed',
          duration: 523,
          errors: [],
          stdout: [],
          stderr: [],
          retry: 0,
          startTime: '2026-09-23T03:12:57.612Z',
          annotations: [],
          attachments: [],
        },
      ],
      status: 'expected',
    },
  ],
  id: 'e1c1af90105307fa98a3-0ad2417084968904e3d0',
  file: 'admin-foundation.spec.ts',
  line: 24,
  column: 1,
};

test('real Playwright report schema joins an execution to the complete list', () => {
  const actual = {
    suites: [{ title: 'admin-foundation.spec.ts', specs: [realPlaywrightSpec], suites: [] }],
    errors: [],
  };
  const listed = structuredClone(actual);
  listed.suites[0].specs[0].tests[0].results = [];
  listed.suites[0].specs[0].tests[0].status = 'skipped';
  assert.deepEqual(testIdentities(actual, true), testIdentities(listed));
  assert.throws(() => testIdentities(listed, true), /no execution result/);
});

function scopeFixture(files = ['README.md']) {
  const identity = {
    sourceHeadSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    candidateSha: 'c'.repeat(40),
    treeSha: 'd'.repeat(40),
    workflowRunId: '1',
    attempt: '1',
    candidateKind: 'pull-request-merge',
  };
  const engineeringProof = engineeringDomainProof(process.cwd());
  return {
    identity,
    scope: {
      engineeringProof,
      schemaVersion: 1,
      identity,
      files,
      classification: classifyChangedFiles(files, { engineeringProof }),
      proof: 'verified',
      problem: null,
    },
  };
}

test('Git diff keeps deleted paths and both sides of renames', () => {
  assert.deepEqual(
    changedPathsFromNameStatus('D\0backend/Removed.java\0R100\0src/old.vue\0docs/new.md\0M\0README.md\0'),
    ['README.md', 'backend/Removed.java', 'docs/new.md', 'src/old.vue'],
  );
  assert.throws(() => changedPathsFromNameStatus('R100\0src/only-one.vue\0'), /Truncated/);
});

test('PR classification verifies exact merge parents and falls back when proof is absent', () => {
  const { identity } = scopeFixture();
  const git = (args) =>
    args[0] === 'rev-parse'
      ? args.at(-1).replace('^{commit}', '')
      : args[0] === 'show'
        ? `${identity.baseSha} ${identity.sourceHeadSha}`
        : 'M\0README.md\0';
  assert.equal(changeScope({ pull_request: {} }, identity, git).classification.docsOnly, true);
  const wrong = (args) => (args[0] === 'show' ? `${identity.baseSha} ${'f'.repeat(40)}` : git(args));
  assert.equal(changeScope({ pull_request: {} }, identity, wrong).classification.full, true);
  assert.equal(changeScope({}, { ...identity, baseSha: '0'.repeat(40) }, git).classification.full, true);
});

test('a domain is n/a only with verified classification and explicitly skipped dependent jobs', () => {
  const { scope, identity } = scopeFixture();
  const needs = {
    scope: { result: 'success' },
    formatting: { result: 'success' },
    engineering: { result: scope.classification.engineering ? 'success' : 'skipped' },
    frontend_static: { result: 'skipped' },
    frontend_e2e_1: { result: 'skipped' },
    frontend_e2e_2: { result: 'skipped' },
  };
  assert.equal(domainApplicable(needs, scope, 'frontend', identity), false);
  for (const result of ['failure', 'cancelled', undefined, 'success']) {
    const changed = structuredClone(needs);
    changed.frontend_e2e_1.result = result;
    assert.throws(() => domainApplicable(changed, scope, 'frontend', identity));
  }
  assert.throws(() => verifyScope(scope, { ...identity, candidateSha: 'wrong' }), /different candidateSha/);
  assert.throws(
    () => verifyScope({ ...scope, classification: { ...scope.classification, frontend: true } }, identity),
    /complete diff/,
  );
});

test('applicable domains and fallback scopes cannot turn missing execution into n/a', () => {
  const { scope, identity } = scopeFixture(['src/example.vue']);
  const needs = {
    scope: { result: 'success' },
    formatting: { result: 'success' },
    engineering: { result: scope.classification.engineering ? 'success' : 'skipped' },
    frontend_static: { result: 'success' },
    frontend_e2e_1: { result: 'success' },
    frontend_e2e_2: { result: 'skipped' },
  };
  assert.throws(() => domainApplicable(needs, scope, 'frontend', identity));
  const fallback = { ...scope, proof: 'fallback', files: [], classification: classifyChangedFiles([]) };
  assert.throws(() => domainApplicable(needs, fallback, 'frontend', identity));
});

test('engineering artifacts require reviewed scope, complete test inventory and the exact candidate', () => {
  const { scope, identity } = scopeFixture(['scripts/task-batch.mjs']);
  const metadata = {
    ...identity,
    status: 'success',
    engineeringTests: scriptTestFiles(process.cwd(), 'engineering'),
    engineeringResults: {
      runId: 'run',
      files: scriptTestFiles(process.cwd(), 'engineering'),
      summary: { tests: 1, suites: 0, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 },
    },
    phases: [{ name: 'engineering-tests', runId: 'run', command: ['npm', 'run', 'test:engineering'], exitCode: 0 }],
  };
  verifyEngineeringEvidence(scope, metadata, identity);
  for (const mutate of [
    (x) => x.engineeringTests.pop(),
    (x) => x.phases[0].command.push('--skip'),
    (x) => (x.phases[0].exitCode = 1),
    (x) => (x.candidateSha = 'wrong'),
    (x) => (x.engineeringResults.runId = 'stale'),
    (x) => (x.engineeringResults.summary.skipped = 1),
    (x) => (x.engineeringResults.summary.tests = 0),
    (x) => x.engineeringResults.files.pop(),
  ]) {
    const broken = structuredClone(metadata);
    mutate(broken);
    assert.throws(() => verifyEngineeringEvidence(scope, broken, identity));
  }
});

test('engineering cannot be falsely skipped or substituted by a different scope on the same SHA', () => {
  const { scope, identity } = scopeFixture(['scripts/task-batch.mjs']);
  const needs = Object.fromEntries(
    ['scope', 'formatting', 'engineering', 'frontend_static', 'frontend_e2e_1', 'frontend_e2e_2'].map((job) => [
      job,
      { result: 'success' },
    ]),
  );
  assert.equal(domainApplicable(needs, scope, 'frontend', identity), true);
  for (const result of ['skipped', 'failure', 'cancelled', undefined]) {
    const changed = structuredClone(needs);
    changed.engineering.result = result;
    assert.throws(() => domainApplicable(changed, scope, 'frontend', identity), /Engineering execution/);
  }
  assert.throws(
    () => verifyScope({ ...scope, classification: { ...scope.classification, engineering: false } }, identity),
    /complete diff/,
  );
  assert.throws(
    () =>
      verifyScope({ ...scope, engineeringProof: { ...scope.engineeringProof, fingerprint: 'different' } }, identity),
    /Engineering input proof/,
  );
  assert.throws(
    () =>
      verifyEngineeringEvidence(
        scope,
        {
          ...identity,
          status: 'success',
          engineeringTests: scriptTestFiles(process.cwd(), 'engineering'),
          engineeringResults: {
            runId: 'run',
            files: scriptTestFiles(process.cwd(), 'engineering'),
            summary: { tests: 1, suites: 0, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 },
          },
          phases: [],
        },
        identity,
      ),
    /Missing engineering/,
  );
});
