import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
  lstatSync,
  existsSync,
  readlinkSync,
  renameSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateTaskDependencies } from './task-dependencies.mjs';
import { ensureNodeModules, selectSharedNodeModules } from './dev-task.mjs';
const legacyDependencies = { privateOnly: false };

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
  ensureNodeModules(f.root, [{ path: f.owner }], legacyDependencies);
  assert.equal(realpathSync(path.join(f.root, 'node_modules')), realpathSync(f.modules));
  f.put(path.join(f.modules, 'vite/package.json'), { version: '0.5.0' });
  const original = readFileSync(path.join(f.modules, 'vite/package.json'), 'utf8');
  assert.throws(() => ensureNodeModules(f.root, [{ path: f.owner }], legacyDependencies), /实际安装版本与清单不一致/);
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
  assert.throws(() => ensureNodeModules(f.root, [{ path: f.owner }], legacyDependencies), /不会自动修改共享依赖/);
});
function enableParallel(f) {
  execFileSync('git', ['init', '-b', 'main', f.root], { stdio: 'pipe' });
  mkdirSync(path.join(f.root, '.codex'));
  writeFileSync(path.join(f.root, '.codex/zdm-project-workflow.yaml'), 'batch:\n  mode: parallel-independent\n');
}
test('parallel dependency startup never falls back to another worktree installation', (t) => {
  const f = fixture(t);
  enableParallel(f);
  const before = readFileSync(path.join(f.modules, 'vite/package.json'));
  assert.throws(() => ensureNodeModules(f.root, [{ path: f.owner }]), /并行任务缺少私有/);
  assert.equal(existsSync(path.join(f.root, 'node_modules')), false);
  assert.deepEqual(readFileSync(path.join(f.modules, 'vite/package.json')), before);
});
test('parallel dependency startup preserves both live and dangling foreign links', (t) => {
  for (const dangling of [false, true]) {
    const f = fixture(t);
    enableParallel(f);
    const target = dangling ? path.join(f.owner, 'missing') : f.modules,
      link = path.join(f.root, 'node_modules');
    symlinkSync(target, link);
    assert.throws(() => ensureNodeModules(f.root, [{ path: f.owner }]), /实体私有/);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readlinkSync(link), target);
  }
});
test('parallel dependency startup accepts a valid physical private installation', (t) => {
  const f = fixture(t);
  enableParallel(f);
  const own = path.join(f.root, 'node_modules');
  renameSync(f.modules, own);
  assert.equal(ensureNodeModules(f.root, [{ path: f.owner }]).modules, realpathSync(own));
});
test('lock-matching package versions cannot hide external package directories or manifests', (t) => {
  for (const mode of ['directory', 'manifest', 'nested']) {
    const f = fixture(t),
      foreign = path.join(f.owner, 'external-package');
    mkdirSync(foreign);
    writeFileSync(path.join(foreign, 'package.json'), '{"version":"1.0.0"}');
    if (mode === 'directory') {
      rmSync(path.join(f.modules, 'vite'), { recursive: true });
      symlinkSync(foreign, path.join(f.modules, 'vite'));
    } else if (mode === 'manifest') {
      rmSync(path.join(f.modules, 'vite/package.json'));
      symlinkSync(path.join(foreign, 'package.json'), path.join(f.modules, 'vite/package.json'));
    } else {
      const name = 'node_modules/vite/node_modules/nested';
      f.lock.packages[name] = f.entry;
      f.installed.packages[name] = f.entry;
      f.put(path.join(f.root, 'package-lock.json'), f.lock);
      f.put(path.join(f.modules, '.package-lock.json'), f.installed);
      mkdirSync(path.join(f.modules, 'vite/node_modules'));
      symlinkSync(foreign, path.join(f.modules, 'vite/node_modules/nested'));
    }
    const before = readFileSync(path.join(foreign, 'package.json'));
    assert.throws(() => validateTaskDependencies(f.root, f.modules), /不能证明私有隔离/);
    assert.deepEqual(readFileSync(path.join(foreign, 'package.json')), before);
  }
});
test('an external installation index is rejected without changing the link or its target', (t) => {
  const f = fixture(t),
    file = path.join(f.modules, '.package-lock.json'),
    target = path.join(f.owner, 'external-index.json');
  renameSync(file, target);
  symlinkSync(target, file);
  const before = readFileSync(target);
  assert.throws(() => validateTaskDependencies(f.root, f.modules), /安装清单指向依赖目录之外/);
  assert.equal(readlinkSync(file), target);
  assert.deepEqual(readFileSync(target), before);
});
