<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>权限管理</t-breadcrumb-item>
              <t-breadcrumb-item>终端功能分配</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">平台统一下放</t-tag>
        </header>

        <section class="allocation-card">
          <t-tabs v-model="activeTerminal" class="terminal-tabs" :list="terminalTabs" @change="handleTerminalChange" />

          <div class="allocation-section">
            <div class="allocation-section__header">
              <h3>功能权限</h3>
              <div class="permission-shortcuts">
                <t-button
                  size="small"
                  variant="outline"
                  theme="primary"
                  :disabled="!currentModules.length"
                  @click="selectAllNodes"
                >
                  全选全部
                </t-button>
                <t-button size="small" variant="outline" :disabled="!currentModules.length" @click="clearAllNodes">
                  清空全部
                </t-button>
              </div>
            </div>

            <div class="permission-layout">
              <aside class="permission-module-list">
                <button
                  v-for="module in currentModules"
                  :key="module.value"
                  type="button"
                  class="permission-module-item"
                  :class="{ 'permission-module-item--active': module.value === activeModuleValue }"
                  @click="activeModuleValue = module.value"
                >
                  <span>{{ module.label }}</span>
                  <span
                    >{{ getSelectedCount(getModuleActionValues(module)) }}/{{
                      getModuleActionValues(module).length
                    }}</span
                  >
                </button>
                <div v-if="!currentModules.length" class="permission-module-empty">
                  <span>暂无功能模块</span>
                  <small>模块梳理并验证通过后，将显示在这里</small>
                </div>
              </aside>

              <div class="permission-matrix">
                <div class="permission-matrix__toolbar">
                  <div class="matrix-toolbar-right">
                    <t-checkbox
                      :checked="isModuleAllSelected(activeModule)"
                      :indeterminate="isModuleIndeterminate(activeModule)"
                      :disabled="!activeModule"
                      @change="toggleModule(activeModule, $event)"
                    >
                      全选当前模块
                    </t-checkbox>
                    <span v-if="activeModule" class="module-allocation-count">
                      已下放 {{ getSelectedCount(getModuleActionValues(activeModule)) }} /
                      {{ getModuleActionValues(activeModule).length }}
                    </span>
                    <span v-else class="module-allocation-count">暂无功能模块</span>
                  </div>
                </div>

                <div class="permission-matrix__table-wrap">
                  <table class="permission-matrix__table">
                    <thead>
                      <tr>
                        <th class="permission-menu-column">二级菜单</th>
                        <th class="permission-third-menu-column">三级菜单</th>
                        <th class="permission-page-column">页面</th>
                        <th class="permission-tab-column">Tab</th>
                        <th class="permission-action-column">操作权限</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in activeRows" :key="row.key">
                        <td v-if="row.showMenu" class="permission-menu-cell" :rowspan="row.menuRowspan">
                          <t-tag v-if="row.direct" class="permission-level-tag" variant="light">一级菜单直达</t-tag>
                          <span v-else class="permission-menu-name">{{ row.menuLabel }}</span>
                        </td>
                        <td v-if="row.showThirdMenu" class="permission-third-menu-cell" :rowspan="row.thirdMenuRowspan">
                          <span v-if="row.thirdMenuLabel" class="permission-third-menu-name">{{
                            row.thirdMenuLabel
                          }}</span>
                          <span v-else class="permission-empty-value">—</span>
                        </td>
                        <td v-if="row.showPage" class="permission-page-cell" :rowspan="row.pageRowspan">
                          <div class="permission-page-name">{{ row.pageLabel }}</div>
                          <div v-if="row.pageNote" class="permission-page-note">{{ row.pageNote }}</div>
                        </td>
                        <td class="permission-tab-cell">
                          <span v-if="row.tabLabels.length" class="permission-tab-text">
                            {{ row.tabLabels.join('、') }}
                          </span>
                          <span v-else class="permission-empty-value">—</span>
                        </td>
                        <td class="permission-action-cell">
                          <t-checkbox
                            v-if="row.actions.length"
                            class="permission-row-toggle"
                            size="small"
                            :checked="isRowAllSelected(row)"
                            :indeterminate="isRowIndeterminate(row)"
                            @change="toggleRow(row, $event)"
                          >
                            {{ row.selectionLabel }}
                          </t-checkbox>
                          <div v-if="row.actions.length" class="permission-action-grid">
                            <t-checkbox
                              v-for="action in row.actions"
                              :key="action.value"
                              :checked="isPermissionSelected(action.value)"
                              @change="togglePermission(row, action.value, $event)"
                            >
                              {{ action.label }}
                            </t-checkbox>
                          </div>
                          <span v-else class="permission-empty-action">暂无独立权限项</span>
                        </td>
                      </tr>
                      <tr v-if="!activeRows.length" class="permission-matrix-empty-row">
                        <td colspan="5">
                          <div class="permission-matrix-empty">
                            <strong>暂无功能目录数据</strong>
                            <span>完成一个业务模块的梳理、实现和验证后，再将该模块加入全量功能目录</span>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <footer class="page-actions">
            <t-button theme="primary" :loading="loading" :disabled="!currentModules.length" @click="saveAllocation">
              保存
            </t-button>
            <t-button theme="default" variant="base" :disabled="loading" @click="resetAllocation">重置</t-button>
          </footer>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { adminFeedback } from '@/components/foundation';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  collectFunctionCatalogRows,
  getRowViewPermissionValue,
  initialAllocationValues,
  normalizeTerminalPermissions,
  terminalFunctionTrees,
  terminalTabs,
  type FunctionCatalogRow,
  type FunctionModule,
  type TerminalType,
} from '@/services/functionCatalog';
import {
  listTerminalFunctionPolicies,
  saveTerminalFunctionPolicy,
  type TerminalFunctionPolicyRecord,
} from '@/services/terminalFunctionPolicies';

const activeTerminal = ref<TerminalType>('store');
const activeModuleValue = ref(terminalFunctionTrees.store[0]?.value ?? '');
const checkedValues = ref<string[]>([]);
const loading = ref(false);
const savedAllocationValues = reactive<Record<TerminalType, string[]>>({
  store: [...initialAllocationValues.store],
  supplier: [...initialAllocationValues.supplier],
});
const terminalPolicies = reactive<Partial<Record<TerminalType, TerminalFunctionPolicyRecord>>>({});

const currentTree = computed(() => terminalFunctionTrees[activeTerminal.value]);

const getCheckedValue = (checked: unknown) => {
  if (typeof checked === 'boolean') return checked;
  if (checked && typeof checked === 'object' && 'checked' in checked) {
    return Boolean((checked as { checked?: boolean }).checked);
  }

  return Boolean(checked);
};

const currentModules = computed<FunctionModule[]>(() => currentTree.value);
const activeModule = computed(
  () => currentModules.value.find((module) => module.value === activeModuleValue.value) ?? currentModules.value[0],
);

const getModuleActionValues = (module?: FunctionModule) =>
  Array.from(
    new Set(
      module?.menus.flatMap((menu) =>
        menu.pages.flatMap((page) => [
          ...page.actions.map((action) => action.value),
          ...page.tabs.flatMap((tab) => tab.actions.map((action) => action.value)),
        ]),
      ) ?? [],
    ),
  );

const activeRows = computed(() => collectFunctionCatalogRows(activeModule.value));
const allLeafValues = computed(() => Array.from(new Set(currentTree.value.flatMap(getModuleActionValues))));
const getRowActionValues = (row: FunctionCatalogRow) => row.actions.map((action) => action.value);
const getSelectedCount = (values: string[]) => values.filter((value) => checkedValues.value.includes(value)).length;

const setCheckedValues = (values: string[]) => {
  checkedValues.value = Array.from(new Set(values));
};

const setPermissionRange = (values: string[], checked: unknown) => {
  const isChecked = getCheckedValue(checked);
  const nextValues = isChecked
    ? [...checkedValues.value, ...values]
    : checkedValues.value.filter((value) => !values.includes(value));

  setCheckedValues(nextValues);
};

const isPermissionSelected = (value: string) => checkedValues.value.includes(value);
const isAllSelected = (values: string[]) => values.length > 0 && values.every(isPermissionSelected);
const isIndeterminate = (values: string[]) => {
  const selectedCount = getSelectedCount(values);
  return selectedCount > 0 && selectedCount < values.length;
};
const isRowAllSelected = (row: FunctionCatalogRow) => isAllSelected(getRowActionValues(row));
const isRowIndeterminate = (row: FunctionCatalogRow) => isIndeterminate(getRowActionValues(row));
const isModuleAllSelected = (module?: FunctionModule) => isAllSelected(getModuleActionValues(module));
const isModuleIndeterminate = (module?: FunctionModule) => isIndeterminate(getModuleActionValues(module));
const togglePermission = (row: FunctionCatalogRow, value: string, checked: unknown) => {
  const isChecked = getCheckedValue(checked);
  const viewPermission = getRowViewPermissionValue(row);
  if (!isChecked && value === viewPermission) {
    setPermissionRange(getRowActionValues(row), false);
    return;
  }
  setPermissionRange(isChecked && viewPermission ? [viewPermission, value] : [value], isChecked);
};
const toggleRow = (row: FunctionCatalogRow, checked: unknown) => setPermissionRange(getRowActionValues(row), checked);
const toggleModule = (module: FunctionModule | undefined, checked: unknown) =>
  setPermissionRange(getModuleActionValues(module), checked);

const handleTerminalChange = () => {
  checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
  activeModuleValue.value = terminalFunctionTrees[activeTerminal.value][0]?.value ?? '';
};

const selectAllNodes = () => {
  checkedValues.value = [...allLeafValues.value];
};

const clearAllNodes = () => {
  checkedValues.value = [];
};

const parsePermissions = (value?: string) => value?.split(',').filter(Boolean) ?? [];

const loadAllocation = async () => {
  loading.value = true;
  try {
    const policies = await listTerminalFunctionPolicies();
    (['store', 'supplier'] as TerminalType[]).forEach((terminal) => {
      const policy = policies.find((item) => item.terminal === terminal);
      if (policy) {
        terminalPolicies[terminal] = policy;
        savedAllocationValues[terminal] = normalizeTerminalPermissions(
          terminal,
          parsePermissions(policy.functionPermissions),
        );
      }
    });
    checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '终端功能配置加载失败');
  } finally {
    loading.value = false;
  }
};

const resetAllocation = () => {
  checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
  adminFeedback.info('已重置为上次保存状态');
};

const saveAllocation = async () => {
  const terminal = activeTerminal.value;
  loading.value = true;
  try {
    const saved = await saveTerminalFunctionPolicy(terminal, checkedValues.value.join(','));
    terminalPolicies[terminal] = saved;
    savedAllocationValues[terminal] = normalizeTerminalPermissions(
      terminal,
      parsePermissions(saved.functionPermissions),
    );
    checkedValues.value = [...savedAllocationValues[terminal]];
    adminFeedback.success('终端功能分配已保存');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    loading.value = false;
  }
};

watch(
  activeTerminal,
  () => {
    checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
    activeModuleValue.value = terminalFunctionTrees[activeTerminal.value][0]?.value ?? '';
  },
  { immediate: true },
);

onMounted(loadAllocation);
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.allocation-card {
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
}

.terminal-tabs {
  margin-bottom: var(--td-comp-margin-l);
}

.terminal-tabs :deep(.t-tabs__nav-item) {
  color: var(--td-text-color-secondary);
}

.terminal-tabs :deep(.t-is-active) {
  color: var(--td-brand-color);
}

.allocation-section {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}

.allocation-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-m);
}

.allocation-section__header h3 {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
}

.permission-shortcuts {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.permission-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 520px;
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
  overflow: hidden;
}

.permission-module-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  overflow: auto;
  background: var(--td-bg-color-secondarycontainer);
  border-right: 1px solid var(--td-component-border);
}

.permission-module-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  width: 100%;
  min-height: 38px;
  padding: 0 var(--td-comp-paddingLR-s);
  border: 0;
  border-radius: 4px;
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.permission-module-item span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-module-item span:last-child {
  flex: 0 0 auto;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

.permission-module-item:hover {
  background: var(--td-bg-color-container-hover);
}

.permission-module-item--active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.permission-module-item--active span:last-child {
  color: var(--td-brand-color);
}

.permission-module-empty {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-s);
  color: var(--td-text-color-secondary);
  text-align: center;
}

.permission-module-empty small {
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
  line-height: 20px;
}

.permission-matrix {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--td-bg-color-container);
}

.permission-matrix__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-comp-margin-l);
  min-height: 48px;
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
}

.module-allocation-count {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
  white-space: nowrap;
}

.matrix-toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-l);
  flex-wrap: nowrap;
  justify-content: flex-end;
}

.permission-matrix__table-wrap {
  max-height: 472px;
  overflow: auto;
}

.permission-matrix__table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.permission-matrix__table th,
.permission-matrix__table td {
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
  text-align: left;
  vertical-align: top;
}

.permission-matrix__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--td-text-color-secondary);
  font: var(--td-font-title-small);
  background: var(--td-bg-color-secondarycontainer);
}

.permission-menu-column,
.permission-menu-cell {
  width: 12%;
  border-right: 1px solid var(--td-component-border);
}

.permission-third-menu-column,
.permission-third-menu-cell {
  width: 12%;
  border-right: 1px solid var(--td-component-border);
}

.permission-page-column,
.permission-page-cell {
  width: 16%;
  border-right: 1px solid var(--td-component-border);
}

.permission-tab-column,
.permission-tab-cell {
  width: 11.5762%;
  border-right: 1px solid var(--td-component-border);
}

.permission-action-column,
.permission-action-cell {
  width: 48.4238%;
}

.permission-menu-name,
.permission-third-menu-name {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
}

.permission-level-tag {
  white-space: nowrap;
}

.permission-page-name {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  font-weight: 400;
}

.permission-page-note {
  margin-top: var(--td-comp-margin-xs);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
  line-height: 20px;
}

.permission-tab-text {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  line-height: 20px;
}

.permission-row-toggle {
  margin-bottom: var(--td-comp-margin-s);
}

.permission-empty-value,
.permission-empty-action {
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

.permission-action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s) var(--td-comp-margin-l);
  align-items: start;
}

.permission-action-grid :deep(.t-checkbox) {
  flex: 0 0 auto;
  min-width: 0;
}

.permission-action-grid :deep(.t-checkbox__label) {
  white-space: normal;
  word-break: break-word;
  line-height: 20px;
}

.permission-matrix__table .permission-matrix-empty-row td {
  height: 320px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  text-align: center;
  vertical-align: middle;
}

.permission-matrix-empty {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
  color: var(--td-text-color-secondary);
}

.permission-matrix-empty strong {
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

.page-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
  margin-top: var(--td-comp-margin-l);
  padding-top: var(--td-comp-paddingTB-l);
}

@media (max-width: 960px) {
  .page-header,
  .page-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .permission-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .permission-module-list {
    max-height: 220px;
    border-right: 0;
    border-bottom: 1px solid var(--td-component-border);
  }

  .permission-matrix__toolbar {
    align-items: flex-start;
  }
}
</style>
