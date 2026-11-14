import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTaskRegistry } from './task-registry.mjs';
import { evaluateRecoveryNotice, dispatchRecoveryNotice } from './task-recovery-notice.mjs';
const binding = {
  taskId: 'notice-a',
  taskNumber: '284',
  taskName: '任务中断与安全续接',
  owner: 'original-owner',
  authorizationRef: 'verified-owner-message',
  interruptionEventId: 'old',
  roomId: 'original-room',
};
const task = { id: binding.taskId, owner: binding.owner, stage: 'validating' };
const interrupted = {
  id: 'old',
  name: 'prepare',
  key: 'candidate',
  status: 'failure',
  failure: { category: 'interrupted' },
  finishedAt: 10,
};
const attempt = {
  id: 'new',
  name: 'prepare',
  key: 'candidate',
  status: 'success',
  startedAt: 11,
  finishedAt: 20,
  processTracking: 1,
  processes: [],
  owner: { host: 'fixture-host', pid: 1234 },
};
const session = (extra = attempt) => ({
  version: 1,
  startedAt: 1,
  batch: binding.taskId,
  events: [interrupted, extra],
});
const evaluate = (value = session()) => evaluateRecoveryNotice(task, value, binding);
test('only exact new original-stage completed execution emits success, not task completion', () => {
  const r = evaluate();
  assert.equal(r.status, 'ready');
  assert.equal(r.success, true);
  assert.equal(r.taskCompleted, false);
  assert.equal(r.text, '284｜任务中断与安全续接：已成功续接。');
});
test('active, wake-only, old completed, foreign owner and missing chronology cannot report success', () => {
  for (const s of [
    session({ ...attempt, status: 'running' }),
    { ...session(), events: [interrupted] },
    session({ ...attempt, id: 'old' }),
    session({ ...attempt, startedAt: 9 }),
    session({ ...attempt, processTracking: undefined }),
    session({ ...attempt, key: 'different' }),
  ])
    assert.notEqual(evaluate(s).status, 'ready');
  assert.equal(evaluateRecoveryNotice({ ...task, owner: 'different' }, session(), binding).status, 'blocked');
  assert.equal(evaluateRecoveryNotice({ ...task, stage: 'closed' }, session(), binding).status, 'ineligible');
  assert.equal(evaluate({ ...session(), pauses: [{ startedAt: 10 }] }).status, 'blocked');
});
test('failed continuation reports verified category and explicitly unknown cause', () => {
  for (const category of ['interrupted', 'ci-failed-unclassified', 'stage-failure', 'unknown']) {
    const r = evaluate(session({ ...attempt, status: 'failure', failure: { category } }));
    assert.equal(r.success, false);
    assert.match(r.text, /284.*任务中断与安全续接.*续接失败/);
    assert.match(r.text, /具体.*原因待查/);
  }
});
test('identity deduplicates same outcome and separates later attempts and failure from success', () => {
  assert.equal(evaluate().eventId, evaluate().eventId);
  assert.notEqual(evaluate().eventId, evaluate(session({ ...attempt, id: 'next' })).eventId);
  assert.notEqual(evaluate().eventId, evaluate(session({ ...attempt, status: 'failure' })).eventId);
});
function fixture() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'recovery-notice-'))),
    root = path.join(dir, 'main'),
    worktree = path.join(dir, 'task');
  mkdirSync(root);
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  writeFileSync(path.join(root, 'base'), 'base');
  git('add', '.');
  git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('worktree', 'add', '-b', 'codex/notice-a', worktree);
  const registry = createTaskRegistry(root);
  registry.register({ id: binding.taskId, owner: binding.owner, worktree });
  const evidence = path.join(registry.commonDir, 'task-delivery', binding.taskId);
  mkdirSync(evidence, { recursive: true });
  const file = path.join(evidence, 'completion-session.json');
  writeFileSync(file, JSON.stringify(session()));
  return { root, file, directory: path.join(dir, 'outbox') };
}
test('original disk evidence to durable exact ChatGPT receipt, duplicate sends suppressed', async () => {
  const f = fixture();
  let sent = 0;
  const send = async (n) => {
    sent++;
    return { status: 'delivered', messageId: 'm1', roomId: n.roomId, eventId: n.eventId };
  };
  const r = await dispatchRecoveryNotice({ ...f, binding, send });
  assert.equal(r.status, 'delivered');
  assert.equal(r.taskCompleted, false);
  assert.equal((await dispatchRecoveryNotice({ ...f, binding, send })).status, 'reconcile-existing');
  assert.equal(sent, 1);
  const receipt = JSON.parse(readFileSync(path.join(f.directory, r.eventId + '.receipt.json')));
  assert.equal(receipt.messageId, 'm1');
});
test('unknown or wrong-room delivery remains unknown across another dispatch', async () => {
  for (const mode of ['throw', 'wrong-room']) {
    const f = fixture();
    let sent = 0;
    const send = async (n) => {
      sent++;
      if (mode === 'throw') throw Error('lost');
      return { status: 'delivered', messageId: 'm', roomId: 'wrong', eventId: n.eventId };
    };
    assert.equal((await dispatchRecoveryNotice({ ...f, binding, send })).status, 'unknown');
    assert.equal((await dispatchRecoveryNotice({ ...f, binding, send })).status, 'reconcile-existing');
    assert.equal(sent, 1);
  }
});
test('concurrent dispatch admits a single message and failure notice stays separate', async () => {
  const f = fixture();
  let sent = 0;
  const send = async (n) => {
    sent++;
    return { status: 'delivered', messageId: 'm', roomId: n.roomId, eventId: n.eventId };
  };
  const r = await Promise.all([
    dispatchRecoveryNotice({ ...f, binding, send }),
    dispatchRecoveryNotice({ ...f, binding, send }),
  ]);
  assert.equal(sent, 1);
  assert.deepEqual(r.map((x) => x.status).sort(), ['delivered', 'reconcile-existing']);
  writeFileSync(
    f.file,
    JSON.stringify(session({ ...attempt, id: 'next', status: 'failure', failure: { category: 'stage-failure' } })),
  );
  const failed = await dispatchRecoveryNotice({ ...f, binding, send });
  assert.equal(failed.recoverySuccessful, false);
  assert.equal(sent, 2);
});
test('linked outbox is refused without sending', async () => {
  const f = fixture();
  const outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'recovery-notice-outside-')));
  symlinkSync(outside, f.directory);
  await assert.rejects(
    dispatchRecoveryNotice({ ...f, binding, send: async () => assert.fail('must not send') }),
    /Linked/,
  );
});

test('split root transport rechecks evidence and durably forbids uncertain second send', async () => {
  const { claimRecoveryNotice, beginRecoveryNoticeSend, recordRecoveryNoticeReceipt } =
    await import('./task-recovery-notice.mjs');
  const f = fixture();
  const claim = claimRecoveryNotice({ ...f, binding });
  assert.equal(claim.status, 'claimed');
  const request = beginRecoveryNoticeSend({ directory: f.directory, eventId: claim.eventId });
  assert.equal(request.status, 'send-once');
  assert.equal(
    beginRecoveryNoticeSend({ directory: f.directory, eventId: claim.eventId }).status,
    'reconcile-existing',
  );
  const r = recordRecoveryNoticeReceipt({
    directory: f.directory,
    eventId: claim.eventId,
    result: { status: 'unknown' },
  });
  assert.equal(r.status, 'unknown');
  const g = fixture();
  const changed = claimRecoveryNotice({ ...g, binding });
  writeFileSync(g.file, JSON.stringify(session({ ...attempt, id: 'newer', status: 'running' })));
  assert.equal(beginRecoveryNoticeSend({ directory: g.directory, eventId: changed.eventId }).status, 'blocked');
});

test('malformed formal sessions and missing/duplicate event identity fail closed', () => {
  for (const value of [
    { ...session(), version: 2 },
    { ...session(), startedAt: undefined },
    session({ ...attempt, id: undefined }),
    session({ ...attempt, id: '' }),
    session({ ...attempt, owner: undefined }),
    session({ ...attempt, owner: { host: 'fixture', pid: 1 } }),
    { ...session(), events: [interrupted, { ...attempt, id: 'old' }] },
    {
      ...session(),
      events: [
        { ...interrupted, key: '' },
        { ...attempt, key: '' },
      ],
    },
  ])
    assert.notEqual(evaluate(value).status, 'ready');
});

test('nonce binds a real original supervisor post-spawn launch before stage completion', async () => {
  const { armRecoveryNotice, readRecoveryNotice } = await import('./task-recovery-notice.mjs');
  const { completionStage } = await import('./completion-session.mjs');
  const { completionDirectory, startCompletionProcess, stopCompletionProcess } =
    await import('./completion-process.mjs');
  const { setTimeout: pause } = await import('node:timers/promises');
  const f = fixture(),
    b = { ...binding, worker: '/root/original_worker' };
  const state = { version: 1, startedAt: 1, batch: binding.taskId, events: [interrupted] };
  writeFileSync(f.file, JSON.stringify(state));
  const armed = armRecoveryNotice({ root: f.root, binding: b });
  state[completionDirectory] = path.dirname(f.file);
  const save = () => writeFileSync(f.file, JSON.stringify(state));
  let sent = 0;
  await completionStage(
    state,
    'prepare',
    'candidate',
    async () => {
      const child = startCompletionProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { stdio: 'ignore' });
      try {
        const until = Date.now() + 3000;
        while (Date.now() < until && JSON.parse(readFileSync(child.completionProof.file)).status !== 'started')
          await pause(10);
        const notice = readRecoveryNotice(f.root, armed.binding);
        assert.equal(notice.status, 'ready');
        assert.equal(notice.evidenceKind, 'original-post-spawn-journal');
        assert.equal(notice.executionCurrentlyAlive, 'not-claimed');
        const receipt = await dispatchRecoveryNotice({
          ...f,
          binding: armed.binding,
          send: async (n) => {
            sent++;
            return { status: 'delivered', messageId: 'm', roomId: n.roomId, eventId: n.eventId };
          },
        });
        assert.equal(receipt.status, 'delivered');
        assert.equal(state.events.at(-1).status, 'running');
      } finally {
        await stopCompletionProcess(child);
      }
      return { fixture: true };
    },
    { save },
  );
  assert.equal(
    (await dispatchRecoveryNotice({ ...f, binding: armed.binding, send: async () => assert.fail('duplicate') })).status,
    'reconcile-existing',
  );
  assert.equal(sent, 1);
});
test('nonce path rejects old token, pre-spawn, mismatched journal and task identity', async () => {
  const { armRecoveryNotice, readRecoveryNotice } = await import('./task-recovery-notice.mjs');
  const { randomUUID } = await import('node:crypto');
  const f = fixture(),
    oldToken = randomUUID(),
    token = randomUUID();
  const original = { ...interrupted, processes: [{ token: oldToken }] };
  writeFileSync(f.file, JSON.stringify({ ...session(), events: [original] }));
  const armed = armRecoveryNotice({ root: f.root, binding: { ...binding, worker: '/root/original_worker' } });
  const running = {
    ...attempt,
    id: 'after-nonce',
    status: 'running',
    startedAt: Date.now(),
    finishedAt: undefined,
    processes: [{ token }],
  };
  const write = (record) => writeFileSync(f.file, JSON.stringify({ ...session(), events: [original, record] }));
  const journal = (record, t = token) =>
    writeFileSync(path.join(path.dirname(f.file), 'process-' + t + '.json'), JSON.stringify(record), { mode: 0o600 });
  write(running);
  assert.equal(readRecoveryNotice(f.root, armed.binding).status, 'pending');
  journal({ token, status: 'pending' });
  assert.equal(readRecoveryNotice(f.root, armed.binding).status, 'pending');
  journal({ token: oldToken, status: 'started', host: 'fixture-host', pgid: 1234 });
  assert.equal(readRecoveryNotice(f.root, armed.binding).status, 'pending');
  journal({ token: oldToken, status: 'started', host: 'fixture-host', pgid: 1234 }, oldToken);
  write({ ...running, processes: [{ token: oldToken }] });
  assert.equal(readRecoveryNotice(f.root, armed.binding).status, 'pending');
  write(running);
  journal({ token, status: 'started', host: 'fixture-host', pgid: 1234 });
  assert.equal(readRecoveryNotice(f.root, { ...armed.binding, worker: '/root/other' }).status, 'blocked');
  assert.equal(readRecoveryNotice(f.root, { ...armed.binding, owner: 'other' }).status, 'blocked');
  const registry = createTaskRegistry(f.root),
    record = registry.readTask(binding.taskId);
  registry.revise(record.id, record.revision, (r) => {
    r.recordedHead = 'a'.repeat(40);
  });
  assert.equal(readRecoveryNotice(f.root, armed.binding).status, 'blocked');
});

test('same nonce attempt can complete between claim and send, but failure or new attempt blocks', async () => {
  const { armRecoveryNotice, claimRecoveryNotice, beginRecoveryNoticeSend } =
    await import('./task-recovery-notice.mjs');
  const { randomUUID } = await import('node:crypto');
  for (const transition of ['success', 'failure', 'different-attempt']) {
    const f = fixture();
    writeFileSync(f.file, JSON.stringify({ ...session(), events: [interrupted] }));
    const armed = armRecoveryNotice({ root: f.root, binding: { ...binding, worker: '/root/original_worker' } }),
      token = randomUUID();
    const fresh = {
      ...attempt,
      id: 'post-arm',
      status: 'running',
      startedAt: Date.now(),
      finishedAt: undefined,
      processes: [{ token }],
    };
    writeFileSync(f.file, JSON.stringify({ ...session(), events: [interrupted, fresh] }));
    writeFileSync(
      path.join(path.dirname(f.file), 'process-' + token + '.json'),
      JSON.stringify({ token, status: 'started', host: 'fixture-host', pgid: 1234 }),
      { mode: 0o600 },
    );
    const claim = claimRecoveryNotice({ ...f, binding: armed.binding });
    assert.equal(claim.status, 'claimed');
    writeFileSync(
      f.file,
      JSON.stringify({
        ...session(),
        events: [
          interrupted,
          {
            ...fresh,
            id: transition === 'different-attempt' ? 'another' : fresh.id,
            status: transition === 'failure' ? 'failure' : 'success',
            finishedAt: Date.now(),
          },
        ],
      }),
    );
    assert.equal(
      beginRecoveryNoticeSend({ directory: f.directory, eventId: claim.eventId }).status,
      transition === 'success' ? 'send-once' : 'blocked',
    );
  }
});
test('arming after existing completed attempt never treats it as nonce-bound new recovery', async () => {
  const { armRecoveryNotice, readRecoveryNotice } = await import('./task-recovery-notice.mjs');
  const f = fixture(),
    armed = armRecoveryNotice({ root: f.root, binding: { ...binding, worker: '/root/original_worker' } });
  assert.equal(readRecoveryNotice(f.root, armed.binding).status, 'blocked');
});
