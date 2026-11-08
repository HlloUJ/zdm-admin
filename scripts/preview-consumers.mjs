import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createResourceLeases } from './resource-lease.mjs';

export function readPreviewResponse(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs, agent: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () =>
        resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      );
      response.once('error', (error) =>
        resolve({ statusCode: 0, body: '', errorCode: error.code ?? 'RESPONSE_ERROR' }),
      );
      response.once('aborted', () => resolve({ statusCode: 0, body: '', errorCode: 'RESPONSE_ABORTED' }));
    });
    request.once('timeout', () => {
      request.destroy();
      resolve({ statusCode: 0, body: '', errorCode: 'ETIMEDOUT' });
    });
    request.once('error', (error) => resolve({ statusCode: 0, body: '', errorCode: error.code ?? 'NETWORK_ERROR' }));
  });
}

export function temporaryPreviewLeases(commonDir) {
  const leases = createResourceLeases(commonDir);
  return Array.from({ length: 23 }, (_, i) => 5177 + i).flatMap((port) => {
    const lease = leases.inspect('temporary-port-' + port);
    return lease ? [{ port, ...lease }] : [];
  });
}

function observation(port, response) {
  let metadata;
  if (response?.type === 'zdm-task-preview') metadata = response;
  else if (response?.statusCode === 200) {
    try {
      metadata = JSON.parse(response.body);
    } catch {
      /* A responding unleased web server is preserved below. */
    }
  }
  const recognized =
    metadata?.type === 'zdm-task-preview' &&
    typeof metadata.workspaceRoot === 'string' &&
    path.isAbsolute(metadata.workspaceRoot) &&
    typeof metadata.branch === 'string' &&
    ['full', 'frontend'].includes(metadata.mode) &&
    typeof metadata.apiTarget === 'string' &&
    /^http:\/\/127\.0\.0\.1:80(?:8[1-9]|9\d)$/.test(metadata.apiTarget);
  return {
    port,
    metadata: recognized ? metadata : null,
    closed: response?.statusCode === 0 && response.errorCode === 'ECONNREFUSED',
    responding: Number.isInteger(response?.statusCode) && response.statusCode >= 200 && response.statusCode < 500,
    errorCode: response?.errorCode ?? null,
    statusCode: response?.statusCode ?? null,
  };
}

// A failed probe is not evidence that a registered consumer disappeared. Only
// the owner of the exact already-stopped temporary child can acknowledge its
// closed port while retaining the lease until cleanup completes.
export async function inspectPreviewConsumers(
  { worktree, taskId, ports = [5175, 5176, ...Array.from({ length: 23 }, (_, i) => 5177 + i)], closingLeases = [] },
  { request = readPreviewResponse, readLeases } = {},
) {
  assert.equal(typeof readLeases, 'function', 'Explicit repository lease reader required');
  const before = readLeases();
  const observations = await Promise.all(
    ports.map(async (port) => observation(port, await request(`http://127.0.0.1:${port}/__zdm_task_preview__`, 1000))),
  );
  const after = readLeases();
  assert.deepEqual(after, before, 'Preview leases changed during consumer checks; preserve all runtimes');
  for (const item of observations) {
    const lease = after.find((lease) => lease.port === item.port);
    if (item.metadata) continue;
    if (lease) {
      const ownStopped =
        item.closed &&
        lease.task === taskId &&
        lease.pid === process.pid &&
        closingLeases.some(
          (closing) =>
            closing.resource === lease.resource &&
            closing.task === lease.task &&
            closing.pid === lease.pid &&
            closing.token === lease.token,
        );
      assert.ok(ownStopped, `Preview consumer state is unknown on leased port ${item.port}; retain source and backend`);
    } else
      assert.ok(
        item.closed || (item.port >= 5177 && item.responding),
        `Preview consumer state is unknown on port ${item.port}; retain source and backend`,
      );
  }
  return { worktree, observations, leases: after };
}
