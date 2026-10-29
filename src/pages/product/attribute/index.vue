<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <t-alert theme="info" class="page-tip"
          >属性库仅维护属性定义和值类型；必填及 SKU 规则统一在类目属性模板中配置。</t-alert
        >
        <AdminListLayout class="attribute-list-layout">
          <template #toolbar>
            <div class="list-controls">
              <div v-if="!lockedScope" class="scope-controls">
                <t-tabs v-if="showScopeTabRail" v-model="activeScope" :list="scopeTabs" />
                <div class="source-caption">{{ sourceDescription }}</div>
              </div>
              <t-form class="zdm-admin-filter-form zdm-standard-query" label-width="80px" :data="searchForm" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <t-form-item label="属性名称"
                      ><t-input v-model="searchForm.keyword" clearable placeholder="请输入属性名称"
                    /></t-form-item>
                  </div>
                  <div class="filter-actions">
                    <t-button :theme="buttonTheme('search')" @click="search"
                      ><template #icon><t-icon name="search" /></template>查询</t-button
                    ><t-button :theme="buttonTheme('reset')" variant="base" @click="reset"
                      ><template #icon><t-icon name="refresh" /></template>重置</t-button
                    >
                  </div>
                </div>
              </t-form>
              <AdminListToolbar :has-actions="canCreateAttribute"
                ><t-button v-if="canCreateAttribute" :theme="buttonTheme('create')" @click="openCreate">
                  <template #icon><t-icon name="add" /></template>新增
                </t-button></AdminListToolbar
              >
            </div>
          </template>
          <template #table>
            <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
              <template #valueType="{ row }">{{ valueTypeLabel(row.valueType) }}</template>
              <template #status="{ row }"
                ><t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">{{
                  row.status === 'enabled' ? '启用' : '停用'
                }}</t-tag></template
              >
              <template #operation="{ row }"
                ><div class="table-actions">
                  <t-link
                    v-if="canToggleAttributeStatus"
                    :theme="buttonTheme(row.status === 'enabled' ? 'disable' : 'enable')"
                    hover="color"
                    @click="openStatusConfirm(row)"
                    >{{ row.status === 'enabled' ? '停用' : '启用' }}</t-link
                  ><t-link
                    v-if="canDeleteAttribute"
                    :theme="buttonTheme('delete')"
                    hover="color"
                    @click="openDeleteConfirm(row)"
                    >删除</t-link
                  ><span v-if="!canToggleAttributeStatus && !canDeleteAttribute" class="table-action-placeholder"
                    >-</span
                  >
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
      :confirmation="formConfirmation('create')"
      confirm-function="submit"
      header="新增"
      width="480px"
      placement="center"
      :prevent-scroll-through="false"
      dialog-class-name="attribute-create-dialog zdm-admin-dialog zdm-admin-single-form"
      @confirm="submit"
      @close="closeCreateDialog"
      @opened="restorePageScroll"
      @closed="restorePageScroll"
    >
      <t-form ref="formRef" :data="form" :rules="formRules" label-width="100px" colon>
        <t-form-item label="属性名称" name="name" required-mark
          ><t-input v-model="form.name" clearable placeholder="请输入属性名称"
        /></t-form-item>
        <t-form-item label="值类型" name="valueType" required-mark
          ><t-radio-group v-model="form.valueType" class="attribute-value-types"
            ><t-radio value="select">标准选项</t-radio><t-radio value="number">数值+单位</t-radio
            ><t-radio value="text">文本输入</t-radio></t-radio-group
          ></t-form-item
        >
      </t-form>
    </AdminDialog>
    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :function="buttonFunctionFor('status', confirmType)"
      :action="confirmType === 'delete' ? '删除' : confirmType === 'disable' ? '停用' : '启用'"
      object-type="属性"
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
import { formConfirmation } from '@/components/foundation/actions/confirmation';
import { buttonTheme, buttonFunctionFor } from '@/components/foundation/actions/buttonFunctions';
import { rejectFormSubmission } from '@/utils/submitValidation';
import AdminListToolbar from '@/components/foundation/AdminListToolbar.vue';
import type { FormInstanceFunctions, FormRule, PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPagination,
} from '@/components/foundation';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createProductAttribute,
  deleteProductAttribute,
  listProductAttributes,
  previewProductAttributeDelete,
  updateProductAttributeStatus,
  type ProductAttributeDeletePreview,
  type ProductAttributeRecord,
} from '@/services/productAttributes';

type Scope = 'shared' | 'finished' | 'accessory';
type ValueType = 'select' | 'number' | 'text';
type Status = 'enabled' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';
interface Attribute {
  id: number;
  code: string;
  name: string;
  scope: Scope;
  valueType: ValueType;
  templateCount: number;
  status: Status;
  createdByName: string;
  createdByAccountId?: number;
  createdAt: string;
}

const route = useRoute();
const attributePermissionPrefix = 'admin.product-data-center.attribute';
const loginUser = computed(() => getLoginUser());
const attributeScopeTabs: { label: string; value: Scope }[] = [
  { label: '共享基础属性', value: 'shared' },
  { label: '成品现货专属属性', value: 'finished' },
  { label: '配件专属属性', value: 'accessory' },
];
const resolveScope = (value: unknown): Scope =>
  value === 'finished' || value === 'accessory' || value === 'shared' ? value : 'shared';
const activeScope = ref<Scope>(resolveScope(route.query.scope));
const {
  visibleTabs: scopeTabs,
  showTabRail: showScopeTabRail,
  resolveAccessibleTab: resolveAccessibleScope,
} = usePermissionTabs({
  tabs: attributeScopeTabs,
  activeTab: activeScope,
  canAccess: (tab) => hasPermission(loginUser.value, `${attributePermissionPrefix}.${tab.value}.view`),
});
const lockedScope = computed(
  () => route.query.scope === 'finished' || route.query.scope === 'accessory' || route.query.scope === 'shared',
);
const hasAttributeAction = (action: string) =>
  hasPermission(loginUser.value, `${attributePermissionPrefix}.${activeScope.value}.${action}`);
const canCreateAttribute = computed(() => hasAttributeAction('create'));
const canToggleAttributeStatus = computed(() => hasAttributeAction('toggle-status'));
const canDeleteAttribute = computed(() => hasAttributeAction('delete'));
const sourceDescription = computed(
  () =>
    ({
      shared: '可被成品现货与配件两类类目模板复用。',
      finished: '仅供成品现货类目模板引用，例如石材、台面工艺与成品规格。',
      accessory: '仅供配件类目模板引用，例如五金材质、承重与表面处理。',
    })[activeScope.value],
);
const data = ref<Attribute[]>([]);
const loading = ref(false);
const searchForm = reactive({ keyword: '' });
const applied = reactive({ ...searchForm });
const pageSizeOptions = [10, 20, 50];
const pagination = reactive({ current: 1, pageSize: 10 });
const dialogVisible = ref(false);
const formRef = ref<FormInstanceFunctions>();
const confirmDialogVisible = ref(false);
const confirmType = ref<ConfirmType>('disable');
const confirmTarget = ref<Attribute | null>(null);
const deletePreview = ref<ProductAttributeDeletePreview | null>(null);
const form = reactive({ scope: 'shared' as Scope, name: '', valueType: '' as '' | ValueType });
const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入属性名称', type: 'error' }],
  valueType: [{ required: true, message: '请选择值类型', type: 'error' }],
};
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'name', title: '属性名称', minWidth: 260, align: 'left' },
  { colKey: 'valueType', title: '值类型', width: 220, align: 'left' },
  { colKey: 'templateCount', title: '被引用次数', width: 190, align: 'left' },
  { colKey: 'status', title: '状态', width: 150, align: 'left' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'left' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'left' },
  {
    colKey: 'operation',
    title: '操作',
    width: 116,
    align: 'left',
    fixed: 'right',
  },
]);
const filteredData = computed(() =>
  data.value.filter(
    (item) => item.scope === activeScope.value && (!applied.keyword || item.name.includes(applied.keyword)),
  ),
);
const pageData = computed(() =>
  filteredData.value.slice((pagination.current - 1) * pagination.pageSize, pagination.current * pagination.pageSize),
);
const totalCount = computed(() => filteredData.value.length);
const valueTypeLabel = (type: ValueType) => ({ select: '标准选项', number: '数值 + 单位', text: '文本输入' })[type];
const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);
  const pad = (number: number) => number.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const normalizeStatus = (status?: ProductAttributeRecord['status']): Status =>
  status === 'disabled' ? 'disabled' : 'enabled';
const createAttributeCode = (record: ProductAttributeRecord) => `attribute-${record.id}`;
const toAttribute = (record: ProductAttributeRecord): Attribute => ({
  id: record.id,
  code: createAttributeCode(record),
  name: record.name,
  scope: record.scope,
  valueType: record.valueType,
  templateCount: record.templateCount ?? 0,
  status: normalizeStatus(record.status),
  createdByName: record.createdByName || '-',
  createdByAccountId: record.createdByAccountId,
  createdAt: formatDateTime(record.createdAt),
});
const loadAttributes = async () => {
  loading.value = true;
  try {
    const records = await listProductAttributes();
    data.value = records.map(toAttribute);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '属性列表加载失败');
  } finally {
    loading.value = false;
  }
};
const search = () => {
  Object.assign(applied, searchForm);
  pagination.current = 1;
};
const reset = () => {
  searchForm.keyword = '';
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
const pageScrollTop = ref(0);
const rememberPageScroll = () => {
  if (typeof window !== 'undefined') pageScrollTop.value = window.scrollY || document.documentElement.scrollTop || 0;
};
const restorePageScroll = () => {
  if (typeof window !== 'undefined') window.requestAnimationFrame(() => window.scrollTo(0, pageScrollTop.value));
};
const openCreate = () => {
  if (!canCreateAttribute.value) return;
  form.scope = activeScope.value;
  form.name = '';
  form.valueType = '';
  rememberPageScroll();
  dialogVisible.value = true;
};
const closeCreateDialog = () => {
  dialogVisible.value = false;
  formRef.value?.clearValidate();
};
const submit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return rejectFormSubmission(formRef.value);
  const name = form.name.trim();
  try {
    await createProductAttribute({
      scope: form.scope,
      name,
      valueType: form.valueType as ValueType,
      attributeRole: 'basic',
      status: 'enabled',
    });
    await loadAttributes();
    pagination.current = 1;
    dialogVisible.value = false;
    formRef.value?.clearValidate();
    adminFeedback.created(name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};
const openStatusConfirm = (row: Attribute) => {
  if (!canToggleAttributeStatus.value) return;
  confirmTarget.value = row;
  confirmType.value = row.status === 'enabled' ? 'disable' : 'enable';
  confirmDialogVisible.value = true;
};
const openDeleteConfirm = async (row: Attribute) => {
  if (!canDeleteAttribute.value) return;
  try {
    const preview = await previewProductAttributeDelete(row.id);
    if (preview.deletionMode === 'blocked') {
      adminFeedback.error(preview.message || '该属性当前不能删除');
      return;
    }
    confirmTarget.value = row;
    confirmType.value = 'delete';
    deletePreview.value = preview;
    confirmDialogVisible.value = true;
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '删除条件检查失败');
  }
};
const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmTarget.value = null;
  deletePreview.value = null;
};
const confirmText = computed(() => {
  const name = confirmTarget.value?.name ?? '';
  if (confirmType.value === 'delete' && deletePreview.value?.deletionMode === 'physical') {
    return `删除属性“${name}”将同步删除其下 ${deletePreview.value.attributeValueCount} 个属性值，删除后不可恢复，是否继续？`;
  }
  if (confirmType.value === 'delete' && deletePreview.value?.deletionMode === 'business') {
    return `属性“${name}”仅被已售完商品历史使用。删除后将不再用于新商品和分类模板，但已售完商品仍保留历史属性信息，是否继续？`;
  }
  return `是否${confirmType.value === 'disable' ? '停用' : confirmType.value === 'enable' ? '启用' : '删除'}属性“${name}”？`;
});
const handleConfirm = async () => {
  if (!confirmTarget.value) return;
  const target = confirmTarget.value;
  const action = confirmType.value === 'delete' ? '删除' : confirmType.value === 'enable' ? '启用' : '停用';

  try {
    if (confirmType.value === 'delete') {
      const result = await deleteProductAttribute(target.id);
      data.value = data.value.filter((item) => item.id !== target.id);
      ensureCurrentPage();
      if (result.deletionMode === 'physical') {
        if (result.attributeValueCount > 0) {
          adminFeedback.success(`属性“${target.name}”及其 ${result.attributeValueCount} 个属性值已删除。`);
        } else {
          adminFeedback.deleted(target.name);
        }
      } else {
        adminFeedback.success(`属性“${target.name}”已删除，历史商品数据已保留。`);
      }
    } else {
      const updated = await updateProductAttributeStatus(
        target.id,
        confirmType.value === 'enable' ? 'enabled' : 'disabled',
      );
      const targetIndex = data.value.findIndex((item) => item.id === target.id);
      if (targetIndex !== -1) {
        data.value.splice(targetIndex, 1, toAttribute(updated));
      }
    }
    if (confirmType.value !== 'delete') {
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
    pagination.current = 1;
  },
);
watch(activeScope, () => {
  pagination.current = 1;
});
onMounted(loadAttributes);
</script>

<style scoped>
.attribute-list-layout {
  grid-template-columns: minmax(0, 1fr);
}
.page-tip {
  margin-bottom: 16px;
}
.list-controls {
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-xxl);
}
.scope-controls {
  min-width: 0;
}
.source-caption {
  margin-top: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}
:deep(.zdm-admin-list-layout__toolbar) {
  display: block;
  min-height: 0;
}
.table-toolbar {
  display: flex;
  align-items: center;
}
.table-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s) var(--td-comp-margin-l);
}
.table-action-placeholder {
  color: var(--td-text-color-placeholder);
}
:global(.attribute-create-dialog .t-dialog__body) {
  max-height: none;
  overflow: visible;
}

/* Preserve native option gaps; the trailing margin must not force a third option onto a new line. */
.attribute-value-types :deep(.t-radio:last-child) {
  margin-right: 0;
}
</style>
