// This policy is part of the frozen control plane. Candidate changes cannot widen it.
export const ACCEPTED_SOURCE_VERSION = 1;
export const ACCEPTED_SOURCE_CHECK = 'Accepted business snapshot';
export const ACCEPTED_SOURCE_WORKFLOW = '.github/workflows/accepted-source.yml';
const control = new Set([
  'AGENTS.md',
  '.codex/zdm-project-workflow.yaml',
  'scripts/accepted-source-policy.mjs',
  'scripts/accepted-source.mjs',
  'scripts/accepted-source-ci.mjs',
  'scripts/accepted-source-hook.mjs',
  ACCEPTED_SOURCE_WORKFLOW,
  'scripts/accepted-source-readiness.mjs',
  'docs/engineering/accepted-source-delivery.md',
]);
export function isTechnicalPath(file) {
  if (control.has(file)) return false;
  return (
    /^(?:scripts\/|tests\/|backend\/src\/test\/|ci\/|\.github\/workflows\/|docs\/engineering\/)/.test(file) ||
    [
      'docs/task-completion.md',
      'playwright.config.ts',
      'vite.e2e.config.mjs',
      '.husky/pre-commit',
      '.husky/pre-push',
    ].includes(file)
  );
}
export function assertSourcePath(file) {
  if (
    !file ||
    file.startsWith('/') ||
    file.split('/').some((p) => p === '..' || p === '.' || !p) ||
    /[\\\r\n\0]/.test(file)
  )
    throw Error('Unsafe accepted-source path');
}

// A strict subset of the existing technical exemptions, used only for new files.
export function isNewTechnicalPath(file) {
  return (
    isTechnicalPath(file) &&
    /^(?:tests\/|backend\/src\/test\/|scripts\/delivery-repairs\/|ci\/test-fixtures\/|docs\/engineering\/)/.test(file)
  );
}
