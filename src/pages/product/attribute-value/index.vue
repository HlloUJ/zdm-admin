<template>
  <div class="admin-layout">
    <header class="top-nav">
      <div class="brand">
        <div class="brand-logo">装</div>
        <div>
          <div class="brand-title">装点猫</div>
          <div class="brand-subtitle">管理后台</div>
        </div>
      </div>
      <div class="top-actions"><t-avatar size="small">超</t-avatar><span>超级管理员</span></div>
    </header>
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb
            ><t-breadcrumb-item>商品基础数据中心</t-breadcrumb-item
            ><t-breadcrumb-item>属性值管理</t-breadcrumb-item></t-breadcrumb
          ><t-tag theme="primary" variant="light">标准属性值库</t-tag>
        </header>
        <t-alert theme="info" class="page-tip"
          >用于维护各属性的可选值。适用于枚举 / 下拉类型属性；停用后不再允许新商品选择。</t-alert
        >
        <section v-if="!lockedScope" class="table-card source-card">
          <t-tabs v-model="activeScope" :list="scopeTabs" />
          <div class="source-caption">{{ sourceDescription }}</div>
        </section>
        <section class="filter-card">
          <t-form :data="searchForm" label-width="88px" colon
            ><div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="所属属性"
                  ><t-select v-model="searchForm.attribute" clearable placeholder="全部"
                    ><t-option
                      v-for="item in attributesInScope"
                      :key="item.code"
                      :label="item.name"
                      :value="item.code" /></t-select></t-form-item
                ><t-form-item label="属性值名称"
                  ><t-input v-model="searchForm.keyword" clearable placeholder="请输入" /></t-form-item
                ><t-form-item label="状态"
                  ><t-select v-model="searchForm.status" clearable placeholder="全部"
                    ><t-option label="启用" value="enabled" /><t-option label="停用" value="disabled" /></t-select
                ></t-form-item>
              </div>
              <div class="filter-actions">
                <t-button theme="primary" @click="search"
                  ><template #icon><t-icon name="search" /></template>查询</t-button
                ><t-button variant="base" @click="reset">重置</t-button>
              </div>
            </div></t-form
          >
        </section>
        <section class="table-card">
          <div class="table-toolbar">
            <t-button theme="primary" @click="openCreate"
              ><template #icon><t-icon name="add" /></template>新增</t-button
            >
          </div>
          <t-table row-key="id" :data="pageData" :columns="columns" hover table-layout="fixed"
            ><template #attribute="{ row }">{{ attributeName[row.attribute] }}</template
            ><template #status="{ row }"
              ><t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">{{
                row.status === 'enabled' ? '启用' : '停用'
              }}</t-tag></template
            ><template #operation="{ row }"
              ><div class="table-actions">
                <t-link
                  :theme="row.status === 'enabled' ? 'warning' : 'success'"
                  hover="color"
                  @click="openStatusConfirm(row)"
                  >{{ row.status === 'enabled' ? '停用' : '启用' }}</t-link
                ><t-link theme="danger" hover="color" @click="openDeleteConfirm(row)">删除</t-link>
              </div></template
            ></t-table
          ><AdminPagination
            v-model:current="pagination.current"
            v-model:page-size="pagination.pageSize"
            :total="totalCount"
            :page-size-options="pageSizeOptions"
            @change="handlePaginationChange"
          />
        </section>
      </main>
    </div>
    <t-dialog
      v-model:visible="dialogVisible"
      header="新增"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="submit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
      ><t-form ref="formRef" :data="form" :rules="formRules" label-width="96px" colon
        ><t-form-item label="所属属性" name="attribute" required-mark
          ><t-select v-model="form.attribute"
            ><t-option
              v-for="item in formAttributes"
              :key="item.code"
              :label="item.name"
              :value="item.code" /></t-select></t-form-item
        ><t-form-item label="值名称" name="name" required-mark
          ><t-input v-model="form.name" clearable placeholder="请输入" /></t-form-item></t-form
    ></t-dialog>
    <t-dialog
      v-model:visible="confirmDialogVisible"
      header="系统提示"
      width="420px"
      placement="center"
      confirm-btn="确认"
      cancel-btn="取消"
      @confirm="handleConfirm"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
      >{{ confirmText }}</t-dialog
    >
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import { AdminPagination } from '@/components/foundation';

type Scope = 'shared' | 'finished' | 'accessory';
type Status = 'enabled' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';
interface AttributeOption {
  code: string;
  name: string;
  scope: Scope;
}
interface Value {
  id: number;
  attribute: string;
  scope: Scope;
  name: string;
  useCount: number;
  status: Status;
}

const route = useRoute();
const attributeOptions: AttributeOption[] = [
  { code: 'brand', name: '品牌', scope: 'shared' },
  { code: 'style', name: '设计风格', scope: 'shared' },
  { code: 'applicable_space', name: '适用空间', scope: 'shared' },
  { code: 'stone_material', name: '石材材质', scope: 'finished' },
  { code: 'surface_finish', name: '表面工艺', scope: 'finished' },
  { code: 'table_size', name: '成品规格尺寸', scope: 'finished' },
  { code: 'hardware_material', name: '五金材质', scope: 'accessory' },
  { code: 'hardware_finish', name: '表面处理', scope: 'accessory' },
];
const attributeName = Object.fromEntries(attributeOptions.map((item) => [item.code, item.name]));
const initialAttribute = typeof route.query.attribute === 'string' ? route.query.attribute : '';
const resolveScope = (value: unknown): Scope =>
  value === 'finished' || value === 'accessory' || value === 'shared'
    ? value
    : ((attributeOptions.find((item) => item.code === initialAttribute)?.scope ?? 'shared') as Scope);
const initialScope = resolveScope(route.query.scope);
const activeScope = ref<Scope>(initialScope);
const lockedScope = computed(
  () => route.query.scope === 'finished' || route.query.scope === 'accessory' || route.query.scope === 'shared',
);
const scopeTabs = [
  { label: '共享基础属性值', value: 'shared' },
  { label: '成品现货专属值', value: 'finished' },
  { label: '配件专属值', value: 'accessory' },
];
const sourceDescription = computed(
  () =>
    ({
      shared: '随共享基础属性被两类类目模板复用。',
      finished: '只随成品现货专属属性被成品类目模板引用。',
      accessory: '只随配件专属属性被配件类目模板引用。',
    })[activeScope.value],
);
const data = ref<Value[]>([
  { id: 1, attribute: 'brand', scope: 'shared', name: '装点猫', useCount: 8, status: 'enabled' },
  { id: 2, attribute: 'style', scope: 'shared', name: '现代', useCount: 14, status: 'enabled' },
  { id: 3, attribute: 'applicable_space', scope: 'shared', name: '餐厅', useCount: 16, status: 'enabled' },
  { id: 4, attribute: 'stone_material', scope: 'finished', name: '大理石', useCount: 22, status: 'enabled' },
  { id: 5, attribute: 'stone_material', scope: 'finished', name: '奢石', useCount: 16, status: 'enabled' },
  { id: 6, attribute: 'surface_finish', scope: 'finished', name: '亮光', useCount: 11, status: 'enabled' },
  { id: 8, attribute: 'hardware_material', scope: 'accessory', name: '不锈钢', useCount: 9, status: 'enabled' },
  { id: 9, attribute: 'hardware_finish', scope: 'accessory', name: '哑光黑', useCount: 8, status: 'enabled' },
]);
const attributesInScope = computed(() => attributeOptions.filter((item) => item.scope === activeScope.value));
const searchForm = reactive({ attribute: initialAttribute, keyword: '', status: '' as '' | Status });
const applied = reactive({ ...searchForm });
const pageSizeOptions = [10, 20, 50];
const pagination = reactive({ current: 1, pageSize: 10 });
const dialogVisible = ref(false);
const confirmDialogVisible = ref(false);
const confirmType = ref<ConfirmType>('disable');
const confirmTarget = ref<Value | null>(null);
const formRef = ref<FormInstanceFunctions>();
const form = reactive({
  scope: initialScope,
  attribute: initialAttribute || attributeOptions.find((item) => item.scope === initialScope)!.code,
  name: '',
});
const formAttributes = computed(() => attributeOptions.filter((item) => item.scope === form.scope));
const formRules: Record<string, FormRule[]> = {
  attribute: [{ required: true, message: '请选择所属属性', type: 'error' }],
  name: [{ required: true, message: '请输入值名称', type: 'error' }],
};
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '属性值名称', width: 190, align: 'left' },
  { colKey: 'attribute', title: '所属属性', width: 160, align: 'left' },
  { colKey: 'useCount', title: '被引用次数', width: 150, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'left' },
  { colKey: 'operation', title: '操作', width: 180, align: 'left', fixed: 'right' },
];
const filteredData = computed(() =>
  data.value.filter(
    (item) =>
      item.scope === activeScope.value &&
      (!applied.attribute || item.attribute === applied.attribute) &&
      (!applied.status || item.status === applied.status) &&
      (!applied.keyword || item.name.includes(applied.keyword)),
  ),
);
const pageData = computed(() =>
  filteredData.value.slice((pagination.current - 1) * pagination.pageSize, pagination.current * pagination.pageSize),
);
const totalCount = computed(() => filteredData.value.length);
const search = () => {
  Object.assign(applied, searchForm);
  pagination.current = 1;
};
const reset = () => {
  searchForm.attribute = '';
  searchForm.keyword = '';
  searchForm.status = '';
  pagination.pageSize = 10;
  search();
};
const handlePaginationChange = (pageInfo: PageInfo) => {
  pagination.current = pageInfo.current;
  pagination.pageSize = pageInfo.pageSize;
};
const ensureCurrentPage = () => {
  const maxPage = Math.max(Math.ceil(totalCount.value / pagination.pageSize), 1);
  if (pagination.current > maxPage) pagination.current = maxPage;
};
const syncFormAttribute = () => {
  form.attribute = formAttributes.value[0].code;
};
const openCreate = () => {
  form.scope = activeScope.value;
  syncFormAttribute();
  form.name = '';
  formRef.value?.clearValidate();
  dialogVisible.value = true;
};
const closeFormDialog = () => {
  dialogVisible.value = false;
  formRef.value?.clearValidate();
};
const submit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return;
  const name = form.name.trim();
  if (data.value.some((item) => item.attribute === form.attribute && item.name === name)) {
    MessagePlugin.warning('该属性下的值名称已存在');
    return;
  }
  data.value.unshift({
    id: Date.now(),
    attribute: form.attribute,
    scope: form.scope,
    name,
    useCount: 0,
    status: 'enabled',
  });
  pagination.current = 1;
  closeFormDialog();
  MessagePlugin.success('新增成功');
};
const openStatusConfirm = (row: Value) => {
  confirmTarget.value = row;
  confirmType.value = row.status === 'enabled' ? 'disable' : 'enable';
  confirmDialogVisible.value = true;
};
const openDeleteConfirm = (row: Value) => {
  confirmTarget.value = row;
  confirmType.value = 'delete';
  confirmDialogVisible.value = true;
};
const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmTarget.value = null;
};
const confirmText = computed(() => {
  const name = confirmTarget.value?.name ?? '';
  return `是否${confirmType.value === 'disable' ? '停用' : confirmType.value === 'enable' ? '启用' : '删除'}属性值【${name}】？`;
});
const handleConfirm = () => {
  if (!confirmTarget.value) return;
  if (confirmType.value === 'delete') {
    data.value = data.value.filter((item) => item.id !== confirmTarget.value?.id);
    ensureCurrentPage();
    MessagePlugin.success('删除成功');
  } else {
    confirmTarget.value.status = confirmType.value === 'enable' ? 'enabled' : 'disabled';
    MessagePlugin.success(confirmType.value === 'enable' ? '已启用标准值' : '已停用标准值');
  }
  closeConfirmDialog();
};
watch(
  () => route.query.scope,
  (scope) => {
    activeScope.value = resolveScope(scope);
    searchForm.attribute = '';
    applied.attribute = '';
    pagination.current = 1;
  },
);
watch(activeScope, () => {
  searchForm.attribute = '';
  applied.attribute = '';
  pagination.current = 1;
});
</script>

<style scoped>
.admin-layout {
  min-height: 100vh;
  background: var(--td-bg-color-page);
}
.top-nav {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
}
.admin-shell {
  min-height: calc(100vh - 64px);
  display: flex;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand-logo {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: var(--td-brand-color);
  color: #fff;
  font-weight: 700;
}
.brand-title {
  font: var(--td-font-title-medium);
}
.brand-subtitle {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
.top-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--td-text-color-secondary);
}
.page {
  min-width: 0;
  flex: 1;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xxl);
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-tip,
.filter-card,
.source-card {
  margin-bottom: 16px;
}
.filter-card,
.table-card {
  padding: 24px;
  background: var(--td-bg-color-container);
  border-radius: 6px;
  box-shadow: var(--td-shadow-1);
}
.source-card {
  padding-bottom: 14px;
}
.source-caption {
  margin-top: 12px;
  color: var(--td-text-color-secondary);
  font-size: 13px;
}
.filter-row,
.filter-fields,
.filter-actions,
.table-toolbar,
.table-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.filter-row {
  justify-content: space-between;
}
.filter-fields {
  flex: 1;
}
.filter-fields :deep(.t-form__item) {
  width: 280px;
  margin-bottom: 0;
}
.filter-fields :deep(.t-input),
.filter-fields :deep(.t-select) {
  width: 100%;
}
.table-toolbar {
  justify-content: space-between;
  margin-bottom: 16px;
  color: var(--td-text-color-secondary);
  font-size: 13px;
}
.table-actions {
  gap: 12px;
}
:deep(.t-table th),
:deep(.t-table td) {
  padding-left: 24px;
  padding-right: 24px;
}
</style>
