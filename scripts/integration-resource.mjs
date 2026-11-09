import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { createResourceLeases } from './resource-lease.mjs';

const active = new AsyncLocalStorage();
const VARIABLE = 'ZDM_INTEGRATION_OPERATION';
function commonDirectory(root) {
  const value = execFileSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
  return realpathSync(path.resolve(root, value));
}
function validate(context, common) {
  assert.equal(context.common, common, 'Integration operation belongs to another repository');
  assert.deepEqual(
    createResourceLeases(common).inspect('integration-5173'),
    context.lease,
    'Integration operation ownership changed; preserve the current lease',
  );
  return context;
}
// The outermost public operation owns the lease until its synchronous or async
// work finishes. Nested helpers share it; unrelated operations fail before writes.
// A child may borrow it only through its direct parent's exact live capability.
export function withIntegrationResource(root, task, action) {
  const common = commonDirectory(root);
  const nested = active.getStore();
  if (nested) return action(validate(nested, common).lease);
  if (process.env[VARIABLE]) {
    const inherited = JSON.parse(process.env[VARIABLE]);
    assert.equal(inherited.parent, process.ppid, 'Integration delegation is not from this direct parent');
    validate(inherited, common);
    return active.run(inherited, () => action(inherited.lease));
  }
  const leases = createResourceLeases(common),
    lease = leases.acquire('integration-5173', task);
  return active.run({ common, lease }, () => {
    let result;
    try {
      result = action(lease);
    } catch (error) {
      // A changed lease is preserved by release's exact nonce check.
      leases.release(lease);
      throw error;
    }
    if (result && typeof result.then === 'function') return result.finally(() => leases.release(lease));
    leases.release(lease);
    return result;
  });
}
export function integrationChildEnvironment(environment = process.env) {
  const current = active.getStore();
  assert.ok(current, 'Child integration operation requires the parent resource scope');
  validate(current, current.common);
  return { ...environment, [VARIABLE]: JSON.stringify({ ...current, parent: process.pid }) };
}
// A journalled completion supervisor is an additional real process boundary.
// It validates the received capability before delegating it to its direct child.
export function forwardIntegrationEnvironment(environment = process.env) {
  if (!environment[VARIABLE]) return environment;
  const inherited = JSON.parse(environment[VARIABLE]);
  assert.equal(inherited.parent, process.ppid, 'Integration supervisor did not receive its direct parent capability');
  validate(inherited, realpathSync(inherited.common));
  return { ...environment, [VARIABLE]: JSON.stringify({ ...inherited, parent: process.pid }) };
}
