import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { taskProjectName } from './dev-task.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function safe(file) {
  for (let p = file; ; p = path.dirname(p)) {
    try {
      assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked cancellation evidence refused');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (p === path.dirname(p)) break;
  }
}
function json(file) {
  safe(file);
  assert.ok(lstatSync(file).isFile(), 'Cancellation evidence must be a regular file');
  return JSON.parse(readFileSync(file, 'utf8'));
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  assert.ok(!result.error && result.status === 0 && !result.stderr?.trim(), `Live inventory unavailable: ${command}`);
  return result.stdout;
}
// lsof -F0 emits NUL-terminated fields, with newline-terminated process/file
// records. The mandatory f descriptor is structural, never a pathname. Newlines
// inside n fields are preserved; no trim/split-lines can reinterpret a filename.
export function parseCancellationOpenFiles(output) {
  assert.equal(typeof output, 'string', 'Unknown open-file inventory');
  const files = [],
    processes = new Set();
  let cursor = 0,
    pid = null,
    record = null;
  while (cursor < output.length) {
    if (output[cursor] === '\n') {
      assert.ok(
        record && (record.kind === 'process' || (record.name !== undefined && record.type !== undefined)),
        'Incomplete open-file record',
      );
      if (record.kind === 'file') {
        const opaque = record.name === '';
        assert.ok(
          !opaque || (['NPOLICY', 'NEXUS', 'PIPE'].includes(record.type) && /^\d+[rwu-]?$/.test(record.descriptor)),
          'Empty name for an unproven filesystem/object type',
        );
        files.push({ pid, descriptor: record.descriptor, type: record.type, name: record.name, opaque });
      }
      record = null;
      cursor++;
      continue;
    }
    const end = output.indexOf('\0', cursor);
    assert.ok(end >= cursor, 'Unterminated open-file field');
    const field = output.slice(cursor, end),
      tag = field[0],
      value = field.slice(1);
    cursor = end + 1;
    if (tag === 'p') {
      assert.ok(!record && /^[1-9][0-9]*$/.test(value), 'Invalid process record in open-file inventory');
      pid = Number(value);
      assert.ok(Number.isSafeInteger(pid) && !processes.has(pid), 'Duplicate/invalid open-file process');
      processes.add(pid);
      record = { kind: 'process' };
    } else if (tag === 'f') {
      assert.ok(!record && pid && value && !/[\r\n]/.test(value), 'Invalid file descriptor record');
      record = { kind: 'file', descriptor: value };
    } else if (tag === 't') {
      assert.ok(
        record?.kind === 'file' && record.type === undefined && /^[A-Za-z0-9_]+$/.test(value),
        'Unbound/duplicate/invalid open-file type',
      );
      record.type = value;
    } else if (tag === 'n') {
      assert.ok(record?.kind === 'file' && record.name === undefined, 'Unbound/duplicate open-file name');
      record.name = value;
    } else assert.fail('Unknown open-file inventory field');
  }
  assert.equal(record, null, 'Unterminated open-file record');
  assert.ok(files.length, 'Empty open-file inventory is not proof');
  return files;
}
// Read-only OS observations. CLI cannot supply/inject evidence or a "safe" boolean.
export function observeCancellationHost(exec = run, env = process.env) {
  const endpoint =
    env.DOCKER_HOST && !env.DOCKER_CONTEXT
      ? env.DOCKER_HOST
      : JSON.parse(exec('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
  assert.ok(
    typeof endpoint === 'string' && /^unix:\/\/\//.test(endpoint),
    'Docker endpoint is not a local Unix socket; remote host inventory is insufficient',
  );
  const processes = exec('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,command='])
    .trim()
    .split('\n')
    .map((line) => {
      const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      assert.ok(row, 'Unknown process inventory');
      return { pid: Number(row[1]), ppid: Number(row[2]), command: row[3] };
    });
  assert.ok(
    processes.some((p) => p.pid === process.pid),
    'Incomplete host process inventory',
  );
  const files = parseCancellationOpenFiles(exec('/usr/sbin/lsof', ['-nP', '-F0pftn']));
  const ids = exec('docker', ['ps', '-q', '--no-trunc']).trim().split(/\s+/).filter(Boolean);
  const containers = ids.map((id) => {
    assert.match(id, /^[a-f0-9]{64}$/);
    const line = exec('docker', [
      'inspect',
      '--format',
      '{{json .Id}}\t{{json .State.Running}}\t{{json .Config.Labels}}\t{{json .Mounts}}',
      id,
    ]);
    const values = line
      .trim()
      .split('\t')
      .map((v) => JSON.parse(v));
    assert.equal(values.length, 4);
    assert.equal(values[0], id);
    assert.equal(values[1], true);
    return { id, labels: values[2], mounts: values[3] };
  });
  const worktrees = exec('git', ['worktree', 'list', '--porcelain', '-z'])
    .split('\0\0')
    .filter(Boolean)
    .map((block) => {
      const rows = block.split('\0');
      const worktree = rows.find((row) => row.startsWith('worktree '))?.slice(9);
      const branch = rows.find((row) => row.startsWith('branch refs/heads/'))?.slice(18);
      assert.ok(
        worktree && path.isAbsolute(worktree) && path.normalize(worktree) === worktree,
        'Unknown Git worktree inventory',
      );
      return { worktree, branch };
    });
  assert.ok(worktrees.length, 'Missing Git worktree ownership inventory');
  return { processes, files, containers, worktrees, dockerEndpoint: endpoint };
}
function under(value, root) {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/^\/host_mnt\//, '/').replace(/ \(deleted\)$/, '');
  return normalized === root || normalized.startsWith(root + path.sep);
}
function references(value, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![a-zA-Z0-9_-])' + escaped + '(?![a-zA-Z0-9_-])').test(value);
}
function otherWorktreeTestProcess(process, snapshot, task) {
  // ps command text alone is ambiguous. A path argument is evidence of another
  // test only with a unique OS cwd, live Git registration and a same-worktree
  // Node --test ancestor. Unknown ownership retains the original refusal.
  const ownership = (pid) => {
    const cwd = snapshot.files.filter((file) => file.pid === pid && file.descriptor === 'cwd' && file.type === 'DIR');
    if (
      cwd.length !== 1 ||
      typeof cwd[0].name !== 'string' ||
      !path.isAbsolute(cwd[0].name) ||
      path.normalize(cwd[0].name) !== cwd[0].name ||
      cwd[0].name.endsWith(' (deleted)')
    )
      return null;
    const owners = (snapshot.worktrees ?? []).filter(
      (entry) =>
        typeof entry.worktree === 'string' &&
        path.isAbsolute(entry.worktree) &&
        path.normalize(entry.worktree) === entry.worktree &&
        entry.worktree !== task.worktree &&
        typeof entry.branch === 'string' &&
        entry.branch.startsWith('codex/') &&
        entry.branch !== task.branch &&
        under(cwd[0].name, entry.worktree),
    );
    return owners.length === 1 ? owners[0].worktree : null;
  };
  const argv = (command) =>
    typeof command === 'string' && !/["'`\\\r\n]/.test(command) ? command.trim().split(/\s+/) : [];
  const root = ownership(process.pid),
    args = argv(process.command);
  if (!root || path.basename(args[0] ?? '') !== 'node') return false;
  const matches = args.slice(1).filter((arg) => references(arg, task.id));
  if (
    !matches.length ||
    !matches.every((arg) => path.isAbsolute(arg) && path.normalize(arg) === arg && under(arg, root))
  )
    return false;
  const seen = new Set();
  let current = process;
  for (let depth = 0; current && depth < 32; depth++) {
    if (seen.has(current.pid) || ownership(current.pid) !== root) return false;
    seen.add(current.pid);
    const command = argv(current.command);
    if (path.basename(command[0] ?? '') !== 'node') return false;
    if (command.includes('--test')) return true;
    if (!Number.isSafeInteger(current.ppid) || current.ppid <= 1) return false;
    current = snapshot.processes.find((parent) => parent.pid === current.ppid);
  }
  return false;
}
export function assertHostIdle(snapshot, task) {
  assert.ok(
    Array.isArray(snapshot.processes) &&
      snapshot.processes.length &&
      Array.isArray(snapshot.files) &&
      snapshot.files.length &&
      Array.isArray(snapshot.containers),
    'Incomplete live host observation',
  );
  const ignored = new Set([process.pid]);
  // Only the actual official wrapper ancestors of this read-only command are ignored.
  let parent = snapshot.processes.find((p) => p.pid === process.pid)?.ppid;
  for (let n = 0; parent && n < 32; n++) {
    const p = snapshot.processes.find((p) => p.pid === parent);
    if (!p || !/task-(entry|execution-order-cli)\.mjs/.test(p.command) || !p.command.includes('cancel')) break;
    ignored.add(parent);
    parent = p.ppid;
  }
  for (const p of snapshot.processes) {
    assert.ok(Number.isSafeInteger(p.pid) && typeof p.command === 'string');
    if (!ignored.has(p.pid))
      assert.ok(
        !references(p.command, task.worktree) &&
          (!references(p.command, task.id) || otherWorktreeTestProcess(p, snapshot, task)),
        'Task process or unresolved task command remains active',
      );
  }
  // Even the caller must be outside the target worktree. Includes cwd, executable,
  // open logs and deleted-but-open paths rather than only a process-name grep.
  for (const f of snapshot.files) assert.ok(!under(f.name, task.worktree), 'Task files/cwd remain open');
  const project = taskProjectName({ root: task.worktree, branch: task.branch });
  for (const c of snapshot.containers) {
    assert.ok(c && c.labels && Array.isArray(c.mounts), 'Unknown container ownership');
    assert.ok(
      !Object.values(c.labels).some((v) => v === task.id || v === project || under(v, task.worktree)) &&
        !c.mounts.some((m) => under(m.Source, task.worktree)),
      'Task container remains active',
    );
  }
}
function localEvidence(registry, task) {
  const common = registry.commonDir,
    base = path.join(common, 'task-registry');
  const evidence = [];
  const add = (file) => {
    const value = json(file);
    evidence.push({ file, digest: hash(value) });
    return value;
  };
  const leases = path.join(base, 'resource-leases');
  safe(leases);
  if (existsSync(leases))
    for (const name of readdirSync(leases)) {
      const lease = add(path.join(leases, name, 'owner.json'));
      assert.ok(
        typeof lease.task === 'string' &&
          lease.resource === name &&
          typeof lease.token === 'string' &&
          lease.token &&
          Number.isSafeInteger(lease.pid) &&
          lease.pid > 1,
        'Unknown resource owner',
      );
      assert.ok(lease.task !== task.id && lease.task !== task.owner, 'Original task/owner resource lease retained');
    }
  const intent = path.join(base, 'start-intents', task.id + '.json');
  assert.ok(existsSync(intent), 'Original formal start intent missing; cancellation identity unknown');
  const start = add(intent);
  for (const key of ['owner', 'branch', 'worktree'])
    assert.equal(start[key], task[key], 'Original start identity differs');
  assert.equal(start.task, task.id);
  assert.equal(start.state, 'registered', 'Unfinished start intent retained');
  assert.ok(
    !existsSync(path.join(common, 'task-delivery', task.id, 'completion-session.json')),
    'Formal delivery session exists; remote CI/hand-off termination is not proven by local inventory',
  );
  const deliveryQueue = path.join(base, 'delivery-queue.json');
  if (existsSync(deliveryQueue)) {
    const queue = add(deliveryQueue);
    assert.ok(Array.isArray(queue.tickets));
    assert.ok(!queue.tickets.some((t) => t.task === task.id), 'Task remains in formal main resource queue');
  }
  // Retained locks and launch journals are not removed or reinterpreted. Unknown
  // legacy process ownership blocks cancellation, regardless of PID age.
  for (const directory of [
    path.join(task.worktree, '.task-verification'),
    path.join(task.worktree, '.task-runtime'),
    path.join(common, 'task-delivery', task.id),
  ]) {
    const visit = (folder) => {
      safe(folder);
      if (!existsSync(folder)) return;
      for (const name of readdirSync(folder)) {
        const file = path.join(folder, name);
        safe(file);
        assert.ok(!name.endsWith('.lock'), 'Retained lock requires original ownership resolution; no cancellation');
        if (lstatSync(file).isDirectory()) visit(file);
        else if (/^process-.*\.json$/.test(name)) {
          const record = add(file);
          assert.equal(record.status, 'quiescent', 'Unsealed original launch journal; no cancellation');
          assert.equal(record.host, os.hostname(), 'Launch belongs to another host');
          assert.ok(record.token && Number.isSafeInteger(record.pgid));
        }
      }
    };
    visit(directory);
  }
  return evidence;
}
export function verifyCancellation(registry, ticket, { observe = observeCancellationHost } = {}) {
  assert.equal(ticket.status, 'blocked', 'Cancellation requires fenced blocked admission');
  const task = registry.readTask(ticket.task);
  assert.ok(
    task && task.id === ticket.task && task.owner === ticket.owner,
    'Exact registered original identity required',
  );
  assert.equal(task.repository.commonDir, registry.commonDir);
  assert.ok(path.isAbsolute(task.worktree) && task.branch && task.recordedHead, 'Incomplete original task identity');
  safe(task.worktree);
  const before = localEvidence(registry, task);
  const first = observe();
  assertHostIdle(first, task);
  const second = observe();
  assertHostIdle(second, task);
  assert.deepEqual(localEvidence(registry, task), before, 'Resource evidence changed during observation');
  assert.deepEqual(registry.readTask(ticket.task), task, 'Registry identity changed during observation');
  return {
    version: 1,
    task: ticket.task,
    lane: ticket.lane,
    owner: ticket.owner,
    admission: ticket.admission,
    outcome: 'quiescent',
    host: os.hostname(),
    observedAt: new Date().toISOString(),
    observationDigest: hash({ first, second, evidence: before, task }),
    sourcePresent: existsSync(task.worktree),
    originalHead: task.recordedHead,
    basis: 'blocked-admission+registered-start+fresh-host-open-files-processes-containers+unchanged-resource-evidence',
  };
}
