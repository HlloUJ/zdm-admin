import assert from 'node:assert/strict';
import test from 'node:test';
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
import { executionEnvironment, validateProvenance, validateReusedMetadata, tryReuse } from './ci-equivalence.mjs';
import { main as legacyPreviewMain } from './dev-task.mjs';
import { waitQuality } from './wait-quality.mjs';
import { assetKind, preserveAssets, previewContract } from './task-completion.mjs';

function fixture() {
  const parents = ['base', 'task'];
  const repository = 'owner/repo';
  const proof = {
    version: 1,
    contract: 'reviewed-frontend-environment-v1',
    job: 'frontend_e2e_1',
    image: ['Ubuntu', '20260101'],
    platform: ['linux', 'x64', 'kernel'],
    hardware: [4, 'cpu', 1000],
    node: ['v22', 'hash'],
    ...Object.fromEntries(
      ['packages', 'inputs', 'systemFiles', 'environment', 'browser'].map((key) => [key, 'a'.repeat(64)]),
    ),
  };
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
    phases: ['npm-ci', 'chrome-install', 'e2e-1'].map((name) => ({ name, exitCode: 0 })),
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
