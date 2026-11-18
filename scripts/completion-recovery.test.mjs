import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertProcessesGone, runCompletionProcess } from './completion-process.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  chmodSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCompletion, saveCompletion, completionStage, completionSummary } from './completion-session.mjs';
import {
  recoverInterrupted,
  recoverWriter,
  trackStageRestoration,
  finishStageRestorations,
} from './completion-recovery.mjs';
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'completion-recovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, state: openCompletion(dir, 'example') };
}
const gone = () => {
  throw Object.assign(new Error('gone'), { code: 'ESRCH' });
};
function historicalSealedFixture(t, exitCode = 0) {
  const { dir, state } = fixture(t);
  const token = 'e0223cf6-a8a8-4eb9-a41e-57237b294bef';
  const event = {
    id: '769c48eb-3025-4f46-b49a-33e31d4399a6',
    name: 'prepare',
    key: 'ca56ddfcd20647edd405716dc453332df37ba304',
    startedAt: 1794858203587,
    finishedAt: 1794858217508,
    status: exitCode === 0 ? 'success' : 'failure',
    processTracking: 1,
    processes: [{ token }],
    ...(exitCode === 0 ? {} : { failure: { category: 'interrupted' } }),
  };
  state.events.push(event);
  saveCompletion(dir, state);
  const record = { token, host: '192.168.1.88', pgid: 48914, status: 'quiescent', exitCode, signal: null };
  const file = path.join(dir, 'process-' + token + '.json');
  writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  return { dir, state, event, record, file, sessionFile: path.join(dir, 'completion-session.json') };
}

test('sealed historical host recovery accepts the original session sample and preserves journal and failed outcomes', (t) => {
  for (const exitCode of [0, 130]) {
    const { dir, state, event, file } = historicalSealedFixture(t, exitCode);
    const before = readFileSync(file, 'utf8');
    recoverInterrupted(state, dir, {
      host: 'ujs-mac.local',
      probe: () => assert.fail('Never probe a sealed foreign PID'),
    });
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(state.events[0].status, exitCode === 0 ? 'success' : 'failure');
    assert.deepEqual(openCompletion(dir, 'example').events[0], event);
    if (exitCode === 130) assert.equal(state.events[0].failure.category, 'interrupted');
  }
});

test('sealed historical host recovery rejects incomplete identities, unsealed records and invalid outcomes', async (t) => {
  for (const [name, change] of [
    ['pending', { status: 'pending' }],
    ['started foreign group', { status: 'started' }],
    ['exited foreign group', { status: 'exited' }],
    ['wrong token', { token: '11111111-1111-1111-1111-111111111111' }],
    ['missing host', { host: undefined }],
    ['empty host', { host: ' ' }],
    ['invalid pgid', { pgid: 1 }],
    ['string pgid', { pgid: '48914' }],
    ['missing outcome', { exitCode: undefined }],
    ['invalid outcome', { exitCode: -1 }],
    ['string outcome', { exitCode: '0' }],
    ['missing signal', { signal: undefined }],
    ['invalid signal', { signal: 'unknown' }],
  ])
    await t.test(name, (t) => {
      const { dir, state, record, file, sessionFile } = historicalSealedFixture(t);
      writeFileSync(file, JSON.stringify({ ...record, ...change }));
      const before = readFileSync(sessionFile, 'utf8'),
        journal = readFileSync(file, 'utf8');
      assert.throws(() =>
        recoverInterrupted(state, dir, { host: 'ujs-mac.local', probe: () => assert.fail('Foreign probe') }),
      );
      assert.equal(readFileSync(sessionFile, 'utf8'), before);
      assert.equal(readFileSync(file, 'utf8'), journal);
    });
});

test('sealed historical host recovery rejects missing, damaged, linked or nonprivate evidence', async (t) => {
  for (const name of [
    'missing journal',
    'damaged journal',
    'linked journal',
    'public journal',
    'missing session',
    'damaged session',
    'linked session',
    'public session',
  ])
    await t.test(name, (t) => {
      const { dir, event, file, sessionFile } = historicalSealedFixture(t);
      const target = name.endsWith('journal') ? file : sessionFile;
      if (name.startsWith('missing')) unlinkSync(target);
      if (name.startsWith('damaged')) writeFileSync(target, '{');
      if (name.startsWith('public')) chmodSync(target, 0o644);
      if (name.startsWith('linked')) {
        const original = readFileSync(target);
        unlinkSync(target);
        writeFileSync(target + '.original', original, { mode: 0o600 });
        symlinkSync(target + '.original', target);
      }
      assert.throws(() =>
        assertProcessesGone(event, dir, { host: 'ujs-mac.local', probe: () => assert.fail('Foreign probe') }),
      );
    });
});

test('sealed historical host recovery requires one exact original session reference and rejects orphan journals', async (t) => {
  for (const name of [
    'no reference',
    'duplicate reference',
    'changed event',
    'unknown stage identity',
    'orphan journal',
  ])
    await t.test(name, (t) => {
      const { dir, state, event, file, sessionFile } = historicalSealedFixture(t);
      const journal = readFileSync(file, 'utf8');
      if (name === 'no reference' || name === 'orphan journal') state.events = [];
      if (name === 'duplicate reference') state.events.push({ ...event, id: 'another-event' });
      if (name === 'unknown stage identity') delete event.id;
      // Construct corrupted isolated fixture bytes, never live session state.
      writeFileSync(sessionFile, JSON.stringify(state));
      if (name === 'changed event') event.key = 'different-candidate';
      if (name === 'orphan journal') assert.throws(() => recoverInterrupted(state, dir), /Unreferenced/);
      else
        assert.throws(() =>
          assertProcessesGone(event, dir, { host: 'ujs-mac.local', probe: () => assert.fail('Foreign probe') }),
        );
      assert.equal(readFileSync(file, 'utf8'), journal);
    });
});
test('live, unknown or foreign owners cannot be interrupted; only proven local dead owner becomes preserved failure', (t) => {
  const { dir, state } = fixture(t);
  state.events.push({
    id: 'event',
    name: 'ci',
    key: 'head:1',
    startedAt: Date.now(),
    status: 'running',
    processTracking: 1,
    processes: [],
    owner: { host: os.hostname(), pid: 1234 },
  });
  saveCompletion(dir, state);
  assert.throws(() => recoverInterrupted(state, dir, { probe: () => {} }), /alive/);
  assert.throws(() => recoverInterrupted(state, dir, { host: 'other', probe: gone }), /foreign/);
  recoverInterrupted(state, dir, { probe: gone });
  assert.equal(state.events[0].status, 'failure');
  assert.match(state.events[0].durationBasis, /unknown/);
});
test('writer recovery removes only a proven dead private index lock; never steals a live or legacy lock', (t) => {
  const { dir } = fixture(t),
    file = path.join(dir, 'completion-session.json.lock');
  writeFileSync(file, JSON.stringify({ host: os.hostname(), pid: 1234 }));
  assert.throws(() => recoverWriter(dir, { probe: () => {} }), /alive/);
  assert.ok(existsSync(file));
  recoverWriter(dir, { probe: gone });
  assert.equal(existsSync(file), false);
  writeFileSync(file, '1234');
  assert.throws(() => recoverWriter(dir, { probe: gone }));
  assert.ok(existsSync(file));
});
test('non-CI stage restoration is linked and counted only after that exact stage re-verifies successfully', async (t) => {
  const { dir, state } = fixture(t);
  const save = (s) => saveCompletion(dir, s);
  await assert.rejects(
    completionStage(
      state,
      'handoff',
      'head',
      async () => {
        throw Error('failure');
      },
      { save },
    ),
  );
  trackStageRestoration(state, dir);
  assert.equal(state.repairs.length, 1);
  finishStageRestorations(state, dir);
  assert.equal(state.repairs[0].finishedAt, undefined);
  await completionStage(state, 'handoff', 'other', async () => ({ ok: true }), { save });
  finishStageRestorations(state, dir);
  assert.equal(state.repairs[0].finishedAt, undefined);
  await completionStage(state, 'handoff', 'head', async () => ({ ok: true }), { save });
  finishStageRestorations(state, dir);
  assert.ok(state.repairs[0].finishedAt);
  assert.equal(state.events[0].status, 'failure');
  const bytes = readFileSync(state.repairs[0].evidence, 'utf8');
  assert.match(bytes, /unclassified/);
});
test('gaps are an explicit interval union including stage adjacency, not inferred execution', () => {
  const s = {
    batch: 'x',
    startedAt: 0,
    closedAt: 100,
    repairs: [],
    events: [
      { name: 'ci', key: 'x', startedAt: 10, finishedAt: 30, status: 'success' },
      { name: 'handoff', key: 'x', startedAt: 50, finishedAt: 90, status: 'success' },
    ],
  };
  const r = completionSummary(s);
  assert.deepEqual(
    r.gaps.map((g) => g.durationMs),
    [10, 20, 10],
  );
  assert.equal(r.gaps[1].previous, 'ci');
  assert.equal(r.gaps[1].next, 'handoff');
  assert.equal(r.unattributedMs, 40);
});

test('subprocess journals fail closed for legacy, pending, missing, foreign, reused and inaccessible groups', (t) => {
  const { dir } = fixture(t);
  assert.throws(() => assertProcessesGone({}, dir), /Legacy/);
  const token = '11111111-1111-1111-1111-111111111111';
  const event = { processTracking: 1, processes: [{ token }] };
  const file = path.join(dir, 'process-' + token + '.json');
  assert.throws(() => assertProcessesGone(event, dir), /Missing/);
  const write = (data) => writeFileSync(file, JSON.stringify({ token, ...data }), { mode: 0o600 });
  write({ status: 'pending' });
  assert.throws(() => assertProcessesGone(event, dir), /Unknown/);
  write({ host: 'foreign', pgid: 4321, status: 'exited' });
  assert.throws(() => assertProcessesGone(event, dir), /Unknown/);
  write({ host: os.hostname(), pgid: 4321, status: 'exited' });
  assert.throws(() => assertProcessesGone(event, dir, { probe: () => {} }), /alive/);
  assert.throws(() =>
    assertProcessesGone(event, dir, {
      probe: () => {
        throw Object.assign(Error(), { code: 'EPERM' });
      },
    }),
  );
  assertProcessesGone(event, dir, {
    probe: (group) => {
      assert.equal(group, -4321);
      gone();
    },
  });
  assertProcessesGone(event, dir, { probe: () => assert.fail('Sealed launch must not probe a later reused PID') });
  stateForFailedGroupCheck();
  function stateForFailedGroupCheck() {
    write({ host: os.hostname(), pgid: 4321, status: 'exited' });
    const state = openCompletion(dir, 'example');
    state.events.push({
      ...event,
      id: 'failed',
      name: 'push',
      key: 'head',
      status: 'failure',
      startedAt: Date.now(),
      finishedAt: Date.now(),
    });
    assert.throws(() => recoverInterrupted(state, dir, { probe: () => {} }), /group is alive/);
  }
});

test('recorded subprocess preserves stdout, exit failure and redacts arguments from journals', async (t) => {
  const { dir, state } = fixture(t);
  let result;
  await completionStage(
    state,
    'prepare',
    'candidate',
    () => {
      result = runCompletionProcess(
        process.execPath,
        ['-e', "process.stdout.write('private-argument');process.exit(7)"],
        { encoding: 'utf8' },
      );
    },
    { save: (s) => saveCompletion(dir, s) },
  );
  assert.equal(result.status, 7);
  assert.equal(result.stdout, 'private-argument');
  const event = state.events[0];
  const journal = readFileSync(path.join(dir, 'process-' + event.processes[0].token + '.json'), 'utf8');
  assert.ok(!journal.includes('private-argument'));
  assertProcessesGone(event, dir);
});

test('killed completion owner cannot resume while its actual isolated child group is running', async (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'owner.mjs'),
    ready = path.join(dir, 'ready'),
    release = path.join(dir, 'release');
  const sessionModule = new URL('./completion-session.mjs', import.meta.url).href;
  const processModule = new URL('./completion-process.mjs', import.meta.url).href;
  const childSource = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer)}},20);`;
  writeFileSync(
    file,
    `import {openCompletion,completionStage,saveCompletion} from ${JSON.stringify(sessionModule)};
import {runCompletionProcess} from ${JSON.stringify(processModule)};
const state=openCompletion(${JSON.stringify(dir)},'example');
await completionStage(state,'push','candidate',()=>{runCompletionProcess(process.execPath,['-e',${JSON.stringify(childSource)}]);},{save:s=>saveCompletion(${JSON.stringify(dir)},s)});`,
  );
  const owner = spawn(process.execPath, [file], { stdio: 'ignore' });
  let pgid;
  t.after(() => {
    owner.kill('SIGKILL');
    if (pgid) {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        // This test-owned process group has already exited.
      }
    }
  });
  const until = async (condition) => {
    for (let i = 0; i < 250; i++) {
      if (condition()) return;
      await delay(20);
    }
    assert.fail('Isolated process did not reach expected state');
  };
  await until(() => existsSync(ready));
  const state = JSON.parse(readFileSync(path.join(dir, 'completion-session.json')));
  const journal = JSON.parse(readFileSync(path.join(dir, 'process-' + state.events[0].processes[0].token + '.json')));
  pgid = journal.pgid;
  const exited = new Promise((resolve) => owner.once('exit', resolve));
  owner.kill('SIGKILL');
  await exited;
  assert.throws(() => recoverInterrupted(state, dir), /group is alive/);
  assert.equal(state.events[0].status, 'running');
  writeFileSync(release, 'release');
  await until(() => {
    try {
      process.kill(-pgid, 0);
      return false;
    } catch (error) {
      return error.code === 'ESRCH';
    }
  });
  recoverInterrupted(state, dir);
  assert.equal(state.events[0].failure.category, 'interrupted');
  pgid = undefined;
});
