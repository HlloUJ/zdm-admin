import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const applicationPaths = [
  'src/',
  'backend/',
  'public/',
  'tests/',
  'infrastructure/',
  'docker-compose.task.yml',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'index.html',
  'supply-chain.html',
];

function git(root, args, options = {}) {
  return execFileSync('git', ['--no-replace-objects', '-C', root, ...args], {
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}
const line = (root, args) => git(root, args, { encoding: 'utf8' }).trim();
const commitId = /^[a-f0-9]{40}$/;

export function composeFixedAcceptance(root, { active, main, pending }) {
  assert.match(active, commitId);
  assert.match(main, commitId);
  assert.ok(pending.length > 0 && pending.length <= 100);
  assert.equal(new Set(pending.map((member) => member.task)).size, pending.length);
  assert.equal(line(root, ['rev-parse', 'origin/main']), main);
  const directory = mkdtempSync(path.join(tmpdir(), 'fixed-acceptance-index-'));
  const commitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Fixed Acceptance',
    GIT_AUTHOR_EMAIL: 'preview@localhost',
    GIT_COMMITTER_NAME: 'Fixed Acceptance',
    GIT_COMMITTER_EMAIL: 'preview@localhost',
  };
  const indexEnv = { ...commitEnv, GIT_INDEX_FILE: path.join(directory, 'index') };
  const createCommit = (tree, parent, message) =>
    git(root, ['commit-tree', tree, '-p', parent, '-m', message], { encoding: 'utf8', env: commitEnv }).trim();
  let next = active;
  const members = [];
  try {
    for (const member of pending) {
      assert.match(member.head, commitId);
      assert.match(member.completion, /^[a-f0-9]{64}$/);
      assert.equal(
        line(member.worktree, ['status', '--porcelain']),
        '',
        'Development workspace changed: ' + member.task,
      );
      assert.equal(
        line(member.worktree, ['rev-parse', 'HEAD']),
        member.head,
        'Development HEAD changed: ' + member.task,
      );
      const base = line(root, ['merge-base', '--all', main, member.head]);
      assert.match(base, commitId, 'Unique development merge base required');
      const files = git(root, ['diff', '--name-only', '-z', base, member.head, '--', ...applicationPaths], {
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean);
      for (const file of files) {
        assert.ok(
          !/(?:^|\/)(?:\.env(?!\.example$)|.*\.(?:pem|key)$|data-environment\.json$)/i.test(file),
          'Private application input refused',
        );
        const entry = line(root, ['ls-tree', member.head, '--', file]);
        assert.ok(!entry || /^(100644|100755) blob /.test(entry), 'Fixed acceptance only accepts regular source files');
      }
      const patch = git(root, ['diff', '--binary', base, member.head, '--', ...applicationPaths]);
      assert.ok(patch.byteLength > 0, 'No application inputs found for ' + member.task);
      git(root, ['read-tree', base], { env: indexEnv });
      git(root, ['apply', '--cached', '--binary', '-'], { env: indexEnv, input: patch });
      const tree = git(root, ['write-tree'], { env: indexEnv, encoding: 'utf8' }).trim();
      const projection = createCommit(tree, base, 'Fixed acceptance application delta: ' + member.task);
      const merged = spawnSync(
        'git',
        [
          '--no-replace-objects',
          '-C',
          root,
          'merge-tree',
          '--write-tree',
          '--name-only',
          '--merge-base=' + base,
          next,
          projection,
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: 'pipe' },
      );
      assert.equal(
        merged.status,
        0,
        'Fixed acceptance source conflict for ' + member.task + '\n' + merged.stdout + merged.stderr,
      );
      const combinedTree = merged.stdout.split('\n')[0];
      assert.match(combinedTree, commitId);
      next = createCommit(combinedTree, next, 'Preview only: ' + member.task + ' at ' + member.head);
      members.push({ ...member, base });
    }
    for (const member of members) {
      assert.equal(line(member.worktree, ['status', '--porcelain']), '');
      assert.equal(line(member.worktree, ['rev-parse', 'HEAD']), member.head);
    }
    assert.equal(line(root, ['rev-parse', 'origin/main']), main);
    const changed = line(root, ['diff', '--name-only', active, next]).split('\n').filter(Boolean);
    return {
      previewOnly: true,
      active,
      main,
      candidate: next,
      members,
      tree: line(root, ['rev-parse', next + '^{tree}']),
      affectedBackend: changed.some((file) => /^(?:backend\/|infrastructure\/|docker-compose)/.test(file)),
      migrations: changed.filter((file) => file.startsWith('backend/src/main/resources/db/migration/')),
      changed,
    };
  } finally {
    rmSync(directory, { recursive: true });
  }
}
