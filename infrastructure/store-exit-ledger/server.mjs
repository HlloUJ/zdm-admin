import http from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';

const root = process.env.ZDM_LEDGER_DIR ?? '/data/store-exit-ledger';
const namespace = process.env.ZDM_LEDGER_NAMESPACE ?? '';
const secret = process.env.ZDM_LEDGER_AUTH_TOKEN ?? '';
if (!/^[a-zA-Z0-9_]{1,64}$/.test(namespace) || secret.length < 32)
  throw new Error('Ledger scope or authentication is not configured');
const directory = path.join(root, namespace);
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const stages = new Set(['INTENT', 'COMMITTED', 'ROLLED_BACK']);
const identifier = (value) =>
  typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, 'en')))
      : v,
  );
function onlyKeys(value, keys) {
  return (
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((k) => keys.includes(k))
  );
}
function validate(entry, filename) {
  if (!onlyKeys(entry, ['operationId', 'storeId', 'tenantId', 'stage', 'ruleVersion', 'receipt']))
    throw new Error('Unexpected record fields');
  if (
    entry.stage === 'INTENT' &&
    (!onlyKeys(entry.receipt, ['accountIds', 'operatorAccountId', 'operatorName', 'operatorIdentity', 'acceptedAt']) ||
      !Array.isArray(entry.receipt.accountIds) ||
      !entry.receipt.accountIds.every(identifier))
  )
    throw new Error('Invalid intent metadata');
  if (entry.stage === 'INTENT' && Object.keys(entry.receipt).some((key) => key !== 'accountIds')) {
    const r = entry.receipt;
    if (
      !identifier(r.operatorAccountId) ||
      typeof r.operatorName !== 'string' ||
      r.operatorName.length > 200 ||
      typeof r.operatorIdentity !== 'string' ||
      r.operatorIdentity.length > 200 ||
      typeof r.acceptedAt !== 'string' ||
      !Number.isFinite(Date.parse(r.acceptedAt))
    )
      throw new Error('Invalid intent actor snapshot');
  }
  if (entry.stage === 'ROLLED_BACK' && !onlyKeys(entry.receipt, [])) throw new Error('Invalid rollback metadata');
  if (
    !entry ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.operationId) ||
    !identifier(entry.storeId) ||
    !identifier(entry.tenantId) ||
    !stages.has(entry.stage) ||
    entry.ruleVersion !== 'V1.3' ||
    filename !== `${entry.operationId}-${entry.stage}.json`
  )
    throw new Error('Invalid ledger record');
  if (entry.stage === 'COMMITTED') {
    const r = entry.receipt;
    if (
      !onlyKeys(r, [
        'operation_id',
        'store_id',
        'tenant_id',
        'store_name',
        'tenant_name',
        'store_created_by_account_id',
        'operator_account_id',
        'operator_name',
        'operator_identity',
        'rule_version',
        'plan_hash',
        'result_json',
        'created_at',
      ])
    )
      throw new Error('Unexpected receipt fields');
    for (const key of ['store_id', 'tenant_id']) if (!identifier(r[key])) throw new Error('Invalid receipt scope');
    for (const key of ['operator_account_id', 'store_created_by_account_id'])
      if (r[key] !== null && !identifier(r[key])) throw new Error('Invalid historical account');
    for (const key of ['store_name', 'tenant_name', 'operator_name', 'operator_identity'])
      if (typeof r[key] !== 'string' || r[key].length > 200) throw new Error('Invalid receipt snapshot');
    const result = JSON.parse(r.result_json);
    if (
      !onlyKeys(result, ['counts', 'retained', 'verified', 'mediaRelease', 'accountIds', 'actorSnapshots']) ||
      result.verified !== true ||
      !result.counts ||
      !Object.values(result.counts).every((n) => Number.isSafeInteger(n) && n >= 0) ||
      !Array.isArray(result.retained) ||
      !result.retained.every((v) => typeof v === 'string' && v.length <= 2000) ||
      !Array.isArray(result.accountIds) ||
      !result.accountIds.every(identifier)
    )
      throw new Error('Invalid minimal result');
    if (
      result.actorSnapshots !== undefined &&
      (!result.actorSnapshots ||
        typeof result.actorSnapshots !== 'object' ||
        Array.isArray(result.actorSnapshots) ||
        !Object.entries(result.actorSnapshots).every(
          ([id, name]) =>
            identifier(id) &&
            result.accountIds.some((account) => String(account) === id) &&
            typeof name === 'string' &&
            name.length <= 200,
        ))
    )
      throw new Error('Invalid historical actor snapshots');
    if (
      !result.mediaRelease ||
      !Object.entries(result.mediaRelease).every(([id, value]) => identifier(id) && typeof value === 'string')
    )
      throw new Error('Invalid media checkpoints');
    if (
      !r ||
      r.operation_id !== entry.operationId ||
      String(r.store_id) !== String(entry.storeId) ||
      String(r.tenant_id) !== String(entry.tenantId) ||
      r.rule_version !== 'V1.3' ||
      !/^[0-9a-f]{64}$/.test(r.plan_hash) ||
      typeof r.result_json !== 'string'
    )
      throw new Error('Invalid committed receipt');
  }
}
async function entries() {
  const result = [];
  for (const name of (await fs.readdir(directory)).filter((name) => name.endsWith('.json')).sort()) {
    const file = path.join(directory, name);
    if (!(await fs.lstat(file)).isFile() || (await fs.lstat(file)).isSymbolicLink())
      throw new Error('Unsafe ledger entry');
    const entry = JSON.parse(await fs.readFile(file, 'utf8'));
    validate(entry, name);
    result.push(entry);
  }
  return result;
}
function authenticated(request) {
  const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
  return (
    request.headers['x-zdm-ledger-scope'] === namespace &&
    Buffer.byteLength(token) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(secret))
  );
}
const respond = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
async function syncDirectory() {
  const dir = await fs.open(directory, 'r');
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}
const server = http.createServer(async (request, response) => {
  if (!authenticated(request)) return respond(response, 403, { error: 'Forbidden' });
  try {
    if (request.method === 'GET' && request.url === '/health') {
      await fs.access(directory, constants.R_OK | constants.W_OK);
      await entries();
      return respond(response, 200, { ready: true, namespace, capabilities: ['actor-snapshots-v1'] });
    }
    if (request.method === 'GET' && request.url === '/entries') return respond(response, 200, await entries());
    const match = /^\/entries\/([0-9a-f-]{36}-(?:INTENT|COMMITTED|ROLLED_BACK)\.json)$/.exec(request.url ?? '');
    if (request.method !== 'PUT' || !match) return respond(response, 404, { error: 'Not found' });
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        respond(response, 413, { error: 'Record too large' });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const entry = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    validate(entry, match[1]);
    const file = path.join(directory, match[1]);
    const bytes = canonical(entry);
    try {
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Unsafe receipt path');
      const old = JSON.parse(await fs.readFile(file, 'utf8'));
      if (canonical(old) !== bytes) return respond(response, 409, { error: 'Immutable receipt conflict' });
      await syncDirectory();
      return respond(response, 200, { persisted: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const temporary = path.join(directory, `.${match[1]}-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // Link is an atomic create-if-absent, so two instances cannot overwrite a receipt.
      await fs.link(temporary, file);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (canonical(JSON.parse(await fs.readFile(file, 'utf8'))) !== bytes)
        return respond(response, 409, { error: 'Immutable receipt conflict' });
    } finally {
      await fs.unlink(temporary);
    }
    await syncDirectory();
    return respond(response, 201, { persisted: true });
  } catch {
    // Do not log credentials or business/receipt bodies.
    respond(response, 503, { error: 'Ledger cannot prove durable state' });
  }
});
server.listen(Number(process.env.PORT ?? 8090), '0.0.0.0', () =>
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`),
);
