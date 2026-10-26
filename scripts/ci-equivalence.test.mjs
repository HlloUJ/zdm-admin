import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  executionEnvironment,
  readCommitParents,
  validateProvenance,
  validateReusedMetadata,
  tryReuse,
} from './ci-equivalence.mjs';
import { environmentProofFromSnapshot, validateEnvironmentProof } from './ci-equivalence-environment.mjs';
import { verifyFrontendEvidence } from './ci-quality-evidence.mjs';
import { SOURCE_GUARD_TESTS } from './script-test-plan.mjs';
import { main as legacyPreviewMain } from './dev-task.mjs';
import { waitQuality } from './wait-quality.mjs';
import { assetKind, preserveAssets, previewContract } from './task-completion.mjs';

function snapshot() {
  return {
    runnerEnvironment: 'github-hosted',
    platform: 'linux',
    arch: 'x64',
    imageOS: 'ubuntu24',
    imageVersion: 'ghcr.io/hllouj/zdm-admin-browser@sha256:' + 'c'.repeat(64),
    container: { image: 'ghcr.io/hllouj/zdm-admin-browser@sha256:' + 'c'.repeat(64), origin: 'd'.repeat(64) },
    kernel: 'kernel',
    hardware: { logicalCpus: 4, cpuModel: 'AMD', totalMemoryBytes: 16_766_414_848 },
    node: ['v22.23.3', 'a'.repeat(64)],
    ...Object.fromEntries(
      ['inputs', 'environment', 'packages', 'systemFiles', 'browser', 'sharding'].map((k) => [k, 'a'.repeat(64)]),
    ),
  };
}
function fixture() {
  const parents = ['base', 'task'];
  const repository = 'owner/repo';
  const proof = environmentProofFromSnapshot('frontend_e2e_1', snapshot());
  const current = {
    eventName: 'push',
    attempt: '1',
    sourceHeadSha: 'main',
    candidateSha: 'main',
    baseSha: 'base',
    treeSha: 'same-tree',
  };
  const original = {
    eventName: 'pull_request',
    attempt: '1',
    status: 'success',
    sourceHeadSha: 'task',
    baseSha: 'base',
    treeSha: 'same-tree',
    candidateSha: 'synthetic',
    workflowRunId: '123',
    environmentProof: proof,
    job: 'frontend_e2e_1',
    phases: ['npm-ci', 'browser-image', 'chrome-browser', 'chrome-dependencies', 'e2e-1'].map((name) => ({
      name,
      exitCode: 0,
    })),
  };
  const run = {
    id: 123,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    repository: { full_name: repository },
    path: '.github/workflows/quality.yml',
    head_sha: 'task',
  };
  const pull = {
    state: 'closed',
    merged: true,
    merge_commit_sha: 'main',
    base: { ref: 'main', repo: { full_name: repository } },
    head: { sha: 'task', repo: { full_name: repository } },
  };
  const commit = { sha: 'synthetic', tree: { sha: 'same-tree' }, parents: parents.map((sha) => ({ sha })) };
  return { current, original, run, pull, commit, repository, parents, proof };
}
test('old monolithic Chrome preparation cannot authorize the split preparation workflow', () => {
  const f = fixture();
  f.original.phases = ['npm-ci', 'chrome-install', 'e2e-1'].map((name) => ({ name, exitCode: 0 }));
  assert.throws(() => validateProvenance(f), /phase inventory/);
});
test('exact same-repository merged candidate and installed runtime may reuse reports', () => {
  const f = fixture();
  assert.equal(validateProvenance(f), true);
  validateReusedMetadata({ ...f.original, ...f.current, environmentProof: f.proof, reusedFrom: f });
});
for (const [name, change] of [
  [
    'foreign run',
    (f) => {
      f.run.repository.full_name = 'attacker/repo';
    },
  ],
  [
    'fork',
    (f) => {
      f.pull.head.repo.full_name = 'fork/repo';
    },
  ],
  [
    'unmerged PR',
    (f) => {
      f.pull.merged = false;
    },
  ],
  [
    'other merge',
    (f) => {
      f.pull.merge_commit_sha = 'other';
    },
  ],
  [
    'old main',
    (f) => {
      f.current.baseSha = 'advanced';
    },
  ],
  [
    'squash',
    (f) => {
      f.parents.pop();
    },
  ],
  [
    'other task',
    (f) => {
      f.run.head_sha = 'other';
    },
  ],
  [
    'run retry',
    (f) => {
      f.run.run_attempt = 2;
    },
  ],
  [
    'current retry',
    (f) => {
      f.current.attempt = '2';
    },
  ],
  [
    'source retry',
    (f) => {
      f.original.attempt = '2';
    },
  ],
  [
    'failed run',
    (f) => {
      f.run.conclusion = 'failure';
    },
  ],
  [
    'pending run',
    (f) => {
      f.run.status = 'in_progress';
    },
  ],
  [
    'wrong workflow',
    (f) => {
      f.run.path = '.github/workflows/other.yml';
    },
  ],
  [
    'wrong source event',
    (f) => {
      f.run.event = 'workflow_dispatch';
    },
  ],
  [
    'wrong tree',
    (f) => {
      f.original.treeSha = 'other';
    },
  ],
  [
    'wrong commit tree',
    (f) => {
      f.commit.tree.sha = 'other';
    },
  ],
  [
    'wrong commit parents',
    (f) => {
      f.commit.parents.reverse();
    },
  ],
  [
    'changed installed inputs',
    (f) => {
      f.original.environmentProof = { ...f.proof, packages: 'changed' };
    },
  ],
  [
    'missing environment',
    (f) => {
      delete f.original.environmentProof;
    },
  ],
  [
    'failed phase',
    (f) => {
      f.original.phases[0].exitCode = 1;
    },
  ],
  [
    'missing phase',
    (f) => {
      f.original.phases = [];
    },
  ],
  [
    'chained reuse',
    (f) => {
      f.original.reusedFrom = {};
    },
  ],
])
  test(`CI equivalence rejects ${name}`, () => {
    const f = fixture();
    change(f);
    assert.throws(() => validateProvenance(f));
  });
test('replay cannot fabricate phases or test results', () => {
  const f = fixture();
  const m = { ...f.original, ...f.current, environmentProof: f.proof, reusedFrom: f };
  m.phases = [{ name: 'e2e-1', exitCode: 0, fabricated: true }];
  assert.throws(() => validateReusedMetadata(m));
});
test('event identities and tokens cannot influence eligible test execution', () => {
  assert.deepEqual(
    executionEnvironment({
      PATH: '/bin',
      CI: 'true',
      GH_TOKEN: 'secret',
      GITHUB_SHA: 'pr',
      GITHUB_RUN_ID: '1',
      PLAYWRIGHT_CHANNEL: 'chrome',
    }),
    { CI: 'true', PATH: '/bin', PLAYWRIGHT_CHANNEL: 'chrome' },
  );
});
test('missing runtime proof falls back to normal checks without fabricating metadata', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-miss-'));
  t.after(() => rmSync(root, { recursive: true }));
  const output = path.join(root, 'output');
  assert.equal(await tryReuse(root, { GITHUB_JOB: 'backend_full', GITHUB_OUTPUT: output }), false);
  assert.equal(readFileSync(output, 'utf8'), 'reused=false\n');
  assert.equal(readdirSync(root).length, 1);
});
test('preservation retains source, failure history and changed assets without duplicate blobs', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'asset-preserve-'));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(path.join(root, '.task-verification'));
  const a = path.join(root, '.task-verification/failed.log');
  const b = path.join(root, '.task-verification/passed.log');
  writeFileSync(a, 'failure');
  writeFileSync(b, 'success');
  const files = ['.task-verification/failed.log', '.task-verification/passed.log'].map((file) => ({
    file,
    kind: 'generated-output',
  }));
  const dest = path.join(root, 'retained');
  const first = preserveAssets(root, dest, files);
  assert.equal(first.manifest, preserveAssets(root, dest, files).manifest);
  assert.equal(readdirSync(path.join(dest, 'blobs')).length, 2);
  writeFileSync(b, 'new candidate');
  preserveAssets(root, dest, files);
  assert.equal(readdirSync(path.join(dest, 'blobs')).length, 3);
  assert.equal(readFileSync(a, 'utf8'), 'failure');
});
test('unknown/private assets and symlink replacement block preservation', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'asset-private-'));
  t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(path.join(root, '.env'), 'secret');
  const regular = { isSymbolicLink: () => false, isFile: () => true };
  assert.equal(assetKind('.env', regular, root), 'blocked');
  assert.equal(assetKind('.task-runtime/data-environment.json', regular, root), 'blocked');
  assert.equal(assetKind('my-document.md', regular, root), 'blocked');
  assert.throws(() => preserveAssets(root, path.join(root, 'retained'), [{ file: '.env', kind: 'blocked' }]));
  symlinkSync(path.join(root, '.env'), path.join(root, 'link'));
  assert.throws(() => preserveAssets(root, path.join(root, 'retained'), [{ file: 'link', kind: 'generated-output' }]));
});
test('preview contract rejects integration data, missing backups and foreign registry', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'preview-contract-'));
  t.after(() => rmSync(root, { recursive: true }));
  const backup = path.join(root, 'backup');
  writeFileSync(backup, 'retained');
  const record = {
    version: 1,
    repository: root,
    profile: {
      status: 'ready',
      database: 'zdm_task_' + 'a'.repeat(16),
      mediaVolume: 'zdm-task-media-' + 'a'.repeat(16),
      backupFile: backup,
      password: 'never-print',
    },
  };
  const result = previewContract(record, root);
  assert.equal(result.backupRetained, true);
  assert.ok(!JSON.stringify(result).includes('never-print'));
  for (const mutate of [
    (r) => {
      r.profile.database = 'zdm_admin';
    },
    (r) => {
      r.profile.backupFile = '/missing';
    },
    (r) => {
      r.repository = '/foreign';
    },
  ]) {
    const changed = structuredClone(record);
    mutate(changed);
    assert.throws(() => previewContract(changed, root));
  }
});

test('one CI wait reconnects the same run after transport failure without rerunning anything', async () => {
  let reads = 0;
  const states = [];
  const result = await waitQuality({
    runId: 12,
    expectedHead: 'a'.repeat(40),
    readRun: async () => {
      if (++reads === 1) throw new Error('EOF');
      return {
        id: 12,
        head_sha: 'a'.repeat(40),
        run_attempt: 1,
        path: '.github/workflows/quality.yml',
        status: 'completed',
        conclusion: 'success',
      };
    },
    readJobs: async () => ['Frontend quality', 'Backend quality'].map((name) => ({ name, conclusion: 'success' })),
    wait: async () => {},
    report: (value) => states.push(value),
  });
  assert.equal(result.attempt, 1);
  assert.equal(reads, 2);
  assert.equal(states.length, 2);
});

test('CI wait rejects failure, retries, another candidate and missing required gate', async () => {
  const normal = {
    id: 12,
    head_sha: 'a'.repeat(40),
    run_attempt: 1,
    path: '.github/workflows/quality.yml',
    status: 'completed',
    conclusion: 'success',
  };
  for (const change of [{ conclusion: 'failure' }, { run_attempt: 2 }, { head_sha: 'b'.repeat(40) }, {}]) {
    await assert.rejects(
      waitQuality({
        runId: 12,
        expectedHead: 'a'.repeat(40),
        readRun: async () => ({ ...normal, ...change }),
        readJobs: async () => [],
        wait: async () => {},
        report: () => {},
      }),
    );
  }
});

for (const scenario of [
  'reuse',
  'merged-pr-array-empty',
  'disabled',
  'changed-environment',
  'network-failure',
  'latest-run-failed',
  'missing-report',
]) {
  test(`end-to-end CI acquisition ${scenario} preserves provenance or executes normal fallback`, async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ci-acquisition-'));
    t.after(() => rmSync(root, { recursive: true }));
    const currentDir = path.join(root, 'current');
    mkdirSync(currentDir);
    const f = fixture();
    f.original.candidateSha = 'c'.repeat(40);
    f.commit.sha = f.original.candidateSha;
    f.pull.number = 5;
    f.pull.merged_at = '2026-01-01T00:00:00Z';
    f.run.pull_requests = scenario === 'merged-pr-array-empty' ? [] : [{ number: 5 }];
    f.run.run_number = 12;
    const current = {
      ...f.current,
      job: 'frontend_e2e_1',
      workflowRunId: '456',
      phases: [{ name: 'npm-ci', exitCode: 0 }],
      startedAt: 'current-time',
    };
    writeFileSync(path.join(currentDir, 'metadata.json'), JSON.stringify(current));
    const env = {
      GITHUB_JOB: 'frontend_e2e_1',
      CI_EQUIVALENCE_DISABLED: scenario === 'disabled' ? 'true' : 'false',
      GITHUB_RUN_ID: '456',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: f.repository,
      GITHUB_OUTPUT: path.join(root, 'output'),
    };
    const proof = scenario === 'changed-environment' ? { ...f.proof, inputs: 'b'.repeat(64) } : f.proof;
    const report = JSON.stringify({
      suites: [
        {
          specs: [
            {
              id: 'original-test',
              tests: [
                {
                  projectName: 'chromium',
                  expectedStatus: 'passed',
                  status: 'expected',
                  results: [{ status: 'passed', retry: 0 }],
                },
              ],
            },
          ],
        },
      ],
      errors: [],
    });
    const reused = await tryReuse(currentDir, env, {
      environmentProof: () => proof,
      parents: () => f.parents,
      staging: path.join(root, 'staging'),
      api: (suffix) => {
        if (scenario === 'network-failure') throw new Error('EOF');
        if (suffix.endsWith('/pulls')) return [f.pull];
        if (suffix === 'pulls/5') return f.pull;
        if (suffix.startsWith('actions/workflows'))
          return {
            workflow_runs:
              scenario === 'latest-run-failed' ? [{ ...f.run, run_number: 13, conclusion: 'failure' }, f.run] : [f.run],
          };
        if (suffix.includes('/jobs?'))
          return { jobs: ['Frontend quality', 'Backend quality'].map((name) => ({ name, conclusion: 'success' })) };
        if (suffix.startsWith('git/commits/')) return f.commit;
        throw new Error('Unexpected API ' + suffix);
      },
      download: () => {
        if (scenario === 'missing-report') throw new Error('Artifact missing');
        const target = path.join(root, 'staging');
        writeFileSync(path.join(target, 'metadata.json'), JSON.stringify(f.original));
        writeFileSync(path.join(target, 'report.json'), report);
      },
    });
    assert.equal(reused, ['reuse', 'merged-pr-array-empty'].includes(scenario));
    const actual = JSON.parse(readFileSync(path.join(currentDir, 'metadata.json')));
    if (reused) {
      assert.equal(readFileSync(path.join(currentDir, 'report.json'), 'utf8'), report);
      assert.equal(actual.workflowRunId, '456');
      assert.equal(actual.reusedFrom.original.workflowRunId, '123');
      assert.equal(actual.startedAt, 'current-time');
      validateReusedMetadata(actual);
    } else {
      assert.equal(actual.workflowRunId, current.workflowRunId);
      assert.equal(actual.reusedFrom, undefined);
    }
    assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), `reused=${reused}\n`);
  });
}

test('legacy preview cannot start against integration data through any frontend/full entry', async () => {
  for (const args of [[], ['--mode', 'full'], ['--mode', 'frontend'], ['--temporary']]) {
    await assert.rejects(legacyPreviewMain(args), /旧启动器未实现长期预览隔离数据契约/);
  }
});

test('CI wait reconnects required-gate query without restarting the run', async () => {
  let calls = 0;
  const result = await waitQuality({
    runId: 12,
    expectedHead: 'a'.repeat(40),
    readRun: async () => ({
      id: 12,
      head_sha: 'a'.repeat(40),
      run_attempt: 1,
      path: '.github/workflows/quality.yml',
      status: 'completed',
      conclusion: 'success',
    }),
    readJobs: async () => {
      if (++calls === 1) throw new Error('EOF');
      return ['Frontend quality', 'Backend quality'].map((name) => ({ name, conclusion: 'success' }));
    },
    wait: async () => {},
    report: () => {},
  });
  assert.equal(result.conclusion, 'success');
  assert.equal(calls, 2);
});

test('asset preservation rejects a preexisting nonprivate destination', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'asset-access-'));
  t.after(() => rmSync(root, { recursive: true }));
  const dest = path.join(root, 'public');
  mkdirSync(dest);
  chmodSync(dest, 0o755);
  assert.throws(() => preserveAssets(root, dest, []), /owner-only/);
});

test('actual depth-one CI checkout retains exact ordered merge parents without fetching', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-shallow-merge-'));
  t.after(() => rmSync(root, { recursive: true }));
  const source = path.join(root, 'source');
  const shallow = path.join(root, 'shallow');
  const run = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  mkdirSync(source);
  run(source, 'init', '--initial-branch=main');
  run(source, 'config', 'user.name', 'CI regression');
  run(source, 'config', 'user.email', 'ci@example.invalid');
  run(source, 'commit', '--allow-empty', '-m', 'base');
  run(source, 'checkout', '-b', 'task');
  run(source, 'commit', '--allow-empty', '-m', 'task');
  const task = run(source, 'rev-parse', 'HEAD');
  run(source, 'checkout', 'main');
  run(source, 'commit', '--allow-empty', '-m', 'main advance');
  const base = run(source, 'rev-parse', 'HEAD');
  run(source, 'merge', '--no-ff', '-m', 'merge task', 'task');
  run(root, 'clone', '--depth=1', `file://${source}`, shallow);
  assert.equal(run(shallow, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.equal(run(shallow, 'show', '-s', '--format=%P', 'HEAD'), '');
  assert.deepEqual(readCommitParents(shallow), [base, task]);
  assert.equal(run(shallow, 'rev-parse', '--is-shallow-repository'), 'true');
});

for (const job of ['formatting', 'frontend_static', 'frontend_e2e_1', 'frontend_e2e_2']) {
  test(`${job} accepts CPU-vendor and small capacity differences within the reviewed resource class`, () => {
    const a = snapshot();
    const b = structuredClone(a);
    b.hardware.cpuModel = 'Intel';
    b.hardware.totalMemoryBytes += 4096;
    const proof = environmentProofFromSnapshot(job, a);
    assert.deepEqual(environmentProofFromSnapshot(job, b), proof);
    for (const change of [
      (s) => (s.hardware.logicalCpus = 2),
      (s) => (s.hardware.totalMemoryBytes = 8_000_000_000),
      (s) => (s.platform = 'darwin'),
      (s) => (s.arch = 'arm64'),
      (s) => (s.imageOS = 'ubuntu26'),
      (s) => (s.runnerEnvironment = 'self-hosted'),
    ]) {
      const c = structuredClone(a);
      change(c);
      assert.throws(() => environmentProofFromSnapshot(job, c));
    }
  });
  test(`${job} fingerprints exactly its reviewed input domains`, () => {
    const a = snapshot();
    const proof = environmentProofFromSnapshot(job, a);
    for (const field of ['inputs', 'environment']) {
      const b = structuredClone(a);
      b[field] = 'b'.repeat(64);
      assert.notDeepEqual(environmentProofFromSnapshot(job, b), proof);
    }
    const node = structuredClone(a);
    node.node[1] = 'b'.repeat(64);
    assert.notDeepEqual(environmentProofFromSnapshot(job, node), proof);
    for (const field of ['imageVersion', 'kernel', 'packages', 'systemFiles', 'browser']) {
      const b = structuredClone(a);
      if (field === 'imageVersion' && job.startsWith('frontend_e2e')) {
        b.container.image = b.imageVersion = 'ghcr.io/hllouj/zdm-admin-browser@sha256:' + 'e'.repeat(64);
      } else b[field] = ['packages', 'systemFiles', 'browser'].includes(field) ? 'b'.repeat(64) : 'other';
      const affected = job !== 'formatting' && (field !== 'browser' || job.startsWith('frontend_e2e'));
      assert.equal(JSON.stringify(environmentProofFromSnapshot(job, b)) !== JSON.stringify(proof), affected, field);
    }
    for (const field of Object.keys(proof)) {
      const broken = structuredClone(proof);
      delete broken[field];
      assert.throws(() => validateEnvironmentProof(broken, job), field);
    }
    assert.throws(() => validateEnvironmentProof({ ...proof, version: 1 }, job));
    assert.throws(() => validateEnvironmentProof({ ...proof, hardware: ['CPU', 4, 16] }, job));
  });
}

function completeFrontendResult(kind) {
  const files = kind === 'unit' ? ['unit-module-id'] : SOURCE_GUARD_TESTS;
  const ids = files.map((_, i) => `${kind}-${i}`);
  return {
    schemaVersion: 1,
    kind,
    runId: kind,
    complete: true,
    files,
    completedFiles: files,
    collectedTests: ids,
    suites: [],
    errors: [],
    tests: files.map((file, i) => ({
      id: ids[i],
      file,
      name: ids[i],
      status: 'passed',
      retryCount: 0,
      repeatCount: 0,
      flaky: false,
      expectedFailure: false,
    })),
  };
}
const completeBrowserReport = (ids, executed) => ({
  suites: [
    {
      specs: ids.map((id) => ({
        id,
        tests: [
          {
            projectName: 'chromium',
            ...(executed
              ? { expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0 }] }
              : {}),
          },
        ],
      })),
    },
  ],
  errors: [],
});

test('all four job contracts acquire and replay original reports, then pass the unchanged two-shard aggregate', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-all-job-replay-'));
  t.after(() => rmSync(root, { recursive: true }));
  const groups = [];
  for (const job of ['formatting', 'frontend_static', 'frontend_e2e_1', 'frontend_e2e_2']) {
    const f = fixture();
    const a = snapshot();
    const b = structuredClone(a);
    b.hardware.cpuModel = 'Intel';
    b.hardware.totalMemoryBytes += 4096;
    f.proof = environmentProofFromSnapshot(job, b);
    f.original.environmentProof = environmentProofFromSnapshot(job, a);
    f.original.job = job;
    f.original.candidateSha = 'c'.repeat(40);
    f.commit.sha = f.original.candidateSha;
    f.pull.number = 5;
    f.pull.merged_at = '2026-01-01T00:00:00Z';
    f.run.run_number = 12;
    const names = {
      formatting: ['npm-ci', 'formatting'],
      frontend_static: [
        'npm-ci',
        'frontend-quality',
        'frontend-unit',
        'frontend-source-guards',
        'frontend-build',
        'frontend-test-list',
      ],
      frontend_e2e_1: ['npm-ci', 'browser-image', 'chrome-browser', 'chrome-dependencies', 'e2e-1'],
      frontend_e2e_2: ['npm-ci', 'browser-image', 'chrome-browser', 'chrome-dependencies', 'e2e-2'],
    }[job];
    f.original.phases = names.map((name) => ({
      name,
      exitCode: 0,
      ...(name === 'frontend-unit'
        ? { runId: 'unit', command: ['npm', 'run', 'test:unit'] }
        : name === 'frontend-source-guards'
          ? { runId: 'source-guards', command: ['npm', 'run', 'test:source-guards'] }
          : {}),
    }));
    if (job === 'frontend_static')
      f.original.frontendResults = {
        unit: completeFrontendResult('unit'),
        'source-guards': completeFrontendResult('source-guards'),
      };
    const current = {
      ...f.current,
      job,
      workflowRunId: '456',
      phases: [{ name: 'npm-ci', exitCode: 0 }],
      startedAt: 'current-time',
    };
    const directory = path.join(root, job);
    const staging = path.join(root, job + '-source');
    mkdirSync(directory);
    writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify(current));
    if (job.startsWith('frontend_e2e')) {
      writeFileSync(
        path.join(directory, 'chrome-browser.json'),
        JSON.stringify({ action: 'reused', after: '156.0.8078.47' }),
      );
      writeFileSync(path.join(directory, 'chrome-dependencies.json'), JSON.stringify({ completeDependencies: true }));
    }
    const report = completeBrowserReport(
      job === 'frontend_static' ? ['a', 'b'] : job === 'frontend_e2e_1' ? ['a'] : ['b'],
      job !== 'frontend_static',
    );
    const raw = JSON.stringify(report);
    const result = await tryReuse(
      directory,
      {
        GITHUB_JOB: job,
        GITHUB_RUN_ID: '456',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_REPOSITORY: f.repository,
        GITHUB_OUTPUT: path.join(directory, 'output'),
      },
      {
        environmentProof: () => f.proof,
        environmentObservation: () => b.hardware,
        parents: () => f.parents,
        staging,
        api: (suffix) => {
          if (suffix.endsWith('/pulls')) return [f.pull];
          if (suffix === 'pulls/5') return f.pull;
          if (suffix.startsWith('actions/workflows')) return { workflow_runs: [f.run] };
          if (suffix.includes('/jobs?'))
            return { jobs: ['Frontend quality', 'Backend quality'].map((name) => ({ name, conclusion: 'success' })) };
          if (suffix.startsWith('git/commits/')) return f.commit;
          throw Error('Unexpected API ' + suffix);
        },
        download: () => {
          writeFileSync(path.join(staging, 'metadata.json'), JSON.stringify(f.original));
          if (job !== 'formatting')
            writeFileSync(path.join(staging, job === 'frontend_static' ? 'all-tests.json' : 'report.json'), raw);
        },
      },
    );
    assert.equal(result, true, job);
    const replay = JSON.parse(readFileSync(path.join(directory, 'metadata.json')));
    validateReusedMetadata(replay);
    assert.equal(replay.execution, 'reused');
    assert.deepEqual(replay.environmentObservation, b.hardware);
    assert.equal(replay.reusedFrom.original.workflowRunId, '123');
    assert.deepEqual(replay.setupPhases, current.phases);
    if (job.startsWith('frontend_e2e')) {
      assert.equal(replay.preparationObservation['chrome-browser.json'].action, 'reused');
      assert.equal(replay.preparationObservation['chrome-dependencies.json'].completeDependencies, true);
    }
    if (job !== 'formatting') {
      assert.equal(
        readFileSync(path.join(directory, job === 'frontend_static' ? 'all-tests.json' : 'report.json'), 'utf8'),
        raw,
      );
      groups.push({ metadata: replay, report: JSON.parse(raw) });
    }
  }
  const needs = Object.fromEntries(
    ['frontend_static', 'frontend_e2e_1', 'frontend_e2e_2'].map((name) => [name, { result: 'success' }]),
  );
  const verify = (items) => {
    for (const group of items) validateReusedMetadata(group.metadata);
    return verifyFrontendEvidence(needs, items);
  };
  assert.equal(verify(groups).testCount, 2);
  assert.equal(verify(groups).shardCount, 2);
  for (const mutate of [
    (g) => (g[2].report.suites[0].specs = []),
    (g) => (g[2].report.suites[0].specs[0].id = 'a'),
    (g) => g[1].report.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 }),
    (g) => (g[1].report.suites[0].specs[0].tests[0].status = 'skipped'),
    (g) => (g[0].metadata.attempt = '2'),
    (g) => g[0].metadata.phases.pop(),
  ]) {
    const broken = structuredClone(groups);
    mutate(broken);
    assert.throws(() => verify(broken));
  }
});

test('automatic wait selection binds event, branch and exact head and refuses ambiguous or missing runs', async () => {
  const { selectQualityRun } = await import('./wait-quality.mjs');
  const head = 'a'.repeat(40);
  const run = { databaseId: 42, headSha: head, event: 'push', headBranch: 'main' };
  const selection = { selector: 'main', branch: 'main', head };
  assert.equal(selectQualityRun([run, { ...run, headSha: 'b'.repeat(40) }], selection), '42');
  for (const change of [{ headBranch: 'other' }, { event: 'pull_request' }, { headSha: 'b'.repeat(40) }])
    assert.throws(() => selectQualityRun([{ ...run, ...change }], selection));
  assert.throws(() => selectQualityRun([run, { ...run, databaseId: 43 }], selection));
  assert.throws(() => selectQualityRun([], selection));
});
