import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { selectedTaskBatch, withTaskContext } from './task-context.mjs';
import { readActiveBatch, planBatchDelivery } from './task-batch.mjs';
import { completionCommand } from './completion-cli.mjs';
import { readAcceptance, assertAcceptedSource } from './accepted-source.mjs';
import { checkAcceptedIndex } from './accepted-source-hook.mjs';
function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'task-context-'))),
    main = path.join(dir, 'main');
  mkdirSync(main);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const execute = (cwd, command, args) => {
    assert.equal(command, 'git');
    return execFileSync(command, ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  };
  const git = (root, ...args) => execute(root, 'git', args);
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'test@example.invalid');
  mkdirSync(path.join(main, 'src'));
  mkdirSync(path.join(main, 'scripts'));
  writeFileSync(path.join(main, '.gitignore'), '.task-runtime/\n.task-verification/\n');
  writeFileSync(path.join(main, 'src/feature.js'), 'base business');
  writeFileSync(path.join(main, 'scripts/repair.mjs'), '// technical');
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'base');
  git(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const a = path.join(dir, 'a'),
    b = path.join(dir, 'b');
  git(main, 'worktree', 'add', '-b', 'codex/a', a);
  git(main, 'worktree', 'add', '-b', 'codex/b', b);
  const registry = createTaskRegistry(main);
  registry.register({ id: 'a', worktree: a, owner: 'chat-a' });
  registry.register({ id: 'b', worktree: b, owner: 'chat-b' });
  writeFileSync(path.join(a, 'src/feature.js'), 'reviewed task A');
  git(a, 'add', '.');
  git(a, 'commit', '-m', 'task A');
  const current = registry.readTask('a'),
    commit = git(a, 'rev-parse', 'HEAD');
  registry.revise('a', current.revision, (record) => {
    record.recordedHead = commit;
    record.checkpoints = [
      { commit, verification: 'Fixture completed development', recordedAt: new Date().toISOString() },
    ];
  });
  writeFileSync(path.join(b, 'src/feature.js'), 'unfinished B');
  return { a, b, main, registry, execute, git };
}
test('context comes from exact worktree and never from another task or one global active choice', (t) => {
  const f = fixture(t);
  assert.equal(readActiveBatch(f.a).id, 'a');
  assert.equal(readActiveBatch(f.b).id, 'b');
  assert.equal(readActiveBatch(f.main), null);
  const plan = planBatchDelivery(f.a);
  assert.equal(plan.batchId, 'a');
  assert.equal(plan.modules.length, 1);
  assert.equal(f.registry.readTask('b').stage, 'developing');
});
test('delivery waits for a real declared dependency while an unrelated unfinished task is not a condition', (t) => {
  const f = fixture(t),
    task = f.registry.readTask('a');
  assert.equal(planBatchDelivery(f.a).batchId, 'a');
  f.registry.revise('a', task.revision, (record) => {
    record.dependsOn = ['b'];
  });
  assert.throws(() => planBatchDelivery(f.a), /dependency is not formally delivered: b/);
  assert.equal(f.registry.readTask('b').stage, 'developing');
  assert.equal(readFileSync(path.join(f.b, 'src/feature.js'), 'utf8'), 'unfinished B');
  const dependency = f.registry.readTask('b');
  f.registry.revise('b', dependency.revision, (record) => {
    record.stage = 'closed';
    record.closedAt = new Date().toISOString();
    record.main = { local: f.git(f.main, 'rev-parse', 'origin/main') };
  });
  assert.throws(() => planBatchDelivery(f.a), /no complete formal receipt/);
});
test('two asynchronous completion contexts retain separate task identities across await', async (t) => {
  const f = fixture(t),
    commonDir = f.registry.commonDir;
  const results = await Promise.all(
    ['a', 'b'].map((id) =>
      withTaskContext({ id, commonDir, owner: 'chat-' + id }, async () => {
        await Promise.resolve();
        return selectedTaskBatch(f.main).id;
      }),
    ),
  );
  assert.deepEqual(results, ['a', 'b']);
  assert.equal(selectedTaskBatch(f.main), null);
});
test('explicit acceptance preserves an incomplete business state without inventing readiness or waiving formal gates', async (t) => {
  const f = fixture(t),
    current = f.registry.readTask('a');
  f.registry.revise('a', current.revision, (record) => {
    record.development = { reviewed: false };
  });
  assert.equal(planBatchDelivery(f.a).verificationProven, false);
  await completionCommand(f.a, ['freeze'], { owner: 'chat-a', execute: f.execute });
  const plan = planBatchDelivery(f.a);
  assert.equal(Object.hasOwn(plan, 'businessDevelopmentReviewed'), false);
  assert.equal(plan.originalDevelopmentStateRetained, true);
  assert.equal(plan.modules[0].status, 'in-progress');
  assert.equal(plan.verificationProven, false);
  assert.deepEqual(plan.requiredExternalChecks, [
    'Exact candidate and main CI',
    'Serialized authorized main merge',
    'Owned runtime handoff and safe current-task cleanup',
  ]);
  assert.equal(f.registry.readTask('b').stage, 'developing');
});
test('freezing A preserves B and its index while wrong chat cannot freeze B', async (t) => {
  const f = fixture(t),
    before = f.registry.readTask('b'),
    index = f.git(f.b, 'write-tree');
  await completionCommand(f.a, ['freeze'], { owner: 'chat-a', execute: f.execute });
  assert.ok(readAcceptance(f.a, 'a'));
  assert.equal(f.registry.readTask('a').stage, 'frozen');
  assert.equal(
    Object.hasOwn(readActiveBatch(f.a), 'developmentReview'),
    false,
    'Do not change historical archive shape with a transient readiness status',
  );
  assert.equal(readAcceptance(f.b, 'b'), null);
  assert.deepEqual(f.registry.readTask('b'), before);
  assert.equal(f.git(f.b, 'write-tree'), index);
  assert.equal(readFileSync(path.join(f.b, 'src/feature.js'), 'utf8'), 'unfinished B');
  await assert.rejects(
    completionCommand(f.b, ['freeze'], { owner: 'chat-a', execute: f.execute }),
    /exact current chat/,
  );
  assert.equal(existsSync(path.join(f.registry.commonDir, 'task-delivery/b/accepted-source.json')), false);
});
test('a completion request freezes actual unfinished source before its real clean-candidate block', async (t) => {
  const f = fixture(t),
    head = f.git(f.b, 'rev-parse', 'HEAD');
  await assert.rejects(
    completionCommand(f.b, ['deliver', 'b', head], { owner: 'chat-b', execute: f.execute }),
    /clean owned task/,
  );
  assert.ok(readAcceptance(f.b, 'b'));
  assert.equal(f.registry.readTask('b').stage, 'frozen');
  assert.equal(f.registry.readTask('b').development, undefined);
  assert.equal(f.git(f.b, 'rev-parse', 'HEAD'), head);
  assert.equal(readFileSync(path.join(f.b, 'src/feature.js'), 'utf8'), 'unfinished B');
  assert.equal(readAcceptance(f.a, 'a'), null);
});
test('frozen task keeps its original baseline and commit hooks still reject business edits', async (t) => {
  const f = fixture(t);
  await completionCommand(f.a, ['freeze'], { owner: 'chat-a', execute: f.execute });
  const original = readAcceptance(f.a, 'a'),
    current = f.registry.readTask('a');
  assert.throws(
    () =>
      f.registry.revise('a', current.revision, (record) => {
        record.frozen.accepted = '0'.repeat(40);
      }),
    /immutable/,
  );
  writeFileSync(path.join(f.a, 'src/feature.js'), 'unreviewed edit');
  f.git(f.a, 'add', '.');
  assert.throws(() => checkAcceptedIndex(f.a), /differs from accepted/);
  await completionCommand(f.a, ['freeze'], { owner: 'chat-a', execute: f.execute });
  assert.deepEqual(readAcceptance(f.a, 'a'), original);
});
test('technical repair is adopted only after accepted business proof and retains its first failed stage', async (t) => {
  const f = fixture(t);
  await completionCommand(f.a, ['freeze'], { owner: 'chat-a', execute: f.execute });
  const original = readAcceptance(f.a, 'a');
  writeFileSync(path.join(f.a, 'scripts/repair.mjs'), '// fixed technical helper');
  f.git(f.a, 'add', '.');
  f.git(f.a, 'commit', '-m', 'technical repair');
  const head = f.git(f.a, 'rev-parse', 'HEAD');
  assertAcceptedSource(f.a, 'a', head);
  const execute = (root, command, args) => {
    if (command === 'gh') throw Error('fixture stops before remote access');
    return f.execute(root, command, args);
  };
  await assert.rejects(completionCommand(f.a, ['deliver', 'a', head], { owner: 'chat-a', execute }), /fixture stops/);
  assert.equal(f.registry.readTask('a').recordedHead, head);
  assert.deepEqual(readAcceptance(f.a, 'a'), original);
  const session = JSON.parse(readFileSync(path.join(f.registry.commonDir, 'task-delivery/a/completion-session.json')));
  assert.equal(session.events.find((event) => event.name === 'prepare').status, 'failure');
  assert.equal(f.registry.readTask('b').stage, 'developing');
});

test('old review metadata is preserved but cannot block planning or certify current development', (t) => {
  const f = fixture(t),
    task = f.registry.readTask('a');
  f.registry.revise('a', task.revision, (record) => {
    record.stage = 'dev-validated';
    record.development = { reviewed: true, sourceDigest: 'stale', reviewVersion: 2 };
    record.reviewScope = { digest: 'old', file: '.task-runtime/missing-scope.json' };
    record.reviewPasses = [{ digest: 'old', file: '.task-runtime/missing-review.json' }];
  });
  const before = f.registry.readTask('a'),
    batch = readActiveBatch(f.a);
  assert.equal(Object.hasOwn(batch, 'developmentReview'), false);
  assert.equal(batch.modules[0].status, 'in-progress');
  assert.equal(planBatchDelivery(f.a).verificationProven, false);
  assert.deepEqual(f.registry.readTask('a'), before);
});

test('planning still requires clean source, the exact recorded head and assigned commits', (t) => {
  const f = fixture(t),
    original = readFileSync(path.join(f.a, 'src/feature.js'));
  writeFileSync(path.join(f.a, 'src/feature.js'), 'uncommitted business');
  assert.throws(() => planBatchDelivery(f.a), /Task must be clean/);
  writeFileSync(path.join(f.a, 'src/feature.js'), original);
  let task = f.registry.readTask('a');
  f.registry.revise('a', task.revision, (record) => {
    record.recordedHead = task.base;
  });
  assert.throws(() => planBatchDelivery(f.a), /Checkpoint the exact current task head/);
  writeFileSync(path.join(f.a, 'scripts/repair.mjs'), '// own additional technical change');
  f.git(f.a, 'add', 'scripts/repair.mjs');
  f.git(f.a, 'commit', '-m', 'unassigned task commit');
  task = f.registry.readTask('a');
  f.registry.revise('a', task.revision, (record) => {
    record.recordedHead = f.git(f.a, 'rev-parse', 'HEAD');
  });
  assert.throws(() => planBatchDelivery(f.a), /Unassigned task commit/);
  assert.equal(readFileSync(path.join(f.b, 'src/feature.js'), 'utf8'), 'unfinished B');
});
