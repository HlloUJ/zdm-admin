import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskDeliveryQueue } from './task-delivery-queue.mjs';
function fixture(t, dependencies = {}) {
  const common = mkdtempSync(path.join(tmpdir(), 'task-delivery-queue-'));
  t.after(() => rmSync(common, { recursive: true, force: true }));
  return createTaskDeliveryQueue(common, { notify: () => {}, ...dependencies });
}
const source = (task) => ({ task, owner: 'chat-' + task, accepted: 'a'.repeat(40), head: 'b'.repeat(40) });
function contention(t, owner, dependencies = {}) {
  const common = mkdtempSync(path.join(tmpdir(), 'queue-publication-'));
  t.after(() => rmSync(common, { recursive: true, force: true }));
  const lock = path.join(common, 'task-registry/queue-write.lock'),
    file = path.join(lock, 'owner.json');
  mkdirSync(lock, { recursive: true });
  if (owner !== null) writeFileSync(file, owner);
  let clock = 0;
  const queue = createTaskDeliveryQueue(common, {
    now: () => clock,
    tick: async () => {
      clock += 100;
    },
    ...dependencies,
  });
  return { queue, lock, file };
}
for (const bytes of [null, '', '{"pid":'])
  test('an owner publication window is observed without taking over: ' + JSON.stringify(bytes), async (t) => {
    let f,
      ticks = 0;
    f = contention(t, bytes, {
      tick: async () => {
        ticks++;
        rmSync(f.lock, { recursive: true });
      },
    });
    const ticket = await f.queue.enqueue(source('a'));
    assert.equal(ticket.task, 'a');
    assert.equal(ticks, 1);
    assert.equal(existsSync(f.lock), false);
  });
for (const [name, bytes, alive] of [
  ['incomplete', '{"pid":', () => true],
  ['dead', JSON.stringify({ pid: 12345, token: 'original' }), () => false],
  [
    'unknown',
    JSON.stringify({ pid: 12345, token: 'original' }),
    () => {
      throw Object.assign(Error('unknown'), { code: 'EPERM' });
    },
  ],
  ['invalid', JSON.stringify({ pid: 0, token: 'original' }), () => true],
  ['null', 'null', () => true],
  ['non-object', '"writer"', () => true],
  ['recursive', JSON.stringify({ pid: process.pid, token: 'original' }), () => true],
])
  test('queue retains a ' + name + ' metadata writer and does not publish a ticket', async (t) => {
    const f = contention(t, bytes, { alive });
    await assert.rejects(f.queue.enqueue(source('a')));
    assert.equal(readFileSync(f.file, 'utf8'), bytes);
    assert.equal(f.queue.inspect().tickets.length, 0);
  });
test('an ended observed writer cannot be confused with its live replacement', async (t) => {
  let f;
  f = contention(t, JSON.stringify({ pid: 12345, token: 'original' }), {
    alive: () => {
      writeFileSync(f.file, JSON.stringify({ pid: 12346, token: 'replacement' }));
      return false;
    },
    tick: async () => rmSync(f.lock, { recursive: true }),
  });
  assert.equal((await f.queue.enqueue(source('a'))).task, 'a');
});
test(
  'a real process can finish publishing its queue owner without a parser failure or stolen lock',
  { timeout: 10000 },
  async (t) => {
    const common = mkdtempSync(path.join(tmpdir(), 'queue-process-publication-'));
    const lock = path.join(common, 'task-registry/queue-write.lock');
    const code = `import fs from 'node:fs';import path from 'node:path';
    const root=process.argv[1],lock=path.join(root,'task-registry/queue-write.lock'),owner=path.join(lock,'owner.json');
    const end=Date.now()+5000;
    const wait=phase=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{process.off('message',receive);reject(Error('publication barrier expired'));},Math.max(1,end-Date.now()));
      const receive=message=>{if(message===phase){clearTimeout(timer);process.off('message',receive);resolve();}};
      process.on('message',receive);
    });
    const publish=wait('publish');
    fs.mkdirSync(lock,{recursive:true});fs.writeFileSync(owner,'{"pid":');process.send('partial-ready');
    await publish;fs.writeFileSync(owner,JSON.stringify({pid:process.pid,token:'actual-writer'}));
    const release=wait('release');process.send('published');await release;
    if(JSON.parse(fs.readFileSync(owner)).token!=='actual-writer')throw Error('owner stolen');
    fs.unlinkSync(owner);fs.rmdirSync(lock);process.disconnect();`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, common], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    child.stdout.on('data', (value) => (output += value));
    child.stderr.on('data', (value) => (output += value));
    const ended = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await ended;
      rmSync(common, { recursive: true, force: true });
    });
    let partialReady, published;
    const partial = new Promise((resolve) => {
      partialReady = resolve;
    });
    const complete = new Promise((resolve) => {
      published = resolve;
    });
    child.on('message', (phase) => {
      if (phase === 'partial-ready') partialReady();
      if (phase === 'published') published();
    });
    const phase = (barrier) =>
      Promise.race([
        barrier,
        ended.then((code) => {
          throw Error('writer exited before publication barrier: ' + code + '\n' + output);
        }),
      ]);
    await phase(partial);
    let sawPartial = false,
      sawPublished = false,
      observedLiveWriter = false;
    const queue = createTaskDeliveryQueue(common, {
      alive: (pid) => {
        assert.equal(pid, child.pid);
        process.kill(pid, 0);
        observedLiveWriter = true;
        return true;
      },
      tick: async () => {
        if (!sawPartial) {
          assert.equal(readFileSync(path.join(lock, 'owner.json'), 'utf8'), '{"pid":');
          sawPartial = true;
          child.send('publish');
          await phase(complete);
          // The writer now holds the complete owner until the NEXT queue tick.
          // That tick is reached only after the queue observes its real live PID.
          return;
        }
        assert.ok(observedLiveWriter);
        assert.deepEqual(JSON.parse(readFileSync(path.join(lock, 'owner.json'))), {
          pid: child.pid,
          token: 'actual-writer',
        });
        sawPublished = true;
        child.send('release');
        // Do not inspect owner.json after release: unlink-before-rmdir is valid.
        assert.equal(await ended, 0, output);
      },
    });
    assert.equal((await queue.enqueue(source('a'))).task, 'a');
    assert.equal(await ended, 0, output);
    assert.ok(sawPartial && sawPublished && observedLiveWriter);
  },
);
test('independent tasks queue FIFO while development takes no main lease', async (t) => {
  let releaseWait;
  const queue = fixture(t, {
    tick: () =>
      new Promise((resolve) => {
        releaseWait = resolve;
      }),
  });
  const a = await queue.enqueue(source('a')),
    b = await queue.enqueue(source('b'));
  const runningA = await queue.wait(a);
  await queue.markMainMutation(runningA);
  let bStarted = false;
  const pendingB = queue.wait(b).then((turn) => {
    bStarted = true;
    return turn;
  });
  await Promise.resolve();
  assert.equal(bStarted, false);
  assert.equal(queue.inspect().tickets[0].task, 'a');
  await queue.finish(runningA, { success: true });
  releaseWait();
  const runningB = await pendingB;
  assert.equal(bStarted, true);
  await queue.finish(runningB, { success: true });
  assert.equal(queue.inspect().tickets.length, 0);
});
test('pre-merge failure releases the queue but a partial main mutation stays protected for owned recovery', async (t) => {
  const queue = fixture(t),
    a = await queue.enqueue(source('a'));
  let turn = await queue.wait(a);
  await queue.finish(turn, { success: false, error: Error('preflight failed') });
  assert.equal(queue.inspect().tickets.length, 0);
  const again = await queue.enqueue(source('a'));
  turn = await queue.wait(again);
  await queue.markMainMutation(turn);
  await queue.finish(turn, { success: false, error: Error('main handoff incomplete') });
  assert.equal(queue.inspect().tickets[0].status, 'blocked');
  const resumed = await queue.wait(await queue.enqueue(source('a')));
  assert.equal(resumed.accepted, again.accepted);
  assert.equal(resumed.mainMutationStarted, true);
  await queue.finish(resumed, { success: true });
  assert.equal(queue.inspect().tickets.length, 0);
});
test('queue cannot replace the frozen task, finish another ticket or release a changed lease', async (t) => {
  const queue = fixture(t),
    a = await queue.enqueue(source('a')),
    running = await queue.wait(a);
  await assert.rejects(() => queue.enqueue({ ...source('a'), accepted: 'c'.repeat(40) }), /original accepted/);
  await assert.rejects(() => queue.markMainMutation({ ...running, owner: 'other' }), /ticket changed/);
  await assert.rejects(
    () => queue.finish({ ...running, lease: { ...running.lease, token: 'stale' } }, { success: true }),
    /lease changed/,
  );
  await queue.finish(running, { success: true });
});
