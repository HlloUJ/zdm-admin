import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskDeliveryQueue } from '../task-delivery-queue.mjs';
import { createExecutionOrder } from '../task-execution-order.mjs';
import { taskExecutor } from '../task-execution-binding.mjs';
import { scopedAdmissions } from '../task-execution-scope.mjs';
import { createResourceLeases } from '../resource-lease.mjs';
import { readAcceptance } from '../accepted-source.mjs';
import { referenceHash, regularReferenceFile } from './preview-reference-history.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const archiveName = /^temporary-port-(51(?:7[7-9]|8[0-9]|9[0-9]))$/;
export const privateJson = (file) => {
  assert.equal(realpathSync(file), file);
  const { bytes, stat } = regularReferenceFile(file);
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o077, 0);
  return { value: JSON.parse(bytes), hash: referenceHash(bytes), stat };
};
const digest = (file) => referenceHash(regularReferenceFile(file).bytes);
const single = (values, message) => {
  assert.equal(values.length, 1, message);
  return values[0];
};
const git = (root, ...args) =>
  execFileSync('git', ['--no-optional-locks', '--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
function assertExited(pid) {
  assert.ok(Number.isSafeInteger(pid) && Math.abs(pid) > 1);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

export function assertOriginalValidationFailure({
  task,
  state,
  ticket,
  stage,
  attempt,
  journal,
  archivedTicket,
  host,
}) {
  assert.equal(ticket?.task, task.id);
  assert.equal(ticket.lane, 'delivery');
  assert.equal(ticket.owner, task.owner);
  assert.equal(ticket.status, 'blocked');
  assert.equal(ticket.order, archivedTicket.order);
  assert.ok(!scopedAdmissions(state).some((scope) => scope.task === task.id));
  const decision = state.dynamicDecisions.find((item) => item.id === ticket.dynamicDecisionId);
  assert.equal(decision?.status, 'consumed');
  assert.ok(decision.admission && ticket.admission === decision.admission);
  assert.equal(decision.sourceProof.head, task.recordedHead);
  assert.equal(decision.sourceProof.accepted, task.frozen.accepted);
  assert.equal(decision.input.phase, 'final');
  assert.equal(decision.input.lane, 'delivery');
  assert.equal(decision.input.task, task.id);
  assert.equal(decision.input.owner, task.owner);
  assert.equal(decision.input.executor, taskExecutor(task));
  for (const key of ['order', 'owner', 'request', 'phaseOrigin'])
    assert.deepEqual(decision.ticketBefore[key], ticket[key]);
  assert.equal(stage.name, 'prepare');
  assert.equal(stage.key, task.recordedHead + ':readiness');
  assert.equal(stage.status, 'failure');
  assert.equal(stage.owner.host, host);
  assert.equal(stage.owner.pid, journal.lease.pid);
  assert.equal(stage.processTracking, 1);
  assert.ok(stage.processes.length > 0);
  assert.equal(attempt.task, task.id);
  assert.equal(attempt.owner, task.owner);
  assert.equal(attempt.accepted, task.frozen.accepted);
  assert.equal(attempt.initialHead, task.recordedHead);
  assert.equal(attempt.outcome, 'failure');
  assert.equal(attempt.mainMutationStarted, false);
  assert.equal(attempt.lease.resource, 'main-delivery');
  assert.equal(attempt.lease.task, attempt.id);
  assert.equal(attempt.lease.pid, stage.owner.pid);
  assert.match(attempt.failure, /Owned validation runtime cleanup incomplete/);
  assert.equal(journal.task, task.id);
  assert.equal(journal.head, task.recordedHead);
  assert.equal(journal.lease.task, task.id);
  assert.equal(Number(archiveName.exec(journal.lease.resource)?.[1]), journal.port);
  assert.equal(journal.state, 'cleanup-blocked');
  assert.match(journal.cleanupFailure, /^Unknown other frontend consumer/);
}

export function readInterruptedValidationEvidence(task, common, archive) {
  const directory = path.join(common, 'task-delivery', task.id);
  assert.equal(path.dirname(archive), directory);
  assert.equal(realpathSync(archive), archive);
  const a = lstatSync(archive);
  assert.ok(a.isDirectory() && a.uid === process.getuid() && (a.mode & 0o077) === 0);
  const { value: manifest, hash: manifestHash } = privateJson(path.join(archive, 'manifest.json'));
  const { value: moved, hash: moveHash } = privateJson(path.join(archive, 'move-result.json'));
  assert.equal(manifest.task, task.id);
  assert.equal(manifest.originalOwner, task.owner);
  assert.equal(manifest.head, task.recordedHead);
  assert.equal(manifest.accepted, task.frozen.accepted);
  assert.match(manifest.approval, uuid);
  assert.equal(moved.archive, archive);
  assert.equal(moved.originalPath, manifest.originalPath);
  assert.equal(moved.unchangedTicket, 'blocked');
  const sessionFile = path.join(directory, 'completion-session.json');
  const root = path.join(task.worktree, '.task-runtime/candidate-runtime');
  const transaction = single(
    manifest.files.filter(
      (f) =>
        path.dirname(f.original.name) === root &&
        path.extname(f.original.name) === '.json' &&
        uuid.test(path.basename(f.original.name, '.json')),
    ),
    'Exact original validation journal required',
  );
  const preserved = (file) => {
    const entry = single(
      manifest.files.filter((x) => x.original.name === file),
      'Original evidence missing or ambiguous',
    );
    const archived = path.join(archive, 'original-bytes', path.basename(file));
    assert.equal(entry.preserved.name, archived);
    assert.equal(realpathSync(archived), archived);
    assert.equal(digest(archived), entry.original.sha256);
    return archived;
  };
  const journal = privateJson(preserved(transaction.original.name)).value;
  const log = preserved(transaction.original.name.replace(/\.json$/, '.log'));
  assert.equal(digest(transaction.original.name), transaction.original.sha256);
  const oldSession = privateJson(preserved(sessionFile)).value;
  const stage = oldSession.events.at(-1);
  const session = privateJson(sessionFile).value;
  assert.deepEqual(
    session.events.find((item) => item.id === stage.id),
    stage,
  );
  assert.ok(
    session.events.every(
      (e) => e.status !== 'running' && !['merge', 'sync', 'handoff', 'cleanup', 'close'].includes(e.name),
    ),
  );
  const originalQueue = oldSession.events.findLast(
    (e) => e.name === 'queue' && e.status === 'success' && e.finishedAt < stage.startedAt,
  );
  const attempts = path.join(directory, 'queue-attempts');
  const attempt = privateJson(
    path.join(
      attempts,
      single(
        readdirSync(attempts).filter(
          (name) => name.startsWith(originalQueue.result.id + '-') && name.endsWith('.json'),
        ),
        'Exact first queue attempt required',
      ),
    ),
  ).value;
  assert.equal(attempt.id, originalQueue.result.id);
  assert.deepEqual(attempt.lease, originalQueue.result.lease);
  const registry = createExecutionOrder(common).read();
  const ticket = registry.tickets.find((t) => t.task === task.id && t.lane === 'delivery');
  assertOriginalValidationFailure({
    task,
    state: registry,
    ticket,
    stage,
    attempt,
    journal,
    archivedTicket: manifest.ticket,
    host: os.hostname(),
  });
  assert.ok(
    !createTaskDeliveryQueue(common)
      .inspect()
      .tickets.some((t) => t.task === task.id),
  );
  for (const { token } of stage.processes) {
    assert.match(token, uuid);
    const file = path.join(directory, 'process-' + token + '.json');
    assert.equal(digest(file), digest(preserved(file)));
    const child = privateJson(file).value;
    assert.equal(child.token, token);
    assert.equal(child.status, 'quiescent');
    assert.equal(child.host, os.hostname());
    assertExited(-child.pgid);
  }
  assertExited(stage.owner.pid);
  assertExited(journal.pid);
  const active = path.join(common, 'task-registry/resource-leases', journal.lease.resource);
  assert.equal(active, manifest.originalPath);
  const archivedOwner = path.join(archive, journal.lease.resource, 'owner.json');
  assert.equal(archivedOwner, moved.archivedOwner.name);
  const archived = privateJson(archivedOwner);
  assert.deepEqual(archived.value, journal.lease);
  assert.equal(archived.hash, moved.originalOwner.sha256);
  assert.equal(archived.hash, digest(preserved(path.join(active, 'owner.json'))));
  assert.equal(String(archived.stat.ino), moved.originalOwner.metadata.inode);
  assert.equal(createResourceLeases(common).inspect(journal.lease.resource), null);
  const referenceDirectory = path.join(directory, 'reference-proofs');
  const reference = single(
    Object.values(manifest).filter(
      (value) =>
        typeof value?.name === 'string' &&
        path.dirname(path.dirname(value.name)) === referenceDirectory &&
        path.basename(value.name) === 'proof.json',
    ),
    'Exact original foreign proof required',
  );
  const proofFile = reference.name;
  const proof = privateJson(proofFile);
  assert.equal(proof.hash, reference.sha256);
  assert.equal(proof.value.consumer.task, task.id);
  assert.equal(proof.value.consumer.candidate, task.recordedHead);
  assert.equal(proof.value.consumer.accepted, task.frozen.accepted);
  assert.notEqual(proof.value.identity.task, task.id);
  const otherOwner = single(
    Object.values(manifest).filter((value) => value?.name === proof.value.identity.leaseFile.file),
    'Exact original foreign lease evidence required',
  );
  assert.equal(proof.value.identity.leaseFile.digest, otherOwner.sha256);
  const rejected = journal.cleanupFailure
    .split('\n')
    .find((line) => line.startsWith('Read-only observation evidence: '));
  const rejectedDir = rejected?.slice('Read-only observation evidence: '.length);
  assert.ok(
    rejectedDir &&
      path.dirname(rejectedDir) === referenceDirectory &&
      path.basename(rejectedDir).startsWith('observation-'),
  );
  const failure = privateJson(path.join(rejectedDir, '001-started.json')).value;
  assert.equal(failure.kind, 'started');
  assert.equal(failure.value.consumerTask, task.id);
  assert.deepEqual(failure.value.selector, proof.value.selector);
  assert.ok(attempt.failure.endsWith(transaction.original.name));
  const backend = single(
    moved.after.backends.filter((b) => b.port !== proof.value.identity.backendPort),
    'Exact recorded validation backend required',
  );
  assert.match(backend.id, /^[a-f0-9]{64}$/);
  assert.equal(backend.health, 'UP');
  assert.ok(Date.parse(backend.startedAt) >= stage.startedAt && Date.parse(backend.startedAt) <= stage.finishedAt);
  assert.ok(backend.port >= 8081 && backend.port <= 8099);
  const originalLog = regularReferenceFile(log).bytes.toString('utf8');
  assert.ok(
    originalLog.includes('http://127.0.0.1:' + backend.port) &&
      originalLog.includes('http://127.0.0.1:' + journal.port),
  );
  assert.equal(git(task.worktree, 'rev-parse', 'HEAD'), task.recordedHead);
  assert.equal(git(task.worktree, 'status', '--porcelain'), '');
  assert.equal(readAcceptance(task.worktree, task.id).commit, task.frozen.accepted);
  return {
    archive,
    manifestHash,
    moveHash,
    task: task.id,
    head: task.recordedHead,
    accepted: task.frozen.accepted,
    worker: taskExecutor(task),
    order: ticket.order,
    decision: ticket.dynamicDecisionId,
    attempt: attempt.id,
    stage: stage.id,
    backend,
    formerPort: journal.port,
    foreignProof: { file: proofFile, digest: proof.hash },
    foreign: {
      task: proof.value.identity.task,
      port: proof.value.identity.port,
      backendPort: proof.value.identity.backendPort,
      containerId: proof.value.identity.backend.id,
    },
  };
}
