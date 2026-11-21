import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openCompletion, saveCompletion } from '../../completion-session.mjs';
import { cleanupIdentity, cleanupObjectId, createCleanupQueue } from '../../task-cleanup-queue.mjs';

const scripts = fileURLToPath(new URL('../../', import.meta.url));
export const scopeId = 'synthetic-exact-scope';
export const sourceTask = 'synthetic-delivered-task';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
};

function registerDelivery(root, common) {
  const head = 'a'.repeat(40),
    accepted = 'b'.repeat(40),
    main = 'c'.repeat(40);
  const worktree = path.join(root, 'former-worktree');
  const task = {
    id: sourceTask,
    worktree,
    recordedHead: head,
    frozen: { accepted },
    stage: 'closed',
    closedAt: new Date(100).toISOString(),
    main: { local: main, remote: main },
  };
  const directory = path.join(common, 'task-delivery', sourceTask);
  const session = openCompletion(directory, sourceTask, { now: 0 });
  const key = main + ':42';
  session.events = [
    {
      id: 'ci',
      name: 'ci',
      key,
      status: 'success',
      startedAt: 10,
      finishedAt: 80,
      result: {
        runId: '42',
        headSha: main,
        attempt: 1,
        conclusion: 'success',
        branch: 'main',
        jobs: ['Frontend quality', 'Backend quality'].map((name) => ({
          name,
          status: 'completed',
          conclusion: 'success',
        })),
      },
    },
    ...['evidence', 'handoff', 'preserve', 'cleanup', 'close'].map((name, i) => ({
      id: name,
      name,
      key,
      status: 'success',
      startedAt: 81 + i,
      finishedAt: 82 + i,
    })),
  ];
  session.closedAt = 100;
  saveCompletion(directory, session);
  writeJson(path.join(directory, 'completion-receipt.json'), {
    results: { close: { result: { batch: sourceTask, main: task.main } } },
  });
  return { task, proof: { worktree, head, accepted, main } };
}

function stage(root, common, fixtureDelivery, name) {
  const source = path.join(root, name);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'app.js'), name);
  const identity = cleanupIdentity(source);
  const registration = {
    version: 1,
    task: sourceTask,
    worktree: fixtureDelivery.worktree,
    relative: 'dist',
    identity,
    sourceDigest: 'd'.repeat(64),
    producer: 'vite-build-success-v1',
    command: ['npm', 'run', 'build:app'],
    exitCode: 0,
  };
  const proofDigest = digest(JSON.stringify(registration));
  const proofPath = path.join(common, 'task-cleanup/proofs', sourceTask, proofDigest + '.json');
  writeJson(proofPath, registration);
  const record = {
    version: 1,
    task: sourceTask,
    identity,
    producer: 'task-completion-handoff-v1',
    proof: { ...fixtureDelivery, rebuild: { kind: 'vite-dist-v1', record: proofPath, digest: proofDigest } },
    disposition: 'rebuildable',
    notBefore: new Date(0).toISOString(),
  };
  const key = cleanupObjectId(record);
  const carrier = path.join(common, 'task-cleanup/staging', sourceTask, key);
  fs.mkdirSync(carrier, { recursive: true, mode: 0o700 });
  const target = path.join(carrier, 'content');
  fs.renameSync(source, target);
  Object.assign(record, { carrier, path: target });
  const manifestPath = path.join(carrier, 'manifest.json');
  writeJson(manifestPath, record);
  createCleanupQueue(common).handoff(record);
  return { key, target, record, manifestPath };
}

function pinFixtureCopy(file, bindings) {
  let source = fs.readFileSync(file, 'utf8');
  for (const [name, value] of Object.entries(bindings)) {
    const line = new RegExp(`^((?:export const |const )?${name} = )'[^'\\n]+'(;?)$`, 'gm');
    assert.equal([...source.matchAll(line)].length, 1, 'Expected exactly one pinned declaration: ' + name);
    source = source.replace(line, (_original, prefix, suffix) => `${prefix}'${value}'${suffix}`);
  }
  fs.writeFileSync(file, source);
}

export async function pinCleanupFixture(root, common, taskId, records) {
  const entries = [
    ...records.map((record) => {
      const manifestPath = path.join(record.carrier, 'manifest.json');
      return {
        key: cleanupObjectId(record),
        manifestPath,
        manifestSha256: digest(fs.readFileSync(manifestPath)),
        logicalBytes: record.identity.bytes,
        kind: record.proof.rebuild.kind,
        disposition: record.disposition,
      };
    }),
    ...Array.from({ length: 150 - records.length }, (_, i) => {
      const key = digest('synthetic-member-' + i);
      return {
        key,
        manifestPath: path.join(common, 'task-cleanup/staging', taskId, key, 'manifest.json'),
        manifestSha256: digest('synthetic-manifest-' + i),
        logicalBytes: 0,
        kind: 'vite-dist-v1',
        disposition: 'rebuildable',
      };
    }),
  ]
    .map((entry) => ({
      ...entry,
      sourceTask: taskId,
      producer: 'task-completion-handoff-v1',
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const manifestSetSha256 = digest(JSON.stringify(entries.map(({ key, manifestSha256 }) => ({ key, manifestSha256 }))));
  const base = path.join(common, 'task-cleanup');
  const policy = {
    version: 1,
    limit: 10,
    budgetMs: 120000,
    maxLogicalBytes: 1024 ** 3,
    scope: { version: 1, id: scopeId, sourceTask: taskId, manifestSetSha256 },
    scheduler: { historyLimit: 10, maxSummaryBytes: 4096 },
  };
  const policyFile = path.join(base, 'policy.json');
  const scopeFile = path.join(base, 'scopes', scopeId + '.json');
  writeJson(policyFile, policy);
  writeJson(scopeFile, { scopeId, sourceTask: taskId, physicalDeletionAuthorized: false, entries });
  writeJson(path.join(base, 'scope-authorizations', scopeId + '.json'), {
    scopeId,
    sourceTask: taskId,
    manifestSetSha256,
    status: 'approved',
    userMessageId: 'synthetic-approval',
  });

  // Keep production pins immutable. Exercise the same code with synthetic pins in a temporary copy.
  const runtime = fs.mkdtempSync(path.join(root, 'cleanup-runtime-'));
  const runtimeScripts = path.join(runtime, 'scripts');
  fs.cpSync(scripts, runtimeScripts, { recursive: true });
  const scriptPath = (name) => path.join(runtimeScripts, name);
  const guard = 'delivery-repairs/task-cleanup-exact-scope.mjs';
  const helper = scriptPath('task-cleanup-delete.py');
  const pins = { SCOPE_ID: scopeId, SCOPE_DIGEST: manifestSetSha256 };
  pinFixtureCopy(scriptPath(guard), { ...pins, SOURCE: taskId });
  pinFixtureCopy(helper, { ...pins, SOURCE_TASK: taskId });
  const load = (name) => import(pathToFileURL(scriptPath(name)).href);
  const [{ cleanupCommand }, { runScheduledCleanup }, { loadExactCleanupScope }, queue] = await Promise.all([
    load('task-cleanup-cli.mjs'),
    load('task-cleanup-scheduled-cli.mjs'),
    load(guard),
    load('task-cleanup-queue.mjs'),
  ]);
  return {
    base,
    runtime,
    policy,
    scopeFile,
    helper,
    cleanupCommand,
    runScheduledCleanup,
    queue: queue.createCleanupQueue(common),
    scope: () => loadExactCleanupScope(common, policy),
    setPolicy: (value) => writeJson(policyFile, value),
  };
}

const pinnedQueues = new WeakMap();
export async function runFixtureQueue(fixture, options) {
  const { directory, root, common, queue } = fixture;
  if (!pinnedQueues.has(fixture)) {
    const records = fixture.record
      ? [fixture.record]
      : fs.readdirSync(path.join(queue.base, 'pending')).map((name) => {
          const pending = JSON.parse(fs.readFileSync(path.join(queue.base, 'pending', name)));
          return JSON.parse(fs.readFileSync(path.join(pending.carrier, 'manifest.json')));
        });
    assert.ok(records.length, 'Synthetic scope needs at least one staged manifest');
    pinnedQueues.set(fixture, pinCleanupFixture(directory ?? root, common, records[0].task, records));
  }
  const pinned = await pinnedQueues.get(fixture);
  return pinned.queue.run({ ...pinned.policy, ...options, scope: pinned.scope() });
}

export async function scopeFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'exact-cleanup-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const common = path.join(root, 'common');
  fs.mkdirSync(common, { mode: 0o700 });
  const { task, proof } = registerDelivery(root, common);
  const approved = stage(root, common, proof, 'approved');
  const outside = stage(root, common, proof, 'outside');
  const pinned = await pinCleanupFixture(root, common, sourceTask, [approved.record]);
  const registry = { commonDir: common, readTask: (id) => (id === sourceTask ? task : undefined) };
  const run = (args, options) => pinned.cleanupCommand(root, args, { registry, unreferenced: () => {}, ...options });
  return {
    ...pinned,
    root,
    common,
    approved,
    outside,
    task,
    run,
    schedule: (now) =>
      pinned.runScheduledCleanup(pinned.runtime, {
        now,
        scopeOnly: true,
        hostTimezone: 'Asia/Shanghai',
        verifyRuntime: () => ({ root, commonDir: common, sourceHead: task.main.local }),
        runCleanup: (_root, args, options) => run(args, options),
      }),
  };
}
