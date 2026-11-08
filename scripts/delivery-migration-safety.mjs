import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { registeredTaskWorktrees } from './task-registry.mjs';
import { readTaskData, previewDataFile } from './task-data-environment.mjs';

function version(value) {
  assert.match(value, /^\d+(?:[._]\d+)*$/, 'Unknown migration version; review before delivery');
  const result = value.split(/[._]/).map(BigInt);
  while (result.length > 1 && result.at(-1) === 0n) result.pop();
  return result;
}
function compare(a, b) {
  const x = version(a),
    y = version(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const left = x[i] ?? 0n,
      right = y[i] ?? 0n;
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}
export function assertForwardMigrationCatalog(candidate, baseline, history) {
  const byName = new Map(candidate.map((entry) => [entry.name, entry])),
    versions = new Set();
  assert.equal(byName.size, candidate.length, 'Duplicate migration name');
  for (const entry of candidate) {
    const match = entry.name.match(/^V(\d+(?:[._]\d+)*)__.+\.sql$/);
    assert.ok(match, 'Unreviewed repeatable or unknown migration: ' + entry.name);
    const key = version(match[1]).join('.');
    assert.ok(!versions.has(key), 'Duplicate Flyway version: ' + key);
    versions.add(key);
    byName.set(entry.name, { ...entry, version: match[1] });
  }
  let highest = null;
  const applied = new Set();
  for (const row of history) {
    assert.equal(String(row.success), '1', 'Failed migration history remains; do not restore or rewrite it');
    version(row.version);
    const current = byName.get(row.script),
      previous = baseline.find((entry) => entry.name === row.script);
    assert.ok(current && previous, 'Applied migration missing from candidate or published baseline: ' + row.script);
    assert.equal(current.content, previous.content, 'Applied SQL changed; use a new migration: ' + row.script);
    applied.add(row.script);
    if (highest === null || compare(row.version, highest) > 0) highest = row.version;
  }
  const pending = [...byName.values()].filter((entry) => !applied.has(entry.name));
  for (const entry of pending)
    assert.ok(
      highest === null || compare(entry.version, highest) > 0,
      'New migration is below an already applied version: ' +
        entry.name +
        '; resolve the task dependency/version before merge; do not rewrite history',
    );
  return { applied: applied.size, pending: pending.map((entry) => entry.name), compatible: true };
}
const relative = 'backend/src/main/resources/db/migration';
function catalog(root) {
  const directory = path.join(root, relative);
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const file = path.join(directory, name);
      assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
      return { name, content: readFileSync(file, 'utf8') };
    });
}
function readHistory(database) {
  assert.ok(database === 'zdm_admin' || /^zdm_task_[a-f0-9]{16}$/.test(database));
  const sql = `SELECT version,script,success FROM \`${database}\`.flyway_schema_history ORDER BY installed_rank;`;
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'zdm-platform-mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B'],
    { input: sql, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(result.status, 0, 'Read-only migration-history probe failed; no data changes applied');
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [version, script, success, ...unknown] = line.split('\t');
      assert.equal(unknown.length, 0);
      return { version, script, success };
    });
}
export function checkDeliveryMigrationSafety(root, dependencies = {}) {
  if (!existsSync(path.join(root, relative))) return { applicable: false };
  const changed = execFileSync('git', ['-C', root, 'diff', '--name-only', 'origin/main', 'HEAD', '--', relative], {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
  const worktrees = registeredTaskWorktrees(root),
    integration = worktrees.find((item) => item.branch === 'codex/integration-current');
  assert.ok(integration, 'Published integration source required for migration compatibility');
  assert.ok(
    !existsSync(path.join(integration.worktree, 'backups/task-preview/active-database-task.json')),
    'Existing database protection remains; retain its source and backups',
  );
  const candidate = catalog(root),
    baseline = catalog(integration.worktree),
    history = dependencies.readHistory ?? readHistory;
  const results = [
    { scope: 'integration', ...assertForwardMigrationCatalog(candidate, baseline, history('zdm_admin')) },
  ];
  const retained = worktrees.find((item) => item.branch === 'codex/preview-current');
  if (retained && existsSync(previewDataFile(retained.worktree))) {
    const data = readTaskData(retained.worktree);
    results.push({
      scope: 'published-preview',
      ...assertForwardMigrationCatalog(candidate, baseline, history(data.database)),
    });
  }
  return { applicable: true, migrationDelta: Boolean(changed), dataModified: false, results };
}
export function checkTaskDataMigrations(root, data, dependencies = {}) {
  const files = catalog(root);
  return {
    scope: 'selected-task',
    dataModified: false,
    ...assertForwardMigrationCatalog(files, files, (dependencies.readHistory ?? readHistory)(data.database)),
  };
}
