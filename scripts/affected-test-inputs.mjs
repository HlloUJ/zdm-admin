import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function sourceFiles(root, directory, pattern) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(root, file, pattern) : pattern.test(file) ? [file] : [];
  });
}
export function baselineSource(root, file) {
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Cannot prove baseline input: ${file}`);
    return result.stdout;
  };
  git(['ls-files', '--error-unmatch', '--', file]);
  const base = git(['merge-base', 'HEAD', 'refs/remotes/origin/main']).trim();
  return git(['show', `${base}:${file}`]);
}
export function importInputs(source) {
  return [
    ...source.matchAll(
      /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm,
    ),
  ]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .sort();
}
const PAGES = new Map([
  ['src/pages/slab/color/index.vue', 'tests/e2e/slab-color.spec.ts'],
  ['src/pages/slab/grade/index.vue', 'tests/e2e/slab-grade.spec.ts'],
]);
export function createBrowserTestPlan(files, root, fileExists = () => true) {
  const frontend = files.filter((file) => /^(?:src|public|tests\/e2e)\//.test(file));
  const direct = frontend.filter(
    (file) => file.startsWith('tests/e2e/') && file.endsWith('.spec.ts') && fileExists(file),
  );
  if (!frontend.length) return { mode: 'none', tests: [], reason: 'No frontend change.' };
  const full = (reason) => ({ mode: 'full', tests: [], reason });
  if (frontend.every((file) => direct.includes(file)))
    return { mode: 'targeted', tests: direct.sort(), reason: 'Explicit browser test changes.' };
  if (!root || frontend.some((file) => !PAGES.has(file) && !direct.includes(file)))
    return full('Unknown or shared frontend input.');
  try {
    const pages = frontend.filter((file) => PAGES.has(file));
    const inputs = sourceFiles(root, 'src', /\.(?:vue|[cm]?[jt]sx?)$/).map((file) => [
      file,
      readFileSync(path.join(root, file), 'utf8'),
    ]);
    if (inputs.some(([, source]) => /\bimport\.meta\.glob|\brequire\s*\(|\bimport\s*\(\s*(?!['"])[^\s]/.test(source)))
      return full('Dynamic frontend consumers cannot be proven.');
    for (const file of pages) {
      const current = readFileSync(path.join(root, file), 'utf8');
      const previous = baselineSource(root, file);
      if (JSON.stringify(importInputs(current)) !== JSON.stringify(importInputs(previous)))
        return full(`Page dependencies changed: ${file}`);
      const policy = (source) =>
        source
          .split('\n')
          .filter((line) => /permission|dataScope|\bcan\s*\(/i.test(line))
          .join('\n');
      if (policy(current) !== policy(previous)) return full(`Permission behavior requires full coverage: ${file}`);
      const consumers = inputs
        .filter(([consumer, source]) =>
          importInputs(source).some((specifier) => {
            specifier = specifier.replace(/[?#].*$/, '');
            const target = specifier.startsWith('@/')
              ? `src/${specifier.slice(2)}`
              : specifier.startsWith('.')
                ? path.posix.normalize(path.posix.join(path.posix.dirname(consumer), specifier))
                : null;
            return target === file;
          }),
        )
        .map(([consumer]) => consumer)
        .sort();
      if (JSON.stringify(consumers) !== JSON.stringify(['src/router/index.ts']))
        return full(`Page consumer set changed: ${file}`);
      if (!existsSync(path.join(root, PAGES.get(file)))) return full('Mapped browser test missing.');
    }
    return {
      mode: 'targeted',
      tests: [...new Set([...direct, ...pages.map((file) => PAGES.get(file))])].sort(),
      reason: 'Reviewed isolated route pages; imports, permissions and reverse consumers unchanged.',
    };
  } catch (error) {
    return full(error.message);
  }
}

export function proveFinishedSpecConsumers(root) {
  if (!root) return false;
  try {
    const directory = 'backend/src/main/java/com/zdm/platform/inventory/';
    const file = `${directory}FinishedSpecValidator.java`;
    const current = readFileSync(path.join(root, file), 'utf8');
    const previous = baselineSource(root, file);
    const imports = (source) => source.match(/^import .*;/gm) ?? [];
    if (
      !/^final class FinishedSpecValidator\s*\{/m.test(current) ||
      JSON.stringify(imports(current)) !== JSON.stringify(imports(previous))
    )
      return false;
    const inputs = sourceFiles(root, 'backend/src/main', /\.java$/).map((file) => [
      file,
      readFileSync(path.join(root, file), 'utf8'),
    ]);
    if (inputs.some(([, source]) => /Class\.forName|ClassLoader|MethodHandles|java\.lang\.reflect/.test(source)))
      return false;
    for (const [symbol, expected] of [
      ['FinishedSpecValidator', [`${directory}FinishedSpecValidator.java`, `${directory}FinishedProductService.java`]],
      [
        'FinishedProductService',
        [`${directory}FinishedProductService.java`, `${directory}FinishedProductController.java`],
      ],
    ]) {
      const actual = inputs
        .filter(([, source]) => new RegExp(`\\b${symbol}\\b`).test(source))
        .map(([file]) => file)
        .sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) return false;
    }
    return true;
  } catch {
    return false;
  }
}
