import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withCandidateRuntime } from './task-candidate-runtime.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { parseTaskPreviewArgs, assertFrozenValidationStart } from './dev-task.mjs';
import { createVerificationPlan } from './verify.mjs';

function fixture(t, { existingOwnPreview = false, cleanupFails = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'candidate-runtime-')),
    common = path.join(root, '.git');
  mkdirSync(common);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const task = {
    id: 'a',
    worktree: root,
    branch: 'codex/a',
    owner: 'chat-a',
    stage: 'validating',
    frozen: { accepted: 'a'.repeat(40) },
  };
  const leases = createResourceLeases(common),
    foreign = leases.acquire('temporary-port-5177', 'b');
  const events = [],
    child = Object.assign(new EventEmitter(), { pid: 1234, exitCode: null, signalCode: null });
  const system = {
    needsRuntime: () => true,
    registry: () => ({ commonDir: common, resolve: () => task }),
    head: () => 'b'.repeat(40),
    clean: () => '',
    readData: () => ({ status: 'ready' }),
    provision: () => assert.fail('No data initialization'),
    isOpen: async () => false,
    references: async () => ({ backendPorts: [], owned: existingOwnPreview ? [{ port: 5175 }] : [] }),
    start: (cwd, args) => {
      assert.equal(cwd, root);
      const options = parseTaskPreviewArgs(args);
      assert.equal(options.port, 5178);
      assert.equal(options.validationCandidate, 'b'.repeat(40));
      assert.equal(options.mode, 'full');
      assert.equal(options.temporary, false);
      events.push('start-a-temporary');
      return child;
    },
    inspect: async ({ port }) => {
      assert.equal(port, 5178);
      return { metadata: {}, errors: [] };
    },
    run: (_root, args) => {
      events.push(args[0] === '--check' ? 'full-binding-check' : 'stop-a-backend');
    },
    stopChild: async () => {
      events.push('stop-a-temporary');
      child.exitCode = 0;
      if (cleanupFails) throw Error('child still alive');
    },
  };
  return { root, task, leases, foreign, events, system };
}
test('candidate runtime validates an owned temporary port while selected B and B leased port remain untouched', async (t) => {
  const f = fixture(t);
  const result = await withCandidateRuntime(
    f.task,
    'b'.repeat(40),
    async (env) => {
      assert.equal(env.ZDM_TASK_VALIDATION_PORT, '5178');
      assert.equal(env.ZDM_TASK_VALIDATION_ROOT, f.root);
      assert.equal(f.leases.inspect('temporary-port-5178').task, 'a');
      f.events.push('verify-candidate');
      return 'passed';
    },
    f.system,
  );
  assert.equal(result, 'passed');
  assert.deepEqual(f.events, [
    'start-a-temporary',
    'full-binding-check',
    'verify-candidate',
    'stop-a-temporary',
    'stop-a-backend',
  ]);
  assert.equal(f.leases.inspect('temporary-port-5178'), null);
  assert.equal(f.leases.inspect('temporary-port-5177').token, f.foreign.token);
});
test('temporary validation does not stop a backend still serving this task own selected frontend', async (t) => {
  const f = fixture(t, { existingOwnPreview: true });
  await assert.rejects(
    withCandidateRuntime(
      f.task,
      'b'.repeat(40),
      async () => {
        throw Error('quality failed');
      },
      f.system,
    ),
    /quality failed/,
  );
  assert.ok(!f.events.includes('stop-a-backend'));
  assert.equal(f.leases.inspect('temporary-port-5178'), null);
  const folder = path.join(f.root, '.task-runtime/candidate-runtime');
  const record = JSON.parse(
    readFileSync(
      path.join(
        folder,
        readdirSync(folder).find((name) => name.endsWith('.json')),
      ),
    ),
  );
  assert.equal(record.failure, 'quality failed');
  assert.equal(record.state, 'stopped');
});
test('failed runtime cleanup retains its exact lease and both original check and cleanup failures', async (t) => {
  const f = fixture(t, { cleanupFails: true });
  await assert.rejects(
    withCandidateRuntime(
      f.task,
      'b'.repeat(40),
      async () => {
        throw Error('quality failed');
      },
      f.system,
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(
        error.errors.map((item) => item.message),
        ['quality failed', 'child still alive'],
      );
      return true;
    },
  );
  assert.equal(f.leases.inspect('temporary-port-5178').task, 'a');
});
test('frozen runtime authorization binds actual head, live delivery owner, stage, full mode and temporary port', () => {
  const task = { frozen: {}, owner: 'chat-a', stage: 'validating' },
    head = 'a'.repeat(40);
  const options = { validationCandidate: head, port: 5177, mode: 'full' },
    proof = { head, lease: { task: 'chat-a', pid: 123 }, alive: () => true };
  assert.doesNotThrow(() => assertFrozenValidationStart(task, options, proof));
  for (const changed of [{ port: 5175 }, { mode: 'frontend' }, { validationCandidate: 'b'.repeat(40) }])
    assert.throws(() => assertFrozenValidationStart(task, { ...options, ...changed }, proof), /冻结交付/);
  assert.throws(() => assertFrozenValidationStart(task, options, { ...proof, alive: () => false }), /所有者已结束/);
  assert.throws(() => assertFrozenValidationStart(task, options, { ...proof, lease: { task: 'chat-b' } }), /冻结交付/);
});
test('verification retains its runtime gate and directs it to a proved temporary candidate without changing the development preview check', () => {
  const input = {
    root: process.cwd(),
    files: ['backend/src/main/Application.java'],
    affected: true,
    ciCapability: { verified: false },
    impact: { runtime: true, frontend: true, backend: true, engineering: true, full: true },
  };
  const usual = createVerificationPlan({ ...input, env: {} });
  assert.deepEqual(usual.runtime.args, ['run', 'dev:task:check', '--', '--worktree', process.cwd()]);
  const validation = createVerificationPlan({ ...input, env: { ZDM_TASK_VALIDATION_PORT: '5177' } });
  assert.equal(validation.runtime.kind, 'runtime');
  assert.equal(validation.runtime.command, process.execPath);
  assert.equal(path.basename(validation.runtime.args[0]), 'task-runtime-check.mjs');
  assert.equal(validation.runtime.env.ZDM_TASK_VALIDATION_PORT, '5177');
  for (const entry of [validation.preflight, ...validation.frontend, ...validation.backend, ...validation.engineering])
    assert.equal(
      entry.env.ZDM_TASK_VALIDATION_PORT,
      undefined,
      'Only the actual runtime check receives the port selector',
    );
});
