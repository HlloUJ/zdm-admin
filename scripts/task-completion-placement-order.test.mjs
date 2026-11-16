import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
const contractBytes = readFileSync(new URL('./test-support/task-placement-417-v35.js.txt', import.meta.url));
const { requirePlacementRecord } = await import('data:text/javascript;base64,' + contractBytes.toString('base64'));
import { ensureDeliveryPlacement, beginDeliveryFact } from './task-completion-placement.mjs';
import { createProgressHost } from './task-progress-host.mjs';
import { createProgressOutbox, authenticatedBoardAdapter } from './task-progress-outbox.mjs';
import { completionStage, openCompletion, saveCompletion } from './completion-session.mjs';
import { verifyDevelopmentPlacementEvidence, verifyDevelopmentCompletion } from './task-execution-order-cli.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const common = realpathSync(mkdtempSync(path.join(tmpdir(), 'real-placement-order-')));
  t.after(() => rmSync(common, { recursive: true, force: true }));
  const directory = path.join(common, 'task-progress', 'fixture');
  return { common, directory };
}
function sources(base) {
  const task = { id: 'fixture', owner: 'owner', frozen: { accepted: 'a'.repeat(40) } },
    event = { id: 'source-prepare', name: 'prepare', status: 'running', startedAt: base },
    ticket = {
      lane: 'delivery',
      task: 'fixture',
      owner: 'owner',
      status: 'running',
      request: { messageId: 'real-user-request' },
    },
    acceptance = { batch: 'fixture', commit: 'a'.repeat(40) },
    source = {
      verified: true,
      task: 'fixture',
      owner: 'owner',
      candidate: 'b'.repeat(40),
      sourceHead: 'b'.repeat(40),
      evidenceDigest: 'c'.repeat(64),
      assessment: { noKnownDefects: true },
    };
  return { task, event, ticket, acceptance, source };
}
function service() {
  const current = {
      id: 'fixture',
      revision: 1,
      status: 'active',
      board_column: 'active',
      current_work: '',
      next_step: '',
    },
    receipts = new Map(),
    applied = [];
  let lastTime = -Infinity,
    lastSequence = 0;
  const call = async (operation, args) => {
    if (operation === 'get_task_progress_receipt') {
      const found = receipts.get(args.receipt_id);
      return {
        task: { ...current },
        receipt_id: args.receipt_id,
        outcome: found ? 'applied' : 'not_found',
        receipt: found?.receipt ?? null,
        applied_revision: found?.revision ?? null,
      };
    }
    assert.equal(operation, 'apply_task_progress_receipt');
    assert.equal(args.revision, current.revision);
    assert.equal(args.id, 'fixture');
    const receipt = args.receipt;
    assert.ok(receipt.sequence > lastSequence);
    assert.ok(Date.parse(receipt.observed_at) >= lastTime, '417 rejects observation time reversal');
    if (['paused', 'action'].includes(current.status))
      throw Object.assign(Error('Explicit resume required'), { code: 'task_paused' });
    const fact = receipt.stage_fact;
    if (fact) {
      const next = { development_ready: 'review', begin_delivery: 'merging', delivery_complete: 'done' }[fact.kind];
      assert.equal(receipt.event, next === 'merging' ? 'started' : 'completed');
      requirePlacementRecord(
        JSON.stringify({ ...fact, kind: undefined, task_id: 'fixture', action: fact.kind }),
        'fixture',
        current.board_column,
        next,
      );
      current.status = current.board_column = next;
    }
    current.revision++;
    lastTime = Date.parse(receipt.observed_at);
    lastSequence = receipt.sequence;
    receipts.set(receipt.receipt_id, { receipt, revision: current.revision });
    applied.push({ receipt, column: current.board_column });
    return {};
  };
  return { current, applied, adapter: authenticatedBoardAdapter(call), call };
}
test('test fixture is the exact read-only deployed417 next-card contract', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('./test-support/task-placement-417-v35-source.json', import.meta.url)),
  );
  assert.equal(
    sha(readFileSync(new URL('./test-support/task-placement-417-v35.js.txt', import.meta.url))),
    manifest.sha256,
  );
  assert.throws(() => requirePlacementRecord('{}', 'fixture', 'active', 'merging'), /next card/);
});
test('actual prepare fact -> verified ready -> review confirmation -> begin -> merging preserves sequence and observed_at', async (t) => {
  const f = fixture(t),
    base = Date.now(),
    s = sources(base),
    db = service();
  let observed = base + 100,
    phaseClock = 0,
    executed = false,
    host;
  host = createProgressHost(db.adapter, {
    directory: f.directory,
    beforeStage: ({ event }) =>
      ensureDeliveryPlacement(
        {
          ...s,
          event,
          directory: f.directory,
          readDevelopmentSource: async () => s.source,
          drain: () => host.drain(),
          now: () => observed++,
        },
        db.adapter,
      ),
  });
  const session = path.join(f.common, 'task-delivery', 'fixture'),
    state = openCompletion(session, 'fixture');
  await host.run(() =>
    completionStage(
      state,
      'prepare',
      'head',
      () => {
        executed = true;
        assert.equal(db.current.board_column, 'merging');
        return { ok: true };
      },
      { now: () => (phaseClock++ ? base + 1000 : base), save: (value) => saveCompletion(session, value) },
    ),
  );
  await host.drain();
  assert.equal(executed, true);
  assert.deepEqual(
    db.applied.map((item) => item.receipt.stage_fact?.kind ?? 'generic'),
    ['generic', 'development_ready', 'begin_delivery', 'generic'],
  );
  assert.deepEqual(
    db.applied.slice(0, 3).map((item) => item.column),
    ['active', 'review', 'merging'],
  );
  const times = db.applied.map((item) => Date.parse(item.receipt.observed_at));
  assert.ok(times.every((time, i) => i === 0 || time >= times[i - 1]));
  assert.ok(times[2] > base, 'Begin is a fresh observation, not backdated to original prepare');
  assert.equal(createProgressOutbox(f.directory).read().pending.length, 0);
});
test('missing development proof or blocked annotation stops before source execution and never attempts a card skip', async (t) => {
  for (const mode of ['missing-proof', 'blocked']) {
    const f = fixture(t),
      s = sources(Date.now()),
      db = service();
    if (mode === 'blocked') db.current.status = 'action';
    let ran = false,
      host;
    host = createProgressHost(db.adapter, {
      directory: f.directory,
      beforeStage: ({ event, transport }) =>
        ensureDeliveryPlacement(
          {
            ...s,
            event,
            directory: f.directory,
            readDevelopmentSource: async () => {
              if (mode === 'missing-proof') throw Error('No exact development report');
              return s.source;
            },
            drain: () => host.drain(),
          },
          transport,
        ),
    });
    const dir = path.join(f.common, 'task-delivery', 'fixture'),
      state = openCompletion(dir, 'fixture');
    await assert.rejects(
      host.run(() =>
        completionStage(
          state,
          'prepare',
          'head',
          () => {
            ran = true;
          },
          { save: (value) => saveCompletion(dir, value) },
        ),
      ),
    );
    await host.drain();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ran, false);
    assert.equal(db.applied.length, 0);
    assert.ok(
      createProgressOutbox(f.directory)
        .read()
        .pending.every((entry) => entry.revision === undefined && entry.failure === undefined),
    );
  }
});
test('a begin fact alone is rejected by the actual417 contract while a confirmed merging card makes no duplicate placement', async (t) => {
  const f = fixture(t),
    s = sources(Date.now()),
    db = service(),
    box = createProgressOutbox(f.directory),
    bad = box.enqueue('fixture', 'old-begin', beginDeliveryFact(s));
  await assert.rejects(
    db.call('apply_task_progress_receipt', { id: 'fixture', revision: 1, receipt: bad.receipt }),
    /next card/,
  );
  const fresh = createProgressOutbox(path.join(f.common, 'fresh'));
  db.current.status = db.current.board_column = 'merging';
  const result = await ensureDeliveryPlacement(
    {
      ...s,
      directory: path.join(f.common, 'fresh'),
      readDevelopmentSource: async () => s.source,
      drain: async () => {},
    },
    db.adapter,
  );
  assert.equal(result.state, 'current-merging-confirmed-no-write');
  assert.equal(fresh.read().pending.length, 0);
  assert.equal(db.applied.length, 0);
});
test('development readiness verifies original reports/current source tree and positive ordinary assessment; changed source cannot borrow it', (t) => {
  const f = fixture(t),
    root = path.join(f.common, 'source');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Isolated');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, '.gitignore'), '.task-verification/\n');
  writeFileSync(path.join(root, 'source'), 'fixed');
  git('add', '.');
  git('commit', '-m', 'source');
  const old = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-m', 'same-tree replay');
  const head = git('rev-parse', 'HEAD');
  mkdirSync(path.join(root, '.task-verification'));
  const raw = '.task-verification/raw.json';
  writeFileSync(path.join(root, raw), JSON.stringify({ tests: [{ status: 'passed' }] }));
  const report = '.task-verification/report.json';
  writeFileSync(
    path.join(root, report),
    JSON.stringify({
      version: 1,
      task: 'fixture',
      head: old,
      outcome: 'passed',
      tests: 1,
      skipped: 0,
      retries: 0,
      sourceReports: [{ path: raw, sha256: sha(readFileSync(path.join(root, raw))) }],
    }),
  );
  const task = { id: 'fixture', owner: 'owner', worktree: root },
    evidence = {
      task: 'fixture',
      owner: 'owner',
      head: old,
      reports: [{ path: report, sha256: sha(readFileSync(path.join(root, report))) }],
      assessment: { task: 'fixture', owner: 'owner', head, noKnownDefects: true, observedAt: new Date().toISOString() },
    };
  assert.throws(() => verifyDevelopmentCompletion(task, evidence), 'Queue completion keeps exact HEAD');
  const result = verifyDevelopmentPlacementEvidence(task, evidence);
  assert.equal(result.candidate, head);
  assert.equal(result.sourceHead, old);
  assert.equal(JSON.parse(readFileSync(path.join(root, report))).head, old, 'Never rewrite old report identity');
  for (const mutate of [
    (value) => (value.owner = 'foreign'),
    (value) => delete value.assessment,
    (value) => (value.assessment.noKnownDefects = false),
    (value) => (value.reports[0].sha256 = '0'.repeat(64)),
  ]) {
    const value = structuredClone(evidence);
    mutate(value);
    assert.throws(() => verifyDevelopmentPlacementEvidence(task, value));
  }
  writeFileSync(path.join(root, 'source'), 'changed');
  git('add', '.');
  git('commit', '-m', 'changed source');
  assert.throws(
    () =>
      verifyDevelopmentPlacementEvidence(task, {
        ...evidence,
        assessment: { ...evidence.assessment, head: git('rev-parse', 'HEAD') },
      }),
    /changed source/,
  );
});
