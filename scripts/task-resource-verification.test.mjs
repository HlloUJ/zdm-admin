import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledVerification } from './task-resource-verification.mjs';
const task = {
  root: '/task',
  name: 'backend tests',
  command: 'npm',
  args: ['run', 'backend:test'],
  kind: 'backend',
  env: { DONT_CHANGE: 'yes' },
  coverage: ['entire suite'],
};
function setup(overrides = {}) {
  const calls = [];
  const broker = {
    enqueue: async (d) => {
      calls.push(['enqueue', d]);
      return 'ticket';
    },
    waitAdmission: async () => {
      calls.push(['admit']);
      return { ticket: 'ticket' };
    },
    assertAdmission: async () => calls.push(['verify-admission']),
    complete: async (t, r) => calls.push(['complete', r]),
    block: async (t, r) => calls.push(['block', r]),
    ...overrides.broker,
  };
  const run = async (t, o) => {
    calls.push(['run', t, o]);
    return { exitCode: 0, evidence: 'original-evidence' };
  };
  return {
    calls,
    execute: createScheduledVerification({
      taskId: '921',
      broker,
      run,
      inspect: () => ({ fingerprint: 'same', inputProofComplete: true }),
      ...overrides,
    }),
  };
}
test('gate waits admission, preserves exact original task/options and evidence', async () => {
  const s = setup();
  const options = { force: false, report: () => {} };
  const result = await s.execute(task, options);
  assert.deepEqual(
    s.calls.map((c) => c[0]),
    ['enqueue', 'admit', 'verify-admission', 'run', 'complete'],
  );
  assert.equal(s.calls[3][1], task);
  assert.equal(s.calls[3][2], options);
  assert.equal(result.evidence, 'original-evidence');
  assert.equal(s.calls[0][1].restartable, false);
  assert.equal(s.calls[0][1].externalResources, true);
  assert.equal(s.calls[0][1].env, undefined);
});
test('changed queued input never executes', async () => {
  let n = 0;
  const s = setup({ inspect: () => ({ fingerprint: ++n === 1 ? 'same' : 'changed' }) });
  await assert.rejects(s.execute(task));
  assert.equal(
    s.calls.some((c) => c[0] === 'run'),
    false,
  );
  assert.equal(s.calls.at(-1)[0], 'block');
});
test('permissions and failed tests block exactly once without retry', async () => {
  let runs = 0;
  const s = setup({
    run: async () => {
      runs++;
      return { exitCode: 1, reason: 'permission denied' };
    },
  });
  assert.equal((await s.execute(task)).exitCode, 1);
  assert.equal(runs, 1);
  assert.equal(s.calls.at(-1)[0], 'block');
});
test('missing broker is not substituted with logs or automatic admission', () => {
  assert.throws(() => createScheduledVerification({ taskId: '921' }));
});
test('missing identity does not queue', async () => {
  const s = setup({ inspect: () => ({ fingerprint: 'same', inputProofComplete: false }) });
  await assert.rejects(s.execute(task));
  assert.deepEqual(s.calls, []);
});
test('invalid admission blocks before gate run', async () => {
  const calls = [];
  const broker = {
    enqueue: async () => 1,
    waitAdmission: async () => null,
    assertAdmission: async () => {
      throw Error('no lease');
    },
    complete: async () => {},
    block: async () => calls.push('blocked'),
  };
  let ran = false;
  const fn = createScheduledVerification({
    taskId: '921',
    broker,
    inspect: () => ({ fingerprint: 'same' }),
    run: async () => {
      ran = true;
    },
  });
  await assert.rejects(fn(task));
  assert.equal(ran, false);
  assert.deepEqual(calls, ['blocked']);
});
test('queued command/environment mutation rejected even if source identity unchanged', async () => {
  const t = structuredClone(task);
  let ran = false;
  const broker = {
    enqueue: async () => 1,
    waitAdmission: async () => {
      t.args = ['run', 'other'];
      return 1;
    },
    assertAdmission: async () => {},
    complete: async () => {},
    block: async () => {},
  };
  const fn = createScheduledVerification({
    taskId: '921',
    broker,
    inspect: () => ({ fingerprint: 'same' }),
    run: async () => {
      ran = true;
    },
  });
  await assert.rejects(fn(t));
  assert.equal(ran, false);
});
