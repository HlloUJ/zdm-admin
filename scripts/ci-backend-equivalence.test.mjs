import { verifyBackendEvidence } from './ci-quality-evidence.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, symlinkSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BACKEND_CONTRACT,
  BACKEND_COMMAND,
  backendExecutionEnvironment,
  validateMavenEntries,
  materializeMaven,
  collectBackendEvidence,
  validateBackendEvidence,
} from './ci-backend-equivalence.mjs';
import { validateProvenance, validateReusedMetadata, tryReuse } from './ci-equivalence.mjs';
const sha = (v) => createHash('sha256').update(v).digest('hex');
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
    'artifact/metadata.json',
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
  const directory = path.join(root, 'artifact');
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
test('backend complete report closure survives archive replay with original timestamps', (t) => {
  const f = fixture(t);
  assert.equal(validateBackendEvidence(f.directory, f.evidence, f.root).tests, 1);
  for (const e of f.evidence.files) utimesSync(path.join(f.directory, e.path), new Date(0), new Date(0));
  assert.equal(validateBackendEvidence(f.directory, f.evidence, f.root).tests, 1);
});
for (const [name, change] of [
  ['missing-report', (f) => rmSync(path.join(f.directory, 'reports/checkstyle'))],
  ['tampered-report', (f) => writeFileSync(path.join(f.directory, 'reports/execution'), 'changed')],
  ['extra-report', (f) => writeFileSync(path.join(f.directory, 'reports/unknown'), 'x')],
  ['false-summary', (f) => f.evidence.summary.tests++],
  ['escaping-report', (f) => (f.evidence.files[0].path = '../other')],
  [
    'skipped-test',
    (f) => {
      const p = path.join(f.directory, 'reports/surefire/TEST-example.OneTest.xml');
      const v = readFileSync(p, 'utf8').replace(
        '<testcase name="works"/>',
        '<testcase name="works"><skipped/></testcase>',
      );
      writeFileSync(p, v);
      const e = f.evidence.files.find((e) => e.path.endsWith('OneTest.xml'));
      e.bytes = Buffer.byteLength(v);
      e.digest = sha(v);
    },
  ],
])
  test(`backend evidence refuses ${name}`, (t) => {
    const f = fixture(t);
    change(f);
    assert.throws(() => validateBackendEvidence(f.directory, f.evidence, f.root));
  });
test('source collection refuses old coverage instead of changing archive timestamps', (t) => {
  const f = fixture(t);
  utimesSync(path.join(f.root, 'backend/target/jacoco.exec'), new Date(0), new Date(0));
  assert.throws(() => collectBackendEvidence(f.directory, f.root), /Stale/);
});
for (const key of [
  'java',
  'maven',
  'docker',
  'packages',
  'kernel',
  'dependencies',
  'images',
  'inputs',
  'environment',
  'node',
])
  test(`backend provenance refuses changed ${key}`, (t) => {
    const f = fixture(t),
      p = provenance(f.evidence);
    p.proof = structuredClone(p.proof);
    if (typeof p.proof[key] === 'string') p.proof[key] = 'b'.repeat(64);
    else if (key === 'images') p.proof[key][0].id = 'sha256:' + 'b'.repeat(64);
    else if (Array.isArray(p.proof[key])) p.proof[key][0] = 'different';
    else p.proof[key].changed = true;
    assert.throws(() => validateProvenance(p));
  });
for (const key of ['old-base', 'failed-source', 'rerun', 'chain', 'command', 'missing-payload'])
  test(`backend provenance refuses ${key}`, (t) => {
    const f = fixture(t),
      p = provenance(f.evidence);
    if (key === 'old-base') p.current.baseSha = 'old';
    if (key === 'failed-source') p.run.conclusion = 'failure';
    if (key === 'rerun') p.run.run_attempt = 2;
    if (key === 'chain') p.original.reusedFrom = {};
    if (key === 'command') p.original.phases[0].command = ['mvn', 'test'];
    if (key === 'missing-payload') delete p.original.backendEvidence;
    assert.throws(() => validateProvenance(p));
  });
test('backend execution strips API tokens while retaining JVM and database settings in fingerprint domain', () => {
  const v = backendExecutionEnvironment({
    PATH: '/bin',
    JAVA_HOME: '/jdk',
    MAVEN_OPTS: 'x',
    SPRING_DATASOURCE_URL: 'sensitive',
    GH_TOKEN: 'secret',
    GITHUB_TOKEN: 'secret',
    GITHUB_SHA: 'identity',
  });
  assert.deepEqual(v, { JAVA_HOME: '/jdk', MAVEN_OPTS: 'x', PATH: '/bin', SPRING_DATASOURCE_URL: 'sensitive' });
});
for (const p of ['../evil.jar', '/tmp/evil.pom', 'a/../evil.jar', 'a//x.jar', 'a/1-SNAPSHOT/x.jar', 'a/config.xml'])
  test(`Maven proof refuses ${p}`, () =>
    assert.throws(() => validateMavenEntries([{ path: p, bytes: 1, digest: 'a'.repeat(64) }])));
test('Maven materialization reuses exact bytes, downloads only missing Central artifact and refuses mismatch', async (t) => {
  const { root } = fixture(t),
    repo = path.join(root, 'repo');
  mkdirSync(repo);
  const bytes = Buffer.from('jar');
  const e = { path: 'example/lib/1/lib-1.jar', bytes: 3, digest: sha(bytes) };
  let calls = 0;
  const fetch = async (url) => {
    calls++;
    assert.equal(url, 'https://repo.maven.apache.org/maven2/' + e.path);
    return { ok: true, arrayBuffer: async () => bytes };
  };
  await materializeMaven([e], repo, fetch);
  await materializeMaven([e], repo, fetch);
  assert.equal(calls, 1);
  writeFileSync(path.join(repo, e.path), 'bad');
  await assert.rejects(materializeMaven([e], repo, fetch), /differs/);
});
test('Maven materialization rejects network failure and different content without trusting copied cache', async (t) => {
  const { root } = fixture(t),
    repo = path.join(root, 'repo');
  mkdirSync(repo);
  const e = { path: 'g/a/1/a-1.jar', bytes: 3, digest: sha('jar') };
  await assert.rejects(materializeMaven([e], repo, async () => ({ ok: false })));
  await assert.rejects(
    materializeMaven([e], repo, async () => ({ ok: true, arrayBuffer: async () => Buffer.from('bad') })),
    /differs/,
  );
});
for (const scenario of ['reuse', 'network', 'different-runtime', 'failed-source', 'missing-coverage'])
  test(`backend acquisition ${scenario} preserves original closure or falls back`, async (t) => {
    const f = fixture(t),
      p = provenance(f.evidence),
      current = path.join(f.root, 'current'),
      staging = path.join(f.root, 'staging');
    mkdirSync(current);
    writeFileSync(
      path.join(current, 'metadata.json'),
      JSON.stringify({ ...p.current, workflowRunId: '456', phases: [], startedAt: 'now' }),
    );
    const env = {
      GITHUB_JOB: 'backend_full',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ID: '456',
      GITHUB_REPOSITORY: p.repository,
    };
    const result = await tryReuse(current, env, {
      backendRuntime: () => ({ fixture: true }),
      prepareBackendReuse: async () => (scenario === 'different-runtime' ? { ...p.proof, kernel: 'other' } : p.proof),
      parents: () => p.parents,
      staging,
      api: (s) => {
        if (scenario === 'network') throw Error('EOF');
        if (s.endsWith('/pulls') || s === 'pulls/1') return s.endsWith('/pulls') ? [p.pull] : p.pull;
        if (s.startsWith('actions/workflows'))
          return { workflow_runs: [{ ...p.run, conclusion: scenario === 'failed-source' ? 'failure' : 'success' }] };
        if (s.includes('/jobs?'))
          return { jobs: ['Frontend quality', 'Backend quality'].map((name) => ({ name, conclusion: 'success' })) };
        if (s.startsWith('git/commits')) return p.commit;
        throw Error('Unexpected ' + s);
      },
      download: () => {
        cpSync(f.directory, staging, { recursive: true });
        writeFileSync(path.join(staging, 'metadata.json'), JSON.stringify(p.original));
        if (scenario === 'missing-coverage') rmSync(path.join(staging, 'reports/execution'));
      },
      validateSourceArtifact: (d, m) => validateBackendEvidence(d, m.backendEvidence, f.root),
    });
    assert.equal(result, scenario === 'reuse');
    if (result) {
      const m = JSON.parse(readFileSync(path.join(current, 'metadata.json')));
      validateReusedMetadata(m);
      assert.deepEqual(m.backendEvidence, p.original.backendEvidence);
      verifyBackendEvidence(m, f.evidence.summary, current, f.root);
      assert.equal(m.execution, 'reused');
      assert.equal(readFileSync(path.join(current, 'reports/execution'), 'utf8'), 'execution');
    }
  });

test('Maven materialization refuses a linked cache parent without reading or overwriting its target', async (t) => {
  const { root } = fixture(t);
  const repo = path.join(root, 'repo'),
    outside = path.join(root, 'outside');
  mkdirSync(repo);
  mkdirSync(outside);
  symlinkSync(outside, path.join(repo, 'g'));
  await assert.rejects(
    materializeMaven([{ path: 'g/a.jar', bytes: 3, digest: sha('jar') }], repo, async () => {
      throw Error('must not download');
    }),
    /Linked/,
  );
});
test('workflow retains backend gate, exact Maven command and source-only complete report collection', () => {
  const w = readFileSync('.github/workflows/quality.yml', 'utf8').split('  backend_full:')[1].split('  backend:')[0];
  assert.match(w, /setup-java@v4/);
  assert.match(w, /java-version: 21/);
  assert.match(w, /if: steps.equivalent.outputs.reused != 'true'/);
  assert.ok(w.includes('mvn -B test checkstyle:check spotbugs:check jacoco:report'));
  assert.match(w, /node scripts\/ci-quality-evidence.mjs init && node scripts\/ci-equivalence.mjs/);
  assert.ok(!w.includes('container:'));
});
