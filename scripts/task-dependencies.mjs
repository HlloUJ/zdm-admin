import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const sorted = (value) => Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
const matches = (allowed, actual) =>
  !allowed ||
  (!allowed.includes(`!${actual}`) && (!allowed.some((item) => !item.startsWith('!')) || allowed.includes(actual)));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Read only lock-indexed manifests, never walk/hash node_modules or modify a shared installation.
export function validateTaskDependencies(
  root,
  modules = path.join(root, 'node_modules'),
  {
    platform = process.platform,
    arch = process.arch,
    libc = platform === 'linux' ? (process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl') : null,
  } = {},
) {
  const manifest = readJson(path.join(root, 'package.json'));
  const lock = readJson(path.join(root, 'package-lock.json'));
  const installed = readJson(path.join(modules, '.package-lock.json'));
  if (!lock.packages?.[''] || !installed.packages) throw new Error('缺少可验证的 npm 安装清单');
  for (const field of dependencyFields) {
    if (JSON.stringify(sorted(manifest[field])) !== JSON.stringify(sorted(lock.packages[''][field])))
      throw new Error(`package.json 的 ${field} 与锁文件不一致`);
  }
  for (const [name, expected] of Object.entries(lock.packages)) {
    if (!name) continue;
    const platformSpecific = expected.os || expected.cpu || expected.libc;
    const compatible = matches(expected.os, platform) && matches(expected.cpu, arch) && matches(expected.libc, libc);
    if (!installed.packages[name] && (!expected.optional || (platformSpecific && compatible)))
      throw new Error(`安装清单缺少锁定依赖：${name}`);
  }
  let checked = 0;
  for (const [name, actual] of Object.entries(installed.packages)) {
    if (!name.startsWith('node_modules/') || name.includes('\\') || name.split('/').includes('..'))
      throw new Error(`不支持的安装路径：${name}`);
    const expected = lock.packages[name];
    if (!expected || expected.link || actual.link) throw new Error(`安装清单与锁文件不一致：${name}`);
    for (const field of ['version', 'resolved', 'integrity']) {
      if ((expected[field] ?? null) !== (actual[field] ?? null)) throw new Error(`安装版本与锁文件不一致：${name}`);
    }
    const relative = name.slice('node_modules/'.length);
    const packageFile = path.join(modules, relative, 'package.json');
    const packageManifest = readJson(packageFile);
    if (!actual.version || packageManifest.version !== actual.version)
      throw new Error(`实际安装版本与清单不一致：${name}`);
    checked += 1;
  }
  return { modules: realpathSync(modules), packagesChecked: checked };
}

export function compatibleTaskDependencies(root, modules) {
  if (!existsSync(modules)) return false;
  try {
    validateTaskDependencies(root, modules);
    return true;
  } catch {
    return false;
  }
}
