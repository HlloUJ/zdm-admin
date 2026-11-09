import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA = /^[a-f0-9]{40}$/;
export const TASK_STAGES = [
  'developing',
  'dev-validated',
  'frozen',
  'queued',
  'validating',
  'pr-pending',
  'merged',
  'main-verified',
  'handoff-verified',
  'closed',
  'blocked',
];
const git = (root, ...args) =>
  execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
function safe(file) {
  try {
    assert.ok(!lstatSync(file).isSymbolicLink(), 'Registry path must not be a symlink: ' + file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
function read(file) {
  safe(file);
  return JSON.parse(readFileSync(file, 'utf8'));
}
// This lock serializes only synchronous registry metadata updates. Normal live
// contention waits for the writer to release its own nonce; no lock is stolen
// or removed because of age, missing metadata, an ended PID or a timeout.
export function withTaskRegistryWriteLock(directory, operation, dependencies = {}) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const system = {
    now: () => performance.now(),
    pause: () => Atomics.wait(sleeper, 0, 0, 10),
    alive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
      }
    },
    timeoutMs: 30_000,
    publicationMs: 1_000,
    ...dependencies,
  };
  assert.ok(Number.isFinite(system.timeoutMs) && system.timeoutMs >= 0 && system.timeoutMs <= 30_000);
  assert.ok(Number.isFinite(system.publicationMs) && system.publicationMs > 0 && system.publicationMs <= 1_000);
  const lock = path.join(directory, 'write.lock'),
    ownerFile = path.join(lock, 'owner.json');
  const startedAt = system.now();
  let unknownSince = null;
  for (;;) {
    safe(directory);
    safe(lock);
    safe(ownerFile);
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try {
        owner = read(ownerFile);
      } catch (failure) {
        if (failure.code !== 'ENOENT' && !(failure instanceof SyntaxError)) throw failure;
        unknownSince ??= system.now();
        assert.ok(
          system.now() - unknownSince < system.publicationMs,
          'Task registry is locked with incomplete ownership; preserve existing writer',
        );
      }
      if (owner) {
        unknownSince = null;
        assert.ok(
          Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.token === 'string' && owner.token,
          'Task registry is locked with invalid ownership; preserve it',
        );
        assert.notEqual(owner.pid, process.pid, 'Task registry is locked by this process; do not enter it recursively');
        if (!system.alive(owner.pid)) {
          // The observed writer may have released and another writer may now
          // own this directory. Recheck the current nonce before diagnosing it.
          if (!existsSync(lock)) continue;
          safe(lock);
          safe(ownerFile);
          let current;
          try {
            current = read(ownerFile);
          } catch (failure) {
            if (failure.code !== 'ENOENT' && !(failure instanceof SyntaxError)) throw failure;
          }
          if (current?.pid === owner.pid && current?.token === owner.token)
            throw new Error('Task registry is locked by an ended writer; preserve its original evidence', {
              cause: error,
            });
          assert.ok(
            system.now() - startedAt < system.timeoutMs,
            'Registry ownership kept changing; preserve current writer',
          );
          system.pause(current ?? null);
          continue;
        }
      }
      assert.ok(
        system.now() - startedAt < system.timeoutMs,
        'Task registry is locked by a live writer; bounded wait expired without taking over',
      );
      system.pause(owner ?? null);
    }
  }
  const token = randomUUID();
  writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
  try {
    return operation();
  } finally {
    const owner = read(ownerFile);
    assert.equal(owner.token, token, 'Registry lock ownership changed');
    assert.equal(owner.pid, process.pid, 'Registry lock process changed');
    unlinkSync(ownerFile);
    rmdirSync(lock);
  }
}
function id(value) {
  assert.ok(typeof value === 'string' && value.length <= 64 && ID.test(value), 'Explicit valid task id required');
  return value;
}
export function registeredTaskWorktrees(root) {
  return execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain', '-z'], { encoding: 'utf8' })
    .split('\0\0')
    .filter(Boolean)
    .map((block) => {
      const rows = block.split('\0');
      return {
        worktree: rows.find((x) => x.startsWith('worktree '))?.slice(9),
        branch: rows
          .find((x) => x.startsWith('branch '))
          ?.slice(7)
          .replace(/^refs\/heads\//, ''),
      };
    });
}
export function parallelTaskMode(root) {
  if (createTaskRegistry(root).list().length) return true;
  const main = registeredTaskWorktrees(root).find((item) => item.branch === 'main');
  const file = main && path.join(main.worktree, '.codex/zdm-project-workflow.yaml');
  return Boolean(file && existsSync(file) && /^\s*mode: parallel-independent\s*$/m.test(readFileSync(file, 'utf8')));
}
function shape(record) {
  assert.equal(record.version, 2, 'Unknown task registry schema');
  id(record.id);
  assert.ok(['business', 'infrastructure', 'maintenance'].includes(record.kind), 'Unknown task kind');
  assert.ok(TASK_STAGES.includes(record.stage), 'Unknown task stage');
  assert.ok(Number.isSafeInteger(record.revision) && record.revision > 0, 'Invalid task revision');
  assert.ok(
    path.isAbsolute(record.worktree) && path.isAbsolute(record.repository.commonDir),
    'Invalid repository identity',
  );
  assert.ok(
    record.branch.startsWith('codex/') &&
      !['codex/integration-current', 'codex/preview-current'].includes(record.branch),
    'Invalid task branch',
  );
  assert.ok(typeof record.owner === 'string' && record.owner.trim(), 'Explicit task owner required');
  for (const k of ['originMain', 'base', 'startHead', 'recordedHead'])
    assert.match(record[k], SHA, 'Invalid source identity: ' + k);
  assert.ok(
    Array.isArray(record.dependsOn) && new Set(record.dependsOn).size === record.dependsOn.length,
    'Invalid task dependencies',
  );
  record.dependsOn.forEach(id);
  assert.ok(!record.dependsOn.includes(record.id), 'Task cannot depend on itself');
  return record;
}
export function createTaskRegistry(root) {
  root = realpathSync(root);
  const commonDir = realpathSync(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')));
  const directory = path.join(commonDir, 'task-registry'),
    tasks = path.join(directory, 'tasks');
  function guarded() {
    safe(directory);
    safe(tasks);
  }
  function readTask(taskId) {
    guarded();
    const file = path.join(tasks, id(taskId) + '.json');
    if (!existsSync(file)) return null;
    const record = shape(read(file));
    assert.equal(record.id, taskId, 'Task filename and identity differ');
    assert.equal(record.repository.commonDir, commonDir, 'Task belongs to another repository');
    return record;
  }
  function list() {
    guarded();
    if (!existsSync(tasks)) return [];
    return readdirSync(tasks)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => readTask(name.slice(0, -5)));
  }
  function locked(operation) {
    guarded();
    mkdirSync(tasks, { recursive: true, mode: 0o700 });
    return withTaskRegistryWriteLock(directory, operation);
  }
  function write(record) {
    shape(record);
    const file = path.join(tasks, record.id + '.json');
    safe(file);
    const temporary = path.join(tasks, record.id + '.' + randomUUID() + '.tmp');
    try {
      writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      renameSync(temporary, file);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return record;
  }
  function validateLive(record) {
    shape(record);
    assert.equal(record.repository.commonDir, commonDir);
    assert.ok(existsSync(record.worktree), 'Task worktree is missing; preserve recovery records');
    assert.equal(realpathSync(record.worktree), record.worktree, 'Task path changed');
    const entry = registeredTaskWorktrees(root).find(
      (x) => x.worktree && existsSync(x.worktree) && realpathSync(x.worktree) === record.worktree,
    );
    assert.ok(entry && entry.branch === record.branch, 'Task worktree registration or branch changed');
    assert.equal(git(record.worktree, 'branch', '--show-current'), record.branch, 'Task branch changed');
    assert.equal(
      realpathSync(path.resolve(record.worktree, git(record.worktree, 'rev-parse', '--git-common-dir'))),
      commonDir,
    );
    git(record.worktree, 'merge-base', '--is-ancestor', record.recordedHead, 'HEAD');
    git(record.worktree, 'merge-base', '--is-ancestor', record.base, 'HEAD');
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply'])
      assert.ok(
        !existsSync(path.resolve(record.worktree, git(record.worktree, 'rev-parse', '--git-path', marker))),
        'Git operation remains active',
      );
    assert.equal(git(record.worktree, 'ls-files', '--unmerged'), '', 'Unresolved Git conflicts');
    return record;
  }
  function legacy() {
    const parent = path.join(commonDir, 'task-batches'),
      file = path.join(parent, 'active.json');
    safe(parent);
    if (!existsSync(file)) return null;
    const record = read(file);
    assert.equal(record.version, 1, 'Unknown legacy schema');
    id(record.id);
    assert.equal(realpathSync(record.repository.commonDir), commonDir, 'Legacy task belongs to another repository');
    assert.ok(path.isAbsolute(record.worktree) && typeof record.branch === 'string', 'Invalid legacy identity');
    return record;
  }
  function inspectLegacy() {
    const record = legacy();
    if (!record) return null;
    const file = path.join(commonDir, 'task-batches', 'active.json');
    const acceptance = path.join(commonDir, 'task-delivery', record.id, 'accepted-source.json');
    safe(path.dirname(acceptance));
    safe(acceptance);
    const bytes = readFileSync(file);
    const acceptanceBytes = existsSync(acceptance) ? readFileSync(acceptance) : null;
    return {
      record,
      recordDigest: createHash('sha256').update(bytes).digest('hex'),
      frozen: !!acceptanceBytes,
      acceptanceDigest: acceptanceBytes ? createHash('sha256').update(acceptanceBytes).digest('hex') : null,
    };
  }
  function preserveLegacy({ expectedRecordDigest, expectedAcceptanceDigest = null }) {
    assert.match(expectedRecordDigest ?? '', /^[a-f0-9]{64}$/, 'Exact reviewed legacy digest required');
    return locked(() => {
      const parent = path.join(commonDir, 'task-batches');
      safe(parent);
      assert.ok(existsSync(parent), 'No legacy registry');
      const lock = path.join(parent, 'write.lock');
      try {
        mkdirSync(lock, { mode: 0o700 });
      } catch {
        throw Error('Legacy registry is locked; do not take over');
      }
      try {
        const proof = inspectLegacy();
        assert.ok(proof, 'Legacy task is absent');
        assert.equal(proof.recordDigest, expectedRecordDigest, 'Legacy registry changed since review');
        assert.equal(proof.acceptanceDigest, expectedAcceptanceDigest, 'Legacy frozen source changed since review');
        const old = proof.record;
        const existing = readTask(old.id);
        if (existing) {
          assert.equal(
            existing.compatibility?.recordDigest,
            expectedRecordDigest,
            'Another task already owns legacy id',
          );
          return existing;
        }
        assert.ok(
          !list().some((x) => x.worktree === old.worktree || x.branch === old.branch),
          'Another task already owns legacy worktree/branch',
        );
        const now = new Date().toISOString();
        const record = {
          version: 2,
          id: old.id,
          kind: old.kind,
          owner: old.owner || 'legacy-record:' + old.id,
          worktree: old.worktree,
          branch: old.branch,
          repository: { commonDir },
          originMain: old.originMain,
          base: old.base,
          startHead: old.startHead,
          recordedHead: old.recordedHead,
          stage: proof.frozen ? 'frozen' : 'blocked',
          revision: 1,
          dependsOn: [],
          resources: {},
          checkpoints: [],
          createdAt: now,
          updatedAt: now,
          remoteFreshnessProven: false,
          compatibility: {
            readOnly: true,
            ownerBinding: 'not-inferred',
            recordDigest: proof.recordDigest,
            acceptanceDigest: proof.acceptanceDigest,
            originalRecord: old,
            frozen: proof.frozen,
            originalDeliveryDirectory: path.join(commonDir, 'task-delivery', old.id),
          },
        };
        shape(record);
        const archive = path.join(directory, 'legacy-evidence');
        safe(archive);
        mkdirSync(archive, { recursive: true, mode: 0o700 });
        const saved = path.join(archive, old.id + '-' + proof.recordDigest + '.json');
        safe(saved);
        const bytes = readFileSync(path.join(parent, 'active.json'));
        if (existsSync(saved)) assert.deepEqual(readFileSync(saved), bytes, 'Conflicting historical record');
        else writeFileSync(saved, bytes, { flag: 'wx', mode: 0o600 });
        assert.equal(inspectLegacy().recordDigest, expectedRecordDigest, 'Legacy registry changed during preservation');
        assert.equal(
          inspectLegacy().acceptanceDigest,
          expectedAcceptanceDigest,
          'Frozen source changed during preservation',
        );
        return write(record);
      } finally {
        rmdirSync(lock);
      }
    });
  }
  function register({ id: taskId, worktree, owner, kind = 'business', dependsOn = [] }) {
    id(taskId);
    assert.ok(typeof owner === 'string' && owner.trim(), 'Explicit task owner required');
    const target = realpathSync(worktree);
    return locked(() => {
      const existing = readTask(taskId);
      if (existing) {
        assert.equal(existing.worktree, target, 'Task id already belongs to another worktree');
        assert.equal(existing.owner, owner, 'Task id already belongs to another owner');
        assert.equal(existing.kind, kind, 'Existing task kind cannot be silently changed');
        assert.deepEqual(existing.dependsOn, dependsOn, 'Existing task dependencies require an explicit update');
        return validateLive(existing);
      }
      const branch = git(target, 'branch', '--show-current');
      const other = list().find((x) => x.worktree === target || x.branch === branch);
      assert.ok(!other, 'Worktree or branch already belongs to another task');
      const old = legacy();
      assert.ok(
        !old || (old.id !== taskId && old.worktree !== target && old.branch !== branch),
        'Legacy task identity requires explicit preserved migration',
      );
      assert.ok(git(target, 'branch', '--show-current') !== 'main', 'Cannot develop in main');
      for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply'])
        assert.ok(
          !existsSync(path.resolve(target, git(target, 'rev-parse', '--git-path', marker))),
          'Git operation remains active',
        );
      assert.equal(git(target, 'ls-files', '--unmerged'), '', 'Unresolved Git conflicts');
      const head = git(target, 'rev-parse', 'HEAD'),
        originMain = git(root, 'rev-parse', 'refs/remotes/origin/main');
      const record = {
        version: 2,
        id: taskId,
        kind,
        owner,
        worktree: target,
        branch,
        repository: { commonDir },
        originMain,
        base: git(target, 'merge-base', head, originMain),
        startHead: head,
        recordedHead: head,
        stage: 'developing',
        revision: 1,
        dependsOn,
        resources: { dataScope: 'isolated-task' },
        checkpoints: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        remoteFreshnessProven: false,
      };
      for (const dependency of dependsOn) assert.ok(readTask(dependency), 'Unknown task dependency: ' + dependency);
      validateLive(record);
      return write(record);
    });
  }
  function resolve({ id: taskId, worktree } = {}) {
    let record;
    if (taskId) record = readTask(taskId);
    else if (worktree) {
      const target = realpathSync(worktree);
      const matches = list().filter((x) => x.worktree === target);
      assert.equal(matches.length, 1, 'Exact task context required; do not select a global task');
      record = matches[0];
    } else throw Error('Explicit task id or worktree required; preview selection is not task ownership');
    assert.ok(record, 'Task is not registered');
    assert.ok(
      !record.compatibility?.readOnly,
      'Legacy record is read-only; use its reviewed recovery without redirecting another task',
    );
    if (worktree) assert.equal(record.worktree, realpathSync(worktree), 'Requested task and worktree differ');
    return validateLive(record);
  }
  function revise(taskId, expectedRevision, change) {
    return locked(() => {
      const record = readTask(taskId);
      assert.ok(record && !record.compatibility?.readOnly, 'Exact writable task required');
      assert.equal(record.revision, expectedRevision, 'Task revision changed; reload before updating');
      const identities = [
        'id',
        'version',
        'kind',
        'owner',
        'worktree',
        'branch',
        'repository',
        'originMain',
        'base',
        'startHead',
        'createdAt',
      ];
      const before = Object.fromEntries(identities.map((key) => [key, structuredClone(record[key])]));
      const frozen = record.frozen ? structuredClone(record.frozen) : null;
      change(record);
      if (frozen) assert.deepEqual(record.frozen, frozen, 'Original accepted-source identity is immutable');
      assert.deepEqual(
        Object.fromEntries(identities.map((key) => [key, record[key]])),
        before,
        'Task identity and original baseline are immutable',
      );
      record.revision += 1;
      record.updatedAt = new Date().toISOString();
      return write(record);
    });
  }
  return {
    root,
    commonDir,
    directory,
    readTask,
    list,
    resolve,
    register,
    revise,
    validateLive,
    legacy,
    inspectLegacy,
    preserveLegacy,
  };
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  const [command, ...rest] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log(
      'Usage: task:registry list --json | status --task <id> | resolve --task <id> [--worktree <path>] | register --task <id> --worktree <path> --owner <owner> [--kind business|infrastructure|maintenance] | inspect-legacy | preserve-legacy --expected-record <sha256> [--expected-acceptance <sha256>]',
    );
    return;
  }
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    assert.ok(key.startsWith('--') && !Object.hasOwn(options, key.slice(2)), 'Invalid or duplicate task option');
    if (key === '--json') options.json = true;
    else {
      assert.ok(rest[i + 1] && !rest[i + 1].startsWith('--'), 'Missing task option value');
      options[key.slice(2)] = rest[++i];
    }
  }
  const allowed = {
    list: ['json'],
    status: ['task'],
    resolve: ['task', 'worktree'],
    register: ['task', 'worktree', 'owner', 'kind'],
    'inspect-legacy': [],
    'preserve-legacy': ['expected-record', 'expected-acceptance'],
  };
  assert.ok(allowed[command], 'Unknown task registry command');
  for (const key of Object.keys(options)) assert.ok(allowed[command].includes(key), 'Unknown task option: ' + key);
  const registry = createTaskRegistry(root);
  let result;
  if (command === 'inspect-legacy') result = registry.inspectLegacy();
  else if (command === 'preserve-legacy')
    result = registry.preserveLegacy({
      expectedRecordDigest: options['expected-record'],
      expectedAcceptanceDigest: options['expected-acceptance'] ?? null,
    });
  else if (command === 'list') result = { version: 2, tasks: registry.list(), legacy: registry.legacy() };
  else if (command === 'status') {
    id(options.task);
    result = registry.readTask(options.task);
  } else if (command === 'resolve') result = registry.resolve({ id: options.task, worktree: options.worktree });
  else
    result = registry.register({
      id: options.task,
      worktree: options.worktree,
      owner: options.owner,
      ...(options.kind ? { kind: options.kind } : {}),
    });
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
