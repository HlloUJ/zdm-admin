import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  chmodSync,
  statSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { createTaskRegistry } from './task-registry.mjs';
import {
  makeParallelTransitionPlan,
  applyParallelTransition,
  transitionSourceState,
} from './parallel-task-transition.mjs';

function fixture(t) {
  const parent = path.join(process.cwd(), '.task-runtime');
  mkdirSync(parent, { recursive: true });
  const directory = realpathSync(mkdtempSync(path.join(parent, 'transition-test-'))),
    root = path.join(directory, 'main');
  mkdirSync(root);
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(path.join(root, '.gitignore'), '.task-runtime/\nnode_modules/\n');
  writeFileSync(path.join(root, 'feature.txt'), 'base');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  const head = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', head);
  const a = path.join(directory, 'a'),
    old = path.join(directory, 'old'),
    b = path.join(directory, 'b');
  git(root, 'worktree', 'add', '-b', 'codex/a', a);
  git(root, 'worktree', 'add', '-b', 'codex/old', old);
  git(root, 'branch', 'codex/missing-b', head);
  writeFileSync(path.join(a, 'feature.txt'), 'unfinished A');
  const common = path.join(root, '.git'),
    legacy = path.join(common, 'task-batches');
  mkdirSync(legacy);
  const record = {
    version: 1,
    id: 'old',
    kind: 'business',
    owner: null,
    repository: { commonDir: common },
    worktree: old,
    branch: 'codex/old',
    base: head,
    startHead: head,
    recordedHead: head,
    originMain: head,
    modules: [],
  };
  writeFileSync(path.join(legacy, 'active.json'), JSON.stringify(record));
  const delivery = path.join(common, 'task-delivery/old');
  mkdirSync(delivery, { recursive: true });
  writeFileSync(path.join(delivery, 'accepted-source.json'), '{"immutable":"original freeze"}');
  writeFileSync(path.join(delivery, 'completion-session.json'), '{"merge":"failure retained"}');
  const overlay = path.join(root, '.task-runtime/overlay');
  mkdirSync(path.join(overlay, 'files/src'), { recursive: true });
  const bytes = 'historical B fragment, final version unknown';
  writeFileSync(path.join(overlay, 'files/src/restored.ts'), bytes);
  writeFileSync(
    path.join(overlay, 'manifest.json'),
    JSON.stringify({
      version: 1,
      nativeOwner: 'chat-b',
      base: head,
      runtimeBlocked: true,
      completeFinalWorktreeProven: false,
      originalBranchRetained: 'codex/missing-b',
      originalMissingWorktreeRetained: '/private/tmp/missing-b',
      files: [{ path: 'src/restored.ts', sha256: createHash('sha256').update(bytes).digest('hex'), sourceLine: 42 }],
    }),
  );
  const input = {
    taskA: { id: 'a', owner: 'chat-a', title: 'A', worktree: a, branch: 'codex/a' },
    taskB: { id: 'b', owner: 'chat-b', title: 'B', worktree: b, branch: 'codex/b' },
    overlayRoot: overlay,
  };
  t.after(() => {
    if (existsSync(legacy)) chmodSync(legacy, 0o700);
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    root,
    a,
    b,
    git,
    input,
    common,
    legacy,
    delivery,
    before: transitionSourceState(a),
    registry: createTaskRegistry(root),
  };
}
test('transition restores only proven B bytes and preserves A, original frozen identity, failed receipt and historical branch', (t) => {
  const f = fixture(t),
    plan = makeParallelTransitionPlan(f.root, f.input);
  const prior = ['accepted-source.json', 'completion-session.json'].map((file) =>
    readFileSync(path.join(f.delivery, file), 'utf8'),
  );
  const result = applyParallelTransition(plan);
  assert.equal(result.previewChanged, false);
  assert.equal(result.databaseChanged, false);
  assert.deepEqual(transitionSourceState(f.a), f.before);
  assert.equal(readFileSync(path.join(f.b, 'src/restored.ts'), 'utf8'), 'historical B fragment, final version unknown');
  assert.equal(f.registry.readTask('b').recovery.runtimeBlocked, true);
  assert.equal(f.registry.readTask('b').development, undefined);
  assert.equal(f.registry.readTask('a').resources.persistentPreviewOwner, true);
  assert.equal(f.registry.readTask('old').compatibility.readOnly, true);
  ['accepted-source.json', 'completion-session.json'].forEach((file, i) =>
    assert.equal(readFileSync(path.join(f.delivery, file), 'utf8'), prior[i]),
  );
  assert.equal(statSync(f.legacy).mode & 0o777, 0o500);
  assert.equal(statSync(path.join(f.legacy, 'active.json')).mode & 0o777, 0o400);
  assert.equal(f.git(f.root, 'rev-parse', 'codex/missing-b'), plan.taskB.base);
  assert.deepEqual(
    applyParallelTransition(plan),
    result,
    'Owned interrupted transition can resume without duplicating or replacing source',
  );
});
test('changed A, modified history or a foreign target refuses before registering or copying anything', (t) => {
  const f = fixture(t),
    plan = makeParallelTransitionPlan(f.root, f.input);
  writeFileSync(path.join(f.a, 'feature.txt'), 'new A work');
  assert.throws(() => applyParallelTransition(plan), /A changed/);
  assert.equal(f.registry.list().length, 0);
  assert.equal(existsSync(f.b), false);
  writeFileSync(path.join(f.a, 'feature.txt'), 'unfinished A');
  mkdirSync(f.b);
  writeFileSync(path.join(f.b, 'unknown.txt'), 'someone else');
  assert.throws(() => applyParallelTransition(plan), /Unknown target/);
  assert.equal(f.registry.list().length, 0);
  assert.equal(readFileSync(path.join(f.b, 'unknown.txt'), 'utf8'), 'someone else');
});
