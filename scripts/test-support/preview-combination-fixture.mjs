import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createTaskRegistry } from '../task-registry.mjs';
import { startParallelTask } from '../task-start.mjs';
import { createPreviewCombination } from '../preview-combination.mjs';
export function previewCombinationFixture(t, { conflict = false } = {}) {
  const scratch = path.join(process.cwd(), '.task-runtime/combination-fixtures');
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(path.join(scratch, 'case-')),
    root = path.join(directory, 'main'),
    parent = path.join(directory, 'tasks'),
    remote = path.join(directory, 'origin.git');
  mkdirSync(root);
  mkdirSync(parent);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","version":"1"}');
  writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{}}}');
  writeFileSync(
    path.join(root, '.gitignore'),
    '.task-runtime/\n.task-verification/\ndist/\ncoverage/\nbackend/target/\ntest-results/\nplaywright-report/\n',
  );
  mkdirSync(path.join(root, '.codex'));
  writeFileSync(path.join(root, '.codex/zdm-project-workflow.yaml'), 'batch:\n  mode: parallel-independent\n');
  writeFileSync(path.join(root, 'base.txt'), 'original\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(directory, 'init', '--bare', remote);
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-u', 'origin', 'main');
  const tasks = {};
  for (const id of ['a', 'b']) {
    const result = startParallelTask({ slug: id, kind: 'business', owner: 'chat-' + id, taskParent: parent }, { root });
    const worktree = result.task.worktree,
      file = conflict ? 'base.txt' : id + '.txt';
    writeFileSync(path.join(worktree, file), id + ' source\n');
    git(worktree, 'add', file);
    git(worktree, 'commit', '-m', id + ' incomplete work');
    tasks[id] = { ...result.task, head: git(worktree, 'rev-parse', 'HEAD') };
  }
  const registry = createTaskRegistry(root),
    members = ['a', 'b'].map((id) => ({ task: id, commit: tasks[id].head }));
  const settings = path.join(registry.commonDir, 'preview-fixture.json');
  writeFileSync(settings, '{"selected":"unrelated-b"}\n');
  const options = { id: 'combined', members, taskParent: parent };
  return {
    root,
    parent,
    git,
    tasks,
    registry,
    options,
    settings,
    create: () => createPreviewCombination(root, options, { owner: 'chat-combination' }),
  };
}
