import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { isPortOpen, inspectManagedPreview } from './dev-task.mjs';
import { readTaskData } from './task-data-environment.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import { collectDeliveryChanges, createVerificationPlan } from './verify.mjs';
import { startCompletionProcess, stopCompletionProcess, runCompletionProcess } from './completion-process.mjs';
import { checkDeliveryMigrationSafety } from './delivery-migration-safety.mjs';

const gitHead = (root) => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

// A delivery check must not require taking 5175 away from another task. This
// short-lived frontend uses only the current task backend/data and leased port.
export async function withCandidateRuntime(batch, head, action, dependencies = {}) {
  const system = {
    needsRuntime: () =>
      Boolean(
        createVerificationPlan({
          root: batch.worktree,
          affected: true,
          ...collectDeliveryChanges(batch.worktree),
          ciCapability: { verified: false },
        }).runtime,
      ),
    registry: createTaskRegistry,
    leases: createResourceLeases,
    isOpen: isPortOpen,
    readData: readTaskData,
    inspect: inspectManagedPreview,
    references: taskRuntimeReferences,
    head: gitHead,
    clean: (root) =>
      execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', stdio: 'pipe' }).trim(),
    migrationSafety: checkDeliveryMigrationSafety,
    stopChild: stopCompletionProcess,
    run: (root, args, log) => {
      const result = runCompletionProcess(process.execPath, [path.join(root, 'scripts/dev-task.mjs'), ...args], {
        cwd: root,
        encoding: 'utf8',
      });
      if (log) appendFileSync(log, (result.stdout ?? '') + (result.stderr ?? ''), { mode: 0o600 });
      assert.equal(result.status, 0, 'Owned runtime check/stop failed; inspect ' + log);
    },
    start: (root, args, log) => {
      const fd = openSync(log, 'a', 0o600);
      try {
        return startCompletionProcess(process.execPath, [path.join(root, 'scripts/dev-task.mjs'), ...args], {
          cwd: root,
          env: process.env,
          stdio: ['ignore', fd, fd],
        });
      } finally {
        closeSync(fd);
      }
    },
    tick: () => new Promise((resolve) => setTimeout(resolve, 1000)),
    ...dependencies,
  };
  if (!system.needsRuntime()) return action({});
  const registry = system.registry(batch.worktree),
    task = registry.resolve({ id: batch.id });
  assert.ok(!task.recovery?.runtimeBlocked, 'Historical recovery must be reviewed before runtime or data preparation');
  assert.equal(system.head(task.worktree), head, 'Runtime candidate moved');
  assert.equal(system.clean(task.worktree), '', 'Candidate source changed before runtime validation');
  system.migrationSafety(task.worktree); // Read-only proof against actual published schema histories before merge.
  await system.references(task); // Detect foreign API consumers before any backend preparation.
  assert.ok(
    system.readData(task.worktree),
    'Candidate data is not prepared; run the published task:data isolate <task-id> --apply explicitly before delivery. No data was created.',
  );
  const leases = system.leases(registry.commonDir);
  let lease, port;
  for (let candidate = 5177; candidate <= 5199; candidate++) {
    if (leases.inspect('temporary-port-' + candidate) || (await system.isOpen(candidate))) continue;
    lease = leases.acquire('temporary-port-' + candidate, task.id);
    port = candidate;
    break;
  }
  assert.ok(lease, 'No private validation port available; preserve other tasks');
  const directory = path.join(task.worktree, '.task-runtime/candidate-runtime');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = randomUUID(),
    journal = path.join(directory, id + '.json'),
    log = path.join(directory, id + '.log');
  const record = { version: 1, task: task.id, head, port, lease, state: 'prepared', log };
  const save = () => writeFileSync(journal, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  save();
  let child, failure, primary, cleanupFailure, result;
  try {
    child = system.start(
      task.worktree,
      [
        '--worktree',
        task.worktree,
        '--port',
        String(port),
        '--mode',
        'full',
        ...(task.frozen ? ['--validation-candidate', head] : []),
      ],
      log,
    );
    record.pid = child.pid;
    record.state = 'starting';
    save();
    child.on('error', (error) => {
      failure = error;
    });
    const deadline = Date.now() + 240_000;
    for (;;) {
      if (failure) throw failure;
      assert.ok(child.exitCode === null && !child.signalCode, 'Candidate runtime exited; inspect ' + log);
      const proof = await system.inspect({
        port,
        expectedWorkspaceRoot: task.worktree,
        expectedBranch: task.branch,
        expectedMode: 'full',
      });
      if (proof.metadata && proof.errors.length === 0) break;
      assert.ok(Date.now() < deadline, 'Candidate runtime did not become ready; inspect ' + log);
      await system.tick();
    }
    system.run(task.worktree, ['--check', '--worktree', task.worktree, '--port', String(port)], log);
    assert.equal(system.head(task.worktree), head, 'Candidate changed during runtime startup');
    assert.equal(system.clean(task.worktree), '', 'Candidate source changed during runtime startup');
    record.state = 'ready';
    save();
    result = await action({ ZDM_TASK_VALIDATION_PORT: String(port), ZDM_TASK_VALIDATION_ROOT: task.worktree });
  } catch (error) {
    primary = error;
    record.failure = error.message;
    record.primaryFailure = error.message;
    save();
  } finally {
    try {
      await system.stopChild(child);
      const references = await system.references(task, { closingLeases: [lease] });
      if (!references.owned.some((frontend) => frontend.port !== port))
        system.run(task.worktree, ['--stop', '--worktree', task.worktree, '--port', String(port)], log);
      assert.equal(await system.isOpen(port), false, 'Validation frontend still runs; retain its lease');
      record.state = 'stopped';
      save();
      leases.release(lease);
    } catch (error) {
      record.state = 'cleanup-blocked';
      record.failure ??= error.message;
      record.cleanupFailure = error.message;
      save();
      cleanupFailure = error;
    }
  }
  if (cleanupFailure)
    throw new AggregateError(
      primary ? [primary, cleanupFailure] : [cleanupFailure],
      'Owned validation runtime cleanup incomplete; retain source and lease: ' + journal,
      { cause: cleanupFailure },
    );
  if (primary) throw primary;
  return result;
}
