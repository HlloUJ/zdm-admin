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
      <div class="top-actions">
        <t-button shape="square" variant="text" aria-label="消息通知"><t-icon name="notification" /></t-button>
        <div class="user-entry"><t-avatar size="small">超</t-avatar><span>超级管理员</span></div>
      </div>
    </header>

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <AdminPageHeader :breadcrumbs="['商品基础数据中心', '类目属性模板']" :badge="pageTitle" />

        <section class="table-card source-card">
          <t-tabs v-model="activeScope" :list="scopeTabs" />
          <div class="selector-row">
            <t-select
              v-model="selectedCategoryId"
              class="category-select"
              filterable
              placeholder="请选择分类"
              :loading="loading"
            >
              <t-option
                v-for="item in categoryOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
                :disabled="item.disabled"
              />
            </t-select>
            <t-button theme="primary" :disabled="!selectedCategoryId" @click="openBindDialog">
              <template #icon><t-icon name="add" /></template>绑定属性
            </t-button>
          </div>
        </section>

        <AdminListLayout>
          <template #filters>
            <t-form :data="searchForm" label-width="72px" colon>
              <div class="filter-row">
                <div class="filter-fields">
                  <t-form-item label="属性名称">
                    <t-input v-model="searchForm.keyword" clearable placeholder="请输入" />
                  </t-form-item>
                  <t-form-item label="状态">
                    <t-select v-model="searchForm.status" clearable placeholder="全部">
                      <t-option label="启用" value="enabled" />
                      <t-option label="停用" value="disabled" />
                    </t-select>
                  </t-form-item>
                </div>
                <div class="filter-actions">
                  <t-button theme="primary" @click="search">
                    <template #icon><t-icon name="search" /></template>查询
                  </t-button>
                  <t-button variant="base" @click="reset">重置</t-button>
                </div>
              </div>
            </t-form>
          </template>

          <template #toolbar>
            <span class="toolbar-title">{{ selectedCategoryName }}</span>
          </template>

          <template #table>
            <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
              <template #valueType="{ row }">{{ valueTypeLabel(row.valueType) }}</template>
              <template #requiredFlag="{ row }">
                <t-switch
                  :model-value="row.requiredFlag"
                  :loading="savingId === row.id"
                  @change="changeFlag(row, 'requiredFlag', $event)"
                />
              </template>
              <template #skuFlag="{ row }">
                <t-switch
                  :model-value="row.skuFlag"
                  :loading="savingId === row.id"
                  @change="changeFlag(row, 'skuFlag', $event)"
                />
              </template>
              <template #sortOrder="{ row }">
                <t-input-number
                  :model-value="row.sortOrder"
                  theme="column"
                  size="small"
                  :min="0"
                  :max="999"
                  @change="changeSort(row, $event)"
                />
              </template>
              <template #status="{ row }">
                <t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">
                  {{ row.status === 'enabled' ? '启用' : '停用' }}
                </t-tag>
              </template>
              <template #operation="{ row }">
                <div class="table-actions">
                  <t-link :theme="row.status === 'enabled' ? 'warning' : 'success'" @click="toggleStatus(row)">
                    {{ row.status === 'enabled' ? '停用' : '启用' }}
                  </t-link>
                  <t-link theme="danger" @click="openDeleteConfirm(row)">删除</t-link>
                </div>
              </template>
            </t-table>
          </template>

          <template #pagination>
            <AdminPagination
              v-model:current="pagination.current"
              v-model:page-size="pagination.pageSize"
              :total="totalCount"
              :page-size-options="pageSizeOptions"
              @change="handlePaginationChange"
            />
          </template>
        </AdminListLayout>
      </main>
    </div>

    <AdminDialog
      v-model:visible="bindDialogVisible"
      header="绑定属性"
      width="560px"
      placement="center"
      :prevent-scroll-through="false"
      confirm-btn="提交"
      @confirm="submitBind"
      @close="closeBindDialog"
    >
      <t-form :data="bindForm" label-width="96px" colon>
        <t-form-item label="商品分类">
          <t-input :value="selectedCategoryName" disabled />
        </t-form-item>
        <t-form-item label="标准属性" required-mark>
          <t-select v-model="bindForm.attributeId" filterable placeholder="请选择属性">
            <t-option
              v-for="item in availableAttributeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="发布规则">
          <t-checkbox v-model="bindForm.requiredFlag">必填</t-checkbox>
          <t-checkbox v-model="bindForm.skuFlag">SKU</t-checkbox>
        </t-form-item>
      </t-form>
    </AdminDialog>

    <t-dialog
      v-model:visible="deleteConfirmVisible"
      header="系统提示"
      width="420px"
      placement="center"
      confirm-btn="确认"
      cancel-btn="取消"
      @confirm="handleDelete"
      @close="closeDeleteConfirm"
    >
      是否删除属性【{{ deleteTarget?.name }}】？
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import { AdminDialog, AdminListLayout, AdminPageHeader, AdminPagination } from '@/components/foundation';
import {
  createCategoryAttribute,
  deleteCategoryAttribute,
  listCategoryAttributes,
  updateCategoryAttribute,
  type CategoryAttributePayload,
  type CategoryAttributeRecord,
} from '@/services/categoryAttributes';
import { listProductAttributes, type ProductAttributeRecord } from '@/services/productAttributes';
import { listProductCategories, type ProductCategoryRecord } from '@/services/productCategories';

type Scope = 'finished' | 'accessory';
type Status = 'enabled' | 'disabled';

interface CategoryOption {
  label: string;
  value: number;
  disabled: boolean;
}

interface BindingRow {
  id: number;
  categoryId: number;
  attributeId: number;
  name: string;
  scope: ProductAttributeRecord['scope'];
  valueType: ProductAttributeRecord['valueType'];
  requiredFlag: boolean;
  skuFlag: boolean;
  sortOrder: number;
  status: Status;
}

const activeScope = ref<Scope>('finished');
const scopeTabs = [
  { label: '成品现货模板', value: 'finished' },
  { label: '配件模板', value: 'accessory' },
];
const pageTitle = computed(() => (activeScope.value === 'finished' ? '成品现货发布模板' : '配件发布模板'));
const loading = ref(false);
const savingId = ref<number | null>(null);
const categories = ref<ProductCategoryRecord[]>([]);
const attributes = ref<ProductAttributeRecord[]>([]);
const bindings = ref<CategoryAttributeRecord[]>([]);
const selectedCategoryId = ref<number | undefined>();
const bindDialogVisible = ref(false);
const deleteConfirmVisible = ref(false);
const deleteTarget = ref<BindingRow | null>(null);
const searchForm = reactive({ keyword: '', status: '' as Status | '' });
const appliedSearch = reactive({ keyword: '', status: '' as Status | '' });
const pagination = reactive({ current: 1, pageSize: 10 });
const pageSizeOptions = [10, 20, 50];
const bindForm = reactive({ attributeId: undefined as number | undefined, requiredFlag: true, skuFlag: false });

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '属性名称', minWidth: 160, ellipsis: true },
  { colKey: 'valueType', title: '值类型', width: 120 },
  { colKey: 'requiredFlag', title: '必填', width: 90, align: 'center' },
  { colKey: 'skuFlag', title: 'SKU', width: 90, align: 'center' },
  { colKey: 'sortOrder', title: '排序', width: 120, align: 'center' },
  { colKey: 'status', title: '状态', width: 90, align: 'center' },
  { colKey: 'operation', title: '操作', width: 140, fixed: 'right' },
];

const selectedCategoryName = computed(() => {
  const category = categories.value.find((item) => item.id === selectedCategoryId.value);
  return category?.name ?? '未选择分类';
});

const categoryOptions = computed(() => {
  const scopedCategories = categories.value
    .filter((item) => item.scope === activeScope.value)
    .sort((first, second) => (first.sortOrder ?? 0) - (second.sortOrder ?? 0) || first.id - second.id);
  const rows: CategoryOption[] = [];
  collectCategoryOptions(scopedCategories, undefined, 0, rows);
  return rows;
});

const bindingRows = computed<BindingRow[]>(() => {
  const attributeMap = new Map(attributes.value.map((item) => [item.id, item]));
  return bindings.value
    .filter((item) => item.categoryId === selectedCategoryId.value)
    .map((item) => {
      const attribute = attributeMap.get(item.attributeId);
      return {
        id: item.id,
        categoryId: item.categoryId,
        attributeId: item.attributeId,
        name: attribute?.name ?? `属性 #${item.attributeId}`,
        scope: attribute?.scope ?? 'shared',
        valueType: attribute?.valueType ?? 'text',
        requiredFlag: Boolean(item.requiredFlag),
        skuFlag: Boolean(item.skuFlag),
        sortOrder: item.sortOrder ?? 0,
        status: item.status ?? 'enabled',
      };
    })
    .filter((item) => {
      const keyword = appliedSearch.keyword.trim().toLowerCase();
      return (
        (!keyword || item.name.toLowerCase().includes(keyword)) &&
        (!appliedSearch.status || item.status === appliedSearch.status)
      );
    })
    .sort((first, second) => first.sortOrder - second.sortOrder || first.id - second.id);
});

const totalCount = computed(() => bindingRows.value.length);
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return bindingRows.value.slice(start, start + pagination.pageSize);
});

const boundAttributeIds = computed(
  () =>
    new Set(
      bindings.value.filter((item) => item.categoryId === selectedCategoryId.value).map((item) => item.attributeId),
    ),
);

const availableAttributeOptions = computed(() =>
  attributes.value
    .filter((item) => (item.scope === 'shared' || item.scope === activeScope.value) && item.status !== 'disabled')
    .filter((item) => !boundAttributeIds.value.has(item.id))
    .map((item) => ({
      label: `${item.name} / ${valueTypeLabel(item.valueType)}`,
      value: item.id,
    })),
);

function collectCategoryOptions(
  records: ProductCategoryRecord[],
  parentId: number | undefined,
  level: number,
  rows: CategoryOption[],
) {
  records
    .filter((item) => (item.parentId ?? undefined) === parentId)
    .forEach((item) => {
      const hasChildren = records.some((child) => child.parentId === item.id);
      rows.push({
        label: `${'　'.repeat(level)}${item.name}`,
        value: item.id,
        disabled: hasChildren || item.status === 'disabled',
      });
      collectCategoryOptions(records, item.id, level + 1, rows);
    });
}

function valueTypeLabel(value: ProductAttributeRecord['valueType']) {
  return { select: '标准选项', number: '数值', text: '文本' }[value];
}

function toPayload(row: BindingRow): CategoryAttributePayload {
  return {
    categoryId: row.categoryId,
    attributeId: row.attributeId,
    requiredFlag: row.requiredFlag,
    skuFlag: row.skuFlag,
    sortOrder: row.sortOrder,
    status: row.status,
  };
}

function syncSelectedCategory() {
  const firstAvailable = categoryOptions.value.find((item) => !item.disabled);
  const stillAvailable = categoryOptions.value.some(
    (item) => item.value === selectedCategoryId.value && !item.disabled,
  );
  selectedCategoryId.value = stillAvailable ? selectedCategoryId.value : firstAvailable?.value;
  pagination.current = 1;
}

async function loadData() {
  loading.value = true;
  try {
    const [categoryRecords, attributeRecords, bindingRecords] = await Promise.all([
      listProductCategories(),
      listProductAttributes(),
      listCategoryAttributes(),
    ]);
    categories.value = categoryRecords;
    attributes.value = attributeRecords;
    bindings.value = bindingRecords;
    syncSelectedCategory();
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '类目属性模板加载失败');
  } finally {
    loading.value = false;
  }
}

function search() {
  Object.assign(appliedSearch, searchForm);
  pagination.current = 1;
}

function reset() {
  searchForm.keyword = '';
  searchForm.status = '';
  search();
}

function handlePaginationChange(pageInfo: PageInfo) {
  pagination.current = pageInfo.current;
  pagination.pageSize = pageInfo.pageSize;
}

function openBindDialog() {
  if (!selectedCategoryId.value) {
    MessagePlugin.warning('请选择分类');
    return;
  }
  bindForm.attributeId = undefined;
  bindForm.requiredFlag = true;
  bindForm.skuFlag = false;
  bindDialogVisible.value = true;
}

function closeBindDialog() {
  bindDialogVisible.value = false;
}

async function submitBind() {
  if (!selectedCategoryId.value || !bindForm.attributeId) {
    MessagePlugin.warning('请选择属性');
    return;
  }
  try {
    const created = await createCategoryAttribute({
      categoryId: selectedCategoryId.value,
      attributeId: bindForm.attributeId,
      requiredFlag: bindForm.requiredFlag,
      skuFlag: bindForm.skuFlag,
      sortOrder: bindings.value.filter((item) => item.categoryId === selectedCategoryId.value).length + 1,
      status: 'enabled',
    });
    bindings.value.push(created);
    closeBindDialog();
    MessagePlugin.success('绑定成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '绑定失败');
  }
}

async function persistRow(row: BindingRow, patch: Partial<BindingRow>) {
  savingId.value = row.id;
  const nextRow = { ...row, ...patch };
  try {
    const updated = await updateCategoryAttribute(row.id, toPayload(nextRow));
    const index = bindings.value.findIndex((item) => item.id === row.id);
    if (index >= 0) bindings.value[index] = updated;
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  } finally {
    savingId.value = null;
  }
}

function getSwitchValue(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'value' in value) return Boolean((value as { value?: boolean }).value);
  return Boolean(value);
}

function changeFlag(row: BindingRow, field: 'requiredFlag' | 'skuFlag', value: unknown) {
  persistRow(row, { [field]: getSwitchValue(value) });
}

function changeSort(row: BindingRow, value: unknown) {
  const nextValue = typeof value === 'number' ? value : Number((value as { value?: number })?.value ?? row.sortOrder);
  if (Number.isNaN(nextValue) || nextValue === row.sortOrder) return;
  persistRow(row, { sortOrder: nextValue });
}

function toggleStatus(row: BindingRow) {
  persistRow(row, { status: row.status === 'enabled' ? 'disabled' : 'enabled' });
}

function openDeleteConfirm(row: BindingRow) {
  deleteTarget.value = row;
  deleteConfirmVisible.value = true;
}

function closeDeleteConfirm() {
  deleteConfirmVisible.value = false;
  deleteTarget.value = null;
}

async function handleDelete() {
  if (!deleteTarget.value) return;
  try {
    await deleteCategoryAttribute(deleteTarget.value.id);
    bindings.value = bindings.value.filter((item) => item.id !== deleteTarget.value?.id);
    closeDeleteConfirm();
    MessagePlugin.success('删除成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '删除失败');
  }
}

watch(activeScope, syncSelectedCategory);

onMounted(loadData);
</script>

<style scoped>
.source-card {
  margin-bottom: var(--td-comp-margin-l);
}

.selector-row {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-m);
  margin-top: var(--td-comp-margin-m);
}

.category-select {
  width: min(520px, 100%);
}

.toolbar-title {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.table-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-m);
}

@media (max-width: 900px) {
  .selector-row {
    align-items: stretch;
    flex-direction: column;
  }

  .category-select {
    width: 100%;
  }
}
</style>
