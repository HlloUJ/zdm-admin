import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  verifyFrontendEvidence,
  verifyEngineeringEvidence,
  verifyBackendEvidence,
  verifyScope,
} from './ci-quality-evidence.mjs';
import { validateReusedMetadata } from './ci-equivalence.mjs';
import { hashPaths } from './verification-evidence.mjs';
export function assertCompletionQuality(ci, head, runId) {
  assert.equal(String(ci.runId), String(runId));
  assert.equal(ci.headSha, head);
  assert.equal(ci.attempt, 1);
  assert.equal(ci.conclusion, 'success');
  for (const name of ['Frontend quality', 'Backend quality'])
    assert.equal(
      ci.jobs.filter((j) => j.name === name && j.conclusion === 'success').length,
      1,
      'Missing required ' + name,
    );
  assert.ok(
    ci.jobs.every((j) => j.status === 'completed' && ['success', 'skipped'].includes(j.conclusion)),
    'Incomplete or failed job',
  );
}
export function evidenceIdentity(root, directory) {
  return hashPaths(root, [path.relative(root, directory), 'scripts', 'backend/src/test/java', 'backend/pom.xml']);
}
export function verifyCompletionEvidence(root, directory, ci) {
  const read = (p) => JSON.parse(readFileSync(path.join(directory, p), 'utf8'));
  const scope = read('ci-validation-scope/scope.json'),
    needs = {};
  const mapping = {
    'Validation scope': 'scope',
    'Repository formatting': 'formatting',
    'Engineering tests': 'engineering',
    'Frontend static checks': 'frontend_static',
    'Frontend E2E 1/2': 'frontend_e2e_1',
    'Frontend E2E 2/2': 'frontend_e2e_2',
    'Backend full checks': 'backend_full',
  };
  for (const j of ci.jobs) if (mapping[j.name]) needs[mapping[j.name]] = { result: j.conclusion };
  const identity = scope.identity;
  assert.equal(identity.eventName, 'push');
  assert.equal(identity.candidateSha, ci.headSha);
  assert.equal(identity.sourceHeadSha, ci.headSha);
  assert.equal(identity.workflowRunId, String(ci.runId));
  verifyScope(scope, identity);
  const reused = [],
    result = {};
  for (const [job, artifact] of Object.entries({
    formatting: 'ci-formatting',
    engineering: 'ci-engineering',
    frontend_static: 'ci-frontend-static',
    frontend_e2e_1: 'ci-frontend-e2e-1',
    frontend_e2e_2: 'ci-frontend-e2e-2',
    backend_full: 'ci-backend-full',
  })) {
    if (needs[job]?.result === 'success') {
      const m = read(artifact + '/metadata.json');
      verifyScope(scope, m);
      assert.equal(m.status, 'success');
      validateReusedMetadata(m);
      if (m.execution === 'reused') reused.push(job);
    }
  }
  assert.equal(needs.formatting?.result, 'success');
  if (scope.classification.engineering)
    verifyEngineeringEvidence(scope, read('ci-engineering/metadata.json'), identity);
  if (scope.classification.frontend) {
    result.frontend = verifyFrontendEvidence(
      needs,
      ['ci-frontend-static', 'ci-frontend-e2e-1', 'ci-frontend-e2e-2'].map((n, i) => ({
        metadata: read(n + '/metadata.json'),
        report: read(n + (i ? '/report.json' : '/all-tests.json')),
      })),
    ).testCount;
  }
  if (scope.classification.backend) {
    const m = read('ci-backend-full/metadata.json');
    assert.ok(m.backendEvidence, 'Complete backend packet missing');
    result.backend = verifyBackendEvidence(
      m,
      read('ci-backend-full/backend-tests.json'),
      path.join(directory, 'ci-backend-full'),
      root,
    );
    for (const entry of m.backendEvidence.files.filter((e) => e.path.startsWith('reports/surefire/'))) {
      const standalone = path.join(directory, 'ci-backend-reports', entry.path.slice('reports/surefire/'.length));
      assert.ok(existsSync(standalone), 'Standalone backend report missing');
      assert.deepEqual(
        readFileSync(standalone),
        readFileSync(path.join(directory, 'ci-backend-full', entry.path)),
        'Standalone backend report differs',
      );
    }
    result.backendTiming = {
      observedMs: m.observedElapsedMs,
      originalMavenMs: m.phases.find((p) => p.name === 'backend-quality')?.durationMs,
    };
  }
  return { runId: ci.runId, head: ci.headSha, reused, coverage: result };
}
