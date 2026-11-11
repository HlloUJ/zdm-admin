import assert from 'node:assert/strict';
import test from 'node:test';
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  lstatSync,
  readlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareTaskArtifacts } from './task-artifacts.mjs';
function fixture(t, dependency = false) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'task-artifacts-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const deps = dependency ? { example: '1.0.0' } : {};
  const packages = {
    '': { dependencies: deps },
    ...(dependency
      ? { 'node_modules/example': { version: '1.0.0', resolved: 'fixture:example', integrity: 'fixture-integrity' } }
      : {}),
  };
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: deps }));
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  const task = { version: 2, id: 'fixture', worktree: root, branch: 'codex/fixture' };
  function installed() {
    mkdirSync(path.join(root, 'node_modules/example'), { recursive: true });
    writeFileSync(path.join(root, 'node_modules/example/package.json'), '{"version":"1.0.0"}');
    writeFileSync(
      path.join(root, 'node_modules/.package-lock.json'),
      JSON.stringify({ packages: { 'node_modules/example': packages['node_modules/example'] } }),
    );
  }
  return { root, task, installed };
}
test('parallel artifact layouts have separate cache, reports, build and backend outputs', (t) => {
  const a = fixture(t),
    b = fixture(t);
  const first = prepareTaskArtifacts(a.task, { execute: () => assert.fail('no dependency install needed') });
  const second = prepareTaskArtifacts(b.task);
  for (const key of Object.keys(first.directories)) {
    assert.notEqual(first.directories[key], second.directories[key]);
    assert.ok(first.directories[key].startsWith(a.root + path.sep));
  }
});
test('a linked output or shared dependency install is refused without modifying the target', (t) => {
  const a = fixture(t),
    b = fixture(t);
  writeFileSync(path.join(b.root, 'keep'), 'keep');
  symlinkSync(b.root, path.join(a.root, 'dist'));
  assert.throws(() => prepareTaskArtifacts(a.task), /linked artifact/);
  rmSync(path.join(a.root, 'dist'));
  symlinkSync(b.root, path.join(a.root, 'node_modules'));
  assert.throws(() => prepareTaskArtifacts(a.task), /Shared dependency symlink/);
  assert.equal(readFileSync(path.join(b.root, 'keep'), 'utf8'), 'keep');
});
test('private install runs only in its own task and validates lock-indexed packages', (t) => {
  const f = fixture(t, true);
  let count = 0;
  const proof = prepareTaskArtifacts(f.task, {
    execute: (command, args, options) => {
      count++;
      assert.equal(command, 'npm');
      assert.deepEqual(args, ['ci']);
      assert.equal(options.cwd, f.root);
      f.installed();
      return { status: 0 };
    },
  });
  assert.equal(proof.dependencies.status, 'private-validated');
  assert.equal(count, 1);
  prepareTaskArtifacts(f.task, { execute: () => assert.fail('valid private install should be reused') });
});
test('failed installation preserves previous private contents and records failure', (t) => {
  const f = fixture(t, true);
  mkdirSync(path.join(f.root, 'node_modules'));
  writeFileSync(path.join(f.root, 'node_modules/keep'), 'original');
  assert.throws(() => prepareTaskArtifacts(f.task, { execute: () => ({ status: 1 }) }), /installation failed/);
  const receipt = JSON.parse(readFileSync(path.join(f.root, '.task-runtime/dependency-install-result.json')));
  assert.equal(receipt.exitCode, 1);
  assert.equal(readFileSync(path.join(receipt.backup, 'keep'), 'utf8'), 'original');
  assert.equal(existsSync(path.join(f.root, '.task-runtime/task-artifacts.json')), false);
});
test('dangling dependency links are preserved and refused before installation or readiness', (t) => {
  for (const dependency of [false, true]) {
    for (const install of [false, true]) {
      const f = fixture(t, dependency),
        target = path.join(f.root, 'absent-owner'),
        link = path.join(f.root, 'node_modules');
      symlinkSync(target, link);
      let invoked = 0;
      assert.throws(
        () =>
          prepareTaskArtifacts(f.task, {
            install,
            execute: () => {
              invoked++;
              return { status: 0 };
            },
          }),
        /Shared dependency symlink/,
      );
      assert.equal(invoked, 0);
      assert.ok(lstatSync(link).isSymbolicLink());
      assert.equal(readlinkSync(link), target);
      assert.equal(existsSync(path.join(f.root, '.task-runtime/task-artifacts.json')), false);
      assert.equal(existsSync(target), false);
    }
  }
});
