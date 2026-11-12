import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { taskPreviewControlRequest } from './dev-task.mjs';

test('native stop request transmits the expected runtime nonce without retrying or downgrading it', async (t) => {
  const observed = [];
  const server = http.createServer((request, response) => {
    observed.push(request.headers['x-zdm-task-runtime-id']);
    assert.equal(request.headers['x-zdm-task-preview-control'], 'switch-current-task');
    response.statusCode = observed.at(-1) === 'runtime-current' ? 202 : 409;
    response.end('checked');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  assert.equal((await taskPreviewControlRequest(port, 'DELETE', 1000, 'runtime-current')).statusCode, 202);
  assert.equal((await taskPreviewControlRequest(port, 'DELETE', 1000, 'runtime-stale')).statusCode, 409);
  assert.deepEqual(observed, ['runtime-current', 'runtime-stale']);
});
