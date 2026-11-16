import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { publishCleanupRuntime, verifyCleanupRuntime } from './task-cleanup-runtime.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-runtime-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Isolated fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(path.join(root, 'scripts'));
  for (const name of [
    'task-cleanup-scheduled-cli.mjs',
    'task-cleanup-cli.mjs',
    'task-cleanup-queue.mjs',
    'task-cleanup-delete.py',
  ])
    writeFileSync(
      path.join(root, 'scripts', name),
      name.endsWith('.mjs') ? "console.log('isolated-runtime');\n" : '# isolated helper\n',
    );
  git('add', 'scripts');
  git('commit', '-m', 'isolated source');
  const head = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', head);
  return { root, git, head };
}
test('runtime uses exact published Git bytes, includes Python helper, and survives source directory removal', (t) => {
  const f = fixture(t),
    runtime = publishCleanupRuntime(f.root, { expectedHead: f.head });
  assert.ok(runtime.manifest.files['scripts/task-cleanup-delete.py']);
  assert.equal(publishCleanupRuntime(f.root, { expectedHead: f.head }).reused, true);
  rmSync(path.join(f.root, 'scripts'), { recursive: true });
  assert.equal(verifyCleanupRuntime(runtime.directory).sourceHead, f.head);
  const result = execFileSync(
    process.execPath,
    [path.join(runtime.directory, 'scripts/task-cleanup-scheduled-cli.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(result.trim(), 'isolated-runtime');
  writeFileSync(path.join(runtime.directory, 'scripts/task-cleanup-delete.py'), '# changed\n');
  assert.throws(() => verifyCleanupRuntime(runtime.directory), /input changed/);
});
test('candidate branch, dirty main and different tracking identity cannot publish a runtime', (t) => {
  const f = fixture(t);
  f.git('switch', '-c', 'codex/fixture');
  assert.throws(() => publishCleanupRuntime(f.root, { expectedHead: f.head }), /published main/);
  f.git('switch', 'main');
  writeFileSync(path.join(f.root, 'untracked'), 'keep');
  assert.throws(() => publishCleanupRuntime(f.root, { expectedHead: f.head }), /clean/);
  rmSync(path.join(f.root, 'untracked'));
  f.git('update-ref', '-d', 'refs/remotes/origin/main');
  assert.throws(() => publishCleanupRuntime(f.root, { expectedHead: f.head }));
});
test('real cleanup runtime cold-imports its full module closure after original scripts disappear', (t) => {
  const f = fixture(t),
    source = path.dirname(fileURLToPath(import.meta.url));
  cpSync(source, path.join(f.root, 'scripts'), { recursive: true });
  f.git('add', 'scripts');
  f.git('commit', '-m', 'isolated actual runtime closure');
  const head = f.git('rev-parse', 'HEAD');
  f.git('update-ref', 'refs/remotes/origin/main', head);
  const runtime = publishCleanupRuntime(f.root, { expectedHead: head });
  rmSync(path.join(f.root, 'scripts'), { recursive: true });
  const url = pathToFileURL(path.join(runtime.directory, 'scripts/task-cleanup-scheduled-cli.mjs')).href;
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m=await import(${JSON.stringify(url)}); console.log(typeof m.runScheduledCleanup)`,
    ],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  assert.equal(result.trim(), 'function');
});
