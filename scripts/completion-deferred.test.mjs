import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freezeAcceptedSource } from './accepted-source.mjs';
import { completionCommand } from './completion-cli.mjs';
import { calendarRequirements, verifySourceOnlyMaintenance } from './completion-deferred.mjs';
import { openCompletion, saveCompletion } from './completion-session.mjs';
import { coordinationOccupancy } from './task-coordination-next.mjs';
import { taskBatch } from './task-context.mjs';
import { createTaskDeliveryQueue } from './task-delivery-queue.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { finalHandoff } from './completion-handoff.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import { temporaryPreviewLeases } from './preview-consumers.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { SCOPE_DIGEST, SCOPE_ID } from './delivery-repairs/task-cleanup-exact-scope.mjs';

const MAINTENANCE = 'deferred-calendar-delivery-slot-release';
const PENDING = 'scheduled-manifest-cleanup',
  NEXT = 'next-ready';
const slots = ['2025-01-01T17:00:00.000Z', '2025-01-02T05:00:00.000Z'];
const at = Date.parse(slots[0]) - 60000;
const quality = [
  { name: 'Frontend quality', status: 'completed', conclusion: 'success' },
  { name: 'Backend quality', status: 'completed', conclusion: 'success' },
];
const source = (sequence) => ({ sequence, messageId: 'message-' + sequence, roomId: 'fixture', authorId: 'human' });
const json = (file, value) => writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'deferred-calendar-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const anchor = path.join(dir, 'main'),
    remote = path.join(dir, 'remote');
  mkdirSync(anchor);
  const git = (C, ...args) => execFileSync('git', ['-C', C, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(anchor, 'init', '-b', 'main');
  git(anchor, 'config', 'user.name', 'Fixture');
  git(anchor, 'config', 'user.email', 'fixture@example.invalid');
  git(anchor, 'init', '--bare', remote);
  git(anchor, 'remote', 'add', 'origin', remote);
  git(anchor, 'commit', '--allow-empty', '-m', 'base');
  git(anchor, 'push', '-u', 'origin', 'main');
  const registry = createTaskRegistry(anchor),
    common = registry.commonDir;
  const order = createExecutionOrder(common),
    queue = createTaskDeliveryQueue(common);
  order.initialize(source(1));
  order.direct({ action: 'resume-all', request: source(2) });
  order.direct({ action: 'set-limits', limits: { development: 3, delivery: 1 }, request: source(3) });
  const integration = path.join(dir, 'integration'),
    preview = path.join(dir, 'preview-current');
  for (const [p, branch] of [
    [integration, 'integration-current'],
    [preview, 'preview-current'],
  ])
    git(anchor, 'worktree', 'add', '-b', 'codex/' + branch, p);
  mkdirSync(path.join(common, 'preview-environment'));
  json(path.join(common, 'preview-environment/environment.json'), {
    version: 1,
    repository: common,
    profile: { status: 'ready' },
  });
  const mainRuns = new Map();
  let runtimeHead, taskHead;
  function makeTask(id, sequence, runId, file = id + '.mjs') {
    const owner = 'executor-' + sequence,
      worktree = path.join(dir, id);
    git(anchor, 'worktree', 'add', '-b', 'codex/' + id, worktree);
    registry.register({ id, owner, worktree, kind: 'infrastructure' });
    mkdirSync(path.dirname(path.join(worktree, file)), { recursive: true });
    writeFileSync(path.join(worktree, file), 'export default ' + sequence);
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-m', id);
    const head = git(worktree, 'rev-parse', 'HEAD');
    registry.revise(id, registry.readTask(id).revision, (record) => {
      record.recordedHead = head;
      record.development = { reviewed: true };
      record.checkpoints = [{ commit: head, verification: 'fixture' }];
    });
    const accepted = freezeAcceptedSource(worktree, taskBatch(registry.readTask(id), anchor));
    registry.revise(id, registry.readTask(id).revision, (record) => {
      record.frozen = { accepted: accepted.commit, tree: accepted.tree, businessDigest: accepted.businessDigest };
      record.stage = 'frozen';
    });
    git(worktree, 'push', '-u', 'origin', 'codex/' + id);
    order.enqueue({ task: id, owner, lane: 'delivery', request: source(sequence) });
    return {
      id,
      owner,
      head,
      accepted: accepted.commit,
      worktree,
      runId,
      directory: path.join(common, 'task-delivery', id),
    };
  }
  function finishMain(task, defer = false) {
    git(anchor, 'merge', '--no-ff', 'codex/' + task.id, '-m', 'protected PR ' + task.id);
    git(anchor, 'push', 'origin', 'main');
    task.main = git(anchor, 'rev-parse', 'HEAD');
    for (const cwd of [integration, preview]) git(cwd, 'merge', '--ff-only', task.main);
    runtimeHead = task.main;
    taskHead = task.head;
    const record = registry.readTask(task.id);
    registry.revise(task.id, record.revision, (current) => {
      current.stage = 'handoff-verified';
      current.main = { local: task.main, remote: task.main, runId: task.runId };
    });
    const state = openCompletion(task.directory, task.id, { now: at - 1000 });
    state.events.push(
      {
        id: randomUUID(),
        name: 'ci',
        key: task.main + ':' + task.runId,
        status: 'success',
        startedAt: at - 800,
        finishedAt: at - 500,
        result: {
          runId: task.runId,
          headSha: task.main,
          branch: 'main',
          eventName: 'push',
          attempt: 1,
          conclusion: 'success',
          jobs: quality,
        },
      },
      {
        id: randomUUID(),
        name: 'handoff',
        key: task.main + ':final',
        status: 'success',
        startedAt: at - 450,
        finishedAt: at - 100,
        result: { main: task.main },
      },
    );
    if (defer)
      state.deferredSettlement = {
        version: 1,
        status: 'pending',
        head: task.head,
        main: task.main,
        runId: task.runId,
        deferredAt: new Date(at).toISOString(),
      };
    saveCompletion(task.directory, state);
    mainRuns.set(task.runId, task.main);
    return state;
  }
  const cleanup = path.join(common, 'task-cleanup');
  mkdirSync(cleanup, { mode: 0o700 });
  // Isolate Git carrier deletion from this verification of the settlement stages.
  json(path.join(cleanup, 'policy.json'), { version: 1, ownershipV2: true, limit: 1, maxLogicalBytes: 1, budgetMs: 1 });
  const options = {
    execute(cwd, command, args) {
      if (command === 'git') return git(cwd, ...args);
      assert.equal(command, 'gh');
      if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'test/repository' });
      if (args[0] === 'run' && args[1] === 'download') return '';
      assert.equal(args[0], 'api');
      const endpoint = args[1];
      if (endpoint.endsWith('branches/main/protection'))
        return JSON.stringify({
          enforce_admins: { enabled: true },
          required_status_checks: { strict: true, contexts: quality.map((j) => j.name) },
        });
      if (endpoint.endsWith('workflows/quality.yml'))
        return JSON.stringify({
          state: 'active',
          path: '.github/workflows/quality.yml',
          id: 12,
        });
      return JSON.stringify({
        head_sha: mainRuns.get(endpoint.split('/').at(-1)),
        run_attempt: 1,
        conclusion: 'success',
        status: 'completed',
        path: '.github/workflows/quality.yml',
        event: 'push',
        head_branch: 'main',
      });
    },
    verifyEvidence: (_root, _e, ci) => ({ head: ci.headSha, runId: ci.runId }),
    previewControl: { check: async ({ main }) => assert.equal(main, runtimeHead) },
    runtimeSnapshot: () => ({
      integrationHead: runtimeHead,
      sourceIdentity: 'src',
      configurationIdentity: 'config',
      containerIdentity: 'container',
      worktreeClean: true,
    }),
    checkRuntime: async () => ({ runtimeHealthy: true, backupRetained: true }),
    runtimeProof: () => ({
      version: 1,
      status: 'passed',
      integrationHead: runtimeHead,
      taskHead,
      sourceIdentity: 'src',
      configurationIdentity: 'config',
      containerIdentity: 'container',
    }),
    runtimeReferences: async () => ({ owned: [], backendPorts: [] }),
  };
  const claim = (task) => {
    const ticket = order.claim({ task: task.id, owner: task.owner, lane: 'delivery' });
    return ticket.admission;
  };
  const previous = process.env.ZDM_EXECUTION_ADMISSION;
  t.after(() => {
    if (previous === undefined) delete process.env.ZDM_EXECUTION_ADMISSION;
    else process.env.ZDM_EXECUTION_ADMISSION = previous;
  });
  function command(task, args, more) {
    process.env.ZDM_EXECUTION_ADMISSION = task.admission;
    return completionCommand(task.worktree, args, { ...options, owner: task.owner, ...more });
  }
  function launchd(run, runs, observedAt, triggerId = 268435474) {
    const runtime = path.join(common, 'task-cleanup/runtime', run.sourceHead);
    return {
      observedAt: new Date(observedAt).toISOString(),
      bootSession: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      output: [
        'gui/501/com.zdm.admin.manifest-cleanup = {',
        '\tstate = not running',
        '\tdomain = gui/501 [100025]',
        '\targuments = {',
        '\t\t/usr/local/bin/node',
        '\t\t' + path.join(runtime, 'scripts/task-cleanup-scheduled-cli.mjs'),
        '\t\t' + runtime,
        '\t\t--exact-scope',
        '\t}',
        '\truns = ' + runs,
        '\tlast exit code = 0',
        '\tevent triggers = {',
        ...[
          [triggerId, 13],
          [268435473, 1],
        ].flatMap(([id, hour]) => [
          '\t\tcom.zdm.admin.manifest-cleanup.' + id + ' => {',
          '\t\t\tstream = com.apple.launchd.calendarinterval',
          '\t\t\tdescriptor = {',
          '\t\t\t\t"Minute" => 0',
          '\t\t\t\t"Hour" => ' + hour,
          '\t\t\t}',
          '\t\t}',
        ]),
        '\t}',
        '}',
      ].join('\n'),
    };
  }
  function calendarProof(task, mutate = () => {}) {
    const scope = {
      version: 1,
      id: SCOPE_ID,
      sourceTask: 'delivery-standard-optimization',
      manifestSetSha256: SCOPE_DIGEST,
    };
    const runs = slots.map((slot) => ({
      slot,
      sourceHead: task.main,
      status: 'completed',
      notification: 'idle',
      startedAt: slot,
      finishedAt: slot,
      lockToken: randomUUID(),
      cleanupScope: scope,
    }));
    const file = path.join(task.directory, 'calendar-verification.json');
    const receipt = {
      version: 1,
      task: task.id,
      executor: task.owner,
      main: task.main,
      observations: runs.map((run, index) => ({
        slot: run.slot,
        launchd: {
          before: launchd(run, index + 1, Date.parse(run.slot) - 10_000),
          after: launchd(run, index + 2, Date.parse(run.finishedAt) + 10_000),
        },
        nativeReadback: {
          provider: 'codex-native-read_thread',
          threadId: task.owner,
          turnId: randomUUID(),
          observedAt: new Date(Date.parse(run.finishedAt) + 20_000).toISOString(),
          message: {
            id: randomUUID(),
            phase: 'commentary',
            text: run.slot + ' ' + sha(run),
          },
        },
      })),
    };
    mutate(runs, receipt);
    json(path.join(cleanup, 'scheduler-state.json'), { version: 1, recent: runs });
    json(file, receipt);
    return file;
  }
  return {
    anchor,
    common,
    integration,
    preview,
    registry,
    git,
    order,
    queue,
    makeTask,
    finishMain,
    claim,
    command,
    calendarProof,
  };
}

test('an existing deferred owner yields both queues and settles on a successor with the original proof', async (t) => {
  const f = fixture(t),
    original = f.makeTask(PENDING, 5, '41');
  original.admission = f.claim(original);
  const held = await f.queue.wait(await f.queue.enqueue({ ...original, task: original.id }));
  await f.queue.markMainMutation(held);
  f.finishMain(original, true);
  const old = await f.queue.deferSettlement(held, {
    head: original.head,
    main: original.main,
    runId: original.runId,
    deferredAt: new Date(at).toISOString(),
  });
  const next = f.makeTask(NEXT, 6, '42');
  assert.throws(() => f.claim(next), /occupied/);
  const args = ['defer-release', original.id, original.main, original.runId, original.main, ...slots];
  const leases = createResourceLeases(f.common);
  const busy = leases.acquire('integration-5173', 'existing-writer');
  await assert.rejects(f.command(original, args), /owned or interrupted/);
  leases.release(busy);
  assert.equal(f.queue.inspect().tickets[0].deferred.release, undefined);
  assert.equal(coordinationOccupancy(f.order.read()).finalHeld, true);
  await assert.rejects(f.command(original, args, { owner: 'different' }), /exact current chat/);

  assert.equal((await f.command(original, args)).queueTicket, old.id);
  const revision = f.order.read().revision;
  assert.equal((await f.command(original, args)).queueTicket, old.id);
  assert.equal(f.order.read().revision, revision);
  assert.equal(coordinationOccupancy(f.order.read()).finalHeld, false);
  assert.equal((await f.command(original, ['status', original.id])).phase, 'external-acceptance-pending');
  assert.throws(
    () =>
      f.order.assertAdmission({
        task: original.id,
        lane: 'delivery',
        owner: original.owner,
        admission: original.admission,
      }),
    /not admitted/,
  );

  next.admission = f.claim(next);
  const turn = await f.queue.wait(await f.queue.enqueue({ ...next, task: next.id }), { waitForTurn: false });
  assert.equal(turn.task, next.id);
  const settle = ['settle', original.id, original.main, original.runId];
  await assert.rejects(f.command(original, settle), /calendar receipt required/);
  const calendar = f.calendarProof(original);
  await assert.rejects(f.command(original, settle, { externalAcceptanceFile: calendar }), /Main delivery is occupied/);
  await f.queue.markMainMutation(turn);
  f.finishMain(next);
  await f.queue.finish(turn, { success: true });
  f.order.complete(
    {
      task: next.id,
      owner: next.owner,
      lane: 'delivery',
      admission: next.admission,
      evidence: { task: next.id, main: next.main },
    },
    () => true,
  );

  const session = path.join(next.directory, 'completion-session.json');
  const previous = readFileSync(session);
  rmSync(session);
  await assert.rejects(f.command(original, settle, { externalAcceptanceFile: calendar }), /ENOENT/);
  writeFileSync(session, previous, { mode: 0o600 });
  f.calendarProof(original, (runs) => runs.pop());
  await assert.rejects(f.command(original, settle, { externalAcceptanceFile: calendar }), /Real calendar run missing/);
  assert.equal(f.queue.inspect().tickets[0].id, old.id);
  assert.equal(f.order.read().tickets[0].status, 'deferred');
  f.calendarProof(original, (runs, receipt) => {
    const run = runs[0];
    // The launch-on-load journal has the correct slot and its correct digest.
    run.startedAt = run.finishedAt = '2025-01-01T17:19:00.000Z';
    receipt.observations[0].nativeReadback.message.text = run.slot + ' ' + sha(run);
  });
  await assert.rejects(f.command(original, settle, { externalAcceptanceFile: calendar }), /intended calendar minute/);
  f.calendarProof(original, (_runs, receipt) => {
    // Reload in the exact minute with a new registration, matching timestamps and run count.
    const after = receipt.observations[0].launchd.after;
    after.output = after.output.replace('268435474', '268435480');
  });
  await assert.rejects(f.command(original, settle, { externalAcceptanceFile: calendar }), /registration changed/);
  f.calendarProof(original, (_runs, receipt) => {
    receipt.observations[0].launchd.events = [
      {
        timestamp: slots[0],
        eventMessage: 'manual kickstart gui/501/com.zdm.admin.manifest-cleanup',
      },
    ];
  });
  await assert.rejects(f.command(original, settle, { externalAcceptanceFile: calendar }), /manual intervention/);
  f.calendarProof(original);
  const result = await f.command(original, settle, { externalAcceptanceFile: calendar });
  assert.equal(result.deliveryStatus.formalDeliveryComplete, true);
  assert.equal(result.deliveryStatus.main, original.main);
  assert.equal(result.remoteSnapshot.currentMain, next.main);
  assert.deepEqual(result.remoteSnapshot.calendar.notificationStatuses, ['idle', 'idle']);
  assert.equal(result.remoteSnapshot.lineage.successors[0].runId, next.runId);
  assert.equal(f.registry.readTask(original.id).main.settledAtMain, next.main);
  assert.equal(f.order.read().tickets[0].status, 'completed');
  assert.deepEqual(f.queue.inspect().tickets, []);
  assert.equal((await f.command(original, settle)).alreadyClosed, true);
  assert.equal(existsSync(path.join(original.directory, 'deferred-handoff.json')), true);
});

test('calendar acceptance refuses off-schedule times and a skipped slot', () => {
  assert.throws(() => calendarRequirements(PENDING, [slots[0], '2025-01-02T04:00:00.000Z'], 'a'.repeat(40)), /Beijing/);
  assert.throws(
    () => calendarRequirements(PENDING, [slots[0], '2025-01-02T17:00:00.000Z'], 'a'.repeat(40)),
    /Consecutive/,
  );
});

test('reviewed maintenance advances only published Git with a foreign closed 5177 lease untouched', async (t) => {
  const f = fixture(t);
  const original = f.makeTask(PENDING, 5, '41');
  f.finishMain(original, true);
  f.git(f.integration, 'push', '-u', 'origin', 'codex/integration-current');
  const next = f.makeTask(MAINTENANCE, 6, '42', 'scripts/completion-deferred.mjs');
  f.git(f.anchor, 'merge', '--no-ff', 'codex/' + next.id, '-m', 'protected maintenance');
  f.git(f.anchor, 'push', 'origin', 'main');
  const main = f.git(f.anchor, 'rev-parse', 'HEAD');
  const stored = f.registry.readTask(next.id);
  const task = taskBatch(stored, f.anchor);
  const leases = createResourceLeases(f.common);
  const retained = leases.acquire('temporary-port-5177', 'preserved-unrelated-task');
  const ordinaryReferences = () =>
    taskRuntimeReferences(task, {
      backendPorts: () => [],
      readLeases: () => temporaryPreviewLeases(f.common),
      request: async () => ({ statusCode: 0, errorCode: 'ECONNREFUSED' }),
    });
  await assert.rejects(ordinaryReferences(), /unknown on leased port 5177/);

  const state = openCompletion(next.directory, next.id);
  state.events.push({
    id: randomUUID(),
    name: 'ci',
    key: main + ':42',
    status: 'success',
    result: { headSha: main, branch: 'main', eventName: 'push', attempt: 1, conclusion: 'success' },
  });
  const snapshot = () => ({
    integrationHead: f.git(f.integration, 'rev-parse', 'HEAD'),
    worktreeClean: true,
    sourceIdentity: 'identical-source',
    configurationIdentity: 'identical-config',
    containerIdentity: 'same-container',
  });
  let proof = { version: 1, status: 'passed', taskHead: original.head, ...snapshot() };
  const owner = { type: 'fixed-frontend', preservedFixedPreview: { proofDigest: 'same-fixed-preview' } };
  const execute = (root, command, args) => {
    if (command === 'git') return f.git(root, ...args);
    assert.equal(command, 'docker', 'Source-only handoff cannot call a launcher');
    assert.deepEqual(args.slice(0, 3), ['ps', '-a', '--filter']);
    return '';
  };
  const options = {
    common: f.common,
    state,
    execute,
    save: () => {},
    runtimeSnapshot: snapshot,
    runtimeProof: () => proof,
    writeRuntimeProof: (_integration, next) => (proof = next),
    checkRuntime: async () => ({ runtimeHealthy: true, backupRetained: true, profileFingerprint: 'same-profile' }),
    previewControl: {
      assertOwner: async () => owner,
      check: async () => ({ reused: true }),
      prepareHandoff: ordinaryReferences,
      ensure: () => assert.fail('No preview restart or switch in source-only mode'),
    },
  };
  await assert.rejects(finalHandoff(next.worktree, task, main, options), /unknown on leased port 5177/);
  assert.equal(f.git(f.integration, 'rev-parse', 'HEAD'), original.main);
  const verify = (plan, observedOwner) =>
    verifySourceOnlyMaintenance(plan, task, original.main, observedOwner, execute);
  const result = await finalHandoff(next.worktree, task, main, { ...options, sourceOnly: { verify } });
  assert.equal(result.sourceOnly, true);
  assert.equal(proof.integrationHead, main);
  assert.equal(proof.taskHead, next.head);
  assert.equal(proof.containerIdentity, 'same-container');
  assert.deepEqual(leases.inspect(retained.resource), retained);
  assert.equal(existsSync(next.worktree), true);
  assert.equal(f.git(f.preview, 'rev-parse', 'HEAD'), main);
});
