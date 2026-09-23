// Fail closed: this only omits a domain after every changed path has a known scope.
const DOC = /(?:\.md$|^docs\/.*\.(?:png|jpe?g|gif|webp|svg|pdf)$)/i;
const FRONTEND = /^(?:src\/|tests\/e2e\/|public\/)/;
const FRONTEND_CONFIG =
  /^(?:vite|vitest|playwright|eslint|tsconfig|stylelint|prettier)(?:[./-]|$)|^\.(?:prettier|stylelint|eslint)/;
const SENSITIVE = /(?:auth|security|permission|functionCatalog|adminPermissions|contract|(?:^|\/)shared(?:\/|$))/i;
const BACKEND_SHARED = /\/(?:config|dto|api|contract|web|exception)\/|Application\.java$/;
const BACKEND_CONTRACT = /(?:Controller|Request|Response|Dto|DTO)\.java$|^backend\/src\/main\/resources\//;
const RUNTIME_FILES = new Set([
  '.codex/zdm-project-workflow.yaml',
  'scripts/backend-runtime.mjs',
  'scripts/task-runtime-state.mjs',
  'scripts/dev-all.mjs',
  'scripts/dev-task.mjs',
  'scripts/ensure-backend.mjs',
  'scripts/run-integration.mjs',
  'scripts/sync-integration.mjs',
  'scripts/task-preview-service.mjs',
  'scripts/macos/launchd-dev.mjs',
  'scripts/macos/启动装点猫.command',
  'scripts/macos/停止装点猫.command',
  'scripts/macos/com.zdm.admin.dev.plist',
]);
const RUNTIME = /^(?:backend\/|docker(?:[./-]|$)|Dockerfile|compose[.-]|pom\.xml$|\.env(?:\.|$)|\.mvn\/)/;

export function classifyChangedFiles(files, { engineeringProof = { proven: false } } = {}) {
  const result = {
    frontend: false,
    backend: false,
    engineering: !engineeringProof.proven,
    docsOnly: false,
    full: false,
    runtime: false,
    reasons: [],
  };
  let docs = false;
  const full = (reason, runtime) => {
    result.frontend = result.backend = result.engineering = result.full = true;
    result.runtime ||= runtime;
    result.reasons.push(reason);
  };
  if (!Array.isArray(files) || files.length === 0) {
    full('无法证明有效变更范围，执行前后端完整门禁。', false);
    return result;
  }
  for (const original of [...new Set(files)]) {
    if (typeof original !== 'string' || !original || /^(?:\/|[A-Za-z]:)|(?:^|[/\\])\.\.(?:[/\\]|$)/.test(original)) {
      full('路径不明确，执行前后端完整门禁。', false);
      continue;
    }
    const file = original.replaceAll('\\', '/').replace(/^\.\//, '');
    if (DOC.test(file)) {
      docs = true;
      continue;
    }
    const runtime = !file.startsWith('backend/src/test/') && (RUNTIME.test(file) || RUNTIME_FILES.has(file));
    if (FRONTEND.test(file)) {
      if (SENSITIVE.test(file) || /^src\/services\//.test(file) || file === 'tests/e2e/admin-api-mocks.ts') {
        full(`共享契约、认证或权限：${file}`, false);
      } else {
        result.frontend = true;
        result.reasons.push(`前端：${file}`);
      }
    } else if (file.startsWith('backend/src/') && /\.java$/.test(file)) {
      if (
        SENSITIVE.test(file) ||
        BACKEND_CONTRACT.test(file) ||
        BACKEND_SHARED.test(file) ||
        file.includes('/common/')
      ) {
        full(`后端公共基础、认证权限或 API 契约：${file}`, runtime);
      } else {
        result.backend = true;
        result.runtime ||= runtime;
        result.reasons.push(`后端：${file}`);
      }
    } else if (runtime) {
      full(`后端配置、迁移或运行环境：${file}`, true);
    } else if (FRONTEND_CONFIG.test(file) || file === 'index.html') {
      full(`前端执行配置：${file}`, false);
    } else {
      full(`依赖、CI、验证工具或未知路径：${file}；未据此推断重挂运行环境。`, false);
    }
  }
  result.docsOnly = docs && !result.frontend && !result.backend;
  if (result.docsOnly) result.reasons.push('仅文档及明确的文档资产；执行格式检查。');
  return result;
}
