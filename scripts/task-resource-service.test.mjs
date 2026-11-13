import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createSchedulerRpc, startSchedulerSocket, callScheduler, runSchedulerLoop } from './task-resource-service.mjs';
const secret = 'a'.repeat(48);
function setup() {
  let state = { rpcRequests: {} },
    calls = 0;
  const journal = { read: () => structuredClone(state), write: (s) => (state = structuredClone(s)) };
  const broker = {
    enqueue: async () => {
      calls++;
      return { id: 'job', token: 'ticket' };
    },
    snapshot: () => ({ calls }),
    waitAdmission: async () => ({ id: 'job', token: 'admitted' }),
  };
  return {
    journal,
    broker,
    get calls() {
      return calls;
    },
    get state() {
      return state;
    },
    dispatch: createSchedulerRpc({ broker, journal }),
  };
}
test('mutation request dedupes concurrent repeats and replays across restart', async () => {
  const s = setup(),
    r = { id: 'one', method: 'enqueue', args: [{}] };
  const [a, b] = await Promise.all([s.dispatch(r), s.dispatch(r)]);
  assert.deepEqual(a, b);
  assert.equal(s.calls, 1);
  const next = createSchedulerRpc(s);
  assert.deepEqual(await next(r), a);
  assert.equal(s.calls, 1);
});
test('same request ID with changed payload rejected', async () => {
  const s = setup();
  await s.dispatch({ id: 'one', method: 'enqueue', args: [{}] });
  await assert.rejects(s.dispatch({ id: 'one', method: 'enqueue', args: [{ changed: true }] }));
  assert.equal(s.calls, 1);
});
test('interrupted durable effect cannot be replayed', () => {
  assert.throws(
    () => createSchedulerRpc({ broker: {}, journal: { read: () => ({ rpcRequests: { x: { status: 'pending' } } }) } }),
    /Interrupted/,
  );
});
test('receipt write failure leaves pending effect and blocks further mutation', async () => {
  let writes = 0,
    state = { rpcRequests: {} },
    calls = 0;
  const journal = {
    read: () => state,
    write: (s) => {
      if (++writes === 2) throw Error('disk');
      state = s;
    },
  };
  const dispatch = createSchedulerRpc({
    broker: {
      enqueue: async () => {
        calls++;
        return 1;
      },
    },
    journal,
  });
  await assert.rejects(dispatch({ id: 'x', method: 'enqueue', args: [] }));
  assert.equal(calls, 1);
  assert.equal(state.rpcRequests.x.status, 'pending');
  await assert.rejects(dispatch({ id: 'y', method: 'enqueue', args: [] }));
  assert.equal(calls, 1);
});
test('wait receipt is reusable after lost response without second waiter registration', async () => {
  let count = 0;
  const s = setup();
  s.broker.waitAdmission = async () => {
    count++;
    return 'admission';
  };
  const r = { id: 'wait', method: 'waitAdmission', args: [] };
  assert.equal(await s.dispatch(r), 'admission');
  assert.equal(await s.dispatch(r), 'admission');
  assert.equal(count, 1);
});
test('loop serializes sampling and stops on errors rather than retrying forever', async () => {
  const controller = new AbortController();
  let ticks = 0,
    samples = 0;
  await runSchedulerLoop({
    broker: { tick: () => ticks++ },
    sample: async () => ++samples,
    signal: controller.signal,
    sleep: async () => {
      if (ticks === 3) controller.abort();
    },
  });
  assert.equal(ticks, 3);
  assert.equal(samples, 3);
  await assert.rejects(
    runSchedulerLoop({
      broker: { tick() {} },
      sample: async () => {
        throw Error('denied');
      },
      signal: new AbortController().signal,
    }),
    /denied/,
  );
});
test('private socket enforces capability and preserves existing listener', async () => {
  const dir = mkdtempSync('/tmp/zdm921-');
  chmodSync(dir, 0o700);
  const socketPath = dir + '/s';
  let server;
  try {
    server = await startSchedulerSocket({ socketPath, secret, dispatch: async (r) => r.id });
    await assert.rejects(callScheduler({ socketPath, secret: 'wrong', id: 'x', method: 'snapshot' }), /capability/);
    assert.equal(await callScheduler({ socketPath, secret, id: 'ok', method: 'snapshot' }), 'ok');
    await assert.rejects(startSchedulerSocket({ socketPath, secret, dispatch: () => {} }));
  } finally {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('real second-process socket call does not launch any gate task', async () => {
  const dir = mkdtempSync('/tmp/zdm921-');
  chmodSync(dir, 0o700);
  const socketPath = dir + '/s',
    s = setup();
  let server;
  try {
    server = await startSchedulerSocket({ socketPath, secret, dispatch: s.dispatch });
    const source = `import {callScheduler} from ${JSON.stringify(pathToFileURL(process.cwd() + '/scripts/task-resource-service.mjs').href)};const value=await callScheduler(${JSON.stringify({ socketPath, secret, id: 'child-read', method: 'snapshot' })});console.log(JSON.stringify(value));`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '',
      error = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (error += c));
    const [code] = await once(child, 'close');
    assert.equal(code, 0, error);
    assert.deepEqual(JSON.parse(output), { calls: 0 });
  } finally {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('request receipt survives actual disk store reopen without reissuing effect', async () => {
  const { openSchedulerStore } = await import('./task-resource-scheduler-store.mjs');
  const dir = mkdtempSync(process.cwd() + '/.task-runtime/rpc-journal-');
  let store;
  let calls = 0;
  try {
    store = openSchedulerStore(dir);
    const broker = {
      enqueue: async () => {
        calls++;
        return { id: 'once' };
      },
    };
    let dispatch = createSchedulerRpc({ broker, journal: store });
    const req = { id: 'persisted', method: 'enqueue', args: [] };
    assert.deepEqual(await dispatch(req), { id: 'once' });
    store.close();
    store = openSchedulerStore(dir);
    dispatch = createSchedulerRpc({ broker, journal: store });
    assert.deepEqual(await dispatch(req), { id: 'once' });
    assert.equal(calls, 1);
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
