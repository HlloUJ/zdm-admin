import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function readFixedAcceptancePolicy(common) {
  const file = path.join(common, 'fixed-acceptance/policy.json');
  if (!existsSync(file)) return null;
  assert.ok(lstatSync(file).isFile() && realpathSync(file) === file, 'Unsafe fixed acceptance policy');
  const value = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(value.version, 1);
  assert.equal(value.common, common);
  assert.equal(value.port, 5179);
  assert.equal(value.enabled, true);
  assert.match(value.executor ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(Array.isArray(value.initialCompletions));
  assert.ok(value.initialCompletions.every((digest) => /^[a-f0-9]{64}$/.test(digest)));
  return value;
}

// The queue completion is already persisted. The inbox is a durable notification;
// a missing notification can always be recovered from the authoritative queue.
export function captureFixedAcceptanceIntake(common, ticket, previous) {
  if (
    ticket.lane !== 'development' ||
    ticket.executionKind !== 'business' ||
    ticket.status !== 'completed' ||
    previous?.completion?.digest === ticket.completion?.digest
  )
    return null;
  const policy = readFixedAcceptancePolicy(common);
  if (!policy || policy.initialCompletions.includes(ticket.completion.digest)) return null;
  const { digest, evidence } = ticket.completion;
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.match(evidence.head, /^[a-f0-9]{40}$/);
  assert.equal(evidence.task, ticket.task);
  assert.equal(evidence.owner, ticket.owner);
  const entry = { version: 1, task: ticket.task, owner: ticket.owner, head: evidence.head, completion: digest };
  const directory = path.join(common, 'fixed-acceptance/inbox');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.equal(realpathSync(directory), directory, 'Linked fixed acceptance inbox refused');
  const file = path.join(directory, digest + '.json');
  try {
    writeFileSync(file, JSON.stringify(entry) + '\n', { flag: 'wx', mode: 0o600, flush: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert.ok(lstatSync(file).isFile() && realpathSync(file) === file, 'Unsafe prior fixed acceptance notification');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), entry);
  }
  return entry;
}
