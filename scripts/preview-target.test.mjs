import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import { preparePreviewTarget, prepareRetainedTarget, validatePreparedTarget } from './preview-target.mjs';
import { taskDataNames } from './task-data-environment.mjs';
function fixture(t) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'preview-target-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (file, value) => {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, value);
    return full;
  };
  git('init', '-b', 'codex/a');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Fixture');
  write('.gitignore', 'node_modules/\n.task-runtime/\n');
  write('package.json', '{"name":"fixture","version":"1.0.0"}');
  write('package-lock.json', '{"lockfileVersion":3,"packages":{"":{"name":"fixture","version":"1.0.0"}}}');
  write('page.js', 'export const value = 1;');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const registry = createTaskRegistry(dir);
  const task = registry.register({ id: 'a', worktree: dir, owner: 'chat-a' });
  registry.revise(task.id, task.revision, (record) => {
    record.resources.dataScope = 'persistent-preview';
    record.resources.persistentPreviewOwner = true;
  });
  write('node_modules/.package-lock.json', '{"packages":{}}');
  const dataFile = write(
    '.git/preview-environment/environment.json',
    JSON.stringify({
      version: 1,
      repository: registry.commonDir,
      profile: {
        status: 'ready',
        ...taskDataNames(path.join(registry.commonDir, 'preview-environment'), 'persistent-preview'),
        version: 1,
        workspaceRoot: path.join(registry.commonDir, 'preview-environment'),
        project: 'persistent-preview',
        password: 'a'.repeat(48),
        backupFile: '/fixture-backup.sql.gz',
      },
    }),
  );
  const config = {
    launcherPath: write('.task-runtime/launcher.mjs', "import { x } from './task-data-environment.mjs';"),
  };
  return { dir, git, registry, write, dataFile, config, request: { task: 'a', owner: 'chat-a', worktree: dir } };
}
test('preparation binds exact task, all source, installed launcher and isolated data without starting a service', (t) => {
  const f = fixture(t),
    prepared = preparePreviewTarget(f.dir, f.request, f.config);
  assert.equal(prepared.task.id, 'a');
  assert.equal(prepared.interruption, 'protected-handoff-on-fixed-port');
  assert.doesNotThrow(() => validatePreparedTarget(prepared, f.config));
  f.write('page.js', 'export const value = 2;');
  assert.throws(() => validatePreparedTarget(prepared, f.config), /source changed/);
});
test('data or launcher changes after preparation cannot pass the switch proof', (t) => {
  const f = fixture(t),
    prepared = preparePreviewTarget(f.dir, f.request, f.config);
  f.write('.task-runtime/launcher.mjs', 'changed launcher');
  assert.throws(() => validatePreparedTarget(prepared, f.config), /launcher changed/);
  f.write('.task-runtime/launcher.mjs', "import { x } from './task-data-environment.mjs';");
  const data = JSON.parse(readFileSync(f.dataFile));
  data.profile.database = 'zdm_task_' + 'b'.repeat(16);
  writeFileSync(f.dataFile, JSON.stringify(data));
  assert.throws(() => validatePreparedTarget(prepared, f.config), /data binding changed/);
});
test('wrong chat, unknown options, integration data and unavailable preview data fail before stopping anything', (t) => {
  const f = fixture(t);
  assert.throws(() => preparePreviewTarget(f.dir, { ...f.request, owner: 'other' }, f.config), /does not own/);
  assert.throws(
    () =>
      preparePreviewTarget(
        f.dir,
        { ...f.request, taskArgs: ['--mode', 'frontend', '--api-target', 'http://127.0.0.1:8080'] },
        f.config,
      ),
    /isolated full-stack/,
  );
  const data = JSON.parse(readFileSync(f.dataFile));
  data.profile.database = 'zdm_admin';
  writeFileSync(f.dataFile, JSON.stringify(data));
  assert.throws(() => preparePreviewTarget(f.dir, f.request, f.config), /Integration or unknown database/);
  data.profile.status = 'missing';
  writeFileSync(f.dataFile, JSON.stringify(data));
  assert.throws(() => preparePreviewTarget(f.dir, f.request, f.config), /not ready/);
});
test('a task cannot silently use another unfinished task persistent database even when its API is reachable', (t) => {
  const f = fixture(t),
    task = f.registry.readTask('a');
  f.registry.revise(task.id, task.revision, (record) => {
    delete record.resources.persistentPreviewOwner;
  });
  assert.throws(() => preparePreviewTarget(f.dir, f.request, f.config), /cross-task database compatibility/);
});
test('retained target must be the exact clean published main and never a task candidate', (t) => {
  const f = fixture(t),
    main = f.git('rev-parse', 'HEAD');
  const remote = path.join(f.dir, '.task-runtime/remote.git'),
    retained = path.join(f.dir, '.task-runtime/preview-current');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  f.git('remote', 'add', 'origin', remote);
  f.git('push', 'origin', 'HEAD:main');
  f.git('worktree', 'add', '-b', 'codex/preview-current', retained);
  mkdirSync(path.join(retained, 'node_modules'));
  writeFileSync(path.join(retained, 'node_modules/.package-lock.json'), '{"packages":{}}');
  const publishedRoot = path.join(f.registry.commonDir, 'preview-environment/published');
  const data = JSON.parse(readFileSync(f.dataFile));
  data.profile = {
    ...data.profile,
    workspaceRoot: publishedRoot,
    project: 'published-preview',
    ...taskDataNames(publishedRoot, 'published-preview'),
  };
  f.write('.git/preview-environment/published/environment.json', JSON.stringify(data));
  const prepared = prepareRetainedTarget(f.dir, retained, main, f.config);
  assert.equal(prepared.retainedMain, main);
  validatePreparedTarget(prepared, f.config);
  writeFileSync(path.join(retained, 'page.js'), 'changed');
  assert.throws(() => prepareRetainedTarget(f.dir, retained, main, f.config), /dirty/);
  f.git('-C', retained, 'restore', 'page.js');
  const advanced = f.git('commit-tree', main + '^{tree}', '-p', main, '-m', 'other task main');
  execFileSync('git', ['--git-dir', remote, 'fetch', f.dir, advanced], { stdio: 'pipe' });
  execFileSync('git', ['--git-dir', remote, 'update-ref', 'refs/heads/main', advanced], { stdio: 'pipe' });
  assert.throws(() => prepareRetainedTarget(f.dir, retained, main, f.config), /no longer the published/);
});
