import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { backendUploads, emitBackendUploads, CI_EVIDENCE_ROOT } from './ci-report-contract.mjs';
import { BACKEND_CONTRACT, BACKEND_COMMAND, collectBackendEvidence } from './ci-backend-equivalence.mjs';
import { tryReuse } from './ci-equivalence.mjs';
import { verifyBackendEvidence } from './ci-quality-evidence.mjs';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-backend-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (p, v) => {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), v);
  };
  put('backend/src/test/java/example/OneTest.java', 'class OneTest { @Test void works() {} }');
  put(
    'backend/target/surefire-reports/TEST-example.OneTest.xml',
    '<testsuite tests="1" failures="0" errors="0" skipped="0"><testcase name="works"/></testsuite>',
  );
  put('backend/target/classes/example/One.class', 'class');
  put('backend/target/test-classes/example/OneTest.class', 'test');
  put(
    'backend/target/site/jacoco/jacoco.xml',
    '<report><class name="example/One"/><counter type="LINE" missed="0" covered="1"/></report>',
  );
  put('backend/target/site/jacoco/jacoco.csv', 'GROUP,PACKAGE,CLASS\nproject,example,One\n');
  put('backend/target/site/jacoco/index.html', '<html>Coverage</html>');
  put('backend/target/jacoco.exec', 'execution');
  put('backend/target/checkstyle-result.xml', '<checkstyle version="1"/>');
  put('backend/target/spotbugsXml.xml', '<BugCollection/>');
  put(
    'coverage/ci-evidence/metadata.json',
    JSON.stringify({
      phases: [
        {
          name: 'backend-quality',
          command: BACKEND_COMMAND,
          exitCode: 0,
          startedAt: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    }),
  );
  const directory = path.join(root, 'coverage/ci-evidence');
  const evidence = collectBackendEvidence(directory, root);
  return { root, directory, evidence, put };
}
function proof() {
  return {
    version: 1,
    contract: BACKEND_CONTRACT,
    job: 'backend_full',
    platform: ['linux', 'x64', 'ubuntu24'],
    resources: 'github-hosted-linux-x64-4cpu-16gb-functional-v1',
    image: ['ubuntu24', '2026'],
    kernel: 'kernel',
    node: ['v22.23.3', 'a'.repeat(64)],
    java: { content: 'a'.repeat(64) },
    maven: { content: 'a'.repeat(64) },
    packages: 'a'.repeat(64),
    systemFiles: 'a'.repeat(64),
    environment: 'a'.repeat(64),
    inputs: 'a'.repeat(64),
    docker: { server: 'exact' },
    dependencies: 'a'.repeat(64),
    images: [
      { reference: 'mysql:8.0', id: 'sha256:' + 'a'.repeat(64), repoDigests: ['mysql@sha256:' + 'b'.repeat(64)] },
    ],
  };
}
function provenance(evidence) {
  const p = proof();
  const parents = ['base', 'task'],
    repository = 'owner/repo';
  const original = {
    job: 'backend_full',
    eventName: 'pull_request',
    attempt: '1',
    status: 'success',
    sourceHeadSha: 'task',
    baseSha: 'base',
    treeSha: 'tree',
    candidateSha: 'c'.repeat(40),
    workflowRunId: '123',
    phases: [{ name: 'backend-quality', command: BACKEND_COMMAND, exitCode: 0 }],
    backendEvidence: evidence,
    environmentProof: p,
  };
  return {
    original,
    current: {
      job: 'backend_full',
      eventName: 'push',
      attempt: '1',
      sourceHeadSha: 'main',
      candidateSha: 'main',
      baseSha: 'base',
      treeSha: 'tree',
    },
    parents,
    repository,
    proof: p,
    run: {
      id: 123,
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success',
      run_attempt: 1,
      repository: { full_name: repository },
      path: '.github/workflows/quality.yml',
      head_sha: 'task',
      run_number: 1,
    },
    pull: {
      number: 1,
      state: 'closed',
      merged: true,
      merged_at: 'date',
      merge_commit_sha: 'main',
      base: { ref: 'main', repo: { full_name: repository } },
      head: { sha: 'task', repo: { full_name: repository } },
    },
    commit: { sha: original.candidateSha, tree: { sha: 'tree' }, parents: parents.map((sha) => ({ sha })) },
  };
}

function copyUpload(root, relative, destination) {
  assert.ok(existsSync(path.join(root, relative)), 'Upload source missing');
  assert.ok(readdirSync(path.join(root, relative)).length, 'Upload source empty');
  cpSync(path.join(root, relative), destination, { recursive: true });
}
for (const scenario of ['fresh-success', 'reused-success', 'fallback-success', 'fresh-failure'])
  test(`report chain ${scenario}: collection -> selection -> upload -> aggregate`, async (t) => {
    const f = fixture(t),
      p = provenance(f.evidence),
      output = path.join(f.root, 'github-output');
    let metadata = { ...p.original, backendEvidence: f.evidence };
    if (scenario === 'reused-success') {
      metadata = {
        ...p.original,
        ...p.current,
        workflowRunId: '456',
        execution: 'reused',
        environmentProof: p.proof,
        reusedFrom: p,
      };
      rmSync(path.join(f.root, 'backend/target'), { recursive: true }); // the exact main condition missed previously
    }
    if (scenario === 'fallback-success') {
      writeFileSync(
        path.join(f.directory, 'metadata.json'),
        JSON.stringify({ ...p.current, phases: [], workflowRunId: '456' }),
      );
      const reused = await tryReuse(
        f.directory,
        {
          GITHUB_JOB: 'backend_full',
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_RUN_ID: '456',
          GITHUB_REPOSITORY: p.repository,
        },
        {
          backendRuntime: () => ({ fixture: true }),
          parents: () => p.parents,
          api: () => {
            throw Error('source API unavailable');
          },
        },
      );
      assert.equal(reused, false); // original Maven path subsequently produces the complete fixture reports
      metadata = { ...p.original, eventName: 'push', backendEvidence: f.evidence };
    }
    if (scenario === 'fresh-failure') {
      metadata = { ...p.original, status: 'failure', phases: [{ name: 'backend-quality', exitCode: 1 }] };
      delete metadata.backendEvidence;
      rmSync(path.join(f.directory, 'reports'), { recursive: true });
      writeFileSync(
        path.join(f.root, 'backend/target/surefire-reports/TEST-example.OneTest.xml'),
        '<testsuite tests="1" failures="1" errors="0" skipped="0"><testcase><failure/></testcase></testsuite>',
      );
    }
    writeFileSync(path.join(f.directory, 'metadata.json'), JSON.stringify(metadata));
    const sources = await emitBackendUploads(f.root, { GITHUB_OUTPUT: output });
    const received = path.join(f.root, 'received');
    mkdirSync(received);
    copyUpload(f.root, sources.full, path.join(received, 'ci-backend-full'));
    copyUpload(f.root, sources.standalone, path.join(received, 'ci-backend-reports'));
    const m = JSON.parse(readFileSync(path.join(received, 'ci-backend-full/metadata.json')));
    const aggregate = () =>
      verifyBackendEvidence(m, f.evidence.summary, path.join(received, 'ci-backend-full'), f.root);
    if (scenario === 'fresh-failure') {
      assert.throws(aggregate, /did not finish/);
      assert.match(
        readFileSync(path.join(received, 'ci-backend-reports/TEST-example.OneTest.xml'), 'utf8'),
        /<failure/,
      );
    } else {
      assert.equal(aggregate().tests, 1);
      assert.equal(
        readFileSync(path.join(received, 'ci-backend-reports/TEST-example.OneTest.xml'), 'utf8'),
        readFileSync(path.join(received, 'ci-backend-full/reports/surefire/TEST-example.OneTest.xml'), 'utf8'),
      );
    }
    assert.ok(readFileSync(output, 'utf8').includes(`backend_reports_path=${sources.standalone}`));
  });
test('missing or empty standalone upload blocks even when the aggregate packet exists', (t) => {
  const f = fixture(t),
    s = backendUploads({});
  rmSync(path.join(f.root, s.standalone), { recursive: true });
  assert.throws(() => copyUpload(f.root, s.standalone, path.join(f.root, 'uploaded')), /missing/);
  mkdirSync(path.join(f.root, s.standalone));
  assert.throws(() => copyUpload(f.root, s.standalone, path.join(f.root, 'uploaded')), /empty/);
});
test('tampered replay cannot emit a valid standalone report source; full failure packet stays available', async (t) => {
  const f = fixture(t),
    p = provenance(f.evidence),
    output = path.join(f.root, 'output');
  writeFileSync(
    path.join(f.directory, 'metadata.json'),
    JSON.stringify({ ...p.original, ...p.current, execution: 'reused', environmentProof: p.proof, reusedFrom: p }),
  );
  writeFileSync(path.join(f.directory, 'reports/execution'), 'corrupted');
  await assert.rejects(emitBackendUploads(f.root, { GITHUB_OUTPUT: output }), /Damaged/);
  assert.equal(readFileSync(output, 'utf8'), `backend_full_path=${CI_EVIDENCE_ROOT}\n`);
});
test('unknown execution mode never selects a permissive upload path', () =>
  assert.throws(() => backendUploads({ execution: 'assumed' }), /Unknown/));
test('workflow consumes both catalog outputs and retains required uploads, error policy and retention', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
    .split('  backend_full:')[1]
    .split('\n  backend:')[0];
  assert.match(workflow, /id: report_sources\s+if: always\(\)\s+run: node scripts\/ci-report-contract.mjs/);
  for (const [name, output] of [
    ['ci-backend-full', 'backend_full_path'],
    ['ci-backend-reports', 'backend_reports_path'],
  ]) {
    const block = workflow.split('name: ' + name)[1].split('\n      - ')[0];
    assert.ok(block.includes('steps.report_sources.outputs.' + output));
    assert.match(block, /if-no-files-found: error/);
    assert.match(block, /retention-days: 14/);
  }
  assert.ok(!workflow.includes('backend/target/surefire-reports/'));
});

for (const reused of [false, true])
  test(`standalone CLI emits verified upload outputs without preloaded imports or node_modules, reused=${reused}`, (t) => {
    const f = fixture(t),
      p = provenance(f.evidence),
      file = path.join(f.root, 'output');
    const m = reused
      ? { ...p.original, ...p.current, execution: 'reused', environmentProof: p.proof, reusedFrom: p }
      : { ...p.original };
    writeFileSync(path.join(f.directory, 'metadata.json'), JSON.stringify(m));
    if (reused) rmSync(path.join(f.root, 'backend/target'), { recursive: true });
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-report-contract.mjs', import.meta.url))], {
      cwd: f.root,
      env: { ...process.env, GITHUB_OUTPUT: file, CI_EVIDENCE_DIR: f.directory },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readFileSync(file, 'utf8').includes('backend_reports_path=' + backendUploads(m).standalone));
  });
test('custom shared evidence root follows the actual CI configuration; escaping paths are refused', async (t) => {
  const f = fixture(t),
    output = path.join(f.root, 'out');
  const result = await emitBackendUploads(f.root, {
    GITHUB_OUTPUT: output,
    CI_EVIDENCE_DIR: path.join(f.root, 'custom-evidence'),
  });
  assert.equal(result.full, 'custom-evidence');
  await assert.rejects(
    emitBackendUploads(f.root, { GITHUB_OUTPUT: output, CI_EVIDENCE_DIR: path.dirname(f.root) }),
    /inside/,
  );
});
