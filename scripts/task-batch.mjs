import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BATCH_VERSION = 1;
const KINDS = new Set(['business', 'infrastructure', 'maintenance']);
const STATUSES = new Set(['in-progress', 'ready', 'paused', 'excluded']);
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;

function demand(condition, message) {
  if (!condition) throw new Error(message);
}
function git(root, args, optional = false, input) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, input });
  if (result.status !== 0) {
    if (optional) return null;
    throw new Error(
      `Git query failed (${args[0]}): ${result.stderr?.trim() || result.error?.message || result.status}`,
    );
  }
  return result.stdout.trim();
}
function hasRef(root, name) {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', name], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Cannot prove reference absence: ${name}`);
}
function ref(root, name) {
  return git(root, ['rev-parse', '--verify', `${name}^{commit}`]);
}
// These facts live for one public operation only. Symbolic refs, worktrees and operation markers
// are always read again; only proofs tied to exact commit IDs can be shared before/after a metadata edit.
function commitFacts() {
  return { objects: new Map(), ancestors: new Map(), paths: new Map(), cache: true };
}
function refreshProofPolicy(commonDir, facts) {
  const packedRefs = path.join(commonDir, 'packed-refs');
  const modifiedGraph =
    ['GIT_REPLACE_REF_BASE', 'GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE'].some((name) => process.env[name] !== undefined) ||
    ['shallow', 'info/grafts', 'refs/replace'].some((name) => existsSync(path.join(commonDir, name))) ||
    (existsSync(packedRefs) && /(?:^|\n)[^\n]* refs\/replace\//.test(readFileSync(packedRefs, 'utf8')));
  if (modifiedGraph || !facts.cache) {
    facts.objects.clear();
    facts.ancestors.clear();
    facts.paths.clear();
  }
  facts.cache = !modifiedGraph;
}
function ancestor(root, commit, head, facts) {
  const key = `${commit}:${head}`;
  if (facts?.cache && facts.ancestors.has(key)) return facts.ancestors.get(key);
  const result = git(root, ['merge-base', '--is-ancestor', commit, head], true) !== null;
  facts?.ancestors.set(key, result);
  return result;
}
function commitObjects(root, commits, facts) {
  if (!facts.cache) facts.objects.clear();
  const pending = [...new Set(commits)].filter((commit) => !facts.objects.has(commit));
  if (pending.length) {
    const lines = git(
      root,
      ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
      false,
      `${pending.join('\n')}\n`,
    ).split('\n');
    demand(lines.length === pending.length, 'Cannot establish recorded commit objects');
    for (const [index, commit] of pending.entries()) facts.objects.set(commit, lines[index] === `${commit} commit`);
  }
}
function ancestryPath(root, base, head, facts) {
  const key = `${base}:${head}`;
  if (!facts.cache || !facts.paths.has(key)) {
    const commits = new Set(
      git(root, ['rev-list', '--ancestry-path', `${base}..${head}`])
        .split('\n')
        .filter(Boolean),
    );
    // For unrelated histories, --ancestry-path excludes head; do not pretend base belongs to its history.
    if (base === head || commits.has(head)) commits.add(base);
    facts.paths.set(key, commits);
  }
  return facts.paths.get(key);
}

function text(value, label, limit = 240) {
  demand(
    typeof value === 'string' &&
      value.trim() &&
      value.length <= limit &&
      !Array.from(value).some((character) => character.charCodeAt(0) < 32),
    `Invalid ${label}`,
  );
  return value.trim();
}
function id(value, label = 'id') {
  demand(typeof value === 'string' && ID.test(value), `Invalid ${label}`);
  return value;
}
function worktrees(root) {
  return git(root, ['worktree', 'list', '--porcelain'])
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      return {
        path: lines.find((line) => line.startsWith('worktree '))?.slice(9),
        branch:
          lines
            .find((line) => line.startsWith('branch '))
            ?.slice(7)
            .replace(/^refs\/heads\//, '') ?? null,
      };
    });
}
function repository(root, entries = worktrees(root)) {
  const commonDir = realpathSync(path.resolve(root, git(root, ['rev-parse', '--git-common-dir'])));
  const anchor = entries[0]?.path;
  demand(anchor && existsSync(anchor), 'Repository anchor is unavailable');
  return { commonDir, anchor: realpathSync(anchor) };
}
function registry(root) {
  return path.join(repository(root).commonDir, 'task-batches');
}
function noLink(file) {
  try {
    demand(!lstatSync(file).isSymbolicLink(), `Registry path must not be a symlink: ${file}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
function readJson(file) {
  noLink(file);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid batch record ${file}: ${error.message}`, { cause: error });
  }
}
function validateGraph(modules) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  demand(byId.size === modules.length, 'Duplicate module id');
  const visiting = new Set();
  const completed = new Set();
  function visit(module) {
    if (completed.has(module.id)) return;
    demand(!visiting.has(module.id), `Dependency cycle at ${module.id}`);
    visiting.add(module.id);
    for (const dependency of module.dependsOn) {
      demand(byId.has(dependency), `Missing dependency ${dependency} for ${module.id}`);
      visit(byId.get(dependency));
    }
    visiting.delete(module.id);
    completed.add(module.id);
  }
  for (const module of modules) visit(module);
}
function validateShape(record) {
  demand(record?.version === BATCH_VERSION, 'Unknown batch schema version');
  id(record.id, 'batch id');
  demand(KINDS.has(record.kind), 'Invalid batch kind');
  demand(record.owner === null || typeof record.owner === 'string', 'Invalid batch owner');
  demand(
    path.isAbsolute(record.worktree ?? '') &&
      path.isAbsolute(record.repository?.commonDir ?? '') &&
      path.isAbsolute(record.repository?.anchor ?? ''),
    'Invalid repository/worktree identity',
  );
  demand(
    typeof record.branch === 'string' &&
      record.branch.startsWith('codex/') &&
      record.branch !== 'codex/integration-current',
    'Invalid batch branch',
  );
  for (const field of ['originMain', 'base', 'startHead', 'recordedHead'])
    demand(SHA.test(record[field] ?? ''), `Invalid ${field}`);
  for (const field of ['createdAt', 'updatedAt'])
    demand(Number.isFinite(Date.parse(record[field])), `Invalid ${field}`);
  demand(Array.isArray(record.modules), 'Invalid modules list');
  const commits = new Set();
  for (const module of record.modules) {
    id(module.id, 'module id');
    text(module.title, 'module title');
    demand(
      STATUSES.has(module.status) && Array.isArray(module.dependsOn) && Array.isArray(module.checkpoints),
      'Invalid module state',
    );
    demand(new Set(module.dependsOn).size === module.dependsOn.length, 'Duplicate module dependency');
    for (const dependency of module.dependsOn) id(dependency, 'dependency');
    for (const checkpoint of module.checkpoints) {
      demand(SHA.test(checkpoint.commit ?? ''), 'Invalid checkpoint commit');
      demand(!commits.has(checkpoint.commit), `Commit belongs to multiple modules: ${checkpoint.commit}`);
      commits.add(checkpoint.commit);
      text(checkpoint.verification, 'verification note', 4000);
      demand(Number.isFinite(Date.parse(checkpoint.recordedAt)), 'Invalid checkpoint date');
    }
  }
  validateGraph(record.modules);
  return record;
}
function validateRepository(root, record, current = repository(root)) {
  validateShape(record);
  demand(
    current.commonDir === record.repository.commonDir && current.anchor === record.repository.anchor,
    'Batch belongs to another or relocated repository',
  );
}
function noGitOperation(root) {
  const markers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'];
  const paths = git(root, ['rev-parse', ...markers.flatMap((marker) => ['--git-path', marker])]).split('\n');
  demand(paths.length === markers.length, 'Cannot establish Git operation state');
  for (const [index, file] of paths.entries())
    demand(!existsSync(path.resolve(root, file)), `Git operation in progress: ${markers[index]}`);
  demand(!git(root, ['ls-files', '--unmerged']), 'Unresolved Git conflicts');
}

function validateHistory(root, record, head = record.recordedHead, facts = commitFacts()) {
  refreshProofPolicy(record.repository.commonDir, facts);
  const fields = ['originMain', 'base', 'startHead', 'recordedHead'];
  const checkpoints = record.modules.flatMap((module) => module.checkpoints.map((checkpoint) => checkpoint.commit));
  commitObjects(root, [...fields.map((field) => record[field]), ...checkpoints], facts);
  for (const field of fields) demand(facts.objects.get(record[field]), `Missing recorded ${field}`);
  const history = ancestryPath(root, record.base, head, facts);
  demand(
    ancestor(root, record.base, record.originMain, facts) && history.has(record.startHead),
    'Recorded base/start history no longer matches the batch',
  );
  demand(
    history.has(record.recordedHead) || ancestor(root, record.recordedHead, head, facts),
    'Branch was rewritten behind the recorded head',
  );
  for (const commit of checkpoints)
    demand(
      facts.objects.get(commit) && commit !== record.base && history.has(commit),
      `Checkpoint no longer belongs to batch history: ${commit}`,
    );
}

function readActive(root, current) {
  const directory = path.join(current.commonDir, 'task-batches');
  noLink(directory);
  const file = path.join(directory, 'active.json');
  noLink(file);
  if (!existsSync(file)) return null;
  const record = readJson(file);
  validateRepository(root, record, current);
  demand(!record.closedAt, 'Closed batch remains active; resolve the interrupted close explicitly');
  return record;
}
export function readActiveBatch(root) {
  return readActive(root, repository(root));
}

function validateActive(root, record, facts) {
  demand(record, 'No active batch');
  const entries = worktrees(root);
  const current = repository(root, entries);
  validateRepository(root, record, current);
  refreshProofPolicy(current.commonDir, facts);
  const registered = entries.find((entry) => entry.path === record.worktree);
  demand(
    registered && existsSync(record.worktree),
    'Registered batch worktree is missing; inspect delivery/cleanup before continuing',
  );
  demand(
    registered.branch === record.branch && git(record.worktree, ['branch', '--show-current']) === record.branch,
    'Registered batch worktree changed branch',
  );
  noGitOperation(record.worktree);
  demand(
    ancestor(root, record.base, ref(root, 'refs/remotes/origin/main'), facts),
    'Current origin/main no longer contains the registered batch base',
  );
  validateHistory(root, record, ref(root, `refs/heads/${record.branch}`), facts);
  return record;
}
export function validateActiveBatch(root, record) {
  return validateActive(root, record, commitFacts());
}

function atomicWrite(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
function withLock(root, operation) {
  const current = repository(root);
  const directory = path.join(current.commonDir, 'task-batches');
  noLink(directory);
  mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, 'write.lock');
  try {
    mkdirSync(lock);
  } catch {
    throw new Error(`Batch registry is locked: ${lock}; inspect an interrupted writer before retrying`);
  }
  try {
    return operation(directory, current);
  } finally {
    rmdirSync(lock);
  }
}
function saveActive(directory, record) {
  validateShape(record);
  atomicWrite(path.join(directory, 'active.json'), record);
  return record;
}
function changeBatch(root, change) {
  return withLock(root, (directory, current) => {
    const facts = commitFacts();
    const record = validateActive(root, readActive(root, current), facts);
    demand(realpathSync(root) === record.worktree, 'Modify batch metadata from its registered worktree');
    change(record, facts);
    record.recordedHead = ref(root, 'HEAD');
    record.updatedAt = new Date().toISOString();
    validateActive(root, record, facts);
    return saveActive(directory, record);
  });
}

function availableBatchId(batchId, current) {
  id(batchId, 'batch id');
  const directory = path.join(current.commonDir, 'task-batches');
  noLink(directory);
  const archive = path.join(directory, 'archive');
  noLink(archive);
  const file = path.join(archive, `${batchId}.json`);
  noLink(file);
  demand(!existsSync(file), `Batch id ${batchId} is already archived`);
  return batchId;
}
export function assertBatchIdAvailable(root, batchId) {
  id(batchId, 'batch id');
  return availableBatchId(batchId, repository(root));
}

export function registerBatch(root, { id: batchId, kind = 'business', owner = null }) {
  id(batchId, 'batch id');
  demand(KINDS.has(kind), 'Invalid batch kind');
  if (owner !== null) owner = text(owner, 'owner');
  return withLock(root, (directory, current) => {
    const existing = readActive(root, current);
    if (existing) {
      validateActiveBatch(root, existing);
      demand(
        existing.id === batchId &&
          existing.kind === kind &&
          existing.worktree === realpathSync(root) &&
          (owner === null || existing.owner === owner),
        `Active batch ${existing.id} already owns ${existing.worktree}; do not take it over`,
      );
      return existing;
    }
    const repo = current;
    const worktree = realpathSync(root);
    const branch = git(root, ['branch', '--show-current']);
    demand(
      branch.startsWith('codex/') && branch !== 'codex/integration-current',
      'Register a codex task branch, never main or integration',
    );
    demand(
      worktree !== repo.anchor && worktrees(root).some((entry) => entry.path === worktree && entry.branch === branch),
      'Register an isolated Git worktree',
    );
    noGitOperation(root);
    availableBatchId(batchId, current);
    const originMain = ref(root, 'refs/remotes/origin/main');
    const head = ref(root, 'HEAD');
    const base = git(root, ['merge-base', head, originMain]);
    const now = new Date().toISOString();
    return saveActive(directory, {
      version: BATCH_VERSION,
      id: batchId,
      kind,
      owner,
      repository: repo,
      worktree,
      branch,
      originMain,
      base,
      startHead: head,
      recordedHead: head,
      createdAt: now,
      updatedAt: now,
      modules: [],
    });
  });
}

export function upsertBatchModule(root, { id: moduleId, title, dependsOn }) {
  id(moduleId, 'module id');
  text(title, 'module title');
  if (dependsOn !== undefined) {
    demand(Array.isArray(dependsOn), 'Dependencies must be a list');
    for (const value of dependsOn) id(value, 'dependency');
  }
  return changeBatch(root, (record) => {
    const existing = record.modules.find((module) => module.id === moduleId);
    if (existing) {
      existing.title = title;
      if (dependsOn !== undefined) existing.dependsOn = [...dependsOn];
    } else
      record.modules.push({ id: moduleId, title, dependsOn: dependsOn ?? [], status: 'in-progress', checkpoints: [] });
    validateShape(record);
  });
}

export function setBatchModuleStatus(root, moduleId, status) {
  id(moduleId, 'module id');
  demand(STATUSES.has(status), 'Invalid module status');
  return changeBatch(root, (record) => {
    const module = record.modules.find((entry) => entry.id === moduleId);
    demand(module, `Unknown module ${moduleId}`);
    module.status = status;
  });
}

export function recordBatchCheckpoint(root, { moduleId, commit, verification }) {
  id(moduleId, 'module id');
  demand(/^[a-f0-9]{7,64}$/.test(commit ?? ''), 'Checkpoint must name an existing commit SHA');
  text(verification, 'verification note', 4000);
  return changeBatch(root, (record, facts) => {
    const module = record.modules.find((entry) => entry.id === moduleId);
    demand(module, `Unknown module ${moduleId}`);
    const sha = ref(root, commit);
    const head = ref(root, 'HEAD');
    demand(
      sha !== record.base && ancestor(root, record.base, sha, facts) && ancestor(root, sha, head, facts),
      'Checkpoint must be after the batch base and belong to the current branch',
    );
    const owner = record.modules.find((entry) => entry.checkpoints.some((checkpoint) => checkpoint.commit === sha));
    demand(!owner || owner.id === moduleId, `Commit already belongs to module ${owner?.id}`);
    const existing = module.checkpoints.find((checkpoint) => checkpoint.commit === sha);
    if (existing)
      demand(existing.verification === verification, 'Checkpoint note differs; preserve the original audit record');
    else module.checkpoints.push({ commit: sha, verification, recordedAt: new Date().toISOString() });
  });
}

function orderedModules(modules) {
  const result = [];
  const seen = new Set();
  const byId = new Map(modules.map((module) => [module.id, module]));
  const visit = (module) => {
    if (seen.has(module.id)) return;
    for (const dependency of module.dependsOn) visit(byId.get(dependency));
    seen.add(module.id);
    result.push(module);
  };
  for (const module of modules) visit(module);
  return result;
}

export function planBatchDelivery(root) {
  const record = validateActiveBatch(root, readActiveBatch(root));
  demand(
    !git(record.worktree, ['status', '--porcelain=v1', '--untracked-files=normal']),
    'Batch worktree must be clean before delivery planning',
  );
  const head = ref(root, `refs/heads/${record.branch}`);
  const originMain = ref(root, 'refs/remotes/origin/main');
  const commits = git(root, ['rev-list', '--reverse', `${record.base}..${head}`, '--not', originMain])
    .split('\n')
    .filter(Boolean);
  const owners = new Map(
    record.modules.flatMap((module) => module.checkpoints.map((checkpoint) => [checkpoint.commit, module.id])),
  );
  for (const commit of commits) demand(owners.has(commit), `Unassigned batch commit: ${commit}`);
  demand(record.modules.length, 'No batch modules have been registered');
  const included = [];
  for (const module of orderedModules(record.modules)) {
    const pending = module.checkpoints.filter((checkpoint) => !ancestor(root, checkpoint.commit, originMain));
    if (['paused', 'excluded'].includes(module.status)) {
      demand(
        !pending.length,
        `${module.status} module ${module.id} still contributes commits; changing status or adding a revert does not prove exclusion. Review the candidate and register the actual withdrawal/fix in a ready module`,
      );
      continue;
    }
    demand(module.status === 'ready', `Module ${module.id} is not ready`);
    demand(module.checkpoints.length, `Module ${module.id} has no checkpoint`);
    for (const dependency of module.dependsOn)
      demand(
        record.modules.find((entry) => entry.id === dependency)?.status === 'ready',
        `Module ${module.id} depends on a non-ready module ${dependency}`,
      );
    included.push({
      id: module.id,
      title: module.title,
      dependsOn: module.dependsOn,
      commits: module.checkpoints.map((checkpoint) => checkpoint.commit),
      verificationNotes: module.checkpoints.map((checkpoint) => checkpoint.verification),
    });
  }
  return {
    type: 'delivery-plan',
    batchId: record.id,
    branch: record.branch,
    worktree: record.worktree,
    base: record.base,
    head,
    originMain,
    commits,
    modules: included,
    verificationProven: false,
    requiredExternalChecks: [
      'Final candidate validation and CI',
      'Fresh remote synchronization and authorized main merge',
      'Runtime handoff and safe Git carrier cleanup',
    ],
  };
}

function readArchivedBatch(root, batchId) {
  id(batchId, 'batch id');
  const directory = path.join(registry(root), 'archive');
  noLink(directory);
  const record = readJson(path.join(directory, `${batchId}.json`));
  demand(record.id === batchId, 'Archive filename does not match its recorded batch id');
  validateRepository(root, record);
  demand(
    Number.isFinite(Date.parse(record.closedAt)) &&
      SHA.test(record.main?.local ?? '') &&
      record.main.local === record.main.remote,
    'Archive has no completed closure audit',
  );
  validateHistory(root, record);
  demand(
    ref(root, record.main.local) === record.main.local && ancestor(root, record.recordedHead, record.main.local),
    'Archived main audit does not contain the recorded batch head',
  );
  return record;
}

export function planBatchRollback(root, moduleId, batchId = null) {
  id(moduleId, 'module id');
  const record = batchId ? readArchivedBatch(root, batchId) : validateActiveBatch(root, readActiveBatch(root));
  demand(
    record.modules.some((module) => module.id === moduleId),
    `Unknown module ${moduleId}`,
  );
  const affected = new Set([moduleId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of record.modules)
      if (!affected.has(module.id) && module.dependsOn.some((dependency) => affected.has(dependency))) {
        affected.add(module.id);
        changed = true;
      }
  }
  const archived = Boolean(batchId);
  const head = archived ? record.recordedHead : ref(record.worktree, 'HEAD');
  const reverseHistory = git(root, ['rev-list', '--topo-order', `${record.base}..${head}`])
    .split('\n')
    .filter(Boolean);
  const assigned = new Set(
    record.modules.flatMap((module) => module.checkpoints.map((checkpoint) => checkpoint.commit)),
  );
  const selected = new Set(
    record.modules
      .filter((module) => affected.has(module.id))
      .flatMap((module) => module.checkpoints.map((checkpoint) => checkpoint.commit)),
  );
  const modules = orderedModules(record.modules)
    .filter((module) => affected.has(module.id))
    .reverse()
    .map((module) => {
      const owned = new Set(module.checkpoints.map((checkpoint) => checkpoint.commit));
      return {
        id: module.id,
        title: module.title,
        dependsOn: module.dependsOn,
        commits: reverseHistory.filter((commit) => owned.has(commit)),
      };
    });
  const unassignedCommits = archived
    ? []
    : git(root, ['rev-list', '--topo-order', `${record.base}..${head}`, '--not', ref(root, 'refs/remotes/origin/main')])
        .split('\n')
        .filter((commit) => commit && !assigned.has(commit));
  const workingTreeStatus = archived
    ? null
    : git(record.worktree, ['status', '--porcelain=v1', '--untracked-files=normal']);
  const warnings = [];
  if (unassignedCommits.length)
    warnings.push('Unassigned commits are present and are not included in the selected module checkpoint sets.');
  if (workingTreeStatus)
    warnings.push('Uncommitted or untracked changes are present and are not included in this rollback plan.');
  if (archived)
    warnings.push(
      'Archived scope contains registered checkpoints only; inspect current main and current working changes separately.',
    );
  return {
    type: 'rollback-plan',
    batchId: record.id,
    moduleId,
    base: record.base,
    head,
    recordedHead: record.recordedHead,
    archived,
    modules,
    commits: reverseHistory.filter((commit) => selected.has(commit)),
    commitOrder: 'Git reverse topological order; children before parents',
    unassignedCommits,
    dirty: archived ? null : Boolean(workingTreeStatus),
    workingTreeStatus,
    warnings,
    executed: false,
    note: 'Exact checkpoint sets only; do not blindly revert a contiguous range. Modules are listed dependents first for review; commits use Git order. Review migrations and data effects separately.',
  };
}

export function closeBatch(root) {
  return withLock(root, (directory, current) => {
    const record = readActive(root, current);
    demand(record, 'No active batch to close');
    const local = ref(root, 'refs/heads/main');
    const remote = ref(root, 'refs/remotes/origin/main');
    demand(local === remote, 'Local main and origin/main tracking SHA must match; this does not fetch remote state');
    noGitOperation(root);
    validateHistory(root, record);
    const commits = [
      record.recordedHead,
      ...record.modules.flatMap((module) => module.checkpoints.map((checkpoint) => checkpoint.commit)),
    ];
    for (const commit of commits) demand(ancestor(root, commit, local), `Recorded commit is not in main: ${commit}`);
    demand(
      !worktrees(root).some((entry) => entry.path === record.worktree) && !existsSync(record.worktree),
      'Registered task worktree has not been safely removed',
    );
    demand(!hasRef(root, `refs/heads/${record.branch}`), 'Task branch still exists');
    demand(!hasRef(root, `refs/remotes/origin/${record.branch}`), 'Remote-tracking task branch still exists');
    const closed = {
      ...record,
      closedAt: new Date().toISOString(),
      main: { local, remote, remoteFreshnessProven: false },
      closureNote:
        'Registry closure only; Git fetch, CI, merge authorization, runtime handoff and cleanup are proven by the delivery workflow.',
    };
    const archive = path.join(directory, 'archive');
    noLink(archive);
    mkdirSync(archive, { recursive: true });
    const file = path.join(archive, `${record.id}.json`);
    if (existsSync(file)) {
      const existing = readJson(file);
      const { closedAt, main, closureNote, ...original } = existing;
      demand(
        closedAt && main && closureNote && JSON.stringify(original) === JSON.stringify(record),
        'Conflicting archived batch',
      );
    } else atomicWrite(file, closed);
    unlinkSync(path.join(directory, 'active.json'));
    return closed;
  });
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    demand(key.startsWith('--') && !Object.hasOwn(options, key.slice(2)), `Invalid or duplicate option ${key}`);
    if (['--json', '--delivery'].includes(key)) options[key.slice(2)] = true;
    else {
      const value = args[++index];
      demand(value && !value.startsWith('--'), `Missing value for ${key}`);
      options[key.slice(2)] = value;
    }
  }
  return options;
}
function only(options, allowed) {
  for (const key of Object.keys(options)) demand(allowed.includes(key), `Unknown option --${key}`);
}
export function main(args = process.argv.slice(2), root = process.cwd()) {
  const command = args[0];
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log(
      `Usage: task-batch status [--json]\n  register --id batch-id [--kind business|infrastructure|maintenance] [--owner label]\n  module --id module-id --title title [--depends-on a,b]\n  module --id module-id --status in-progress|ready|paused|excluded\n  checkpoint --module module-id --commit existing-sha --verification note\n  plan --delivery\n  plan --rollback module-id [--batch archived-batch-id]\n  close\nSchema v1: one active registry per Git common dir, explicit modules/dependencies/checkpoints.\nNo command commits, fetches, pushes, merges, changes preview, rolls back, or deletes Git carriers. Verification notes are unproven descriptions, not passing test evidence.`,
    );
    return null;
  }
  const options = parseOptions(args.slice(1));
  let result;
  if (command === 'status') {
    only(options, ['json']);
    result = readActiveBatch(root);
    if (result) validateActiveBatch(root, result);
  } else if (command === 'register') {
    only(options, ['id', 'kind', 'owner']);
    result = registerBatch(root, options);
  } else if (command === 'module') {
    only(options, ['id', 'title', 'depends-on', 'status']);
    if (options.status) {
      demand(!options.title && !options['depends-on'], 'Status update cannot also redefine a module');
      result = setBatchModuleStatus(root, options.id, options.status);
    } else
      result = upsertBatchModule(root, {
        id: options.id,
        title: options.title,
        ...(options['depends-on'] !== undefined ? { dependsOn: options['depends-on'].split(',') } : {}),
      });
  } else if (command === 'checkpoint') {
    only(options, ['module', 'commit', 'verification']);
    result = recordBatchCheckpoint(root, {
      moduleId: options.module,
      commit: options.commit,
      verification: options.verification,
    });
  } else if (command === 'plan') {
    only(options, ['delivery', 'rollback', 'batch']);
    demand(Boolean(options.delivery) !== Boolean(options.rollback), 'Choose --delivery or --rollback');
    demand(!options.batch || options.rollback, '--batch is only for archived rollback plans');
    result = options.delivery ? planBatchDelivery(root) : planBatchRollback(root, options.rollback, options.batch);
  } else if (command === 'close') {
    only(options, []);
    result = closeBatch(root);
  } else throw new Error(`Unknown command ${command}`);
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
