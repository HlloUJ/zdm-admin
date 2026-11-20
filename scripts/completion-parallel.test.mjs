import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { readActiveBatch } from './task-batch.mjs';
import {
  assertAcceptedSource,
  freezeAcceptedSource,
  prepareAcceptedComposition,
  publishAcceptance,
  readAcceptance,
} from './accepted-source.mjs';
import { readAcceptedComposition } from './accepted-source-composition.mjs';
import { applyTaskComposition } from './task-composition.mjs';
import { captureSource } from './verification-evidence.mjs';
import { runCompletionFlow } from './completion-flow.mjs';
import { createTaskDeliveryQueue } from './task-delivery-queue.mjs';
import { createExecutionOrder } from './task-execution-order.mjs';
import { completionStage, openCompletion, saveCompletion } from './completion-session.mjs';
import { frozenRestoreArgs } from './task-preview-service.mjs';
import { assertFrozenValidationStart } from './dev-task.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { finalHandoffPlan } from './completion-handoff.mjs';
import { completionCommand } from './completion-cli.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import {
  captureReviewedScriptInputs,
  engineeringDomainProof,
  ENGINEERING_EXTRA_INPUTS,
  SCRIPT_INPUT_MANIFEST,
} from './script-test-plan.mjs';
import {
  formatEngineeringManifest,
  preCiCompositionTree,
  storedPreCiReview,
} from './delivery-repairs/pre-ci-composition.mjs';

const productionGates = ['Frontend quality', 'Backend quality', 'Accepted business snapshot'];
function ciEvidence(runId, headSha, isMain, at) {
  return {
    runId,
    headSha,
    branch: isMain ? 'main' : 'codex/a',
    eventName: isMain ? 'push' : 'pull_request',
    gatesFinishedAt: new Date(at).toISOString(),
    attempt: 1,
    conclusion: 'success',
    jobs: productionGates.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
  };
}

function writeEngineeringManifest(root) {
  writeFileSync(path.join(root, SCRIPT_INPUT_MANIFEST), JSON.stringify(captureReviewedScriptInputs(root)));
}

function fixture(t, { manifestConflict = false, reviewedConflict = false } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'completion-parallel-'))),
    main = path.join(dir, 'main'),
    a = path.join(dir, 'a'),
    b = path.join(dir, 'b');
  mkdirSync(main);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'test@example.invalid');
  const remote = path.join(dir, 'origin.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  git(main, 'remote', 'add', 'origin', remote);
  writeFileSync(path.join(main, '.gitignore'), '.task-runtime/\n.task-verification/\n');
  writeFileSync(path.join(main, 'base.txt'), 'base');
  mkdirSync(path.join(main, 'scripts'));
  writeFileSync(path.join(main, 'scripts/check.mjs'), '// original verifier\n');
  if (manifestConflict) {
    for (const input of ENGINEERING_EXTRA_INPUTS) {
      mkdirSync(path.dirname(path.join(main, input)), { recursive: true });
      writeFileSync(path.join(main, input), '{}');
    }
    writeEngineeringManifest(main);
  }
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'base');
  git(main, 'push', '-u', 'origin', 'main');
  for (const [branch, worktree] of [
    ['a', a],
    ['b', b],
    ['integration-current', path.join(dir, 'integration')],
    ['preview-current', path.join(dir, 'preview')],
  ])
    git(main, 'worktree', 'add', '-b', 'codex/' + branch, worktree);
  const registry = createTaskRegistry(main);
  registry.register({ id: 'a', worktree: a, owner: 'chat-a' });
  registry.register({ id: 'b', worktree: b, owner: 'chat-b' });
  writeFileSync(path.join(a, 'feature-a.txt'), 'accepted A');
  if (manifestConflict) {
    writeFileSync(path.join(a, 'scripts/check.mjs'), '// task verifier');
    writeEngineeringManifest(a);
  }
  git(a, 'add', '.');
  git(a, 'commit', '-m', 'task A');
  const head = git(a, 'rev-parse', 'HEAD'),
    current = registry.readTask('a');
  registry.revise('a', current.revision, (record) => {
    record.recordedHead = head;
    record.checkpoints = [{ commit: head, verification: 'fixture' }];
    record.development = { reviewed: true, sourceDigest: captureSource(a).digest };
  });
  const accepted = freezeAcceptedSource(a, readActiveBatch(a));
  registry.revise('a', registry.readTask('a').revision, (record) => {
    record.frozen = { accepted: accepted.commit, tree: accepted.tree, businessDigest: accepted.businessDigest };
    record.stage = 'frozen';
  });
  writeFileSync(path.join(b, 'unfinished.txt'), 'unfinished B must survive');
  writeFileSync(path.join(main, 'published-b.txt'), 'independent published main change');
  if (manifestConflict) {
    writeFileSync(path.join(main, 'scripts/published.mjs'), '// main verifier');
    if (reviewedConflict) writeFileSync(path.join(main, 'scripts/check.mjs'), '// published verifier');
    writeEngineeringManifest(main);
  }
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'published independent change');
  git(main, 'push', 'origin', 'main');
  return { dir, main, a, b, git, registry, head, accepted, latest: git(main, 'rev-parse', 'HEAD') };
}

test('a separately bound real executor reopens frozen completion without replacing historical source or owner', async (t) => {
  const f = fixture(t),
    task = f.registry.readTask('a');
  const worker = '33333333-3333-4333-8333-333333333333',
    coordinator = '22222222-2222-4222-8222-222222222222';
  const originalEnv = process.env.CODEX_THREAD_ID;
  t.after(() => {
    if (originalEnv === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = originalEnv;
  });
  const request = { messageId: 'fixture-takeover', roomId: coordinator, authorId: 'human', sequence: 5 };
  const binding = {
    version: 1,
    revision: 1,
    taskId: task.id,
    historicalOwner: task.owner,
    previousExecutor: task.owner,
    executor: worker,
    coordinator,
    request,
    worktree: task.worktree,
    branch: task.branch,
    commonDir: task.repository.commonDir,
    monitoring: { worker, rootThreadId: coordinator, roomId: coordinator, authorizationRef: request.messageId },
    boundAt: new Date().toISOString(),
    quiescenceDigest: 'a'.repeat(64),
  };
  const originalAcceptance = readFileSync(path.join(f.registry.commonDir, 'task-delivery/a/accepted-source.json'));
  f.registry.bindExecution(task.id, task.revision, binding, () => true); // Isolated downstream contract fixture.
  process.env.CODEX_THREAD_ID = worker;
  await completionCommand(f.a, ['begin']);
  assert.deepEqual(
    readFileSync(path.join(f.registry.commonDir, 'task-delivery/a/accepted-source.json')),
    originalAcceptance,
  );
  const current = f.registry.readTask('a');
  assert.equal(current.owner, task.owner);
  assert.deepEqual(current.frozen, task.frozen);
  assert.deepEqual(current.monitoring, task.monitoring);
  process.env.CODEX_THREAD_ID = 'old-chat';
  await assert.rejects(completionCommand(f.a, ['begin'], { owner: worker }), /Real bound executor/);
});

test('an interrupted composition resumes only its proven merge and keeps original freeze and unfinished B', (t) => {
  const f = fixture(t),
    before = readAcceptance(f.a, 'a');
  const proof = prepareAcceptedComposition(f.a, 'a', f.latest);
  const result = applyTaskComposition(f.a, 'a', undefined, { recover: true });
  assert.notEqual(result.recordedHead, f.head);
  assert.equal(f.git(f.a, 'rev-parse', 'HEAD^{tree}'), proof.candidateTree);
  assert.deepEqual(readAcceptance(f.a, 'a'), before);
  assert.equal(readFileSync(path.join(f.a, 'feature-a.txt'), 'utf8'), 'accepted A');
  assert.equal(readFileSync(path.join(f.a, 'published-b.txt'), 'utf8'), 'independent published main change');
  assert.equal(readFileSync(path.join(f.b, 'unfinished.txt'), 'utf8'), 'unfinished B must survive');
  assert.equal(applyTaskComposition(f.a, 'a', undefined, { recover: true }).recordedHead, result.recordedHead);
});

test('an already merged task can release a technical follow-up through its original blocked delivery ticket', async (t) => {
  const f = fixture(t);
  const first = applyTaskComposition(f.a, 'a', f.latest).recordedHead;
  f.git(f.a, 'push', 'origin', 'codex/a');
  publishAcceptance(f.a, 'a');
  f.git(f.main, 'merge', '--no-ff', '--no-edit', 'codex/a');
  f.git(f.main, 'push', 'origin', 'main');
  const firstMain = f.git(f.main, 'rev-parse', 'HEAD');
  const queue = createTaskDeliveryQueue(f.registry.commonDir);
  const order = createExecutionOrder(f.registry.commonDir);
  const request = (sequence) => ({
    messageId: 'fixture-' + sequence,
    roomId: 'fixture-room',
    authorId: 'fixture-user',
    sequence,
  });
  const lane = { lane: 'delivery', task: 'a', owner: 'chat-a' };
  order.initialize(request(1));
  order.enqueue({ ...lane, request: request(2) });
  order.direct({ ...lane, action: 'resume-only', request: request(3) });
  const admission = { ...lane, admission: order.read().tickets[0].admission };
  const previousAdmission = process.env.ZDM_EXECUTION_ADMISSION;
  process.env.ZDM_EXECUTION_ADMISSION = admission.admission;
  t.after(() => {
    if (previousAdmission === undefined) delete process.env.ZDM_EXECUTION_ADMISSION;
    else process.env.ZDM_EXECUTION_ADMISSION = previousAdmission;
  });
  const original = await queue.enqueue({ task: 'a', owner: 'chat-a', accepted: f.accepted.commit, head: first });
  const originalTurn = await queue.wait(original);
  await queue.markMainMutation(originalTurn);
  await queue.finish(originalTurn, { success: false, error: Error('Original CI diagnosis remains unrecorded') });
  f.registry.revise('a', f.registry.readTask('a').revision, (record) => {
    record.stage = 'handoff-verified';
    record.main = { local: firstMain, remote: firstMain, runId: '100' };
  });

  // Prepare against the already delivered main under the original identity.
  applyTaskComposition(f.a, 'a', firstMain);
  writeFileSync(path.join(f.a, 'scripts/check.mjs'), '// fixture-only closeout verifier\n');
  f.git(f.a, 'add', 'scripts/check.mjs');
  f.git(f.a, 'commit', '-m', 'technical follow-up');
  const followUp = f.git(f.a, 'rev-parse', 'HEAD');
  assert.equal(assertAcceptedSource(f.a, 'a', followUp).accepted, f.accepted.commit);
  const stop = Error('fixture stops after published checkpoint adoption');
  await assert.rejects(
    completionCommand(f.a, ['deliver', 'a', followUp], {
      owner: 'chat-a',
      execute: (cwd, command, args) => {
        if (command === 'git') return f.git(cwd, ...args);
        assert.equal(command, 'gh');
        throw stop;
      },
    }),
    (error) => error === stop,
  );
  const task = f.registry.readTask('a');
  assert.equal(task.recordedHead, followUp);
  assert.equal(task.checkpoints.at(-1).commit, followUp);
  assert.equal(task.frozen.accepted, f.accepted.commit);
  assert.equal(queue.inspect().tickets[0].id, original.id);

  const sessionDirectory = path.join(f.registry.commonDir, 'task-delivery', 'a');
  const state = openCompletion(sessionDirectory, 'a');
  const oldPull = { number: 1, state: 'MERGED', headRefOid: first, mergeCommit: { oid: firstMain } };
  let pull;
  const actions = [];
  let publishedSettler = 'old';
  let secondMain;
  const historical = Date.now() - 60_000;
  const originalFailure = {
    id: 'original-failure',
    name: 'ci',
    key: f.head + ':98',
    status: 'failure',
    startedAt: historical,
    finishedAt: historical + 1000,
    failure: {
      ci: {
        runId: '98',
        headSha: f.head,
        attempt: 1,
        failedJob: { id: 9, name: 'Frontend E2E 1/2', completedAt: new Date(historical + 1000).toISOString() },
      },
    },
  };
  const originalPrCi = {
    id: 'first-pr-ci',
    name: 'ci',
    key: first + ':99',
    status: 'success',
    startedAt: historical + 1100,
    finishedAt: historical + 2000,
    result: ciEvidence('99', first, false, historical + 2000),
  };
  const originalMainCi = {
    id: 'first-main-ci',
    name: 'ci',
    key: firstMain + ':100',
    status: 'success',
    startedAt: historical + 2100,
    finishedAt: historical + 3000,
    result: ciEvidence('100', firstMain, true, historical + 3000),
  };
  state.events.push(originalFailure, originalPrCi, originalMainCi);
  const execute = (cwd, command, args) => {
    if (command === 'git') return f.git(cwd, ...args);
    if (command === process.execPath) {
      assert.ok(pull && pull.state === 'OPEN');
      assert.equal(queue.inspect().tickets[0].id, original.id);
      actions.push('readiness');
      return '';
    }
    assert.equal(command, 'gh');
    if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'fixture/repo' });
    if (args[0] === 'api')
      return JSON.stringify({
        enforce_admins: { enabled: true },
        required_status_checks: { strict: true, contexts: productionGates },
      });
    if (args[1] === 'list')
      return JSON.stringify([oldPull, ...(pull && (args.includes('all') || pull.state === 'MERGED') ? [pull] : [])]);
    if (args[1] === 'create') {
      assert.equal(pull, undefined);
      assert.equal(f.git(f.a, 'ls-remote', 'origin', 'refs/heads/codex/a').split('\t')[0], followUp);
      assert.equal(queue.inspect().tickets[0].status, 'blocked');
      pull = { number: 2, headRefOid: followUp, baseRefOid: firstMain, state: 'OPEN' };
      actions.push('new-pr');
      return 'fixture://pr/2';
    }
    if (args[1] === 'view') {
      assert.equal(args[2], '2');
      return JSON.stringify(pull);
    }
    assert.deepEqual(args.slice(0, 4), ['pr', 'merge', '2', '--merge']);
    assert.equal(args.at(-1), followUp);
    assert.ok(actions.includes('ci:pr'));
    assert.equal(queue.inspect().tickets[0].id, original.id);
    actions.push('merge');
    f.git(f.main, 'merge', '--no-ff', '--no-edit', 'codex/a');
    f.git(f.main, 'push', 'origin', 'main');
    secondMain = f.git(f.main, 'rev-parse', 'HEAD');
    pull = { ...pull, state: 'MERGED', mergeCommit: { oid: secondMain } };
    return '';
  };
  const dispatch = async (_cwd, args) => {
    if (args[0] === 'wait') {
      const isMain = args[1] === 'main';
      assert.equal(args[2], isMain ? secondMain : followUp);
      actions.push('ci:' + args[1]);
      const evidence = ciEvidence(isMain ? '102' : '101', args[2], isMain, Date.now());
      return (await completionStage(state, 'ci', args[2] + ':' + evidence.runId, async () => evidence)).result;
    }
    if (args[0] === 'final-handoff') {
      assert.equal(args[1], secondMain);
      assert.ok(actions.includes('ci:main'));
      actions.push('handoff');
      return (await completionStage(state, 'handoff', secondMain + ':final', async () => ({ main: secondMain })))
        .result;
    }
    assert.deepEqual(args, ['settle', 'a', secondMain, '102']);
    assert.equal(queue.inspect().tickets[0].id, original.id);
    assert.equal(f.git(f.main, 'rev-parse', 'HEAD'), secondMain);
    actions.push('settle:' + publishedSettler);
    if (publishedSettler === 'old') throw Error('Old loaded settlement requires the historical diagnosis');
    return { settled: true };
  };
  const run = () =>
    runCompletionFlow(f.a, readActiveBatch(f.a), followUp, {
      execute,
      state,
      save: () => {},
      dispatch,
      common: f.registry.commonDir,
      assertCurrentAdmission: () => assert.ok(order.assertAdmission(admission).active),
      checkRuntime: async () => ({ integrationHealthy: true, backupRetained: true }),
      inventoryAssets: () => [],
      candidateRuntime: async (_task, _head, action) => action({}),
      previewControl: { assertOwner: async () => {}, prepareComposition: async () => {} },
    });
  await assert.rejects(run(), /Old loaded settlement requires/);
  assert.deepEqual(actions, ['new-pr', 'ci:pr', 'readiness', 'merge', 'ci:main', 'handoff', 'settle:old']);
  assert.equal(queue.inspect().tickets[0].id, original.id);
  assert.equal(queue.inspect().tickets[0].status, 'blocked');
  assert.ok(state.events.some((event) => event.key === secondMain + ':102' && event.status === 'success'));

  saveCompletion(sessionDirectory, state);
  const evidenceDir = path.join(f.a, '.task-verification');
  mkdirSync(evidenceDir);
  const evidenceFile = path.join(evidenceDir, 'historical-diagnosis.json');
  const source = path.join(evidenceDir, 'original-diagnosis.log');
  const originalDiagnostic = 'Recorded test timeout with no known root cause';
  writeFileSync(source, originalDiagnostic);
  writeFileSync(
    evidenceFile,
    JSON.stringify({
      task: 'a',
      accepted: f.accepted.commit,
      failedCI: originalFailure.failure.ci,
      failureEventId: originalFailure.id,
      candidate: first,
      laterPRRun: '99',
      mainCI: {
        id: originalMainCi.id,
        head: firstMain,
        runId: '100',
        startedAt: originalMainCi.startedAt,
        finishedAt: originalMainCi.finishedAt,
      },
      rootCause: 'unproven',
      observedFailure: originalDiagnostic,
      historicalDiagnosisDurationMs: null,
      diagnosedCodeRepairOfOriginalFailure: false,
      diagnosticEvidence: [{ path: source, sha256: createHash('sha256').update(originalDiagnostic).digest('hex') }],
    }),
  );
  const diagnosis = await completionCommand(f.a, ['record-ci-diagnosis', '98', evidenceFile], {
    owner: 'chat-a',
    execute,
  });
  assert.equal(diagnosis.formalDeliveryComplete, false);
  assert.equal(diagnosis.diagnosis.settlement.head, secondMain);
  assert.equal(diagnosis.diagnosis.repairDurationMs, null);
  const subsequentPreflight = Error('fixture stops at exact remote settlement preflight');
  await assert.rejects(
    completionCommand(f.a, ['settle', 'a', secondMain, '102'], {
      owner: 'chat-a',
      execute: (cwd, command, args) => {
        if (command === 'git' && args[0] === 'fetch') throw subsequentPreflight;
        return execute(cwd, command, args);
      },
    }),
    (error) => error === subsequentPreflight,
  );
  assert.equal(queue.inspect().tickets[0].id, original.id);
  assert.deepEqual(
    openCompletion(sessionDirectory, 'a').events.find((event) => event.id === originalFailure.id),
    originalFailure,
  );
  publishedSettler = 'new';
  assert.deepEqual(await run(), { settled: true });
  assert.equal(actions.filter((item) => item === 'merge').length, 1);
  assert.equal(actions.at(-1), 'settle:new');
  assert.deepEqual(queue.inspect().tickets, []);
  assert.equal(order.assertAdmission(admission).ticket.admission, admission.admission);
  assert.equal(readAcceptance(f.a, 'a').commit, f.accepted.commit);
  assert.equal(oldPull.headRefOid, first);
});
test('explicit defer cannot reclassify already-started closeout or settle a missing task carrier', async (t) => {
  const f = fixture(t),
    base = {
      state: { events: [{ name: 'cleanup', status: 'failure' }] },
      deferSettle: true,
      execute: () => assert.fail('no delivery effects'),
    };
  await assert.rejects(runCompletionFlow(f.a, readActiveBatch(f.a), f.head, base), /cannot rewind/);
  await assert.rejects(
    runCompletionFlow(f.a, { ...readActiveBatch(f.a), worktree: path.join(f.dir, 'missing') }, f.head, {
      ...base,
      state: { events: [] },
    }),
    /already missing/,
  );
});

for (const mode of ['main already included', 'recorded merge', 'same-tree main advance'])
  test(`checkpointed technical repair supersedes only a settled composition intent: ${mode}`, (t) => {
    const f = fixture(t);
    if (mode !== 'recorded merge') applyTaskComposition(f.a, 'a', f.latest);
    let latest = f.latest;
    if (mode === 'same-tree main advance') {
      f.git(f.main, 'commit', '--allow-empty', '-m', 'published metadata advance');
      f.git(f.main, 'push', 'origin', 'main');
      latest = f.git(f.main, 'rev-parse', 'HEAD');
    }
    const proof = prepareAcceptedComposition(f.a, 'a', latest);
    if (mode !== 'main already included') applyTaskComposition(f.a, 'a', undefined, { recover: true });
    const pointer = path.join(f.registry.commonDir, 'task-delivery/a/composition.json');
    const originalPointer = readFileSync(pointer, 'utf8');
    const originalFreeze = readAcceptance(f.a, 'a');
    writeFileSync(path.join(f.a, 'scripts/check.mjs'), '// repaired progress transport\n');
    f.git(f.a, 'add', '.');
    f.git(f.a, 'commit', '-m', 'technical repair');
    const head = f.git(f.a, 'rev-parse', 'HEAD');
    f.registry.revise('a', f.registry.readTask('a').revision, (record) => {
      record.recordedHead = head;
      record.checkpoints.push({ commit: head, verification: 'technical repair' });
    });
    const registered = f.registry.readTask('a');
    assert.deepEqual(applyTaskComposition(f.a, 'a', undefined, { recover: true }), registered);
    assert.equal(readFileSync(pointer, 'utf8'), originalPointer, 'Recovery never edits the old immutable intent');
    assert.deepEqual(readAcceptance(f.a, 'a'), originalFreeze);
    assert.equal(readFileSync(path.join(f.b, 'unfinished.txt'), 'utf8'), 'unfinished B must survive');
    assert.equal(f.git(f.a, 'rev-parse', 'HEAD'), head);
    applyTaskComposition(f.a, 'a', latest);
    const next = readAcceptedComposition(f.a, 'a', f.accepted.commit);
    assert.equal(next.taskHead, head);
    assert.equal(next.candidateTree, f.git(f.a, 'rev-parse', 'HEAD^{tree}'));
    assert.equal(next.expectedTree, proof.expectedTree);
    assert.equal(
      readFileSync(
        path.join(f.registry.commonDir, 'task-delivery/a/compositions', JSON.parse(originalPointer).proof),
        'utf8',
      ).includes(proof.candidateTree),
      true,
    );
  });

for (const file of ['feature-a.txt', 'AGENTS.md', 'scripts/accepted-source-policy.mjs', 'scripts/new-helper.mjs'])
  test(`a checkpoint cannot turn changed protected or unreviewed source into a technical composition recovery: ${file}`, (t) => {
    const f = fixture(t);
    applyTaskComposition(f.a, 'a', f.latest);
    prepareAcceptedComposition(f.a, 'a', f.latest);
    writeFileSync(path.join(f.a, file), 'unauthorized change\n');
    f.git(f.a, 'add', '.');
    f.git(f.a, 'commit', '-m', 'must remain rejected');
    const head = f.git(f.a, 'rev-parse', 'HEAD');
    f.registry.revise('a', f.registry.readTask('a').revision, (record) => {
      record.recordedHead = head;
      record.checkpoints.push({ commit: head, verification: 'does not authorize source drift' });
    });
    const before = f.registry.readTask('a');
    assert.throws(() => applyTaskComposition(f.a, 'a', undefined, { recover: true }));
    assert.deepEqual(f.registry.readTask('a'), before);
    assert.equal(f.git(f.a, 'rev-parse', 'HEAD'), head);
    assert.equal(readAcceptance(f.a, 'a').commit, f.accepted.commit);
  });

test('uncheckpointed repairs and repairs made before the proven composition completed remain rejected', (t) => {
  for (const pendingMerge of [false, true]) {
    const f = fixture(t);
    if (!pendingMerge) applyTaskComposition(f.a, 'a', f.latest);
    prepareAcceptedComposition(f.a, 'a', f.latest);
    writeFileSync(path.join(f.a, 'scripts/check.mjs'), '// technical change\n');
    f.git(f.a, 'add', '.');
    f.git(f.a, 'commit', '-m', 'not eligible for recovery');
    const head = f.git(f.a, 'rev-parse', 'HEAD');
    if (pendingMerge)
      f.registry.revise('a', f.registry.readTask('a').revision, (record) => {
        record.recordedHead = head;
        record.checkpoints.push({ commit: head, verification: 'merge still pending' });
      });
    assert.throws(() => applyTaskComposition(f.a, 'a', undefined, { recover: true }));
    assert.equal(readAcceptance(f.a, 'a').commit, f.accepted.commit);
  }
});

test('protected rollback can restart the exact frozen A only inside its live preview and completion leases', (t) => {
  const f = fixture(t),
    leases = createResourceLeases(f.registry.commonDir);
  const completion = leases.acquire('task-delivery-a', 'chat-a'),
    preview = leases.acquire('preview-5175', 'a');
  const config = { taskRegistryProtocol: 2, launcherPath: path.join(f.main, 'scripts/dev-task.mjs') };
  const args = frozenRestoreArgs(config, f.a, []);
  assert.deepEqual(args, ['--mode', 'full', '--validation-candidate', f.head]);
  assert.doesNotThrow(() =>
    assertFrozenValidationStart(
      f.registry.readTask('a'),
      { port: 5176, mode: 'full', validationCandidate: f.head },
      { head: f.head, lease: completion, previewLease: preview, alive: () => true },
    ),
  );
  leases.release(preview);
  assert.throws(() => frozenRestoreArgs(config, f.a, []), /恢复归属或源码变化/);
  leases.release(completion);
});
test('v2 published integration rejects an unpublished combination before changing or stopping it', (t) => {
  const f = fixture(t),
    composed = applyTaskComposition(f.a, 'a', f.latest);
  f.git(f.a, 'push', '-u', 'origin', 'codex/a');
  f.git(f.main, 'merge', '--no-ff', '--no-edit', composed.recordedHead);
  f.git(f.main, 'push', 'origin', 'main');
  const main = f.git(f.main, 'rev-parse', 'HEAD'),
    integration = path.join(f.dir, 'integration');
  f.git(integration, 'push', '-u', 'origin', 'codex/integration-current');
  const execute = (cwd, command, args) => {
    assert.equal(command, 'git');
    return f.git(cwd, ...args);
  };
  assert.equal(finalHandoffPlan(f.a, readActiveBatch(f.a), main, { execute }).main, main);
  writeFileSync(path.join(integration, 'unpublished.txt'), 'must be retained');
  f.git(integration, 'add', '.');
  f.git(integration, 'commit', '-m', 'unpublished combination');
  f.git(integration, 'push', 'origin', 'codex/integration-current');
  assert.throws(
    () => finalHandoffPlan(f.a, readActiveBatch(f.a), main, { execute }),
    /Integration contains unpublished source/,
  );
  assert.equal(readFileSync(path.join(integration, 'unpublished.txt'), 'utf8'), 'must be retained');
});

for (const [failure, deferSettle, preparationOnly = false] of [
  [null, false],
  ['composed-ci', false],
  ['handoff', false],
  [null, true],
  ['main-ci', true],
  ['handoff', true],
  ['missing-handoff-proof', true],
  [null, false, true],
  ['reference-refresh', false],
])
  test(`parallel delivery controller preserves exact ordering and ownership: ${failure ?? 'success'} defer=${deferSettle}${preparationOnly ? ' preparation=true' : ''}`, async (t) => {
    const f = fixture(t),
      events = [],
      state = { events: [] },
      beforeB = f.registry.readTask('b');
    if (failure === 'reference-refresh') {
      const previous = process.env.ZDM_CLOSED_PREVIEW_REFERENCE;
      t.after(() => {
        if (previous === undefined) delete process.env.ZDM_CLOSED_PREVIEW_REFERENCE;
        else process.env.ZDM_CLOSED_PREVIEW_REFERENCE = previous;
      });
      process.env.ZDM_CLOSED_PREVIEW_REFERENCE = JSON.stringify({
        consumerWorktree: f.a,
        consumerCandidate: f.head,
        file: path.join(f.registry.commonDir, 'old-selection-not-used-after-source-changes.json'),
      });
    }
    let pullState = 'OPEN',
      prWaits = 0,
      handoffFailed = false;
    const queue = createTaskDeliveryQueue(f.registry.commonDir);
    const execute = (cwd, command, args) => {
      if (command === 'git') return f.git(cwd, ...args);
      if (command === process.execPath) {
        assert.notEqual(pullState, 'MERGED', 'Do not recreate dependencies or rerun readiness after merging');
        assert.equal(path.basename(args[0]), 'verify.mjs');
        assert.deepEqual(args.slice(1), ['--affected', '--browser', 'chrome']);
        events.push('readiness:' + f.git(f.a, 'rev-parse', 'HEAD'));
        return '';
      }
      assert.equal(command, 'gh');
      if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'fixture/repo' });
      if (args[0] === 'api')
        return JSON.stringify({
          enforce_admins: { enabled: true },
          required_status_checks: { strict: true, contexts: ['Frontend quality', 'Backend quality'] },
        });
      const pull = {
        number: 1,
        state: pullState,
        headRefOid: f.git(f.a, 'rev-parse', 'HEAD'),
        baseRefOid: f.git(f.main, 'rev-parse', 'origin/main'),
      };
      if (args[1] === 'list') return JSON.stringify([pull]);
      if (args[1] === 'view') return JSON.stringify(pull);
      assert.equal(args[1], 'merge');
      assert.equal(queue.inspect().tickets[0].mainMutationStarted, true);
      events.push('merge');
      f.git(f.main, 'merge', '--no-ff', '--no-edit', 'codex/a');
      f.git(f.main, 'push', 'origin', 'main');
      pullState = 'MERGED';
      return '';
    };
    const options = {
      execute,
      state,
      save: () => {},
      common: f.registry.commonDir,
      deferSettle,
      preparationOnly,
      inventoryAssets: () => [],
      candidateRuntime: async (_task, _head, action) => action({}),
      checkRuntime: async () => ({ integrationHealthy: true, backupRetained: true }),
      previewControl: {
        assertOwner: async () => {},
        prepareComposition: async () => {
          assert.equal(queue.inspect().tickets[0].status, 'running');
          assert.equal(f.git(f.a, 'rev-parse', 'HEAD'), f.head, 'Runtime stops before source merge');
          events.push('quiesce-a-preserve-b');
        },
      },
      dispatch: async (cwd, args) => {
        if (args[0] === 'wait') {
          events.push('wait:' + args[1]);
          if (args[1] === 'main' && failure === 'main-ci') throw Error('main CI failed');
          if (args[1] === 'pr') {
            prWaits++;
            assert.equal(queue.inspect().tickets.length, prWaits === 1 ? 0 : 1);
            if (failure === 'composed-ci' && prWaits === 2) throw Error('composed CI failed');
          }
          const result = (
            await completionStage(state, 'ci', args[2] + ':42', async () => ({
              runId: 42,
              headSha: args[2],
              eventName: args[1] === 'pr' ? 'pull_request' : 'push',
              branch: args[1] === 'pr' ? 'codex/a' : 'main',
              attempt: 1,
              conclusion: 'success',
              jobs: ['Frontend quality', 'Backend quality'].map((name) => ({
                name,
                status: 'completed',
                conclusion: 'success',
              })),
            }))
          ).result;
          // The public wait command returns a summary; the typed original CI
          // record remains in the session and must be used for preparation.
          return preparationOnly
            ? { runId: result.runId, headSha: result.headSha, conclusion: result.conclusion }
            : result;
        }
        if (args[0] === 'final-handoff') {
          assert.equal(f.registry.readTask('a').stage, 'main-verified');
          events.push('handoff');
          if (failure === 'handoff' && !handoffFailed) {
            handoffFailed = true;
            throw Error('handoff failed');
          }
          if (failure === 'missing-handoff-proof') return {};
          return (await completionStage(state, 'handoff', args[1] + ':final', async () => ({ main: args[1] }))).result;
        }
        assert.equal(args[0], 'settle');
        assert.equal(f.registry.readTask('a').stage, 'handoff-verified');
        events.push('settle');
        return { settled: true };
      },
    };
    const run = () => runCompletionFlow(f.a, readActiveBatch(f.a), f.head, options);
    if (failure)
      await assert.rejects(
        run(),
        new RegExp(
          failure === 'handoff'
            ? 'handoff failed'
            : failure === 'main-ci'
              ? 'main CI failed'
              : failure === 'missing-handoff-proof'
                ? 'Defer settlement requires'
                : failure === 'reference-refresh'
                  ? 'collect a new public reference-proof'
                  : 'composed CI failed',
        ),
      );
    else {
      const result = await run();
      if (preparationOnly) {
        assert.equal(result.status, 'prepared');
        assert.equal(result.formalDeliveryComplete, false);
        assert.equal(result.finalMainAdmissionRequired, true);
        assert.equal(result.head, f.head);
        assert.equal(result.accepted, f.accepted.commit);
        assert.equal(result.runId, '42');
        assert.equal(prWaits, 1);
        assert.deepEqual(queue.inspect().tickets, []);
        assert.deepEqual(f.registry.readTask('b'), beforeB);
        assert.equal(f.git(f.main, 'rev-parse', 'HEAD'), f.latest);
        assert.ok(!events.some((event) => ['merge', 'handoff', 'settle', 'quiesce-a-preserve-b'].includes(event)));
        assert.equal(createResourceLeases(f.registry.commonDir).inspect('main-delivery'), null);
        assert.equal(f.registry.readTask('a').frozen.accepted, f.accepted.commit);
        return;
      }
      if (deferSettle) {
        assert.equal(result.status, 'deferred');
        assert.equal(result.formalDeliveryComplete, false);
        assert.equal(result.criticalResourcesReleased, true);
        assert.equal(createResourceLeases(f.registry.commonDir).inspect('main-delivery'), null);
        assert.equal(createResourceLeases(f.registry.commonDir).inspect('main-sync'), null);
        const retained = queue.inspect().tickets[0];
        assert.equal(retained.status, 'waiting');
        assert.equal(retained.owner, 'chat-a');
        assert.equal(retained.accepted, f.accepted.commit);
        assert.equal(retained.deferred.main, result.main);
        assert.equal(f.registry.readTask('a').stage, 'handoff-verified');
        assert.ok(existsSync(f.a));
        assert.equal(state.closedAt, undefined);
      } else assert.equal(result.settled, true);
    }
    assert.deepEqual(f.registry.readTask('b'), beforeB);
    assert.equal(readFileSync(path.join(f.b, 'unfinished.txt'), 'utf8'), 'unfinished B must survive');
    assert.equal(f.registry.readTask('a').frozen.accepted, f.accepted.commit);
    if (failure === 'reference-refresh') {
      assert.equal(prWaits, 1, 'Reference refresh is required before a new composed candidate is published');
      assert.ok(!events.some((event) => ['merge', 'handoff', 'settle'].includes(event)));
      assert.notEqual(
        f.git(f.a, 'rev-parse', 'HEAD'),
        f.head,
        'Keep the proven composed candidate for explicit refresh',
      );
      assert.equal(f.git(f.main, 'rev-parse', 'HEAD'), f.latest);
      assert.equal(queue.inspect().tickets.length, 0);
      return;
    }
    assert.equal(prWaits, 2, 'A changed merged candidate always receives new exact PR checks');
    if (failure === 'composed-ci') {
      assert.ok(!events.includes('merge'));
      assert.equal(queue.inspect().tickets.length, 0);
    } else if (failure === 'handoff') {
      assert.ok(!events.includes('settle'));
      assert.equal(queue.inspect().tickets[0].status, 'blocked');
      const readinessCount = events.filter((e) => e.startsWith('readiness:')).length;
      const result = await run();
      assert.equal(deferSettle ? result.status : result.settled, deferSettle ? 'deferred' : true);
      assert.equal(queue.inspect().tickets.length, deferSettle ? 1 : 0);
      assert.equal(events.filter((e) => e.startsWith('readiness:')).length, readinessCount);
    } else if (failure === 'main-ci' || failure === 'missing-handoff-proof') {
      if (failure === 'main-ci') assert.ok(!events.includes('handoff'));
      assert.ok(!events.includes('settle'));
      assert.equal(state.deferredSettlement, undefined);
      assert.equal(queue.inspect().tickets[0].status, 'blocked');
    } else {
      assert.deepEqual(
        events.filter((e) => !e.startsWith('readiness:')),
        [
          'wait:pr',
          'quiesce-a-preserve-b',
          'wait:pr',
          'merge',
          'wait:main',
          'handoff',
          ...(deferSettle ? [] : ['settle']),
        ],
      );
      assert.equal(queue.inspect().tickets.length, deferSettle ? 1 : 0);
    }
  });

function reviewedFixture(f) {
  const directory = path.join(f.dir, 'review');
  f.git(f.main, 'worktree', 'add', '--detach', directory, f.head);
  assert.throws(() => f.git(directory, 'merge', '--no-ff', '--no-commit', f.latest));
  const file = 'scripts/check.mjs';
  writeFileSync(path.join(directory, file), '// task verifier\n// published verifier\n');
  writeFileSync(
    path.join(directory, SCRIPT_INPUT_MANIFEST),
    formatEngineeringManifest(captureReviewedScriptInputs(directory)),
  );
  f.git(directory, 'add', '.');
  f.git(directory, 'commit', '-m', 'Review both verifiers');
  const candidate = f.git(directory, 'rev-parse', 'HEAD');
  const base = f.git(f.a, 'merge-base', f.head, f.latest);
  const version = (commit) => ({ mode: '100644', object: f.git(f.a, 'rev-parse', commit + ':' + file) });
  return {
    version: 1,
    accepted: f.accepted.commit,
    taskHead: f.head,
    main: f.latest,
    candidate,
    files: [
      {
        file,
        inputs: { base: version(base), task: version(f.head), main: version(f.latest) },
        result: version(candidate),
        reason: 'Keep both sets of verifier behavior.',
      },
    ],
  };
}

for (const reviewedConflict of [false, true])
  test(`preparation restores a persisted pre-CI composition and updates the original PR (reviewed=${reviewedConflict})`, async (t) => {
    const f = fixture(t, { manifestConflict: true, reviewedConflict });
    const review = reviewedConflict ? reviewedFixture(f) : undefined;
    const reviewDirectory = path.join(f.a, '.task-verification');
    if (review) {
      mkdirSync(reviewDirectory);
      writeFileSync(path.join(reviewDirectory, 'engineering-review.json'), JSON.stringify(review));
    }
    const frozen = readAcceptance(f.a, 'a');
    const beforeB = f.registry.readTask('b');
    f.git(f.a, 'push', 'origin', 'codex/a');
    publishAcceptance(f.a, 'a');
    const state = { events: [] };
    const failure = await completionStage(state, 'ci', f.head + ':original', async () => {
      throw Error('Original accepted-source CI failed');
    }).catch((error) => {
      assert.match(error.message, /Original accepted-source CI failed/);
      return structuredClone(state.events.at(-1));
    });
    let interrupted = false,
      quiesced = 0,
      candidate;
    const options = {
      preparationOnly: true,
      engineeringReviewFile: review ? path.join(reviewDirectory, 'engineering-review.json') : undefined,
      common: f.registry.commonDir,
      state,
      save: () => {},
      inventoryAssets: () => [],
      checkRuntime: async () => ({ integrationHealthy: true, backupRetained: true }),
      runtimeReferences: async (task, { referenceEffect }) => {
        assert.equal(referenceEffect, 'preparation');
        assert.equal(task.worktree, f.a);
      },
      previewControl: {
        assertOwner: async () => {},
        prepareComposition: async (plan, { referenceEffect }) => {
          assert.equal(referenceEffect, 'preparation');
          quiesced++;
          assert.equal(plan.main, f.latest);
          assert.equal(f.git(f.a, 'rev-parse', 'HEAD'), f.head);
        },
      },
      execute(cwd, tool, args) {
        if (tool === 'git') {
          if (args[0] === 'merge' && args[1] === '--ff-only' && !interrupted) {
            interrupted = true;
            throw Error('Interrupted after durable composition proof');
          }
          return f.git(cwd, ...args);
        }
        assert.equal(tool, 'gh');
        if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'fixture/repo' });
        if (args[0] === 'api')
          return JSON.stringify({
            enforce_admins: { enabled: true },
            required_status_checks: { strict: true, contexts: ['Frontend quality', 'Backend quality'] },
          });
        assert.deepEqual(args.slice(0, 2), ['pr', 'list'], 'Reuse the existing PR');
        return JSON.stringify([{ number: 149, state: 'OPEN', headRefOid: candidate }]);
      },
      async dispatch(_cwd, args) {
        assert.deepEqual(args, ['wait', 'pr', candidate]);
        assert.deepEqual(createTaskDeliveryQueue(f.registry.commonDir).inspect().tickets, []);
        return (
          await completionStage(state, 'ci', candidate + ':42', async () =>
            ciEvidence('42', candidate, false, Date.now()),
          )
        ).result;
      },
    };
    const run = () => runCompletionFlow(f.a, readActiveBatch(f.a), f.head, options);
    await assert.rejects(run(), /Interrupted after durable composition proof/);
    const proof = readAcceptedComposition(f.a, 'a', f.accepted.commit);
    assert.equal(proof.taskHead, f.head);
    assert.equal(proof.main, f.latest);
    assert.deepEqual(storedPreCiReview(f.a, proof), review);
    assert.equal(f.git(f.a, 'rev-parse', 'HEAD'), f.head);
    assert.equal(f.git(f.a, 'ls-remote', 'origin', 'refs/heads/codex/a').split('\t')[0], f.head);
    const originalExecute = options.execute;
    options.execute = (cwd, tool, args) => {
      if (tool === 'gh' && args[1] === 'list') candidate = f.git(f.a, 'rev-parse', 'HEAD');
      return originalExecute(cwd, tool, args);
    };
    const result = await run();
    assert.equal(result.pullRequest, 149);
    assert.equal(result.runId, '42');
    assert.equal(result.head, candidate);
    assert.equal(quiesced, 1);
    assert.deepEqual(f.git(f.a, 'show', '-s', '--format=%P', candidate).split(' '), [f.head, f.latest]);
    assert.equal(f.git(f.a, 'rev-parse', 'HEAD^{tree}'), proof.candidateTree);
    assert.equal(
      f.git(f.a, 'show', 'HEAD:scripts/check.mjs'),
      review ? '// task verifier\n// published verifier' : '// task verifier',
    );
    if (review) assert.equal(candidate, review.candidate);
    assert.equal(f.git(f.a, 'show', 'HEAD:scripts/published.mjs'), '// main verifier');
    assert.equal(engineeringDomainProof(f.a).proven, true);
    assert.deepEqual(readAcceptance(f.a, 'a'), frozen);
    assert.deepEqual(readAcceptedComposition(f.a, 'a', frozen.commit), proof);
    assert.deepEqual(
      state.events.find((event) => event.id === failure.id),
      failure,
    );
    assert.equal(f.registry.readTask('a').recordedHead, candidate);
    assert.deepEqual(f.registry.readTask('b'), beforeB);
  });

test('public prepare refuses an unknown 5177 reference before writing the original composition', async (t) => {
  const f = fixture(t, { manifestConflict: true, reviewedConflict: true });
  const reviewFile = path.join(f.a, '.task-verification/engineering-review.json');
  mkdirSync(path.dirname(reviewFile));
  writeFileSync(reviewFile, JSON.stringify(reviewedFixture(f)));
  const options = {
    owner: 'chat-a',
    checkRuntime: async () => ({ integrationHealthy: true, backupRetained: true }),
    previewControl: {
      assertOwner: async () => {},
      prepareComposition: async (plan, { referenceEffect }) => {
        assert.equal(referenceEffect, 'preparation');
        assert.equal(plan.task, f.a);
        await taskRuntimeReferences(f.registry.readTask('a'), {
          referenceEffect,
          backendPorts: () => [],
          readLeases: () => [{ task: 'b', port: 5177 }],
          request: async () => ({ statusCode: 0, errorCode: 'ECONNREFUSED' }),
        });
      },
    },
    execute(cwd, tool, args) {
      if (tool === 'git') return f.git(cwd, ...args);
      assert.equal(tool, 'gh');
      if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'fixture/repo' });
      assert.equal(args[0], 'api', 'Unknown reference must block before any PR update');
      return JSON.stringify({
        enforce_admins: { enabled: true },
        required_status_checks: { strict: true, contexts: ['Frontend quality', 'Backend quality'] },
      });
    },
  };
  const base = ['prepare', 'a', f.head],
    proof = ['--reference-proof', path.join(f.dir, 'missing-proof.json')],
    review = ['--engineering-review', reviewFile];
  for (const flags of [proof, [...proof, ...review], [...review, ...proof]])
    await assert.rejects(completionCommand(f.a, [...base, ...flags], options), /ENOENT/);
  await assert.rejects(completionCommand(f.a, [...base, ...review], options), /unknown on leased port 5177/);
  assert.equal(readAcceptedComposition(f.a, 'a', f.accepted.commit), null);
  assert.equal(f.git(f.a, 'rev-parse', 'HEAD'), f.head);
  assert.equal(f.registry.readTask('a').recordedHead, f.head);
});

test('manifest composition refuses an explicitly protected manifest or an unreviewed input', (t) => {
  const f = fixture(t, { manifestConflict: true });
  assert.throws(
    () => preCiCompositionTree(f.a, { taskHead: f.head, main: f.latest, protectedPaths: [SCRIPT_INPUT_MANIFEST] }),
    /Frozen engineering manifest cannot be replaced/,
  );
  writeFileSync(path.join(f.main, 'scripts/published.mjs'), '// stale engineering input');
  f.git(f.main, 'commit', '-am', 'unreviewed main input');
  const main = f.git(f.main, 'rev-parse', 'HEAD');
  assert.throws(
    () => preCiCompositionTree(f.a, { taskHead: f.head, main, protectedPaths: [] }),
    /Parent engineering manifest is not current/,
  );
});

test('pre-CI engineering review rejects uncovered conflicts, altered inputs and protected output', (t) => {
  const f = fixture(t, { manifestConflict: true, reviewedConflict: true });
  const review = reviewedFixture(f);
  const inputs = { accepted: f.accepted.commit, taskHead: f.head, main: f.latest, protectedPaths: [] };
  assert.equal(preCiCompositionTree(f.a, inputs), null);
  assert.throws(() => preCiCompositionTree(f.a, inputs, { ...review, files: [] }), /cover exactly/);
  const different = structuredClone(review);
  different.files[0].inputs.main.object = f.head;
  assert.throws(() => preCiCompositionTree(f.a, inputs, different), /inputs drifted/);
  assert.throws(
    () => preCiCompositionTree(f.a, { ...inputs, protectedPaths: ['scripts/check.mjs'] }, review),
    /Frozen conflict cannot use engineering review/,
  );
  const unrelated = path.join(f.dir, 'review');
  writeFileSync(path.join(unrelated, 'feature-a.txt'), 'changed business');
  f.git(unrelated, 'add', '.');
  f.git(unrelated, 'commit', '--amend', '--no-edit');
  assert.throws(
    () => preCiCompositionTree(f.a, inputs, { ...review, candidate: f.git(unrelated, 'rev-parse', 'HEAD') }),
    /alters paths beyond/,
  );
});
