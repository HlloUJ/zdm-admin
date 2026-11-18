import { stylesheetScope } from './stylesheet-scope.mjs';
import { compileStandardCoverage } from './delivery-standard-coverage.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export function readDeliveryStandard(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(value.version, 1);
    assert.equal(typeof value.id, 'string');
    for (const level of ['R0', 'R1', 'R2', 'R3', 'R4'])
      assert.ok(Array.isArray(value.levels[level].minimum) && value.levels[level].minimum.length);
    assert.equal(value.unknown.level, 'R4');
    assert.ok(Array.isArray(value.unknown.minimum) && value.unknown.minimum.length);
    assert.ok(value.rules.length && value.protected.length);
    for (const rule of value.rules) {
      assert.ok(value.levels[rule.level]);
      assert.ok(rule.id);
      assert.equal(typeof rule.pattern, 'string');
      assert.ok(
        !rule.domains ||
          (Array.isArray(rule.domains) &&
            rule.domains.every((domain) => ['frontend', 'backend', 'engineering'].includes(domain))),
      );
      new RegExp(rule.pattern, 'i');
    }
    return { available: true, value };
  } catch {
    // A damaged/missing classifier only authorizes the complete existing fallback.
    return {
      available: false,
      value: {
        version: 1,
        id: 'unavailable-full-fallback',
        levels: { R4: { minimum: ['complete-applicable-gates'] } },
        rules: [],
        unknown: { level: 'R4', minimum: ['complete-applicable-gates'], engineering: true },
        protected: ['existing-required-gates'],
      },
    };
  }
}
const loaded = readDeliveryStandard(new URL('../ci/delivery-standard.json', import.meta.url));
const standard = loaded.value;
export const deliveryStandardAvailable = loaded.available;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rank = (level) => Number(level.slice(1));
const normalized = (file) =>
  typeof file === 'string' && file && !/^(?:\/|[A-Za-z]:)|(?:^|[/\\])\.\.(?:[/\\]|$)/.test(file)
    ? file.replaceAll('\\', '/').replace(/^\.\//, '')
    : null;
export function deliveryStandardRule(file, { root = process.cwd() } = {}) {
  const name = normalized(file);
  if (!name) return { ...standard.unknown, id: 'unknown', file };
  const style = /\.(?:css|scss|less)$/.test(name) ? stylesheetScope(root, name) : null;
  if (style && !style.proven) return { ...standard.unknown, id: 'unknown', file: name, scopeEvidence: style };
  const matches = standard.rules.filter(
    (rule) => new RegExp(rule.pattern, 'i').test(name) && !(style?.proven && rule.id === 'security-and-important-data'),
  );
  if (style?.shared)
    matches.push({ id: 'proven-shared-stylesheet', level: 'R3', special: ['consumer-closure', 'affected-viewports'] });
  if (!matches.length) return { ...standard.unknown, id: 'unknown', file: name };
  // Highest risk wins, rather than the first convenient path classification.
  return {
    ...matches.sort(
      (a, b) => rank(b.level) - rank(a.level) || standard.rules.indexOf(a) - standard.rules.indexOf(b),
    )[0],
    file: name,
    ...(style ? { scopeEvidence: style } : {}),
    engineering: matches.some((rule) => rule.engineering === true),
    domains: [...new Set(matches.flatMap((rule) => rule.domains ?? []))].sort(),
    matched: matches.map((rule) => rule.id).sort(),
    minimum: [...new Set(matches.flatMap((rule) => standard.levels[rule.level].minimum))].sort(),
    special: [...new Set(matches.flatMap((rule) => rule.special ?? []))].sort(),
  };
}
export function deliveryStandardPlan({
  files,
  impact,
  candidate = null,
  base = null,
  environment = null,
  root = process.cwd(),
}) {
  assert.equal(standard.version, 1);
  assert.ok(
    impact && ['frontend', 'backend', 'engineering', 'full', 'runtime'].every((k) => typeof impact[k] === 'boolean'),
    'Actual conservative impact required',
  );
  const paths = Array.isArray(files) && files.length ? [...new Set(files)].sort() : ['<unknown>'];
  const rules = paths.map((file) => deliveryStandardRule(file, { root }));
  const uncertainty = [
    ...(impact.scopeUncertainty ?? []),
    ...rules
      .filter((r) => r.id === 'unknown')
      .map((r) => ({
        file: r.file,
        code: r.scopeEvidence ? 'stylesheet-consumers-unproven' : 'unknown-path',
        reason: r.scopeEvidence?.reason ?? 'No proven path classification',
      })),
  ];
  const unknown = uncertainty.length > 0;
  const pathLevel = rules.reduce((a, r) => (rank(r.level) > rank(a) ? r.level : a), 'R0');
  const level = unknown && rank(standard.unknown.level) > rank(pathLevel) ? standard.unknown.level : pathLevel;
  const minimum = [
    ...new Set([
      ...rules.flatMap((rule) => rule.minimum ?? standard.levels[rule.level].minimum),
      ...standard.levels[level].minimum,
      ...(unknown ? standard.unknown.minimum : []),
    ]),
  ].sort();
  const specialties = [...new Set(rules.flatMap((r) => r.special ?? []))].sort();
  const domains = ['frontend', 'backend', 'engineering'].filter(
    (k) => unknown || !deliveryStandardAvailable || impact[k],
  );
  const gates = [
    ...(impact.docsOnly ? ['format'] : []),
    ...domains.map((d) => d + '-quality'),
    ...(impact.runtime ? ['runtime-identity'] : []),
  ];
  const plan = {
    version: 1,
    standard: standard.id,
    standardDigest: hash(standard),
    candidate,
    base,
    environment,
    level,
    unknownScope: unknown,
    scopeUncertainty: uncertainty,
    files: paths,
    rules: rules.map((r) => ({
      file: r.file,
      rule: r.id,
      level: r.level,
      matched: r.matched ?? [],
      ...(r.scopeEvidence ? { scopeEvidence: r.scopeEvidence } : {}),
    })),
    minimum,
    specialties,
    domains,
    stages: {
      development: 'affected-checks',
      local: 'required-local-risk-and-readiness',
      pr: gates,
      main: gates.map((g) => ({ gate: g, mode: 'execute-or-verified-reuse' })),
      handoff: ['exact-main', 'runtime-identity', 'owned-resource-release', 'cleanup-handoff'],
    },
    protected: standard.protected,
  };
  plan.coverage = compileStandardCoverage(standard, plan);
  return { ...plan, digest: hash(plan) };
}

// The standard augments the existing conservative executor; it never grants a skip.
export function effectiveDeliveryPlan(plan, { candidate, base, environment } = {}) {
  const source = plan.standard;
  const execution = Object.fromEntries(
    [
      'inputContracts',
      'earlyChecks',
      'preflight',
      'contractPreflight',
      'frontend',
      'backend',
      'engineering',
      'runtime',
    ].map((stage) => [
      stage,
      [plan[stage]]
        .flat()
        .filter(Boolean)
        .map((task) => ({ name: task.name, command: task.command, args: task.args })),
    ]),
  );
  const definition = { ...source };
  delete definition.digest;
  const result = {
    ...definition,
    candidate: candidate ?? source.candidate,
    base: base ?? source.base,
    environment: environment ?? source.environment,
    execution,
    deferredToCi: plan.deferredToCi ?? null,
    ciCapability: plan.ciCapability
      ? {
          verified: plan.ciCapability.verified,
          stage: plan.ciCapability.stage ?? null,
          failure: plan.ciCapability.failure ?? null,
        }
      : null,
  };
  return { ...result, digest: hash(result) };
}
