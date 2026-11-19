import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const source = path.resolve('infrastructure/store-exit-ledger/server.mjs');
async function start(directory, token, namespace) {
  const child = spawn(process.execPath, [source], {
    env: {
      ...process.env,
      PORT: '0',
      ZDM_LEDGER_DIR: directory,
      ZDM_LEDGER_AUTH_TOKEN: token,
      ZDM_LEDGER_NAMESPACE: namespace,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [chunk] = await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => {
      throw new Error('Ledger server exited before ready');
    }),
  ]);
  const address = `http://127.0.0.1:${JSON.parse(String(chunk).trim()).port}`;
  return {
    address,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    },
  };
}
test('independent ledger authenticates, isolates, preserves immutable receipts and survives restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zdm-exit-ledger-'));
  const token = randomBytes(32).toString('hex');
  const namespace = 'isolated_test';
  let server = await start(directory, token, namespace);
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-zdm-ledger-scope': namespace,
    'content-type': 'application/json',
  };
  const id = randomUUID();
  const filename = `${id}-INTENT.json`;
  const entry = {
    operationId: id,
    storeId: '9007199254740993',
    tenantId: '1',
    stage: 'INTENT',
    ruleVersion: 'V1.3',
    receipt: { accountIds: ['9007199254740995'] },
  };
  try {
    assert.equal((await fetch(`${server.address}/health`)).status, 403);
    assert.equal(
      (await fetch(`${server.address}/health`, { headers: { ...headers, 'x-zdm-ledger-scope': 'another_tenant' } }))
        .status,
      403,
    );
    assert.equal((await fetch(`${server.address}/health`, { headers })).status, 200);
    assert.equal(
      (await fetch(`${server.address}/entries/${filename}`, { method: 'PUT', headers, body: JSON.stringify(entry) }))
        .status,
      201,
    );
    assert.equal(
      (
        await fetch(`${server.address}/entries/${filename}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...entry, receipt: { accountIds: ['9007199254740995'] } }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${server.address}/entries/${filename}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...entry, storeId: '2' }),
        })
      ).status,
      409,
    );
    await server.stop();
    server = await start(directory, token, namespace);
    const readback = await (await fetch(`${server.address}/entries`, { headers })).json();
    assert.deepEqual(readback, [entry]);
    assert.equal(
      (await fetch(`${server.address}/entries/../../outside`, { method: 'PUT', headers, body: '{}' })).status,
      404,
    );
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
