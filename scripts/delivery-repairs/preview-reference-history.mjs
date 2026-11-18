import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync, openSync, closeSync, fstatSync, constants, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const referenceHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function referenceFileStat(file) {
  const absolute = path.resolve(file);
  assert.equal(realpathSync(absolute), absolute, 'Linked reference evidence');
  const stat = lstatSync(absolute);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o022, 0, 'Writable reference evidence');
  return stat;
}
export function regularReferenceFile(file) {
  const stat = referenceFileStat(file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    assert.equal(String(before.ino), String(stat.ino));
    assert.equal(String(before.dev), String(stat.dev));
    assert.equal(before.nlink, 1n);
    assert.equal(before.uid, BigInt(process.getuid()));
    assert.equal(before.mode & 0o022n, 0n);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    for (const key of ['ino', 'dev', 'nlink', 'mode', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'])
      assert.equal(after[key], before[key], 'Evidence changed during read: ' + key);
    assert.equal(String(referenceFileStat(file).ino), String(before.ino), 'Evidence replaced during read');
    return { bytes, stat, exactStat: before };
  } finally {
    closeSync(fd);
  }
}

// This snapshot is prepared by the host from the previously published Git
// object. This reader neither creates it nor accepts a caller-supplied observer.
export function verifyPublishedReferenceSnapshot(anchor, directory, commit) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  const git = (...args) =>
    execFileSync('git', ['--no-optional-locks', '-C', anchor, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main');
  assert.equal(realpathSync(directory), path.resolve(directory), 'Linked published observer snapshot');
  const expected = git('ls-tree', '-rz', commit)
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const parsed = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(entry);
      assert.ok(parsed, 'Unknown published source entry');
      assert.ok(!path.isAbsolute(parsed[3]) && !parsed[3].split('/').some((p) => p === '..' || p === '.'));
      return { mode: parsed[1], blob: parsed[2], file: parsed[3] };
    });
  const actual = [],
    directories = [];
  const visit = (root, relative = '') => {
    const stat = lstatSync(root);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(stat.uid, process.getuid());
    assert.equal(stat.mode & 0o222, 0, 'Published observer directory is writable');
    directories.push(relative);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), 'Linked published source');
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) visit(path.join(root, entry.name), name);
      else {
        assert.ok(entry.isFile());
        actual.push(name);
      }
    }
  };
  visit(directory);
  const expectedDirectories = new Set(['']);
  for (const { file } of expected) {
    const parts = file.split('/');
    for (let length = 1; length < parts.length; length++) expectedDirectories.add(parts.slice(0, length).join('/'));
  }
  assert.deepEqual(directories.sort(), [...expectedDirectories].sort(), 'Published snapshot has unknown directories');
  assert.deepEqual(
    actual.sort(),
    expected.map((e) => e.file).sort(),
    'Published snapshot has missing or untracked source',
  );
  for (const entry of expected) {
    const { bytes, stat } = regularReferenceFile(path.join(directory, entry.file));
    assert.equal(stat.mode & 0o222, 0, 'Published observer source is writable');
    assert.equal(Boolean(stat.mode & 0o111), entry.mode === '100755');
    assert.equal(
      createHash('sha1')
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest('hex'),
      entry.blob,
      'Published observer blob mismatch: ' + entry.file,
    );
  }
  return { baseline: commit, tree: git('rev-parse', commit + '^{tree}'), directory, files: expected.length };
}

export function nativeOutputObjects(output) {
  const values = [];
  // Parse complete top-level JSON outputs, never a substring/regex "safe" flag.
  for (let offset = 0; offset < output.length; offset++) {
    if (output[offset] !== '{' || (offset && output[offset - 1] !== '\n')) continue;
    let quoted = false,
      escaped = false,
      depth = 0;
    for (let end = offset; end < output.length; end++) {
      const c = output[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          values.push(JSON.parse(output.slice(offset, end + 1)));
        } catch {
          /* Not a complete native JSON output. */
        }
        offset = end;
        break;
      }
    }
  }
  return values;
}

export function readNativePreviewHistory(file, { task, worker, port, backendPort, anchor, head }) {
  const sessions = path.join(os.homedir(), '.codex/sessions') + path.sep;
  assert.ok(path.resolve(file).startsWith(sessions), 'History must be an actual native session');
  assert.ok(path.basename(file).endsWith('-' + worker + '.jsonl'), 'Foreign native worker history');
  const { bytes } = regularReferenceFile(file);
  return {
    file: path.resolve(file),
    ...parseNativePreviewHistory(bytes, { task, worker, port, backendPort, anchor, head }),
  };
}

export function parseNativePreviewHistory(bytes, { task, worker, port, backendPort, anchor, head }) {
  const events = [];
  let nativeIdentity = false;
  for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
    const record = JSON.parse(line);
    if (record.type === 'session_meta') nativeIdentity ||= record.payload?.id === worker;
    const item = record.type === 'event_msg' && record.payload?.item;
    if (record.payload?.type !== 'item_completed' || item?.type !== 'CommandExecution') continue;
    if (record.payload.thread_id !== worker || !['completed', 'failed'].includes(item.status)) continue;
    assert.ok(Number.isFinite(record.payload.started_at_ms) && Number.isFinite(record.payload.completed_at_ms));
    if (!Number.isInteger(item.exit_code)) continue;
    if (
      !Array.isArray(item.command) ||
      item.command.length !== 3 ||
      !['/bin/zsh', '/bin/bash'].includes(item.command[0]) ||
      !['-lc', '-c'].includes(item.command[1])
    )
      continue;
    if (!item.cwd || decodeURIComponent(new URL(item.cwd).pathname) !== anchor) continue;
    events.push({
      id: item.id,
      command: item.command[2],
      code: item.exit_code,
      startedAt: record.payload.started_at_ms,
      finishedAt: record.payload.completed_at_ms,
      objects: nativeOutputObjects(item.aggregated_output ?? ''),
      digest: referenceHash(line),
      original: record,
    });
  }
  assert.equal(nativeIdentity, true, 'Native session identity absent');
  const command = (action) => `npm run task:entry -- --worktree ${task.worktree} preview ${action} --task ${task.id}`;
  const ready = (value) =>
    value.task === task.id &&
    value.worktree === task.worktree &&
    value.branch === task.branch &&
    value.runtimeReady === true &&
    value.previews?.length === 1 &&
    value.previews[0].port === port &&
    value.previews[0].api === `http://127.0.0.1:${backendPort}` &&
    value.previews[0].runtimeReady === true &&
    Array.isArray(value.previews[0].errors) &&
    value.previews[0].errors.length === 0;
  const starts = events.filter(
    (e) => e.command === command('start') && e.objects.some((v) => ready(v) && v.reused === false),
  );
  const checks = events.filter((e) => e.command === command('check') && e.code === 0 && e.objects.some(ready));
  const matches = [];
  for (const start of starts)
    for (const check of checks) {
      if (check.startedAt <= start.startedAt || check.finishedAt >= start.finishedAt) continue;
      const statuses = events.filter(
        (e) =>
          e.command === `npm run task:entry -- --worktree ${task.worktree} work status ${task.id}` &&
          e.code === 0 &&
          e.startedAt >= check.finishedAt &&
          e.finishedAt <= check.finishedAt + 60000 &&
          e.objects.some(
            (v) =>
              v.task === task.id &&
              v.currentHead === head &&
              v.recordedHead === head &&
              v.clean === true &&
              v.recordedHeadMatches === true,
          ),
      );
      if (statuses.length === 1) matches.push({ start, check, status: statuses[0] });
    }
  assert.equal(matches.length, 1, 'Unique ended native start/live check/clean source history required');
  const { start, check, status } = matches[0];
  assert.ok(start.finishedAt <= Date.now(), 'Native execution is not ended');
  return {
    task: task.id,
    worker,
    port,
    backendPort,
    head,
    startedAt: start.startedAt,
    checkedAt: check.finishedAt,
    finishedAt: start.finishedAt,
    originalExitCode: start.code,
    startDigest: start.digest,
    checkDigest: check.digest,
    statusDigest: status.digest,
    executionIds: [start.id, check.id, status.id],
    originals: [start.original, check.original, status.original],
  };
}
