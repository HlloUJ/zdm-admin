import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configureTaskNetwork, readBoardTask } from './task-network.mjs';

test('proxy selection respects no-proxy mode, existing values, NO_PROXY and explicit opt-out without logging credentials', () => {
  let calls = 0;
  assert.equal(configureTaskNetwork({}, () => calls++).enabled, false);
  assert.equal(
    configureTaskNetwork({ HTTP_PROXY: 'http://localhost:1234', NODE_USE_ENV_PROXY: '0' }, () => calls++).enabled,
    false,
  );
  const env = { all_proxy: 'http://user:private@localhost:1234', NO_PROXY: 'localhost' };
  const result = configureTaskNetwork(env, (observed) => {
    calls++;
    assert.equal(observed, env);
  });
  assert.equal(result.enabled, true);
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  assert.equal(env.HTTP_PROXY, env.all_proxy);
  assert.equal(env.HTTPS_PROXY, env.all_proxy);
  assert.equal(env.NO_PROXY, 'localhost');
  assert.equal(calls, 1);
  assert.throws(
    () => configureTaskNetwork({ HTTP_PROXY: 'http://private:secret@bad port' }),
    (error) => !error.message.includes('secret'),
  );
});

async function listen(t, handler) {
  const server = http.createServer(handler),
    sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return server;
}

test('real parent and child fetch use the configured proxy; no-proxy child remains direct', async (t) => {
  let hits = 0;
  const proxy = await listen(t, (_req, res) => {
    hits++;
    res.end('proxied');
  });
  proxy.on('connect', (_req, socket) => {
    hits++;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied'));
  });
  const address = `http://127.0.0.1:${proxy.address().port}`;
  const proxyEnv = {
    HTTP_PROXY: address,
    HTTPS_PROXY: address,
    http_proxy: address,
    https_proxy: address,
    NO_PROXY: '',
    no_proxy: '',
  };
  const configured = configureTaskNetwork(proxyEnv);
  t.after(() => configured.restore());
  assert.equal(await (await fetch('http://task-proxy.invalid/')).text(), 'proxied');
  const execute = promisify(execFile),
    module = new URL('./task-network.mjs', import.meta.url).href;
  const child = await execute(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import ${JSON.stringify(module)};process.stdout.write(await(await fetch('http://task-child.invalid/')).text())`,
    ],
    { env: { ...process.env, ...proxyEnv, ALL_PROXY: '', all_proxy: '' } },
  );
  assert.equal(child.stdout, 'proxied');
  assert.equal(hits, 2);
  const origin = await listen(t, (_req, res) => res.end('direct'));
  const directEnv = { ...process.env };
  for (const key of Object.keys(directEnv)) if (/proxy/i.test(key)) delete directEnv[key];
  const direct = await execute(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import ${JSON.stringify(module)};process.stdout.write(await(await fetch('http://127.0.0.1:${origin.address().port}/')).text())`,
    ],
    { env: directEnv },
  );
  assert.equal(direct.stdout, 'direct');
  assert.equal(hits, 2);
  const bypass = configureTaskNetwork({ HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1' });
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${origin.address().port}/`)).text(), 'direct');
  } finally {
    bypass.restore();
  }
});

for (const [status, body, category] of [
  [401, '{}', 'authentication'],
  [403, '{}', 'authorization'],
  [403, '<title>Attention Required! | Cloudflare</title>', 'network-policy'],
  [503, '{}', 'service'],
  [200, 'private-payload-not-json', 'invalid-response'],
]) {
  test(`board HTTP ${status} is classified as ${category} without disclosing token or body`, async () => {
    await assert.rejects(
      readBoardTask({
        url: 'https://board.invalid',
        token: 'private-token',
        id: 'task',
        fetchImpl: async () => ({ status, ok: status === 200, text: async () => body }),
      }),
      (error) =>
        error.category === category && !error.message.includes('private-token') && !error.message.includes(body),
    );
  });
}
test('network errors preserve safe diagnostic codes; malformed task identity cannot be accepted', async () => {
  await assert.rejects(
    readBoardTask({
      url: 'https://board.invalid',
      token: 'secret',
      id: 'task',
      fetchImpl: async () => {
        throw Object.assign(Error('secret'), { cause: { code: 'ECONNRESET' } });
      },
    }),
    (error) =>
      error.category === 'network' && error.message.includes('ECONNRESET') && !error.message.includes('secret'),
  );
  await assert.rejects(
    readBoardTask({
      url: 'https://board.invalid',
      token: 'secret',
      id: 'task',
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ data: { task: { id: 'other' } } }),
      }),
    }),
    /invalid-response/,
  );
});
