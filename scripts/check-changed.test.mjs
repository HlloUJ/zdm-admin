import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectChangedFiles, main, parseChangedArgs } from './check-changed.mjs';
import { createValidationPlan, normalizeFiles } from './check-changed-plan.mjs';
import { captureSource } from './verification-evidence.mjs';

const entry = fileURLToPath(new URL('./check-changed.mjs', import.meta.url));
const silent = { report: () => {} };

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-changed-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const write = (file, content = 'export const value = 1;\n') => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'changed-paths@example.invalid');
  git('config', 'user.name', 'Changed path fixture');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.quotePath', 'true');
  write('README.md', 'fixture\n');
  write('.gitignore', '.task-verification/\n.task-runtime/\n');
  const commit = () => {
    git('add', '--all');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  };
  commit();
  return { root, git, write, commit };
}

test('real Git NUL discovery preserves Unicode, whitespace, newlines, quotes and both rename paths', (t) => {
  const f = fixture(t);
  const tracked = ['src/中文.ts', 'src/space name.ts', 'src/tab\tname.ts', 'src/line\nname.ts', 'src/quote"name.ts'];
  const removed = 'backend/src/main/java/已删除 Service.java';
  const renamed = 'src/旧名称.ts';
  for (const file of [...tracked, removed, renamed]) f.write(file);
  f.commit();
  for (const file of tracked) f.write(file, 'export const value = 2;\n');
  f.git('add', '--', tracked[0], tracked[2]);
  f.git('rm', '--', removed);
  const destination = 'src/新名称\n"副本".ts';
  f.git('mv', '--', renamed, destination);
  const untracked = 'src/新建 \t\n"文件".vue';
  f.write(untracked, '<template />\n');
  const expected = [...tracked, removed, renamed, destination, untracked].sort();

  // The former line parser receives Git-quoted Unicode and control characters, not real paths.
  const oldDiscovered = f.git('diff', '--name-only', '--diff-filter=ACMRD', 'HEAD').split(/\r?\n/).filter(Boolean);
  assert.ok(!oldDiscovered.includes(tracked[0]));
  assert.ok(!oldDiscovered.includes(tracked[3]));
  assert.deepEqual(collectChangedFiles(f.root), expected);
  const plan = createValidationPlan(collectChangedFiles(f.root), (file) => existsSync(path.join(f.root, file)));
  assert.ok(plan.tasks.some((task) => task.name === 'typecheck'));
  assert.ok(plan.tasks.some((task) => task.name === 'backend tests'));
  const lint = plan.tasks.find((task) => task.name === 'eslint');
  for (const file of [...tracked, destination, untracked]) assert.ok(lint.args.includes(file));
  assert.ok(!lint.args.includes(renamed));
});

test('real Git source deletions and renames run one full unit suite instead of partial selectors', (t) => {
  for (const extension of ['ts', 'tsx', 'vue']) {
    for (const rename of [false, true]) {
      const f = fixture(t);
      const previous = `src/旧输入.${extension}`;
      const next = `src/新输入.${extension}`;
      const existing = 'src/retained.ts';
      const testFile = 'src/retained.test.ts';
      for (const file of [previous, existing, testFile]) f.write(file);
      f.commit();
      if (rename) f.git('mv', '--', previous, next);
      else f.git('rm', '--', previous);
      f.write(existing, 'export const value = 2;\n');
      f.write(testFile, 'export const value = 2;\n');
      const files = collectChangedFiles(f.root);
      assert.deepEqual(files, [previous, ...(rename ? [next] : []), existing, testFile].sort());
      const plan = createValidationPlan(files, (file) => existsSync(path.join(f.root, file)));
      const unitTasks = plan.tasks.filter(
        (task) => task.args.includes('test:unit') || task.args.includes('test:related'),
      );
      assert.equal(unitTasks.length, 1);
      assert.deepEqual(unitTasks[0].args, ['run', 'test:unit']);
      assert.match(unitTasks[0].reason, /Deleted or renamed/);
    }
  }
});

test('real Git existing source edits retain related unit-test selection', (t) => {
  const f = fixture(t);
  const file = 'src/现有输入.vue';
  f.write(file, '<template>before</template>\n');
  f.commit();
  f.write(file, '<template>after</template>\n');
  const files = collectChangedFiles(f.root);
  assert.deepEqual(files, [file]);
  const plan = createValidationPlan(files, (candidate) => existsSync(path.join(f.root, candidate)));
  assert.ok(!plan.tasks.some((task) => task.args.includes('test:unit')));
  assert.deepEqual(plan.tasks.find((task) => task.name === 'related unit tests').args, [
    'run',
    'test:related',
    '--',
    file,
  ]);
});

test('staged and unstaged changes cannot cancel each other out of discovery', (t) => {
  const f = fixture(t);
  f.write('src/partial.ts', 'original\n');
  f.commit();
  f.write('src/partial.ts', 'staged\n');
  f.git('add', '--', 'src/partial.ts');
  f.write('src/partial.ts', 'original\n');
  assert.equal(f.git('diff', '--name-only', 'HEAD'), '');
  assert.deepEqual(collectChangedFiles(f.root), ['src/partial.ts']);
});

test('a Git discovery failure is never reported as an empty successful list', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-changed-nonrepo-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [entry, '--list'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot establish changed files/);
  assert.doesNotMatch(result.stdout, /No changed files|checks passed/);
});

test('a genuinely clean repository succeeds without validation execution', async (t) => {
  const f = fixture(t);
  assert.deepEqual(collectChangedFiles(f.root), []);
  const messages = [];
  assert.equal(
    await main([], {
      root: f.root,
      report: (value) => messages.push(value),
      run: () => assert.fail('No check needed'),
    }),
    0,
  );
  assert.deepEqual(messages, ['No changed files require validation.']);
});

test('list mode does not capture fingerprints, execute checks or write evidence', async (t) => {
  const f = fixture(t);
  f.write('backend/src/main/java/example/NewService.java');
  const before = {
    status: f.git('status', '--porcelain=v1', '-z'),
    index: readFileSync(path.join(f.root, '.git/index')),
  };
  assert.equal(
    await main(['--list'], {
      root: f.root,
      ...silent,
      capture: () => assert.fail('List mode must not capture fingerprints'),
      run: () => assert.fail('List mode must not run checks'),
    }),
    0,
  );
  assert.equal(f.git('status', '--porcelain=v1', '-z'), before.status);
  assert.deepEqual(readFileSync(path.join(f.root, '.git/index')), before.index);
  assert.ok(!readdirSync(f.root).some((file) => ['.task-verification', '.task-runtime'].includes(file)));
});

test('unknown options and invalid explicit paths fail instead of shrinking the requested scope', async (t) => {
  const f = fixture(t);
  f.write('src/valid.ts');
  for (const arg of ['--unknown', '-x']) assert.throws(() => parseChangedArgs([arg]), /Unknown argument/);
  for (const file of ['', '.', '..', '../outside.ts', path.resolve(f.root, '../outside.ts')])
    assert.throws(() => normalizeFiles(f.root, ['src/valid.ts', file]), /Invalid|outside/);
  for (const file of ['src', 'src/not-found.ts', '../outside.ts'])
    await assert.rejects(main(['--list', 'src/valid.ts', file], { root: f.root, ...silent }), /file|outside/);
});

test('explicit file selection preserves deleted files and literal dash-prefixed names', async (t) => {
  const f = fixture(t);
  f.write('src/removed.ts');
  f.commit();
  f.git('rm', '--', 'src/removed.ts');
  f.write('--literal.ts');
  f.write('backend/src/main/java/Other.java');
  assert.deepEqual(parseChangedArgs(['--list', '--', '--literal.ts']).files, ['--literal.ts']);
  assert.deepEqual(normalizeFiles(f.root, ['src/removed.ts', path.join(f.root, 'src/removed.ts')]), ['src/removed.ts']);
  const messages = [];
  assert.equal(await main(['--list', 'src/removed.ts'], { root: f.root, report: (value) => messages.push(value) }), 0);
  assert.ok(messages.some((value) => value.includes('typecheck')));
  assert.ok(!messages.some((value) => value.includes('backend:test')));
  assert.equal(await main(['--list', '--', '--literal.ts'], { root: f.root, ...silent }), 0);
});

test('actual execution retains exact path arguments and force policy', async (t) => {
  const f = fixture(t);
  const file = 'src/中文 \n"组件".ts';
  f.write(file);
  const calls = [];
  assert.equal(
    await main(['--force', file], {
      root: f.root,
      ...silent,
      run: async (task, options) => {
        calls.push({ task, options });
        return { exitCode: 0 };
      },
    }),
    0,
  );
  assert.ok(calls.find(({ task }) => task.name === 'eslint').task.args.includes(file));
  assert.ok(calls.every(({ options }) => options.force));
});

test('candidate changes during planning or before checks remain blocked', async (t) => {
  for (const mutationCapture of [2, 3]) {
    const f = fixture(t);
    f.write('src/change.ts');
    let captures = 0;
    await assert.rejects(
      main([], {
        root: f.root,
        ...silent,
        capture: (root) => {
          if (++captures === mutationCapture) f.write('src/change.ts', 'changed during planning\n');
          return captureSource(root);
        },
        run: () => assert.fail('Changed candidate must not execute planned checks'),
      }),
      /Candidate changed (during|after) changed-file planning/,
    );
  }
});

test('candidate mutations and unsuccessful checks cannot report success', async (t) => {
  for (const mutate of [false, true]) {
    const f = fixture(t);
    f.write('src/change.ts');
    const messages = [];
    const result = main([], {
      root: f.root,
      report: (value) => messages.push(value),
      run: async () => {
        if (mutate) f.write('src/change.ts', 'changed by a checker\n');
        return { exitCode: mutate ? 0 : 1 };
      },
    });
    if (mutate) await assert.rejects(result, /Candidate changed across changed-file checks/);
    else assert.equal(await result, 1);
    assert.ok(!messages.includes('Changed-file checks passed.'));
  }
});

test('shared configuration delegates failure evidence to the full verifier domains', async (t) => {
  const f = fixture(t);
  f.write('docker-compose.yml', 'services: {}\n');
  const tasks = [];
  const code = await main(['docker-compose.yml'], {
    root: f.root,
    report: () => {},
    run: async (task) => {
      tasks.push(task);
      return { exitCode: 0 };
    },
  });
  assert.equal(code, 0);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].kind, 'orchestration');
  assert.equal(tasks[0].reuse, false);
  assert.deepEqual(tasks[0].args, ['run', 'verify:local']);
});
