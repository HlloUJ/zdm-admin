import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';
import { selectLintArguments } from './lint-changed.mjs';
import { earlyReadinessTasks } from './verification-policy.mjs';

const root = process.cwd();
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const upstream = tracked.filter(
  (file) => file.startsWith('tests/fixtures/official-ui/upstream/') && /\.(?:[cm]?js|tsx?|vue)$/.test(file),
);

test('full fallback explicit inputs follow actual ESLint ignores without omitting regular sources', async () => {
  assert.equal(upstream.length, 4);
  const task = earlyReadinessTasks(root, tracked, {}).find((task) => task.args[1] === 'lint:changed');
  const files = task.args.slice(3);
  const selected = await selectLintArguments(files, root);
  const eslint = new ESLint({ cwd: root });
  const expected = [];
  for (const file of files) if (!(await eslint.isPathIgnored(file))) expected.push(file);
  assert.deepEqual(selected.args, expected);
  assert.equal(selected.allIgnored, false);
  assert.ok(selected.args.includes('src/services/orderPrototypePreview.ts'));
  for (const file of upstream) assert.ok(!selected.args.includes(file));
});

test('ignored-only selection does not accidentally lint the whole repository', async () => {
  const args = ['--cache', '--cache-location', '.task-runtime/cache/eslint', '--max-warnings=0', ...upstream];
  const selected = await selectLintArguments(args, root);
  assert.equal(selected.allIgnored, true);
  const result = spawnSync('npm', ['run', 'lint:changed', '--', ...upstream], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /All explicit lint inputs/);
});

test('normal source plus ignored fixtures lints the source with zero warning policy unchanged', () => {
  const result = spawnSync('npm', ['run', 'lint:changed', '--', ...upstream, 'src/services/orderPrototypePreview.ts'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /File ignored/);
});

test('stdin, unknown options, globs and missing files retain original ESLint handling', async () => {
  for (const args of [
    ['--stdin', '--stdin-filename', 'src/probe.ts'],
    ['--config', 'eslint.config.js', ...upstream],
    ['src/**/*.ts'],
    ['src/nonexistent-lint-probe.ts'],
  ])
    assert.deepEqual(await selectLintArguments(args, root), { args, allIgnored: false });
  const missing = spawnSync('npm', ['run', 'lint:changed', '--', 'src/nonexistent-lint-probe.ts'], {
    encoding: 'utf8',
  });
  assert.notEqual(missing.status, 0);
});
