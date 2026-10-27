import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backendTestInventory } from './backend-test-evidence.mjs';
import { executeVerification } from './verify.mjs';

test('test-discovery naming fault stops before contract diagnostics, runtime and all expensive pipelines', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'early-inventory-'));
  t.after(() => rmSync(root, { recursive: true }));
  const dir = path.join(root, 'backend/src/test/java/example');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'RealTest.java'), 'class RealTest { @Test void works(){} }');
  writeFileSync(path.join(dir, 'TestHelper.java'), 'class TestHelper {}');
  assert.throws(() => backendTestInventory(root), /Test-discovery name has no test methods/);
  const calls = [];
  const task = (name) => ({ root, name, args: [name === 'backend tests' ? 'backend:test' : name], env: {} });
  const plan = {
    preflight: task('format'),
    contractPreflight: task('contract'),
    runtime: task('runtime'),
    backend: [task('backend tests')],
    frontend: [task('browser')],
    engineering: [task('engineering')],
  };
  const code = await executeVerification(plan, {
    capture: () => ({}),
    report: () => {},
    run: async (step) => {
      calls.push(step.name);
      if (step.name === 'backend test discovery') {
        try {
          backendTestInventory(root);
        } catch {
          return { exitCode: 1 };
        }
      }
      return { exitCode: 0 };
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, ['format', 'backend test discovery']);
  rmSync(path.join(dir, 'TestHelper.java'));
  assert.equal(backendTestInventory(root).length, 1);
  calls.length = 0;
  const result = await executeVerification(plan, {
    capture: () => ({}),
    report: () => {},
    run: async (step) => {
      calls.push(step.name);
      return { exitCode: step.name === 'runtime' ? 1 : 0 };
    },
  });
  assert.equal(result, 1);
  assert.deepEqual(calls, ['format', 'backend test discovery', 'contract', 'runtime']);
});
