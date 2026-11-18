import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryStandardPlan, readDeliveryStandard } from './delivery-standard.mjs';
import {
  compileStandardCoverage,
  assertStandardCoveragePlan,
  validateStandardCoverageEvidence,
} from './delivery-standard-coverage.mjs';
const head = 'a'.repeat(40),
  base = 'b'.repeat(40);
const impact = { frontend: false, backend: false, engineering: false, full: false, runtime: false, docsOnly: true };
const planFor = (files, flags = impact) => deliveryStandardPlan({ files, impact: flags, candidate: head, base });
const phase = (name, command, runId = 'run') => ({ name, command, exitCode: 0, runId });
const metadata = (phases) => ({ candidateSha: head, status: 'success', phases });
function packets(plan) {
  return {
    inputs: {
      version: 1,
      candidate: head,
      base,
      standardDigest: plan.standardDigest,
      files: plan.files,
      diff: { status: 'passed', command: ['git', 'diff', '--check', base, head, '--'] },
      documents: plan.files
        .filter((f) => f.endsWith('.md'))
        .map((file) => ({ file, status: 'passed', references: [] })),
      complete: true,
    },
    formatting: metadata([phase('formatting', ['npm', 'run', 'format:check'])]),
  };
}
function engineering(plan) {
  const cases = [
    ...new Map(plan.coverage.obligations.flatMap((o) => o.scenarios).map((s) => [s.file + '::' + s.name, s])).values(),
  ];
  const tests = cases.map((s, n) => ({
    ...s,
    id: 'case-' + n,
    status: 'passed',
    retryCount: 0,
    repeatCount: 0,
    flaky: false,
    expectedFailure: false,
  }));
  const files = [...new Set(tests.map((t) => t.file))].sort();
  return {
    ...metadata([
      phase('light-checks', ['node', 'scripts/ci-light-checks.mjs']),
      phase('engineering-tests', ['npm', 'run', 'test:engineering']),
    ]),
    engineeringResults: {
      schemaVersion: 1,
      kind: 'engineering',
      runId: 'run',
      complete: true,
      files,
      completedFiles: files,
      collectedTests: tests.map((t) => t.id),
      tests,
      suites: [],
      errors: [],
    },
  };
}
const spec = (id, executed = false) => ({
  id,
  title: id,
  tests: [
    {
      projectName: 'chrome',
      repeatEachIndex: 0,
      expectedStatus: 'passed',
      status: executed ? 'expected' : 'skipped',
      results: executed ? [{ status: 'passed', retry: 0 }] : [],
    },
  ],
});
function frontend() {
  return [
    {
      metadata: metadata([phase('frontend-quality', ['npm', 'run', 'quality:static'])]),
      report: { errors: [], suites: [{ specs: [spec('one'), spec('two')] }] },
    },
    ...[1, 2].map((i) => ({
      metadata: metadata([
        phase('e2e-' + i, ['npm', 'run', 'test:e2e:ci', '--', `--shard=${i}/2`, '--workers=1', '--reporter=list,json']),
      ]),
      report: { errors: [], suites: [{ specs: [spec(i === 1 ? 'one' : 'two', true)] }] },
    })),
  ];
}
test('minimum and special requirements resolve to actual producers while remaining pending until evidence', () => {
  const plan = planFor(['scripts/task-cleanup-handoff.mjs'], { ...impact, engineering: true, docsOnly: false });
  assertStandardCoveragePlan(plan);
  assert.equal(plan.coverage.state, 'planned-pending-evidence');
  for (const obligation of plan.coverage.obligations)
    assert.ok(obligation.state === 'not-applicable' || obligation.checks.length);
  const risk = plan.coverage.obligations.find((o) => o.id === 'risk-specific');
  assert.ok(risk.scenarios.length >= 3);
  assert.deepEqual(plan.coverage.checks['engineering-tests'].command, ['npm', 'run', 'test:engineering']);
});
test('unmapped requirements, check producers and risk scenarios are explicit fail-closed gaps', () => {
  const standard = readDeliveryStandard(new URL('../ci/delivery-standard.json', import.meta.url)).value;
  const plan = planFor(['scripts/tool.mjs'], { ...impact, engineering: true, docsOnly: false });
  for (const mutate of [
    (s) => delete s.coverage.requirements['risk-specific'],
    (s) => delete s.coverage.checks['engineering-tests'],
    (s) => delete s.coverage.checks['engineering-tests'].reportKind,
    (s) => delete s.coverage.engineeringScenarios['risk-specific'],
  ]) {
    const config = structuredClone(standard);
    mutate(config);
    const coverage = compileStandardCoverage(config, plan);
    assert.ok(coverage.gaps.length);
    assert.throws(() => assertStandardCoveragePlan({ ...plan, coverage }), /Unmapped standard/);
  }
});
test('R0 documents require real diff, format and changed-document proof rather than a risk label', () => {
  const plan = planFor(['README.md']),
    proof = packets(plan);
  assert.equal(validateStandardCoverageEvidence(plan, proof).state, 'satisfied');
  for (const mutate of [
    (p) => delete p.inputs,
    (p) => (p.inputs.documents = []),
    (p) => (p.inputs.candidate = 'wrong'),
    (p) => (p.inputs.standardDigest = 'wrong'),
    (p) => (p.inputs.base = 'wrong'),
    (p) => (p.inputs.diff.status = 'failed'),
    (p) => (p.formatting.phases[0].exitCode = 1),
    (p) => (p.formatting.phases[0].command = ['true']),
  ]) {
    const changed = structuredClone(proof);
    mutate(changed);
    assert.throws(() => validateStandardCoverageEvidence(plan, changed));
  }
});
test('R1 interaction obligations require the complete first-pass disjoint automation evidence', () => {
  const plan = planFor(['src/pages/finished-stock/store/index.css'], { ...impact, frontend: true, docsOnly: false }),
    proof = { ...packets(plan), frontend: frontend() };
  assert.equal(validateStandardCoverageEvidence(plan, proof).state, 'satisfied');
  for (const mutate of [
    (p) => p.frontend.pop(),
    (p) => (p.frontend[2].report.suites[0].specs = []),
    (p) => p.frontend[1].report.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 }),
    (p) => (p.frontend[1].metadata.phases[0].command = ['true']),
  ]) {
    const changed = structuredClone(proof);
    mutate(changed);
    assert.throws(() => validateStandardCoverageEvidence(plan, changed));
  }
});
test('R4 engineering requirements demand exact protection scenarios and reject missing, renamed or failed cases', () => {
  const plan = planFor(['scripts/task-cleanup-handoff.mjs'], { ...impact, engineering: true, docsOnly: false }),
    proof = { ...packets(plan), engineering: engineering(plan) };
  assert.equal(validateStandardCoverageEvidence(plan, proof).state, 'satisfied');
  for (const mutate of [
    (p) => (p.engineering.engineeringResults.tests[0].name = 'another passing test'),
    (p) => (p.engineering.engineeringResults.tests[0].status = 'failed'),
    (p) => (p.engineering.engineeringResults.tests[0].retryCount = 1),
    (p) => (p.engineering.phases[1].command = ['true']),
    (p) => (p.engineering.candidateSha = 'wrong'),
  ]) {
    const changed = structuredClone(proof);
    mutate(changed);
    assert.throws(() => validateStandardCoverageEvidence(plan, changed));
  }
});

test('domain aggregates prove only their part and complete coverage still requires all applicable packets', () => {
  const plan = planFor(['backend/src/main/java/example/Security.java'], { ...impact, backend: true, docsOnly: false });
  const proof = {
    ...packets(plan),
    backend: metadata([
      phase('backend-quality', ['mvn', '-B', 'test', 'checkstyle:check', 'spotbugs:check', 'jacoco:report']),
    ]),
    backendReport: { tests: 4, classes: 1, failures: 0, errors: 0, skipped: 0 },
  };
  assert.equal(validateStandardCoverageEvidence(plan, proof, { domain: 'frontend' }).state, 'partial-satisfied');
  assert.equal(validateStandardCoverageEvidence(plan, proof, { domain: 'backend' }).state, 'partial-satisfied');
  assert.equal(validateStandardCoverageEvidence(plan, proof).state, 'satisfied');
  const changed = structuredClone(proof);
  delete changed.backend;
  assert.throws(() => validateStandardCoverageEvidence(plan, changed));
  assert.throws(() => validateStandardCoverageEvidence(plan, proof, { domain: 'other' }));
});

test('the real existing engineering producer kind agrees with the standard report contract', async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } = await import('node:fs');
  const { tmpdir, homedir } = await import('node:os');
  const path = await import('node:path');
  const { runScriptTests } = await import('./run-script-tests.mjs');
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'actual-engineering-contract-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(
    path.join(root, 'scripts/producer.test.mjs'),
    "import test from 'node:test';test('a real collected schema fixture',()=>{});\n",
  );
  const result = runScriptTests('--engineering', [], {
    root,
    env: { PATH: process.env.PATH, HOME: homedir(), ENGINEERING_RUN_ID: 'producer-kind' },
  });
  assert.equal(result, 0);
  const report = JSON.parse(
    readFileSync(path.join(root, '.task-verification/script-tests/producer-kind/engineering-results.json'), 'utf8'),
  );
  const standard = readDeliveryStandard(new URL('../ci/delivery-standard.json', import.meta.url)).value;
  assert.equal(report.kind, standard.coverage.checks['engineering-tests'].reportKind);
  assert.equal(report.tests.length, 1);
  assert.equal(report.complete, true);
});
