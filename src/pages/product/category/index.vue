<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <AdminPageHeader :breadcrumbs="['商品管理', '商品公共基础数据', '商品分类管理']" :badge="pageTitle" />
        <t-alert v-if="tipVisible" theme="info" class="page-tip" close-btn @close="tipVisible = false">
          商品分类最多支持 4 级；已关联商品的分类不支持删除；停用后不可用于新商品发布，历史商品保留原分类。
        </t-alert>
        <AdminListLayout>
          <template #toolbar>
            <div class="list-controls">
              <div v-if="!lockedScope" class="scope-controls">
                <t-tabs v-if="showScopeTabRail" v-model="activeScope" :list="scopeTabs" class="scope-tabs" />
                <div class="source-caption">通过层级关系维护商品分类；末级分类可配置发布属性模板，最多支持 4 级。</div>
              </div>
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
                    <t-button theme="primary" @click="handleSearch">
                      <template #icon><t-icon name="search" /></template>
                      查询
                    </t-button>
                    <t-button theme="default" variant="base" @click="handleReset">
                      <template #icon><t-icon name="refresh" /></template>
                      重置
                    </t-button>
                  </div>
                </div>
              </t-form>
              <div class="table-toolbar">
                <t-button v-if="canCreateRootCategory" theme="primary" @click="openCreateDialog()">
                  <template #icon><t-icon name="add" /></template>
                  新增一级分类
                </t-button>
              </div>
            </div>
          </template>
          <template #table>
            <t-table
              v-if="displayRows.length"
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
                    :aria-label="isExpanded(row.node) ? '收起下级分类' : '展开下级分类'"
                    @click.stop="toggleExpanded(row.node)"
                  >
                    <template #icon
                      ><t-icon :name="isExpanded(row.node) ? 'chevron-down' : 'chevron-right'"
                    /></template>
                  </t-button>
                  <span v-else class="tree-toggle-placeholder"><t-icon name="minus" /></span>
                  <span>{{ row.name }}</span>
                </div>
              </template>
              <template #level="{ row }"
                ><span class="level-label">{{ levelLabel(row.level) }}</span></template
              >
              <template #status="{ row }"
                ><t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">{{
                  row.status === 'enabled' ? '启用' : '停用'
                }}</t-tag></template
              >
              <template #sort="{ row }">{{ row.sort }}</template>
              <template #createdAt="{ row }">{{ row.createdAt }}</template>
              <template #operation="{ row }">
                <div class="table-actions">
                  <t-link
                    v-if="canCreateChildCategory && row.level < maxCategoryLevel"
                    theme="primary"
                    @click="openCreateDialog(row)"
                    >新增下级</t-link
                  >
                  <t-link v-if="canEditCategory" theme="primary" @click="openEditDialog(row)">编辑</t-link>
                  <t-link
                    v-if="canMoveUpCategory"
                    theme="primary"
                    :disabled="siblingIndex(row) === 0"
                    @click="moveCategory(row, -1)"
                    >上移</t-link
                  >
                  <t-link
                    v-if="canMoveDownCategory"
                    theme="primary"
                    :disabled="siblingIndex(row) === siblingNodes(row).length - 1"
                    @click="moveCategory(row, 1)"
                    >下移</t-link
                  >
                  <t-link
                    v-if="canToggleCategoryStatus"
                    :theme="row.status === 'enabled' ? 'warning' : 'success'"
                    @click="openStatusConfirm(row.node)"
                    >{{ row.status === 'enabled' ? '停用' : '启用' }}</t-link
                  >
                  <t-link v-if="canDeleteCategory" theme="danger" @click="openDeleteDialog(row.node)">删除</t-link>
                  <span v-if="!hasVisibleRowAction(row)">-</span>
                </div>
              </template>
            </t-table>
            <t-empty v-else description="未找到符合条件的分类" />
          </template>
        </AdminListLayout>
      </main>
    </div>

    <t-dialog
      v-model:visible="formVisible"
      :header="formMode === 'create' ? `新增${levelLabel(formLevel)}` : '编辑分类'"
      width="520px"
      placement="center"
      :prevent-scroll-through="false"
      confirm-btn="保存"
      @confirm="handleSubmit"
      @close="closeFormDialog"
      @opened="restorePageScroll"
      @closed="restorePageScroll"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item v-if="formData.parentId" label="上级分类"><t-input :value="parentName" disabled /></t-form-item>
        <t-form-item label="分类名称" name="name" required-mark
          ><t-input v-model="formData.name" :maxlength="20" clearable placeholder="请输入，最多20个字符"
        /></t-form-item>
        <t-form-item label="分类状态" name="status" required-mark
          ><t-radio-group v-model="formData.status"
            ><t-radio value="enabled">启用</t-radio><t-radio value="disabled">停用</t-radio></t-radio-group
          >
          <p class="form-help">停用分类不可用于新商品发布。</p></t-form-item
        >
      </t-form>
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="deleteVisible"
      action="删除"
      object-type="分类"
      :object-name="deleteTarget?.name"
      :mode="canDeleteTarget ? 'confirm' : 'blocked'"
      @confirm="handleDeleteConfirm"
      @close="closeDeleteDialog"
      @opened="restorePageScroll"
      @closed="restorePageScroll"
    >
      <template v-if="deleteTarget?.productCount"
        >分类“{{ deleteTarget.name }}”已关联
        {{ deleteTarget.productCount }} 个商品，不能删除。请停用该分类，避免新商品继续使用。</template
      >
      <template v-else-if="deleteTarget?.children.length"
        >分类“{{ deleteTarget.name }}”包含下级分类，请先删除或转移下级分类。</template
      >
      <template v-else>是否删除分类“{{ deleteTarget?.name }}”？</template>
    </AdminConfirmDialog>

    <AdminConfirmDialog
      v-model:visible="statusConfirmVisible"
      :action="statusTarget?.status === 'enabled' ? '停用' : '启用'"
      object-type="分类"
      :object-name="statusTarget?.name"
      @confirm="handleStatusConfirm"
      @close="closeStatusConfirm"
      @opened="restorePageScroll"
      @closed="restorePageScroll"
    >
      {{ statusConfirmText }}
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { adminFeedback, AdminConfirmDialog, AdminListLayout, AdminPageHeader } from '@/components/foundation';
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createProductCategory,
  deleteProductCategory,
  listProductCategories,
  updateProductCategory,
  type ProductCategoryPayload,
  type ProductCategoryRecord,
} from '@/services/productCategories';

type Scope = 'finished' | 'accessory';
type Status = 'enabled' | 'disabled';
type FormMode = 'create' | 'edit';

interface CategoryNode {
  id: number;
  parentId: number | null;
  name: string;
  status: Status;
  productCount: number;
  sortOrder: number;
  createdByName: string;
  createdAt: string;
  children: CategoryNode[];
}
interface CategoryRow {
  key: string;
  node: CategoryNode;
  parent: CategoryNode | null;
  level: number;
  name: string;
  status: Status;
  productCount: number;
  sort: number;
  createdByName: string;
  createdAt: string;
}
interface CategoryForm {
  id: number | null;
  parentId: number | null;
  name: string;
  status: Status;
}

const maxCategoryLevel = 4;
const categoryPermissionPrefix = 'admin.product-data-center.category';
const route = useRoute();
const loginUser = computed(() => getLoginUser());
const categoryScopeTabs: { label: string; value: Scope }[] = [
  { label: '成品现货分类', value: 'finished' },
  { label: '配件分类', value: 'accessory' },
];
const resolveScope = (value: unknown): Scope => (value === 'accessory' ? 'accessory' : 'finished');
const activeScope = ref<Scope>(resolveScope(route.query.scope));
const pageTitle = computed(() => (activeScope.value === 'finished' ? '成品现货分类' : '配件分类'));
const {
  visibleTabs: scopeTabs,
  showTabRail: showScopeTabRail,
  resolveAccessibleTab: resolveAccessibleScope,
} = usePermissionTabs({
  tabs: categoryScopeTabs,
  activeTab: activeScope,
  canAccess: (tab) => hasPermission(loginUser.value, `${categoryPermissionPrefix}.${tab.value}.view`),
});
const lockedScope = computed(() => route.query.scope === 'finished' || route.query.scope === 'accessory');
const hasCategoryAction = (action: string) =>
  hasPermission(loginUser.value, `${categoryPermissionPrefix}.${activeScope.value}.${action}`);
const canCreateRootCategory = computed(() => hasCategoryAction('create-root'));
const canCreateChildCategory = computed(() => hasCategoryAction('create-child'));
const canEditCategory = computed(() => hasCategoryAction('edit'));
const canMoveUpCategory = computed(() => hasCategoryAction('move-up'));
const canMoveDownCategory = computed(() => hasCategoryAction('move-down'));
const canToggleCategoryStatus = computed(() => hasCategoryAction('toggle-status'));
const canDeleteCategory = computed(() => hasCategoryAction('delete'));

const categoryData = ref<Record<Scope, CategoryNode[]>>({ finished: [], accessory: [] });
const loading = ref(false);

const searchForm = reactive({ keyword: '', status: '' as Status | '' });
const appliedSearch = reactive({ keyword: '', status: '' as Status | '' });
const expandedNodeKeys = ref<Set<string>>(new Set());
const pageScrollTop = ref(0);
const tipVisible = ref(true);
const formVisible = ref(false);
const deleteVisible = ref(false);
const statusConfirmVisible = ref(false);
const formRef = ref<FormInstanceFunctions>();
const formMode = ref<FormMode>('create');
const formData = reactive<CategoryForm>({ id: null, parentId: null, name: '', status: 'enabled' });
const deleteTarget = ref<CategoryNode | null>(null);
const statusTarget = ref<CategoryNode | null>(null);

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

const activeNodes = computed(() => categoryData.value[activeScope.value]);
const hasSearch = computed(() => Boolean(appliedSearch.keyword.trim() || appliedSearch.status));
const parentName = computed(() => (formData.parentId ? (findNode(formData.parentId)?.name ?? '') : ''));
const formLevel = computed(() => (formData.parentId ? getNodeLevel(formData.parentId) + 1 : 1));
const canDeleteTarget = computed(() =>
  Boolean(deleteTarget.value && !deleteTarget.value.productCount && !deleteTarget.value.children.length),
);
const statusConfirmText = computed(() => {
  if (!statusTarget.value) return '';
  return statusTarget.value.status === 'enabled'
    ? `是否停用分类“${statusTarget.value.name}”？`
    : `是否启用分类“${statusTarget.value.name}”？`;
});

const displayRows = computed<CategoryRow[]>(() => {
  const rows: CategoryRow[] = [];
  collectRows(activeNodes.value, 1, null, rows, false);
  return rows;
});

function levelLabel(level: number) {
  return `${['一', '二', '三', '四'][level - 1]}级分类`;
}
function hasVisibleRowAction(row: CategoryRow) {
  return (
    (canCreateChildCategory.value && row.level < maxCategoryLevel) ||
    canEditCategory.value ||
    canMoveUpCategory.value ||
    canMoveDownCategory.value ||
    canToggleCategoryStatus.value ||
    canDeleteCategory.value
  );
}
function nodeKey(node: CategoryNode) {
  return `${activeScope.value}-${node.id}`;
}
function isExpanded(node: CategoryNode) {
  return hasSearch.value || expandedNodeKeys.value.has(nodeKey(node));
}
function toggleExpanded(node: CategoryNode) {
  const key = nodeKey(node);
  const nextKeys = new Set(expandedNodeKeys.value);
  if (nextKeys.has(key)) nextKeys.delete(key);
  else nextKeys.add(key);
  expandedNodeKeys.value = nextKeys;
}
function nodeMatches(node: CategoryNode) {
  const keyword = appliedSearch.keyword.trim().toLowerCase();
  return (
    (!keyword || node.name.toLowerCase().includes(keyword)) &&
    (!appliedSearch.status || node.status === appliedSearch.status)
  );
}
function hasMatchingDescendant(node: CategoryNode): boolean {
  return node.children.some((child) => nodeMatches(child) || hasMatchingDescendant(child));
}
function collectRows(
  nodes: CategoryNode[],
  level: number,
  parent: CategoryNode | null,
  rows: CategoryRow[],
  forceVisible: boolean,
) {
  nodes.forEach((node, index) => {
    const selfMatches = nodeMatches(node);
    const descendantMatches = hasMatchingDescendant(node);
    const visible = !hasSearch.value || forceVisible || selfMatches || descendantMatches;
    if (!visible) return;
    rows.push({
      key: `${activeScope.value}-${node.id}`,
      node,
      parent,
      level,
      name: node.name,
      status: node.status,
      productCount: node.productCount,
      sort: index + 1,
      createdByName: node.createdByName,
      createdAt: formatDateTime(node.createdAt),
    });
    if (node.children.length && (hasSearch.value || isExpanded(node))) {
      collectRows(node.children, level + 1, node, rows, forceVisible || selfMatches);
    }
  });
}
function findNode(id: number, nodes = activeNodes.value): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(id, node.children);
    if (child) return child;
  }
  return null;
}
function getNodeLevel(id: number, nodes = activeNodes.value, level = 1): number {
  for (const node of nodes) {
    if (node.id === id) return level;
    const childLevel = getNodeLevel(id, node.children, level + 1);
    if (childLevel) return childLevel;
  }
  return 0;
}
function siblingNodes(row: CategoryRow) {
  return row.parent ? row.parent.children : activeNodes.value;
}
function siblingIndex(row: CategoryRow) {
  return siblingNodes(row).findIndex((node) => node.id === row.node.id);
}
function toNode(record: ProductCategoryRecord): CategoryNode {
  return {
    id: record.id,
    parentId: record.parentId ?? null,
    name: record.name,
    status: record.status ?? 'enabled',
    productCount: record.productCount ?? 0,
    sortOrder: record.sortOrder ?? 0,
    createdByName: record.createdByName || '-',
    createdAt: record.createdAt ?? '',
    children: [],
  };
}
function createdAtTimestamp(node: CategoryNode) {
  const timestamp = new Date(node.createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
function buildCategoryTree(records: ProductCategoryRecord[], scope: Scope) {
  const nodes = records
    .filter((record) => record.scope === scope)
    .map(toNode)
    .sort((first, second) => createdAtTimestamp(second) - createdAtTimestamp(first) || second.id - first.id);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const roots: CategoryNode[] = [];
  nodes.forEach((node) => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}
function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);
  const pad = (number: number) => number.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toCategoryPayload(node: CategoryNode, parentId = node.parentId): ProductCategoryPayload {
  return {
    parentId: parentId ?? undefined,
    scope: activeScope.value,
    name: node.name,
    sortOrder: node.sortOrder,
    productCount: node.productCount,
    status: node.status,
  };
}
async function loadCategories() {
  loading.value = true;
  try {
    const records = await listProductCategories();
    categoryData.value = {
      finished: buildCategoryTree(records, 'finished'),
      accessory: buildCategoryTree(records, 'accessory'),
    };
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '分类列表加载失败');
  } finally {
    loading.value = false;
  }
}
function resetForm() {
  Object.assign(formData, { id: null, parentId: null, name: '', status: 'enabled' });
}
function rememberPageScroll() {
  if (typeof window !== 'undefined') pageScrollTop.value = window.scrollY || document.documentElement.scrollTop || 0;
}
function restorePageScroll() {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => window.scrollTo(0, pageScrollTop.value));
}
function restoreSortScroll() {
  if (typeof window === 'undefined') return;
  const scrollTop = pageScrollTop.value;
  const restore = () => window.scrollTo(0, scrollTop);
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
  window.setTimeout(restore, 120);
}
function categoryExists() {
  const siblings = formData.parentId ? (findNode(formData.parentId)?.children ?? []) : activeNodes.value;
  return siblings.some((node) => node.name === formData.name.trim() && node.id !== formData.id);
}
function openCreateDialog(parent?: CategoryRow) {
  if (parent && parent.level >= maxCategoryLevel) {
    adminFeedback.warning('分类最多支持 4 级，不能继续新增下级分类');
    return;
  }
  formMode.value = 'create';
  resetForm();
  formData.parentId = parent?.node.id ?? null;
  rememberPageScroll();
  formVisible.value = true;
}
function openEditDialog(row: CategoryRow) {
  formMode.value = 'edit';
  Object.assign(formData, {
    id: row.node.id,
    parentId: row.parent?.id ?? null,
    name: row.node.name,
    status: row.node.status,
  });
  rememberPageScroll();
  formVisible.value = true;
}
function closeFormDialog() {
  formVisible.value = false;
  resetForm();
  formRef.value?.clearValidate();
}
async function handleSubmit() {
  const result = await formRef.value?.validate();
  if (result !== true) return;
  if (categoryExists()) {
    adminFeedback.warning('同级分类名称不能重复');
    return;
  }
  const name = formData.name.trim();
  try {
    if (formMode.value === 'create') {
      const siblings = formData.parentId ? (findNode(formData.parentId)?.children ?? []) : activeNodes.value;
      await createProductCategory({
        parentId: formData.parentId ?? undefined,
        scope: activeScope.value,
        name,
        sortOrder: siblings.length + 1,
        productCount: 0,
        status: formData.status,
      });
      adminFeedback.created(name);
    } else if (formData.id) {
      const node = findNode(formData.id);
      if (node) {
        await updateProductCategory(formData.id, toCategoryPayload({ ...node, name, status: formData.status }));
      }
      adminFeedback.actionSuccess({ action: '保存', target: name });
    }
    await loadCategories();
    closeFormDialog();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
}
async function moveCategory(row: CategoryRow, offset: number) {
  const siblings = siblingNodes(row);
  const index = siblingIndex(row);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;
  rememberPageScroll();
  [siblings[index], siblings[targetIndex]] = [siblings[targetIndex], siblings[index]];
  siblings.forEach((node, nodeIndex) => {
    node.sortOrder = nodeIndex + 1;
  });
  try {
    await Promise.all(
      siblings.map((node) => updateProductCategory(node.id, toCategoryPayload(node, row.parent?.id ?? null))),
    );
    void nextTick(restoreSortScroll);
    adminFeedback.success('排序已更新');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '排序保存失败');
    await loadCategories();
  }
}
function openStatusConfirm(node: CategoryNode) {
  statusTarget.value = node;
  rememberPageScroll();
  statusConfirmVisible.value = true;
}
function closeStatusConfirm() {
  statusConfirmVisible.value = false;
  statusTarget.value = null;
}
function updateDescendantStatus(node: CategoryNode, status: Status) {
  node.status = status;
  node.children.forEach((child) => updateDescendantStatus(child, status));
}
function flattenNode(node: CategoryNode): CategoryNode[] {
  return [node, ...node.children.flatMap(flattenNode)];
}
async function handleStatusConfirm() {
  if (statusTarget.value) {
    const nextStatus: Status = statusTarget.value.status === 'enabled' ? 'disabled' : 'enabled';
    try {
      const nodes = flattenNode(statusTarget.value);
      await Promise.all(
        nodes.map((node) => updateProductCategory(node.id, toCategoryPayload({ ...node, status: nextStatus }))),
      );
      updateDescendantStatus(statusTarget.value, nextStatus);
      adminFeedback.actionSuccess({
        action: nextStatus === 'enabled' ? '启用' : '停用',
        target: statusTarget.value.name,
      });
    } catch (error) {
      adminFeedback.error(error instanceof Error ? error.message : '状态保存失败');
    }
  }
  closeStatusConfirm();
}
function openDeleteDialog(node: CategoryNode) {
  deleteTarget.value = node;
  rememberPageScroll();
  deleteVisible.value = true;
}
function closeDeleteDialog() {
  deleteVisible.value = false;
  deleteTarget.value = null;
}
function removeNode(nodes: CategoryNode[], id: number): boolean {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    nodes.splice(index, 1);
    return true;
  }
  return nodes.some((node) => removeNode(node.children, id));
}
async function handleDeleteConfirm() {
  const node = deleteTarget.value;
  if (!node) return;
  if (node.productCount || node.children.length) {
    closeDeleteDialog();
    return;
  }
  try {
    const deleted = await deleteProductCategory(node.id);
    if (!deleted) throw new Error('分类删除失败，请刷新后重试');
    removeNode(activeNodes.value, node.id);
    adminFeedback.deleted(node.name);
    closeDeleteDialog();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '删除失败');
  }
}
function handleSearch() {
  appliedSearch.keyword = searchForm.keyword;
  appliedSearch.status = searchForm.status;
}
function handleReset() {
  searchForm.keyword = '';
  searchForm.status = '';
  handleSearch();
}

watch(
  () => route.query.scope,
  (scope) => {
    activeScope.value = resolveAccessibleScope(resolveScope(scope)) ?? activeScope.value;
    handleReset();
  },
);
onMounted(loadCategories);
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
  gap: var(--td-comp-margin-s);
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
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}
.top-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}
.user-entry {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
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
:deep(.zdm-admin-list-layout__content) {
  overflow-anchor: none;
}
.table-actions,
.category-name-cell {
  display: flex;
  align-items: center;
}
:deep(.t-table th),
:deep(.t-table td) {
  padding-left: 24px;
  padding-right: 24px;
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
  color: var(--td-text-color-secondary);
}
.category-name-cell.level-4 {
  padding-left: 84px;
  color: var(--td-text-color-secondary);
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
