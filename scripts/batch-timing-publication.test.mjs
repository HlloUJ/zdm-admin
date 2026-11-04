import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { newTimeline } from './batch-timing-core.mjs';
import { timingWriterLock, preserveTimingSnapshot, atomicTimingJson } from './batch-timing-io.mjs';
import {
  refreshTimeline,
  readTimeline,
  readTimingSummary,
  bindBatchTiming,
  recordValidationTiming,
  recordValidationInterruptions,
  timingRequiredFile,
} from './batch-timing-store.mjs';
const at = 1700000000000;
const digest = (b) => createHash('sha256').update(b).digest('hex');
const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function fixture(t, version = 1) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'timing-publication-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const common = path.join(root, '.git'),
    batch = 'example',
    directory = path.join(common, 'task-timing', batch);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const native = path.join(root, 'native.jsonl');
  fs.writeFileSync(native, '');
  const identity = fs.statSync(native);
  const state = newTimeline({
    batch,
    common,
    anchor: root,
    worktree: root,
    authorizedAt: at,
    requestId: 'original-request',
    thread: 'thread',
    initialTurn: 'one',
  });
  state.version = version;
  state.registeredAt = at + 10;
  state.sources = [
    {
      thread: 'thread',
      file: native,
      device: identity.dev,
      inode: identity.ino,
      offset: 0,
      verifiedOffset: 0,
      terminalReplayVersion: 1,
    },
  ];
  state.turns = [
    {
      thread: 'thread',
      id: 'one',
      startedAt: at,
      finishedAt: at + 1,
      termination: 'interrupted',
      projectVerified: true,
    },
  ];
  const timeline = path.join(directory, 'timeline.json'),
    summary = path.join(directory, 'summary.json');
  fs.writeFileSync(timeline, json(state));
  fs.writeFileSync(summary, json({ version: 1, timingVersion: 3, status: 'snapshot', wallMs: 513789049 }));
  const marker = timingRequiredFile(common, batch);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, json({ version: 1, batch, authorizedAt: at, requestId: state.requestId }));
  return {
    root,
    common,
    batch,
    directory,
    timeline,
    summary,
    marker,
    state,
    refresh: () => refreshTimeline(common, batch, { now: at + 100 }),
    read: () => readTimingSummary(common, batch),
  };
}
const ioError = () => Object.assign(new Error('injected I/O failure'), { code: 'EIO' });
function renameFailure(t, target, occurrence, after = false) {
  const original = fs.renameSync;
  let count = 0,
    triggered = false;
  const mock = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === target && ++count === occurrence) {
      triggered = true;
      if (after) original(from, to);
      throw ioError();
    }
    return original(from, to);
  });
  return { restore: () => mock.mock.restore(), fired: () => triggered };
}
for (const version of [1, 2]) {
  for (const kind of ['timeline', 'summary']) {
    test(`v${version} rejects an existing damaged ${kind} backup without upgrading or losing originals`, (t) => {
      const f = fixture(t, version),
        source = kind === 'timeline' ? f.timeline : f.summary;
      const originalTimeline = fs.readFileSync(f.timeline),
        originalSummary = fs.readFileSync(f.summary);
      const backup = path.join(f.directory, `${kind}-v${version}-${digest(fs.readFileSync(source))}.json`);
      fs.writeFileSync(backup, 'partial-backup');
      assert.throws(f.refresh, /snapshot differs/);
      assert.deepEqual(fs.readFileSync(f.timeline), originalTimeline);
      assert.deepEqual(fs.readFileSync(f.summary), originalSummary);
      assert.equal(fs.readFileSync(backup, 'utf8'), 'partial-backup');
      assert.equal(f.read().wallMs, null);
    });
  }
  for (const [name, target, occurrence] of [
    ['pending summary', 'summary.json', 1],
    ['timeline', 'timeline.json', 1],
    ['final summary', 'summary.json', 2],
    ['publication commit', 'publication.json', 1],
  ])
    for (const after of [false, true]) {
      test(`v${version} failure ${after ? 'after' : 'before'} ${name} never exposes obsolete totals and can resume`, (t) => {
        const f = fixture(t, version),
          marker = fs.readFileSync(f.marker);
        const fault = renameFailure(t, path.join(f.directory, target), occurrence, after);
        try {
          assert.throws(f.refresh, /injected I\/O failure/);
          assert.equal(fault.fired(), true);
        } finally {
          fault.restore();
        }
        assert.equal(f.read().wallMs, null);
        if (readTimeline(f.common, f.batch).version === 3)
          assert.equal(JSON.parse(fs.readFileSync(f.summary)).wallMs, null);
        const recovered = f.refresh();
        assert.equal(recovered.summary.wallMs, null);
        assert.equal(readTimeline(f.common, f.batch).version, 3);
        assert.equal(f.read().wallMs, null);
        assert.ok(f.read().issues.includes('authorization-turn-ended-before-registration'));
        assert.deepEqual(fs.readFileSync(f.marker), marker);
        assert.equal(f.refresh().summary.wallMs, null);
      });
    }
}
for (const target of ['timeline', 'summary'])
  for (const after of [false, true]) {
    test(`backup link failure ${after ? 'after' : 'before'} ${target} publication retains source and resumes with verified bytes`, (t) => {
      const f = fixture(t),
        original = fs.readFileSync(target === 'timeline' ? f.timeline : f.summary);
      const originalTimeline = fs.readFileSync(f.timeline),
        originalLink = fs.linkSync;
      let fired = false;
      const hook = t.mock.method(fs, 'linkSync', (from, to) => {
        if (!fired && path.basename(to).startsWith(target + '-v1-')) {
          fired = true;
          if (after) originalLink(from, to);
          throw ioError();
        }
        return originalLink(from, to);
      });
      try {
        assert.throws(f.refresh, /injected I\/O failure/);
        assert.equal(fired, true);
      } finally {
        hook.mock.restore();
      }
      assert.deepEqual(fs.readFileSync(f.timeline), originalTimeline);
      f.refresh();
      assert.deepEqual(fs.readFileSync(path.join(f.directory, target + '-v1-' + digest(original) + '.json')), original);
    });
  }
for (const action of ['partial-write', 'fsync-failure']) {
  test(`${action} cannot publish an unverified backup`, (t) => {
    const f = fixture(t),
      originalTimeline = fs.readFileSync(f.timeline),
      files = new Map();
    const open = fs.openSync,
      write = fs.writeFileSync,
      sync = fs.fsyncSync;
    let fired = false;
    const opened = t.mock.method(fs, 'openSync', (file, ...args) => {
      const fd = open(file, ...args);
      files.set(fd, String(file));
      return fd;
    });
    const writing = t.mock.method(fs, 'writeFileSync', (file, bytes, ...args) => {
      if (
        !fired &&
        action === 'partial-write' &&
        typeof file === 'number' &&
        files.get(file)?.includes('timeline-v1-')
      ) {
        fired = true;
        return write(file, Buffer.from(bytes).subarray(0, 5), ...args);
      }
      return write(file, bytes, ...args);
    });
    const syncing = t.mock.method(fs, 'fsyncSync', (fd) => {
      if (!fired && action === 'fsync-failure' && files.get(fd)?.includes('timeline-v1-')) {
        fired = true;
        throw ioError();
      }
      return sync(fd);
    });
    try {
      assert.throws(f.refresh, action === 'partial-write' ? /Incomplete timing write/ : /injected I\/O failure/);
      assert.equal(fired, true);
    } finally {
      syncing.mock.restore();
      writing.mock.restore();
      opened.mock.restore();
    }
    assert.deepEqual(fs.readFileSync(f.timeline), originalTimeline);
    assert.equal(f.read().wallMs, null);
    f.refresh();
  });
}
for (const name of ['timeline.json', 'summary.json', 'publication.json']) {
  test(`corrupt, missing or foreign ${name} never becomes a trusted summary`, (t) => {
    const f = fixture(t);
    f.refresh();
    const file = path.join(f.directory, name),
      original = fs.readFileSync(file);
    for (const bytes of [Buffer.from('{broken'), json({ version: 3, batch: 'foreign', wallMs: 513789049 })]) {
      fs.writeFileSync(file, bytes);
      assert.equal(f.read().wallMs, null);
      assert.notEqual(f.read().status, 'completed');
    }
    fs.unlinkSync(file);
    assert.equal(f.read().wallMs, null);
    fs.writeFileSync(file, original);
    assert.equal(f.read().wallMs, null);
  });
}
test('an authorization mismatch is rejected before any upgrade publication', (t) => {
  const f = fixture(t),
    before = fs.readFileSync(f.timeline);
  fs.writeFileSync(f.marker, json({ version: 1, batch: f.batch, authorizedAt: at + 1, requestId: 'different' }));
  assert.throws(f.refresh, /Authorization boundary changed/);
  assert.deepEqual(fs.readFileSync(f.timeline), before);
  assert.equal(f.read().wallMs, null);
});
for (const writer of ['validation', 'interruption']) {
  test(`${writer} writer publishes matching summaries and replays an interrupted publication idempotently`, (t) => {
    const f = fixture(t);
    f.refresh();
    const start = new Date(at + 20).toISOString();
    recordValidationTiming(f.common, f.batch, { attemptId: 'attempt', startedAt: start, status: 'running' });
    const interruption = {
      id: 'attempt',
      startedAt: at + 20,
      status: 'interrupted',
      finishedAt: null,
      durationMs: null,
      confirmedInactiveAt: at + 30,
      gateKey: 'a'.repeat(40) + ':123',
      attemptDigest: 'b'.repeat(64),
      preservationDigest: 'c'.repeat(64),
      processInspectionDigest: 'd'.repeat(64),
    };
    const write =
      writer === 'validation'
        ? () =>
            recordValidationTiming(f.common, f.batch, {
              attemptId: 'attempt',
              startedAt: start,
              completedAt: new Date(at + 25).toISOString(),
              status: 'passed',
            })
        : () => recordValidationInterruptions(f.common, f.batch, [interruption]);
    const fault = renameFailure(t, f.timeline, 1, true);
    try {
      assert.throws(write, /injected I\/O failure/);
    } finally {
      fault.restore();
    }
    assert.equal(f.read().wallMs, null);
    write();
    write();
    assert.equal(f.read().localPendingAttempts, 0);
    if (writer === 'interruption') {
      assert.equal(readTimeline(f.common, f.batch).validationInterruptions.length, 1);
      assert.throws(
        () => recordValidationInterruptions(f.common, f.batch, [{ ...interruption, gateKey: 'e'.repeat(40) + ':123' }]),
        /Immutable interruption differs/,
      );
    }
  });
}
async function exited(child) {
  const result = await once(child, 'exit');
  assert.equal(result[0], 0);
}
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Expected owned test process state was not observed');
}
function childScript(code) {
  return spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
}
for (const target of ['timeline.json', 'summary.json', 'publication.json']) {
  test(`SIGKILL after ${target} leaves an unreadable partial publication and a safely recoverable dead lease`, async (t) => {
    const f = fixture(t),
      store = new URL('./batch-timing-store.mjs', import.meta.url).href;
    const script = `import fs from'node:fs';import{refreshTimeline}from${JSON.stringify(store)};const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(b===${JSON.stringify(path.join(f.directory, target))})process.kill(process.pid,'SIGKILL')};refreshTimeline(${JSON.stringify(f.common)},${JSON.stringify(f.batch)});`;
    const child = childScript(script);
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, 'SIGKILL');
    assert.equal(code, null);
    assert.equal(f.read().wallMs, null);
    f.refresh();
    assert.ok(f.read().issues.includes('authorization-turn-ended-before-registration'));
    assert.ok(fs.readdirSync(f.directory).some((name) => name.startsWith('exited-writer-')));
    assert.equal(fs.existsSync(path.join(f.directory, 'writer.lock')), false);
  });
}
test("two concurrent recovery processes never steal each other's lease or lose a committed update", async (t) => {
  const f = fixture(t),
    io = new URL('./batch-timing-io.mjs', import.meta.url).href,
    ready = path.join(f.root, 'ready'),
    counter = path.join(f.root, 'counter');
  fs.writeFileSync(counter, '0');
  const owner = childScript(
    `import fs from'node:fs';import{timingWriterLock}from${JSON.stringify(io)};timingWriterLock(${JSON.stringify(f.directory)},()=>{fs.writeFileSync(${JSON.stringify(ready)},'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000)});`,
  );
  t.after(() => {
    try {
      owner.kill('SIGKILL');
    } catch {
      /* exited */
    }
  });
  await until(() => fs.existsSync(ready));
  const dead = once(owner, 'exit');
  owner.kill('SIGKILL');
  await dead;
  const code = `import fs from'node:fs';import{timingWriterLock}from${JSON.stringify(io)};timingWriterLock(${JSON.stringify(f.directory)},()=>{const p=${JSON.stringify(counter)},n=Number(fs.readFileSync(p));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);fs.writeFileSync(p,String(n+1))});`;
  await Promise.all([exited(childScript(code)), exited(childScript(code))]);
  assert.equal(fs.readFileSync(counter, 'utf8'), '2');
});
test('live, foreign and malformed leases stay protected and linked paths cannot be published', (t) => {
  const f = fixture(t),
    lock = path.join(f.directory, 'writer.lock');
  for (const bytes of [
    json({ pid: process.pid, host: os.hostname() }),
    json({ pid: process.pid, host: 'foreign' }),
    Buffer.from('partial'),
  ]) {
    fs.writeFileSync(lock, bytes);
    assert.throws(() => timingWriterLock(f.directory, () => assert.fail('Must not enter foreign critical section')));
    assert.deepEqual(fs.readFileSync(lock), bytes);
    fs.unlinkSync(lock);
  }
  const missing = path.join(f.root, 'missing'),
    linked = path.join(f.root, 'linked');
  fs.symlinkSync(missing, linked);
  assert.throws(() => atomicTimingJson(linked, { a: 1 }), /Linked timing source/);
  assert.throws(() => preserveTimingSnapshot(linked, Buffer.from('data')), /Linked timing source/);
});

function bindingFixture(t) {
  const f = fixture(t);
  fs.rmSync(f.directory, { recursive: true });
  fs.rmSync(f.marker);
  execFileSync('git', ['init', '-b', 'main'], { cwd: f.root, stdio: 'ignore' });
  const thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const sessions = path.join(f.root, 'sessions');
  fs.mkdirSync(sessions);
  const native = path.join(sessions, `rollout-${thread}.jsonl`);
  const row = (type, payload, time = at) =>
    JSON.stringify({ type, payload, timestamp: new Date(time).toISOString() }) + '\n';
  fs.writeFileSync(
    native,
    row('session_meta', { id: thread, cwd: f.root }) +
      row('event_msg', { type: 'task_started', turn_id: 'one' }) +
      row('turn_context', { turn_id: 'one', cwd: f.root }) +
      row(
        'event_msg',
        {
          type: 'item_completed',
          turn_id: 'one',
          item: { type: 'UserMessage', id: 'original-request', content: [{ text: 'PRIVATE USER TEXT' }] },
        },
        at + 1,
      ),
  );
  const batch = {
    id: f.batch,
    repository: { commonDir: f.common, anchor: f.root },
    worktree: f.root,
    createdAt: new Date(at + 2).toISOString(),
  };
  const bind = (options = {}) =>
    bindBatchTiming(f.root, batch, {
      env: { CODEX_THREAD_ID: thread },
      sessionsRoot: sessions,
      observer: false,
      ...options,
    });
  return { ...f, bind, sessions, native, thread, row };
}
for (const boundary of ['initialization', 'marker', 'timeline', 'publication']) {
  test(`first binding interrupted after ${boundary} preserves original identity and resumes exactly once`, (t) => {
    const f = bindingFixture(t);
    const destination =
      boundary === 'initialization'
        ? path.join(f.directory, 'initialization.json')
        : boundary === 'marker'
          ? f.marker
          : path.join(f.directory, boundary + '.json');
    const method = ['initialization', 'marker'].includes(boundary) ? 'linkSync' : 'renameSync';
    const original = fs[method];
    let hit = false;
    const mock = t.mock.method(fs, method, (from, to) => {
      const result = original(from, to);
      if (to === destination) {
        hit = true;
        throw ioError();
      }
      return result;
    });
    assert.throws(() => f.bind());
    mock.mock.restore();
    assert.ok(hit);
    f.bind();
    f.bind();
    const state = readTimeline(f.common, f.batch);
    assert.equal(state.authorizedAt, at + 1);
    assert.equal(state.requestId, 'original-request');
    assert.equal(state.sources.length, 1);
    assert.equal(f.read().timingVersion, 5);
    for (const file of fs.readdirSync(f.directory).filter((name) => name.endsWith('.json')))
      assert.ok(!fs.readFileSync(path.join(f.directory, file), 'utf8').includes('PRIVATE USER TEXT'));
  });
}
test('unfinished initialization can hand off only after the old native turn has ended', (t) => {
  const f = bindingFixture(t),
    destination = f.marker;
  const original = fs.linkSync;
  const mock = t.mock.method(fs, 'linkSync', (from, to) => {
    if (to === destination) throw ioError();
    return original(from, to);
  });
  assert.throws(() => f.bind());
  mock.mock.restore();
  const next = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const nextFile = path.join(f.sessions, `rollout-${next}.jsonl`);
  fs.writeFileSync(
    nextFile,
    f.row('session_meta', { id: next, cwd: f.root }, at + 20) +
      f.row('event_msg', { type: 'task_started', turn_id: 'two' }, at + 20) +
      f.row('turn_context', { turn_id: 'two', cwd: f.root }, at + 20) +
      f.row(
        'event_msg',
        { type: 'item_completed', turn_id: 'two', item: { type: 'UserMessage', id: 'new-request', content: [] } },
        at + 21,
      ),
  );
  const resume = () => f.bind({ env: { CODEX_THREAD_ID: next }, resume: true });
  assert.throws(resume, /Previous execution still open/);
  fs.appendFileSync(f.native, f.row('event_msg', { type: 'turn_aborted', turn_id: 'one' }, at + 10));
  resume();
  const state = readTimeline(f.common, f.batch);
  assert.equal(state.authorizedAt, at + 1);
  assert.equal(state.requestId, 'original-request');
  assert.equal(state.sources.length, 2);
});
for (const version of [1, 2]) {
  test(`real v${version} writer rejects v3 and verified backup reuse leaves original bytes unchanged`, async (t) => {
    const f = fixture(t, version);
    const original = fs.readFileSync(f.timeline);
    const backup = path.join(f.directory, `timeline-v${version}-${digest(original)}.json`);
    fs.writeFileSync(backup, original);
    const ino = fs.statSync(backup).ino;
    f.refresh();
    f.refresh();
    assert.deepEqual(fs.readFileSync(backup), original);
    assert.equal(fs.statSync(backup).ino, ino);
    const legacy = path.join(f.root, 'legacy');
    fs.mkdirSync(legacy);
    for (const name of ['batch-timing-core.mjs', 'batch-timing-store.mjs'])
      fs.copyFileSync(
        new URL(`./test-support/fixtures/timing-v${version}/${name}.txt`, import.meta.url),
        path.join(legacy, name),
      );
    const old = await import(pathToFileURL(path.join(legacy, 'batch-timing-store.mjs')));
    const before = fs.readFileSync(f.timeline),
      summary = fs.readFileSync(f.summary);
    assert.throws(() => old.refreshTimeline(f.common, f.batch));
    assert.deepEqual(fs.readFileSync(f.timeline), before);
    assert.deepEqual(fs.readFileSync(f.summary), summary);
  });
}
test('stable v3 publication interruption remains unavailable until exact replay completes', (t) => {
  const f = fixture(t);
  f.refresh();
  const originalMarker = fs.readFileSync(f.marker);
  const fault = renameFailure(t, f.timeline, 1, true);
  assert.throws(f.refresh);
  fault.restore();
  assert.equal(f.read().wallMs, null);
  assert.ok(f.read().issues.includes('timing-publication-unavailable'));
  f.refresh();
  assert.equal(f.read().timingVersion, 5);
  assert.deepEqual(fs.readFileSync(f.marker), originalMarker);
  fs.rmSync(f.marker);
  assert.equal(f.read().wallMs, null);
  assert.throws(f.refresh, /Required authorization marker missing/);
});
for (const after of [false, true]) {
  test(`recovery process killed ${after ? 'after' : 'before'} dead lease removal can itself recover without losing exclusion`, async (t) => {
    const f = fixture(t);
    const lock = path.join(f.directory, 'writer.lock');
    const first = childScript(
      `import{timingWriterLock}from${JSON.stringify(new URL('./batch-timing-io.mjs', import.meta.url).href)};timingWriterLock(${JSON.stringify(f.directory)},()=>process.kill(process.pid,'SIGKILL'));`,
    );
    await once(first, 'exit');
    const second = childScript(
      `import fs from'node:fs';import{timingWriterLock}from${JSON.stringify(new URL('./batch-timing-io.mjs', import.meta.url).href)};const old=fs.unlinkSync;fs.unlinkSync=(p)=>{if(p===${JSON.stringify(lock)}){${after ? 'old(p);' : ''}process.kill(process.pid,'SIGKILL');}return old(p)};timingWriterLock(${JSON.stringify(f.directory)},()=>{});`,
    );
    const [, signal] = await once(second, 'exit');
    assert.equal(signal, 'SIGKILL');
    f.refresh();
    assert.equal(f.read().timingVersion, 5);
    assert.ok(!fs.existsSync(lock));
  });
}

test('directory sync failure after a rename stays recoverable and does not claim a durable publication', (t) => {
  const f = fixture(t);
  const original = fs.fsyncSync;
  let armed = false,
    hit = false;
  const rename = fs.renameSync;
  const renameMock = t.mock.method(fs, 'renameSync', (from, to) => {
    const value = rename(from, to);
    if (to === f.timeline) armed = true;
    return value;
  });
  const syncMock = t.mock.method(fs, 'fsyncSync', (fd) => {
    if (armed && fs.fstatSync(fd).isDirectory()) {
      hit = true;
      throw ioError();
    }
    return original(fd);
  });
  assert.throws(f.refresh);
  syncMock.mock.restore();
  renameMock.mock.restore();
  assert.ok(hit);
  assert.equal(f.read().wallMs, null);
  f.refresh();
  assert.equal(f.read().timingVersion, 5);
});
test('read-only report rejects a publication changing during its read without modifying any record', (t) => {
  const f = fixture(t);
  f.refresh();
  const file = path.join(f.directory, 'publication.json'),
    original = fs.readFileSync;
  let reads = 0;
  const before = original(file);
  const mock = t.mock.method(fs, 'readFileSync', (name, ...args) => {
    const bytes = original(name, ...args);
    if (name === file && ++reads === 2) return Buffer.concat([bytes, Buffer.from(' ')]);
    return bytes;
  });
  syncBuiltinESMExports();
  let report;
  try {
    report = f.read();
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(report.wallMs, null);
  assert.ok(report.issues.includes('timing-publication-unavailable'));
  assert.deepEqual(original(file), before);
  assert.equal(f.read().timingVersion, 5);
});
test('missing publication or summary can be rebuilt from complete state; committed state loss cannot use initialization', (t) => {
  const f = bindingFixture(t);
  f.bind();
  const state = fs.readFileSync(f.timeline),
    marker = fs.readFileSync(f.marker);
  for (const name of ['summary.json', 'publication.json']) {
    fs.unlinkSync(path.join(f.directory, name));
    assert.equal(f.read().wallMs, null);
    f.refresh();
    assert.equal(f.read().timingVersion, 5);
    assert.deepEqual(fs.readFileSync(f.marker), marker);
  }
  fs.unlinkSync(f.timeline);
  assert.throws(f.bind, /Committed timing state missing/);
  assert.ok(!fs.existsSync(f.timeline));
  assert.deepEqual(fs.readFileSync(f.marker), marker);
  fs.writeFileSync(f.timeline, state);
});
test('a competing writer releasing its lease between inspection calls is ordinary contention, not a recovery failure', (t) => {
  const f = fixture(t),
    lock = path.join(f.directory, 'writer.lock');
  fs.writeFileSync(lock, json({ pid: process.pid, host: os.hostname() }));
  const original = fs.lstatSync;
  let hit = false;
  const mock = t.mock.method(fs, 'lstatSync', (name, ...args) => {
    if (name === lock && !hit) {
      hit = true;
      fs.unlinkSync(lock);
    }
    return original(name, ...args);
  });
  let calls = 0;
  timingWriterLock(f.directory, () => calls++);
  mock.mock.restore();
  assert.ok(hit);
  assert.equal(calls, 1);
  assert.ok(!fs.existsSync(lock));
});
