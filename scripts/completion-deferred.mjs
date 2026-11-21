import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { assertAcceptedSource } from './accepted-source.mjs';
import { assertCompletionQuality } from './completion-ci-evidence.mjs';
import { writeReceipt } from './completion-recovery.mjs';
import { SCOPE_DIGEST, SCOPE_ID } from './delivery-repairs/task-cleanup-exact-scope.mjs';
import { readTaskCoordination } from './task-coordination.mjs';
import { isRuntimeFile } from './runtime-file-scope.mjs';
import { temporaryPreviewLeases } from './preview-consumers.mjs';
import { taskProjectName } from './dev-task.mjs';
import { taskExecutor } from './task-execution-binding.mjs';
import { deliveryCiCapability } from './verification-policy.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SLOT_HOURS = 12 * 3600000;

// The existing calendar acceptance belongs to this scheduler and its original
// verification host. Other deferred workflows need their own acceptance reader.
export function calendarRequirements(task, slots, sourceHead) {
  assert.equal(task, 'scheduled-manifest-cleanup', 'No published calendar verifier for this task');
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  assert.equal(slots.length, 2);
  const times = slots.map((slot) => {
    const t = Date.parse(slot);
    assert.equal(new Date(t).toISOString(), slot);
    assert.ok([5, 17].includes(new Date(t).getUTCHours()) && t % 3600000 === 0, 'Exact Beijing calendar slot required');
    return t;
  });
  assert.equal(times[1] - times[0], SLOT_HOURS, 'Consecutive calendar slots required');
  return { slots, sourceHead };
}

function readPrivate(file) {
  assert.equal(realpathSync(file), file, 'Linked settlement evidence');
  const s = lstatSync(file);
  assert.ok(
    s.isFile() && s.nlink === 1 && (s.mode & 0o077) === 0 && s.size <= 2 * 1024 ** 2,
    'Unsafe settlement evidence',
  );
  return JSON.parse(readFileSync(file));
}

export function originalDeliveryProof(task, state, main, runId) {
  assert.equal(state.batch, task.id);
  assert.ok(['handoff-verified', 'closed'].includes(task.stage), 'Original handoff is incomplete');
  assert.equal(task.main?.local, main);
  assert.equal(task.main?.remote, main);
  const ci = state.events.findLast((e) => e.name === 'ci' && e.key === main + ':' + runId && e.status === 'success');
  const handoff = state.events.findLast(
    (e) => e.name === 'handoff' && e.key === main + ':final' && e.status === 'success',
  );
  assert.equal(ci?.result?.branch, 'main');
  assert.equal(ci.result.eventName, 'push');
  assertCompletionQuality(ci.result, main, runId);
  assert.equal(handoff?.result?.main, main, 'Exact original final handoff missing');
  assert.ok(handoff.finishedAt <= Date.parse(state.deferredSettlement?.deferredAt ?? new Date().toISOString()));
  return { ci, handoff };
}

function deferredArchive(directory, task, state, ticket, calendar) {
  const { head, main, runId, deferredAt } = ticket.deferred ?? {};
  assert.equal(ticket.task, task.id);
  assert.equal(ticket.owner, task.owner);
  assert.equal(ticket.accepted, task.frozen?.accepted);
  assert.equal(head, task.recordedHead);
  assert.ok(ticket.mainMutationStarted);
  assert.equal(state.deferredSettlement?.status, 'pending');
  assert.deepEqual(
    { head, main, runId, deferredAt },
    Object.fromEntries(['head', 'main', 'runId', 'deferredAt'].map((key) => [key, state.deferredSettlement[key]])),
    'Original deferred session and queue ticket differ',
  );
  const { ci, handoff } = originalDeliveryProof(task, state, main, runId);
  const file = path.join(directory, 'deferred-handoff.json');
  const archive = {
    version: 1,
    task: task.id,
    owner: task.owner,
    executor: taskExecutor(task),
    bindingRevision: task.executionBindings?.at(-1)?.revision ?? 0,
    ticket: ticket.id,
    sequence: ticket.sequence,
    accepted: ticket.accepted,
    head,
    main,
    runId,
    deferredAt,
    ciDigest: digest(ci),
    handoffDigest: digest(handoff),
    calendar,
  };
  return { file, archive, release: { archive: digest(archive) } };
}

export function preserveDeferredHandoff(directory, task, state, ticket, calendar) {
  const result = deferredArchive(directory, task, state, ticket, calendar);
  assert.ok(
    Date.parse(calendar.slots[0]) > Date.parse(result.archive.deferredAt),
    'Cycle must follow original handoff',
  );
  if (existsSync(result.file)) assert.deepEqual(readPrivate(result.file), result.archive, 'Archived handoff changed');
  else writeReceipt(result.file, result.archive);
  return result;
}

export function readDeferredHandoff(directory, task, state, ticket) {
  const stored = readPrivate(path.join(directory, 'deferred-handoff.json'));
  const calendar = calendarRequirements(stored.task, stored.calendar.slots, stored.calendar.sourceHead);
  const result = deferredArchive(directory, task, state, ticket, calendar);
  assert.deepEqual(stored, result.archive, 'Archived handoff changed');
  assert.deepEqual(ticket.deferred.release, result.release, 'Main FIFO release differs from archive');
  return result;
}

export function liveMainQuality(anchor, execute, repository, main, runId) {
  const live = JSON.parse(execute(anchor, 'gh', ['api', `repos/${repository}/actions/runs/${runId}`]));
  assert.equal(live.head_sha, main);
  assert.equal(live.run_attempt, 1);
  assert.equal(live.conclusion, 'success');
  assert.equal(live.status, 'completed');
  assert.equal(live.path, '.github/workflows/quality.yml');
  assert.equal(live.event, 'push');
  assert.equal(live.head_branch, 'main');
}

export function verifyDeferredLineage({ anchor, registry, archive, execute }) {
  const git = (...args) => execute(anchor, 'git', args);
  git('fetch', 'origin');
  const current = git('rev-parse', 'HEAD');
  assert.equal(git('rev-parse', 'origin/main'), current, 'Main anchor must match freshly fetched origin/main');
  assert.equal(git('status', '--porcelain'), '');
  const capability = deliveryCiCapability(anchor, (command, args) => execute(anchor, command, args));
  assert.equal(capability.verified, true, 'Protected main quality policy must be proven');
  assertAcceptedSource(anchor, archive.task, archive.main);
  assert.equal(assertAcceptedSource(anchor, archive.task, archive.head).accepted, archive.accepted);
  liveMainQuality(anchor, execute, capability.repository, archive.main, archive.runId);
  const commits = git('rev-list', '--first-parent', '--reverse', archive.main + '..' + current)
    .split('\n')
    .filter(Boolean);
  const tasks = commits.length ? registry.list() : [];
  let previous = archive.main;
  const successors = commits.map((sha) => {
    const [commit, parent, candidate, ...extra] = git('rev-list', '--parents', '-n', '1', sha).split(' ');
    assert.ok(
      commit === sha && parent === previous && candidate && !extra.length,
      'Main history is not a continuous merge chain',
    );
    const matches = tasks.filter((task) => task.main?.local === sha && task.recordedHead === candidate);
    assert.equal(matches.length, 1, 'Exact successor handoff registry missing for ' + sha);
    const task = matches[0];
    const session = readPrivate(path.join(registry.commonDir, 'task-delivery', task.id, 'completion-session.json'));
    const ownCi = session.events.findLast(
      (e) => e.name === 'ci' && e.status === 'success' && e.result?.headSha === sha,
    );
    const runId = String(ownCi?.result?.runId ?? '');
    assert.match(runId, /^\d+$/);
    const { ci, handoff } = originalDeliveryProof(task, session, sha, runId);
    assert.equal(
      git('rev-parse', sha + '^{tree}'),
      git('rev-parse', candidate + '^{tree}'),
      'Successor candidate tree differs',
    );
    assert.equal(assertAcceptedSource(anchor, task.id, sha).accepted, task.frozen?.accepted);
    liveMainQuality(anchor, execute, capability.repository, sha, runId);
    previous = sha;
    return { task: task.id, main: sha, head: candidate, runId, ciDigest: digest(ci), handoffDigest: digest(handoff) };
  });
  assert.equal(previous, current, 'Original main is not on the current first-parent chain');
  assert.equal(git('ls-remote', 'origin', 'refs/heads/main'), current + '\trefs/heads/main', 'Remote main changed');
  return { main: current, successors };
}

const LABEL = 'com.zdm.admin.manifest-cleanup';
const MINUTE = 60_000;

function readLaunchd(observation, sourceHead, common) {
  assert.match(observation?.bootSession ?? '', /^[0-9a-f-]{36}$/i, 'macOS boot session required');
  const at = Date.parse(observation.observedAt),
    output = observation.output;
  assert.ok(Number.isFinite(at) && typeof output === 'string' && output.length <= 32_768);
  const domain = /^\t(?:domain) = (gui\/\d+ \[\d+\])$/m.exec(output)?.[1];
  assert.ok(
    domain && output.startsWith(domain.split(' ')[0] + '/' + LABEL + ' '),
    'Exact loaded launchd service required',
  );
  const argumentsBlock = /^\targuments = \{\n([\s\S]*?)^\t\}/m.exec(output)?.[1];
  const args = argumentsBlock
    ?.trim()
    .split('\n')
    .map((line) => line.trim());
  const runtime = path.join(common, 'task-cleanup/runtime', sourceHead);
  assert.ok(args?.length === 4 && path.isAbsolute(args[0]), 'Exact scheduler invocation required');
  assert.deepEqual(args.slice(1), [
    path.join(runtime, 'scripts/task-cleanup-scheduled-cli.mjs'),
    runtime,
    '--exact-scope',
  ]);
  const runs = Number(/^\truns = (\d+)$/m.exec(output)?.[1]);
  assert.ok(Number.isSafeInteger(runs) && /^\tstate = not running$/m.test(output));
  assert.match(output, /^\tlast exit code = 0$/m);
  const triggerBlock = /^\tevent triggers = \{\n([\s\S]*?)^\t\}/m.exec(output)?.[1] ?? '';
  const triggers = [
    ...triggerBlock.matchAll(/^\t\tcom\.zdm\.admin\.manifest-cleanup\.(\d+) => \{\n([\s\S]*?)^\t\t\}/gm),
  ]
    .map(([, id, registration]) => {
      assert.match(registration, /^\s+stream = com\.apple\.launchd\.calendarinterval$/m);
      assert.match(registration, /^\s+"Minute" => 0$/m);
      return { id, hour: Number(/^\s+"Hour" => (\d+)$/m.exec(registration)?.[1]) };
    })
    .sort((a, b) => a.hour - b.hour);
  assert.deepEqual(
    triggers.map((item) => item.hour),
    [1, 13],
    'Both exact launchd calendar registrations required',
  );
  assert.notEqual(triggers[0].id, triggers[1].id);
  return { at, runs, identity: { bootSession: observation.bootSession, domain, args, triggers } };
}

export function verifyCalendarAcceptance({
  directory,
  archive,
  evidenceFile,
  schedule,
  destination,
  now = Date.now(),
}) {
  assert.ok(evidenceFile && path.dirname(evidenceFile) === directory, 'Original executor calendar receipt required');
  const receipt = readPrivate(evidenceFile);
  assert.equal(receipt.version, 1);
  assert.equal(receipt.task, archive.task);
  assert.equal(receipt.executor, archive.executor);
  assert.equal(receipt.main, archive.main);
  assert.ok(Array.isArray(receipt.observations), 'Original calendar observations required');
  assert.deepEqual(
    receipt.observations.map((item) => item.slot),
    archive.calendar.slots,
  );
  assert.equal(schedule?.version, 1, 'Original scheduler journal missing');
  const common = path.dirname(path.dirname(directory)),
    messages = new Set(),
    notices = new Set();
  let previous;
  const notificationStatuses = receipt.observations.map((observation) => {
    const matches = schedule.recent.filter((entry) => entry.slot === observation.slot);
    assert.equal(matches.length, 1, 'Real calendar run missing or ambiguous');
    const [run] = matches;
    assert.equal(run.sourceHead, archive.calendar.sourceHead);
    assert.deepEqual(
      run.cleanupScope,
      {
        version: 1,
        id: SCOPE_ID,
        sourceTask: 'delivery-standard-optimization',
        manifestSetSha256: SCOPE_DIGEST,
      },
      'Original authorized cleanup scope required',
    );
    assert.equal(run.status, 'completed');
    assert.ok(['idle', 'delivered'].includes(run.notification), 'Calendar notification is unresolved');
    assert.match(run.lockToken, /^[a-f0-9-]{36}$/);
    const slot = Date.parse(run.slot),
      started = Date.parse(run.startedAt),
      finished = Date.parse(run.finishedAt);
    assert.ok(
      started >= slot && started < slot + MINUTE && finished >= started && finished <= now,
      'The actual start must be in the intended calendar minute',
    );
    assert.ok(!run.recoveredFrom, 'A recovered or manual replay cannot substitute for the calendar run');
    const before = readLaunchd(observation.launchd?.before, run.sourceHead, common);
    const after = readLaunchd(observation.launchd?.after, run.sourceHead, common);
    const events = observation.launchd.events ?? [];
    assert.ok(Array.isArray(events) && events.length <= 100);
    for (const event of events) {
      const time = Date.parse(event.timestamp);
      assert.ok(time >= before.at && time <= after.at);
      assert.ok(typeof event.eventMessage === 'string' && event.eventMessage.includes(LABEL));
      assert.doesNotMatch(
        event.eventMessage,
        /\b(?:bootstrap|bootout|kickstart|manual|unregister(?:ed)?|register(?:ed)?|reload(?:ed)?|loaded|unloaded)\b/i,
        'Observed launchd reload or manual intervention',
      );
    }
    assert.deepEqual(after.identity, before.identity, 'launchd calendar registration changed during the cycle');
    assert.equal(after.runs, before.runs + 1, 'Exactly one run of the same loaded launchd service required');
    assert.ok(
      before.at >= slot - 2 * MINUTE && before.at < slot && after.at >= finished && after.at <= finished + 5 * MINUTE,
      'Original timed launchd observations must bracket the calendar run',
    );
    if (previous) {
      assert.deepEqual(before.identity, previous.identity, 'launchd calendar registration changed between cycles');
      assert.equal(before.runs, previous.runs, 'Unexpected launchd run between the two calendar slots');
    }
    previous = after;
    const readback = observation.nativeReadback;
    assert.equal(readback?.provider, 'codex-native-read_thread');
    assert.equal(readback.threadId, archive.executor, 'Original verification chat readback required');
    assert.equal(readback.message?.phase, 'commentary');
    assert.ok(readback.turnId && readback.message.id && !messages.has(readback.message.id));
    assert.ok(Date.parse(readback.observedAt) >= after.at && Date.parse(readback.observedAt) <= now);
    assert.ok(
      readback.message.text.includes(run.slot) && readback.message.text.includes(digest(run)),
      'Native report must identify the exact observed calendar run',
    );
    messages.add(readback.message.id);

    const readbacks = observation.notificationReceipts ?? [];
    assert.ok(Array.isArray(readbacks));
    if (run.notification === 'idle') assert.equal(readbacks.length, 0, 'Idle is not notification delivery');
    else {
      assert.ok(destination && readbacks.length > 0, 'Delivered notification requires its fixed-destination receipt');
      for (const { eventId, receiptDigest } of readbacks) {
        assert.match(eventId, /^[a-f0-9]{64}$/);
        assert.ok(!notices.has(eventId), 'Notification receipt covers only one cycle');
        const record = readPrivate(path.join(common, 'task-cleanup/notices', eventId + '.json'));
        assert.equal(digest(record), receiptDigest);
        assert.equal(record.eventId, eventId);
        assert.equal(record.status, 'delivered');
        assert.equal(record.destination, destination);
        assert.equal(record.receipt?.destination, destination);
        assert.equal(record.readback?.roomId, destination);
        assert.ok(record.receipt?.messageId && record.readback?.messageId === record.receipt.messageId);
        const deliveredAt = Date.parse(record.receipt.deliveredAt);
        assert.ok(deliveredAt >= started && deliveredAt <= Date.parse(readback.observedAt));
        notices.add(eventId);
      }
    }
    return run.notification;
  });
  return {
    slots: archive.calendar.slots,
    triggerEvidence: 'stable-launchd-calendar-registration-and-timed-run',
    notificationStatuses,
    receiptDigest: digest(receipt),
  };
}

export function assertDeferredMaintenanceGrant(directory, task, ledger, grantFile) {
  assert.equal(task.id, 'deferred-calendar-delivery-slot-release');
  assert.ok(
    path.isAbsolute(grantFile ?? '') && path.dirname(grantFile) === directory,
    'Exact private maintenance grant required',
  );
  const grant = readPrivate(grantFile);
  assert.equal(grant.version, 1);
  assert.equal(grant.task, task.id);
  assert.equal(grant.executor, taskExecutor(task));
  assert.equal(grant.head, task.recordedHead);
  assert.equal(grant.accepted, task.frozen?.accepted);
  assert.match(grant.base, /^[a-f0-9]{40}$/);
  const common = path.dirname(path.dirname(directory));
  const coordination = readTaskCoordination(common);
  const decision = ledger.dynamicDecisions?.find((item) => item.id === grant.preparation);
  assert.equal(decision?.status, 'finished', 'Finish the original preparation before maintenance handoff');
  assert.equal(decision.input.phase, 'preparation');
  assert.equal(decision.input.task, task.id);
  assert.equal(decision.input.owner, task.owner);
  assert.equal(decision.input.executor, grant.executor);
  assert.equal(decision.prepared.head, grant.head);
  assert.equal(decision.prepared.accepted, grant.accepted);
  assert.equal(decision.prepared.pullRequest, grant.pullRequest);
  assert.equal(decision.prepared.runId, grant.prRunId);
  assert.equal(decision.input.expectedCoordinationRevision, coordination?.revision);
  assert.equal(decision.coordinator, coordination.current.rootThreadId);
  assert.notEqual(decision.coordinator, grant.executor);
  const lastPause = ledger.events.findLast((e) => e.action === 'pause-all');
  const authority = ledger.dynamicAuthorities.find((entry) => entry.id === decision.input.authorityId);
  assert.ok(authority?.request.sequence > (lastPause?.request.sequence ?? 0), 'A newer pause fences maintenance');
  const approval = grant.review;
  assert.equal(approval?.provider, 'codex-native-read_thread');
  assert.equal(approval.threadId, decision.coordinator);
  assert.ok(approval.turnId && approval.message?.id && approval.message.phase === 'commentary');
  const approved =
    '维护发布批准 ' + [task.id, 'PR #' + grant.pullRequest, grant.head, grant.base, 'CI ' + grant.prRunId].join(' ');
  assert.equal(approval.message.text.trim(), approved, 'Exact independent maintenance approval required');
  assert.ok(Number.isFinite(Date.parse(approval.observedAt)) && Date.parse(approval.observedAt) <= Date.now());
  return grant;
}

const MAINTENANCE_FILES = new Set([
  'docs/task-completion.md',
  'docs/engineering/task-execution-order.md',
  'scripts/completion-cli.mjs',
  'scripts/completion-deferred.mjs',
  'scripts/completion-deferred.test.mjs',
  'scripts/completion-handoff.mjs',
  'scripts/completion-status.mjs',
  'scripts/task-completion-progress-cli.mjs',
  'scripts/task-context.mjs',
  'scripts/task-continuation-plan.mjs',
  'scripts/task-coordination-next.mjs',
  'scripts/task-delivery-queue.mjs',
  'scripts/task-delivery-queue.test.mjs',
  'scripts/task-delivery-status-sync.mjs',
  'scripts/task-execution-order.mjs',
  'scripts/test-domain-manifest.json',
]);

// The bootstrap only advances checkout refs and verifies existing runtime. Its
// retained task carrier is deliberate: unknown references still block cleanup.
export function verifySourceOnlyMaintenance(plan, task, base, owner, execute) {
  assert.equal(task.id, 'deferred-calendar-delivery-slot-release');
  assert.equal(owner.type, 'fixed-frontend', 'The preserved fixed preview must be verified');
  assert.ok(owner.preservedFixedPreview?.proofDigest, 'Missing fixed preview identity');
  assert.equal(execute(plan.anchor, 'git', ['rev-parse', plan.main + '^1']), base);
  const files = execute(plan.anchor, 'git', ['diff', '--no-renames', '--name-only', '-z', base, plan.main])
    .split('\0')
    .filter(Boolean);
  assert.ok(
    files.length > 0 && files.every((file) => MAINTENANCE_FILES.has(file) && !isRuntimeFile(file)),
    'Only the reviewed maintenance paths can use source-only handoff',
  );
  assert.equal(
    temporaryPreviewLeases(plan.common).some((lease) => lease.task === task.id),
    false,
    'Task owned preview requires its ordinary handoff',
  );
  assert.equal(
    existsSync(path.join(plan.common, 'task-environments', task.id)),
    false,
    'Task created its own runtime environment',
  );
  const project = taskProjectName({ root: task.worktree, branch: task.branch });
  assert.equal(
    execute(plan.anchor, 'docker', [
      'ps',
      '-a',
      '--filter',
      'label=com.docker.compose.project=' + project,
      '--format',
      '{{.ID}}',
    ]),
    '',
    'Task owned containers require their ordinary handoff',
  );
}
