import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { isolateTaskData } from './task-data-scope.mjs';
import { ensureTaskData, previewDataFile, taskDataNames, readTaskData } from './task-data-environment.mjs';
function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'task-data-scope-'))),
    root = path.join(dir, 'main');
  mkdirSync(root);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(path.join(root, 'source'), 'base');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const a = path.join(dir, 'a'),
    b = path.join(dir, 'b');
  for (const [branch, target] of [
    ['codex/a', a],
    ['codex/b', b],
    ['codex/integration-current', path.join(dir, 'integration')],
  ])
    git('worktree', 'add', '-b', branch, target);
  const registry = createTaskRegistry(root);
  const legacy = registry.register({ id: 'a', worktree: a, owner: 'chat-a' });
  registry.revise('a', legacy.revision, (record) => {
    record.resources.dataScope = 'persistent-preview';
    record.resources.persistentPreviewOwner = true;
  });
  registry.register({ id: 'b', worktree: b, owner: 'chat-b' });
  return { root, a, b, registry };
}
test('data preparation plan is read-only and never queries Docker or provisions data', async (t) => {
  const f = fixture(t),
    before = f.registry.readTask('b');
  const plan = await isolateTaskData(
    f.root,
    { id: 'b', owner: 'chat-b' },
    { running: () => assert.fail('no Docker query'), provision: () => assert.fail('no data writes') },
  );
  assert.equal(plan.apply, false);
  assert.deepEqual(f.registry.readTask('b'), before);
});
test('parallel incompatible task data gets a separate durable location and preserves task A scope', async (t) => {
  const f = fixture(t),
    first = previewDataFile(f.a);
  await isolateTaskData(
    f.root,
    { id: 'b', owner: 'chat-b', apply: true },
    {
      running: () => '',
      provision: async () => ({ database: 'fixture-b', mediaVolume: 'fixture-b-media', backupFile: '/fixture-backup' }),
    },
  );
  assert.equal(previewDataFile(f.a), first);
  assert.notEqual(previewDataFile(f.b), first);
  assert.ok(previewDataFile(f.b).includes('/task-environments/b/'));
  assert.equal(f.registry.readTask('a').resources.dataScope, 'persistent-preview');
});
test('wrong owner or a running target refuses scope mutation and failed provisioning never falls back', async (t) => {
  const f = fixture(t);
  await assert.rejects(isolateTaskData(f.root, { id: 'b', owner: 'chat-a', apply: true }), /owner required/);
  await assert.rejects(
    isolateTaskData(f.root, { id: 'b', owner: 'chat-b', apply: true }, { running: () => 'container-b' }),
    /Stop the exact/,
  );
  assert.equal(f.registry.readTask('b').resources.dataScope, 'isolated-task');
  await assert.rejects(
    isolateTaskData(
      f.root,
      { id: 'b', owner: 'chat-b', apply: true },
      {
        running: () => '',
        provision: async () => {
          throw Error('copy failed');
        },
      },
    ),
    /copy failed/,
  );
  assert.equal(f.registry.readTask('b').resources.dataScope, 'isolated-task');
  await assert.rejects(
    ensureTaskData({ root: f.b, project: 'b' }, { execute: () => assert.fail('no Docker or data writes') }),
    /不得自动创建/,
  );
});
test('published retained data is independent of unfinished and completed tasks and survives source cleanup', (t) => {
  const f = fixture(t),
    registry = f.registry;
  function writeProfile(root, project) {
    const file = previewDataFile(root),
      directory = path.dirname(file);
    mkdirSync(directory, { recursive: true });
    const value = {
      version: 1,
      repository: registry.commonDir,
      ...(project === 'task-b' ? { task: 'b' } : {}),
      profile: {
        version: 1,
        status: 'ready',
        workspaceRoot: directory,
        project,
        ...taskDataNames(directory, project),
        password: 'a'.repeat(48),
        backupFile: '/fixture-backup.sql.gz',
      },
    };
    writeFileSync(file, JSON.stringify(value));
    return { file, value, bytes: readFileSync(file, 'utf8') };
  }
  const a = writeProfile(f.a, 'persistent-preview');
  const b = registry.readTask('b');
  registry.revise('b', b.revision, (r) => {
    r.resources.dataScope = 'isolated-task';
  });
  const isolated = writeProfile(f.b, 'task-b');
  const retained = path.join(path.dirname(f.root), 'preview-current');
  execFileSync('git', ['-C', f.root, 'worktree', 'add', '-b', 'codex/preview-current', retained], { stdio: 'pipe' });
  assert.equal(readTaskData(retained), null, 'No fallback into unfinished A data');
  const published = writeProfile(retained, 'published-preview');
  assert.notEqual(readTaskData(retained).database, readTaskData(f.a).database);
  assert.notEqual(readTaskData(retained).database, readTaskData(f.b).database);
  execFileSync('git', ['-C', f.root, 'worktree', 'remove', f.b], { stdio: 'pipe' });
  assert.equal(readTaskData(retained).database, published.value.profile.database);
  assert.equal(readFileSync(a.file, 'utf8'), a.bytes);
  assert.equal(readFileSync(isolated.file, 'utf8'), isolated.bytes);
  writeFileSync(published.file, a.bytes);
  assert.throws(() => readTaskData(retained), /不可核验/, 'Cannot adopt a foreign namespace');
});
