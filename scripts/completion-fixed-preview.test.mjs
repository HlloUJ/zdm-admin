import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  inspectFixedCompletionPreview,
  createFixedCompletionPreviewControl,
  assertFixedPreviewIndependent,
} from './completion-fixed-preview.mjs';
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'fixed-delivery-')),
    common = path.join(root, '.git'),
    worktree = path.join(root, 'source'),
    file = path.join(root, 'config.json');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(common, 'preview-environment'), { recursive: true });
  mkdirSync(worktree);
  const backup = path.join(root, 'backup');
  writeFileSync(backup, 'retained');
  const media = { name: 'zdm-task-media-1234567890abcdef', source: '/media', rw: true };
  const config = {
    port: 5179,
    api: 'http://127.0.0.1:8081',
    worktree,
    branch: 'codex/source',
    head: 'a'.repeat(40),
    viteConfig: path.join(root, 'vite.config.mjs'),
    backend: {
      id: 'b'.repeat(64),
      started: 'old-start',
      database: 'ZDM_DB_URL=jdbc:mysql://mysql/zdm_task_1234567890abcdef',
      media: [media],
    },
  };
  writeFileSync(file, JSON.stringify(config));
  writeFileSync(
    path.join(common, 'preview-environment/environment.json'),
    JSON.stringify({
      version: 1,
      repository: common,
      profile: { status: 'ready', database: 'zdm_task_1234567890abcdef', mediaVolume: media.name, backupFile: backup },
    }),
  );
  const backend = {
    Id: config.backend.id,
    State: { Running: true, StartedAt: 'new-start' },
    NetworkSettings: { Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8081' }] } },
    Config: { Env: [config.backend.database], Labels: { 'com.docker.compose.project': 'fixed-backend' } },
    Mounts: [
      { Type: 'volume', Destination: '/data/zdm/craft-images', Name: media.name, Source: media.source, RW: true },
      { Type: 'bind', Source: path.join(root, 'backend-carrier', 'app.jar') },
    ],
  };
  const f = { root, common, worktree, file, config, backend, head: config.head, dirty: '', events: [] };
  f.execute = (cwd, cmd, args) => {
    f.events.push([cmd, args]);
    if (cmd === 'docker') return JSON.stringify([backend]);
    if (cmd === 'lsof') return args.includes('-Fn') ? 'p123\nn' + worktree : '123';
    if (cmd === 'ps') return 'start';
    if (cmd === 'git') {
      if (args.includes('--git-common-dir')) return common;
      if (args.includes('HEAD')) return f.head;
      if (args.includes('branch')) return config.branch;
      if (args.includes('status')) return f.dirty;
    }
    throw Error('Unexpected command ' + cmd);
  };
  f.inspect = async (opts) => {
    assert.equal(opts.port, 5179);
    assert.equal(opts.expectedMode, 'frontend');
    return { metadata: {}, errors: [] };
  };
  f.probe = () => inspectFixedCompletionPreview(common, { configFile: file, execute: f.execute, inspect: f.inspect });
  return f;
}
test('real proof binds source, listener, original data and backup without service mutations', async (t) => {
  const f = fixture(t),
    p = await f.probe();
  assert.equal(p.head, f.config.head);
  assert.equal(p.backendId, f.config.backend.id);
  assert.equal(p.protectedPaths.length, 3);
  assert.ok(f.events.every(([c]) => ['git', 'lsof', 'ps', 'docker'].includes(c)));
  assert.throws(() => assertFixedPreviewIndependent(p, path.join(f.root, 'backend-carrier')), /depends/);
});
for (const failure of ['head', 'dirty', 'container', 'stopped', 'port', 'database', 'media', 'api', 'selection'])
  test('fixed proof rejects ' + failure, async (t) => {
    const f = fixture(t);
    if (failure === 'head') f.head = 'c'.repeat(40);
    if (failure === 'dirty') f.dirty = ' M x';
    if (failure === 'container') f.backend.Id = 'c'.repeat(64);
    if (failure === 'stopped') f.backend.State.Running = false;
    if (failure === 'port') f.backend.NetworkSettings.Ports['8080/tcp'][0].HostPort = '8080';
    if (failure === 'database') f.backend.Config.Env = ['ZDM_DB_URL=jdbc:mysql://mysql/other'];
    if (failure === 'media') f.backend.Mounts[0].Name = 'other';
    if (failure === 'api') f.inspect = async () => ({ metadata: {}, errors: ['wrong API'] });
    if (failure === 'selection')
      f.inspect = async () => {
        writeFileSync(f.file, JSON.stringify({ ...f.config, head: 'c'.repeat(40) }));
        return { metadata: {}, errors: [] };
      };
    await assert.rejects(f.probe());
  });
test('fixed control preserves unregistered foreign source and refuses live task cleanup or drift', async () => {
  const plan = { task: '/repo/delivery', anchor: '/repo/main', preview: '/repo/preview-current', common: '/repo/.git' },
    base = {
      worktree: '/repo/unregistered',
      protectedPaths: ['/repo/unregistered', '/repo/backend/app.jar'],
      proofDigest: 'one',
      backendProject: 'fixed-backend',
    };
  let proof = { ...base },
    refs = { owned: [], backendPorts: [] };
  const control = createFixedCompletionPreviewControl({
    probe: async () => proof,
    registry: () => ({ resolve: () => ({ id: 'delivery' }) }),
    references: async () => refs,
    taskProject: () => 'delivery-project',
  });
  assert.equal((await control.ensure(plan)).reused, true);
  await control.prepareComposition(plan);
  await control.prepareHandoff(plan);
  await control.assertCleanupSafe(plan);
  refs = { owned: [], backendPorts: [8082] };
  await assert.rejects(control.prepareComposition(plan), /Live task backend/);
  proof = { ...base, proofDigest: 'two' };
  await assert.rejects(control.check(plan), /changed/);
});
test('fixed source or its exact backend project cannot be delivered and removed', async () => {
  const proof = {
    worktree: '/repo/foreign',
    protectedPaths: ['/repo/task'],
    proofDigest: 'one',
    backendProject: 'project',
  };
  assert.throws(() => assertFixedPreviewIndependent(proof, '/repo/task'), /depends/);
  assert.throws(
    () => assertFixedPreviewIndependent({ ...proof, protectedPaths: [], taskProject: 'project' }, '/repo/task'),
    /owned/,
  );
});

test('fixed runtime keeps integration/backup requirements and never probes retired 5175', async (t) => {
  const f = fixture(t);
  const { checkCompletionRuntime } = await import('./task-completion.mjs');
  const calls = [];
  const result = await checkCompletionRuntime(f.worktree, f.common, {
    fixedConfigFile: f.file,
    fixedProbe: async () => ({ type: 'preserved-fixed-preview', head: f.config.head }),
    request: async (url) => {
      calls.push(url);
      return { statusCode: 200, body: JSON.stringify({ status: 'UP' }) };
    },
  });
  assert.equal(result.runtimeHealthy, true);
  assert.equal(result.backupRetained, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => !url.includes('5175')));
  await assert.rejects(
    checkCompletionRuntime(f.worktree, f.common, {
      fixedConfigFile: f.file,
      fixedProbe: async () => {
        throw Error('wrong database');
      },
      allowPreviewUnavailable: true,
    }),
    /wrong database/,
  );
});

// Settle may resume after worktree removal but before branch deletion/close.
test('fixed cleanup proof uses retained registration after delivery worktree removal', async () => {
  const plan = {
    task: '/absent/delivery-task',
    anchor: '/repo/main',
    preview: '/repo/preview-current',
    common: '/repo/.git',
  };
  const control = createFixedCompletionPreviewControl({
    probe: async () => ({
      worktree: '/repo/fixed',
      protectedPaths: ['/repo/fixed'],
      proofDigest: 'same',
      backendProject: 'other',
    }),
    registry: () => ({ list: () => [{ id: 'delivery', worktree: plan.task, branch: 'codex/delivery' }] }),
    execute: () => {
      throw Error('Must not run Git from removed worktree');
    },
  });
  assert.equal((await control.assertCleanupSafe(plan)).ready, true);
});
