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
