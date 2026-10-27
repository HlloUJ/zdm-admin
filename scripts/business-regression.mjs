import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRACT_FILE = 'scripts/business-regression-contracts.json';
export const digest = (source) => createHash('sha256').update(source).digest('hex');
const read = (root, file) => readFileSync(path.join(root, file), 'utf8');
export function sourceInventory(root, directory, includeTests = false) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory()
      ? sourceInventory(root, file, includeTests)
      : /\.(vue|ts|js|java)$/.test(file) && (includeTests || !/\.(test|spec)\./.test(file))
        ? [file]
        : [];
  });
}
// Direct imports, Java type references and explicitly registered SQL readers are independent
// discovery paths. Runtime injection / commodity adapters are rooted explicitly, not inferred.
export function discoverConsumers(root, contract) {
  const files = [...sourceInventory(root, 'src'), ...sourceInventory(root, 'backend/src/main')];
  const sources = new Map(files.map((file) => [file, read(root, file)]));
  const dependencies = new Map();
  const javaTypes = new Map(
    files.filter((file) => file.endsWith('.java')).map((file) => [path.posix.basename(file, '.java'), file]),
  );
  for (const [file, source] of sources) {
    const targets = new Set();
    if (file.startsWith('src/')) {
      assert.ok(
        !/\bimport\.meta\.glob|\bimport\s*\(\s*(?!['"])[^\s]/.test(source),
        `Unresolved dynamic consumer requires an explicit adapter review: ${file}`,
      );
      for (const match of source.matchAll(
        /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g,
      )) {
        const value = match[1] ?? match[2] ?? match[3];
        const base = value.startsWith('@/')
          ? `src/${value.slice(2)}`
          : value.startsWith('.')
            ? path.posix.normalize(path.posix.join(path.posix.dirname(file), value))
            : null;
        if (base)
          for (const candidate of [base, `${base}.ts`, `${base}.js`, `${base}/index.ts`])
            if (sources.has(candidate)) targets.add(candidate);
      }
    } else {
      // Conservative type-reference matching also includes same-package dependencies without imports.
      for (const symbol of new Set(source.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
        if (javaTypes.has(symbol)) targets.add(javaTypes.get(symbol));
      }
    }
    dependencies.set(file, targets);
  }
  const consumers = new Set(contract.roots);
  for (const [file, source] of sources)
    if (file.endsWith('.java') && contract.tables.some((table) => new RegExp(`\\b${table}\\b`).test(source)))
      consumers.add(file);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [file, targets] of dependencies) {
      // Router is the boundary of a page consumer, not a dependency of every other page.
      if (file === 'src/router/index.ts' || consumers.has(file)) continue;
      if ([...targets].some((target) => consumers.has(target))) {
        consumers.add(file);
        changed = true;
      }
    }
  }
  return [...consumers].sort();
}
export function discoverBrowserConsumers(root, contract) {
  const files = sourceInventory(root, 'tests/e2e', true);
  const sources = new Map(files.map((file) => [file, read(root, file)]));
  const selected = new Set();
  for (const [file, source] of sources) {
    if (
      (file.endsWith('.spec.ts') || /\.goto\s*\(/.test(source)) &&
      contract.routes.some((route) => ["'", '"', '`'].some((quote) => source.includes(quote + route + quote)))
    )
      selected.add(file);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [file, source] of sources) {
      if (selected.has(file)) continue;
      for (const match of source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
        if ([base, base + '.ts', base + '/index.ts'].some((target) => selected.has(target))) {
          selected.add(file);
          changed = true;
          break;
        }
      }
    }
  }
  return [...selected].filter((file) => file.endsWith('.spec.ts')).sort();
}
export function validateChangedBusinessCoverage(root, files) {
  if (!root || !existsSync(path.join(root, CONTRACT_FILE))) return;
  const registry = validateContracts(root);
  const known = new Set(registry.contracts.flatMap((contract) => contract.consumers));
  for (const file of files) {
    if (!/^(?:src\/.*\.(?:vue|ts|js)|backend\/src\/main\/java\/.*\.java)$/.test(file) || /\.(?:test|spec)\./.test(file))
      continue;
    assert.ok(
      known.has(file) || businessImpact(root, [file]).length,
      `Unregistered business change: ${file}; register actual consumers and API/UI behavior regressions before changing it`,
    );
  }
}
export function changedBusinessFiles(root) {
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Cannot prove complete business change scope');
    return result.stdout;
  };
  const base = git(['merge-base', 'HEAD', 'refs/remotes/origin/main']).trim();
  return [
    ...new Set(
      [
        ...git(['diff', '--name-only', '-z', base, '--']).split('\0'),
        ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
      ].filter(Boolean),
    ),
  ];
}
export function loadContracts(root) {
  return JSON.parse(read(root, CONTRACT_FILE));
}
export function validateContractEvolution(previous, next) {
  if (!previous) return;
  for (const original of previous.contracts) {
    const current = next.contracts.find((contract) => contract.id === original.id);
    assert.ok(current, `Cannot silently remove business contract: ${original.id}`);
    for (const file of [...original.browserTests, ...original.backendTests, ...(original.supportFiles ?? [])]) {
      assert.ok(
        [...current.browserTests, ...current.backendTests, ...(current.supportFiles ?? [])].includes(file),
        `Cannot silently remove accepted regression: ${file}`,
      );
      if (current.protectedTests[file] !== original.protectedTests[file]) {
        assert.ok(
          current.testChanges?.some(
            (change) =>
              change.file === file &&
              change.before === original.protectedTests[file] &&
              change.after === current.protectedTests[file] &&
              change.reason?.trim(),
          ),
          `Changed accepted assertions need an exact reviewed transition: ${file}`,
        );
      }
    }
  }
}
function previousContracts(root) {
  for (const revision of ['refs/remotes/origin/main', 'HEAD']) {
    const result = spawnSync('git', ['show', `${revision}:${CONTRACT_FILE}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0) return JSON.parse(result.stdout);
  }
  return null;
}
export function validateContracts(root, registry = loadContracts(root)) {
  validateContractEvolution(previousContracts(root), registry);
  assert.equal(registry.version, 1, 'Unsupported business regression contract');
  assert.ok(registry.contracts.length > 0, 'Business contracts cannot be empty');
  for (const contract of registry.contracts) {
    assert.ok(contract.id && contract.roots.length && contract.tables.length, 'Missing discovery roots');
    for (const file of contract.roots) assert.ok(existsSync(path.join(root, file)), `Missing business root: ${file}`);
    assert.deepEqual(
      contract.consumers,
      discoverConsumers(root, contract),
      `Unreviewed or omitted business consumers: ${contract.id}`,
    );
    assert.deepEqual(
      contract.browserConsumers,
      discoverBrowserConsumers(root, contract),
      `Unreviewed browser test consumers: ${contract.id}`,
    );
    for (const file of contract.browserConsumers)
      assert.ok(contract.browserTests.includes(file), `Missing associated browser regression: ${file}`);
    assert.ok(
      contract.browserTests.length && contract.backendTests.length,
      'Both API and UI behavior evidence are required',
    );
    for (const file of [...contract.browserTests, ...contract.backendTests, ...(contract.supportFiles ?? [])]) {
      assert.equal(
        digest(read(root, file)),
        contract.protectedTests[file],
        `Protected business regression changed: ${file}; review the exact assertions and contract together`,
      );
    }
  }
  return registry;
}
export function businessImpact(root, files) {
  if (!root || !existsSync(path.join(root, CONTRACT_FILE))) return [];
  const registry = validateContracts(root);
  const changedSources = files.filter((file) => /^(?:src\/|backend\/src\/main\/)/.test(file));
  const reverse = changedSources.length ? discoverConsumers(root, { roots: changedSources, tables: [] }) : [];
  return registry.contracts.filter(
    (contract) =>
      files.some((file) => Object.hasOwn(contract.protectedTests, file)) ||
      reverse.some((file) => contract.consumers.includes(file)),
  );
}
export function requireBrowserBehaviors(names, required, { candidate, expectedCandidate } = {}) {
  if (expectedCandidate !== undefined)
    assert.equal(candidate, expectedCandidate, 'Business report belongs to a different candidate');
  for (const title of required)
    assert.equal(
      names.filter((name) => name.split(' > ').at(-1) === title).length,
      1,
      `Missing or duplicate executed business behavior: ${title}`,
    );
}
export function browserBehaviorTitles() {
  const paths = [
    '/finished-stock-management',
    '/supply-chain/finished-stock-management',
    '/accessory-management',
    '/supply-chain/accessory-management',
    '/store/accessory-management',
    '/slab-management',
    '/supply-chain/slab-management',
    '/store/finished-stock-management',
  ];
  return paths.flatMap((route) => [
    `${route} shows state activity without source tags and keeps complete-list ordering`,
    ...['single', 'batch'].map((mode) => `${route} ${mode} restore immediately shows server actor and time`),
  ]);
}
export function ciBrowserBehaviorNames(reports) {
  const names = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const item of spec.tests ?? []) {
        assert.equal(item.results?.length, 1, `Missing/retried business execution: ${spec.title}`);
        assert.equal(item.results[0].status, 'passed', `Failed business execution: ${spec.title}`);
        names.push(spec.title);
      }
    (suite.suites ?? []).forEach(visit);
  };
  reports.forEach((report) => report.suites.forEach(visit));
  return names;
}
export function requireBackendBehaviors(className, xml) {
  const expected = className.endsWith('.ProductStateActivityApiTest')
    ? {
        returnsRealDatabaseTimeWithoutSourceTagPayload: 12,
        transitionResponseMatchesPersistedActivityBeforeAnyListRefresh: 2,
        slabStatusMutationAndListReadSamePersistedActivity: 2,
        reentryKeepsRealTriggerReasonAndHistoricalLogs: 3,
      }
    : /\.Store(?:Finished|Accessory)ProductServiceTest$/.test(className)
      ? { statusResponseImmediatelyMatchesPersistedActorAndTime: 1 }
      : {};
  for (const [method, minimum] of Object.entries(expected)) {
    const cases = [...xml.matchAll(/<testcase\b[^>]*\bname="([^"]+)"/g)].filter(
      (match) => match[1].startsWith(method + '(') || match[1] === method,
    );
    assert.ok(cases.length >= minimum, `Missing executed business cases: ${className}.${method}`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateContracts(process.cwd());
    if (process.argv.includes('--changed'))
      validateChangedBusinessCoverage(process.cwd(), changedBusinessFiles(process.cwd()));
    console.log('Business consumers and protected API/UI regressions verified');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
