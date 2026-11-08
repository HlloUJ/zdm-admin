import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PARALLEL_ACCEPTANCE_CASES, validateParallelAcceptance } from './parallel-acceptance.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const main = 'a'.repeat(40);
function fixture() {
  const before = {
    type: 'zdm-task-preview-service',
    worktree: '/repo/c',
    phase: 'running',
    servicePid: 1,
    childPid: 2,
    selectionRevision: 1,
    taskSelectionProtocol: 2,
    handoffHold: null,
  };
  const frozen = {
    freezeBefore: { accepted: 'b'.repeat(40) },
    freezeAfter: { accepted: 'b'.repeat(40) },
    sourceBefore: 'c'.repeat(64),
    sourceAfter: 'c'.repeat(64),
    profileBefore: 'd'.repeat(64),
    profileAfter: 'd'.repeat(64),
  };
  const records = new Map();
  const set = (id, value) => records.set(id, structuredClone({ native: true, case: id, ...value }));
  set('frozen-daemon-restart', {
    before,
    after: { ...before, servicePid: 3, childPid: 4 },
    ...frozen,
    fullBindingCheckPassed: true,
  });
  set('frozen-target-failure-rollback', {
    before,
    after: { ...before, childPid: 5, selectionRevision: 3 },
    ...frozen,
    failure: 'Target failed; previous preview was restored: launch exited',
    targetFaultAssetRestored: true,
    fullBindingCheckPassed: true,
  });
  set('frozen-source-refusals', {
    scenarios: ['changed-source', 'missing-owner'].map((reason) => ({
      reason,
      before,
      after: before,
      ...frozen,
      failure: '冻结候选恢复归属或源码变化',
    })),
  });
  set('unknown-consumer-refusal', {
    before,
    after: before,
    leaseBefore: { token: 'observed' },
    leaseAfter: { token: 'observed' },
    switchFailure: 'Preview consumer state is unknown',
    cleanupFailure: 'Preview consumer state is unknown',
    faultServerStatus: 503,
  });
  const missing = { profileExists: false, schemaCount: 0, mediaVolumeExists: false };
  set('missing-data-refusal', {
    before: missing,
    after: missing,
    registryBefore: 'same',
    registryAfter: 'same',
    failure: 'task:data isolate must run explicitly',
  });
  set('concurrent-delivery-queue', {
    tasks: ['c', 'd'],
    observations: [
      {
        tickets: [
          { id: 'ticket-c', task: 'c', status: 'running' },
          { id: 'ticket-d', task: 'd', status: 'waiting' },
        ],
        mainLease: { task: 'ticket-c' },
      },
    ],
    originalControllersUsed: true,
  });
  const receipts = new Map();
  const tasks = ['repair', 'c', 'd'].map((id) => {
    const receipt = '/evidence/receipt-' + id + '.json';
    receipts.set(
      receipt,
      Buffer.from(JSON.stringify({ results: { close: { result: { batch: id, main: { local: main } } } } })),
    );
    return {
      id,
      candidate: 'e'.repeat(40),
      main,
      formalDeliveryComplete: true,
      worktreeRemoved: true,
      branchRemoved: true,
      receipt,
      receiptDigest: digest(receipts.get(receipt)),
    };
  });
  set('formal-delivery-receipts', { tasks });
  set('final-business-preservation', {
    before: { sourceA: 'same', sourceB: 'same' },
    after: { sourceA: 'same', sourceB: 'same' },
    localMain: main,
    remoteMain: main,
    previewTask: 'payment-config-cleanup',
    businessRecoveryBlocked: true,
    runtimeHealthy: true,
    backupsRetained: true,
    installedClosureMatches: true,
    queue: [],
    leases: [],
  });
  const prepare = () => {
    const files = new Map(receipts);
    const report = {
      version: 1,
      main,
      cases: PARALLEL_ACCEPTANCE_CASES.map((id) => {
        const file = '/evidence/' + id + '.json',
          bytes = Buffer.from(JSON.stringify(records.get(id)));
        files.set(file, bytes);
        return { id, file, sha256: digest(bytes) };
      }),
    };
    return { report, readEvidence: (file) => files.get(file), files };
  };
  return { records, prepare };
}
test('all required native observations and exact retained receipts are needed for completion', () => {
  const f = fixture(),
    proof = f.prepare();
  const result = validateParallelAcceptance(proof.report, proof);
  assert.equal(result.complete, true);
  assert.deepEqual(result.coveredSteps, [14, 15, 16, 17, 25, 41, 42]);
});
test('a batch of passed labels, duplicates, missing cases and changed evidence cannot grant completion', () => {
  const f = fixture(),
    proof = f.prepare();
  assert.throws(() =>
    validateParallelAcceptance({ ...proof.report, cases: [{ id: 'everything', status: 'passed' }] }, proof),
  );
  assert.throws(() => validateParallelAcceptance({ ...proof.report, cases: proof.report.cases.slice(1) }, proof));
  assert.throws(() =>
    validateParallelAcceptance(
      { ...proof.report, cases: [proof.report.cases[0], ...proof.report.cases.slice(0, -1)] },
      proof,
    ),
  );
  proof.files.set(proof.report.cases[0].file, Buffer.from('{}'));
  assert.throws(() => validateParallelAcceptance(proof.report, proof), /evidence changed/);
});
for (const [id, change] of [
  [
    'frozen-daemon-restart',
    (r) => {
      r.after.servicePid = r.before.servicePid;
    },
  ],
  [
    'frozen-target-failure-rollback',
    (r) => {
      r.after.childPid = null;
    },
  ],
  [
    'frozen-target-failure-rollback',
    (r) => {
      r.freezeAfter.accepted = 'f'.repeat(40);
    },
  ],
  [
    'frozen-source-refusals',
    (r) => {
      r.scenarios.pop();
    },
  ],
  [
    'unknown-consumer-refusal',
    (r) => {
      r.after = { ...r.after, childPid: 9 };
    },
  ],
  [
    'missing-data-refusal',
    (r) => {
      r.after.schemaCount = 1;
    },
  ],
  [
    'concurrent-delivery-queue',
    (r) => {
      r.observations[0].tickets.pop();
    },
  ],
  [
    'concurrent-delivery-queue',
    (r) => {
      r.observations[0].mainLease.task = 'unknown-ticket';
    },
  ],
  [
    'formal-delivery-receipts',
    (r) => {
      r.tasks[0].formalDeliveryComplete = false;
    },
  ],
  [
    'final-business-preservation',
    (r) => {
      r.after.sourceB = 'changed';
    },
  ],
  [
    'final-business-preservation',
    (r) => {
      r.queue = ['still-owned'];
    },
  ],
])
  test(`case-specific failure is not hidden by refreshed hashes or passed labels: ${id} ${change.toString()}`, () => {
    const f = fixture();
    change(f.records.get(id));
    const proof = f.prepare();
    assert.throws(() => validateParallelAcceptance(proof.report, proof));
  });
