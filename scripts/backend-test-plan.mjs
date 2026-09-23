import { proveFinishedSpecConsumers } from './affected-test-inputs.mjs';

// Local affected checks only. Explicit full verification and applicable CI run the complete backend suite.
const MAIN = 'backend/src/main/java/com/zdm/platform/';
const TEST = 'backend/src/test/java/com/zdm/platform/';

// SlabLogChanges is package-private. Its callers are SlabOperationLogService and, transitively,
// ProductLifecycleService. Keep all inventory tests plus the existing cross-module API consumers.
// New mappings require a caller/consumer review; an unknown file must never narrow the suite.
const MAPPINGS = new Map([
  [MAIN + 'inventory/FinishedSpecValidator.java', 'finished-spec-validation'],
  [TEST + 'inventory/FinishedSpecValidatorTest.java', 'finished-spec-validation'],
  [MAIN + 'inventory/SlabLogChanges.java', 'slab-log-comparison'],
  [TEST + 'inventory/SlabLogChangesTest.java', 'slab-log-comparison'],
]);
const SLAB_LOG_TESTS = [
  'com.zdm.platform.inventory.*Test',
  'com.zdm.platform.PlatformApiSmokeTest',
  'com.zdm.platform.DataScopeApiTest',
  'com.zdm.platform.PlatformModuleBoundaryTest',
];

export function createBackendTestPlan(files, fileExists = () => true, { root } = {}) {
  const backendFiles = files.filter((file) => file.startsWith('backend/'));
  if (backendFiles.length === 0) {
    return { mode: 'none', reason: '没有后端变更。', files: [], tests: [] };
  }
  const full = (reason) => ({ mode: 'full', reason, files: backendFiles, tests: [] });
  const dependencies = files.filter((file) => ['package.json', 'package-lock.json'].includes(file));
  if (dependencies.length > 0) return full('依赖或执行入口同时变更，回退后端全量测试。');
  const missing = backendFiles.filter((file) => !fileExists(file));
  if (missing.length > 0) return full(`删除或重命名无法证明消费者范围，回退全量：${missing.join(', ')}`);
  const unmapped = backendFiles.filter((file) => !MAPPINGS.has(file));
  if (unmapped.length > 0) {
    return full(`公共基础、权限认证、API 契约、迁移依赖及未映射文件默认全量：${unmapped.join(', ')}`);
  }
  if (
    backendFiles.some((file) => MAPPINGS.get(file) === 'finished-spec-validation') &&
    !proveFinishedSpecConsumers(root)
  )
    return full('成品规格校验器的基线、依赖或实际消费者无法证明，回退全量。');
  return {
    mode: 'targeted',
    reason: '已审查的库存内部能力映射；保留全部 inventory、平台冒烟、数据范围及模块边界消费者测试。适用 CI 仍全量。',
    files: backendFiles,
    tests: SLAB_LOG_TESTS,
  };
}
