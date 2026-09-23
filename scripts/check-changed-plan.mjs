import path from 'node:path';

import { createBackendTestPlan } from './backend-test-plan.mjs';
import { createScriptTestPlan } from './script-test-plan.mjs';
import { createBrowserTestPlan } from './affected-test-inputs.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';

const SCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.vue'];
const TYPECHECK_EXTENSIONS = ['.ts', '.tsx', '.vue'];

const hasExtension = (file, extensions) => extensions.some((extension) => file.endsWith(extension));
const isFrontendFile = (file) => !file.startsWith('backend/') && !file.startsWith('dist/');

export function normalizeFiles(root, files) {
  return [
    ...new Set(
      files.map((file) => {
        if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('Invalid changed-file path');
        const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
        const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
        if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative))
          throw new Error(`Changed-file path is outside the project or names its root: ${JSON.stringify(file)}`);
        return relative;
      }),
    ),
  ].sort();
}

export function createValidationPlan(files, fileExists = () => true, { root } = {}) {
  const existingFiles = files.filter(fileExists);
  const backendPlan = createBackendTestPlan(files, fileExists, { root });
  const backendTask = {
    name: 'backend tests',
    reason: backendPlan.reason,
    args: [
      'run',
      'backend:test',
      ...(backendPlan.mode === 'targeted' ? ['--', `-Dtest=${backendPlan.tests.join(',')}`] : []),
    ],
  };
  const browserPlan = createBrowserTestPlan(files, root, fileExists);
  const e2eFiles = browserPlan.tests;

  // Business sources and script consumers have dedicated affected planners. Shared execution
  // configuration and otherwise unknown inputs use the same conservative policy as delivery/CI.
  const unscopedInputs = files.filter(
    (file) =>
      !/^(?:src|tests\/e2e|public|backend)\//.test(file) &&
      !(file.startsWith('scripts/') && hasExtension(file, SCRIPT_EXTENSIONS)),
  );
  if (unscopedInputs.some((file) => classifyChangedFiles([file]).full)) {
    return {
      tasks: [{ name: 'shared configuration checks', args: ['run', 'verify:local'], kind: 'orchestration' }],
      e2eFiles: [],
      browserPlan: { mode: 'none', tests: [], reason: 'Browser coverage is included in the full local gate.' },
      backendPlan: { mode: 'full', files: unscopedInputs, tests: [], reason: 'Shared or unknown execution input.' },
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
      !file.startsWith('scripts/') &&
      !file.startsWith('tests/e2e/') &&
      (file.includes('/__tests__/') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)),
  );
  const removedUnitInput = files.some(
    (file) => file.startsWith('src/') && hasExtension(file, TYPECHECK_EXTENSIONS) && !fileExists(file),
  );
  const relatedSourceFiles = existingFiles.filter(
    (file) => file.startsWith('src/') && !unitTestFiles.includes(file) && hasExtension(file, TYPECHECK_EXTENSIONS),
  );
  const tasks = [];
  if (files.some((file) => file.startsWith('src/')))
    tasks.push({ name: 'source guards', args: ['run', 'test:source-guards'] });
  if (files.some((file) => file.startsWith('scripts/') && hasExtension(file, SCRIPT_EXTENSIONS))) {
    const scriptPlan = createScriptTestPlan(files, root);
    tasks.push({
      name: 'script tests',
      reason: scriptPlan.reason,
      args:
        scriptPlan.mode === 'targeted'
          ? ['run', 'test:scripts:files', '--', ...scriptPlan.tests]
          : ['run', 'test:scripts'],
    });
  }

  if (typecheckNeeded) tasks.push({ name: 'typecheck', args: ['run', 'typecheck:cached'] });
  if (lintFiles.length > 0) {
    tasks.push({ name: 'eslint', args: ['run', 'lint:changed', '--', ...lintFiles] });
  }
  if (styleFiles.length > 0) {
    tasks.push({ name: 'stylelint', args: ['run', 'stylelint:changed', '--', ...styleFiles] });
  }
  if (removedUnitInput) {
    tasks.push({
      name: 'unit tests',
      reason: 'Deleted or renamed frontend input cannot prove its former unit-test consumers; run the full unit suite.',
      args: ['run', 'test:unit'],
    });
  } else if (relatedSourceFiles.length > 0) {
    // Vitest selects a changed test itself as well as consumers of changed sources.
    // Query their union once so editing source + its test does not execute that test twice.
    tasks.push({
      name: 'related unit tests',
      args: ['run', 'test:related', '--', ...new Set([...relatedSourceFiles, ...unitTestFiles])],
    });
  } else if (unitTestFiles.length > 0) {
    tasks.push({ name: 'unit tests', args: ['run', 'test:unit', '--', ...unitTestFiles] });
  }
  if (backendPlan.mode !== 'none') tasks.push(backendTask);

  return { tasks, e2eFiles, browserPlan, backendPlan };
}
