import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskRegistry } from './task-registry.mjs';
import { deliveryStatus } from './completion-status.mjs';
import { runOwnershipCleanup } from './task-cleanup-ownership.mjs';
import { cleanupTestResources } from './task-cleanup-test-resources.mjs';
import { createCleanupQueue, cleanupObjectId, safePath } from './task-cleanup-queue.mjs';
import {
  cleanupNotice,
  cleanupNoticeState,
  claimCleanupNotice,
  acknowledgeCleanupNotice,
  nativeCommentaryCleanupEnvelope,
} from './task-cleanup-notification.mjs';

export function loadCleanupPolicy(commonDir) {
  const file = path.join(commonDir, 'task-cleanup', 'policy.json');
  safePath(file);
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && (stat.mode & 0o077) === 0, 'Owner-only cleanup policy required');
  const policy = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(
    Object.keys(policy).every((key) =>
      [
        'budgetMs',
        'limit',
        'maxLogicalBytes',
        'version',
        'scheduler',
        'metadata',
        'notification',
        'ownershipV2',
      ].includes(key),
    ),
  );
  assert.equal(policy.version, 1);
  assert.ok(policy.ownershipV2 === undefined || typeof policy.ownershipV2 === 'boolean');
  assert.ok(Number.isSafeInteger(policy.limit) && policy.limit > 0 && policy.limit <= 100);
  assert.ok(Number.isSafeInteger(policy.budgetMs) && policy.budgetMs > 0 && policy.budgetMs <= 300000);
  assert.ok(Number.isSafeInteger(policy.maxLogicalBytes) && policy.maxLogicalBytes > 0);
  if (policy.scheduler) {
    assert.deepEqual(Object.keys(policy.scheduler).sort(), ['historyLimit', 'maxSummaryBytes']);
    assert.ok(
      Number.isSafeInteger(policy.scheduler.historyLimit) &&
        policy.scheduler.historyLimit >= 1 &&
        policy.scheduler.historyLimit <= 100,
    );
    assert.ok(
      Number.isSafeInteger(policy.scheduler.maxSummaryBytes) &&
        policy.scheduler.maxSummaryBytes >= 256 &&
        policy.scheduler.maxSummaryBytes <= 8192,
    );
  }
  if (policy.metadata) {
    assert.deepEqual(Object.keys(policy.metadata).sort(), ['compactLimit', 'maxDetails', 'retentionMs']);
    assert.ok(Number.isSafeInteger(policy.metadata.retentionMs) && policy.metadata.retentionMs >= 0);
    assert.ok(Number.isSafeInteger(policy.metadata.maxDetails) && policy.metadata.maxDetails >= 0);
    assert.ok(
      Number.isSafeInteger(policy.metadata.compactLimit) &&
        policy.metadata.compactLimit > 0 &&
        policy.metadata.compactLimit <= 1000,
    );
  }
  if (policy.notification) {
    assert.deepEqual(Object.keys(policy.notification), ['destination']);
    assert.ok(typeof policy.notification.destination === 'string' && policy.notification.destination.trim());
  }
  return {
    limit: policy.limit,
    ...(policy.ownershipV2 ? { ownershipV2: true } : {}),
    budgetMs: policy.budgetMs,
    maxLogicalBytes: policy.maxLogicalBytes,
    ...(policy.scheduler ? { scheduler: policy.scheduler } : {}),
    ...(policy.metadata ? { metadata: policy.metadata } : {}),
    ...(policy.notification ? { notification: policy.notification } : {}),
  };
}

export async function verifyCleanupDelivery(registry, r, { readDelivery = deliveryStatus } = {}) {
  const task = registry.readTask(r.task);
  assert.ok(task, 'Unknown cleanup task');
  assert.equal(task.id, r.task, 'Wrong cleanup task registry record');
  assert.equal(r.proof?.worktree, task.worktree, 'Original worktree differs');
  assert.equal(r.proof?.head, task.recordedHead, 'Candidate differs');
  assert.equal(r.proof?.accepted, task.frozen?.accepted, 'Acceptance differs');
  assert.equal(
    r.carrier,
    path.join(registry.commonDir, 'task-cleanup', 'staging', task.id, cleanupObjectId(r)),
    'Foreign cleanup carrier',
  );
  assert.equal(r.path, path.join(r.carrier, 'content'));
  if (task.stage !== 'closed') return { ready: false, reason: 'Waiting for formal task closure' };
  assert.equal(r.proof.main, task.main?.local, 'Formal main differs');
  assert.equal(
    readDelivery(path.join(registry.commonDir, 'task-delivery', task.id), task.id, task).formalDeliveryComplete,
    true,
    'Formal delivery not proven',
  );
  return { ready: true };
}
export function assertCleanupUnreferenced(r, { run = spawnSync, exec = execFileSync, env = process.env } = {}) {
  const p = run('lsof', ['-nP', '-t', '+D', r.path], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.ok(!p.error && p.status === 1 && !p.stdout && !p.stderr, 'Open-file reference check busy or unavailable');
  const endpoint =
    env.DOCKER_HOST && !env.DOCKER_CONTEXT
      ? env.DOCKER_HOST
      : JSON.parse(
          exec('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], {
            encoding: 'utf8',
            timeout: 15000,
          }),
        );
  assert.match(endpoint ?? '', /^unix:\/\//, 'Only local Docker inventory can prove references');
  const ids = exec('docker', ['ps', '-aq'], { encoding: 'utf8', timeout: 15000 }).trim().split(/\s+/).filter(Boolean);
  for (const id of ids) assert.match(id, /^[a-f0-9]{12,64}$/, 'Unknown container identity');
  if (ids.length)
    for (const container of JSON.parse(
      exec('docker', ['inspect', ...ids], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 }),
    )) {
      assert.ok(Array.isArray(container.Mounts), 'Unknown container mounts');
      for (const mount of container.Mounts)
        if (mount.Source) {
          // Docker Desktop commonly exposes /host_mnt-prefixed host paths.
          const source = path.resolve(mount.Source.replace(/^\/host_mnt(?=\/)/, '')),
            target = path.resolve(r.path);
          assert.ok(
            source !== target && !source.startsWith(target + path.sep) && !target.startsWith(source + path.sep),
            'Container configuration references cleanup object',
          );
        }
    }
}
export async function cleanupCommand(
  root,
  args,
  {
    registry = createTaskRegistry(root),
    queue = createCleanupQueue(registry.commonDir),
    unreferenced = assertCleanupUnreferenced,
  } = {},
) {
  const verify = (r) => verifyCleanupDelivery(registry, r);
  if (args[0] === 'schedule-status') {
    assert.equal(args.length, 1);
    const result = {};
    for (const [key, name] of [
      ['schedule', 'scheduler-state.json'],
      ['startup', 'scheduler-startup-error.json'],
    ]) {
      const file = path.join(queue.base, name);
      safePath(file);
      if (!existsSync(file)) {
        result[key] = null;
        continue;
      }
      const stat = lstatSync(file);
      assert.ok(stat.isFile() && !(stat.mode & 0o077) && stat.size <= 2 * 1024 ** 2);
      result[key] = JSON.parse(readFileSync(file));
    }
    return result;
  }
  if (args[0] === 'pending-notifications') {
    assert.equal(args.length, 1);
    return {
      status: 'pending',
      notifications: queue
        .pendingNotifications()
        .map((event) => ({ ...cleanupNotice(event), delivery: cleanupNoticeState(queue, event) })),
      delivery: 'unverified',
    };
  }
  if (['claim-notification', 'ack-notification', 'ack-native-commentary'].includes(args[0])) {
    assert.equal(args.length, 2);
    safePath(path.resolve(args[1]));
    const envelope = JSON.parse(readFileSync(args[1], 'utf8'));
    const event = queue
      .pendingNotifications({ limit: 100 })
      .find((r) => r.key === envelope.key && r.id === envelope.id);
    assert.ok(event, 'Exact pending notification no longer available');
    assert.equal(envelope.eventId, cleanupNotice(event).eventId);
    const destination = loadCleanupPolicy(registry.commonDir).notification?.destination;
    assert.ok(destination, 'Fixed notification destination not configured');
    return args[0] === 'claim-notification'
      ? claimCleanupNotice(queue, event, destination)
      : acknowledgeCleanupNotice(
          queue,
          event,
          args[0] === 'ack-native-commentary'
            ? nativeCommentaryCleanupEnvelope(event, envelope.observation, destination)
            : envelope,
          destination,
        );
  }
  if (args[0] === 'handoff') {
    assert.equal(args.length, 2);
    const record = JSON.parse(readFileSync(args[1], 'utf8'));
    // A pre-close manifest may be accepted; the consumer independently waits for complete closure.
    await verify(record);
    return queue.handoff(record);
  }
  if (args[0] === 'ownership-plan' || args[0] === 'run-ownership') {
    assert.equal(args.length, 1);
    const policy = loadCleanupPolicy(registry.commonDir);
    const apply = args[0] === 'run-ownership';
    if (apply) assert.equal(policy.ownershipV2, true, 'V2 scheduled cleanup must be explicitly enabled');
    return runOwnershipCleanup(root, {
      registry,
      policy,
      unreferenced,
      verifyRuntimeResources: cleanupTestResources,
      apply,
    });
  }
  assert.ok(
    args.length === 1 && ['plan', 'run'].includes(args[0]),
    'cleanup <plan|run|pending-notifications|handoff exact-manifest.json|claim-notification event.json|ack-notification receipt.json|ack-native-commentary observation.json>',
  );
  const policy = args[0] === 'run' ? loadCleanupPolicy(registry.commonDir) : {};
  return queue.run({ ...policy, apply: args[0] === 'run', verify, unreferenced });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await cleanupCommand(process.cwd(), process.argv.slice(2));
    console.log(JSON.stringify(result));
    if (result.processed?.some((r) => r.state === 'blocked')) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
