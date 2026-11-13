import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { inspectManagedPreview, taskProjectName } from './dev-task.mjs';
import { taskRuntimeReferences } from './task-runtime-references.mjs';
import { createTaskRegistry } from './task-registry.mjs';

export const fixedPreviewConfigFile = () =>
  path.join(homedir(), 'Library/Application Support/zdm-admin/fixed-frontend/config.json');
export const hasFixedPreview = (file = fixedPreviewConfigFile()) => Boolean(file && existsSync(file));
export const fixedProofExecute = (cwd, command, args) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
  }).trim();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function read(file) {
  const stat = lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Unsafe fixed preview configuration');
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function assertFixedPreviewIndependent(proof, taskRoot) {
  const canonical = (value) => (existsSync(value) ? realpathSync(value) : path.resolve(value));
  const root = canonical(taskRoot);
  for (const source of proof.protectedPaths) {
    const target = canonical(source);
    assert.ok(
      target !== root && !target.startsWith(root + path.sep),
      'Fixed preview still depends on this task; preserve its source and backend',
    );
  }
  assert.ok(
    !proof.backendProject || proof.backendProject !== proof.taskProject,
    'Fixed preview backend is owned by the delivery task',
  );
}
export async function inspectFixedCompletionPreview(
  common,
  { configFile = fixedPreviewConfigFile(), execute = fixedProofExecute, inspect = inspectManagedPreview } = {},
) {
  const config = read(configFile);
  assert.equal(config.port, 5179);
  assert.equal(config.api, 'http://127.0.0.1:8081');
  assert.match(config.head ?? '', /^[a-f0-9]{40}$/);
  assert.match(config.backend?.id ?? '', /^[a-f0-9]{64}$/);
  assert.ok(path.isAbsolute(config.worktree) && config.branch?.startsWith('codex/'));
  assert.ok(typeof config.viteConfig === 'string' && path.isAbsolute(config.viteConfig));
  const run = (cmd, args) => execute(config.worktree, cmd, args).trim();
  assert.equal(
    path.resolve(config.worktree, run('git', ['rev-parse', '--git-common-dir'])),
    path.resolve(common),
    'Foreign fixed preview repository',
  );
  const source = () => {
    assert.equal(run('git', ['rev-parse', 'HEAD']), config.head, 'Fixed preview source changed');
    assert.equal(run('git', ['branch', '--show-current']), config.branch);
    assert.equal(run('git', ['status', '--porcelain']), '', 'Fixed preview source is dirty');
  };
  source();
  const pid = run('lsof', ['-nP', '-iTCP:5179', '-sTCP:LISTEN', '-t']);
  assert.match(pid, /^\d+$/, 'Exact fixed frontend listener required');
  const started = run('ps', ['-p', pid, '-o', 'lstart=']);
  const cwd = run('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'])
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1);
  assert.equal(cwd, config.worktree, 'Fixed frontend process source differs');
  const app = await inspect({
    port: 5179,
    expectedWorkspaceRoot: config.worktree,
    expectedBranch: config.branch,
    expectedMode: 'frontend',
    expectedApiTarget: config.api,
  });
  assert.ok(app.metadata && app.errors.length === 0, 'Fixed frontend identity or API health failed');
  const backend = JSON.parse(run('docker', ['inspect', config.backend.id]))[0];
  assert.equal(backend.Id, config.backend.id);
  assert.equal(backend.State.Running, true);
  assert.deepEqual(backend.NetworkSettings.Ports['8080/tcp'], [{ HostIp: '127.0.0.1', HostPort: '8081' }]);
  const database = backend.Config.Env.find((value) => value.startsWith('ZDM_DB_URL='));
  assert.equal(database, config.backend.database, 'Fixed preview database changed');
  const media = backend.Mounts.filter((m) => m.Destination === '/data/zdm/craft-images').map((m) => ({
    name: m.Name,
    source: m.Source,
    rw: m.RW,
  }));
  assert.deepEqual(media, config.backend.media, 'Fixed preview media changed');
  const registration = read(path.join(common, 'preview-environment/environment.json'));
  assert.equal(registration.version, 1);
  assert.equal(path.resolve(registration.repository), path.resolve(common));
  const profile = registration.profile;
  assert.equal(profile.status, 'ready');
  assert.match(profile.database, /^zdm_task_[a-f0-9]{16}$/);
  assert.equal(new URL(database.slice('ZDM_DB_URL=jdbc:'.length)).pathname, '/' + profile.database);
  assert.equal(media[0]?.name, profile.mediaVolume);
  assert.ok(existsSync(profile.backupFile), 'Fixed preview backup missing');
  source();
  const finalBackend = JSON.parse(run('docker', ['inspect', config.backend.id]))[0];
  assert.equal(finalBackend.Id, backend.Id);
  assert.equal(finalBackend.State.Running, true);
  assert.equal(finalBackend.State.StartedAt, backend.State.StartedAt, 'Fixed backend restarted during proof');
  assert.deepEqual(finalBackend.NetworkSettings.Ports['8080/tcp'], backend.NetworkSettings.Ports['8080/tcp']);
  assert.equal(
    finalBackend.Config.Env.find((value) => value.startsWith('ZDM_DB_URL=')),
    database,
  );
  assert.deepEqual(finalBackend.Mounts, backend.Mounts);
  assert.equal(run('lsof', ['-nP', '-iTCP:5179', '-sTCP:LISTEN', '-t']), pid, 'Fixed listener changed during proof');
  assert.deepEqual(read(configFile), config, 'Fixed preview selection changed during proof');
  assert.deepEqual(
    read(path.join(common, 'preview-environment/environment.json')),
    registration,
    'Fixed preview data registration changed during proof',
  );
  assert.equal(run('ps', ['-p', pid, '-o', 'lstart=']), started, 'Fixed frontend restarted during proof');
  const protectedPaths = [
    config.worktree,
    config.viteConfig,
    ...backend.Mounts.filter((m) => m.Type === 'bind').map((m) => m.Source),
  ];
  const modules = path.join(config.worktree, 'node_modules');
  if (existsSync(modules)) protectedPaths.push(realpathSync(modules));
  return {
    type: 'preserved-fixed-preview',
    worktree: config.worktree,
    branch: config.branch,
    head: config.head,
    pid: Number(pid),
    started,
    configDigest: digest(config),
    backendId: backend.Id,
    backendStarted: backend.State.StartedAt,
    backendProject: backend.Config.Labels?.['com.docker.compose.project'] ?? null,
    protectedPaths,
    proofDigest: digest({
      config,
      pid,
      started,
      backendStarted: backend.State.StartedAt,
      database,
      media,
      mounts: backend.Mounts,
      registration,
    }),
  };
}
export function createFixedCompletionPreviewControl({
  configFile,
  execute = fixedProofExecute,
  inspect,
  probe = inspectFixedCompletionPreview,
  references = taskRuntimeReferences,
  registry = createTaskRegistry,
  taskProject = (root, plan) => {
    const records = registry(plan.anchor)
      .list()
      .filter((record) => path.resolve(record.worktree) === path.resolve(root));
    assert.equal(records.length, 1, 'Exact delivery task registration required');
    const record = records[0];
    if (existsSync(root)) registry(plan.anchor).resolve({ id: record.id, worktree: root });
    return taskProjectName({ root: record.worktree, branch: record.branch });
  },
} = {}) {
  let initial;
  async function assertOwner(plan) {
    const proof = await probe(plan.common, { configFile, execute, inspect });
    if (initial)
      assert.equal(proof.proofDigest, initial.proofDigest, 'Fixed preview changed during delivery; preserve it');
    else initial = proof;
    assertFixedPreviewIndependent({ ...proof, taskProject: taskProject(plan.task, plan) }, plan.task);
    assert.notEqual(
      path.resolve(proof.worktree),
      path.resolve(plan.preview),
      'Published retained source cannot be preserved as an unfinished fixed preview',
    );
    assertFixedPreviewIndependent({ ...proof, backendProject: null }, plan.preview);
    return {
      type: 'fixed-frontend',
      phase: 'running',
      mode: 'frontend',
      worktree: proof.worktree,
      preservedFixedPreview: proof,
    };
  }
  async function check(plan) {
    const owner = await assertOwner(plan);
    return { ready: true, reused: true, preservedFixedPreview: owner.preservedFixedPreview };
  }
  async function prepare(plan) {
    const owner = await assertOwner(plan);
    const task = registry(plan.anchor).resolve({ worktree: plan.task });
    const snapshot = await references(task);
    assert.equal(
      snapshot.owned.length,
      0,
      'Live task frontend needs a separately guarded handoff; fixed preview is preserved',
    );
    assert.equal(
      snapshot.backendPorts.length,
      0,
      'Live task backend needs a separately guarded handoff; fixed preview is preserved',
    );
    await assertOwner(plan);
    return { quiesced: true, runtimeAbsent: true, paused: false, preservedFixedPreview: owner.preservedFixedPreview };
  }
  return {
    assertOwner,
    check,
    ensure: check,
    prepareComposition: prepare,
    prepareHandoff: prepare,
    assertCleanupSafe: check,
  };
}
