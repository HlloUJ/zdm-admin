import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import path from 'node:path';
import {
  parseCombination,
  createPreviewCombination,
  planPreviewCombination,
  combinationCommand,
} from './preview-combination.mjs';
import { assertCombinationPreview, readPreviewCombination } from './preview-combination-state.mjs';
import { startParallelTask } from './task-start.mjs';
import { completionCommand } from './completion-cli.mjs';
import { planTaskDelivery, taskBatch } from './task-context.mjs';
import { previewDescriptor } from './preview-policy.mjs';
import { isolateTaskData } from './task-data-scope.mjs';
import { previewDataRoot } from './task-data-environment.mjs';
import { previewCombinationFixture as fixture } from './test-support/preview-combination-fixture.mjs';

test('combination parsing requires distinct task ids, full versions and exact commands', () => {
  assert.equal(
    parseCombination(['create', 'combined', '--member', 'a@' + 'a'.repeat(40), '--member', 'b@' + 'b'.repeat(40)])
      .members.length,
    2,
  );
  for (const args of [
    ['create', 'combined', '--member', 'a@abc'],
    ['run', 'combined', '--worktree', 'elsewhere'],
    ['create', 'combined', '--member', 'a@' + 'a'.repeat(40), '--member', 'a@' + 'b'.repeat(40)],
    ['deliver', 'combined'],
  ])
    assert.throws(() => parseCombination(args));
});
test('real Git combination preserves both incomplete members and records their exact merged source', (t) => {
  const f = fixture(t),
    before = f.git(f.root, 'rev-parse', 'HEAD'),
    plan = planPreviewCombination(f.root, f.options);
  assert.equal(plan.dataPrepared, false);
  assert.equal(f.registry.readTask('combined'), null);
  const result = f.create(),
    task = result.task;
  assert.equal(task.previewOnly, true);
  assert.equal(result.previewSwitched, false);
  assert.equal(result.dataPrepared, false);
  assert.equal(task.resources.dataScope, 'isolated-combination');
  assert.equal(task.compatibility.readOnly, true);
  assert.equal(task.compatibility.previewOnlyProtocol, 1);
  assert.equal(previewDataRoot(task.worktree), path.join(f.registry.commonDir, 'task-environments', task.id));
  assert.equal(readFileSync(path.join(task.worktree, 'a.txt'), 'utf8'), 'a source\n');
  assert.equal(readFileSync(path.join(task.worktree, 'b.txt'), 'utf8'), 'b source\n');
  assert.equal(f.git(f.root, 'rev-parse', 'HEAD'), before);
  assert.equal(readFileSync(f.settings, 'utf8'), '{"selected":"unrelated-b"}\n');
  for (const original of Object.values(f.tasks))
    assert.equal(f.git(original.worktree, 'rev-parse', 'HEAD'), original.head);
  assert.deepEqual(
    result.manifest.members.map((m) => ({ task: m.task, commit: m.commit })),
    f.options.members,
  );
  assert.equal(existsSync(path.join(f.registry.commonDir, 'task-environments/combined/environment.json')), false);
  assert.equal(assertCombinationPreview(f.root, task, { port: 5177 }).preview.role, 'combination');
});
test('dirty member source or an inaccurate version is refused without creating a carrier', (t) => {
  const f = fixture(t),
    file = path.join(f.tasks.a.worktree, 'unfinished.txt');
  writeFileSync(file, 'preserve this');
  assert.throws(f.create, /uncommitted source/);
  assert.equal(f.registry.readTask('combined'), null);
  assert.equal(readFileSync(file, 'utf8'), 'preserve this');
  rmSync(file);
  assert.throws(
    () =>
      createPreviewCombination(
        f.root,
        { ...f.options, members: [{ task: 'a', commit: 'a'.repeat(40) }, f.options.members[1]] },
        { owner: 'chat-combination' },
      ),
    /HEAD differs/,
  );
  assert.equal(f.registry.readTask('combined'), null);
});
test('a source conflict retains the owned preview carrier and leaves both member tasks untouched', (t) => {
  const f = fixture(t, { conflict: true });
  assert.throws(f.create);
  const owned = f.registry.readTask('combined');
  assert.equal(owned.previewOnly, true);
  assert.equal(owned.stage, 'blocked');
  assert.ok(existsSync(owned.worktree));
  assert.notEqual(f.git(owned.worktree, 'ls-files', '--unmerged'), '');
  for (const original of Object.values(f.tasks)) {
    assert.equal(f.git(original.worktree, 'rev-parse', 'HEAD'), original.head);
    assert.equal(f.git(original.worktree, 'status', '--porcelain'), '');
  }
  assert.equal(readFileSync(f.settings, 'utf8'), '{"selected":"unrelated-b"}\n');
});
test('interrupted exact merges recover their original versions while member development continues', (t) => {
  const f = fixture(t),
    hooks = path.join(f.parent, 'hooks'),
    count = path.join(hooks, 'count'),
    failed = path.join(hooks, 'failed');
  mkdirSync(hooks);
  const hook = path.join(hooks, 'pre-merge-commit');
  writeFileSync(
    hook,
    `#!/bin/sh\nif test ! -f '${count}'; then touch '${count}'; exit 0; fi\nif test ! -f '${failed}'; then touch '${failed}'; exit 1; fi\nexit 0\n`,
  );
  chmodSync(hook, 0o700);
  f.git(f.root, 'config', 'core.hooksPath', hooks);
  assert.throws(f.create);
  const partial = f.registry.readTask('combined');
  assert.equal(partial.combinationFailures.length, 1);
  // This abort is an explicit fixture action on the failed owned preview merge,
  // never an automatic repair or mutation of either source task.
  f.git(partial.worktree, 'merge', '--abort');
  writeFileSync(path.join(f.tasks.b.worktree, 'new-work.txt'), 'later member work\n');
  f.git(f.tasks.b.worktree, 'add', 'new-work.txt');
  f.git(f.tasks.b.worktree, 'commit', '-m', 'later work');
  const later = f.git(f.tasks.b.worktree, 'rev-parse', 'HEAD');
  const resumed = f.create();
  assert.equal(resumed.task.stage, 'developing');
  assert.equal(resumed.task.combinationFailures.length, 1);
  assert.ok(resumed.task.combinationRecoveredAt);
  assert.equal(resumed.manifest.members[1].commit, f.tasks.b.head);
  assert.equal(f.git(f.tasks.b.worktree, 'rev-parse', 'HEAD'), later);
  assert.equal(existsSync(path.join(resumed.task.worktree, 'new-work.txt')), false);
  assert.throws(
    () =>
      createPreviewCombination(
        f.root,
        { ...f.options, members: [f.options.members[0], { task: 'b', commit: later }] },
        { owner: 'chat-combination' },
      ),
    /original combination recipe/,
  );
});
test('preview-only purpose cannot be removed or re-registered as a normal task', (t) => {
  const f = fixture(t),
    task = f.create().task;
  assert.throws(
    () =>
      f.registry.revise(task.id, task.revision, (record) => {
        record.previewOnly = false;
      }),
    /identity.*immutable/,
  );
  assert.throws(
    () => f.registry.register({ id: task.id, owner: task.owner, worktree: task.worktree, kind: task.kind }),
    /preview-only purpose/,
  );
  assert.equal(f.registry.readTask(task.id).previewOnly, true);
  assert.throws(
    () =>
      f.registry.revise(task.id, task.revision, (record) => {
        record.resources.dataScope = 'isolated-task';
      }),
    /isolated compatibility scope/,
  );
  assert.throws(
    () =>
      f.registry.revise(task.id, task.revision, (record) => {
        record.compatibility.readOnly = false;
      }),
    /identity.*immutable/,
  );
});
test('an incomplete preview-only source cannot initialize durable data', async (t) => {
  const f = fixture(t),
    result = startParallelTask(
      {
        slug: 'incomplete',
        kind: 'infrastructure',
        owner: 'chat-combination',
        taskParent: f.parent,
        previewOnly: true,
      },
      { root: f.root },
    );
  await assert.rejects(
    isolateTaskData(
      f.root,
      { id: result.task.id, owner: 'chat-combination', apply: true },
      {
        running: () => assert.fail('must not inspect Docker'),
        provision: () => assert.fail('must not initialize data'),
      },
    ),
    /preparation is incomplete/,
  );
  assert.equal(existsSync(path.join(f.registry.commonDir, 'task-environments/incomplete/environment.json')), false);
});
test('formal completion rejects a real preview-only task before freezing or acquiring a completion lease', async (t) => {
  const f = fixture(t),
    task = f.create().task;
  for (const args of [
    ['begin'],
    ['freeze'],
    ['deliver', task.id, task.recordedHead],
    ['settle', task.id, task.recordedHead, '123'],
  ])
    await assert.rejects(
      completionCommand(task.worktree, args, { owner: task.owner }),
      /Temporary preview combinations/,
    );
  assert.throws(() => planTaskDelivery(f.root, taskBatch(task, f.root)), /Temporary preview combinations/);
  assert.equal(existsSync(path.join(f.registry.commonDir, 'task-delivery', task.id, 'accepted-source.json')), false);
  assert.equal(
    existsSync(path.join(f.registry.commonDir, 'task-registry/resource-leases', 'task-delivery-' + task.id)),
    false,
  );
  assert.throws(() => previewDescriptor('development', { task }), /temporary port/);
  assert.throws(() => assertCombinationPreview(f.root, task, { port: 5175 }), /fixed ports/);
});
test('manifest tampering and edits in a combination are refused before launching', async (t) => {
  const f = fixture(t),
    task = f.create().task;
  let launches = 0;
  writeFileSync(path.join(task.worktree, 'a.txt'), 'unexpected edit\n');
  await assert.rejects(
    combinationCommand(f.root, ['run', task.id], {
      owner: task.owner,
      launch: () => {
        launches++;
      },
    }),
    /source changed/,
  );
  assert.equal(launches, 0);
  const file = task.resources.previewCombination.file;
  chmodSync(file, 0o600);
  writeFileSync(file, '{}\n');
  assert.throws(() => readPreviewCombination(f.root, task), /manifest changed/);
});
test('another task cannot take over a combination or convert an existing business task', async (t) => {
  const f = fixture(t),
    task = f.create().task;
  await assert.rejects(
    combinationCommand(f.root, ['run', task.id], { owner: 'wrong', launch: () => assert.fail('must not launch') }),
    /must own/,
  );
  await assert.rejects(
    combinationCommand(f.root, ['stop', task.id], {
      owner: 'wrong',
      references: () => assert.fail('must not inspect or stop'),
    }),
    /must own/,
  );
  assert.throws(
    () => createPreviewCombination(f.root, { ...f.options, id: 'a' }, { owner: 'chat-a' }),
    /development task/,
  );
  const next = f.registry.readTask(task.id);
  assert.equal(next.owner, task.owner);
  assert.equal(next.revision, task.revision);
});
test('the preview compatibility adapter never makes a preserved legacy task writable', (t) => {
  const f = fixture(t),
    task = f.registry.readTask('a'),
    file = path.join(f.registry.directory, 'tasks/a.json');
  task.compatibility = { readOnly: true };
  writeFileSync(file, JSON.stringify(task) + '\n');
  const before = readFileSync(file);
  assert.throws(() => f.registry.resolve({ id: 'a' }), /Legacy record is read-only/);
  assert.throws(
    () => f.registry.revise('a', task.revision, () => assert.fail('must not modify preserved legacy identity')),
    /Exact writable task/,
  );
  assert.throws(
    () =>
      f.registry.register({ id: 'a', worktree: task.worktree, owner: task.owner, kind: task.kind, previewOnly: true }),
    /preview-only purpose/,
  );
  assert.deepEqual(readFileSync(file), before);
});
test('stop rejects fixed ports and unknown consumers; exact temporary stop keeps source and data', async (t) => {
  const f = fixture(t),
    task = f.create().task,
    calls = [];
  await assert.rejects(
    combinationCommand(f.root, ['stop', task.id], {
      owner: task.owner,
      references: async () => ({ owned: [{ port: 5175 }] }),
      launch: () => assert.fail('must not stop fixed preview'),
    }),
    /fixed preview port/,
  );
  await assert.rejects(
    combinationCommand(f.root, ['stop', task.id], {
      owner: task.owner,
      references: async () => {
        throw Error('unknown consumer');
      },
      launch: () => assert.fail('must retain environment'),
    }),
    /unknown consumer/,
  );
  const result = await combinationCommand(f.root, ['stop', task.id], {
    owner: task.owner,
    references: async () => ({ owned: [{ port: 5177 }] }),
    launch: async (args) => calls.push(args),
  });
  assert.deepEqual(calls, [['--worktree', task.worktree, '--stop', '--port', '5177']]);
  assert.equal(result.sourceAndDataRetained, true);
  assert.ok(existsSync(task.worktree));
});
