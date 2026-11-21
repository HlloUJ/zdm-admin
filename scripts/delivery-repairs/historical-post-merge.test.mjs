import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acceptedGit, acceptedRef, freezeAcceptedSource } from '../accepted-source.mjs';
import { createResourceLeases } from '../resource-lease.mjs';
import { createTaskDeliveryQueue } from '../task-delivery-queue.mjs';
import {
  POST_MERGE_MAINTENANCE,
  assertOriginalPostMergeTurn,
  verifyMaintenanceCloseoutReadiness,
  verifyMaintenanceTree,
  verifyPostMergeMaintenance,
} from './historical-post-merge.mjs';

async function fixture(t) {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), 'historical-post-merge-'));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const anchor = path.join(sandbox, 'repo');
  mkdirSync(anchor);
  const common = path.join(anchor, '.git');
  const git = (...args) => acceptedGit(anchor, args);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const edit = (file, bytes) => {
    const absolute = path.join(anchor, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
  };
  const commit = () => {
    git('add', '.');
    git('commit', '-m', 'synthetic source');
    return git('rev-parse', 'HEAD');
  };
  edit('src/feature.js', '// original source');
  edit('scripts/accepted-source.mjs', '// original checker');
  commit();
  const original = { task: 'synthetic-original', pullRequest: 1, prRunId: '11', mainRunId: '12' };
  const originalBranch = 'codex/' + original.task;
  git('checkout', '-b', originalBranch);
  edit('src/feature.js', '// original delivered change');
  original.head = commit();
  const frozen = freezeAcceptedSource(anchor, { id: original.task, branch: originalBranch, worktree: anchor });
  git('checkout', 'main');
  git('merge', '--no-ff', originalBranch, '-m', 'original merge');
  original.main = git('rev-parse', 'HEAD');

  const maintenanceBranch = 'codex/' + POST_MERGE_MAINTENANCE;
  git('checkout', '-b', maintenanceBranch);
  edit('scripts/accepted-source.mjs', '// reviewed checker');
  edit('scripts/delivery-repairs/historical-post-merge.mjs', '// reviewed recovery');
  const prepared = {
    base: original.main,
    head: commit(),
    pullRequest: 2,
    prRunId: '21',
    executor: 'maintenance-executor',
    preparation: 'maintenance-preparation',
  };
  prepared.accepted = freezeAcceptedSource(anchor, {
    id: POST_MERGE_MAINTENANCE,
    branch: maintenanceBranch,
    worktree: anchor,
  }).commit;
  git('checkout', 'main');
  git('merge', '--no-ff', maintenanceBranch, '-m', 'maintenance merge');
  const main = git('rev-parse', 'HEAD');
  const origin = path.join(sandbox, 'origin.git');
  git('init', '--bare', origin);
  git('remote', 'add', 'origin', origin);
  git('push', 'origin', 'main');
  const tag = acceptedRef(POST_MERGE_MAINTENANCE);
  git('push', 'origin', prepared.accepted + ':' + tag);

  const task = {
    id: original.task,
    branch: originalBranch,
    stage: 'main-verified',
    owner: 'original-executor',
    recordedHead: original.head,
    frozen: { accepted: frozen.commit, tree: frozen.tree, businessDigest: frozen.businessDigest },
    main: { local: original.main, remote: original.main, runId: original.mainRunId },
  };
  const queue = createTaskDeliveryQueue(common);
  const leases = createResourceLeases(common);
  const enqueued = await queue.enqueue({
    task: task.id,
    owner: task.owner,
    accepted: frozen.commit,
    head: original.head,
  });
  const running = await queue.wait(enqueued);
  await queue.markMainMutation(running);
  await queue.finish(running, { success: false, error: new Error('first handoff failed') });
  const ticket = assertOriginalPostMergeTurn(queue, leases.inspect('main-delivery'), task, enqueued.id);

  const jobs = (id) =>
    ['Frontend quality', 'Backend quality'].map((name) => ({
      name,
      status: 'completed',
      conclusion: 'success',
      run_id: Number(id),
      run_attempt: 1,
    }));
  function ci(head, id, branch, eventName) {
    return {
      name: 'ci',
      key: head + ':' + id,
      status: 'success',
      result: { headSha: head, runId: id, attempt: 1, conclusion: 'success', branch, eventName, jobs: jobs(id) },
    };
  }
  const state = {
    batch: task.id,
    startedAt: 123,
    events: [
      ci(original.head, original.prRunId, originalBranch, 'pull_request'),
      ci(original.main, original.mainRunId, 'main', 'push'),
      { name: 'handoff', key: original.main + ':final', status: 'failure' },
    ],
  };
  const coordinator = 'reviewer';
  const grant = {
    version: 1,
    task: task.id,
    owner: task.owner,
    ticket: ticket.id,
    accepted: frozen.commit,
    maintenance: prepared,
    review: {
      provider: 'codex-native-read_thread',
      threadId: coordinator,
      observedAt: new Date().toISOString(),
      turnId: 'turn',
      message: {
        id: 'approval',
        phase: 'commentary',
        text: '维护发布批准 ' + [POST_MERGE_MAINTENANCE, 'PR #2', prepared.head, original.main, 'CI 21'].join(' '),
      },
    },
  };
  const writePrivate = (task, file, value) => {
    const directory = path.join(common, 'task-delivery', task);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(directory, file), JSON.stringify(value), { mode: 0o600 });
  };
  const writeGrant = (value) => writePrivate(task.id, 'post-merge-maintenance.json', value);
  writeGrant(grant);
  writePrivate(POST_MERGE_MAINTENANCE, 'completion-session.json', {
    batch: POST_MERGE_MAINTENANCE,
    preparedCandidates: [{ ...prepared, runId: prepared.prRunId }],
    events: [ci(prepared.head, prepared.prRunId, maintenanceBranch, 'pull_request')],
  });
  const ledger = {
    dynamicDecisions: [
      {
        id: prepared.preparation,
        status: 'finished',
        coordinator,
        input: {
          expectedCoordinationRevision: 1,
          phase: 'preparation',
          task: POST_MERGE_MAINTENANCE,
          executor: prepared.executor,
        },
        prepared: { ...prepared, runId: prepared.prRunId },
      },
    ],
  };
  const repository = 'fixture/project';
  const api = {
    'branches/main/protection': {
      enforce_admins: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_status_checks: {
        strict: true,
        contexts: ['Frontend quality', 'Backend quality', 'Accepted business snapshot'],
        checks: [{ context: 'Accepted business snapshot', app_id: 42 }],
      },
    },
    'actions/workflows/quality.yml': { path: '.github/workflows/quality.yml', state: 'active', id: 1 },
    ['commits/' + prepared.head + '/check-runs?per_page=100']: {
      total_count: 1,
      check_runs: [
        {
          name: 'Accepted business snapshot',
          app: { id: 42 },
          head_sha: prepared.head,
          status: 'completed',
          conclusion: 'success',
        },
      ],
    },
  };
  function addRun(head, id, branch, event) {
    const route = 'actions/runs/' + id;
    api[route] = {
      id: Number(id),
      head_sha: head,
      run_attempt: 1,
      event,
      head_branch: branch,
      status: 'completed',
      conclusion: 'success',
      path: '.github/workflows/quality.yml',
      workflow_id: 1,
      pull_requests: [],
    };
    api[route + '/jobs?filter=all&per_page=100'] = { total_count: 2, jobs: jobs(id) };
  }
  function addPr(number, branch, head, merge) {
    const ref = (name) => ({ repo: { full_name: repository }, ref: name });
    api['pulls/' + number] = {
      number,
      state: 'closed',
      merged: true,
      merge_commit_sha: merge,
      head: { ...ref(branch), sha: head },
      base: ref('main'),
    };
  }
  addPr(original.pullRequest, originalBranch, original.head, original.main);
  addPr(prepared.pullRequest, maintenanceBranch, prepared.head, main);
  addRun(original.head, original.prRunId, originalBranch, 'pull_request');
  addRun(original.main, original.mainRunId, 'main', 'push');
  addRun(prepared.head, prepared.prRunId, maintenanceBranch, 'pull_request');
  addRun(main, '22', 'main', 'push');
  const execute = (_root, command, args) => {
    if (command === 'git') return git(...args.filter((option) => option !== '--no-replace-objects'));
    assert.equal(command, 'gh');
    if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: repository });
    const route = args[1].replace('repos/' + repository + '/', '');
    assert.ok(Object.hasOwn(api, route), route);
    return JSON.stringify(api[route]);
  };
  const options = {
    anchor,
    common,
    task,
    ticket,
    state,
    main,
    mainRunId: '22',
    execute,
    coordination: { revision: 1, current: { rootThreadId: coordinator } },
    ledger,
  };
  const verify = (overrides = {}) => verifyPostMergeMaintenance({ ...options, ...overrides }, original);
  return {
    anchor,
    common,
    git,
    edit,
    commit,
    original,
    prepared,
    main,
    grant,
    writeGrant,
    verify,
    api,
    task,
    ticket,
    queue,
    leases,
    execute,
    state,
    writePrivate,
  };
}

test('post-merge recovery binds the original failure and both protected first-attempt deliveries', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.verify(), {
    main: f.main,
    originalMain: f.original.main,
    maintenance: { main: f.main, head: f.prepared.head, pullRequest: 2, prRunId: '21', mainRunId: '22' },
  });
  const originalPr = f.api['pulls/1'];
  originalPr.head.sha = f.prepared.head;
  assert.throws(() => f.verify(), /Expected values to be strictly equal/);
  originalPr.head.sha = f.original.head;
  const maintenanceCi = f.api['actions/runs/22'];
  maintenanceCi.run_attempt = 2;
  assert.throws(() => f.verify(), /2 !== 1/);
  maintenanceCi.run_attempt = 1;
  const source = f.api['commits/' + f.prepared.head + '/check-runs?per_page=100'].check_runs[0];
  source.app.id = 43;
  assert.throws(() => f.verify(), /source check is missing/);
  source.app.id = 42;
  f.writeGrant({ ...f.grant, ticket: 'another-ticket' });
  assert.throws(() => f.verify(), /different original ticket or freeze/);
  f.writeGrant({ ...f.grant, review: { ...f.grant.review, threadId: f.prepared.executor } });
  assert.throws(() => f.verify());
  f.writeGrant(f.grant);
  assert.throws(() => f.verify({ task: { ...f.task, recordedHead: f.prepared.head } }));
  assert.equal(f.verify().main, f.main);
});

test('maintenance rejects unrelated source, deletions and an intervening main', async (t) => {
  const f = await fixture(t);
  assert.equal(verifyMaintenanceTree(f.anchor, f.original.main, f.main, f.git).length, 2);
  f.edit('src/feature.js', '// unrelated change');
  assert.throws(
    () => verifyMaintenanceTree(f.anchor, f.original.main, f.commit(), f.git),
    /Unrelated main change: src\/feature.js/,
  );
  f.git('checkout', f.main, '--', 'src/feature.js');
  const intermediate = f.commit();
  assert.throws(
    () => verifyMaintenanceTree(f.anchor, f.original.main, intermediate, f.git),
    /immediately follow the original merge/,
  );
  f.git('rm', 'scripts/accepted-source.mjs');
  assert.throws(() => verifyMaintenanceTree(f.anchor, f.original.main, f.commit(), f.git), /Maintenance path removed/);
});

test('failed recovery keeps its FIFO turn and rejects a second active executor', async (t) => {
  const f = await fixture(t);
  const lease = () => f.leases.inspect('main-delivery');
  assert.throws(
    () => assertOriginalPostMergeTurn(f.queue, { ...lease(), token: 'wrong' }, f.task, f.ticket.id),
    /lease changed/,
  );
  const turn = await f.queue.wait(f.ticket, { waitForTurn: false });
  assertOriginalPostMergeTurn(f.queue, lease(), f.task, turn.id, { active: true });
  const other = await f.queue.enqueue({
    task: 'unrelated',
    owner: 'another-executor',
    accepted: '1'.repeat(40),
    head: '2'.repeat(40),
  });
  await assert.rejects(f.queue.wait(other, { waitForTurn: false }), /Main delivery is occupied/);
  await assert.rejects(f.queue.wait(turn, { waitForTurn: false }), /Previous delivery may still be running/);
  await f.queue.finish(turn, { success: false, error: new Error('health still unavailable') });
  const latest = assertOriginalPostMergeTurn(f.queue, lease(), f.task, turn.id);
  assert.equal(latest.status, 'blocked');
  assert.equal(latest.sequence, f.ticket.sequence);
  assert.equal(f.verify({ ticket: latest }).main, f.main);
  const finalTurn = await f.queue.wait(latest, { waitForTurn: false });
  const history = path.join(f.common, 'task-registry/delivery-queue.json');
  assert.ok(readFileSync(history, 'utf8').includes('health still unavailable'));
  await f.queue.finish(finalTurn, { success: true });
  assert.equal(f.queue.inspect().tickets[0].task, other.task);
  assert.equal(lease(), null);
});

test('187 uses only an independently matched publication after 590 settlement', async (t) => {
  const f = await fixture(t);
  const lineage = f.verify();
  const main = f.original.main;
  const original = { ...f.task, stage: 'closed', closedAt: new Date().toISOString() };
  const key = main + ':' + f.original.mainRunId;
  const receipt = {
    results: {
      handoff: { result: { lineage } },
      close: { result: { batch: f.original.task, main: original.main } },
    },
    remoteSnapshot: { main, lineage },
  };
  f.writePrivate(original.id, 'post-merge-maintenance-publication.json', {
    version: 1,
    ticket: f.ticket.id,
    ...lineage,
  });
  f.writePrivate(original.id, 'completion-receipt.json', receipt);
  f.writePrivate(original.id, 'completion-session.json', {
    ...f.state,
    closedAt: Date.now(),
    pauses: [],
    repairs: [],
    events: [
      ...f.state.events,
      ...['evidence', 'handoff', 'preserve', 'cleanup', 'close'].map((name) => ({
        name,
        key,
        status: 'success',
        startedAt: 123,
        finishedAt: 124,
      })),
    ],
  });
  const maintenanceState = JSON.parse(
    readFileSync(path.join(f.common, 'task-delivery', POST_MERGE_MAINTENANCE, 'completion-session.json')),
  );
  const input = {
    anchor: f.anchor,
    registry: { commonDir: f.common, readTask: () => original },
    batch: {
      id: POST_MERGE_MAINTENANCE,
      branch: 'codex/' + POST_MERGE_MAINTENANCE,
      frozen: { accepted: f.prepared.accepted },
    },
    head: f.prepared.head,
    pr: { number: f.prepared.pullRequest, mergeCommit: { oid: f.main } },
    state: maintenanceState,
    execute: f.execute,
  };
  assert.equal(verifyMaintenanceCloseoutReadiness(input, f.original), true);
  assert.equal(verifyMaintenanceCloseoutReadiness({ ...input, batch: f.task }, f.original), false);
  assert.throws(
    () =>
      verifyMaintenanceCloseoutReadiness(
        {
          ...input,
          registry: { ...input.registry, readTask: () => f.task },
        },
        f.original,
      ),
    /settlement must complete first/,
  );
  f.writePrivate(original.id, 'completion-receipt.json', {
    ...receipt,
    remoteSnapshot: { main, lineage: { ...lineage, main } },
  });
  assert.throws(() => verifyMaintenanceCloseoutReadiness(input, f.original));
});
