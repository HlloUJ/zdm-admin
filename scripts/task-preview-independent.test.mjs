import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createResourceLeases } from './resource-lease.mjs';
import { temporaryPreviewLeases } from './preview-consumers.mjs';
import { independentTaskPreview } from './task-preview-independent.mjs';

function fixture(t) {
  const common = mkdtempSync(path.join(tmpdir(), 'independent-preview-'));
  t.after(() => rmSync(common, { recursive: true, force: true }));
  const leases = createResourceLeases(common),
    views = new Map(),
    data = new Set(),
    backends = new Set();
  const calls = [],
    tasks = new Map(
      ['a', 'b', 'c'].map((id) => [
        id,
        {
          id,
          owner: 'chat-' + id,
          worktree: '/repo/' + id,
          branch: 'codex/' + id,
          resources: { dataScope: 'isolated-task' },
          repository: { commonDir: common },
          stage: 'developing',
        },
      ]),
    );
  const value = (args, key) => args[args.indexOf(key) + 1];
  const system = {
    registry: () => ({
      commonDir: common,
      resolve: ({ id, worktree }) => {
        const task = tasks.get(id);
        assert.equal(task.worktree, worktree, 'Task does not belong to this worktree');
        return task;
      },
    }),
    readData: (root) => data.has(root),
    prepareData: async (root, options) => {
      calls.push({ kind: 'prepare', root, options });
      data.add(root);
    },
    inspect: async ({ port }) => ({ metadata: views.get(port), errors: views.get(port)?.errors ?? [] }),
    run: async (args, options) => {
      const root = value(args, '--worktree'),
        task = [...tasks.values()].find((task) => task.worktree === root);
      calls.push({ kind: 'run', root, args, options });
      if (args.includes('--check')) return;
      if (args.includes('--stop')) {
        backends.delete(task.id);
        return;
      }
      assert.deepEqual(options, { independent: true });
      let port = args.includes('--port') ? Number(value(args, '--port')) : 5177;
      if (!args.includes('--port')) while (views.has(port)) port++;
      const lease = leases.acquire('temporary-port-' + port, task.id);
      backends.add(task.id);
      views.set(port, {
        type: 'zdm-task-preview',
        workspaceRoot: root,
        branch: task.branch,
        mode: 'full',
        apiTarget: 'http://127.0.0.1:' + (8081 + [...tasks.keys()].indexOf(task.id)),
        runtimeId: lease.token,
      });
    },
    references: async (task) => ({
      owned: [...views].filter(([, view]) => view.workspaceRoot === task.worktree).map(([port]) => ({ port })),
      backendPorts: backends.has(task.id) ? [8081 + [...tasks.keys()].indexOf(task.id)] : [],
    }),
    request: async (port, method, timeout, token) => {
      calls.push({ kind: 'stop-request', port, token });
      assert.equal(method, 'DELETE');
      assert.equal(views.get(port)?.runtimeId, token);
      views.delete(port);
      leases.release(leases.inspect('temporary-port-' + port));
      return { statusCode: 202 };
    },
    isOpen: async (port) => views.has(port),
    tick: async () => assert.fail('Fixture cleanup should have released the exact owner'),
  };
  const operation = (id, command, options = {}, dependencies = {}) =>
    independentTaskPreview(
      '/repo/' + id,
      { id, owner: 'chat-' + id, command, ...options },
      { ...system, ...dependencies },
    );
  return { common, leases, views, tasks, data, calls, backends, system, operation };
}

test('multiple independent tasks use different previews; unhealthy A does not block B or a third task', async (t) => {
  const f = fixture(t);
  const [a, b] = await Promise.all([f.operation('a', 'start'), f.operation('b', 'start')]);
  assert.equal(a.previews[0].port, 5177);
  assert.equal(b.previews[0].port, 5178);
  f.views.get(5177).errors = ['A API is unhealthy'];
  assert.equal((await f.operation('a', 'status')).runtimeReady, false);
  assert.equal((await f.operation('b', 'status')).runtimeReady, true);
  assert.equal((await f.operation('c', 'start')).previews[0].port, 5179);
  assert.equal(temporaryPreviewLeases(f.common).length, 3);
  assert.equal(f.leases.inspect('preview-5175'), null);
  assert.equal(f.calls.filter((call) => call.kind === 'prepare').length, 3);
  assert.equal(b.verificationProven, false);
});
test('first start explicitly prepares task data once; healthy reuse keeps the same source and runtime', async (t) => {
  const f = fixture(t);
  const first = await f.operation('a', 'start');
  const again = await f.operation('a', 'start');
  assert.equal(again.reused, true);
  assert.deepEqual(again.previews, first.previews);
  assert.equal(f.calls.filter((call) => call.kind === 'prepare').length, 1);
  assert.deepEqual(f.calls.find((call) => call.kind === 'prepare').options, { id: 'a', owner: 'chat-a', apply: true });
  assert.equal(f.calls.filter((call) => call.options?.independent).length, 1);
  assert.ok(f.calls.some((call) => call.args?.includes('--check')));
  await assert.rejects(f.operation('a', 'start', { port: 5180 }), /another port/);
});
test('wrong owner, wrong worktree, frozen source, historical recovery and legacy shared data refuse before mutation', async (t) => {
  for (const change of [
    (f) => {
      f.tasks.get('a').owner = 'another-chat';
    },
    (f) => {
      f.tasks.get('a').worktree = '/repo/other';
    },
    (f) => {
      f.tasks.get('a').frozen = { accepted: 'original' };
    },
    (f) => {
      f.tasks.get('a').recovery = { runtimeBlocked: true };
    },
    (f) => {
      f.tasks.get('a').resources.dataScope = 'persistent-preview';
    },
  ]) {
    const f = fixture(t);
    change(f);
    await assert.rejects(f.operation('a', 'start'));
    assert.equal(f.calls.length, 0);
    assert.equal(temporaryPreviewLeases(f.common).length, 0);
  }
});
test('invalid or failed data preparation is retained and never replaced by another data target', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.operation(
      'a',
      'start',
      {},
      {
        readData: () => {
          throw Error('corrupt retained data record');
        },
      },
    ),
    /corrupt retained/,
  );
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    f.operation(
      'a',
      'start',
      {},
      {
        prepareData: async () => {
          throw Error('initializing retained after Docker failure');
        },
      },
    ),
    /initializing retained/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.leases.inspect('task-preview-a'), null);
});
test('stop A closes only its nonce-bound frontend and backend while preserving B and all task data', async (t) => {
  const f = fixture(t);
  await f.operation('a', 'start');
  await f.operation('b', 'start');
  const b = structuredClone(f.views.get(5178));
  const stopped = await f.operation('a', 'stop');
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.dataRetained, true);
  assert.equal(f.views.has(5177), false);
  assert.deepEqual(f.views.get(5178), b);
  assert.equal(f.backends.has('a'), false);
  assert.equal(f.backends.has('b'), true);
  assert.equal(f.data.has('/repo/a'), true);
  assert.equal((await f.operation('b', 'status')).runtimeReady, true);
  assert.equal((await f.operation('a', 'start')).previews[0].port, 5177);
  assert.equal(f.calls.filter((call) => call.kind === 'prepare' && call.root === '/repo/a').length, 1);
});
test('foreign API consumers block stop before any DELETE or backend mutation', async (t) => {
  const f = fixture(t);
  await f.operation('a', 'start');
  const before = f.calls.length;
  await assert.rejects(
    f.operation(
      'a',
      'stop',
      {},
      {
        references: async () => {
          throw Error('Another frontend still uses this task backend');
        },
      },
    ),
    /Another frontend/,
  );
  assert.equal(f.calls.length, before);
  assert.equal(f.views.has(5177), true);
  assert.equal(f.backends.has('a'), true);
});
test('stale or legacy runtime identity and refused stop retain their source, port and backend', async (t) => {
  const f = fixture(t);
  await f.operation('a', 'start');
  const actual = f.views.get(5177).runtimeId;
  f.views.get(5177).runtimeId = 'runtime-replaced';
  await assert.rejects(f.operation('a', 'stop'), /matching runtime nonce/);
  assert.equal(
    f.calls.some((call) => call.kind === 'stop-request'),
    false,
  );
  f.views.get(5177).runtimeId = actual;
  await assert.rejects(f.operation('a', 'stop', {}, { request: async () => ({ statusCode: 409 }) }), /refused stop/);
  assert.equal(f.backends.has('a'), true);
  assert.ok(f.leases.inspect('temporary-port-5177'));
});
test('an unhealthy task is not silently restarted and unsuccessful backend stop cannot be reported as complete', async (t) => {
  const f = fixture(t);
  await f.operation('a', 'start');
  f.views.get(5177).errors = ['API unavailable'];
  await assert.rejects(f.operation('a', 'start'), /not healthy/);
  const run = f.system.run;
  await assert.rejects(
    f.operation(
      'a',
      'stop',
      {},
      {
        run: async (args, options) => {
          if (!args.includes('--stop')) return run(args, options);
        },
      },
    ),
    /backend is still running/,
  );
  assert.equal(f.backends.has('a'), true);
  assert.equal(f.data.has('/repo/a'), true);
});
