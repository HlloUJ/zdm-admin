// Pure path policy shared by runtime fingerprints and validation planning.
// It never reads business contracts or discovers repository consumers.
const RUNTIME_FILES = new Set([
  '.codex/zdm-project-workflow.yaml',
  'scripts/backend-runtime.mjs',
  'scripts/task-runtime-state.mjs',
  'scripts/dev-all.mjs',
  'scripts/dev-task.mjs',
  'scripts/ensure-backend.mjs',
  'scripts/run-integration.mjs',
  'scripts/sync-integration.mjs',
  'scripts/delivery-launcher.mjs',
  'scripts/integration-handoff-state.mjs',
  'scripts/task-preview-service.mjs',
  'scripts/macos/launchd-dev.mjs',
  'scripts/macos/启动装点猫.command',
  'scripts/macos/停止装点猫.command',
  'scripts/macos/com.zdm.admin.dev.plist',
]);
const RUNTIME = /^(?:backend\/|docker(?:[./-]|$)|Dockerfile|compose[.-]|pom\.xml$|\.env(?:\.|$)|\.mvn\/)/;

export function isRuntimeFile(original) {
  if (typeof original !== 'string' || !original || /^(?:\/|[A-Za-z]:)|(?:^|[/\\])\.\.(?:[/\\]|$)/.test(original))
    return false;
  const file = original.replaceAll('\\', '/').replace(/^\.\//, '');
  if (/(?:\.md$|^docs\/.*\.(?:png|jpe?g|gif|webp|svg|pdf)$)/i.test(file)) return false;
  return !file.startsWith('backend/src/test/') && (RUNTIME.test(file) || RUNTIME_FILES.has(file));
}
