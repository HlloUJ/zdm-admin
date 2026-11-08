import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { readActiveBatch } from './task-batch.mjs';
import { freezeAcceptedSource, prepareAcceptedComposition, readAcceptance } from './accepted-source.mjs';
import { readAcceptedComposition } from './accepted-source-composition.mjs';
import { applyTaskComposition } from './task-composition.mjs';
import { captureSource } from './verification-evidence.mjs';
import { runCompletionFlow } from './completion-flow.mjs';
import { createTaskDeliveryQueue } from './task-delivery-queue.mjs';
import { completionStage } from './completion-session.mjs';
import { frozenRestoreArgs } from './task-preview-service.mjs';
import { assertFrozenValidationStart } from './dev-task.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { finalHandoffPlan } from './completion-handoff.mjs';

function fixture(t) {
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
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'published independent change');
  git(main, 'push', 'origin', 'main');
  return { dir, main, a, b, git, registry, head, accepted, latest: git(main, 'rev-parse', 'HEAD') };
}

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

for (const failure of [null, 'composed-ci', 'handoff'])
  test(`parallel delivery controller preserves exact ordering and ownership: ${failure ?? 'success'}`, async (t) => {
    const f = fixture(t),
      events = [],
      state = { events: [] },
      beforeB = f.registry.readTask('b');
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
          if (args[1] === 'pr') {
            prWaits++;
            assert.equal(queue.inspect().tickets.length, prWaits === 1 ? 0 : 1);
            if (failure === 'composed-ci' && prWaits === 2) throw Error('composed CI failed');
          }
          return (
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
        }
        if (args[0] === 'final-handoff') {
          assert.equal(f.registry.readTask('a').stage, 'main-verified');
          events.push('handoff');
          if (failure === 'handoff' && !handoffFailed) {
            handoffFailed = true;
            throw Error('handoff failed');
          }
          return {};
        }
        assert.equal(args[0], 'settle');
        assert.equal(f.registry.readTask('a').stage, 'handoff-verified');
        events.push('settle');
        return { settled: true };
      },
    };
    const run = () => runCompletionFlow(f.a, readActiveBatch(f.a), f.head, options);
    if (failure)
      await assert.rejects(run(), new RegExp(failure === 'handoff' ? 'handoff failed' : 'composed CI failed'));
    else assert.equal((await run()).settled, true);
    assert.deepEqual(f.registry.readTask('b'), beforeB);
    assert.equal(readFileSync(path.join(f.b, 'unfinished.txt'), 'utf8'), 'unfinished B must survive');
    assert.equal(f.registry.readTask('a').frozen.accepted, f.accepted.commit);
    assert.equal(prWaits, 2, 'A changed merged candidate always receives new exact PR checks');
    if (failure === 'composed-ci') {
      assert.ok(!events.includes('merge'));
      assert.equal(queue.inspect().tickets.length, 0);
    } else if (failure === 'handoff') {
      assert.ok(!events.includes('settle'));
      assert.equal(queue.inspect().tickets[0].status, 'blocked');
      const readinessCount = events.filter((e) => e.startsWith('readiness:')).length;
      assert.equal((await run()).settled, true);
      assert.equal(queue.inspect().tickets.length, 0);
      assert.equal(events.filter((e) => e.startsWith('readiness:')).length, readinessCount);
    } else {
      assert.deepEqual(
        events.filter((e) => !e.startsWith('readiness:')),
        ['wait:pr', 'quiesce-a-preserve-b', 'wait:pr', 'merge', 'wait:main', 'handoff', 'settle'],
      );
      assert.equal(queue.inspect().tickets.length, 0);
    }
  });
