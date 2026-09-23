import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

export function backendReportState(root) {
  return Object.fromEntries(
    filesBelow(path.join(root, 'backend/target/surefire-reports'))
      .filter((file) => file.endsWith('.xml'))
      .map((file) => {
        const stat = statSync(file, { bigint: true });
        return [file, `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`];
      }),
  );
}

export function validateBackendReports(root, { startedAt, selector, previousReports = {} } = {}) {
  const sourceRoot = path.join(root, 'backend/src/test/java');
  const patterns = selector?.split(',').map((value) => {
    assert.match(value, /^[\w.*]+$/, 'Unsupported backend test selector');
    return new RegExp(`^${value.replaceAll('.', '\\.').replaceAll('*', '.*')}$`);
  });
  const classes = filesBelow(sourceRoot)
    .filter((file) => /(?:^|\/)(?:Test[^/]*|[^/]*Test|[^/]*Tests|[^/]*TestCase)\.java$/.test(file))
    .map((file) => ({
      name: path
        .relative(sourceRoot, file)
        .replaceAll(path.sep, '.')
        .replace(/\.java$/, ''),
      minimum: (
        readFileSync(file, 'utf8').match(/@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/g) ?? []
      ).length,
    }))
    .filter(
      (entry) =>
        !patterns || patterns.some((pattern) => pattern.test(entry.name) || pattern.test(entry.name.split('.').at(-1))),
    );
  assert.ok(classes.length, 'No expected backend test classes found');
  const current = backendReportState(root);
  let total = 0;
  for (const entry of classes) {
    const file = path.join(root, 'backend/target/surefire-reports', `TEST-${entry.name}.xml`);
    assert.ok(existsSync(file), `Missing backend test report: ${entry.name}`);
    if (startedAt)
      assert.ok(statSync(file).mtimeMs >= Date.parse(startedAt) - 1000, `Stale backend test report: ${entry.name}`);
    assert.notEqual(current[file], previousReports[file], `Backend report was not updated: ${entry.name}`);
    const xml = readFileSync(file, 'utf8');
    const suite = xml.match(/<testsuite\s[^>]*>/)?.[0];
    assert.ok(suite, `Invalid backend test report: ${entry.name}`);
    const value = (name) => {
      const raw = suite.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
      assert.ok(raw !== undefined && /^\d+$/.test(raw), `Invalid ${name} in ${entry.name}`);
      return Number(raw);
    };
    const count = value('tests');
    assert.ok(count >= Math.max(1, entry.minimum), `Incomplete backend tests: ${entry.name}`);
    for (const key of ['failures', 'errors', 'skipped']) assert.equal(value(key), 0, `${key} in ${entry.name}`);
    assert.equal((xml.match(/<testcase\b/g) ?? []).length, count, `Test count mismatch: ${entry.name}`);
    assert.ok(
      !/<(?:skipped|failure|error|flakyFailure|flakyError|rerunFailure|rerunError)\b/.test(xml),
      `Non-passing execution in ${entry.name}`,
    );
    total += count;
  }
  return { classes: classes.length, tests: total, failures: 0, errors: 0, skipped: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(validateBackendReports(process.cwd())));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
