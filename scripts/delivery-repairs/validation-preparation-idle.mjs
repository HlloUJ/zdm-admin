import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createResourceLeases } from '../resource-lease.mjs';
import { assertStoppedValidationHostIdle, observeCancellationHost } from '../task-cancellation-proof.mjs';
import { taskProjectName } from '../dev-task.mjs';
import { referenceHash } from './preview-reference-history.mjs';
import { createReferenceEvidenceJournal, referenceConsumerAnchor } from './preview-reference-proof.mjs';
import {
  assertRecoveryContainer,
  inspectRecoveryContainer,
  recoveryReceiptFile,
  validationRuntimeHash,
} from './validation-backend-recovery.mjs';
import { privateJson, readInterruptedValidationEvidence } from './validation-recovery-evidence.mjs';
import { readValidationMaintenance } from './validation-maintenance-lineage.mjs';

const hash = (value) => referenceHash(JSON.stringify(value));
const self = fileURLToPath(import.meta.url);
const loaded = referenceHash(readFileSync(self));
function assertPublishedIdleVerifier(task, common) {
  const anchor = referenceConsumerAnchor(task.worktree, common);
  const relative = 'scripts/delivery-repairs/validation-preparation-idle.mjs';
  assert.equal(realpathSync(self), path.join(anchor, relative));
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '--no-replace-objects', '-C', anchor, ...args]);
  const base = git('rev-parse', 'refs/remotes/origin/main').toString().trim();
  assert.equal(git('rev-parse', 'HEAD').toString().trim(), base);
  assert.equal(git('status', '--porcelain').toString(), '');
  assert.equal(referenceHash(git('show', base + ':' + relative)), loaded);
}
export function assertStablePreparationRounds(first, second) {
  assert.deepEqual(second, first, 'Retained native directory or stopped backend identity changed between observations');
  return hash(first);
}

export function preparationValidationIdle(task, common, requestPhase) {
  if (requestPhase !== 'preparation') return null;
  const receiptFile = recoveryReceiptFile(common, task);
  if (!existsSync(receiptFile)) return null;
  assertPublishedIdleVerifier(task, common);
  const readReceipt = () => {
    const receipt = privateJson(receiptFile);
    assert.equal(receipt.value.containerRetained, true);
    const e = readInterruptedValidationEvidence(task, common, receipt.value.evidence.archive);
    assert.deepEqual(e, receipt.value.evidence);
    const maintenance = readValidationMaintenance(common, task, e);
    assert.equal(receipt.value.maintenance, maintenance.selectorDigest);
    assert.equal(receipt.value.startedAt, maintenance.own.live.startedAt);
    const directory = path.join(path.dirname(receiptFile), 'observation');
    assert.equal(path.dirname(receipt.value.intent), directory);
    const intent = privateJson(receipt.value.intent).value;
    assert.equal(intent.kind, 'stop-intent');
    assert.deepEqual(intent.value.evidence, e);
    assert.equal(intent.value.containerIdentity, receipt.value.containerIdentity);
    assert.equal(intent.value.assets, receipt.value.assets);
    assert.equal(intent.value.maintenance, maintenance.selectorDigest);
    assert.equal(intent.value.startedAt, receipt.value.startedAt);
    return { receipt, e };
  };
  const { receipt, e } = readReceipt();
  const resources = createResourceLeases(common);
  const backend = () => {
    assert.equal(
      resources.inspect('task-delivery-' + task.id),
      null,
      'An active recovery or delivery still owns the task',
    );
    const c = inspectRecoveryContainer(e.backend.id);
    const project = taskProjectName({ root: task.worktree, branch: task.branch });
    assertRecoveryContainer(c, e, {
      root: task.worktree,
      project,
      running: false,
      startedAt: receipt.value.startedAt,
    });
    assert.equal(c.State.FinishedAt, receipt.value.stoppedAt);
    assert.equal(validationRuntimeHash(c), receipt.value.containerIdentity);
    return { id: c.Id, inventory: { mounts: c.Mounts } };
  };
  const base = path.join(path.dirname(receiptFile), 'admission-observations');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  assert.equal(realpathSync(base), base);
  assert.equal(lstatSync(base).mode & 0o077, 0);
  const record = createReferenceEvidenceJournal(path.join(base, randomUUID()));
  try {
    const one = () => {
      const started = Date.now();
      const before = backend(),
        snapshot = observeCancellationHost();
      record('host-observation', snapshot);
      assert.ok(
        !snapshot.containers.some((c) => c.id === before.id),
        'Validation container is in the active inventory',
      );
      const handles = assertStoppedValidationHostIdle(snapshot, task, before, record);
      assert.deepEqual(backend(), before);
      assert.ok(Date.now() - started <= 60000, 'Native directory observation expired');
      return { backend: before, handles };
    };
    const first = one(),
      second = one();
    const directoryDigest = assertStablePreparationRounds(first, second);
    assert.equal(readReceipt().receipt.hash, receipt.hash);
    record('prepared-idle-proof', { receipt: receipt.hash, directoryDigest, cleanupAuthorized: false });
    return { receipt: receipt.hash, directoryDigest };
  } catch (error) {
    record('rejected', { reason: error.message });
    throw error;
  }
}
