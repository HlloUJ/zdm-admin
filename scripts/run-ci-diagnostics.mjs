import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { runScriptTests } from './run-script-tests.mjs';
if (process.env.GITHUB_ACTIONS === 'true') {
  const original = process.cwd();
  assert.equal(spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim(), '');
  const parent = mkdtempSync(path.join(os.tmpdir(), 'zdm-diagnostic-source-'));
  chmodSync(parent, 0o700);
  const root = path.join(parent, 'source');
  const clone = spawnSync('git', ['clone', '--depth=1', '--no-local', pathToFileURL(original).href, root], {
    stdio: 'inherit',
  });
  assert.equal(clone.status, 0);
  const expected = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: original, encoding: 'utf8' }).stdout.trim();
  assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), expected);
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/run-script-tests.mjs'), '--diagnostic'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI_DIAGNOSTIC_CAPSULE: 'true' },
  });
  process.exitCode = run.status ?? 1;
} else process.exitCode = runScriptTests('--diagnostic');
