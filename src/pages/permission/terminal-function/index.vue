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
                <t-button size="small" variant="outline" theme="primary" @click="selectAllNodes">全选全部</t-button>
                <t-button size="small" variant="outline" @click="clearAllNodes">清空全部</t-button>
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
              </aside>

              <div v-if="activeModule" class="permission-matrix">
                <div class="permission-matrix__toolbar">
                  <div>
                    <h4>{{ activeModule.label }}</h4>
                    <p>
                      已下放 {{ getSelectedCount(getModuleActionValues(activeModule)) }} /
                      {{ getModuleActionValues(activeModule).length }}
                    </p>
                  </div>
                  <div class="matrix-toolbar-right">
                    <t-checkbox
                      :checked="isModuleAllSelected(activeModule)"
                      :indeterminate="isModuleIndeterminate(activeModule)"
                      @change="toggleModule(activeModule, $event)"
                    >
                      全选当前模块
                    </t-checkbox>
                  </div>
                </div>

                <div class="permission-matrix__table-wrap">
                  <table class="permission-matrix__table">
                    <thead>
                      <tr>
                        <th>页面/功能点</th>
                        <th>操作权限</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="page in activeModule.pages" :key="page.value">
                        <td>
                          <div class="permission-page-name">{{ page.label }}</div>
                          <t-checkbox
                            size="small"
                            :checked="isPageAllSelected(page)"
                            :indeterminate="isPageIndeterminate(page)"
                            @change="togglePage(page, $event)"
                          >
                            整页权限
                          </t-checkbox>
                        </td>
                        <td>
                          <div class="permission-action-grid">
                            <t-checkbox
                              v-for="action in page.actions"
                              :key="action.value"
                              :checked="isPermissionSelected(action.value)"
                              @change="togglePermission(action.value, $event)"
                            >
                              {{ action.label }}
                            </t-checkbox>
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
            <t-button theme="primary" :loading="loading" @click="saveAllocation">保存</t-button>
            <t-button theme="default" variant="base" :disabled="loading" @click="resetAllocation">重置</t-button>
          </footer>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MessagePlugin } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { createRole, listRoles, updateRole, type RolePayload, type RoleRecord } from '@/services/roles';

type TerminalType = 'store' | 'supplier';

interface FunctionNode {
  label: string;
  value: string;
  children?: FunctionNode[];
}

interface FunctionAction {
  label: string;
  value: string;
}

interface FunctionPage {
  label: string;
  value: string;
  actions: FunctionAction[];
}

interface FunctionModule {
  label: string;
  value: string;
  pages: FunctionPage[];
}

const terminalTabs = [
  { label: '门店端后台功能分配', value: 'store' },
  { label: '供应商端后台功能分配', value: 'supplier' },
];

const buildActionNodes = (scope: string, actions: string[]) =>
  actions.map((action) => ({
    label: action,
    value: `${scope}.${action}`,
  }));

const terminalFunctionTrees: Record<TerminalType, FunctionNode[]> = {
  store: [
    {
      label: '商品管理',
      value: 'store.goods',
      children: [
        {
          label: '成品现货',
          value: 'store.goods.finished-stock',
          children: buildActionNodes('store.goods.finished-stock', [
            '查询',
            '发布商品',
            '上架',
            '下架',
            '编辑',
            '删除',
          ]),
        },
        {
          label: '大板商品',
          value: 'store.goods.slab',
          children: buildActionNodes('store.goods.slab', ['查询', '发布商品', '上架', '下架', '编辑', '删除']),
        },
      ],
    },
    {
      label: '门店经营',
      value: 'store.operation',
      children: [
        {
          label: '客户管理',
          value: 'store.operation.customer',
          children: buildActionNodes('store.operation.customer', ['查询', '新增', '跟进', '编辑']),
        },
        {
          label: '订单管理',
          value: 'store.operation.order',
          children: buildActionNodes('store.operation.order', ['查询', '开单', '改价', '确认收款', '申请售后']),
        },
      ],
    },
    {
      label: '门店权限',
      value: 'store.permission',
      children: [
        {
          label: '员工管理',
          value: 'store.permission.employee',
          children: buildActionNodes('store.permission.employee', ['查询', '新增员工', '编辑员工', '停用/启用']),
        },
        {
          label: '角色权限',
          value: 'store.permission.role',
          children: buildActionNodes('store.permission.role', ['查询', '新建角色', '权限管理', '编辑角色', '删除角色']),
        },
      ],
    },
  ],
  supplier: [
    {
      label: '供应商品管理',
      value: 'supplier.goods',
      children: [
        {
          label: '供应商品',
          value: 'supplier.goods.management',
          children: buildActionNodes('supplier.goods.management', ['查询', '发布商品', '编辑', '上架', '下架', '删除']),
        },
        {
          label: '库存维护',
          value: 'supplier.goods.stock',
          children: buildActionNodes('supplier.goods.stock', ['查询', '库存调整', '批量导入', '导出']),
        },
      ],
    },
    {
      label: '履约协同',
      value: 'supplier.fulfillment',
      children: [
        {
          label: '订单协同',
          value: 'supplier.fulfillment.order',
          children: buildActionNodes('supplier.fulfillment.order', ['查询', '接单', '发货', '异常反馈']),
        },
        {
          label: '售后协同',
          value: 'supplier.fulfillment.after-sales',
          children: buildActionNodes('supplier.fulfillment.after-sales', ['查询', '处理', '上传凭证']),
        },
      ],
    },
    {
      label: '结算管理',
      value: 'supplier.settlement',
      children: [
        {
          label: '结算单',
          value: 'supplier.settlement.statement',
          children: buildActionNodes('supplier.settlement.statement', ['查询', '确认', '导出']),
        },
      ],
    },
  ],
};

const initialAllocationValues: Record<TerminalType, string[]> = {
  store: [
    'store.goods.finished-stock.查询',
    'store.goods.finished-stock.发布商品',
    'store.goods.finished-stock.编辑',
    'store.operation.customer.查询',
    'store.operation.customer.新增',
    'store.operation.order.查询',
    'store.operation.order.开单',
    'store.permission.employee.查询',
    'store.permission.role.查询',
  ],
  supplier: [
    'supplier.goods.management.查询',
    'supplier.goods.management.发布商品',
    'supplier.goods.management.编辑',
    'supplier.goods.stock.查询',
    'supplier.fulfillment.order.查询',
    'supplier.fulfillment.order.接单',
    'supplier.settlement.statement.查询',
  ],
};

const activeTerminal = ref<TerminalType>('store');
const activeModuleValue = ref(terminalFunctionTrees.store[0]?.value ?? '');
const checkedValues = ref<string[]>([]);
const loading = ref(false);
const savedAllocationValues = reactive<Record<TerminalType, string[]>>({
  store: [...initialAllocationValues.store],
  supplier: [...initialAllocationValues.supplier],
});
const terminalPolicyRoles = reactive<Partial<Record<TerminalType, RoleRecord>>>({});

const currentTree = computed(() => terminalFunctionTrees[activeTerminal.value]);

const getCheckedValue = (checked: unknown) => {
  if (typeof checked === 'boolean') return checked;
  if (checked && typeof checked === 'object' && 'checked' in checked) {
    return Boolean((checked as { checked?: boolean }).checked);
  }

  return Boolean(checked);
};

const collectLeafValues = (node: FunctionNode): string[] => {
  if (!node.children?.length) return [node.value];
  return node.children.flatMap(collectLeafValues);
};

const isActionGroup = (node: FunctionNode) => {
  const children = node.children ?? [];
  return children.length > 0 && children.every((child) => !child.children?.length);
};

const collectFunctionPages = (nodes: FunctionNode[]): FunctionPage[] =>
  nodes.flatMap((node) => {
    if (isActionGroup(node)) {
      return [
        {
          label: node.label,
          value: node.value,
          actions: node.children?.map(({ label, value }) => ({ label, value })) ?? [],
        },
      ];
    }

    return node.children?.length ? collectFunctionPages(node.children) : [];
  });

const currentModules = computed<FunctionModule[]>(() =>
  currentTree.value.map((module) => ({
    label: module.label,
    value: module.value,
    pages: collectFunctionPages(module.children ?? []),
  })),
);
const activeModule = computed(
  () => currentModules.value.find((module) => module.value === activeModuleValue.value) ?? currentModules.value[0],
);
const allLeafValues = computed(() => currentTree.value.flatMap(collectLeafValues));
const getModuleActionValues = (module?: FunctionModule) =>
  module?.pages.flatMap((page) => page.actions.map((action) => action.value)) ?? [];
const getPageActionValues = (page: FunctionPage) => page.actions.map((action) => action.value);
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
const isPageAllSelected = (page: FunctionPage) => isAllSelected(getPageActionValues(page));
const isPageIndeterminate = (page: FunctionPage) => isIndeterminate(getPageActionValues(page));
const isModuleAllSelected = (module?: FunctionModule) => isAllSelected(getModuleActionValues(module));
const isModuleIndeterminate = (module?: FunctionModule) => isIndeterminate(getModuleActionValues(module));
const togglePermission = (value: string, checked: unknown) => setPermissionRange([value], checked);
const togglePage = (page: FunctionPage, checked: unknown) => setPermissionRange(getPageActionValues(page), checked);
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

const terminalCode = (terminal: TerminalType) =>
  terminal === 'store' ? 'TERMINAL_STORE_POLICY' : 'TERMINAL_SUPPLIER_POLICY';

const terminalName = (terminal: TerminalType) => (terminal === 'store' ? '门店端终端功能配置' : '供应商端终端功能配置');

const toPolicyPayload = (terminal: TerminalType, permissions: string[]): RolePayload => ({
  name: terminalName(terminal),
  code: terminalCode(terminal),
  category: 'terminal-policy',
  clientCode: terminal,
  dataScope: 'store',
  status: 'enabled',
  remark: `系统配置：${terminal === 'store' ? '门店端' : '供应商端'}可下放功能范围`,
  functionPermissions: permissions.join(','),
});

const loadAllocation = async () => {
  loading.value = true;
  try {
    const roles = await listRoles();
    (['store', 'supplier'] as TerminalType[]).forEach((terminal) => {
      const policy = roles.find((role) => role.code === terminalCode(terminal));
      if (policy) {
        terminalPolicyRoles[terminal] = policy;
        savedAllocationValues[terminal] = parsePermissions(policy.functionPermissions);
      }
    });
    checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '终端功能配置加载失败');
  } finally {
    loading.value = false;
  }
};

const resetAllocation = () => {
  checkedValues.value = [...savedAllocationValues[activeTerminal.value]];
  MessagePlugin.info('已重置为上次保存状态');
};

const saveAllocation = async () => {
  const terminal = activeTerminal.value;
  const payload = toPolicyPayload(terminal, checkedValues.value);
  loading.value = true;
  try {
    const policy = terminalPolicyRoles[terminal];
    const saved = policy ? await updateRole(policy.id, payload) : await createRole(payload);
    terminalPolicyRoles[terminal] = saved;
    savedAllocationValues[terminal] = parsePermissions(saved.functionPermissions);
    checkedValues.value = [...savedAllocationValues[terminal]];
    MessagePlugin.success('保存成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '保存失败');
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

.permission-matrix {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--td-bg-color-container);
}

.permission-matrix__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  min-height: 72px;
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
}

.permission-matrix__toolbar h4 {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

.permission-matrix__toolbar p {
  margin: var(--td-comp-margin-xxs) 0 0;
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}

.matrix-toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-l);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.permission-matrix__table-wrap {
  max-height: 448px;
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

.permission-matrix__table th:first-child,
.permission-matrix__table td:first-child {
  width: 180px;
}

.permission-page-name {
  margin-bottom: var(--td-comp-margin-xs);
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

.permission-action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
  gap: var(--td-comp-margin-s) var(--td-comp-margin-l);
  align-items: start;
}

.permission-action-grid :deep(.t-checkbox) {
  min-width: 0;
}

.permission-action-grid :deep(.t-checkbox__label) {
  white-space: normal;
  word-break: break-word;
  line-height: 20px;
}

.page-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
  margin-top: var(--td-comp-margin-l);
  padding-top: var(--td-comp-paddingTB-l);
  border-top: 1px solid var(--td-component-border);
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

  .permission-matrix__toolbar,
  .matrix-toolbar-right {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
