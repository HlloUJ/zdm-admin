<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <AdminPageHeader :breadcrumbs="['商品管理', '商品公共基础数据', '属性值管理']" badge="标准属性值库" />
        <t-alert theme="info" class="page-tip"
          >用于维护各属性的可选值。适用于枚举 / 下拉类型属性；停用后不再允许新商品选择。</t-alert
        >
        <AdminListLayout>
          <template #toolbar>
            <div class="list-controls">
              <div v-if="!lockedScope" class="scope-controls">
                <t-tabs v-if="showScopeTabRail" v-model="activeScope" :list="scopeTabs" />
                <div class="source-caption">{{ sourceDescription }}</div>
              </div>
              <t-form :data="searchForm" label-width="88px" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <t-form-item label="所属属性" name="attribute">
                      <t-select v-model="searchForm.attribute" clearable placeholder="全部">
                        <t-option
                          v-for="item in attributesInScope"
                          :key="item.code"
                          :label="item.name"
                          :value="item.code"
                        />
                      </t-select>
                    </t-form-item>
                    <t-form-item label="属性值名称" name="keyword">
                      <t-input v-model="searchForm.keyword" clearable placeholder="请输入" />
                    </t-form-item>
                    <t-form-item label="状态" name="status">
                      <t-select v-model="searchForm.status" clearable placeholder="全部">
                        <t-option label="启用" value="enabled" />
                        <t-option label="停用" value="disabled" />
                      </t-select>
                    </t-form-item>
                  </div>
                  <div class="filter-actions">
                    <t-button theme="primary" @click="search">
                      <template #icon><t-icon name="search" /></template>
                      查询
                    </t-button>
                    <t-button theme="default" variant="base" @click="reset">
                      <template #icon><t-icon name="refresh" /></template>
                      重置
                    </t-button>
                  </div>
                </div>
              </t-form>
              <div class="table-toolbar">
                <t-button v-if="canCreateValue" theme="primary" @click="openCreate">
                  <template #icon><t-icon name="add" /></template>
                  新增
                </t-button>
              </div>
            </div>
          </template>
          <template #table>
            <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
              <template #attribute="{ row }">{{ attributeName[row.attribute] }}</template>
              <template #status="{ row }"
                ><t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">{{
                  row.status === 'enabled' ? '启用' : '停用'
                }}</t-tag></template
              >
              <template #operation="{ row }"
                ><div class="table-actions">
                  <t-link
                    v-if="canToggleValueStatus"
                    :theme="row.status === 'enabled' ? 'warning' : 'success'"
                    hover="color"
                    @click="openStatusConfirm(row)"
                    >{{ row.status === 'enabled' ? '停用' : '启用' }}</t-link
                  ><t-link v-if="canDeleteValue" theme="danger" hover="color" @click="openDeleteConfirm(row)"
                    >删除</t-link
                  ><span v-if="!canToggleValueStatus && !canDeleteValue" class="table-action-placeholder">-</span>
                </div></template
              >
            </t-table>
          </template>
          <template #pagination
            ><AdminPagination
              v-model:current="pagination.current"
              v-model:page-size="pagination.pageSize"
              :total="totalCount"
              :page-size-options="pageSizeOptions"
              @change="handlePaginationChange"
          /></template>
        </AdminListLayout>
      </main>
    </div>
    <AdminDialog
      v-model:visible="dialogVisible"
      header="新增"
      width="560px"
      placement="center"
      confirm-btn="提交"
      @confirm="submit"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="form" :rules="formRules" label-width="96px" colon>
        <t-form-item label="所属属性" name="attribute" required-mark>
          <t-select v-model="form.attribute">
            <t-option v-for="item in formAttributes" :key="item.code" :label="item.name" :value="item.code" />
          </t-select>
        </t-form-item>
        <t-form-item label="值名称" name="name" required-mark>
          <t-input v-model="form.name" clearable placeholder="请输入" />
        </t-form-item>
      </t-form>
    </AdminDialog>
    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmType === 'delete' ? '删除' : confirmType === 'disable' ? '停用' : '启用'"
      object-type="属性值"
      :object-name="confirmTarget?.name"
      @confirm="handleConfirm"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmText }}
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { requireCreatorOwnership } from '@/composables/useCreatorOwnershipGuard';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPageHeader,
  AdminPagination,
} from '@/components/foundation';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import type { ProductAttributeRecord } from '@/services/productAttributes';
import {
  createProductAttributeValue,
  deleteProductAttributeValue,
  listProductAttributeValueOptions,
  listProductAttributeValues,
  updateProductAttributeValueStatus,
  type ProductAttributeValueRecord,
} from '@/services/productAttributeValues';

type Scope = 'shared' | 'finished' | 'accessory';
type Status = 'enabled' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';
interface AttributeOption {
  code: string;
  name: string;
  scope: Scope;
  valueType: ProductAttributeRecord['valueType'];
  status: Status;
}
interface Value {
  id: number;
  attribute: string;
  code: string;
  scope: Scope;
  name: string;
  useCount: number;
  status: Status;
  createdByName: string;
  createdByAccountId?: number;
  createdAt: string;
}

const route = useRoute();
const attributeValuePermissionPrefix = 'admin.product-data-center.attribute-value';
const loginUser = computed(() => getLoginUser());
const attributeOptions = ref<AttributeOption[]>([]);
const attributeName = computed(() => Object.fromEntries(attributeOptions.value.map((item) => [item.code, item.name])));
const initialAttribute = typeof route.query.attribute === 'string' ? route.query.attribute : '';
const resolveScope = (value: unknown): Scope =>
  value === 'finished' || value === 'accessory' || value === 'shared'
    ? value
    : ((attributeOptions.value.find((item) => item.code === initialAttribute)?.scope ?? 'shared') as Scope);
const initialScope = resolveScope(route.query.scope);
const activeScope = ref<Scope>(initialScope);
const lockedScope = computed(
  () => route.query.scope === 'finished' || route.query.scope === 'accessory' || route.query.scope === 'shared',
);
const attributeValueScopeTabs: { label: string; value: Scope }[] = [
  { label: '共享基础属性值', value: 'shared' },
  { label: '成品现货专属值', value: 'finished' },
  { label: '配件专属值', value: 'accessory' },
];
const {
  visibleTabs: scopeTabs,
  showTabRail: showScopeTabRail,
  resolveAccessibleTab: resolveAccessibleScope,
} = usePermissionTabs({
  tabs: attributeValueScopeTabs,
  activeTab: activeScope,
  canAccess: (tab) => hasPermission(loginUser.value, `${attributeValuePermissionPrefix}.${tab.value}.view`),
});
const hasValueAction = (action: string) =>
  hasPermission(loginUser.value, `${attributeValuePermissionPrefix}.${activeScope.value}.${action}`);
const canCreateValue = computed(() => hasValueAction('create'));
const canToggleValueStatus = computed(() => hasValueAction('toggle-status'));
const canDeleteValue = computed(() => hasValueAction('delete'));
const sourceDescription = computed(
  () =>
    ({
      shared: '随共享基础属性被两类类目模板复用。',
      finished: '只随成品现货专属属性被成品类目模板引用。',
      accessory: '只随配件专属属性被配件类目模板引用。',
    })[activeScope.value],
);
const data = ref<Value[]>([]);
const loading = ref(false);
const isStandardOptionAttribute = (item: AttributeOption, scope: Scope) =>
  item.scope === scope && item.valueType === 'select';
const attributesInScope = computed(() =>
  attributeOptions.value.filter((item) => isStandardOptionAttribute(item, activeScope.value)),
);
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
  attribute: '',
  name: '',
});
const formAttributes = computed(() =>
  attributeOptions.value.filter((item) => isStandardOptionAttribute(item, form.scope) && item.status === 'enabled'),
);
const formRules: Record<string, FormRule[]> = {
  attribute: [{ required: true, message: '请选择所属属性', type: 'error' }],
  name: [{ required: true, message: '请输入值名称', type: 'error' }],
};
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '属性值名称', width: 190, align: 'left' },
  { colKey: 'attribute', title: '所属属性', width: 160, align: 'left' },
  { colKey: 'useCount', title: '被引用次数', width: 150, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'left' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'left' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'left' },
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
const normalizeStatus = (status?: ProductAttributeValueRecord['status']): Status =>
  status === 'disabled' ? 'disabled' : 'enabled';
const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toAttributeOption = (record: ProductAttributeRecord): AttributeOption => ({
  code: String(record.id),
  name: record.name,
  scope: record.scope,
  valueType: record.valueType,
  status: record.status === 'disabled' ? 'disabled' : 'enabled',
});
const toValue = (record: ProductAttributeValueRecord): Value => ({
  id: record.id,
  attribute: String(record.attributeId),
  code: record.code,
  scope: record.scope,
  name: record.value,
  useCount: record.useCount ?? 0,
  status: normalizeStatus(record.status),
  createdByName: record.createdByName || '-',
  createdByAccountId: record.createdByAccountId,
  createdAt: formatDateTime(record.createdAt),
});
const createValueCode = (attributeId: string, name: string) =>
  `attr-value-${attributeId}-${name.trim().length}-${Date.now()}`;
const loadValues = async () => {
  loading.value = true;
  try {
    const [attributes, values] = await Promise.all([listProductAttributeValueOptions(), listProductAttributeValues()]);
    attributeOptions.value = attributes.map(toAttributeOption);
    data.value = values.map(toValue);
    if (searchForm.attribute && !attributesInScope.value.some((item) => item.code === searchForm.attribute)) {
      searchForm.attribute = '';
      applied.attribute = '';
    }
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '属性值列表加载失败');
  } finally {
    loading.value = false;
  }
};
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
const openCreate = () => {
  form.scope = activeScope.value;
  form.attribute = '';
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
  if (!form.attribute) {
    adminFeedback.warning('请先新增可选类型的属性');
    return;
  }
  if (data.value.some((item) => item.attribute === form.attribute && item.name === name)) {
    adminFeedback.warning('该属性下的值名称已存在');
    return;
  }
  try {
    await createProductAttributeValue({
      attributeId: Number(form.attribute),
      scope: form.scope,
      value: name,
      code: createValueCode(form.attribute, name),
      status: 'enabled',
    });
    await loadValues();
    pagination.current = 1;
    closeFormDialog();
    adminFeedback.created(name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};
const openStatusConfirm = (row: Value) => {
  if (!requireCreatorOwnership(row)) return;
  confirmTarget.value = row;
  confirmType.value = row.status === 'enabled' ? 'disable' : 'enable';
  confirmDialogVisible.value = true;
};
const openDeleteConfirm = (row: Value) => {
  if (!requireCreatorOwnership(row)) return;
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
  return `是否${confirmType.value === 'disable' ? '停用' : confirmType.value === 'enable' ? '启用' : '删除'}属性值“${name}”？`;
});
const handleConfirm = async () => {
  if (!confirmTarget.value) return;
  const target = confirmTarget.value;
  const action = confirmType.value === 'delete' ? '删除' : confirmType.value === 'enable' ? '启用' : '停用';

  try {
    if (confirmType.value === 'delete') {
      await deleteProductAttributeValue(target.id);
      data.value = data.value.filter((item) => item.id !== target.id);
      ensureCurrentPage();
    } else {
      const updated = await updateProductAttributeValueStatus(
        target.id,
        confirmType.value === 'enable' ? 'enabled' : 'disabled',
      );
      const targetIndex = data.value.findIndex((item) => item.id === target.id);
      if (targetIndex !== -1) {
        data.value.splice(targetIndex, 1, toValue(updated));
      }
    }
    if (confirmType.value === 'delete') {
      adminFeedback.deleted(target.name);
    } else {
      adminFeedback.actionSuccess({ action, target: target.name });
    }
    closeConfirmDialog();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};
watch(
  () => route.query.scope,
  (scope) => {
    activeScope.value = resolveAccessibleScope(resolveScope(scope)) ?? activeScope.value;
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
onMounted(loadValues);
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
.page-tip {
  margin-bottom: 16px;
}
.list-controls {
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-l);
}
.scope-controls {
  min-width: 0;
}
.source-caption {
  margin-top: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  font-size: 13px;
}
:deep(.zdm-admin-list-layout__toolbar) {
  display: block;
  min-height: 0;
}
.filter-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}
.filter-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--td-comp-margin-l);
}
.filter-fields :deep(.t-form__item) {
  width: 260px;
  margin-bottom: 0;
}
.filter-fields :deep(.t-input),
.filter-fields :deep(.t-select) {
  width: 100%;
}
.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}
.table-toolbar {
  display: flex;
  align-items: center;
}
.table-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  white-space: nowrap;
}
.table-action-placeholder {
  color: var(--td-text-color-placeholder);
}
:deep(.t-table th),
:deep(.t-table td) {
  padding-left: 24px;
  padding-right: 24px;
}
@media (max-width: 1120px) {
  .filter-row {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-actions {
    flex-wrap: wrap;
  }
}
@media (max-width: 720px) {
  .filter-fields :deep(.t-form__item) {
    width: 100%;
  }
}
</style>
