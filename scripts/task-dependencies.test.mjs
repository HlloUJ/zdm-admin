import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateTaskDependencies } from './task-dependencies.mjs';
import { ensureNodeModules, selectSharedNodeModules } from './dev-task.mjs';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'zdm-dependency-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'task');
  const owner = path.join(directory, 'owner');
  const modules = path.join(owner, 'node_modules');
  const put = (file, value) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value)}\n`);
  };
  const manifest = { name: 'task', scripts: { dev: 'vite' }, dependencies: { vite: '^1.0.0' } };
  const entry = { version: '1.0.0', integrity: 'sha512-fixture', resolved: 'https://example.invalid/vite.tgz' };
  const lock = { lockfileVersion: 3, packages: { '': manifest, 'node_modules/vite': entry } };
  const installed = { lockfileVersion: 3, packages: { 'node_modules/vite': entry } };
  put(path.join(root, 'package.json'), manifest);
  put(path.join(root, 'package-lock.json'), lock);
  put(path.join(modules, '.package-lock.json'), installed);
  put(path.join(modules, 'vite/package.json'), { name: 'vite', version: '1.0.0' });
  return { root, owner, modules, manifest, lock, installed, entry, put };
}

test('dependency reuse validates real installed versions and tolerates script/name-only manifest edits', (t) => {
  const f = fixture(t);
  f.manifest.name = 'renamed';
  f.manifest.scripts.dev = 'changed alias';
  f.put(path.join(f.root, 'package.json'), f.manifest);
  assert.equal(validateTaskDependencies(f.root, f.modules).packagesChecked, 1);
  assert.equal(selectSharedNodeModules({ root: f.root, worktrees: [{ path: f.owner }] }), f.modules);
  ensureNodeModules(f.root, [{ path: f.owner }]);
  assert.equal(realpathSync(path.join(f.root, 'node_modules')), realpathSync(f.modules));
  f.put(path.join(f.modules, 'vite/package.json'), { version: '0.5.0' });
  const original = readFileSync(path.join(f.modules, 'vite/package.json'), 'utf8');
  assert.throws(() => ensureNodeModules(f.root, [{ path: f.owner }]), /实际安装版本与清单不一致/);
  assert.equal(readFileSync(path.join(f.modules, 'vite/package.json'), 'utf8'), original);
  assert.equal(realpathSync(path.join(f.root, 'node_modules')), realpathSync(f.modules));
});

test('missing/stale installed records, missing packages and mismatched dependency ranges fail closed', (t) => {
  const f = fixture(t);
  f.manifest.dependencies.vite = '^2.0.0';
  f.put(path.join(f.root, 'package.json'), f.manifest);
  assert.throws(() => validateTaskDependencies(f.root, f.modules), /dependencies.*不一致/);
  f.manifest.dependencies.vite = '^1.0.0';
  f.put(path.join(f.root, 'package.json'), f.manifest);
  f.installed.packages['node_modules/vite'] = { ...f.entry, integrity: 'different' };
  f.put(path.join(f.modules, '.package-lock.json'), f.installed);
  assert.throws(() => validateTaskDependencies(f.root, f.modules), /安装版本与锁文件不一致/);
  f.installed.packages = {};
  f.put(path.join(f.modules, '.package-lock.json'), f.installed);
  assert.throws(() => validateTaskDependencies(f.root, f.modules), /缺少锁定依赖/);
  f.installed.packages = { 'node_modules/vite': f.entry };
  f.put(path.join(f.modules, '.package-lock.json'), f.installed);
  rmSync(path.join(f.modules, 'vite/package.json'));
  assert.throws(() => validateTaskDependencies(f.root, f.modules), /ENOENT/);
  rmSync(path.join(f.modules, '.package-lock.json'));
  assert.equal(selectSharedNodeModules({ root: f.root, worktrees: [{ path: f.owner }] }), null);
});

test('optional platform packages may be absent only outside this host platform, with generic optional omissions allowed', (t) => {
  const f = fixture(t);
  f.lock.packages['node_modules/native-linux'] = {
    version: '1',
    optional: true,
    os: ['linux'],
    cpu: ['x64'],
    libc: ['glibc'],
  };
  f.lock.packages['node_modules/optional-wasm'] = { version: '1', optional: true };
  f.put(path.join(f.root, 'package-lock.json'), f.lock);
  assert.equal(
    validateTaskDependencies(f.root, f.modules, { platform: 'darwin', arch: 'arm64', libc: null }).packagesChecked,
    1,
  );
  assert.throws(
    () => validateTaskDependencies(f.root, f.modules, { platform: 'linux', arch: 'x64', libc: 'glibc' }),
    /native-linux/,
  );
});

test('an existing broken shared link is reported without replacing or mutating it', (t) => {
  const f = fixture(t);
  symlinkSync(path.join(f.owner, 'missing'), path.join(f.root, 'node_modules'));
  assert.throws(() => ensureNodeModules(f.root, [{ path: f.owner }]), /不会自动修改共享依赖/);
});
