import assert from 'node:assert/strict';
import net from 'node:net';
import { chmodSync, lstatSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
const MUTATIONS = new Set([
  'enqueue',
  'assertAdmission',
  'pollAdmission',
  'recordSpawn',
  'complete',
  'block',
  'acknowledge',
]);
const READS = new Set(['snapshot', 'pendingNotifications', 'waitAdmission']);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Durable at-most-once mutations. A crash between effect and receipt deliberately blocks replay.
export function createSchedulerRpc({ broker, journal }) {
  let ledger = journal.read();
  ledger.rpcRequests ??= {};
  assert.ok(
    Object.values(ledger.rpcRequests).every((r) => r.status !== 'pending'),
    'Interrupted RPC effect is unconfirmed; reconcile before restart',
  );
  let chain = Promise.resolve(),
    fault = null;
  const inflight = new Map();
  return function request(req) {
    assert.ok(req && typeof req.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(req.id));
    assert.ok(MUTATIONS.has(req.method) || READS.has(req.method), 'Unsupported scheduler operation');
    assert.ok(Array.isArray(req.args));
    const digest = hash({ method: req.method, args: req.args });
    const duplicate = inflight.get(req.id);
    if (duplicate) {
      assert.equal(duplicate.digest, digest, 'Request ID reused for different operation');
      return duplicate.promise;
    }
    const invoke = async () => {
      if (fault) throw fault;
      const previous = ledger.rpcRequests[req.id];
      if (previous) {
        assert.equal(previous.digest, digest, 'Request ID reused for different operation');
        assert.equal(previous.status, 'done');
        if (previous.error) throw Error(previous.error);
        return previous.result;
      }
      if (!MUTATIONS.has(req.method)) return broker[req.method](...req.args);
      const save = (next) => {
        try {
          journal.write(next);
          ledger = next;
        } catch (error) {
          fault = error;
          throw error;
        }
      };
      let next = structuredClone(ledger);
      next.rpcRequests[req.id] = { digest, status: 'pending' };
      save(next);
      try {
        const result = await broker[req.method](...req.args);
        next = structuredClone(ledger);
        next.rpcRequests[req.id] = { digest, status: 'done', result: result ?? null };
        save(next);
        return result ?? null;
      } catch (error) {
        // If persistence became uncertain do not replace the pending receipt with an apparent clean failure.
        if (fault) throw error;
        next = structuredClone(ledger);
        next.rpcRequests[req.id] = { digest, status: 'done', error: error.message };
        save(next);
        throw error;
      }
    };
    const promise = MUTATIONS.has(req.method) ? chain.then(invoke) : invoke();
    if (MUTATIONS.has(req.method)) chain = promise.catch(() => {});
    inflight.set(req.id, { digest, promise });
    // Completed mutations are replayable from disk. Reads have no durable effects or execution authority.
    if (req.method !== 'waitAdmission') promise.finally(() => inflight.delete(req.id)).catch(() => {});
    return promise;
  };
}
function secretMatches(a, b) {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
// Explicit library start only. No LaunchAgent install, no TCP listener, no user tasks are discovered/adopted.
export async function startSchedulerSocket({ socketPath, secret, dispatch }) {
  assert.ok(typeof secret === 'string' && secret.length >= 32);
  const parent = socketPath.slice(0, socketPath.lastIndexOf('/'));
  const dir = lstatSync(parent);
  assert.ok(dir.isDirectory() && !dir.isSymbolicLink() && (dir.mode & 0o077) === 0, 'Socket directory must be private');
  const clients = new Set();
  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {});
    let data = '',
      received = false;
    socket.setTimeout(120000, () => socket.destroy());
    socket.on('data', (chunk) => {
      if (received) {
        socket.destroy();
        return;
      }
      data += chunk.toString('utf8');
      if (Buffer.byteLength(data) > 65536) {
        socket.destroy();
        return;
      }
      if (!data.includes('\n')) return;
      received = true;
      socket.pause();
      Promise.resolve()
        .then(() => {
          const req = JSON.parse(data.trim());
          assert.ok(secretMatches(req.secret, secret), 'Invalid scheduler capability');
          delete req.secret;
          return dispatch(req);
        })
        .then(
          (result) => socket.end(JSON.stringify({ ok: true, result }) + '\n'),
          (error) => socket.end(JSON.stringify({ ok: false, error: error.message }) + '\n'),
        );
    });
  });
  server.maxConnections = 32;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  chmodSync(socketPath, 0o600);
  return {
    close: async () => {
      for (const socket of clients) socket.destroy();
      await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    },
  };
}
export function callScheduler({ socketPath, secret, id, method, args = [], timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    socket.setTimeout(timeoutMs, () =>
      socket.destroy(
        Object.assign(Error('Scheduler response timed out; retain request ID for diagnosis/replay'), {
          code: 'ETIMEDOUT',
        }),
      ),
    );
    socket.once('connect', () => socket.write(JSON.stringify({ secret, id, method, args }) + '\n'));
    socket.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > 4 * 1024 * 1024) socket.destroy(Error('Scheduler response too large'));
    });
    socket.once('error', reject);
    socket.once('end', () => {
      try {
        const r = JSON.parse(data);
        if (!r.ok) throw Error(r.error);
        resolve(r.result);
      } catch (e) {
        reject(e);
      }
    });
  });
}
// Single awaited sampling cycle: no overlapping timers, errors stop the loop instead of unbounded retry.
export async function runSchedulerLoop({
  broker,
  sample,
  signal,
  intervalMs = 5000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  assert.ok(intervalMs >= 1000);
  while (!signal.aborted) {
    const reading = await sample();
    if (signal.aborted) break;
    broker.tick(reading);
    await sleep(intervalMs);
  }
}
