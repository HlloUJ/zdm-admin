import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedulerEntry, createSchedulerClient } from './task-resource-entry.mjs';
test('explicit endpoint options separated from unchanged verify arguments', () => {
  assert.deepEqual(
    parseSchedulerEntry(['--task', 'stable', '--socket', '/s', '--capability-file', '/c', '--', '--browser', 'chrome']),
    { taskId: 'stable', socketPath: '/s', capabilityFile: '/c', verificationArgs: ['--browser', 'chrome'] },
  );
  assert.throws(() => parseSchedulerEntry(['--task', 'a', '--task', 'b']));
});
test('resource waits use short renewable polls; mutating requests retain failed identity', async () => {
  const calls = [];
  const client = createSchedulerClient({
    socketPath: '/fixture',
    secret: 'not-a-real-secret',
    request: async (r) => {
      calls.push(r);
      if (r.method === 'enqueue') throw Error('lost reply');
      return { status: 'admitted', admission: { id: 'job', token: 't' } };
    },
  });
  await client.waitAdmission({ id: 'j' });
  assert.equal(calls[0].timeoutMs, 30000);
  assert.equal(calls[0].method, 'pollAdmission');
  await assert.rejects(client.enqueue({}), (e) => !!e.schedulerRequest?.id && e.schedulerRequest.method === 'enqueue');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].id, calls[1].id);
});

test('transient polling disconnection reuses request ID without duplicate registration', async () => {
  const calls = [];
  let count = 0;
  const client = createSchedulerClient({
    socketPath: '/fixture',
    secret: 'test',
    sleep: async () => {},
    request: async (r) => {
      calls.push(r);
      if (++count === 1) throw Object.assign(Error('reply lost'), { code: 'ECONNRESET' });
      return { status: 'admitted', admission: { id: 'one', token: 'one' } };
    },
  });
  assert.equal((await client.waitAdmission({ id: 'one' })).id, 'one');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].id, calls[1].id);
  assert.deepEqual(calls[0].args, calls[1].args);
});
test('persistent network failure stops after bounded retries', async () => {
  let calls = 0;
  const client = createSchedulerClient({
    socketPath: '/fixture',
    secret: 'test',
    sleep: async () => {},
    request: async () => {
      calls++;
      throw Object.assign(Error('offline'), { code: 'ECONNREFUSED' });
    },
  });
  await assert.rejects(client.waitAdmission({ id: 'one' }));
  assert.equal(calls, 3);
});
