<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <AdminPageHeader :breadcrumbs="['商品基础数据中心', '类目属性模板']" :badge="pageTitle" />

        <AdminListLayout>
          <template #toolbar>
            <div class="list-controls">
              <div class="scope-controls">
                <t-tabs v-model="activeScope" :list="scopeTabs" />
              </div>

              <div class="selected-category">
                <span>当前分类：</span>
                <span class="selected-category-path">{{ selectedCategoryPath }}</span>
                <t-button size="small" variant="outline" @click="openCategoryDialog">切换分类</t-button>
              </div>

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
                    <t-button theme="default" variant="base" @click="reset">
                      <template #icon><t-icon name="refresh" /></template>重置
                    </t-button>
                  </div>
                </div>
              </t-form>

              <div class="table-toolbar">
                <span class="toolbar-title">{{ selectedCategoryName }}</span>
                <t-button theme="primary" :disabled="!selectedCategoryId" @click="openBindDialog">
                  <template #icon><t-icon name="add" /></template>绑定属性
                </t-button>
              </div>
            </div>
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
      v-model:visible="categoryDialogVisible"
      header="选择商品分类"
      width="760px"
      placement="center"
      :prevent-scroll-through="false"
      confirm-btn="确认"
      cancel-btn="取消"
      @confirm="confirmCategorySelection"
      @close="closeCategoryDialog"
    >
      <div class="category-picker">
        <div v-for="(column, columnIndex) in categoryColumns" :key="columnIndex" class="category-column">
          <button
            v-for="item in column"
            :key="item.id"
            type="button"
            :disabled="item.status === 'disabled'"
            :class="['category-option', pendingCategoryPathIds[columnIndex] === item.id && 'active']"
            @click="selectCategory(columnIndex, item)"
          >
            <span>{{ item.name }}</span>
            <t-icon v-if="hasCategoryChildren(item.id)" name="chevron-right" />
          </button>
        </div>
      </div>
    </AdminDialog>

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
          <t-input :value="selectedCategoryPath" disabled />
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
import AdminTopNav from '@/components/AdminTopNav.vue';
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
  createdByName: string;
  createdAt: string;
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
const pendingCategoryId = ref<number | undefined>();
const pendingCategoryPathIds = ref<number[]>([]);
const categoryDialogVisible = ref(false);
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
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'left' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'left' },
  { colKey: 'operation', title: '操作', width: 140, fixed: 'right' },
];

const selectedCategoryName = computed(() => {
  const category = categories.value.find((item) => item.id === selectedCategoryId.value);
  return category?.name ?? '未选择分类';
});

const selectedCategoryPath = computed(() => {
  if (!selectedCategoryId.value) return '未选择分类';

  const categoryMap = new Map(categories.value.map((item) => [item.id, item]));
  const names: string[] = [];
  let current = categoryMap.get(selectedCategoryId.value);
  while (current) {
    names.unshift(current.name);
    current = current.parentId ? categoryMap.get(current.parentId) : undefined;
  }
  return names.join(' > ') || '未选择分类';
});

const scopedCategories = computed(() =>
  categories.value
    .filter((item) => item.scope === activeScope.value)
    .sort((first, second) => (first.sortOrder ?? 0) - (second.sortOrder ?? 0) || first.id - second.id),
);

const categoryColumns = computed(() => {
  const columns: ProductCategoryRecord[][] = [
    scopedCategories.value.filter((item) => (item.parentId ?? undefined) === undefined),
  ];
  pendingCategoryPathIds.value.forEach((categoryId) => {
    const children = scopedCategories.value.filter((item) => item.parentId === categoryId);
    if (children.length) columns.push(children);
  });
  return columns;
});

const bindingRows = computed<BindingRow[]>(() => {
  if (!selectedCategoryId.value) return [];

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
        createdByName: item.createdByName || '-',
        createdAt: formatDateTime(item.createdAt),
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

function hasCategoryChildren(categoryId: number) {
  return scopedCategories.value.some((item) => item.parentId === categoryId);
}

function getCategoryPathIds(categoryId?: number) {
  if (!categoryId) return [];

  const categoryMap = new Map(scopedCategories.value.map((item) => [item.id, item]));
  const pathIds: number[] = [];
  let current = categoryMap.get(categoryId);
  while (current) {
    pathIds.unshift(current.id);
    current = current.parentId ? categoryMap.get(current.parentId) : undefined;
  }
  return pathIds;
}

function valueTypeLabel(value: ProductAttributeRecord['valueType']) {
  return { select: '标准选项', number: '数值', text: '文本' }[value];
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (number: number) => number.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  const selectedCategory = scopedCategories.value.find((item) => item.id === selectedCategoryId.value);
  const stillAvailable = Boolean(
    selectedCategory && selectedCategory.status !== 'disabled' && !hasCategoryChildren(selectedCategory.id),
  );
  if (!stillAvailable) selectedCategoryId.value = undefined;
  pendingCategoryId.value = selectedCategoryId.value;
  pendingCategoryPathIds.value = getCategoryPathIds(selectedCategoryId.value);
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

function openCategoryDialog() {
  pendingCategoryId.value = selectedCategoryId.value;
  pendingCategoryPathIds.value = getCategoryPathIds(selectedCategoryId.value);
  categoryDialogVisible.value = true;
}

function closeCategoryDialog() {
  categoryDialogVisible.value = false;
  pendingCategoryId.value = selectedCategoryId.value;
  pendingCategoryPathIds.value = getCategoryPathIds(selectedCategoryId.value);
}

function selectCategory(columnIndex: number, category: ProductCategoryRecord) {
  pendingCategoryPathIds.value = [...pendingCategoryPathIds.value.slice(0, columnIndex), category.id];
  pendingCategoryId.value = hasCategoryChildren(category.id) ? undefined : category.id;
}

function confirmCategorySelection() {
  if (!pendingCategoryId.value) {
    MessagePlugin.warning('请选择末级分类');
    return;
  }
  selectedCategoryId.value = pendingCategoryId.value;
  reset();
  closeCategoryDialog();
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

watch(activeScope, () => {
  selectedCategoryId.value = undefined;
  pendingCategoryId.value = undefined;
  pendingCategoryPathIds.value = [];
  reset();
});

onMounted(loadData);
</script>

<style scoped>
.list-controls {
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-l);
}

.scope-controls {
  min-width: 0;
}

:deep(.zdm-admin-list-layout__toolbar) {
  display: block;
  min-height: 0;
}

.selected-category {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.selected-category-path {
  color: var(--td-text-color-primary);
  font-weight: 500;
}

.category-picker {
  display: grid;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: var(--td-comp-margin-s);
  min-height: 280px;
}

.category-column {
  min-width: 0;
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  overflow-y: auto;
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.category-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 38px;
  padding: 0 var(--td-comp-paddingLR-s);
  color: var(--td-text-color-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--td-radius-default);
}

.category-option:hover:not(:disabled),
.category-option.active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.category-option.active {
  font-weight: 700;
}

.category-option:disabled {
  color: var(--td-text-color-disabled);
  cursor: not-allowed;
}

.toolbar-title {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
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
  justify-content: space-between;
}

.table-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  white-space: nowrap;
}

:deep(.t-table th),
:deep(.t-table td) {
  padding-right: 24px;
  padding-left: 24px;
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
  .selected-category {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .category-picker {
    grid-auto-flow: row;
    grid-template-columns: 1fr;
  }

  .filter-fields :deep(.t-form__item) {
    width: 100%;
  }
}
</style>
