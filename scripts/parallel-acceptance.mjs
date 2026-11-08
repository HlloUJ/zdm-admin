import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { assertPreviewOwner } from './preview-transition.mjs';

export const PARALLEL_ACCEPTANCE_CASES = Object.freeze([
  'frozen-daemon-restart',
  'frozen-target-failure-rollback',
  'frozen-source-refusals',
  'unknown-consumer-refusal',
  'missing-data-refusal',
  'concurrent-delivery-queue',
  'formal-delivery-receipts',
  'final-business-preservation',
]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exactSha = (value) => assert.match(value ?? '', /^[a-f0-9]{40}$/);
function healthy(status) {
  assert.equal(status.phase, 'running');
  assert.equal(status.taskSelectionProtocol, 2);
  assert.equal(status.handoffHold, null);
  assert.ok(path.isAbsolute(status.worktree));
  assert.ok(Number.isSafeInteger(status.servicePid) && Number.isSafeInteger(status.childPid));
}
function retainedFrozen(record) {
  assert.deepEqual(record.freezeAfter, record.freezeBefore, 'Original freeze changed during acceptance');
  assert.equal(record.sourceAfter, record.sourceBefore, 'Source was not restored after the controlled case');
  assert.match(record.sourceBefore ?? '', /^[a-f0-9]{64}$/);
}
function stoppedNothing(record) {
  healthy(record.before);
  healthy(record.after);
  assertPreviewOwner(record.before, record.after);
}

// This validates specific observed states, not a caller-supplied list of labels
// that can all be changed to "passed". It never starts runtime or delivery work.
export function validateParallelAcceptance(report, { readEvidence } = {}) {
  assert.equal(report.version, 1);
  exactSha(report.main);
  assert.ok(Array.isArray(report.cases));
  assert.equal(
    new Set(report.cases.map((item) => item.id)).size,
    PARALLEL_ACCEPTANCE_CASES.length,
    'Duplicate or missing acceptance case',
  );
  assert.deepEqual(report.cases.map((item) => item.id).sort(), [...PARALLEL_ACCEPTANCE_CASES].sort());
  const read =
    readEvidence ??
    ((file) => {
      assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
      return readFileSync(file);
    });
  const checked = [];
  for (const item of report.cases) {
    assert.match(item.sha256 ?? '', /^[a-f0-9]{64}$/);
    const bytes = read(item.file);
    assert.equal(sha(bytes), item.sha256, 'Acceptance evidence changed: ' + item.id);
    const record = JSON.parse(bytes);
    assert.equal(record.native, true, 'Native case evidence required');
    assert.equal(record.case, item.id);
    switch (item.id) {
      case 'frozen-daemon-restart':
        healthy(record.before);
        healthy(record.after);
        retainedFrozen(record);
        assert.equal(record.after.worktree, record.before.worktree);
        assert.notEqual(record.after.servicePid, record.before.servicePid);
        assert.equal(record.profileAfter, record.profileBefore);
        assert.equal(record.fullBindingCheckPassed, true);
        break;
      case 'frozen-target-failure-rollback':
        healthy(record.before);
        healthy(record.after);
        retainedFrozen(record);
        assert.equal(record.after.worktree, record.before.worktree);
        assert.equal(record.after.servicePid, record.before.servicePid);
        assert.notEqual(record.after.childPid, record.before.childPid);
        assert.ok(record.after.selectionRevision > record.before.selectionRevision);
        assert.match(record.failure ?? '', /previous preview was restored/);
        assert.equal(record.targetFaultAssetRestored, true);
        assert.equal(record.profileAfter, record.profileBefore);
        assert.equal(record.fullBindingCheckPassed, true);
        break;
      case 'frozen-source-refusals':
        assert.deepEqual(record.scenarios.map((s) => s.reason).sort(), ['changed-source', 'missing-owner']);
        for (const scenario of record.scenarios) {
          stoppedNothing(scenario);
          assert.match(scenario.failure ?? '', /冻结候选恢复归属或源码变化/);
          retainedFrozen(scenario);
        }
        break;
      case 'unknown-consumer-refusal':
        stoppedNothing(record);
        assert.ok(record.leaseBefore?.token);
        assert.deepEqual(record.leaseAfter, record.leaseBefore);
        assert.match(record.switchFailure ?? '', /consumer state is unknown/);
        assert.match(record.cleanupFailure ?? '', /consumer state is unknown/);
        assert.equal(record.faultServerStatus, 503);
        break;
      case 'missing-data-refusal':
        assert.deepEqual(record.after, record.before);
        assert.equal(record.before.profileExists, false);
        assert.equal(record.before.schemaCount, 0);
        assert.equal(record.before.mediaVolumeExists, false);
        assert.match(record.failure ?? '', /task:data isolate.*explicitly/);
        assert.equal(record.registryAfter, record.registryBefore);
        break;
      case 'concurrent-delivery-queue': {
        const ids = [...new Set(record.tasks ?? [])];
        assert.equal(ids.length, 2);
        const overlap = record.observations.find((observation) => {
          const own = observation.tickets.filter((ticket) => ids.includes(ticket.task));
          return (
            own.length === 2 &&
            own.some((ticket) => ticket.status === 'waiting') &&
            own.some((ticket) => ticket.status === 'running' && ticket.id === observation.mainLease?.task)
          );
        });
        assert.ok(overlap, 'Actual queue contention was not observed; sequential delivery is not equivalent');
        assert.equal(record.originalControllersUsed, true);
        break;
      }
      case 'formal-delivery-receipts':
        assert.equal(new Set(record.tasks.map((task) => task.id)).size, 3);
        for (const task of record.tasks) {
          exactSha(task.candidate);
          exactSha(task.main);
          assert.equal(task.formalDeliveryComplete, true);
          assert.equal(task.worktreeRemoved, true);
          assert.equal(task.branchRemoved, true);
          const receiptBytes = read(task.receipt);
          assert.equal(sha(receiptBytes), task.receiptDigest);
          const receipt = JSON.parse(receiptBytes);
          assert.equal(receipt.results.close.result.batch, task.id);
          assert.equal(receipt.results.close.result.main.local, task.main);
        }
        assert.ok(record.tasks.some((task) => task.main === report.main));
        break;
      case 'final-business-preservation':
        assert.deepEqual(record.after, record.before);
        assert.equal(record.localMain, report.main);
        assert.equal(record.remoteMain, report.main);
        assert.equal(record.previewTask, 'payment-config-cleanup');
        assert.equal(record.businessRecoveryBlocked, true);
        assert.equal(record.runtimeHealthy, true);
        assert.equal(record.backupsRetained, true);
        assert.equal(record.installedClosureMatches, true);
        assert.deepEqual(record.queue, []);
        assert.deepEqual(record.leases, []);
        break;
      default:
        assert.fail('Unreviewed acceptance case');
    }
    checked.push({ id: item.id, sha256: item.sha256, file: item.file });
  }
  return {
    version: 1,
    main: report.main,
    cases: checked,
    coveredSteps: [14, 15, 16, 17, 25, 41, 42],
    complete: true,
    independentEnforcement: false,
  };
}
