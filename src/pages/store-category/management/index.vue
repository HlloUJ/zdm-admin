<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <AdminPageHeader :breadcrumbs="['门店分类管理']" />

        <section class="filter-card">
          <t-form :data="searchForm" label-width="74px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="分类名称">
                  <t-input v-model="searchForm.keyword" clearable placeholder="请输入分类名称" />
                </t-form-item>
                <t-form-item label="分类状态">
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
                <t-button variant="base" @click="handleReset"
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
              <p>按手工分类维护；商品上架时须选择二级分类，最多支持两级。</p>
            </div>
            <t-button theme="primary" @click="openCreateDialog()"
              ><template #icon><t-icon name="add" /></template>添加手工分类</t-button
            >
          </div>

          <t-alert v-if="tipVisible" theme="info" class="category-tip" close-btn @close="tipVisible = false">
            已有商品使用中的分类不支持删除；停用后不可用于新商品上架，历史商品保留原分类。
          </t-alert>

          <t-table
            v-if="displayRows.length"
            row-key="key"
            :data="displayRows"
            :columns="columns"
            hover
            table-layout="fixed"
          >
            <template #name="{ row }">
              <div :class="['category-name-cell', `level-${row.level}`]">
                <t-icon :name="row.level === 1 ? 'folder' : 'chevron-right'" />
                <span>{{ row.name }}</span>
              </div>
            </template>
            <template #level="{ row }">
              <span class="level-label">{{ row.level === 1 ? '一级分类' : '二级分类' }}</span>
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'enabled' ? 'success' : 'default'" variant="light">
                {{ row.status === 'enabled' ? '启用' : '停用' }}
              </t-tag>
            </template>
            <template #sort="{ row }">{{ row.level === 1 ? row.sort : '—' }}</template>
            <template #operation="{ row }">
              <div class="table-actions">
                <template v-if="row.level === 1">
                  <t-link theme="primary" @click="openCreateDialog(row.parent)">添加子分类</t-link>
                  <t-link theme="primary" @click="openEditDialog(row.parent)">编辑</t-link>
                  <t-link
                    theme="primary"
                    :disabled="parentIndex(row.parent) === 0"
                    @click="moveCategory(row.parent, -1)"
                    >上移</t-link
                  >
                  <t-link
                    theme="primary"
                    :disabled="parentIndex(row.parent) === categoryData.length - 1"
                    @click="moveCategory(row.parent, 1)"
                    >下移</t-link
                  >
                  <t-dropdown
                    :options="moreActions(row.parent)"
                    @click="(data: { value: string | number }) => handleMoreAction(data, row.parent)"
                  >
                    <t-link theme="primary">更多 <t-icon name="chevron-down" size="14px" /></t-link>
                  </t-dropdown>
                </template>
                <template v-else>
                  <t-link theme="primary" @click="openEditDialog(row.parent, row.child)">编辑</t-link>
                  <t-link
                    theme="primary"
                    :disabled="childIndex(row.parent, row.child) === 0"
                    @click="moveChild(row.parent, row.child, -1)"
                    >上移</t-link
                  >
                  <t-link
                    theme="primary"
                    :disabled="childIndex(row.parent, row.child) === row.parent.children.length - 1"
                    @click="moveChild(row.parent, row.child, 1)"
                    >下移</t-link
                  >
                  <t-link theme="primary" @click="openStatusConfirm(row.parent, row.child)">{{
                    row.child.status === 'enabled' ? '停用' : '启用'
                  }}</t-link>
                  <t-link theme="danger" @click="openDeleteDialog(row.parent, row.child)">删除</t-link>
                </template>
              </div>
            </template>
          </t-table>
          <t-empty v-else description="未找到符合条件的分类" />
        </section>
      </main>
    </div>

    <AdminDialog
      v-model:visible="formVisible"
      :header="formMode === 'create' ? `新增${formData.parentId ? '二级' : '一级'}分类` : '编辑分类'"
      width="520px"
      placement="center"
      confirm-btn="保存"
      @confirm="handleSubmit"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item v-if="formData.parentId" label="一级分类">
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
      <template v-else-if="deleteParent && deleteTarget === deleteParent && deleteParent.children.length">
        分类“{{ deleteTarget?.name }}”包含二级分类，请先删除或转移二级分类。
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
import { computed, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminDialog, AdminPageHeader } from '@/components/foundation';

type CategoryStatus = 'enabled' | 'disabled';
type FormMode = 'create' | 'edit';

interface CategoryChild {
  id: number;
  name: string;
  status: CategoryStatus;
  productCount: number;
}

interface CategoryGroup {
  id: number;
  name: string;
  status: CategoryStatus;
  sort: number;
  productCount: number;
  children: CategoryChild[];
}

interface CategoryForm {
  id: number | null;
  parentId: number | null;
  name: string;
  status: CategoryStatus;
}

interface CategoryRow {
  key: string;
  level: 1 | 2;
  name: string;
  status: CategoryStatus;
  sort: number;
  productCount: number;
  parent: CategoryGroup;
  child?: CategoryChild;
}

const categoryData = ref<CategoryGroup[]>([
  {
    id: 1,
    name: '石材主材',
    status: 'enabled',
    sort: 1,
    productCount: 82,
    children: [
      { id: 11, name: '大理石', status: 'enabled', productCount: 36 },
      { id: 12, name: '奢石', status: 'enabled', productCount: 28 },
      { id: 13, name: '花岗岩', status: 'disabled', productCount: 18 },
    ],
  },
  {
    id: 2,
    name: '成品家具',
    status: 'enabled',
    sort: 2,
    productCount: 37,
    children: [
      { id: 21, name: '餐桌茶几', status: 'enabled', productCount: 16 },
      { id: 22, name: '背景墙', status: 'enabled', productCount: 12 },
      { id: 23, name: '卫浴台面', status: 'enabled', productCount: 9 },
    ],
  },
  {
    id: 3,
    name: '五金配件',
    status: 'enabled',
    sort: 3,
    productCount: 11,
    children: [
      { id: 31, name: '台面配件', status: 'enabled', productCount: 7 },
      { id: 32, name: '安装辅材', status: 'enabled', productCount: 4 },
    ],
  },
]);

const searchForm = reactive({ keyword: '', status: '' as CategoryStatus | '' });
const appliedSearch = reactive({ keyword: '', status: '' as CategoryStatus | '' });
const tipVisible = ref(true);
const formVisible = ref(false);
const deleteVisible = ref(false);
const statusConfirmVisible = ref(false);
const formRef = ref<FormInstanceFunctions>();
const formMode = ref<FormMode>('create');
const formData = reactive<CategoryForm>({ id: null, parentId: null, name: '', status: 'enabled' });
const deleteParent = ref<CategoryGroup | null>(null);
const deleteTarget = ref<CategoryGroup | CategoryChild | null>(null);
const statusParent = ref<CategoryGroup | null>(null);
const statusTarget = ref<CategoryGroup | CategoryChild | null>(null);

const formRules: Record<string, FormRule[]> = {
  name: [
    { required: true, message: '请输入分类名称', type: 'error' },
    { max: 20, message: '分类名称最多20个字符', type: 'error' },
  ],
};

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '分类名称', minWidth: 300, align: 'left' },
  { colKey: 'level', title: '分类级别', width: 120, align: 'left' },
  { colKey: 'productCount', title: '关联商品', width: 120, align: 'center' },
  { colKey: 'status', title: '状态', width: 100, align: 'center' },
  { colKey: 'sort', title: '排序', width: 80, align: 'center' },
  { colKey: 'operation', title: '操作', width: 340, align: 'left', fixed: 'right' },
];

const displayRows = computed<CategoryRow[]>(() => {
  const keyword = appliedSearch.keyword.trim();
  const hasFilter = Boolean(keyword || appliedSearch.status);
  return categoryData.value.flatMap((parent) => {
    const parentMatched =
      (!keyword || parent.name.includes(keyword)) && (!appliedSearch.status || parent.status === appliedSearch.status);
    const matchingChildren = parent.children.filter(
      (child) =>
        (!keyword || child.name.includes(keyword)) && (!appliedSearch.status || child.status === appliedSearch.status),
    );
    if (hasFilter && !parentMatched && !matchingChildren.length) return [];
    const childRows = hasFilter && parentMatched && !matchingChildren.length ? parent.children : matchingChildren;
    return [
      {
        key: `parent-${parent.id}`,
        level: 1,
        name: parent.name,
        status: parent.status,
        sort: parent.sort,
        productCount: parent.productCount,
        parent,
      },
      ...childRows.map((child) => ({
        key: `child-${child.id}`,
        level: 2 as const,
        name: child.name,
        status: child.status,
        sort: 0,
        productCount: child.productCount,
        parent,
        child,
      })),
    ];
  });
});

const parentName = computed(() => categoryData.value.find((item) => item.id === formData.parentId)?.name ?? '');
const statusConfirmText = computed(() => {
  if (!statusTarget.value) return '';
  const name = statusTarget.value.name;
  return statusTarget.value.status === 'enabled' ? `是否停用分类“${name}”？` : `是否启用分类“${name}”？`;
});
const deleteBlocked = computed(() =>
  Boolean(
    deleteTarget.value?.productCount ||
    (deleteParent.value && deleteTarget.value === deleteParent.value && deleteParent.value.children.length),
  ),
);

const syncSort = () =>
  categoryData.value.forEach((item, index) => {
    item.sort = index + 1;
  });
const parentIndex = (category: CategoryGroup) => categoryData.value.findIndex((item) => item.id === category.id);
const childIndex = (parent: CategoryGroup, child?: CategoryChild) =>
  parent.children.findIndex((item) => item.id === child?.id);

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

const openCreateDialog = (parent?: CategoryGroup) => {
  formMode.value = 'create';
  resetForm();
  if (parent) formData.parentId = parent.id;
  formVisible.value = true;
};

const openEditDialog = (parent: CategoryGroup, child?: CategoryChild) => {
  formMode.value = 'edit';
  formData.id = child?.id ?? parent.id;
  formData.parentId = child ? parent.id : null;
  formData.name = child?.name ?? parent.name;
  formData.status = child?.status ?? parent.status;
  formVisible.value = true;
};

const closeFormDialog = () => {
  formVisible.value = false;
  resetForm();
};

const categoryNameExists = () =>
  categoryData.value.some((parent) => {
    if (formData.parentId)
      return (
        parent.id === formData.parentId &&
        parent.children.some((child) => child.name === formData.name.trim() && child.id !== formData.id)
      );
    return parent.name === formData.name.trim() && parent.id !== formData.id;
  });

const handleSubmit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return;
  const name = formData.name.trim();
  if (categoryNameExists()) {
    adminFeedback.warning('同级分类名称不能重复');
    return;
  }
  if (formMode.value === 'create') {
    if (formData.parentId) {
      const parent = categoryData.value.find((item) => item.id === formData.parentId);
      parent?.children.push({ id: Date.now(), name, status: formData.status, productCount: 0 });
    } else {
      categoryData.value.push({
        id: Date.now(),
        name,
        status: formData.status,
        sort: categoryData.value.length + 1,
        productCount: 0,
        children: [],
      });
    }
    adminFeedback.actionSuccess({ action: '新增', target: name });
  } else if (formData.parentId) {
    const child = categoryData.value
      .find((item) => item.id === formData.parentId)
      ?.children.find((item) => item.id === formData.id);
    if (child) Object.assign(child, { name });
    adminFeedback.actionSuccess({ action: '保存', target: name });
  } else {
    const parent = categoryData.value.find((item) => item.id === formData.id);
    if (parent) Object.assign(parent, { name });
    adminFeedback.actionSuccess({ action: '保存', target: name });
  }
  closeFormDialog();
};

const moreActions = (category: CategoryGroup) => [
  { content: category.status === 'enabled' ? '停用一级分类' : '启用一级分类', value: 'toggle' },
  { content: '删除一级分类', value: 'delete', theme: 'error' },
];

const applyStatusChange = (parent: CategoryGroup, child?: CategoryChild) => {
  const target = child ?? parent;
  target.status = target.status === 'enabled' ? 'disabled' : 'enabled';
  if (!child && target.status === 'disabled')
    parent.children.forEach((item) => {
      item.status = 'disabled';
    });
  adminFeedback.success(`${target.status === 'enabled' ? '已启用' : '已停用'}“${target.name}”`);
};

const openStatusConfirm = (parent: CategoryGroup, child?: CategoryChild) => {
  statusParent.value = parent;
  statusTarget.value = child ?? parent;
  statusConfirmVisible.value = true;
};

const closeStatusConfirm = () => {
  statusConfirmVisible.value = false;
  statusParent.value = null;
  statusTarget.value = null;
};

const handleStatusConfirm = () => {
  if (statusParent.value && statusTarget.value) {
    applyStatusChange(
      statusParent.value,
      statusTarget.value === statusParent.value ? undefined : (statusTarget.value as CategoryChild),
    );
  }
  closeStatusConfirm();
};

const handleMoreAction = (data: { value: string | number }, category: CategoryGroup) => {
  if (data.value === 'toggle') openStatusConfirm(category);
  if (data.value === 'delete') openDeleteDialog(category);
};

const moveCategory = (category: CategoryGroup, offset: number) => {
  const index = categoryData.value.findIndex((item) => item.id === category.id);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= categoryData.value.length) return;
  [categoryData.value[index], categoryData.value[targetIndex]] = [
    categoryData.value[targetIndex],
    categoryData.value[index],
  ];
  syncSort();
  adminFeedback.success('排序已更新');
};

const moveChild = (parent: CategoryGroup, child: CategoryChild, offset: number) => {
  const index = childIndex(parent, child);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= parent.children.length) return;
  [parent.children[index], parent.children[targetIndex]] = [parent.children[targetIndex], parent.children[index]];
  adminFeedback.success('排序已更新');
};

const openDeleteDialog = (parent: CategoryGroup, child?: CategoryChild) => {
  deleteParent.value = parent;
  deleteTarget.value = child ?? parent;
  deleteVisible.value = true;
};

const handleDeleteConfirm = () => {
  if (!deleteTarget.value) return;
  if (!deleteBlocked.value) {
    if (deleteParent.value && deleteTarget.value !== deleteParent.value) {
      deleteParent.value.children = deleteParent.value.children.filter((item) => item.id !== deleteTarget.value?.id);
    } else if (deleteParent.value) {
      categoryData.value = categoryData.value.filter((item) => item.id !== deleteParent.value?.id);
      syncSort();
    }
    adminFeedback.actionSuccess({ action: '删除', target: deleteTarget.value.name });
  }
  deleteVisible.value = false;
  deleteParent.value = null;
  deleteTarget.value = null;
};
</script>

<style scoped>
.filter-card,
.category-card {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border-radius: var(--td-radius-medium);
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
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}
.filter-fields {
  flex: 1;
  gap: var(--td-comp-margin-xl);
}
.filter-fields :deep(.t-form__item) {
  width: 280px;
  margin-bottom: 0;
}
.filter-actions {
  flex: 0 0 auto;
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
  margin-top: var(--td-comp-margin-l);
}
.category-name-cell {
  gap: var(--td-comp-margin-s);
}
.category-name-cell.level-1 {
  font-weight: 600;
}
.category-name-cell.level-1 :deep(.t-icon) {
  color: var(--td-brand-color);
}
.category-name-cell.level-2 {
  padding-left: 30px;
  color: var(--td-text-color-secondary);
}
.category-name-cell.level-2 :deep(.t-icon) {
  color: var(--td-text-color-placeholder);
}
.level-label {
  color: var(--td-text-color-secondary);
}
.table-actions {
  flex-wrap: wrap;
  gap: var(--td-comp-margin-m);
}
.table-actions :deep(.t-link) {
  white-space: nowrap;
}
.form-help {
  margin: 6px 0 0;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

@media (max-width: 1100px) {
  .category-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
