import assert from 'node:assert/strict';
import { validateFrontendTestReport, testIdentities } from './frontend-test-evidence.mjs';
const producerStages = {
  'input-contracts': 'scope',
  formatting: 'formatting',
  'engineering-tests': 'engineering',
  'engineering-static': 'engineering',
  'frontend-static': 'frontend',
  'frontend-unit': 'frontend',
  'frontend-tests': 'frontend',
  'backend-tests': 'backend',
};

// Requirements resolve to concrete existing producers. The plan is pending,
// never a report of success. Unknown requirements cannot disappear silently.
export function compileStandardCoverage(standard, plan) {
  const config = standard.coverage;
  const gaps = [];
  const obligations = [];
  const runtimeBusiness = plan.files.some((f) => /^(?:src\/|public\/|tests\/e2e\/|backend\/)/.test(f));
  const knownEngineering = plan.files.every(
    (f) =>
      /^(?:scripts\/|ci\/|\.github\/|\.codex\/|AGENTS\.md$|package(?:-lock)?\.json$|vite|vitest|playwright|tsconfig|docker|compose|docs\/engineering\/|docs\/task-completion\.md$)/.test(
        f,
      ) || /\.md$/.test(f),
  );
  const profiles = runtimeBusiness
    ? plan.domains.filter((d) => d !== 'engineering')
    : knownEngineering && plan.domains.includes('engineering')
      ? ['engineering']
      : plan.domains;
  const full = () => [
    ...new Set(
      plan.domains.flatMap((d) =>
        d === 'frontend'
          ? ['frontend-static', 'frontend-unit', 'frontend-tests']
          : d === 'backend'
            ? ['backend-tests']
            : ['engineering-static', 'engineering-tests'],
      ),
    ),
  ];
  const add = (kind, id) => {
    const definition = config?.[kind === 'minimum' ? 'requirements' : 'specialties']?.[id];
    if (!definition) {
      gaps.push({ kind, id, reason: 'No versioned requirement-to-check mapping' });
      return;
    }
    const checks = [
      ...new Set([
        ...(definition.always ?? []),
        ...(definition.domains ? full() : []),
        ...profiles.flatMap((p) => definition[p] ?? []),
        ...(definition.documents && plan.files.some((f) => f.endsWith('.md')) ? definition.documents : []),
      ]),
    ].sort();
    const na = definition.documents && !plan.files.some((f) => f.endsWith('.md'));
    if (!checks.length && !na) gaps.push({ kind, id, reason: 'No applicable concrete check producer' });
    for (const check of checks) {
      const producer = config.checks[check];
      if (!producer || !producerStages[check])
        gaps.push({ kind, id, check, reason: 'Unknown concrete check producer' });
      else if (
        producer.stage !== producerStages[check] ||
        (check === 'frontend-tests'
          ? ['e2e-1', 'e2e-2'].some((p) => !Array.isArray(producer.commands?.[p]) || !producer.commands[p].length)
          : !Array.isArray(producer.command) || !producer.command.length)
      )
        gaps.push({ kind, id, check, reason: 'Invalid producer stage or concrete command' });
    }
    const scenarios = profiles.includes('engineering') ? (config.engineeringScenarios?.[id] ?? []) : [];
    if (
      profiles.includes('engineering') &&
      (id === 'risk-specific' || (kind === 'specialty' && !['affected-viewports', 'document-contract'].includes(id))) &&
      !scenarios.length
    )
      gaps.push({ kind, id, reason: 'No explicit engineering protection scenario mapping' });
    obligations.push({
      kind,
      id,
      state: na ? 'not-applicable' : 'planned-pending-evidence',
      ...(na ? { reason: 'No changed Markdown declaration or internal reference' } : {}),
      checks,
      scenarios,
    });
  };
  for (const id of plan.minimum) add('minimum', id);
  for (const id of plan.specialties) add('specialty', id);
  const checks = Object.fromEntries(
    [...new Set(obligations.flatMap((o) => o.checks))].sort().map((id) => [id, config?.checks?.[id] ?? null]),
  );
  return { version: 1, profiles, obligations, checks, gaps, state: gaps.length ? 'gap' : 'planned-pending-evidence' };
}
export function assertStandardCoveragePlan(plan) {
  assert.equal(plan.coverage?.version, 1, 'Missing concrete requirement coverage plan');
  assert.deepEqual(plan.coverage.gaps, [], 'Unmapped standard requirement; repair the mapping before expensive gates');
  for (const obligation of plan.coverage.obligations)
    assert.ok(obligation.state === 'not-applicable' || obligation.checks.length, 'Empty standard requirement coverage');
}
function phase(metadata, name, command) {
  assert.equal(metadata?.status, 'success', 'Required producer did not succeed');
  const found = metadata.phases.filter((p) => p.name === name);
  assert.equal(found.length, 1, 'Missing or duplicate producer phase: ' + name);
  assert.equal(found[0].exitCode, 0, 'Producer failed: ' + name);
  if (command) assert.deepEqual(found[0].command, command, 'Producer command differs: ' + name);
  return found[0];
}
// Called after the original full domain validators. It checks the additional
// standard binding, actual producer commands and exact registered scenarios.
// It does not launch tests, reinterpret a failed report or grant reuse.
export function validateStandardCoverageEvidence(plan, packets, { domain = null } = {}) {
  assert.ok([null, 'frontend', 'backend'].includes(domain), 'Unknown coverage evidence domain');
  assertStandardCoveragePlan(plan);
  const satisfied = new Set();
  const evidence = [];
  for (const [id, definition] of Object.entries(plan.coverage.checks)) {
    if (domain === 'backend' && definition.stage !== 'backend') continue;
    if (domain === 'frontend' && definition.stage === 'backend') continue;
    let metadata;
    if (id === 'input-contracts') {
      const report = packets.inputs;
      assert.equal(report?.version, 1, 'Missing input/document contract report');
      assert.equal(report.candidate, plan.candidate);
      assert.equal(report.standardDigest, plan.standardDigest);
      assert.deepEqual(report.files, plan.files);
      assert.equal(report.diff.status, 'passed');
      assert.deepEqual(
        report.documents.map((d) => d.file).sort(),
        plan.files.filter((f) => f.endsWith('.md')).sort(),
        'Missing affected document contract',
      );
      assert.ok(report.documents.every((d) => ['passed', 'deleted'].includes(d.status)));
      assert.deepEqual(report.diff.command, [
        'git',
        'diff',
        '--check',
        ...(report.base ? [report.base, plan.candidate] : ['HEAD']),
        '--',
      ]);
      assert.ok(report.base === plan.base || (plan.unknownScope && report.base === null), 'Diff contract base changed');
      assert.equal(report.complete, true);
    } else if (id === 'formatting') {
      metadata = packets.formatting;
      phase(metadata, definition.phase, definition.command);
    } else if (id.startsWith('engineering')) {
      metadata = packets.engineering;
      const producer = phase(metadata, definition.phase, definition.command);
      if (id === 'engineering-tests')
        validateFrontendTestReport(metadata.engineeringResults, { kind: definition.reportKind, runId: producer.runId });
    } else if (id === 'frontend-tests') {
      assert.ok(packets.frontend?.length === 3, 'Missing original frontend shard proof');
      for (let i = 1; i <= 2; i++) phase(packets.frontend[i].metadata, 'e2e-' + i, definition.commands['e2e-' + i]);
      const expected = testIdentities(packets.frontend[0].report);
      const actual = packets.frontend
        .slice(1)
        .flatMap((g) => testIdentities(g.report, true))
        .sort();
      assert.equal(new Set(actual).size, actual.length, 'Repeated interaction case across shards');
      assert.deepEqual(actual, expected, 'Interaction evidence misses the planned complete test list');
      metadata = packets.frontend[0].metadata;
    } else if (id.startsWith('frontend')) {
      metadata = packets.frontend?.[0]?.metadata;
      const producer = phase(metadata, definition.phase, definition.command);
      if (id === 'frontend-unit')
        validateFrontendTestReport(metadata.frontendResults.unit, {
          kind: definition.reportKind,
          runId: producer.runId,
        });
    } else if (id === 'backend-tests') {
      metadata = packets.backend;
      phase(metadata, definition.phase, definition.command);
      assert.ok(packets.backendReport?.tests > 0);
      for (const k of ['failures', 'errors', 'skipped']) assert.equal(packets.backendReport[k], 0);
    } else assert.fail('No evidence validator for concrete check ' + id);
    if (metadata) assert.equal(metadata.candidateSha, plan.candidate, 'Requirement proof belongs to another candidate');
    satisfied.add(id);
    evidence.push({
      check: id,
      state: metadata?.execution === 'reused' ? 'valid-reuse' : 'executed-passed',
      producer: definition.stage,
    });
  }
  const requirements = [];
  for (const obligation of plan.coverage.obligations) {
    const selected = obligation.checks.filter(
      (c) => domain === null || (domain === 'backend') === (plan.coverage.checks[c].stage === 'backend'),
    );
    if (!selected.length && obligation.state !== 'not-applicable') continue;
    for (const scenario of obligation.scenarios) {
      if (!selected.includes('engineering-tests')) continue;
      const matches = packets.engineering.engineeringResults.tests.filter(
        (t) => t.file === scenario.file && t.name === scenario.name,
      );
      assert.equal(matches.length, 1, 'Missing exact standard scenario: ' + scenario.file + ' :: ' + scenario.name);
      assert.equal(matches[0].status, 'passed');
    }
    assert.ok(
      selected.every((c) => satisfied.has(c)),
      'Standard requirement remains unproven',
    );
    requirements.push({
      kind: obligation.kind,
      id: obligation.id,
      state: obligation.state === 'not-applicable' ? 'not-applicable' : 'satisfied',
      checks: selected,
    });
  }
  return {
    version: 1,
    standard: plan.standard,
    plan: plan.digest,
    domain,
    state: domain ? 'partial-satisfied' : 'satisfied',
    requirements,
    evidence,
  };
}
