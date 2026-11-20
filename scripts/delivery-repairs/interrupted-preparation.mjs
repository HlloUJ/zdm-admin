import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverInterrupted, recoverWriter } from '../completion-recovery.mjs';
import { createResourceLeases } from '../resource-lease.mjs';
import { assertHostIdle } from '../task-cancellation-proof.mjs';
import { readTaskCoordination } from '../task-coordination.mjs';
import { createTaskDeliveryQueue } from '../task-delivery-queue.mjs';
import {
  assertTaskExecutor,
  executionBinding,
  verifyCoordinatorObservation,
  verifyCoordinatorSource,
  verifyExecutionWorker,
} from '../task-execution-binding.mjs';
import { scopedAdmissions } from '../task-execution-scope.mjs';
import { withTaskRegistryWriteLock } from '../task-registry.mjs';
import { threadTitle } from '../task-thread-titles.mjs';

import { regularReferenceFile } from './preview-reference-history.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const oid = /^[0-9a-f]{40}$/;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) => sha(JSON.stringify(value));
const stat = (file) => lstatSync(file, { throwIfNoEntry: false });
const git = (cwd, ...args) =>
  execFileSync('git', ['--no-replace-objects', '--no-optional-locks', ...args], { cwd, encoding: 'utf8' }).trim();

function privateFile(file) {
  const { bytes, stat } = regularReferenceFile(file);
  assert.equal(stat.mode & 0o077, 0, 'Private original evidence required');
  const raw = bytes.toString('utf8');
  assert.ok(Buffer.from(raw).equals(bytes), 'Invalid evidence encoding');
  return { dev: stat.dev, ino: stat.ino, sha256: sha(bytes), raw };
}

function syncPath(file) {
  const fd = openSync(file, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// A complete, fsynced packet is visible before the first change to live state.
// link provides create-only publication even if a previous call lost its reply.
function publish(file, value) {
  const raw = JSON.stringify(value) + '\n';
  if (stat(file)) {
    const retained = JSON.parse(privateFile(file).raw);
    assert.deepEqual(retained, value, 'Recovery evidence already belongs to another observation');
    return retained;
  }
  const directory = path.dirname(file);
  const temp = path.join(directory, '.' + randomUUID() + '.tmp');
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeFileSync(fd, raw);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temp, file);
  } finally {
    unlinkSync(temp);
  }
  syncPath(directory);
  const retained = privateFile(file);
  assert.equal(retained.raw, raw, 'Recovery packet publication changed');
  return JSON.parse(retained.raw);
}

function assertGone(pid) {
  assert.ok(Number.isSafeInteger(pid) && Math.abs(pid) > 1, 'Unknown process identity');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'Live, reused or unobservable process/group');
}

function originalTicket(state, input, task, binding, coordination) {
  assert.equal(state.paused, true, 'The old preparation must be fenced by pause');
  assert.equal(state.revision, input.expectedQueueRevision, 'Queue revision changed');
  assert.equal(task.revision, input.expectedTaskRevision, 'Task revision changed');
  assert.equal(coordination.revision, input.expectedCoordinationRevision, 'Coordinator revision changed');
  assert.equal(task.owner, input.owner);
  assert.equal(binding.executor, input.executor);
  assert.equal(task.stage, 'pr-pending', 'Only the original pending PR preparation may recover');
  assert.ok(!task.previewOnly && !task.compatibility?.readOnly);
  assert.equal(task.frozen.accepted, input.accepted);
  assert.equal(task.recordedHead, input.head);
  const grant = state.dynamicAuthorities.find((g) => g.id === input.authorityId);
  assert.ok(
    grant && grant.registeredBy === input.coordinatorThreadId && grant.coordinationRevision === coordination.revision,
    'Current coordinator delegation required',
  );
  assert.ok(
    grant.source.tasks.some((t) => t.task === task.id && t.owner === task.owner && t.boardId === binding.boardTaskId),
    'Recovery is outside delegated task scope',
  );
  assert.equal(grant.request.authorId, coordination.current.request.authorId);
  assert.equal(
    input.request.roomId,
    input.coordinatorThreadId,
    'Read recovery instruction in current coordinator chat',
  );
  assert.deepEqual(input.request, grant.request, 'Exact newly delegated recovery instruction required');
  const decision = state.dynamicDecisions.find((d) => d.id === input.decisionId);
  assert.ok(
    decision?.status === 'consumed' && decision.input.phase === 'preparation' && decision.input.lane === 'delivery',
    'Original consumed preparation decision required',
  );
  assert.equal(decision.input.task, task.id);
  assert.equal(decision.input.owner, task.owner);
  assert.equal(decision.input.executor, binding.executor);
  assert.equal(decision.bindingRevision, binding.revision);
  assert.equal(digest(decision.ticketBefore), decision.ticketDigest);
  const ticket = state.tickets.find((t) => t.task === task.id && t.lane === 'delivery');
  const expected = {
    ...decision.ticketBefore,
    status: 'running',
    admission: decision.admission,
    dynamicDecisionId: decision.id,
    monitorContext: binding.monitoring,
  };
  delete expected.reason;
  assert.deepEqual(ticket, expected, 'Original ticket, order or admission changed');
  assert.equal(ticket.owner, task.owner);
  assert.equal(ticket.request.authorId, grant.request.authorId);
  assert.ok(
    !scopedAdmissions(state).some((s) => s.task === task.id) &&
      !state.dynamicDecisions.some((d) => d.input.task === task.id && d.status === 'reserved'),
    'Task already admitted or reserved',
  );
  const applied = state.events.findLastIndex((e) => e.action === 'dispatch-applied' && e.task === task.id);
  const pause = state.events.findLastIndex((e) => e.action === 'pause-all');
  assert.ok(
    applied >= 0 && pause > applied && grant.request.sequence > state.events[pause].request.sequence,
    'Fresh delegation after the fencing pause required',
  );
  const event = state.events[applied];
  assert.ok(
    event.decisionId === decision.id &&
      event.admission === ticket.admission &&
      event.owner === task.owner &&
      event.phase === 'preparation',
    'Another decision superseded this preparation',
  );
  return { decision, ticket, pause: state.events[pause], grant };
}

async function nativeProof(input, host, task, binding, current, planning) {
  const coordinator = await host.readThread(current.coordinator);
  assert.equal(coordinator.thread.hostId, 'local');
  const appointment = verifyCoordinatorObservation(coordinator, current.coordination.current);
  const source = await verifyCoordinatorSource(
    { rootThreadId: current.coordinator, request: input.request },
    host.readThread,
  );
  const message = source.turns
    .flatMap((t) => t.items ?? [])
    .find((i) => i.type === 'userMessage' && i.id === input.request.messageId);
  const board = await host.readTask(binding.boardTaskId);
  assert.ok(
    board.id === binding.boardTaskId && !board.deleted_at && ['active', 'review', 'merging'].includes(board.status),
  );
  assert.equal(board.revision, input.expectedBoardRevision, 'Board revision changed');
  const worker = await host.readThread(binding.executor);
  assert.equal(worker.thread.hostId, 'local');
  assert.ok(
    (planning ? ['idle', 'error'] : ['active']).includes(worker.thread.status?.type),
    'Wrong native worker state for recovery',
  );
  const original = binding.nativeEvidence.worker;
  const created = verifyExecutionWorker(
    worker,
    { taskId: task.id, owner: binding.executor, rootThreadId: original.sourceRootThreadId },
    threadTitle(board),
  );
  assert.equal(original.creationMessageId, created.id);
  assert.equal(original.creationDigest, digest(created), 'Worker creation provenance changed');
  return {
    message,
    appointmentDigest: digest(appointment),
    board: { id: board.id, revision: board.revision, title: threadTitle(board) },
    workerCreation: created.id,
  };
}

function liveRemote(root, pr, runId) {
  const gh = (...args) => JSON.parse(execFileSync('gh', args, { cwd: root, encoding: 'utf8', timeout: 30000 }));
  const repository = gh('repo', 'view', '--json', 'nameWithOwner').nameWithOwner;
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  const pull = gh('pr', 'view', String(pr), '--repo', repository, '--json', 'number,state,url,headRefOid,headRefName');
  const run = gh('api', 'repos/' + repository + '/actions/runs/' + runId);
  return {
    pull,
    repository,
    run: {
      id: run.id,
      attempt: run.run_attempt,
      event: run.event,
      head: run.head_sha,
      branch: run.head_branch,
      repository: run.repository.full_name,
      path: run.path,
      status: run.status,
      conclusion: run.conclusion,
    },
  };
}

function readWait(session, lease, input, branch) {
  assert.equal(session.version, 1);
  assert.equal(session.batch, input.task);
  assert.ok(!session.closedAt);
  for (const entries of [session.events, session.repairs, session.pauses ?? []]) {
    assert.ok(Array.isArray(entries));
    assert.equal(new Set(entries.map((e) => e.id)).size, entries.length, 'Duplicate completion record identity');
  }
  for (const e of session.events) {
    assert.match(e.id, uuid);
    if (e.name === 'discovery' && e.key === 'pr:' + input.head && e.status === 'success')
      assert.equal(String(e.result), input.runId, 'Multiple PR run identities for this candidate');
    if (e.name === 'ci' && e.key.startsWith(input.head + ':')) {
      assert.equal(e.key, input.head + ':' + input.runId, 'Another PR run already recorded for this candidate');
      assert.ok(!e.failure?.ci, 'Preserve the original failed remote run');
    }
  }
  const running = session.events.filter((event) => event.status === 'running');
  assert.equal(running.length, 1, 'One interrupted preparation wait required');
  const wait = running[0];
  assert.equal(wait.id, input.eventId);
  assert.ok(Number.isSafeInteger(wait.startedAt) && wait.startedAt <= Date.now(), 'Unknown wait start');
  assert.equal(wait, session.events.at(-1), 'Newer session event present');
  assert.ok(
    wait.name === 'ci' &&
      wait.key === input.head + ':' + input.runId &&
      !wait.finishedAt &&
      !wait.result &&
      !wait.failure,
  );
  assert.deepEqual(wait.owner, { host: os.hostname(), pid: lease.pid });
  const events = session.events.slice(-5, -1);
  assert.deepEqual(
    events.map((e) => [e.name, e.key]),
    [
      ['prepare', input.head],
      ['push', input.head],
      ['pr', input.head],
      ['discovery', 'pr:' + input.head],
    ],
  );
  for (const e of events) {
    assert.equal(e.status, 'success');
    assert.deepEqual(e.owner, wait.owner);
  }
  const [ready, push, pr, discovery] = events.map((e) => e.result);
  assert.ok(
    ready.head === input.head &&
      ready.protectionChecked === true &&
      ready.runtimePreflight === true &&
      push.head === input.head,
  );
  assert.ok(pr.number === input.pr && pr.state === 'OPEN' && pr.headRefOid === input.head);
  assert.equal(String(discovery), input.runId, 'Original discovered run changed');
  return { number: input.pr, state: 'OPEN', url: pr.url, headRefName: branch, headRefOid: input.head };
}

function collectOriginal(directory, leaseFile, input, task) {
  const session = privateFile(path.join(directory, 'completion-session.json')),
    lease = privateFile(leaseFile);
  const owner = JSON.parse(lease.raw),
    state = JSON.parse(session.raw);
  assert.equal(owner.resource, 'task-delivery-' + task.id);
  assert.equal(owner.task, task.owner);
  assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 1, 'Unknown lease PID');
  assert.match(owner.token, uuid);
  const pull = readWait(state, owner, input, task.branch);
  const tokens = state.events.flatMap((e) => {
    assert.ok(e.processTracking === 1 && Array.isArray(e.processes), 'Missing process inventory');
    return e.processes.map((p) => {
      assert.match(p.token, uuid);
      return p.token;
    });
  });
  assert.equal(new Set(tokens).size, tokens.length, 'Duplicate process reference');
  const names = tokens.map((token) => 'process-' + token + '.json').sort();
  assert.deepEqual(
    readdirSync(directory)
      .filter((n) => /^process-.*\.json$/.test(n))
      .sort(),
    names,
    'Unreferenced or missing process journal',
  );
  const journals = Object.fromEntries(names.map((n) => [n, privateFile(path.join(directory, n))]));
  const writerFile = path.join(directory, 'completion-session.json.lock');
  const writer = stat(writerFile) ? privateFile(writerFile) : null;
  if (writer) assert.deepEqual(JSON.parse(writer.raw), state.events.at(-1).owner, 'Foreign completion writer');
  return {
    lease,
    leaseDirectory: leaseDirectoryIdentity(leaseFile),
    session,
    writer,
    journals,
    accepted: privateFile(path.join(directory, 'accepted-source.json')),
    pull,
  };
}

function verifyStopped(original) {
  assertGone(JSON.parse(original.lease.raw).pid);
  for (const [name, file] of Object.entries(original.journals)) {
    const j = JSON.parse(file.raw);
    assert.equal(name, 'process-' + j.token + '.json');
    assert.ok(
      j.host === os.hostname() &&
        Number.isSafeInteger(j.pgid) &&
        j.pgid > 1 &&
        ['started', 'exited', 'quiescent'].includes(j.status),
      'Unprovable process group identity',
    );
    assertGone(-j.pgid); // Also reject a reused group even when the old launch was sealed.
  }
}

function observeIdle(observe, task, directory, leaseFolder) {
  const snapshot = observe();
  assertHostIdle(snapshot, task);
  // The session and lease live in the Git common directory, outside the
  // registered worktree checked by the ordinary host-idle predicate.
  for (const { name } of snapshot.files) {
    const file = name.replace(/ \(deleted\)$/, '');
    assert.ok(
      ![directory, leaseFolder].some((root) => file === root || file.startsWith(root + path.sep)),
      'Preparation evidence is still open',
    );
  }
}

function leaseDirectoryIdentity(leaseFile) {
  const folder = path.dirname(leaseFile);
  assert.equal(realpathSync(folder), folder);
  assert.deepEqual(readdirSync(folder), ['owner.json'], 'Unknown files in the original lease');
  const directory = lstatSync(folder);
  assert.ok(directory.isDirectory() && directory.uid === process.getuid() && !(directory.mode & 0o077));
  return { dev: directory.dev, ino: directory.ino };
}

// An interrupted apply may have completed only the journal seal or atomic
// session save. Only the exact transformation of the archived bytes is resumable.
function checkLive(directory, leaseFile, plan, intent) {
  const { original, input } = plan;
  const file = path.join(directory, 'completion-session.json');
  const session = privateFile(file);
  let saved = false;
  if (session.sha256 === original.session.sha256) assert.deepEqual(session, original.session, 'Session inode changed');
  else {
    assert.ok(intent, 'Session changed before authorized recovery');
    const expected = JSON.parse(original.session.raw),
      event = expected.events.at(-1);
    Object.assign(event, {
      status: 'failure',
      finishedAt: intent.at,
      failure: { category: 'interrupted' },
      durationBasis: 'upper-bound-until-recovery; execution-stop-time-unknown',
    });
    assert.equal(session.raw, JSON.stringify(expected, null, 2) + '\n', 'Unexpected recovered session');
    saved = true;
  }
  assert.deepEqual(privateFile(path.join(directory, 'accepted-source.json')), original.accepted);
  const names = readdirSync(directory)
    .filter((n) => /^process-.*\.json$/.test(n))
    .sort();
  assert.deepEqual(names, Object.keys(original.journals));
  for (const name of names) {
    const before = original.journals[name],
      actual = privateFile(path.join(directory, name));
    if (saved) assert.equal(JSON.parse(actual.raw).status, 'quiescent', 'Recovered session has an unsealed journal');
    if (before.sha256 === actual.sha256) assert.deepEqual(actual, before, 'Journal inode changed');
    else {
      const j = JSON.parse(before.raw);
      assert.ok(intent && j.status !== 'quiescent', 'Journal changed before authorized recovery');
      assert.equal(actual.raw, JSON.stringify({ ...j, status: 'quiescent' }), 'Unexpected journal change');
    }
  }
  const writerFile = file + '.lock';
  if (stat(writerFile)) {
    assert.equal(saved, false, 'Unexpected writer on recovered session');
    assert.deepEqual(privateFile(writerFile), original.writer, 'Session writer changed');
  } else assert.ok(!original.writer || intent, 'Original writer changed before recovery');
  const leased = Boolean(stat(path.dirname(leaseFile)));
  const retained = path.join(directory, 'preparation-recovery', input.recoveryId + '.lease');
  if (leased) {
    assert.ok(!stat(retained), 'Retained lease already exists');
    assert.deepEqual(leaseDirectoryIdentity(leaseFile), original.leaseDirectory, 'Lease directory identity changed');
    assert.deepEqual(privateFile(leaseFile), original.lease, 'Lease identity changed');
  } else {
    assert.ok(
      saved && intent && intent.decisionId === input.decisionId,
      'Original lease disappeared without recovery evidence',
    );
    const retainedOwner = path.join(retained, 'owner.json');
    assert.deepEqual(
      leaseDirectoryIdentity(retainedOwner),
      original.leaseDirectory,
      'Missing original retained lease directory',
    );
    assert.deepEqual(privateFile(retainedOwner), original.lease, 'Missing original retained lease owner');
  }
  return { leased, saved };
}

export async function interruptedPreparation(
  input,
  host,
  { planning, current, registry, queue, observe, frozenCheckpoint },
) {
  const { commonDir } = registry;
  for (const id of [input.recoveryId, input.decisionId, input.eventId]) assert.match(id, uuid);
  for (const id of [input.accepted, input.head]) assert.match(id, oid);
  assert.ok(
    Number.isSafeInteger(input.pr) && input.pr > 0 && typeof input.runId === 'string' && /^[1-9]\d*$/.test(input.runId),
  );
  const task = registry.resolve({ id: input.task }),
    binding = executionBinding(task);
  assert.ok(binding, 'Original historical execution binding required');
  if (!planning) assertTaskExecutor(task);
  const state = queue.read();
  const context = originalTicket(state, input, task, binding, current.coordination);
  const { planDigest, ...request } = input;
  assert.deepEqual(
    Object.keys(request).sort(),
    [
      'accepted',
      'authorityId',
      'coordinatorThreadId',
      'decisionId',
      'eventId',
      'executor',
      'expectedBoardRevision',
      'expectedCoordinationRevision',
      'expectedQueueRevision',
      'expectedTaskRevision',
      'head',
      'owner',
      'pr',
      'recoveryId',
      'request',
      'runId',
      'task',
    ].sort(),
    'Only the scoped recovery fields are accepted',
  );
  if (planning) assert.equal(planDigest, undefined);
  else assert.match(planDigest, /^[0-9a-f]{64}$/);
  const directory = path.join(commonDir, 'task-delivery', task.id),
    name = 'task-delivery-' + task.id;
  const leases = createResourceLeases(commonDir),
    leaseRoot = path.join(registry.directory, 'resource-leases');
  const leaseFile = path.join(leaseRoot, name, 'owner.json'),
    archive = path.join(directory, 'preparation-recovery');
  const prefix = path.join(archive, input.recoveryId);
  const native = await nativeProof(input, host, task, binding, current, planning);
  const plan = planning ? null : JSON.parse(privateFile(prefix + '.plan.json').raw);
  if (plan) {
    assert.deepEqual(plan.input, request, 'Apply requires exact coordinator-issued plan');
    assert.equal(digest(plan), planDigest, 'Coordinator plan digest changed');
    assert.deepEqual(plan.native, native);
  }
  const original = plan?.original ?? collectOriginal(directory, leaseFile, input, task);
  assert.equal(digest(Buffer.from(original.accepted.raw)), context.decision.sourceProof.acceptedRecord);
  assert.deepEqual(
    native.message,
    context.grant.source.message,
    'Native recovery instruction differs from the registered delegation',
  );
  const remote = liveRemote(task.worktree, input.pr, input.runId);
  assert.deepEqual(remote.pull, original.pull, 'Remote PR candidate changed');
  assert.equal(remote.run.repository, remote.repository);
  assert.equal(String(remote.run.id), input.runId);
  assert.deepEqual(
    [
      remote.run.head,
      remote.run.branch,
      remote.run.path,
      remote.run.event,
      remote.run.attempt,
      remote.run.status,
      remote.run.conclusion,
    ],
    [input.head, task.branch, '.github/workflows/quality.yml', 'pull_request', 1, 'completed', 'success'],
    'Original first-attempt quality run required',
  );
  const packet = {
    version: 1,
    input: request,
    native,
    context: {
      decision: context.decision,
      ticket: context.ticket,
      pause: context.pause,
      grantDigest: context.grant.digest,
      coordination: current.coordination.current,
      bindingRevision: binding.revision,
    },
    original,
    remote,
  };
  if (plan) assert.deepEqual(packet, plan, 'Current evidence differs from the coordinator plan');
  const planHash = digest(plan ?? packet);
  function checkSource() {
    assert.deepEqual(registry.readTask(task.id), task);
    assert.deepEqual(readTaskCoordination(commonDir), current.coordination);
    assert.equal(queue.read().revision, state.revision, 'Queue changed during recovery');
    assert.equal(git(task.worktree, 'branch', '--show-current'), task.branch);
    assert.equal(git(task.worktree, 'rev-parse', 'HEAD'), input.head);
    git(task.worktree, 'merge-base', '--is-ancestor', context.decision.sourceProof.head, input.head);
    assert.equal(frozenCheckpoint(task), context.decision.sourceProof.accepted);
    for (const resource of readdirSync(leaseRoot).filter((r) => r !== name)) {
      const other = leases.inspect(resource);
      assert.ok(
        other && ![task.id, task.owner, binding.executor].includes(other.task),
        'Another target resource is owned',
      );
    }
    assert.ok(
      !createTaskDeliveryQueue(commonDir)
        .inspect()
        .tickets.some((t) => t.task === task.id && t.status === 'running'),
      'Target has a final main writer',
    );
  }
  checkSource();
  observeIdle(observe, task, directory, path.dirname(leaseFile));
  verifyStopped(original);
  assert.deepEqual(
    await nativeProof(input, host, task, binding, current, planning),
    native,
    'Native recovery evidence changed',
  );
  const commitRecovery = () => {
    checkSource();
    observeIdle(observe, task, directory, path.dirname(leaseFile));
    verifyStopped(original);
    const intentFile = prefix + '.intent.json',
      receiptFile = prefix + '.receipt.json';
    const priorIntent = !planning && stat(intentFile) ? JSON.parse(privateFile(intentFile).raw) : null;
    if (priorIntent) {
      assert.equal(priorIntent.planDigest, planHash);
      assert.equal(priorIntent.decisionId, input.decisionId);
      assert.ok(
        Number.isSafeInteger(priorIntent.at) &&
          priorIntent.at >= JSON.parse(original.session.raw).events.at(-1).startedAt &&
          priorIntent.at <= Date.now(),
      );
    }
    const live = checkLive(directory, leaseFile, packet, priorIntent);
    if (planning) {
      mkdirSync(archive, { recursive: true, mode: 0o700 });
      assert.equal(realpathSync(archive), archive);
      assert.equal(lstatSync(archive).mode & 0o077, 0);
      syncPath(directory);
      const issued = publish(prefix + '.plan.json', packet);
      return {
        status: 'recovery-planned',
        workerInput: { ...issued.input, planDigest: digest(issued) },
        leaseSha256: original.lease.sha256,
        sessionSha256: original.session.sha256,
        admission: null,
      };
    }
    const intent = priorIntent ?? { planDigest: planHash, decisionId: input.decisionId, at: Date.now() };
    if (stat(receiptFile)) assert.ok(priorIntent && live.saved && !live.leased, 'Conflicting prior recovery receipt');
    if (!priorIntent) publish(intentFile, intent);
    if (live.leased) {
      assert.equal(
        leases.recoverEndedTask(
          name,
          task.owner,
          () => {
            verifyStopped(original);
            const still = checkLive(directory, leaseFile, packet, intent);
            recoverWriter(directory);
            if (!still.saved) recoverInterrupted(JSON.parse(original.session.raw), directory, { now: intent.at });
            assert.equal(checkLive(directory, leaseFile, packet, intent).saved, true);
            for (const [name, originalFile] of Object.entries(original.journals))
              if (JSON.parse(originalFile.raw).status !== 'quiescent') syncPath(path.join(directory, name));
            syncPath(path.join(directory, 'completion-session.json'));
            syncPath(directory);
            verifyStopped(original);
            return true;
          },
          { recoveryId: input.recoveryId },
        ),
        true,
        'Original preparation lease is still live or missing',
      );
    }
    assert.deepEqual(checkLive(directory, leaseFile, packet, intent), { leased: false, saved: true });
    syncPath(leaseRoot);
    syncPath(archive);
    const recoveredSession = privateFile(path.join(directory, 'completion-session.json'));
    const receipt = {
      status: 'interrupted-preparation-recovered',
      planDigest: planHash,
      task: task.id,
      owner: task.owner,
      executor: binding.executor,
      decisionId: input.decisionId,
      eventId: input.eventId,
      head: input.head,
      accepted: input.accepted,
      pr: input.pr,
      runId: input.runId,
      order: context.ticket.order,
      sessionSha256: recoveredSession.sha256,
      sessionInode: recoveredSession.ino,
      leaseInode: original.lease.ino,
      attempt: remote.run.attempt,
      recoveredAt: new Date(intent.at).toISOString(),
      admission: null,
      formalDeliveryComplete: false,
    };
    publish(receiptFile, receipt);
    return receipt;
  };
  return queue.guard(() =>
    withTaskRegistryWriteLock(path.join(commonDir, 'task-coordination'), () =>
      withTaskRegistryWriteLock(registry.directory, commitRecovery),
    ),
  );
}
