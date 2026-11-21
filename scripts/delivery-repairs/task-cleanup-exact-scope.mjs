import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';

export const SCOPE_ID = '683-original987-150-review-v1';
export const SCOPE_DIGEST = 'b6934241d973a2232275991324d457a58fcdab32a0690043b9722b7283a9993e';
const SOURCE = 'delivery-standard-optimization';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const capabilities = new WeakSet();
const canonicalPairs = (entries) => JSON.stringify(entries.map(({ key, manifestSha256 }) => ({ key, manifestSha256 })));

function unlinkedStat(file) {
  assert.equal(path.resolve(file), file, 'Noncanonical scope path');
  let target;
  for (let p = file; ; p = path.dirname(p)) {
    try {
      const stat = fs.lstatSync(p);
      assert.ok(!stat.isSymbolicLink(), 'Linked scope path');
      if (p === file) target = stat;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (p === path.dirname(p)) break;
  }
  return target;
}

export function loadExactCleanupScope(common, policy) {
  assert.deepEqual(
    policy.scope,
    { version: 1, id: SCOPE_ID, sourceTask: SOURCE, manifestSetSha256: SCOPE_DIGEST },
    'Unknown or missing exact cleanup scope',
  );
  assert.equal(policy.limit, 10, 'Exact scope retains ten-object budget');
  assert.equal(policy.budgetMs, 120000, 'Exact scope retains time budget');
  assert.equal(policy.maxLogicalBytes, 1073741824, 'Exact scope retains byte budget');
  const scopeFile = path.join(common, 'task-cleanup/scopes', SCOPE_ID + '.json');
  const authorizationFile = path.join(common, 'task-cleanup/scope-authorizations', SCOPE_ID + '.json');
  const read = (file) => {
    const s = unlinkedStat(file);
    assert.ok(s?.isFile() && s.nlink === 1 && !(s.mode & 0o077) && s.size <= 2 * 1024 ** 2, 'Unsafe scope metadata');
    return fs.readFileSync(file);
  };
  const raw = read(scopeFile),
    document = JSON.parse(raw);
  // Approval is a separate record. Never change the original review artifact's false flag.
  const approvalRaw = read(authorizationFile),
    approval = JSON.parse(approvalRaw);
  assert.equal(approval.status, 'approved', 'Physical deletion scope not approved');
  assert.equal(approval.scopeId, SCOPE_ID);
  assert.equal(approval.sourceTask, SOURCE);
  assert.equal(approval.manifestSetSha256, SCOPE_DIGEST);
  assert.ok(typeof approval.userMessageId === 'string' && approval.userMessageId, 'Actual approval reference missing');
  assert.equal(document.scopeId, SCOPE_ID);
  assert.equal(document.sourceTask, SOURCE);
  assert.equal(document.physicalDeletionAuthorized, false, 'Keep review snapshot unchanged');
  assert.equal(document.entries.length, 150, 'Exact scope must contain the original 150 members');
  const members = new Map();
  let previous = '';
  for (const entry of document.entries) {
    assert.match(entry.key, /^[a-f0-9]{64}$/);
    assert.ok(entry.key > previous, 'Duplicate or unordered exact scope member');
    previous = entry.key;
    assert.equal(entry.sourceTask, SOURCE);
    assert.equal(entry.producer, 'task-completion-handoff-v1');
    assert.equal(entry.manifestPath, path.join(common, 'task-cleanup/staging', SOURCE, entry.key, 'manifest.json'));
    members.set(entry.key, entry);
  }
  assert.equal(hash(canonicalPairs(document.entries)), SCOPE_DIGEST, 'Approved manifest set changed');
  const identity = Object.freeze({ version: 1, id: SCOPE_ID, sourceTask: SOURCE, manifestSetSha256: SCOPE_DIGEST });
  const recheck = () => {
    assert.equal(hash(read(scopeFile)), hash(raw), 'Scope changed during execution');
    assert.equal(hash(read(authorizationFile)), hash(approvalRaw), 'Scope approval changed during execution');
  };
  const capability = {
    identity,
    has: (key) => members.has(key),
    recheck,
    observedMissing: (key) => {
      const { manifestPath } = members.get(key);
      const carrier = path.dirname(manifestPath);
      return ![manifestPath, path.join(carrier, 'content'), path.join(carrier, 'deleting')].some(unlinkedStat);
    },
    assertRecord: (key, record) => {
      recheck();
      const member = members.get(key);
      assert.ok(member, 'Object outside approved exact scope');
      assert.equal(record.key, key);
      assert.equal(record.task, SOURCE, 'Wrong scoped source task');
      const bytes = read(member.manifestPath);
      assert.equal(hash(bytes), member.manifestSha256, 'Scoped manifest changed');
      const manifest = JSON.parse(bytes);
      for (const field of ['task', 'producer', 'disposition', 'identity', 'proof', 'carrier', 'path'])
        assert.deepEqual(record[field], manifest[field], 'Scoped original record changed: ' + field);
      assert.equal(record.disposition, member.disposition);
      assert.equal(record.proof.rebuild.kind, member.kind);
      assert.equal(record.identity.bytes, member.logicalBytes);
      if (record.state !== 'pending' || record.cleanupScope !== undefined)
        assert.deepEqual(record.cleanupScope, identity, 'Interrupted object scope differs');
      return {
        identity,
        key,
        scopeFile,
        authorizationFile,
        scopeDocumentSha256: hash(raw),
        authorizationSha256: hash(approvalRaw),
        manifestPath: member.manifestPath,
      };
    },
    assertResume: (old) => assert.deepEqual(old, identity, 'Recovery scope differs'),
    verifyConsumer: async (key, record, checks) => {
      capability.assertRecord(key, record);
      for (const name of ['closed', 'content', 'unreferenced'])
        assert.equal(typeof checks[name], 'function', 'Mandatory consumer proof missing: ' + name);
      assert.equal((await checks.closed(record))?.ready, true, 'Source task not formally closed');
      assert.equal(await checks.content(record), true, 'Scoped content proof unavailable');
      await checks.unreferenced(record);
      return capability.assertRecord(key, record);
    },
  };
  capabilities.add(capability);
  return Object.freeze(capability);
}

export function requireExactScope(scope) {
  assert.ok(capabilities.has(scope), 'Validated exact scope capability required');
  return scope;
}
