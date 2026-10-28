import { businessImpact } from './business-regression.mjs';
import { isRuntimeFile } from './runtime-file-scope.mjs';
import { engineeringOnlyProof } from './engineering-impact.mjs';
// Fail closed: this only omits a domain after every changed path has a known scope.
const DOC = /(?:\.md$|^docs\/.*\.(?:png|jpe?g|gif|webp|svg|pdf)$)/i;
const FRONTEND = /^(?:src\/|tests\/e2e\/|public\/)/;
const FRONTEND_CONFIG =
  /^(?:vite|vitest|playwright|eslint|tsconfig|stylelint|prettier)(?:[./-]|$)|^\.(?:prettier|stylelint|eslint)/;
// Product state / lifecycle contracts span API, shared adapters and three terminals.
const PRODUCT =
  /^(?:backend\/src\/main\/java\/com\/zdm\/platform\/inventory\/|src\/(?:pages\/(?:finished-stock\/|slab\/(?:management|supply-chain|shared)\/)|modules\/accessory\/|composables\/useCommodityModule|services\/(?:finishedProducts|accessoryProducts|slabs|storeFinishedStock|storeAccessoryStock|productStateActivity)))/;
const SENSITIVE = /(?:auth|security|permission|functionCatalog|adminPermissions|contract|(?:^|\/)shared(?:\/|$))/i;
const BACKEND_SHARED = /\/(?:config|dto|api|contract|web|exception)\/|Application\.java$/;
const BACKEND_CONTRACT = /(?:Controller|Request|Response|Dto|DTO)\.java$|^backend\/src\/main\/resources\//;

export function classifyChangedFiles(files, { engineeringProof = { proven: false }, root = process.cwd() } = {}) {
  const result = {
    frontend: false,
    backend: false,
    engineering: !engineeringProof.proven,
    docsOnly: false,
    full: false,
    runtime: false,
    reasons: [],
  };
  const engineeringScope = engineeringOnlyProof(root, files);
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
  if (businessImpact(root, files).length) full('实际反向调用链关联商品跨端业务契约。', false);
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
    const runtime = isRuntimeFile(file);
    if (
      engineeringScope.proven &&
      (engineeringScope.files.includes(file) || file === 'scripts/test-domain-manifest.json')
    ) {
      result.engineering = true;
      result.runtime ||= runtime;
      result.reasons.push(engineeringScope.reason + ': ' + file);
    } else if (PRODUCT.test(file)) {
      full(`商品状态与生命周期跨端契约：${file}`, runtime);
    } else if (FRONTEND.test(file)) {
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
  result.docsOnly = docs && !result.frontend && !result.backend && !engineeringScope.proven;
  if (result.docsOnly) result.reasons.push('仅文档及明确的文档资产；执行格式检查。');
  return result;
}
