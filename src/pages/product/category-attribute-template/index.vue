<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <AdminPageHeader :breadcrumbs="['商品基础数据中心', '类目属性模板']" :badge="pageTitle" />

        <AdminListLayout>
          <template #toolbar>
            <div class="scope-controls">
              <t-tabs v-model="activeScope" :list="scopeTabs" />
            </div>
          </template>

          <template #table>
            <div class="category-template-layout">
              <aside class="category-panel">
                <div class="panel-toolbar">
                  <div>
                    <h2>商品分类</h2>
                    <p>仅末级分类可查看属性模板</p>
                  </div>
                </div>

                <div class="category-tree">
                  <template v-for="row in visibleCategoryRows" :key="row.node.id">
                    <div
                      v-if="row.node.children.length"
                      class="category-node category-node-parent"
                      :style="{ paddingLeft: `${row.level * 20 + 12}px` }"
                    >
                      <t-button
                        class="expand-button"
                        shape="square"
                        size="small"
                        variant="text"
                        :aria-label="`${isCategoryExpanded(row.node.id) ? '收起' : '展开'}${row.node.name}`"
                        @click="toggleCategory(row.node.id)"
                      >
                        <t-icon :name="isCategoryExpanded(row.node.id) ? 'chevron-down' : 'chevron-right'" />
                      </t-button>
                      <span class="category-name">{{ row.node.name }}</span>
                    </div>
                    <button
                      v-else
                      type="button"
                      class="category-node category-node-leaf"
                      :class="{ active: row.node.id === selectedCategoryId }"
                      :disabled="row.node.status === 'disabled'"
                      :style="{ paddingLeft: `${row.level * 20 + 12}px` }"
                      @click="selectLeafCategory(row.node)"
                    >
                      <span class="expand-placeholder"></span>
                      <span class="category-name">{{ row.node.name }}</span>
                    </button>
                  </template>
                  <div v-if="!visibleCategoryRows.length && !loading" class="category-empty">暂无分类</div>
                </div>
              </aside>

              <section class="template-panel">
                <div class="panel-toolbar">
                  <div>
                    <h2>{{ selectedCategoryId ? `${selectedCategoryName}属性模板` : '属性模板' }}</h2>
                    <p>{{ selectedCategoryId ? selectedCategoryPath : '请在左侧选择末级分类' }}</p>
                  </div>
                  <t-button theme="primary" :disabled="!selectedCategoryId" @click="openBindDialog">
                    <template #icon><t-icon name="add" /></template>绑定属性
                  </t-button>
                </div>

                <div class="template-search">
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
                </div>

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

                <AdminPagination
                  v-model:current="pagination.current"
                  v-model:page-size="pagination.pageSize"
                  :total="totalCount"
                  :page-size-options="pageSizeOptions"
                  @change="handlePaginationChange"
                />
              </section>
            </div>
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

interface CategoryTreeNode extends ProductCategoryRecord {
  children: CategoryTreeNode[];
}

interface CategoryTreeRow {
  node: CategoryTreeNode;
  level: number;
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
const expandedCategoryIds = ref<number[]>([]);
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

const categoryTree = computed(() => buildCategoryTree(undefined));

const visibleCategoryRows = computed(() => {
  const rows: CategoryTreeRow[] = [];
  categoryTree.value.forEach((node) => collectVisibleCategoryRows(node, 0, rows));
  return rows;
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

function buildCategoryTree(parentId: number | undefined): CategoryTreeNode[] {
  return scopedCategories.value
    .filter((item) => (item.parentId ?? undefined) === parentId)
    .map((item) => ({ ...item, children: buildCategoryTree(item.id) }));
}

function collectVisibleCategoryRows(node: CategoryTreeNode, level: number, rows: CategoryTreeRow[]) {
  rows.push({ node, level });
  if (!isCategoryExpanded(node.id)) return;
  node.children.forEach((child) => collectVisibleCategoryRows(child, level + 1, rows));
}

function isCategoryExpanded(categoryId: number) {
  return expandedCategoryIds.value.includes(categoryId);
}

function expandAllCategories() {
  expandedCategoryIds.value = scopedCategories.value
    .filter((item) => hasCategoryChildren(item.id))
    .map((item) => item.id);
}

function toggleCategory(categoryId: number) {
  expandedCategoryIds.value = isCategoryExpanded(categoryId)
    ? expandedCategoryIds.value.filter((id) => id !== categoryId)
    : [...expandedCategoryIds.value, categoryId];
}

function selectLeafCategory(category: CategoryTreeNode) {
  if (category.children.length || category.status === 'disabled') return;
  selectedCategoryId.value = category.id;
  reset();
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
    expandAllCategories();
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

watch(activeScope, () => {
  selectedCategoryId.value = undefined;
  expandAllCategories();
  reset();
});

onMounted(loadData);
</script>

<style scoped>
.scope-controls {
  min-width: 0;
}

.category-template-layout {
  display: grid;
  grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
  gap: var(--td-comp-margin-l);
}

.category-panel,
.template-panel {
  min-width: 0;
  min-height: 600px;
  overflow: hidden;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 72px;
  gap: var(--td-comp-margin-m);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-border);
}

.panel-toolbar h2 {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.panel-toolbar p {
  margin: 2px 0 0;
  color: var(--td-text-color-secondary);
  font-size: 12px;
}

.category-tree {
  max-height: 640px;
  padding: var(--td-comp-paddingTB-s) 0;
  overflow-y: auto;
}

.category-node {
  display: flex;
  align-items: center;
  width: 100%;
  height: 40px;
  gap: var(--td-comp-margin-xs);
  padding-right: var(--td-comp-paddingLR-s);
  color: var(--td-text-color-primary);
  background: transparent;
  border: 0;
  text-align: left;
}

.category-node-leaf {
  cursor: pointer;
}

.category-node-leaf:hover:not(:disabled),
.category-node-leaf.active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.category-node-leaf:disabled {
  color: var(--td-text-color-disabled);
  cursor: not-allowed;
}

.expand-button,
.expand-placeholder {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
}

.category-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-empty {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-l);
  color: var(--td-text-color-secondary);
  text-align: center;
}

.template-search {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-border);
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

.template-panel :deep(.t-table) {
  border-radius: 0;
}

.template-panel :deep(.zdm-admin-pagination) {
  padding: 0 var(--td-comp-paddingLR-xl) var(--td-comp-paddingTB-l);
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
  .category-template-layout {
    grid-template-columns: 240px minmax(0, 1fr);
  }

  .filter-row {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-actions {
    flex-wrap: wrap;
  }
}

@media (max-width: 720px) {
  .category-template-layout {
    grid-template-columns: 1fr;
  }

  .category-panel,
  .template-panel {
    min-height: auto;
  }

  .category-tree {
    max-height: 360px;
  }

  .filter-fields :deep(.t-form__item) {
    width: 100%;
  }
}
</style>
