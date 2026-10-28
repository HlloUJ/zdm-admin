import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { requestResponse, taskPreviewControlRequest, inspectManagedPreview, previewProbeFailure } from './dev-task.mjs';

test('expired idle connection plus synchronous work reproduces ECONNRESET; probe uses fresh connections', async (t) => {
  const closed = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(
    `const http = require('node:http');
     const { parentPort, workerData } = require('node:worker_threads');
     const closed = new Int32Array(workerData.closed);
     let idleSocket;
     const server = http.createServer((req,res) => { idleSocket=req.socket; res.end('{}'); });
     server.keepAliveTimeout=5000;
     parentPort.on('message', () => idleSocket.end(() => {
       Atomics.store(closed,0,1); Atomics.notify(closed,0);
     }));
     server.listen(0,'127.0.0.1',()=>parentPort.postMessage(server.address().port));`,
    { eval: true, workerData: { closed: closed.buffer } },
  );
  t.after(() => worker.terminate());
  const [port] = await once(worker, 'message');
  const agent = new http.Agent({ keepAlive: true });
  t.after(() => agent.destroy());
  const old = () =>
    new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/`, { agent }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.on('error', (error) => resolve({ code: error.code, reusedSocket: req.reusedSocket }));
    });
  assert.equal((await old()).status, 200);
  await new Promise(setImmediate);
  // Block only the client until the server has sent FIN; no guessed scheduler delay.
  worker.postMessage('expire');
  assert.notEqual(Atomics.wait(closed, 0, 0, 5000), 'timed-out');
  assert.deepEqual(await old(), { code: 'ECONNRESET', reusedSocket: true });
  assert.equal((await taskPreviewControlRequest(port)).statusCode, 200);
  Atomics.store(closed, 0, 0);
  worker.postMessage('expire');
  assert.notEqual(Atomics.wait(closed, 0, 0, 5000), 'timed-out');
  assert.equal((await taskPreviewControlRequest(port)).statusCode, 200);
  assert.equal((await requestResponse(`http://127.0.0.1:${port}/`)).statusCode, 200);
});

test('real probe rejects wrong identity, unhealthy API, invalid metadata, and never retries DELETE', async (t) => {
  let mode = 'valid',
    deletes = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'DELETE') {
      deletes++;
      req.socket.destroy();
      return;
    }
    if (req.url.includes('api_health')) {
      res.statusCode = mode === 'health' ? 503 : 200;
      res.end('{"status":"UP"}');
      return;
    }
    res.statusCode = mode === 'http' ? 503 : 200;
    res.end(
      mode === 'invalid'
        ? 'not json'
        : JSON.stringify({
            type: 'zdm-task-preview',
            workspaceRoot: '/task',
            branch: 'codex/task',
            mode: 'full',
            apiTarget: 'http://127.0.0.1:8081',
          }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const check = (extra) =>
    inspectManagedPreview({
      port,
      expectedWorkspaceRoot: '/task',
      expectedBranch: 'codex/task',
      expectedMode: 'full',
      expectedApiTarget: 'http://127.0.0.1:8081',
      ...extra,
    });
  assert.deepEqual((await check()).errors, []);
  assert.ok((await check({ expectedBranch: 'codex/other' })).errors.some((x) => x.includes('不是')));
  for (mode of ['health', 'http', 'invalid']) assert.ok((await check()).errors.length > 0, mode);
  const failed = await taskPreviewControlRequest(port, 'DELETE');
  assert.equal(failed.errorCode, 'ECONNRESET');
  assert.equal(deletes, 1);
  assert.match(previewProbeFailure(failed), /ECONNRESET/);
  assert.match(previewProbeFailure({ statusCode: 503 }), /HTTP 503/);
});
