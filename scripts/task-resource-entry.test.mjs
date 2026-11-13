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
test('resource waits do not use shorter timeout than recovery; mutating requests retain failed identity', async () => {
  const calls = [];
  const client = createSchedulerClient({
    socketPath: '/fixture',
    secret: 'not-a-real-secret',
    request: async (r) => {
      calls.push(r);
      if (r.method === 'enqueue') throw Error('lost reply');
      return 'ok';
    },
  });
  await client.waitAdmission({ id: 'j' });
  assert.equal(calls[0].timeoutMs, 0);
  await assert.rejects(client.enqueue({}), (e) => !!e.schedulerRequest?.id && e.schedulerRequest.method === 'enqueue');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].id, calls[1].id);
});
