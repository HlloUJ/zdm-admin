import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readTurnEvents,
  summarizeTurn,
  completionWindows,
  validationWindows,
  recordTaskTiming,
  observeTaskTiming,
} from './task-timing.mjs';
const thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  turn = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  other = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const begin = 1700000000000;
const row = (type, payload, offset = 0) =>
  JSON.stringify({ timestamp: new Date(begin + offset).toISOString(), type, payload });
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'task-timing-'));
  t.after(() => rmSync(root, { recursive: true }));
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['config', 'user.name', 'Fixture'],
  ])
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const sessions = path.join(root, 'sessions/2026/10/27');
  mkdirSync(sessions, { recursive: true });
  const file = path.join(sessions, `rollout-example-${thread}.jsonl`);
  const write = (records) => writeFileSync(file, records.join('\n') + '\n');
  const meta = row('session_meta', { id: thread, cwd: root, base_instructions: 'SECRET instructions' });
  const start = (id) => row('event_msg', { type: 'task_started', turn_id: id });
  const item = (type, start, end, extra = {}) =>
    row(
      'event_msg',
      {
        type: 'item_completed',
        turn_id: turn,
        started_at_ms: begin + start,
        completed_at_ms: begin + end,
        item: {
          type,
          id: type + '-' + start,
          command: 'SECRET command',
          arguments: { secret: 'SECRET value' },
          raw_content: 'SECRET reasoning',
          ...extra,
        },
      },
      end,
    );
  return {
    root,
    file,
    sessionsRoot: path.join(root, 'sessions'),
    write,
    meta,
    start,
    item,
    env: { CODEX_THREAD_ID: thread },
  };
}
test('metadata reader strips all content, deduplicates items and binds thread plus repository', async (t) => {
  const f = fixture(t);
  const item = f.item('CommandExecution', 0, 100, { status: 'failed' });
  f.write([
    f.meta,
    f.start(turn),
    item,
    item,
    f.item('Reasoning', 100, 200),
    row('response_item', { type: 'message', content: 'SECRET conversation' }),
  ]);
  const source = await readTurnEvents(f.file, { expectedThread: thread, projectRoot: f.root });
  assert.equal(source.turns[0].items.length, 2);
  assert.ok(!JSON.stringify(source).includes('SECRET'));
  await assert.rejects(readTurnEvents(f.file, { expectedThread: other, projectRoot: f.root }), /thread does not match/);
  // Explicitly emulate a different worktree repository without reading any foreign file.
  let calls = 0;
  await assert.rejects(
    readTurnEvents(f.file, {
      expectedThread: thread,
      projectRoot: f.root,
      repository: () => (++calls === 1 ? 'foreign' : 'project'),
    }),
    /another repository/,
  );
});
test('parallel execution and validation are not added twice; all exclusive buckets plus unknown equal wall time', () => {
  const value = summarizeTurn(
    {
      id: turn,
      startedAt: 0,
      finishedAt: 1000,
      items: [
        { category: 'analysis', startedAt: 0, finishedAt: 150 },
        { category: 'tool', startedAt: 100, finishedAt: 700 },
        { category: 'waiting', startedAt: 200, finishedAt: 600 },
        { category: 'tool', startedAt: 250, finishedAt: 500 },
      ],
    },
    { validation: [{ category: 'validation', startedAt: 300, finishedAt: 800 }] },
  );
  assert.equal(value.wallMs, 1000);
  assert.equal(
    Object.values(value.exclusiveMs).reduce((a, b) => a + b, 0),
    1000,
  );
  assert.equal(value.exclusiveMs.validation, 500);
  assert.equal(value.exclusiveMs.waiting, 100);
  assert.equal(value.unattributedMs, 200);
  assert.equal(value.explicitRepairMs, null);
});
test('repair requires explicit completed records; failure, open repairs and restoration do not invent code repair', () => {
  const windows = completionWindows({
    version: 1,
    events: [{ name: 'ci', startedAt: 100, finishedAt: 300 }],
    repairs: [
      { category: 'code-repair', startedAt: 50, finishedAt: 350 },
      { category: 'stage-restoration', startedAt: 0, finishedAt: 800 },
      { category: 'code-repair', startedAt: 900 },
    ],
  });
  const value = summarizeTurn(
    {
      id: turn,
      startedAt: 0,
      finishedAt: 1000,
      items: [{ category: 'tool', startedAt: 400, finishedAt: 500, failed: true }],
    },
    { completion: windows },
  );
  assert.equal(value.explicitRepairMs, 100);
  assert.equal(value.explicitRepairWindowMs, 300);
  assert.equal(value.explicitRecoveryMs, 600);
  assert.equal(value.failedToolEvents, 1);
  assert.equal(value.exclusiveMs.waiting, 200);
  assert.equal(summarizeTurn({ id: turn, startedAt: 0, finishedAt: 1000, items: [] }).explicitRepairMs, null);
});
test('native round boundaries exclude between-turn idle time; incomplete rounds stay snapshots and malformed input stays partial', async (t) => {
  const f = fixture(t);
  f.write([
    f.meta,
    f.start(turn),
    f.item('Reasoning', 0, 200),
    row('event_msg', { type: 'task_complete', turn_id: turn, duration_ms: 200 }, 200),
    row('event_msg', { type: 'task_started', turn_id: other }, 10000),
  ]);
  const prior = await recordTaskTiming(f.root, {
    env: f.env,
    sessionsRoot: f.sessionsRoot,
    now: begin + 12000,
    lastCompleted: true,
  });
  assert.equal(prior.summary.wallMs, 200);
  assert.equal(prior.status, 'completed');
  const current = await recordTaskTiming(f.root, { env: f.env, sessionsRoot: f.sessionsRoot, now: begin + 12000 });
  assert.equal(current.summary.wallMs, 2000);
  assert.equal(current.status, 'snapshot');
  assert.equal(current.summary.turnId, other);
  f.write([f.meta, f.start(turn), '{truncated']);
  const partial = await recordTaskTiming(f.root, { env: f.env, sessionsRoot: f.sessionsRoot, now: begin + 1000 });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.summary.unattributedMs, 1000);
});
test('existing immutable verification attempts contribute once; incomplete and damaged attempts do not fabricate execution', (t) => {
  const f = fixture(t),
    dir = path.join(f.root, '.task-verification/attempts/example');
  mkdirSync(dir, { recursive: true });
  const record = {
    attemptId: 'attempt',
    startedAt: new Date(begin).toISOString(),
    completedAt: new Date(begin + 200).toISOString(),
  };
  writeFileSync(path.join(dir, 'attempt.json'), JSON.stringify(record));
  writeFileSync(path.join(dir, 'duplicate.json'), JSON.stringify(record));
  writeFileSync(
    path.join(dir, 'open.started.json'),
    JSON.stringify({ attemptId: 'open', startedAt: record.startedAt }),
  );
  writeFileSync(path.join(dir, 'damaged.json'), '{');
  assert.deepEqual(validationWindows(f.root, begin, begin + 1000), [
    { category: 'validation', startedAt: begin, finishedAt: begin + 200 },
  ]);
});
test('missing identity, CI and ambiguous source never scan or guess another conversation; observations never become gate outcomes', async (t) => {
  const f = fixture(t);
  f.write([f.meta, f.start(turn)]);
  assert.equal((await recordTaskTiming(f.root, { env: {}, sessionsRoot: '/does-not-exist' })).status, 'unavailable');
  assert.equal(
    (await recordTaskTiming(f.root, { env: { ...f.env, CI: 'true' }, sessionsRoot: '/does-not-exist' })).status,
    'unavailable',
  );
  writeFileSync(path.join(path.dirname(f.file), `duplicate-${thread}.jsonl`), readFileSync(f.file));
  assert.match((await recordTaskTiming(f.root, { env: f.env, sessionsRoot: f.sessionsRoot })).reason, /ambiguous/);
  const reports = [];
  await observeTaskTiming('/missing/repository', (x) => reports.push(x));
  assert.ok(reports[0].includes('unavailable'));
});
test('help is read-only and never executes validation, service or delivery commands', (t) => {
  const f = fixture(t);
  const before = readdirSync(f.root).sort();
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./task-timing.mjs', import.meta.url)), '--help'], {
    cwd: f.root,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.deepEqual(readdirSync(f.root).sort(), before);
  assert.match(result.stdout, /Does not run checks/);
});

test('a foreign project turn in the same conversation is not attributed to this repository', async (t) => {
  const f = fixture(t);
  f.write([f.meta, f.start(turn), row('turn_context', { turn_id: turn, cwd: '/foreign-project' })]);
  const result = await recordTaskTiming(f.root, { env: f.env, sessionsRoot: f.sessionsRoot, now: begin + 1000 });
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /another project/);
});
test('existing changed-check entry emits timing on a real command failure; list mode remains read-only', async (t) => {
  const f = fixture(t);
  f.write([f.meta, f.start(turn)]);
  mkdirSync(path.join(f.root, 'src'));
  writeFileSync(path.join(f.root, 'src/example.ts'), 'export const value=1;');
  const cli = fileURLToPath(new URL('./check-changed.mjs', import.meta.url));
  const env = { PATH: process.env.PATH, HOME: f.root, CODEX_HOME: f.root, CODEX_THREAD_ID: thread };
  const before = readdirSync(f.root).sort();
  const listed = spawnSync(process.execPath, [cli, '--list', 'src/example.ts'], { cwd: f.root, env, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(readdirSync(f.root).sort(), before);
  writeFileSync(
    path.join(f.root, 'package.json'),
    JSON.stringify({
      scripts: Object.fromEntries(
        ['test:source-guards', 'typecheck:cached', 'lint:changed', 'test:related'].map((name) => [
          name,
          'node -e "process.exit(7)"',
        ]),
      ),
    }),
  );
  writeFileSync(path.join(f.root, 'README.md'), 'fixture');
  writeFileSync(path.join(f.root, '.gitignore'), '.task-verification/\n');
  for (const args of [
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ])
    execFileSync('git', args, { cwd: f.root, stdio: 'ignore' });
  const failed = spawnSync(process.execPath, [cli, 'src/example.ts'], { cwd: f.root, env, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /Task timing snapshot:/);
  const summary = JSON.parse(readFileSync(path.join(f.root, '.task-verification/task-timing', turn + '.json')));
  assert.equal(summary.status, 'snapshot');
  assert.ok(!JSON.stringify(summary).includes('process.exit'));
});
test('observation and even observer logging failure never throw into the caller', async () => {
  await observeTaskTiming('/unavailable', () => {
    throw Error('sink unavailable');
  });
});
