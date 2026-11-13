import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledPlanExecutor } from './task-resource-plan-entry.mjs';
const step = (name) => ({ root: '/isolated-does-not-exist', name, command: 'fake', args: [], env: {} });
const plan = { preflight: step('preflight'), frontend: [step('frontend')], backend: [step('backend')] };
function setup(change = {}) {
  const calls = [];
  const task = {
    id: 'stable-task',
    owner: 'owner',
    worktree: plan.preflight.root,
    stage: 'developing',
    frozen: false,
    ...change,
  };
  const broker = {
    enqueue: async (d) => ({ id: d.stage }),
    waitAdmission: async () => ({}),
    assertAdmission: async () => {},
    complete: async () => {},
    block: async () => {},
  };
  const execute = createScheduledPlanExecutor({
    taskId: 'stable-task',
    owner: 'owner',
    broker,
    canonical: (p) => p,
    resolveTask: () => task,
    inspect: () => ({ fingerprint: 'fixture' }),
    run: async (s) => {
      calls.push(s.name);
      return { exitCode: 0 };
    },
  });
  return { execute, calls, options: { report() {}, capture: () => ({ digest: 'same' }) } };
}
test('single integration entry preserves original plan and pipelines', async () => {
  const s = setup();
  assert.equal(await s.execute(plan, s.options), 0);
  assert.deepEqual(s.calls, ['preflight', 'frontend', 'backend']);
});
test('wrong owner or frozen formal delivery is rejected without stage execution', async () => {
  for (const patch of [{ owner: 'other' }, { frozen: true }, { stage: 'delivering' }]) {
    const s = setup(patch);
    await assert.rejects(s.execute(plan, s.options));
    assert.equal(s.calls.length, 0);
  }
});
test('cross-worktree stage rejected rather than implicitly authorized', async () => {
  const s = setup();
  await assert.rejects(s.execute({ ...plan, frontend: [{ ...step('other'), root: '/other' }] }, s.options), /crosses/);
});
