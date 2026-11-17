import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCleanupArtifactProducer } from '../task-cleanup-created-artifacts.mjs';
import { createCleanupQueue } from '../task-cleanup-queue.mjs';

export const cleanupFixtureTemplate = 'scripts/test-support/cleanup-templates/basic.json';
export function createdCleanupFixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'created-cleanup-'))),
    main = path.join(directory, 'main'),
    root = path.join(directory, 'task');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(main);
  const git = (cwd, ...args) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(main, 'init', '-b', 'main');
  git(main, 'config', 'user.name', 'Isolated');
  git(main, 'config', 'user.email', 'fixture@example.invalid');
  for (const d of ['scripts/test-support/cleanup-templates', 'src', 'tests/fixtures', 'ci'])
    mkdirSync(path.join(main, d), { recursive: true });
  writeFileSync(
    path.join(main, cleanupFixtureTemplate),
    readFileSync(new URL('./cleanup-templates/basic.json', import.meta.url)),
  );
  writeFileSync(path.join(main, '.gitignore'), '.task-runtime/\n');
  writeFileSync(path.join(main, 'src/app.ts'), 'export const value = 1;');
  writeFileSync(path.join(main, 'index.html'), '<div>fixture</div>');
  writeFileSync(path.join(main, 'tests/fixtures/.gitkeep'), '');
  writeFileSync(path.join(main, 'package-lock.json'), '{"lockfileVersion":3}');
  writeFileSync(path.join(main, 'vite.e2e.config.mjs'), 'export default {};');
  writeFileSync(
    path.join(main, 'ci/e2e-app.json'),
    JSON.stringify({
      version: 1,
      entries: ['index.html'],
      developmentCases: [
        {
          file: 'native-style-isolation.spec.ts',
          movedFrom: 'dialog-validation-space.spec.ts',
          title: 'pure native Dialog and Form reproduce last-field error overflow without application styles',
        },
      ],
    }),
  );
  git(main, 'add', '.');
  git(main, 'commit', '-m', 'isolated source');
  git(main, 'worktree', 'add', '-b', 'codex/created-task', root);
  const head = git(root, 'rev-parse', 'HEAD'),
    common = path.join(main, '.git'),
    context = { root, common, task: { id: 'created-task', worktree: root } };
  const proof = { worktree: root, head, accepted: head, main: head },
    producer = createCleanupArtifactProducer(root, { context }),
    queue = createCleanupQueue(common);
  return { directory, main, root, common, context, proof, producer, queue, git };
}
