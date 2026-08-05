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
              <t-tabs v-if="showScopeTabRail" v-model="activeScope" :list="scopeTabs" />
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
                  <t-form :data="searchForm" label-width="56px" colon>
                    <div class="filter-row">
                      <div class="filter-fields">
                        <t-form-item label="属性名称" label-width="72px">
                          <t-input v-model="searchForm.keyword" clearable placeholder="请输入" />
                        </t-form-item>
                        <t-form-item label="状态">
                          <t-select v-model="searchForm.status" clearable placeholder="全部">
                            <t-option label="启用" value="enabled" />
                            <t-option label="停用" value="disabled" />
                          </t-select>
                        </t-form-item>
                        <t-form-item label="发布">
                          <t-select v-model="searchForm.publishStatus" clearable placeholder="全部">
                            <t-option label="已发布" value="published" />
                            <t-option label="未发布" value="unpublished" />
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

                <t-table
                  row-key="id"
                  :data="pageData"
                  :columns="columns"
                  :loading="loading"
                  :drag-sort="canBindAttribute ? 'row-handler' : undefined"
                  :drag-sort-options="{ animation: 200 }"
                  hover
                  table-layout="fixed"
                  @drag-sort="handleDragSort"
                >
                  <template #drag><t-icon name="move" class="binding-drag-icon" title="拖拽排序" /></template>
                  <template #valueType="{ row }">{{ valueTypeLabel(row.valueType) }}</template>
                  <template #attributeRole="{ row }">
                    <t-select
                      class="attribute-role-select"
                      :model-value="row.attributeRole || undefined"
                      :loading="savingId === row.id && savingField === 'attributeRole'"
                      :disabled="!canSetAttributeRole || row.publishStatus === 'published'"
                      placeholder="请选择"
                      size="small"
                      @change="changeAttributeRole(row, $event)"
                    >
                      <t-option label="商品属性" value="product" />
                      <t-option label="销售属性" value="sales" />
                    </t-select>
                  </template>
                  <template #requiredFlag="{ row }">
                    <t-switch
                      :model-value="row.requiredFlag"
                      :loading="savingId === row.id && savingField === 'requiredFlag'"
                      :disabled="!canSetRequired || row.publishStatus === 'published'"
                      @change="changeFlag(row, 'requiredFlag', $event)"
                    />
                  </template>
                  <template #skuFlag="{ row }">
                    <span
                      class="sku-switch-cell"
                      :title="
                        row.attributeRole !== 'sales'
                          ? '只有销售属性才能参与SKU组合'
                          : row.publishStatus === 'published'
                            ? '请先取消发布后再修改属性配置'
                            : ''
                      "
                    >
                      <t-switch
                        :model-value="row.skuFlag"
                        :loading="savingId === row.id && savingField === 'skuFlag'"
                        :disabled="
                          !canSetSkuCombination || row.attributeRole !== 'sales' || row.publishStatus === 'published'
                        "
                        @change="changeFlag(row, 'skuFlag', $event)"
                      />
                    </span>
                  </template>
                  <template #status="{ row }">
                    <t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">
                      {{ row.status === 'enabled' ? '启用' : '停用' }}
                    </t-tag>
                  </template>
                  <template #publishStatus="{ row }">
                    <t-tag :theme="row.publishStatus === 'published' ? 'success' : 'danger'" variant="light">
                      {{ row.publishStatus === 'published' ? '已发布' : '未发布' }}
                    </t-tag>
                  </template>
                  <template #operation="{ row }">
                    <div class="table-actions">
                      <t-link
                        v-if="canTogglePublish"
                        :theme="row.publishStatus === 'published' ? 'warning' : 'success'"
                        hover="color"
                        :disabled="savingId !== null"
                        @click="openPublishConfirm(row)"
                      >
                        {{ row.publishStatus === 'published' ? '取消发布' : '发布' }}
                      </t-link>
                      <t-link
                        v-if="canRemoveBinding"
                        theme="danger"
                        :disabled="savingId !== null"
                        @click="openDeleteConfirm(row)"
                      >
                        移除
                      </t-link>
                      <span v-if="!canTogglePublish && !canRemoveBinding">-</span>
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
      <div class="bind-list-toolbar">
        <t-input v-model="bindSearchKeyword" clearable placeholder="请输入属性名称" />
        <span class="bind-list-count">已选择 {{ bindForm.attributeIds.length }} 项</span>
      </div>
      <t-table
        v-model:selected-row-keys="bindForm.attributeIds"
        class="bind-attribute-table"
        row-key="id"
        :columns="bindColumns"
        :data="bindAttributeRows"
        :max-height="360"
        empty="暂无可绑定属性"
        hover
        select-on-row-click
        table-layout="fixed"
      />
    </AdminDialog>

    <t-dialog
      v-model:visible="roleChangeConfirmVisible"
      header="系统提示"
      width="420px"
      placement="center"
      confirm-btn="确认"
      cancel-btn="取消"
      @confirm="handleRoleChangeConfirm"
      @close="closeRoleChangeConfirm"
    >
      {{ roleChangeConfirmText }}
    </t-dialog>

    <t-dialog
      v-model:visible="publishConfirmVisible"
      header="系统提示"
      width="420px"
      placement="center"
      confirm-btn="确认"
      cancel-btn="取消"
      @confirm="handlePublishConfirm"
      @close="closePublishConfirm"
    >
      {{ publishTarget?.publishStatus === 'published' ? '是否取消发布' : '是否发布' }}属性【{{
        publishTarget?.name
      }}】？
    </t-dialog>

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
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createCategoryAttributes,
  deleteCategoryAttribute,
  listCategoryAttributes,
  updateCategoryAttribute,
  publishCategoryAttribute,
  unpublishCategoryAttribute,
  type CategoryAttributePayload,
  type CategoryAttributeRecord,
} from '@/services/categoryAttributes';
import { listProductAttributes, type ProductAttributeRecord } from '@/services/productAttributes';
import { listProductCategories, type ProductCategoryRecord } from '@/services/productCategories';

type Scope = 'finished' | 'accessory';
type Status = 'enabled' | 'disabled';
type PublishStatus = 'published' | 'unpublished';
type AttributeRole = '' | 'product' | 'sales';

const MAX_SKU_ATTRIBUTE_COUNT = 4;
const SKU_ATTRIBUTE_LIMIT_MESSAGE = '参与SKU组合的属性最多只能开启4个';

interface BindingRow {
  id: number;
  categoryId: number;
  attributeId: number;
  name: string;
  scope: ProductAttributeRecord['scope'];
  valueType: ProductAttributeRecord['valueType'];
  attributeRole: AttributeRole;
  requiredFlag: boolean;
  skuFlag: boolean;
  sortOrder: number;
  status: Status;
  publishStatus: PublishStatus;
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

interface BindAttributeRow {
  id: number;
  name: string;
  valueType: string;
  createdAt: string;
}

const activeScope = ref<Scope>('finished');
const permissionPrefix = 'admin.product-data-center.category-attribute-template';
const loginUser = computed(() => getLoginUser());
const categoryAttributeScopeTabs: { label: string; value: Scope }[] = [
  { label: '成品现货模板', value: 'finished' },
  { label: '配件模板', value: 'accessory' },
];
const { visibleTabs: scopeTabs, showTabRail: showScopeTabRail } = usePermissionTabs({
  tabs: categoryAttributeScopeTabs,
  activeTab: activeScope,
  canAccess: (tab) => hasPermission(loginUser.value, `${permissionPrefix}.${tab.value}.view`),
});
const hasTemplateAction = (action: string) =>
  hasPermission(loginUser.value, `${permissionPrefix}.${activeScope.value}.${action}`);
const canBindAttribute = computed(() => hasTemplateAction('create'));
const canSetAttributeRole = computed(() => hasTemplateAction('attribute-role'));
const canSetSkuCombination = computed(() => hasTemplateAction('sku-combination'));
const canSetRequired = computed(() => hasTemplateAction('required'));
const canTogglePublish = computed(() => hasTemplateAction('toggle-publish'));
const canRemoveBinding = computed(() => hasTemplateAction('delete'));
const pageTitle = computed(() => (activeScope.value === 'finished' ? '成品现货发布模板' : '配件发布模板'));
const loading = ref(false);
const savingId = ref<number | null>(null);
const savingField = ref<'attributeRole' | 'requiredFlag' | 'skuFlag' | null>(null);
const categories = ref<ProductCategoryRecord[]>([]);
const attributes = ref<ProductAttributeRecord[]>([]);
const bindings = ref<CategoryAttributeRecord[]>([]);
const selectedCategoryId = ref<number | undefined>();
const expandedCategoryIds = ref<number[]>([]);
const categoryKeyword = ref('');
const appliedCategoryKeyword = ref('');
const bindDialogVisible = ref(false);
const bindSearchKeyword = ref('');
const roleChangeConfirmVisible = ref(false);
const roleChangeTarget = ref<BindingRow | null>(null);
const roleChangeNextRole = ref<AttributeRole>('');
const publishConfirmVisible = ref(false);
const publishTarget = ref<BindingRow | null>(null);
const deleteConfirmVisible = ref(false);
const deleteTarget = ref<BindingRow | null>(null);
const searchForm = reactive({ keyword: '', status: '' as Status | '', publishStatus: '' as PublishStatus | '' });
const appliedSearch = reactive({ keyword: '', status: '' as Status | '', publishStatus: '' as PublishStatus | '' });
const pagination = reactive({ current: 1, pageSize: 10 });
const pageSizeOptions = [10, 20, 50];
const bindForm = reactive({ attributeIds: [] as number[] });

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(canBindAttribute.value ? [{ colKey: 'drag', title: '', width: 44, align: 'center' as const }] : []),
  { colKey: 'name', title: '属性名称', minWidth: 160, ellipsis: true },
  { colKey: 'valueType', title: '值类型', width: 120 },
  { colKey: 'attributeRole', title: '属性角色', width: 140, align: 'center' },
  { colKey: 'skuFlag', title: '参与SKU组合', width: 160, align: 'center' },
  { colKey: 'requiredFlag', title: '必填', width: 90, align: 'center' },
  { colKey: 'status', title: '状态', width: 90, align: 'center' },
  { colKey: 'publishStatus', title: '发布', width: 100, align: 'center' },
  { colKey: 'createdByName', title: '绑定人', width: 120, align: 'left' },
  { colKey: 'createdAt', title: '绑定时间', width: 180, align: 'left' },
  { colKey: 'operation', title: '操作', width: 140, fixed: 'right' },
]);

const bindColumns = computed<PrimaryTableCol<BindAttributeRow>[]>(() => [
  {
    colKey: 'row-select',
    type: 'multiple',
    width: 52,
    disabled: ({ row }) => boundAttributeIds.value.has(row.id) && !canRemoveBinding.value,
  },
  { colKey: 'name', title: '属性名称', minWidth: 180, ellipsis: true },
  { colKey: 'valueType', title: '值类型', width: 140 },
  { colKey: 'createdAt', title: '创建时间', width: 180 },
]);

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
    .sort((first, second) => createdAtTime(second) - createdAtTime(first) || second.id - first.id),
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
        attributeRole: (item.attributeRole === 'product' || item.attributeRole === 'sales'
          ? item.attributeRole
          : '') as AttributeRole,
        requiredFlag: Boolean(item.requiredFlag),
        skuFlag: Boolean(item.skuFlag),
        sortOrder: item.sortOrder ?? 0,
        status: (attribute?.status === 'disabled' ? 'disabled' : 'enabled') as Status,
        publishStatus: (item.publishStatus === 'published'
          ? 'published'
          : 'unpublished') as BindingRow['publishStatus'],
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
      (!appliedSearch.status || item.status === appliedSearch.status) &&
      (!appliedSearch.publishStatus || item.publishStatus === appliedSearch.publishStatus)
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

const bindableAttributeIds = computed(
  () =>
    new Set(
      attributes.value
        .filter((item) => (item.scope === 'shared' || item.scope === activeScope.value) && item.status !== 'disabled')
        .map((item) => item.id),
    ),
);

const bindAttributeRows = computed<BindAttributeRow[]>(() =>
  attributes.value
    .filter((item) => bindableAttributeIds.value.has(item.id))
    .filter((item) => !bindSearchKeyword.value.trim() || item.name.includes(bindSearchKeyword.value.trim()))
    .sort((first, second) => createdAtTime(second) - createdAtTime(first) || second.id - first.id)
    .map((item) => ({
      id: item.id,
      name: item.name,
      valueType: valueTypeLabel(item.valueType),
      createdAt: formatDateTime(item.createdAt),
    })),
);

function hasCategoryChildren(categoryId: number) {
  return scopedCategories.value.some((item) => item.parentId === categoryId);
}

function createdAtTime(record: { createdAt?: string }) {
  if (!record.createdAt) return 0;
  const timestamp = new Date(record.createdAt).getTime();
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
    attributeRole: row.attributeRole || null,
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
  searchForm.publishStatus = '';
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
  bindSearchKeyword.value = '';
  bindForm.attributeIds = [...boundAttributeIds.value].filter((id) => bindableAttributeIds.value.has(id));
  bindDialogVisible.value = true;
}

function closeBindDialog() {
  bindDialogVisible.value = false;
  bindSearchKeyword.value = '';
  bindForm.attributeIds = [];
}

async function submitBind() {
  if (!canBindAttribute.value) return;
  const newAttributeIds = bindForm.attributeIds.filter((id) => !boundAttributeIds.value.has(id));
  const removedBindings = bindings.value.filter(
    (item) =>
      item.categoryId === selectedCategoryId.value &&
      bindableAttributeIds.value.has(item.attributeId) &&
      !bindForm.attributeIds.includes(item.attributeId),
  );
  if (!selectedCategoryId.value) {
    MessagePlugin.warning('请选择分类');
    return;
  }
  if (removedBindings.length && !canRemoveBinding.value) return;
  if (!newAttributeIds.length && !removedBindings.length) {
    closeBindDialog();
    MessagePlugin.info('绑定关系未变更');
    return;
  }
  try {
    const [created] = await Promise.all([
      newAttributeIds.length
        ? createCategoryAttributes({ categoryId: selectedCategoryId.value, attributeIds: newAttributeIds })
        : Promise.resolve([] as CategoryAttributeRecord[]),
      ...removedBindings.map((item) => deleteCategoryAttribute(item.id)),
    ]);
    const removedIds = new Set(removedBindings.map((item) => item.id));
    bindings.value = bindings.value.filter((item) => !removedIds.has(item.id));
    bindings.value.push(...created);
    closeBindDialog();
    MessagePlugin.success('绑定关系已更新');
  } catch (error) {
    await loadData();
    MessagePlugin.error(error instanceof Error ? error.message : '绑定关系更新失败');
  }
}

async function persistRow(
  row: BindingRow,
  patch: Partial<BindingRow>,
  field: 'attributeRole' | 'requiredFlag' | 'skuFlag' | null = null,
) {
  if (field === 'attributeRole' && !canSetAttributeRole.value) return;
  if (field === 'requiredFlag' && !canSetRequired.value) return;
  if (field === 'skuFlag' && !canSetSkuCombination.value) return;
  if (field === null && !canBindAttribute.value) return;
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

function getAttributeRoleValue(value: unknown): AttributeRole {
  if (value === 'product' || value === 'sales') return value;
  if (value && typeof value === 'object' && 'value' in value) {
    return getAttributeRoleValue((value as { value?: unknown }).value);
  }
  return '';
}

function getCurrentBindingRow(row: BindingRow) {
  return allBindingRows.value.find((item) => item.id === row.id) ?? row;
}

function changeAttributeRole(row: BindingRow, value: unknown) {
  const currentRow = getCurrentBindingRow(row);
  if (!canSetAttributeRole.value || currentRow.publishStatus === 'published') return;
  const nextRole = getAttributeRoleValue(value);
  if (nextRole === currentRow.attributeRole) return;
  if (currentRow.skuFlag && nextRole !== 'sales') {
    roleChangeTarget.value = currentRow;
    roleChangeNextRole.value = nextRole;
    roleChangeConfirmVisible.value = true;
    return;
  }
  persistRow(currentRow, { attributeRole: nextRole }, 'attributeRole');
}

const roleChangeConfirmText = computed(() => {
  const nextRoleLabel = roleChangeNextRole.value === 'product' ? '商品属性' : '未选择角色';
  return `切换为${nextRoleLabel}后将关闭“参与SKU组合”，是否继续？`;
});

function closeRoleChangeConfirm() {
  roleChangeConfirmVisible.value = false;
  roleChangeTarget.value = null;
  roleChangeNextRole.value = '';
}

async function handleRoleChangeConfirm() {
  if (!roleChangeTarget.value) return;
  await persistRow(
    roleChangeTarget.value,
    { attributeRole: roleChangeNextRole.value, skuFlag: false },
    'attributeRole',
  );
  closeRoleChangeConfirm();
}

function changeFlag(row: BindingRow, field: 'requiredFlag' | 'skuFlag', value: unknown) {
  const currentRow = getCurrentBindingRow(row);
  const nextValue = getSwitchValue(value);
  if (field === 'skuFlag' && nextValue && currentRow.attributeRole !== 'sales') {
    MessagePlugin.error('只有销售属性才能参与SKU组合');
    return;
  }
  if (
    field === 'skuFlag' &&
    nextValue &&
    !currentRow.skuFlag &&
    allBindingRows.value.filter((item) => item.skuFlag).length >= MAX_SKU_ATTRIBUTE_COUNT
  ) {
    MessagePlugin.error(SKU_ATTRIBUTE_LIMIT_MESSAGE);
    return;
  }
  persistRow(currentRow, { [field]: nextValue }, field);
}

async function handleDragSort(context: { current: BindingRow; target: BindingRow }) {
  if (!canBindAttribute.value || savingId.value !== null) return;
  const orderedRows = allBindingRows.value.map((item) => ({ ...item }));
  const currentIndex = orderedRows.findIndex((item) => item.id === context.current.id);
  const targetIndex = orderedRows.findIndex((item) => item.id === context.target.id);
  if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return;

  const [currentRow] = orderedRows.splice(currentIndex, 1);
  orderedRows.splice(targetIndex, 0, currentRow);
  orderedRows.forEach((item, itemIndex) => {
    item.sortOrder = itemIndex + 1;
  });
  savingId.value = context.current.id;
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

async function togglePublish(row: BindingRow) {
  if (!canTogglePublish.value || savingId.value !== null) return;
  savingId.value = row.id;
  savingField.value = null;
  try {
    const updated =
      row.publishStatus === 'published'
        ? await unpublishCategoryAttribute(row.id)
        : await publishCategoryAttribute(row.id);
    const index = bindings.value.findIndex((item) => item.id === row.id);
    if (index >= 0) bindings.value[index] = updated;
    MessagePlugin.success(row.publishStatus === 'published' ? '已取消发布' : '发布成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '发布状态更新失败');
  } finally {
    savingId.value = null;
  }
}

function openPublishConfirm(row: BindingRow) {
  if (!canTogglePublish.value || savingId.value !== null) return;
  if (row.publishStatus === 'unpublished' && !row.attributeRole) {
    MessagePlugin.error('请先选择属性角色');
    return;
  }
  publishTarget.value = row;
  publishConfirmVisible.value = true;
}

function closePublishConfirm() {
  publishConfirmVisible.value = false;
  publishTarget.value = null;
}

async function handlePublishConfirm() {
  if (!publishTarget.value) return;
  await togglePublish(publishTarget.value);
  closePublishConfirm();
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

.bind-list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.bind-list-toolbar :deep(.t-input) {
  width: 320px;
}

.bind-list-count {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
  font-size: 14px;
}

.bind-attribute-table {
  width: 100%;
}

.attribute-role-select {
  width: 108px;
}

.sku-switch-cell {
  display: inline-flex;
  align-items: center;
}

.filter-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}

.filter-fields {
  display: flex;
  flex: 1;
  flex-wrap: nowrap;
  align-items: flex-start;
  min-width: 0;
  gap: var(--td-comp-margin-s);
}

.filter-fields :deep(.t-form__item) {
  flex: 0 1 auto;
  min-width: 0;
  margin-bottom: 0;
}

.filter-fields :deep(.t-form__item:nth-child(1)) {
  width: 26.6667%;
}

.filter-fields :deep(.t-form__item:nth-child(2)),
.filter-fields :deep(.t-form__item:nth-child(3)) {
  width: 16.6667%;
}

.filter-fields :deep(.t-input),
.filter-fields :deep(.t-select) {
  width: 100%;
}

.filter-actions {
  position: absolute;
  top: 0;
  right: 0;
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
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--td-comp-margin-s);
  white-space: nowrap;
}

.table-actions :deep(.t-link) {
  flex: 0 0 auto;
}

.binding-drag-icon {
  color: var(--td-text-color-secondary);
  cursor: grab;
  transition: color 0.2s ease;
}

:deep(.t-table__handle-draggable) {
  cursor: grab;
}

:deep(.t-table__handle-draggable:hover .binding-drag-icon) {
  color: var(--td-brand-color);
}

:deep(tr.t-table__ele--draggable-chosen td) {
  background: var(--td-brand-color-light);
  box-shadow:
    inset 0 1px 0 var(--td-brand-color),
    inset 0 -1px 0 var(--td-brand-color);
}

:deep(tr.t-table__ele--draggable-ghost td) {
  background: var(--td-brand-color-light);
  border-top: 2px solid var(--td-brand-color);
  opacity: 0.75;
}

:deep(tr.t-table__ele--draggable-dragging) {
  cursor: grabbing;
  opacity: 0.9;
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
    flex-basis: 100%;
    width: 100%;
  }
}
</style>
