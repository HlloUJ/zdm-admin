import { requireStartMonitoring, verifyMonitoringInstruction } from './task-monitor-registration.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExecutionOrder } from './task-execution-order.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { verifyCancellation } from './task-cancellation-proof.mjs';
import { deliveryStatus } from './completion-status.mjs';
import { assertDeliveredDependencies } from './task-context.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
export function verifyDevelopmentCompletion(task, evidence) {
  assert.equal(evidence?.task, task.id);
  assert.equal(evidence.owner, task.owner);
  assert.equal(evidence.head, git(task.worktree, 'rev-parse', 'HEAD'));
  assert.equal(git(task.worktree, 'status', '--porcelain'), '', 'Uncommitted development cannot release a slot');
  assert.ok(
    Array.isArray(evidence.reports) && evidence.reports.length > 0,
    'Exact development verification reports required',
  );
  for (const entry of evidence.reports) {
    const file = path.resolve(task.worktree, entry.path);
    const base = realpathSync(task.worktree);
    assert.ok(realpathSync(file).startsWith(base + path.sep), 'Report must belong to the exact worktree');
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
    const bytes = readFileSync(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const report = JSON.parse(bytes);
    assert.equal(report.version, 1);
    assert.equal(report.task, task.id);
    assert.equal(report.head, evidence.head);
    assert.equal(report.outcome, 'passed');
    assert.ok(Number.isSafeInteger(report.tests) && report.tests > 0);
    assert.equal(report.skipped, 0);
    assert.equal(report.retries, 0);
    assert.ok(Array.isArray(report.sourceReports) && report.sourceReports.length > 0, 'Original test reports required');
    for (const source of report.sourceReports) {
      const sourceFile = path.resolve(task.worktree, source.path);
      assert.ok(realpathSync(sourceFile).startsWith(base + path.sep));
      assert.equal(createHash('sha256').update(readFileSync(sourceFile)).digest('hex'), source.sha256);
    }
  }
  return true;
}
export function executionOrderCommand(root, [command, json]) {
  const registry = createTaskRegistry(root);
  const queue = createExecutionOrder(registry.commonDir);
  if (command === 'status') {
    assert.equal(json, undefined);
    return queue.read();
  }
  assert.ok(json, 'Explicit JSON command required; credentials are not user authorization');
  const input = JSON.parse(json);
  const dependenciesReady = (ticket) => {
    const task = registry.readTask(ticket.task);
    if (!task || task.owner !== ticket.owner) return false;
    try {
      return assertDeliveredDependencies(root, task);
    } catch {
      return false;
    }
  };
  if (command === 'initialize') return queue.initialize(input);
  if (command === 'enqueue') return queue.enqueue(input);
  if (command === 'claim') {
    if (input.lane === 'development' && !registry.readTask(input.task)) {
      requireStartMonitoring(input.owner, input.task, input.monitorContext);
      const ticket = queue
        .read()
        ?.tickets.find((item) => item.lane === input.lane && item.task === input.task && item.owner === input.owner);
      verifyMonitoringInstruction(input.monitorContext, ticket);
    }
    return queue.claim(input, dependenciesReady);
  }
  if (command === 'block') return queue.block(input);
  if (command === 'direct') {
    if (input.action === 'resume-only' && input.lane === 'delivery') {
      const task = registry.readTask(input.task);
      assert.ok(task && task.owner === input.owner);
      assertDeliveredDependencies(root, task);
    }
    return queue.direct(input);
  }
  if (command === 'cancel-plan') {
    const target = queue.cancellationTarget(input);
    const proof = verifyCancellation(registry, target);
    assert.deepEqual(queue.cancellationTarget(input), target, 'Cancellation target changed during plan');
    return { dryRun: true, cancelled: false, futureAuthorization: false, proof };
  }
  if (command === 'cancel') {
    return queue.cancel(input, (ticket) => verifyCancellation(registry, ticket));
  }
  if (command === 'complete') {
    const task = registry.readTask(input.task);
    assert.ok(task && task.owner === input.owner, 'Original registered owner required');
    return queue.complete(input, (ticket, evidence) => {
      if (ticket.lane === 'development') return verifyDevelopmentCompletion(task, evidence);
      const status = deliveryStatus(path.join(registry.commonDir, 'task-delivery', task.id), task.id, task);
      assert.equal(status.formalDeliveryComplete, true, 'Formal delivery not complete');
      assert.equal(evidence?.main, task.main?.local);
      assert.equal(evidence?.task, task.id);
      return true;
    });
  }
  throw new Error('execution-order <status|initialize|enqueue|claim|block|direct|complete|cancel|cancel-plan> [json]');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(executionOrderCommand(process.cwd(), process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
