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
                <div class="category-search">
                  <t-input
                    v-model="categoryKeyword"
                    clearable
                    placeholder="请输入分类名称"
                    @clear="clearCategorySearch"
                    @enter="searchCategory"
                  />
                  <t-button theme="default" variant="base" @click="searchCategory">搜索</t-button>
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
                      :aria-label="row.node.name"
                      :class="{ active: row.node.id === selectedCategoryId }"
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
                  <div class="template-toolbar">
                    <t-button
                      v-if="canBindAttribute"
                      theme="primary"
                      :disabled="!selectedCategoryId"
                      @click="openBindDialog"
                    >
                      <template #icon><t-icon name="add" /></template>绑定属性
                    </t-button>
                  </div>
                </div>

                <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
                  <template #valueType="{ row }">{{ valueTypeLabel(row.valueType) }}</template>
                  <template #requiredFlag="{ row }">
                    <t-switch
                      :model-value="row.requiredFlag"
                      :loading="savingId === row.id && savingField === 'requiredFlag'"
                      :disabled="!canEditBinding"
                      @change="changeFlag(row, 'requiredFlag', $event)"
                    />
                  </template>
                  <template #skuFlag="{ row }">
                    <t-switch
                      :model-value="row.skuFlag"
                      :loading="savingId === row.id && savingField === 'skuFlag'"
                      :disabled="!canEditBinding"
                      @change="changeFlag(row, 'skuFlag', $event)"
                    />
                  </template>
                  <template #sortOrder="{ row }">
                    <div v-if="canEditBinding" class="table-actions">
                      <t-link
                        theme="primary"
                        :disabled="savingId !== null || bindingIndex(row) === 0"
                        @click="moveBinding(row, -1)"
                      >
                        上移
                      </t-link>
                      <t-link
                        theme="primary"
                        :disabled="savingId !== null || bindingIndex(row) === allBindingRows.length - 1"
                        @click="moveBinding(row, 1)"
                      >
                        下移
                      </t-link>
                    </div>
                    <span v-else>-</span>
                  </template>
                  <template #status="{ row }">
                    <t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">
                      {{ row.status === 'enabled' ? '启用' : '停用' }}
                    </t-tag>
                  </template>
                  <template #operation="{ row }">
                    <div class="table-actions">
                      <t-link v-if="canRemoveBinding" theme="danger" @click="openDeleteConfirm(row)">移除</t-link>
                      <span v-else>-</span>
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
      width="760px"
      confirm-btn="提交"
      @confirm="submitBind"
      @close="closeBindDialog"
    >
      <div class="bind-category-context">
        <span class="bind-category-label">商品分类：</span>
        <span>{{ selectedCategoryPath }}</span>
      </div>
      <t-transfer
        v-model="bindForm.attributeIds"
        class="bind-transfer"
        :data="bindAttributeOptions"
        :empty="['暂无可绑定属性', '暂无已绑定属性']"
        :title="['待绑定属性', '已绑定属性']"
        search
        show-check-all
        target-sort="original"
      />
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
      是否移除属性【{{ deleteTarget?.name }}】？
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
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createCategoryAttributes,
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
const permissionPrefix = 'admin.product-data-center.category-attribute-template';
const loginUser = computed(() => getLoginUser());
const canBindAttribute = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.create`));
const canEditBinding = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.edit`));
const canRemoveBinding = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.delete`));
const scopeTabs = [
  { label: '成品现货模板', value: 'finished' },
  { label: '配件模板', value: 'accessory' },
];
const pageTitle = computed(() => (activeScope.value === 'finished' ? '成品现货发布模板' : '配件发布模板'));
const loading = ref(false);
const savingId = ref<number | null>(null);
const savingField = ref<'requiredFlag' | 'skuFlag' | null>(null);
const categories = ref<ProductCategoryRecord[]>([]);
const attributes = ref<ProductAttributeRecord[]>([]);
const bindings = ref<CategoryAttributeRecord[]>([]);
const selectedCategoryId = ref<number | undefined>();
const expandedCategoryIds = ref<number[]>([]);
const categoryKeyword = ref('');
const appliedCategoryKeyword = ref('');
const bindDialogVisible = ref(false);
const deleteConfirmVisible = ref(false);
const deleteTarget = ref<BindingRow | null>(null);
const searchForm = reactive({ keyword: '', status: '' as Status | '' });
const appliedSearch = reactive({ keyword: '', status: '' as Status | '' });
const pagination = reactive({ current: 1, pageSize: 10 });
const pageSizeOptions = [10, 20, 50];
const bindForm = reactive({ attributeIds: [] as number[] });

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '属性名称', minWidth: 160, ellipsis: true },
  { colKey: 'valueType', title: '值类型', width: 120 },
  { colKey: 'requiredFlag', title: '必填', width: 90, align: 'center' },
  { colKey: 'skuFlag', title: 'SKU', width: 90, align: 'center' },
  { colKey: 'sortOrder', title: '排序', width: 120, align: 'center' },
  { colKey: 'status', title: '状态', width: 90, align: 'center' },
  { colKey: 'createdByName', title: '绑定人', width: 120, align: 'left' },
  { colKey: 'createdAt', title: '绑定时间', width: 180, align: 'left' },
  { colKey: 'operation', title: '操作', width: 140, fixed: 'right' },
];

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
    .filter((item) => item.scope === activeScope.value && item.status === 'enabled')
    .sort((first, second) => categoryCreatedAtTime(second) - categoryCreatedAtTime(first) || second.id - first.id),
);

const categoryTree = computed(() => filterCategoryTree(buildCategoryTree(undefined)));

const visibleCategoryRows = computed(() => {
  const rows: CategoryTreeRow[] = [];
  categoryTree.value.forEach((node) => collectVisibleCategoryRows(node, 0, rows));
  return rows;
});

const allBindingRows = computed<BindingRow[]>(() => {
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
        status: (attribute?.status === 'disabled' ? 'disabled' : 'enabled') as Status,
        createdByName: item.createdByName || '-',
        createdAt: formatDateTime(item.createdAt),
      };
    })
    .sort((first, second) => first.sortOrder - second.sortOrder || first.id - second.id);
});

const bindingRows = computed(() =>
  allBindingRows.value.filter((item) => {
    const keyword = appliedSearch.keyword.trim().toLowerCase();
    return (
      (!keyword || item.name.toLowerCase().includes(keyword)) &&
      (!appliedSearch.status || item.status === appliedSearch.status)
    );
  }),
);

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

const bindAttributeOptions = computed(() =>
  attributes.value
    .filter(
      (item) =>
        (item.scope === 'shared' || item.scope === activeScope.value) &&
        (item.status !== 'disabled' || boundAttributeIds.value.has(item.id)),
    )
    .map((item) => ({
      label: `${item.name} / ${valueTypeLabel(item.valueType)}`,
      value: item.id,
      disabled: boundAttributeIds.value.has(item.id),
    })),
);

function hasCategoryChildren(categoryId: number) {
  return scopedCategories.value.some((item) => item.parentId === categoryId);
}

function categoryCreatedAtTime(category: ProductCategoryRecord) {
  if (!category.createdAt) return 0;
  const timestamp = new Date(category.createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function buildCategoryTree(parentId: number | undefined): CategoryTreeNode[] {
  return scopedCategories.value
    .filter((item) => (item.parentId ?? undefined) === parentId)
    .map((item) => ({ ...item, children: buildCategoryTree(item.id) }));
}

function filterCategoryTree(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  const keyword = appliedCategoryKeyword.value.trim();
  if (!keyword) return nodes;

  return nodes.flatMap((node) => {
    if (node.name.includes(keyword)) return [node];
    const children = filterCategoryTree(node.children);
    return children.length ? [{ ...node, children }] : [];
  });
}

function collectVisibleCategoryRows(node: CategoryTreeNode, level: number, rows: CategoryTreeRow[]) {
  rows.push({ node, level });
  if (!appliedCategoryKeyword.value.trim() && !isCategoryExpanded(node.id)) return;
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
  if (category.children.length) return;
  selectedCategoryId.value = category.id;
  reset();
}

function findFirstLeaf(nodes: CategoryTreeNode[]): CategoryTreeNode | undefined {
  for (const node of nodes) {
    if (!node.children.length) return node;
    const leaf = findFirstLeaf(node.children);
    if (leaf) return leaf;
  }
  return undefined;
}

function searchCategory() {
  appliedCategoryKeyword.value = categoryKeyword.value;
}

function clearCategorySearch() {
  categoryKeyword.value = '';
  appliedCategoryKeyword.value = '';
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
  const stillAvailable = Boolean(selectedCategory && !hasCategoryChildren(selectedCategory.id));
  if (!stillAvailable) selectedCategoryId.value = findFirstLeaf(buildCategoryTree(undefined))?.id;
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
  if (!canBindAttribute.value) return;
  if (!selectedCategoryId.value) {
    MessagePlugin.warning('请选择分类');
    return;
  }
  bindForm.attributeIds = [...boundAttributeIds.value];
  bindDialogVisible.value = true;
}

function closeBindDialog() {
  bindDialogVisible.value = false;
  bindForm.attributeIds = [];
}

async function submitBind() {
  if (!canBindAttribute.value) return;
  const newAttributeIds = bindForm.attributeIds.filter((id) => !boundAttributeIds.value.has(id));
  if (!selectedCategoryId.value || !newAttributeIds.length) {
    MessagePlugin.warning('请选择需要绑定的属性');
    return;
  }
  try {
    const created = await createCategoryAttributes({
      categoryId: selectedCategoryId.value,
      attributeIds: newAttributeIds,
    });
    bindings.value.push(...created);
    closeBindDialog();
    MessagePlugin.success(`成功绑定 ${created.length} 个属性`);
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '绑定失败');
  }
}

async function persistRow(
  row: BindingRow,
  patch: Partial<BindingRow>,
  field: 'requiredFlag' | 'skuFlag' | null = null,
) {
  if (!canEditBinding.value) return;
  savingId.value = row.id;
  savingField.value = field;
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
    savingField.value = null;
  }
}

function getSwitchValue(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'value' in value) return Boolean((value as { value?: boolean }).value);
  return Boolean(value);
}

function changeFlag(row: BindingRow, field: 'requiredFlag' | 'skuFlag', value: unknown) {
  persistRow(row, { [field]: getSwitchValue(value) }, field);
}

function bindingIndex(row: BindingRow) {
  return allBindingRows.value.findIndex((item) => item.id === row.id);
}

async function moveBinding(row: BindingRow, offset: number) {
  if (!canEditBinding.value || savingId.value !== null) return;
  const orderedRows = allBindingRows.value.map((item) => ({ ...item }));
  const index = orderedRows.findIndex((item) => item.id === row.id);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= orderedRows.length) return;

  [orderedRows[index], orderedRows[targetIndex]] = [orderedRows[targetIndex], orderedRows[index]];
  orderedRows.forEach((item, itemIndex) => {
    item.sortOrder = itemIndex + 1;
  });
  savingId.value = row.id;
  savingField.value = null;
  try {
    const updatedRows = await Promise.all(orderedRows.map((item) => updateCategoryAttribute(item.id, toPayload(item))));
    const updatedMap = new Map(updatedRows.map((item) => [item.id, item]));
    bindings.value = bindings.value.map((item) => updatedMap.get(item.id) ?? item);
    MessagePlugin.success('排序已更新');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '排序保存失败');
    await loadData();
  } finally {
    savingId.value = null;
  }
}

function openDeleteConfirm(row: BindingRow) {
  if (!canRemoveBinding.value) return;
  deleteTarget.value = row;
  deleteConfirmVisible.value = true;
}

function closeDeleteConfirm() {
  deleteConfirmVisible.value = false;
  deleteTarget.value = null;
}

async function handleDelete() {
  if (!canRemoveBinding.value) return;
  if (!deleteTarget.value) return;
  try {
    await deleteCategoryAttribute(deleteTarget.value.id);
    bindings.value = bindings.value.filter((item) => item.id !== deleteTarget.value?.id);
    closeDeleteConfirm();
    MessagePlugin.success('移除成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '移除失败');
  }
}

watch(activeScope, () => {
  selectedCategoryId.value = undefined;
  categoryKeyword.value = '';
  appliedCategoryKeyword.value = '';
  syncSelectedCategory();
  expandAllCategories();
  reset();
});

onMounted(loadData);
</script>

<style scoped>
.scope-controls {
  flex: 1;
  width: 100%;
  min-width: 0;
}

.scope-controls :deep(.t-tabs) {
  width: 100%;
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

.category-tree {
  max-height: 640px;
  padding: var(--td-comp-paddingTB-s) 0;
  overflow-y: auto;
}

.category-search {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
}

.category-search :deep(.t-input) {
  flex: 1;
  min-width: 0;
}

.category-node {
  display: flex;
  align-items: center;
  width: 100%;
  height: 40px;
  gap: var(--td-comp-margin-xs);
  padding-right: var(--td-comp-paddingLR-s);
  color: var(--td-text-color-primary);
  font-family: inherit;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  background: transparent;
  border: 0;
  text-align: left;
}

.category-node-leaf {
  cursor: pointer;
}

.category-node-leaf:hover,
.category-node-leaf.active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
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

.template-toolbar {
  display: flex;
  align-items: center;
  margin-top: var(--td-comp-margin-l);
}

.bind-category-context {
  display: flex;
  align-items: center;
  margin-bottom: var(--td-comp-margin-l);
  color: var(--td-text-color-primary);
  font-size: 14px;
  line-height: 22px;
}

.bind-category-label {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}

.bind-transfer {
  width: 100%;
}

.bind-transfer :deep(.t-transfer__list) {
  flex: 1;
  min-width: 0;
  height: 320px;
}

.bind-transfer :deep(.t-transfer__list-header) {
  width: calc(100% - var(--td-comp-margin-s) * 2);
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
