<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <AdminPageHeader :breadcrumbs="['商品基础数据中心', '属性库管理']" :badge="pageTitle" />
        <t-alert theme="info" class="page-tip"
          >属性库仅维护属性定义和值类型；必填及 SKU 规则统一在类目属性模板中配置。</t-alert
        >
        <section v-if="!lockedScope" class="table-card source-card">
          <t-tabs v-model="activeScope" :list="scopeTabs" />
          <div class="source-caption">{{ sourceDescription }}</div>
        </section>
        <AdminListLayout>
          <template #filters>
            <t-form :data="searchForm" label-width="72px" colon>
              <div class="filter-row">
                <div class="filter-fields">
                  <t-form-item label="属性名称"
                    ><t-input v-model="searchForm.keyword" clearable placeholder="请输入"
                  /></t-form-item>
                </div>
                <div class="filter-actions">
                  <t-button theme="primary" @click="search"
                    ><template #icon><t-icon name="search" /></template>查询</t-button
                  ><t-button variant="base" @click="reset">重置</t-button>
                </div>
              </div>
            </t-form>
          </template>
          <template #toolbar
            ><t-button theme="primary" @click="openCreate"
              ><template #icon><t-icon name="add" /></template>新增</t-button
            ></template
          >
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
                    :theme="row.status === 'enabled' ? 'warning' : 'success'"
                    hover="color"
                    @click="openStatusConfirm(row)"
                    >{{ row.status === 'enabled' ? '停用' : '启用' }}</t-link
                  ><t-link theme="danger" hover="color" @click="openDeleteConfirm(row)">删除</t-link>
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
      :prevent-scroll-through="false"
      dialog-class-name="attribute-create-dialog"
      confirm-btn="提交"
      @confirm="submit"
      @close="closeCreateDialog"
      @opened="restorePageScroll"
      @closed="restorePageScroll"
    >
      <t-form ref="formRef" :data="form" :rules="formRules" label-width="96px" colon>
        <t-form-item label="属性名称" name="name" required-mark
          ><t-input v-model="form.name" clearable placeholder="请输入属性名称"
        /></t-form-item>
        <t-form-item label="值类型" name="valueType" required-mark
          ><t-radio-group v-model="form.valueType"
            ><t-radio value="select">标准选项</t-radio><t-radio value="number">数值+单位</t-radio
            ><t-radio value="text">文本输入</t-radio></t-radio-group
          ></t-form-item
        >
      </t-form>
    </AdminDialog>
    <t-dialog
      v-model:visible="confirmDialogVisible"
      :header="confirmTitle"
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
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { AdminDialog, AdminListLayout, AdminPageHeader, AdminPagination } from '@/components/foundation';
import {
  createProductAttribute,
  deleteProductAttribute,
  listProductAttributes,
  updateProductAttribute,
  type ProductAttributePayload,
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
}

const route = useRoute();
const resolveScope = (value: unknown): Scope =>
  value === 'finished' || value === 'accessory' || value === 'shared' ? value : 'shared';
const activeScope = ref<Scope>(resolveScope(route.query.scope));
const lockedScope = computed(
  () => route.query.scope === 'finished' || route.query.scope === 'accessory' || route.query.scope === 'shared',
);
const pageTitle = computed(
  () => ({ shared: '共享基础属性库', finished: '成品现货属性库', accessory: '配件属性库' })[activeScope.value],
);
const scopeTabs = [
  { label: '共享基础属性', value: 'shared' },
  { label: '成品现货专属属性', value: 'finished' },
  { label: '配件专属属性', value: 'accessory' },
];
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
const form = reactive({ scope: 'shared' as Scope, name: '', valueType: '' as '' | ValueType });
const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入属性名称', type: 'error' }],
  valueType: [{ required: true, message: '请选择值类型', type: 'error' }],
};
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '属性名称', width: 260, align: 'left' },
  { colKey: 'valueType', title: '值类型', width: 220, align: 'left' },
  { colKey: 'templateCount', title: '引用类目模板', width: 190, align: 'left' },
  { colKey: 'status', title: '状态', width: 150, align: 'left' },
  { colKey: 'operation', title: '操作', width: 160, align: 'left', fixed: 'right' },
];
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
const normalizeStatus = (status?: ProductAttributeRecord['status']): Status =>
  status === 'disabled' ? 'disabled' : 'enabled';
const createAttributeCode = (record: ProductAttributeRecord) => `attribute-${record.id}`;
const toAttribute = (record: ProductAttributeRecord): Attribute => ({
  id: record.id,
  code: createAttributeCode(record),
  name: record.name,
  scope: record.scope,
  valueType: record.valueType,
  templateCount: 0,
  status: normalizeStatus(record.status),
});
const toAttributePayload = (item: Attribute): ProductAttributePayload => ({
  scope: item.scope,
  name: item.name,
  valueType: item.valueType,
  attributeRole: 'basic',
  status: item.status,
});
const loadAttributes = async () => {
  loading.value = true;
  try {
    const records = await listProductAttributes();
    data.value = records.map(toAttribute);
    ensureCurrentPage();
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '属性列表加载失败');
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
  if (result !== true) return;
  try {
    await createProductAttribute({
      scope: form.scope,
      name: form.name.trim(),
      valueType: form.valueType as ValueType,
      attributeRole: 'basic',
      status: 'enabled',
    });
    await loadAttributes();
    pagination.current = 1;
    dialogVisible.value = false;
    formRef.value?.clearValidate();
    MessagePlugin.success('已新增标准属性');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};
const openStatusConfirm = (row: Attribute) => {
  confirmTarget.value = row;
  confirmType.value = row.status === 'enabled' ? 'disable' : 'enable';
  confirmDialogVisible.value = true;
};
const openDeleteConfirm = (row: Attribute) => {
  confirmTarget.value = row;
  confirmType.value = 'delete';
  confirmDialogVisible.value = true;
};
const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmTarget.value = null;
};
const confirmTitle = computed(
  () => ({ disable: '确认停用', enable: '确认启用', delete: '确认删除' })[confirmType.value],
);
const confirmText = computed(() => {
  const name = confirmTarget.value?.name ?? '';
  return `是否${confirmType.value === 'disable' ? '停用' : confirmType.value === 'enable' ? '启用' : '删除'}属性【${name}】？`;
});
const handleConfirm = async () => {
  if (!confirmTarget.value) return;

  try {
    if (confirmType.value === 'delete') {
      await deleteProductAttribute(confirmTarget.value.id);
      data.value = data.value.filter((item) => item.id !== confirmTarget.value?.id);
      ensureCurrentPage();
      MessagePlugin.success('删除成功');
    } else {
      const updated = await updateProductAttribute(
        confirmTarget.value.id,
        toAttributePayload({
          ...confirmTarget.value,
          status: confirmType.value === 'enable' ? 'enabled' : 'disabled',
        }),
      );
      const targetIndex = data.value.findIndex((item) => item.id === confirmTarget.value?.id);
      if (targetIndex !== -1) {
        data.value.splice(targetIndex, 1, toAttribute(updated));
      }
      MessagePlugin.success(confirmType.value === 'enable' ? '已启用属性' : '已停用属性');
    }
    closeConfirmDialog();
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};
watch(
  () => route.query.scope,
  (scope) => {
    activeScope.value = resolveScope(scope);
    pagination.current = 1;
  },
);
watch(activeScope, () => {
  pagination.current = 1;
});
onMounted(loadAttributes);
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
.page-tip,
.source-card {
  margin-bottom: 16px;
}
.source-card {
  padding: 24px 24px 14px;
  background: var(--td-bg-color-container);
  border-radius: 6px;
  box-shadow: var(--td-shadow-1);
}
.source-caption {
  margin-top: 12px;
  color: var(--td-text-color-secondary);
  font-size: 13px;
}
.filter-row,
.filter-fields,
.filter-actions,
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
.table-actions {
  gap: 12px;
}
:global(.attribute-create-dialog .t-dialog__body) {
  max-height: none;
  overflow: visible;
}
:deep(.t-table th),
:deep(.t-table td) {
  padding-left: 24px;
  padding-right: 24px;
}
:deep(.zdm-admin-list-layout__pagination .zdm-admin-pagination) {
  width: 100%;
  margin-top: 0;
}
</style>
