import assert from 'node:assert/strict';
import test from 'node:test';
import { previewOwner, transitionSelectedPreview } from './preview-transition.mjs';
function fixture({ prepareFailure = false, targetFailure = false, stopFailure = false, drift = false } = {}) {
  let worktree = '/task/a',
    revision = 2;
  const events = [];
  const status = () => ({
    type: 'zdm-task-preview-service',
    worktree,
    selectionRevision: revision,
    childPid: 4,
    servicePid: 3,
  });
  const expected = previewOwner(status());
  const control = {
    status,
    selection: () => ({ worktree, taskArgs: ['--mode', 'full'] }),
    async prepare() {
      events.push('prepare');
      if (prepareFailure) throw Error('invalid target');
      if (drift) revision++;
      return {};
    },
    async validate() {
      events.push('validate');
    },
    async stop(previous) {
      events.push('stop:' + previous.worktree);
      if (stopFailure) throw Error('backend still owned');
    },
    select(target) {
      worktree = target;
      revision++;
      events.push('select:' + target);
    },
    async launch() {
      events.push('launch:' + worktree);
      if (targetFailure && worktree === '/task/b') throw Error('target health failed');
      return status();
    },
    cancelRestart() {
      events.push('cancel-restart');
    },
    error(error) {
      events.push('error:' + error.message);
    },
  };
  return { expected, target: { worktree: '/task/b' }, taskArgs: ['--mode', 'full'], control, events };
}
test('target preparation and current ownership are proved before stopping the selected preview', async () => {
  const f = fixture();
  const r = await transitionSelectedPreview(f);
  assert.equal(r.status.worktree, '/task/b');
  assert.equal(r.interruption, true);
  assert.deepEqual(f.events, ['prepare', 'validate', 'stop:/task/a', 'select:/task/b', 'validate', 'launch:/task/b']);
});
test('invalid target and ownership drift preserve the original running preview', async () => {
  for (const options of [{ prepareFailure: true }, { drift: true }]) {
    const f = fixture(options);
    await assert.rejects(transitionSelectedPreview(f));
    assert.equal(f.control.status().worktree, '/task/a');
    assert.ok(!f.events.some((x) => x.startsWith('stop:')));
  }
});
test('target health failure restores previous selection and actually launches it', async () => {
  const f = fixture({ targetFailure: true });
  await assert.rejects(transitionSelectedPreview(f), /previous preview was restored/);
  assert.equal(f.control.status().worktree, '/task/a');
  assert.deepEqual(f.events.slice(-4), ['cancel-restart', 'stop:/task/b', 'select:/task/a', 'launch:/task/a']);
});
test('partial stop failure keeps original ownership and never launches the new target', async () => {
  const f = fixture({ stopFailure: true });
  await assert.rejects(transitionSelectedPreview(f), /backend still owned/);
  assert.equal(f.control.status().worktree, '/task/a');
  assert.ok(!f.events.some((x) => x.startsWith('select:') || x.startsWith('launch:')));
});
test('same-task request rechecks actual readiness and avoids interruption', async () => {
  const f = fixture();
  f.target.worktree = '/task/a';
  const r = await transitionSelectedPreview(f);
  assert.equal(r.interruption, false);
  assert.deepEqual(f.events, ['prepare', 'validate', 'launch:/task/a']);
});
test('failed target binding never stops a target that was not selected and restores only the previous owner', async () => {
  const f = fixture(),
    select = f.control.select;
  f.control.select = (target, args) => {
    if (target === '/task/b') throw Error('binding changed');
    return select(target, args);
  };
  await assert.rejects(transitionSelectedPreview(f), /previous preview was restored/);
  assert.equal(f.control.status().worktree, '/task/a');
  assert.ok(!f.events.includes('stop:/task/b'));
});
test('a paused retained source is not reported healthy or restarted against its previous data after failure', async () => {
  const f = fixture({ targetFailure: true }),
    selection = f.control.selection;
  f.control.selection = () => ({ ...selection(), canRestore: false });
  await assert.rejects(transitionSelectedPreview(f), /without claiming a healthy previous runtime/);
  assert.ok(!f.events.includes('launch:/task/a'));
  assert.equal(f.control.status().worktree, '/task/a');
});
