import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runVerificationTask } from './verification-runner.mjs';
import { captureIdentity } from './verification-evidence.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const commandIdentity = (task) =>
  hash({
    root: task.root,
    command: task.command,
    args: task.args,
    kind: task.kind,
    coverage: task.coverage,
    env: task.env,
  });
// Used through executeVerificationPlan's existing injected `run` hook. No default gate is replaced.
// Broker is a required live service interface, not a local log. This module alone does not enable scheduling.
export function createScheduledVerification({ taskId, broker, run = runVerificationTask, inspect = captureIdentity }) {
  assert.ok(taskId);
  for (const name of ['enqueue', 'waitAdmission', 'assertAdmission', 'complete', 'block'])
    assert.equal(typeof broker?.[name], 'function');
  return async function scheduledRun(task, options = {}) {
    const identity = inspect(task);
    assert.ok(identity.fingerprint && identity.inputProofComplete !== false, 'Complete gate identity is required');
    // Safe default: legacy verifier phases run to completion. Never TERM them or erase their locks/failure history.
    const descriptor = {
      task: taskId,
      stage: task.name,
      worktree: task.root,
      fingerprint: identity.fingerprint,
      commandDigest: commandIdentity(task),
      restartable: false,
      externalResources: true,
      resources: [`verification-worktree:${task.root}`],
      kind: task.kind ?? 'node',
    };
    let ticket;
    let executionEnded = false;
    try {
      ticket = await broker.enqueue(descriptor);
      const admission = await broker.waitAdmission(ticket);
      assert.equal(inspect(task).fingerprint, descriptor.fingerprint, 'Gate inputs changed while queued');
      assert.equal(commandIdentity(task), descriptor.commandDigest, 'Gate command or environment changed while queued');
      await broker.assertAdmission(ticket, admission, descriptor);
      // Preserve exact task, options, environment, command, coverage, evidence validator and failed-attempt history.
      let spawnObservationError;
      const runOptions =
        typeof broker.recordSpawn === 'function'
          ? {
              ...options,
              onSpawn(proof) {
                // Start recording immediately; notification errors do not alter gate evidence or retry semantics.
                try {
                  Promise.resolve(broker.recordSpawn(ticket, proof)).catch((error) => {
                    spawnObservationError = error.message;
                  });
                } catch (error) {
                  spawnObservationError = error.message;
                }
                try {
                  Promise.resolve(options.onSpawn?.(proof)).catch(() => {});
                } catch {
                  /* advisory only */
                }
              },
            }
          : options;
      const result = await run(task, runOptions);
      if (spawnObservationError) result.spawnObservationError = spawnObservationError;
      executionEnded = true;
      const unchanged = inspect(task).fingerprint === descriptor.fingerprint;
      if (result.exitCode !== 0 || !unchanged) {
        await broker.block(
          ticket,
          unchanged ? 'Gate failed; explicit diagnosis required' : 'Gate inputs changed during execution',
          { stageEnded: true },
        );
        return unchanged
          ? result
          : { ...result, exitCode: 1, status: 'blocked', reason: 'Gate inputs changed during execution' };
      }
      await broker.complete(ticket, result);
      return result;
    } catch (error) {
      if (ticket) await broker.block(ticket, error.message, { stageEnded: executionEnded });
      throw error;
    }
  };
}
