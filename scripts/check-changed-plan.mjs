import path from 'node:path';

const SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue'];
const TYPECHECK_EXTENSIONS = ['.ts', '.tsx', '.vue'];

const hasExtension = (file, extensions) => extensions.some((extension) => file.endsWith(extension));
const isFrontendFile = (file) => !file.startsWith('backend/') && !file.startsWith('dist/');

export function normalizeFiles(root, files) {
  return [
    ...new Set(
      files
        .map((file) => {
          const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
          const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
          return relative.startsWith('../') ? null : relative;
        })
        .filter(Boolean),
    ),
  ].sort();
}

export function createValidationPlan(files, fileExists = () => true) {
  const existingFiles = files.filter(fileExists);
  const dependencyFiles = files.filter((file) => file === 'package.json' || file === 'package-lock.json');
  const backendFiles = files.filter((file) => file.startsWith('backend/'));
  const e2eFiles = existingFiles.filter((file) => file.startsWith('tests/e2e/') && file.endsWith('.spec.ts'));

  if (dependencyFiles.length > 0) {
    return {
      tasks: [
        { name: 'frontend quality', args: ['run', 'quality'] },
        { name: 'frontend build', args: ['run', 'build:app'] },
        ...(backendFiles.length > 0 ? [{ name: 'backend tests', args: ['run', 'backend:test:docker'] }] : []),
      ],
      e2eFiles,
    };
  }

  const lintFiles = existingFiles.filter((file) => isFrontendFile(file) && hasExtension(file, SCRIPT_EXTENSIONS));
  const styleFiles = existingFiles.filter((file) => file.startsWith('src/') && hasExtension(file, ['.css', '.vue']));
  const typecheckNeeded = files.some(
    (file) =>
      (isFrontendFile(file) && hasExtension(file, TYPECHECK_EXTENSIONS)) ||
      file.startsWith('tsconfig') ||
      file.startsWith('vite.config') ||
      file.startsWith('vitest.config') ||
      file.startsWith('playwright.config'),
  );
  const unitTestFiles = existingFiles.filter(
    (file) =>
      !file.startsWith('tests/e2e/') && (file.includes('/__tests__/') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)),
  );
  const relatedSourceFiles = existingFiles.filter(
    (file) => file.startsWith('src/') && !file.includes('/__tests__/') && hasExtension(file, TYPECHECK_EXTENSIONS),
  );
  const tasks = [];

  if (typecheckNeeded) tasks.push({ name: 'typecheck', args: ['run', 'typecheck:cached'] });
  if (lintFiles.length > 0) {
    tasks.push({ name: 'eslint', args: ['run', 'lint:changed', '--', ...lintFiles] });
  }
  if (styleFiles.length > 0) {
    tasks.push({ name: 'stylelint', args: ['run', 'stylelint:changed', '--', ...styleFiles] });
  }
  if (unitTestFiles.length > 0) {
    tasks.push({ name: 'unit tests', args: ['run', 'test:unit', '--', ...unitTestFiles] });
  } else if (relatedSourceFiles.length > 0) {
    tasks.push({ name: 'related unit tests', args: ['run', 'test:related', '--', ...relatedSourceFiles] });
  }
  if (backendFiles.length > 0) {
    tasks.push({ name: 'backend tests', args: ['run', 'backend:test:docker'] });
  }

  return { tasks, e2eFiles };
}
