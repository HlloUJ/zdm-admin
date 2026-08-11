<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <AdminPageHeader :breadcrumbs="['门店分类管理']" />

        <section class="filter-card">
          <t-form :data="searchForm" label-width="84px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="分类名称" name="keyword">
                  <t-input v-model="searchForm.keyword" clearable placeholder="请输入分类名称" />
                </t-form-item>
                <t-form-item label="分类状态" name="status">
                  <t-select v-model="searchForm.status" clearable placeholder="全部">
                    <t-option label="启用" value="enabled" />
                    <t-option label="停用" value="disabled" />
                  </t-select>
                </t-form-item>
              </div>
              <div class="filter-actions">
                <t-button theme="primary" @click="handleSearch"
                  ><template #icon><t-icon name="search" /></template>查询</t-button
                >
                <t-button theme="default" variant="base" @click="handleReset"
                  ><template #icon><t-icon name="refresh" /></template>重置</t-button
                >
              </div>
            </div>
          </t-form>
        </section>

        <section class="category-card">
          <div class="category-toolbar">
            <div>
              <h2>门店分类</h2>
              <p>按手工分类维护，最多支持三级。</p>
            </div>
            <t-button v-if="canCreateRootCategory" theme="primary" @click="openCreateDialog()"
              ><template #icon><t-icon name="add" /></template>新增一级分类</t-button
            >
          </div>

          <t-alert v-if="tipVisible" theme="info" class="category-tip" close-btn @close="tipVisible = false">
            已有商品使用中的分类不支持删除；停用后不可用于新商品上架，历史商品保留原分类。
          </t-alert>

          <t-table
            v-if="loading || displayRows.length"
            row-key="key"
            :data="displayRows"
            :columns="columns"
            :loading="loading"
            hover
            table-layout="fixed"
          >
            <template #name="{ row }">
              <div :class="['category-name-cell', `level-${row.level}`]">
                <t-button
                  v-if="row.node.children.length"
                  class="tree-toggle"
                  variant="text"
                  shape="square"
                  size="small"
                  :aria-label="isNodeExpanded(row.node) ? '收起下级分类' : '展开下级分类'"
                  @click.stop="toggleNode(row.node)"
                >
                  <template #icon
                    ><t-icon :name="isNodeExpanded(row.node) ? 'chevron-down' : 'chevron-right'"
                  /></template>
                </t-button>
                <span v-else class="tree-toggle-placeholder"><t-icon name="minus" /></span>
                <span>{{ row.name }}</span>
              </div>
            </template>
            <template #level="{ row }">
              <span class="level-label">{{ row.level }}级分类</span>
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'enabled' ? '启用' : '停用' }}
              </t-tag>
            </template>
            <template #sort="{ row }">{{ row.sort }}</template>
            <template #createdByName="{ row }">{{ row.createdByName }}</template>
            <template #createdAt="{ row }">{{ row.createdAt }}</template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link
                  v-if="canCreateChildCategory && row.level < 3"
                  theme="primary"
                  @click="openCreateDialog(row.node)"
                  >新增下级</t-link
                >
                <t-link v-if="canEditCategory" theme="primary" @click="openEditDialog(row.node)">编辑</t-link>
                <t-link
                  v-if="canMoveUpCategory"
                  theme="primary"
                  :disabled="siblingIndex(row.node) === 0"
                  @click="moveCategory(row.node, -1)"
                  >上移</t-link
                >
                <t-link
                  v-if="canMoveDownCategory"
                  theme="primary"
                  :disabled="siblingIndex(row.node) === siblingCount(row.node) - 1"
                  @click="moveCategory(row.node, 1)"
                  >下移</t-link
                >
                <t-link
                  v-if="canToggleCategoryStatus"
                  :theme="row.node.status === 'enabled' ? 'warning' : 'success'"
                  @click="openStatusConfirm(row.node)"
                  >{{ row.node.status === 'enabled' ? '停用' : '启用' }}</t-link
                >
                <t-link v-if="canDeleteCategory" theme="danger" @click="openDeleteDialog(row.node)">删除</t-link>
                <span v-if="!hasVisibleRowAction(row)">-</span>
              </div>
            </template>
          </t-table>
          <t-empty v-else class="category-empty" description="未找到符合条件的分类" />
        </section>
      </main>
    </div>

    <AdminDialog
      v-model:visible="formVisible"
      :header="formMode === 'create' ? `新增${formLevel}级分类` : '编辑分类'"
      width="520px"
      placement="center"
      confirm-btn="保存"
      @confirm="handleSubmit"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item v-if="formData.parentId" label="上级分类">
          <t-input :value="parentName" disabled />
        </t-form-item>
        <t-form-item label="分类名称" name="name" required-mark>
          <t-input v-model="formData.name" :maxlength="20" clearable placeholder="请输入，最多20个字符" />
        </t-form-item>
        <t-form-item v-if="formMode === 'create'" label="分类状态" name="status" required-mark>
          <t-radio-group v-model="formData.status">
            <t-radio value="enabled">启用</t-radio>
            <t-radio value="disabled">停用</t-radio>
          </t-radio-group>
          <p class="form-help">停用分类不可用于新商品上架。</p>
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminConfirmDialog
      v-model:visible="deleteVisible"
      action="删除"
      object-type="分类"
      :object-name="deleteTarget?.name"
      :mode="deleteBlocked ? 'blocked' : 'confirm'"
      @confirm="handleDeleteConfirm"
    >
      <template v-if="deleteTarget?.productCount">
        分类“{{ deleteTarget.name }}”已关联
        {{ deleteTarget.productCount }} 个商品，不能删除。请停用该分类，避免新商品继续使用。
      </template>
      <template v-else-if="deleteTarget?.children.length">
        分类“{{ deleteTarget.name }}”包含下级分类，请先删除或转移下级分类。
      </template>
      <template v-else>删除后不可恢复，确认删除分类“{{ deleteTarget?.name }}”吗？</template>
    </AdminConfirmDialog>

    <AdminConfirmDialog
      v-model:visible="statusConfirmVisible"
      :action="statusTarget?.status === 'enabled' ? '停用' : '启用'"
      object-type="分类"
      :object-name="statusTarget?.name"
      @confirm="handleStatusConfirm"
      @close="closeStatusConfirm"
    >
      {{ statusConfirmText }}
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminDialog, AdminPageHeader } from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createStoreCategory,
  deleteStoreCategory,
  listStoreCategories,
  moveStoreCategory,
  type StoreCategoryRecord,
  updateStoreCategory,
  updateStoreCategoryStatus,
} from '@/services/storeCategories';

type CategoryStatus = 'enabled' | 'disabled';
type FormMode = 'create' | 'edit';

const permissionPrefix = 'admin.tenant.store-category-management';
const loginUser = computed(() => getLoginUser());
const hasCategoryAction = (action: string) => hasPermission(loginUser.value, `${permissionPrefix}.${action}`);
const canCreateRootCategory = computed(() => hasCategoryAction('create-root'));
const canCreateChildCategory = computed(() => hasCategoryAction('create-child'));
const canEditCategory = computed(() => hasCategoryAction('edit'));
const canMoveUpCategory = computed(() => hasCategoryAction('move-up'));
const canMoveDownCategory = computed(() => hasCategoryAction('move-down'));
const canToggleCategoryStatus = computed(() => hasCategoryAction('toggle-status'));
const canDeleteCategory = computed(() => hasCategoryAction('delete'));

interface CategoryNode {
  id: number;
  parentId: number | null;
  level: 1 | 2 | 3;
  name: string;
  status: CategoryStatus;
  sort: number;
  productCount: number;
  createdByName: string;
  createdAt: string;
  parent?: CategoryNode;
  children: CategoryNode[];
}

interface CategoryForm {
  id: number | null;
  parentId: number | null;
  name: string;
  status: CategoryStatus;
}

interface CategoryRow {
  key: string;
  level: 1 | 2 | 3;
  name: string;
  status: CategoryStatus;
  sort: number;
  productCount: number;
  createdByName: string;
  createdAt: string;
  node: CategoryNode;
}

const categoryData = ref<CategoryNode[]>([]);
const loading = ref(false);

const searchForm = reactive({ keyword: '', status: '' as CategoryStatus | '' });
const appliedSearch = reactive({ keyword: '', status: '' as CategoryStatus | '' });
const expandedNodeIds = ref<Set<number>>(new Set());
const tipVisible = ref(true);
const formVisible = ref(false);
const deleteVisible = ref(false);
const statusConfirmVisible = ref(false);
const formRef = ref<FormInstanceFunctions>();
const formMode = ref<FormMode>('create');
const formData = reactive<CategoryForm>({ id: null, parentId: null, name: '', status: 'enabled' });
const deleteTarget = ref<CategoryNode | null>(null);
const statusTarget = ref<CategoryNode | null>(null);
const deleteBlocked = computed(() => Boolean(deleteTarget.value?.productCount || deleteTarget.value?.children.length));

const formRules: Record<string, FormRule[]> = {
  name: [
    { required: true, message: '请输入分类名称', type: 'error' },
    { max: 20, message: '分类名称最多20个字符', type: 'error' },
  ],
};

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '分类名称', width: 155, align: 'left' },
  { colKey: 'level', title: '分类级别', width: 90, align: 'left' },
  { colKey: 'productCount', title: '关联商品', width: 90, align: 'center' },
  { colKey: 'status', title: '状态', width: 60, align: 'center' },
  { colKey: 'sort', title: '排序', width: 60, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 90, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 150, align: 'center' },
  { colKey: 'operation', title: '操作', width: 240, align: 'left', fixed: 'right' },
];

const displayRows = computed<CategoryRow[]>(() => {
  const keyword = appliedSearch.keyword.trim();
  const hasFilter = Boolean(keyword || appliedSearch.status);
  const matches = (node: CategoryNode) =>
    (!keyword || node.name.includes(keyword)) && (!appliedSearch.status || node.status === appliedSearch.status);
  const subtreeMatches = (node: CategoryNode): boolean => matches(node) || node.children.some(subtreeMatches);
  const rows: CategoryRow[] = [];
  const appendNodes = (nodes: CategoryNode[], forceDescendants = false) => {
    nodes.forEach((node, position) => {
      const nodeMatches = matches(node);
      if (hasFilter && !forceDescendants && !subtreeMatches(node)) return;
      rows.push({
        key: `category-${node.id}`,
        level: node.level,
        name: node.name,
        status: node.status,
        sort: position + 1,
        productCount: node.productCount,
        createdByName: node.createdByName,
        createdAt: formatDateTime(node.createdAt),
        node,
      });
      if (hasFilter) {
        appendNodes(
          nodeMatches || forceDescendants ? node.children : node.children.filter(subtreeMatches),
          nodeMatches,
        );
      } else if (isNodeExpanded(node)) {
        appendNodes(node.children);
      }
    });
  };
  appendNodes(categoryData.value);
  return rows;
});

const findNode = (id: number | null, nodes = categoryData.value): CategoryNode | undefined => {
  if (id == null) return undefined;
  for (const node of nodes) {
    if (node.id === id) return node;
    const matched = findNode(id, node.children);
    if (matched) return matched;
  }
  return undefined;
};

const formParent = computed(() => findNode(formData.parentId));
const parentName = computed(() => formParent.value?.name ?? '');
const formLevel = computed(() => (formParent.value ? formParent.value.level + 1 : 1));
const statusConfirmText = computed(() => {
  if (!statusTarget.value) return '';
  const name = statusTarget.value.name;
  return statusTarget.value.status === 'enabled' ? `是否停用分类“${name}”？` : `是否启用分类“${name}”？`;
});
const siblingsOf = (node: CategoryNode) => node.parent?.children ?? categoryData.value;
const siblingIndex = (node: CategoryNode) => siblingsOf(node).findIndex((item) => item.id === node.id);
const siblingCount = (node: CategoryNode) => siblingsOf(node).length;
const hasVisibleRowAction = (row: CategoryRow) =>
  (canCreateChildCategory.value && row.level < 3) ||
  canEditCategory.value ||
  canMoveUpCategory.value ||
  canMoveDownCategory.value ||
  canToggleCategoryStatus.value ||
  canDeleteCategory.value;

const isNodeExpanded = (node: CategoryNode) =>
  Boolean(appliedSearch.keyword.trim() || appliedSearch.status || expandedNodeIds.value.has(node.id));

const toggleNode = (node: CategoryNode) => {
  const nextIds = new Set(expandedNodeIds.value);
  if (nextIds.has(node.id)) nextIds.delete(node.id);
  else nextIds.add(node.id);
  expandedNodeIds.value = nextIds;
};

const createdAtTimestamp = (record: Pick<StoreCategoryRecord, 'createdAt'>) => {
  const timestamp = new Date(record.createdAt ?? '').getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const toCategoryTree = (records: StoreCategoryRecord[]): CategoryNode[] => {
  const sortedRecords = [...records].sort(
    (left, right) => createdAtTimestamp(right) - createdAtTimestamp(left) || right.id - left.id,
  );
  const nodeMap = new Map<number, CategoryNode>();
  sortedRecords.forEach((item) => {
    nodeMap.set(item.id, {
      id: item.id,
      parentId: item.parentId ?? null,
      level: 1,
      name: item.name,
      status: item.status,
      sort: item.sortOrder,
      productCount: item.productCount,
      createdByName: item.createdByName || '-',
      createdAt: item.createdAt ?? '',
      children: [],
    });
  });
  const roots: CategoryNode[] = [];
  sortedRecords.forEach((record) => {
    const node = nodeMap.get(record.id) as CategoryNode;
    const parent = record.parentId == null ? undefined : nodeMap.get(record.parentId);
    if (!parent) {
      roots.push(node);
      return;
    }
    node.parent = parent;
    parent.children.push(node);
  });
  const assignLevels = (nodes: CategoryNode[], level: 1 | 2 | 3) =>
    nodes.forEach((node) => {
      node.level = level;
      if (level < 3) assignLevels(node.children, (level + 1) as 2 | 3);
    });
  const sortTree = (nodes: CategoryNode[]) => {
    nodes.sort(
      (left, right) =>
        left.sort - right.sort || createdAtTimestamp(right) - createdAtTimestamp(left) || right.id - left.id,
    );
    nodes.forEach((node) => sortTree(node.children));
  };
  sortTree(roots);
  assignLevels(roots, 1);
  return roots;
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);
  const pad = (number: number) => number.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const showError = (error: unknown, fallback: string) =>
  adminFeedback.error(error instanceof Error ? error.message : fallback);

const loadCategories = async () => {
  loading.value = true;
  try {
    categoryData.value = toCategoryTree(await listStoreCategories());
  } catch (error) {
    showError(error, '门店分类加载失败');
  } finally {
    loading.value = false;
  }
};

const handleSearch = () => {
  appliedSearch.keyword = searchForm.keyword;
  appliedSearch.status = searchForm.status;
};

const handleReset = () => {
  searchForm.keyword = '';
  searchForm.status = '';
  handleSearch();
};

const resetForm = () => {
  formData.id = null;
  formData.parentId = null;
  formData.name = '';
  formData.status = 'enabled';
};

const openCreateDialog = (parent?: CategoryNode) => {
  formMode.value = 'create';
  resetForm();
  if (parent) formData.parentId = parent.id;
  formVisible.value = true;
};

const openEditDialog = (node: CategoryNode) => {
  formMode.value = 'edit';
  formData.id = node.id;
  formData.parentId = node.parentId;
  formData.name = node.name;
  formData.status = node.status;
  formVisible.value = true;
};

const closeFormDialog = () => {
  formVisible.value = false;
  resetForm();
};

const categoryNameExists = () => {
  const siblings = formData.parentId ? (findNode(formData.parentId)?.children ?? []) : categoryData.value;
  return siblings.some((node) => node.name === formData.name.trim() && node.id !== formData.id);
};

const handleSubmit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return;
  const name = formData.name.trim();
  if (categoryNameExists()) {
    adminFeedback.warning('同级分类名称不能重复');
    return;
  }
  try {
    if (formMode.value === 'create') {
      await createStoreCategory({ parentId: formData.parentId, name, status: formData.status });
    } else {
      await updateStoreCategory(formData.id as number, name);
    }
    closeFormDialog();
    await loadCategories();
    if (formMode.value === 'create') {
      adminFeedback.created(name);
    } else {
      adminFeedback.actionSuccess({ action: '保存', target: name });
    }
  } catch (error) {
    showError(error, '分类保存失败');
  }
};

const applyStatusChange = async (node: CategoryNode) => {
  const status = node.status === 'enabled' ? 'disabled' : 'enabled';
  await updateStoreCategoryStatus(node.id, status);
  adminFeedback.actionSuccess({ action: status === 'enabled' ? '启用' : '停用', target: node.name });
  await loadCategories();
};

const openStatusConfirm = (node: CategoryNode) => {
  statusTarget.value = node;
  statusConfirmVisible.value = true;
};

const closeStatusConfirm = () => {
  statusConfirmVisible.value = false;
  statusTarget.value = null;
};

const handleStatusConfirm = async () => {
  try {
    if (statusTarget.value) await applyStatusChange(statusTarget.value);
    closeStatusConfirm();
  } catch (error) {
    showError(error, '分类状态更新失败');
  }
};

const moveCategory = async (category: CategoryNode, offset: number) => {
  const siblings = siblingsOf(category);
  const index = siblings.findIndex((item) => item.id === category.id);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
  try {
    await moveStoreCategory(category.id, offset < 0 ? 'up' : 'down');
    adminFeedback.actionSuccess({ action: '更新排序', target: category.name });
    await loadCategories();
  } catch (error) {
    showError(error, '分类排序更新失败');
  }
};

const openDeleteDialog = (node: CategoryNode) => {
  deleteTarget.value = node;
  deleteVisible.value = true;
};

const handleDeleteConfirm = async () => {
  if (!deleteTarget.value) return;
  if (deleteBlocked.value) {
    deleteVisible.value = false;
    deleteTarget.value = null;
    return;
  }
  const target = deleteTarget.value;
  try {
    await deleteStoreCategory(target.id);
    deleteVisible.value = false;
    deleteTarget.value = null;
    await loadCategories();
    adminFeedback.deleted(target.name);
  } catch (error) {
    showError(error, '分类删除失败');
    return;
  }
};

onMounted(loadCategories);
</script>

<style scoped>
.filter-card,
.category-card {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}

.filter-card {
  margin-bottom: var(--td-comp-margin-l);
}

.filter-row,
.filter-fields,
.filter-actions,
.category-toolbar,
.table-actions,
.category-name-cell {
  display: flex;
  align-items: center;
}

.filter-row {
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}
.filter-fields {
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--td-comp-margin-l);
}
.filter-fields :deep(.t-form__item) {
  width: 260px;
  margin-bottom: 0;
}
.filter-actions {
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}

.category-toolbar {
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}
.category-toolbar h2 {
  margin: 0;
  font: var(--td-font-title-medium);
}
.category-toolbar p {
  margin: 4px 0 0;
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}
.category-tip {
  margin-top: var(--td-comp-margin-l);
}
.category-card :deep(.t-table) {
  width: calc(100% - 12px);
  margin-top: var(--td-comp-margin-l);
  margin-left: 12px;
}
.category-empty {
  margin-top: var(--td-comp-margin-xl);
}
.category-name-cell {
  gap: var(--td-comp-margin-s);
}
.category-name-cell.level-1 {
  font-weight: 600;
}
.category-name-cell.level-2 {
  padding-left: 28px;
  color: var(--td-text-color-secondary);
}
.category-name-cell.level-3 {
  padding-left: 56px;
  color: var(--td-text-color-placeholder);
}
.tree-toggle,
.tree-toggle-placeholder {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
}
.tree-toggle {
  color: var(--td-text-color-secondary);
}
.tree-toggle-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--td-text-color-placeholder);
}
.level-label {
  color: var(--td-text-color-secondary);
}
.table-actions {
  flex-wrap: nowrap;
  gap: var(--td-comp-margin-xs);
}
.table-actions :deep(.t-link) {
  white-space: nowrap;
}
.form-help {
  margin: 6px 0 0;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

@media (max-width: 1180px) {
  .category-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
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
