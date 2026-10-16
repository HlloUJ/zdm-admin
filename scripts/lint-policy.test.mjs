import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
test('all supported ESLint entry points reject warnings', () => {
  for (const name of ['lint', 'lint:changed', 'lint:fix'])
    assert.match(pkg.scripts[name], /(?:^|\s)--max-warnings=0(?:\s|$)/);
  assert.ok(pkg['lint-staged']['*.{js,ts,vue}'].includes('eslint --fix --max-warnings=0'));
  assert.match(pkg.scripts['quality:static'], /npm run lint(?:\s|$)/);
});

test('incremental lint rejects a real warning and accepts clean stdin', () => {
  function lint(input) {
    return spawnSync(
      'npm',
      ['run', 'lint:changed', '--', '--stdin', '--stdin-filename', 'src/lint-policy-probe.ts', '--no-cache'],
      { input, encoding: 'utf8' },
    );
  }
  const warning = lint('const unusedLintProbe = 1;\nexport {};\n');
  assert.ifError(warning.error);
  assert.equal(warning.status, 1, warning.stdout + warning.stderr);
  assert.match(warning.stdout, /@typescript-eslint\/no-unused-vars/);
  assert.match(warning.stdout, /0 errors, 1 warning/);
  const clean = lint('export const lintProbe = 1;\n');
  assert.ifError(clean.error);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
});
