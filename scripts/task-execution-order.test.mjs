import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createExecutionOrder } from './task-execution-order.mjs';
import { startParallelTask } from './task-start.mjs';
const event = (sequence) => ({
  sequence,
  messageId: `user-${sequence}`,
  roomId: 'fixture-room',
  authorId: 'fixture-user',
});
function fixture(t) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'execution-order-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const queue = createExecutionOrder(root);
  queue.initialize(event(1));
  queue.direct({ action: 'resume-all', request: event(2) });
  return { root, queue };
}
const enqueue = (queue, n, lane = 'development') =>
  queue.enqueue({ lane, task: `task-${n}`, owner: `owner-${n}`, request: event(n + 10) });
const claim = (queue, n, lane = 'development') => queue.claim({ lane, task: `task-${n}`, owner: `owner-${n}` });
const input = (ticket) => ({ lane: ticket.lane, task: ticket.task, owner: ticket.owner, admission: ticket.admission });
test('explicit activation starts paused and never launches work', (t) => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'execution-order-inactive-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const queue = createExecutionOrder(root);
  assert.equal(queue.read(), null);
  assert.deepEqual(queue.assertAdmission({}), { active: false });
  queue.initialize(event(1));
  enqueue(queue, 1);
  assert.throws(() => claim(queue, 1), /paused/);
  assert.equal(queue.read().tickets[0].status, 'queued');
});
test('two independent FIFO lanes admit three each, never a fourth', (t) => {
  const { queue } = fixture(t);
  for (const lane of ['development', 'delivery']) {
    for (let n = 1; n <= 4; n++) enqueue(queue, n, lane);
    assert.throws(() => claim(queue, 2, lane), /FIFO/);
    for (let n = 1; n <= 3; n++) claim(queue, n, lane);
    assert.throws(() => claim(queue, 4, lane), /occupied/);
  }
  assert.equal(queue.read().tickets.filter((x) => x.status === 'running').length, 6);
});
test('duplicate receipt and claim are idempotent, conflicting identity is rejected', (t) => {
  const { queue } = fixture(t);
  const first = enqueue(queue, 1);
  assert.deepEqual(enqueue(queue, 1), first);
  const admitted = claim(queue, 1);
  assert.deepEqual(claim(queue, 1), admitted);
  assert.throws(() => queue.enqueue({ ...first, owner: 'other' }));
  assert.equal(queue.read().tickets.length, 1);
});
test('late instructions, receipt collisions and guessed order are rejected', (t) => {
  const { queue } = fixture(t);
  enqueue(queue, 2);
  assert.throws(() => enqueue(queue, 1), /Late/);
  assert.throws(
    () => queue.enqueue({ lane: 'development', task: 'other', owner: 'o', request: event(12) }),
    /collision/,
  );
  assert.throws(() => queue.enqueue({ lane: 'development', task: 'other', owner: 'o', request: {} }));
});
test('blocked retains its slot, original owner and admission checks fail closed', (t) => {
  const { queue } = fixture(t);
  for (let n = 1; n <= 4; n++) enqueue(queue, n);
  const first = claim(queue, 1);
  claim(queue, 2);
  claim(queue, 3);
  queue.block({ ...input(first), reason: 'unknown: process result unavailable' });
  assert.throws(() => claim(queue, 4), /occupied/);
  assert.throws(() => claim(queue, 1), /auto-resume/);
  assert.throws(() => queue.assertAdmission(input(first)), /not admitted/);
  assert.throws(() => queue.complete({ ...input(first), evidence: {} }, () => true));
  assert.throws(() => queue.block({ ...input(first), owner: 'other', reason: 'x' }));
});
test('completion requires evidence verifier and releases one slot without auto-launch', (t) => {
  const { queue } = fixture(t);
  for (let n = 1; n <= 4; n++) enqueue(queue, n);
  claim(queue, 1);
  const second = claim(queue, 2);
  claim(queue, 3);
  assert.throws(() => queue.complete({ ...input(second), evidence: {} }));
  assert.throws(() => queue.complete({ ...input(second), evidence: {} }, () => false));
  assert.equal(queue.read().tickets[1].status, 'running');
  queue.complete({ ...input(second), evidence: { fixtureVerified: true } }, (_, e) => e.fixtureVerified === true);
  assert.equal(queue.read().tickets[3].status, 'queued');
  assert.equal(claim(queue, 4).status, 'running');
});
test('global resume does not unblock tasks; explicit task resume rotates admission', (t) => {
  const { queue } = fixture(t);
  enqueue(queue, 1);
  const first = claim(queue, 1);
  queue.block({ ...input(first), reason: 'requires user decision' });
  queue.direct({ action: 'pause-all', request: event(100) });
  assert.throws(() => queue.direct({ action: 'resume-task', request: event(101), ...input(first) }), /Global pause/);
  queue.direct({ action: 'resume-all', request: event(102) });
  assert.throws(() => claim(queue, 1));
  assert.throws(() => queue.direct({ action: 'resume-all', request: event(99) }), /Stale/);
  queue.direct({ action: 'resume-task', request: event(103), ...input(first) });
  assert.throws(() => queue.assertAdmission(input(first)), /admission/);
  assert.equal(queue.assertAdmission(input(claim(queue, 1))).active, true);
});
test('pause gates running task continuation and never removes completed evidence', (t) => {
  const { queue } = fixture(t);
  enqueue(queue, 1);
  const first = claim(queue, 1);
  queue.direct({ action: 'pause-all', request: event(100) });
  assert.throws(() => queue.assertAdmission(input(first)), /paused/);
  assert.throws(() => claim(queue, 1), /paused/);
});
test('malformed or partial policy never silently disables enforcement', (t) => {
  const { root, queue } = fixture(t);
  writeFileSync(path.join(root, 'task-registry/execution-order/state.json'), '{');
  assert.throws(() => queue.assertAdmission({}));
});
test('linked state cannot redirect writes', (t) => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'execution-order-linked-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'target'));
  symlinkSync(path.join(root, 'target'), path.join(root, 'task-registry'));
  assert.throws(() => createExecutionOrder(root).initialize(event(1)), /Linked/);
});
test('development formal start refuses missing admission before any git/prepare effect', (t) => {
  const { root } = fixture(t);
  const registry = { commonDir: root, resolve: () => ({ id: 'task-1' }) };
  let calls = 0;
  assert.throws(
    () =>
      startParallelTask(
        { slug: 'task-1', owner: 'owner-1' },
        {
          root,
          registry,
          git: () => calls++,
          prepare: () => calls++,
        },
      ),
    /no explicit execution instruction/,
  );
  assert.equal(calls, 0);
});
test('concurrent claims cannot oversubscribe the final slot', async (t) => {
  const { root, queue } = fixture(t);
  for (let n = 1; n <= 4; n++) enqueue(queue, n);
  claim(queue, 1);
  claim(queue, 2);
  const url = new URL('./task-execution-order.mjs', import.meta.url).href;
  function child(n) {
    return new Promise((resolve, reject) => {
      const code = `import { createExecutionOrder } from ${JSON.stringify(url)}; try {createExecutionOrder(${JSON.stringify(root)}).claim({lane:'development',task:'task-${n}',owner:'owner-${n}'}); console.log('admitted');} catch(e) {console.log('refused:'+e.message);}`;
      const proc = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      proc.stdout.on('data', (b) => (output += b));
      proc.stderr.on('data', (b) => (output += b));
      proc.on('error', reject);
      proc.on('close', (status) => (status === 0 ? resolve(output) : reject(Error(output))));
    });
  }
  const results = await Promise.all([child(3), child(4)]);
  assert.equal(results.filter((x) => x.startsWith('admitted')).length, 1);
  assert.equal(queue.read().tickets.filter((x) => x.status === 'running').length, 3);
  assert.equal(queue.read().tickets[3].status, 'queued');
});
test('completion gate is before recovery; published entry and compatibility aliases reach guarded functions', () => {
  const completion = readFileSync(new URL('./completion-cli.mjs', import.meta.url), 'utf8');
  const wrapper = completion.slice(completion.indexOf('export async function completionCommand('));
  assert.ok(wrapper.indexOf('executionOrder.assertAdmission') < wrapper.indexOf('leases.recoverEndedTask'));
  const entry = readFileSync(new URL('./task-entry.mjs', import.meta.url), 'utf8');
  assert.match(entry, /'execution-order': 'scripts\/task-execution-order-cli.mjs'/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['task:start'], 'node scripts/task-start.mjs');
  assert.equal(pkg.scripts['task:micro'], 'node scripts/task-start.mjs');
  assert.equal(pkg.scripts['task:completion'], 'node scripts/task-completion.mjs');
});

test('only an explicit exact user order changes queued order, preserving receipt audit', (t) => {
  const { queue } = fixture(t);
  for (let n = 1; n <= 3; n++) enqueue(queue, n, 'delivery');
  assert.throws(() => claim(queue, 3, 'delivery'), /FIFO/);
  assert.throws(() => queue.direct({ action: 'reorder', lane: 'delivery', tasks: ['task-3', 'task-1', 'task-2'] }));
  const instruction = {
    action: 'reorder',
    lane: 'delivery',
    tasks: ['task-3', 'task-1', 'task-2'],
    request: event(100),
  };
  queue.direct(instruction);
  queue.direct(instruction);
  assert.equal(claim(queue, 3, 'delivery').status, 'running');
  const state = queue.read();
  assert.deepEqual(
    state.tickets.map((x) => x.request.sequence),
    [11, 12, 13],
  );
  assert.deepEqual(state.events.find((x) => x.action === 'reorder-applied').before, ['task-1', 'task-2', 'task-3']);
  assert.deepEqual(state.events.find((x) => x.action === 'reorder-applied').after, instruction.tasks);
  assert.equal(state.events.filter((x) => x.action === 'reorder-applied').length, 1);
});
test('explicit reorder cannot release blocked slots, change owner, or affect the other lane', (t) => {
  const { queue } = fixture(t);
  for (let n = 1; n <= 5; n++) enqueue(queue, n);
  enqueue(queue, 1, 'delivery');
  enqueue(queue, 2, 'delivery');
  const first = claim(queue, 1);
  claim(queue, 2);
  claim(queue, 3);
  queue.block({ ...input(first), reason: 'needs user decision' });
  assert.throws(
    () =>
      queue.direct({
        action: 'reorder',
        lane: 'development',
        tasks: ['task-1', 'task-4', 'task-5'],
        request: event(100),
      }),
    /only queued/,
  );
  assert.throws(
    () => queue.direct({ action: 'reorder', lane: 'development', tasks: ['task-4', 'task-4'], request: event(101) }),
    /Duplicate/,
  );
  queue.direct({ action: 'reorder', lane: 'development', tasks: ['task-5', 'task-4'], request: event(102) });
  assert.throws(() => claim(queue, 5), /occupied/);
  assert.equal(queue.read().tickets[0].status, 'blocked');
  assert.equal(queue.read().tickets[0].owner, 'owner-1');
  assert.throws(() => claim(queue, 2, 'delivery'), /FIFO/);
});
