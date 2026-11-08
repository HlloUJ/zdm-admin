import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { readPreviewResponse } from './preview-consumers.mjs';

test('real HTTP distinguishes an unavailable responder, a timed-out socket and a closed port', async (t) => {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    if (request.url === '/unavailable') {
      response.writeHead(503);
      response.end('unavailable');
    } else if (request.url === '/metadata') {
      response.setHeader('content-type', 'application/json');
      response.end('{"type":"zdm-task-preview"}');
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) server.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await readPreviewResponse(url + '/unavailable')).statusCode, 503);
  assert.equal(JSON.parse((await readPreviewResponse(url + '/metadata')).body).type, 'zdm-task-preview');
  assert.equal((await readPreviewResponse(url + '/no-response', 100)).errorCode, 'ETIMEDOUT');
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
  assert.equal((await readPreviewResponse(url)).errorCode, 'ECONNREFUSED');
});
