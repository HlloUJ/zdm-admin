import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withTaskRegistryWriteLock } from './task-registry.mjs';
import { verifyCoordinatorSource } from './task-execution-binding.mjs';

function location(commonDir) {
  const file = path.join(commonDir, 'task-coordination', 'current.json');
  for (let cursor = file; ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked coordination record refused');
    if (cursor === path.dirname(cursor)) break;
  }
  return file;
}
export function readTaskCoordination(commonDir) {
  const file = location(commonDir);
  if (!existsSync(file)) {
    assert.ok(!existsSync(path.dirname(file)), 'Incomplete coordination publication; preserve existing state');
    return null;
  }
  assert.ok(lstatSync(file).isFile() && (lstatSync(file).mode & 0o077) === 0);
  const value = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(value.version, 1);
  assert.ok(Array.isArray(value.history) && value.history.length === value.revision);
  for (const [index, item] of value.history.entries()) {
    assert.equal(item.expectedRevision, index);
    assert.match(item.rootThreadId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.ok(item.request?.messageId && item.request.authorId && Number.isSafeInteger(item.request.sequence));
  }
  assert.deepEqual(value.current, value.history.at(-1));
  return value;
}
export function requireTaskCoordinator(commonDir, coordinator) {
  const policy = readTaskCoordination(commonDir);
  if (policy)
    assert.equal(
      coordinator,
      policy.current.rootThreadId,
      'Use the current authorized coordinator; historical root is provenance only',
    );
  return coordinator;
}
// Task authorization and a later coordinator appointment are separate events.
// A->B->C does not imply that A directly created C's native chat.
export async function verifyTaskAuthorization(commonDir, input, readThread) {
  const coordinator = input.coordinatorThreadId ?? input.rootThreadId;
  const policy = commonDir ? readTaskCoordination(commonDir) : null;
  if (commonDir) requireTaskCoordinator(commonDir, coordinator);
  const source = await verifyCoordinatorSource(input, readThread);
  if (coordinator !== input.rootThreadId)
    await verifyCoordinatorSource(policy?.current ?? { rootThreadId: coordinator, request: input.request }, readThread);
  return source;
}
export async function authorizeTaskCoordinator(commonDir, input, host) {
  assert.equal(process.env.CODEX_THREAD_ID, input.rootThreadId, 'Actual new coordinator runtime required');
  await verifyCoordinatorSource(input, host.readThread);
  const file = location(commonDir),
    directory = path.dirname(file);
  const previous = readTaskCoordination(commonDir);
  const event = { rootThreadId: input.rootThreadId, request: input.request, expectedRevision: input.expectedRevision };
  if (previous?.current.request.messageId === input.request.messageId) {
    assert.deepEqual(previous.current, event, 'Coordination replay changed');
    return previous;
  }
  assert.equal(previous?.revision ?? 0, input.expectedRevision, 'Coordination revision changed');
  if (previous) {
    assert.equal(input.request.authorId, previous.current.request.authorId, 'Original coordination user required');
    assert.ok(input.request.sequence > previous.current.request.sequence, 'Fresh coordination instruction required');
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return withTaskRegistryWriteLock(directory, () => {
    const currentFile = location(commonDir);
    const actual = existsSync(currentFile) ? JSON.parse(readFileSync(currentFile, 'utf8')) : null;
    assert.deepEqual(actual, previous, 'Coordination changed during native readback');
    const value = {
      version: 1,
      revision: (previous?.revision ?? 0) + 1,
      current: event,
      history: [...(previous?.history ?? []), event],
    };
    const temp = file + '.' + randomUUID();
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
    assert.deepEqual(readTaskCoordination(commonDir), value);
    return value;
  });
}
