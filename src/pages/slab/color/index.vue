<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb>
            <t-breadcrumb-item>商品基础数据中心</t-breadcrumb-item>
            <t-breadcrumb-item>大板基础数据管理</t-breadcrumb-item>
            <t-breadcrumb-item>色系管理</t-breadcrumb-item>
          </t-breadcrumb>
          <t-tag theme="primary" variant="light">全平台唯一数据源</t-tag>
        </header>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="72px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="色系" name="name">
                  <t-input v-model="searchForm.name" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="色系分类" name="categoryId">
                  <t-select v-model="searchForm.categoryId" clearable placeholder="请选择">
                    <t-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
                  </t-select>
                </t-form-item>
                <t-form-item label="状态" name="status">
                  <t-select v-model="searchForm.status" clearable placeholder="请选择">
                    <t-option label="启用" value="normal" />
                    <t-option label="停用" value="disabled" />
                  </t-select>
                </t-form-item>
              </div>
              <div class="filter-actions">
                <t-button theme="primary" @click="handleSearch">
                  <template #icon><t-icon name="search" /></template>查询
                </t-button>
                <t-button theme="default" variant="base" @click="handleReset">
                  <template #icon><t-icon name="refresh" /></template>重置
                </t-button>
              </div>
            </div>
          </t-form>
        </section>

        <section class="table-card">
          <div class="table-toolbar">
            <div class="toolbar-actions">
              <t-button v-if="canCreate" theme="primary" @click="openCreate">
                <template #icon><t-icon name="add" /></template>新增
              </t-button>
              <t-button v-if="canManageCategories" theme="default" variant="outline" @click="openCategoryManagement">
                色系分类管理
              </t-button>
            </div>
          </div>
          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
            <template #index="{ rowIndex }">
              {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'normal' ? '启用' : '停用' }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEdit" theme="primary" hover="color" @click="openEdit(row)">编辑</t-link>
                <t-link
                  v-if="canToggle"
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openColorConfirm(row, row.status === 'normal' ? 'disable' : 'enable')"
                >
                  {{ row.status === 'normal' ? '停用' : '启用' }}
                </t-link>
                <t-link v-if="canDelete" theme="danger" hover="color" @click="openColorConfirm(row, 'delete')">
                  删除
                </t-link>
              </div>
            </template>
          </t-table>
          <AdminPagination
            v-model:current="pagination.current"
            v-model:page-size="pagination.pageSize"
            :total="filteredData.length"
            :page-size-options="[10, 20, 50]"
          />
        </section>
      </main>
    </div>

    <AdminDialog
      v-model:visible="formVisible"
      :header="editingId ? '编辑色系' : '新增色系'"
      @confirm="submitColor"
      @cancel="closeColorForm"
      @close="closeColorForm"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="88px" colon>
        <t-form-item label="色系名称" name="name">
          <t-input v-model="formData.name" clearable placeholder="请输入色系名称" />
        </t-form-item>
        <t-form-item label="色系分类" name="categoryId">
          <t-select v-model="formData.categoryId" placeholder="请选择色系分类">
            <t-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
          </t-select>
        </t-form-item>
        <t-form-item label="备注" name="remark">
          <t-textarea
            v-model="formData.remark"
            placeholder="请输入备注"
            :maxlength="100"
            :autosize="{ minRows: 4, maxRows: 6 }"
          />
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminDialog
      v-model:visible="categoryManagementVisible"
      header="色系分类管理"
      width="980px"
      confirm-btn="关闭"
      :cancel-btn="null"
      @confirm="categoryManagementVisible = false"
      @close="categoryManagementVisible = false"
    >
      <div class="table-toolbar">
        <t-button theme="primary" @click="openCategoryForm()">
          <template #icon><t-icon name="add" /></template>新增色系分类
        </t-button>
      </div>
      <t-table row-key="id" :data="categories" :columns="categoryColumns" table-layout="fixed">
        <template #operation="{ row }">
          <div class="table-actions">
            <t-link theme="primary" hover="color" @click="openCategoryForm(row)">编辑</t-link>
            <t-link theme="danger" hover="color" @click="openCategoryDelete(row)">删除</t-link>
          </div>
        </template>
      </t-table>
    </AdminDialog>

    <AdminDialog
      v-model:visible="categoryFormVisible"
      :header="editingCategoryId ? '编辑色系分类' : '新增色系分类'"
      @confirm="submitCategory"
      @cancel="closeCategoryForm"
      @close="closeCategoryForm"
    >
      <t-form ref="categoryFormRef" :data="categoryForm" :rules="categoryRules" label-width="104px" colon>
        <t-form-item label="分类名称" name="name">
          <t-input v-model="categoryForm.name" clearable placeholder="请输入色系分类名称" />
        </t-form-item>
        <t-form-item label="备注" name="remark">
          <t-textarea
            v-model="categoryForm.remark"
            placeholder="请输入备注"
            :maxlength="100"
            :autosize="{ minRows: 4, maxRows: 6 }"
          />
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminConfirmDialog
      v-model:visible="colorConfirmVisible"
      :action="colorConfirmType === 'delete' ? '删除' : colorConfirmType === 'disable' ? '停用' : '启用'"
      object-type="色系"
      :object-name="colorConfirmRow?.name"
      @confirm="submitColorConfirm"
      @cancel="colorConfirmVisible = false"
      @close="colorConfirmVisible = false"
    />

    <AdminConfirmDialog
      v-model:visible="categoryDeleteVisible"
      action="删除"
      object-type="色系分类"
      :object-name="categoryDeleteRow?.name"
      @confirm="submitCategoryDelete"
      @cancel="categoryDeleteVisible = false"
      @close="categoryDeleteVisible = false"
    >
      已被色系引用的分类不能删除。
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminDialog, AdminPagination } from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import {
  createSlabColor,
  createSlabColorCategory,
  deleteSlabColor,
  deleteSlabColorCategory,
  listSlabColorCategories,
  listSlabColors,
  updateSlabColor,
  updateSlabColorCategory,
  updateSlabColorStatus,
  type SlabColorCategoryRecord,
  type SlabColorPayload,
  type SlabColorRecord,
} from '@/services/slabColors';

type ColorStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';
type ColorItem = Omit<SlabColorRecord, 'status' | 'createdAt'> & { status: ColorStatus; createdAt: string };

const permissionPrefix = 'admin.product-data-center.slab-color';
const loginUser = computed(() => getLoginUser());
const canCreate = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.create`));
const canManageCategories = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.manage-categories`));
const canEdit = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.edit`));
const canToggle = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.toggle-status`));
const canDelete = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.delete`));

const tableData = ref<ColorItem[]>([]);
const categories = ref<SlabColorCategoryRecord[]>([]);
const loading = ref(false);
const searchForm = reactive<{ name: string; categoryId: number | ''; status: string }>({
  name: '',
  categoryId: '',
  status: '',
});
const appliedSearchForm = reactive({ ...searchForm });
const pagination = reactive({ current: 1, pageSize: 10 });

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '色系名称', minWidth: 180, align: 'left' },
  { colKey: 'categoryName', title: '色系分类', minWidth: 160, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 180, align: 'left', fixed: 'right' },
];
const categoryColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '分类名称', minWidth: 180 },
  { colKey: 'createdByName', title: '创建人', width: 140, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'remark', title: '备注', minWidth: 220, ellipsis: true },
  { colKey: 'operation', title: '操作', width: 120, fixed: 'right' },
];

const filteredData = computed(() => {
  const name = appliedSearchForm.name.trim();
  return tableData.value.filter(
    (item) =>
      (!name || item.name.includes(name)) &&
      (!appliedSearchForm.categoryId || item.categoryId === appliedSearchForm.categoryId) &&
      (!appliedSearchForm.status || item.status === appliedSearchForm.status),
  );
});
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredData.value.slice(start, start + pagination.pageSize);
});

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toColorItem = (record: SlabColorRecord): ColorItem => ({
  ...record,
  status: record.status === 'disabled' ? 'disabled' : 'normal',
  createdByName: record.createdByName ?? '-',
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
});
const ensureCurrentPage = () => {
  const maxPage = Math.max(Math.ceil(filteredData.value.length / pagination.pageSize), 1);
  if (pagination.current > maxPage) pagination.current = maxPage;
};
const loadColors = async () => {
  loading.value = true;
  try {
    tableData.value = sortByCreatedAtDesc(await listSlabColors()).map(toColorItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '色系列表加载失败');
  } finally {
    loading.value = false;
  }
};
const loadCategories = async () => {
  try {
    categories.value = sortByCreatedAtDesc(await listSlabColorCategories()).map((item) => ({
      ...item,
      createdByName: item.createdByName ?? '-',
      createdAt: formatDateTime(item.createdAt),
    }));
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '色系分类加载失败');
  }
};
const handleSearch = () => {
  Object.assign(appliedSearchForm, searchForm);
  pagination.current = 1;
};
const handleReset = () => {
  Object.assign(searchForm, { name: '', categoryId: '', status: '' });
  pagination.pageSize = 10;
  handleSearch();
};

const formRef = ref<FormInstanceFunctions>();
const formVisible = ref(false);
const editingId = ref<number | null>(null);
const formData = reactive<{ name: string; categoryId: number | null; remark: string }>({
  name: '',
  categoryId: null,
  remark: '',
});
const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入色系名称', type: 'error' }],
  categoryId: [{ required: true, message: '请选择色系分类', type: 'error' }],
  remark: [{ max: 100, message: '备注最多输入100个汉字', type: 'error' }],
};
const openCreate = async () => {
  await loadCategories();
  editingId.value = null;
  Object.assign(formData, { name: '', categoryId: null, remark: '' });
  formVisible.value = true;
};
const openEdit = async (row: ColorItem) => {
  await loadCategories();
  editingId.value = row.id;
  Object.assign(formData, { name: row.name, categoryId: row.categoryId, remark: row.remark ?? '' });
  formVisible.value = true;
};
const closeColorForm = () => {
  formVisible.value = false;
  formRef.value?.clearValidate();
};
const submitColor = async () => {
  if ((await formRef.value?.validate()) !== true || !formData.categoryId) return;
  const payload: SlabColorPayload = {
    categoryId: formData.categoryId,
    name: formData.name.trim(),
    status: 'enabled',
    remark: formData.remark.trim(),
  };
  try {
    if (editingId.value) await updateSlabColor(editingId.value, payload);
    else await createSlabColor(payload);
    const target = payload.name;
    await loadColors();
    closeColorForm();
    if (editingId.value) adminFeedback.actionSuccess({ action: '保存', target });
    else adminFeedback.created(target);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const colorConfirmVisible = ref(false);
const colorConfirmType = ref<ConfirmType>('disable');
const colorConfirmRow = ref<ColorItem | null>(null);
const openColorConfirm = (row: ColorItem, type: ConfirmType) => {
  colorConfirmRow.value = row;
  colorConfirmType.value = type;
  colorConfirmVisible.value = true;
};
const submitColorConfirm = async () => {
  if (!colorConfirmRow.value) return;
  const target = colorConfirmRow.value;
  const action = colorConfirmType.value === 'delete' ? '删除' : colorConfirmType.value === 'enable' ? '启用' : '停用';
  try {
    if (colorConfirmType.value === 'delete') await deleteSlabColor(target.id);
    else await updateSlabColorStatus(target.id, colorConfirmType.value === 'enable' ? 'enabled' : 'disabled');
    await loadColors();
    colorConfirmVisible.value = false;
    if (colorConfirmType.value === 'delete') adminFeedback.deleted(target.name);
    else adminFeedback.actionSuccess({ action, target: target.name });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const categoryManagementVisible = ref(false);
const openCategoryManagement = async () => {
  await loadCategories();
  categoryManagementVisible.value = true;
};
const categoryFormRef = ref<FormInstanceFunctions>();
const categoryFormVisible = ref(false);
const editingCategoryId = ref<number | null>(null);
const categoryForm = reactive({ name: '', remark: '' });
const categoryRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入色系分类名称', type: 'error' }],
  remark: [{ max: 100, message: '备注最多输入100个汉字', type: 'error' }],
};
const openCategoryForm = (row?: SlabColorCategoryRecord) => {
  editingCategoryId.value = row?.id ?? null;
  Object.assign(categoryForm, { name: row?.name ?? '', remark: row?.remark ?? '' });
  categoryFormVisible.value = true;
};
const closeCategoryForm = () => {
  categoryFormVisible.value = false;
  categoryFormRef.value?.clearValidate();
};
const submitCategory = async () => {
  if ((await categoryFormRef.value?.validate()) !== true) return;
  const payload = { name: categoryForm.name.trim(), remark: categoryForm.remark.trim() };
  try {
    if (editingCategoryId.value) await updateSlabColorCategory(editingCategoryId.value, payload);
    else await createSlabColorCategory(payload);
    await loadCategories();
    closeCategoryForm();
    if (editingCategoryId.value) adminFeedback.actionSuccess({ action: '保存', target: payload.name });
    else adminFeedback.created(payload.name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};
const categoryDeleteVisible = ref(false);
const categoryDeleteRow = ref<SlabColorCategoryRecord | null>(null);
const openCategoryDelete = (row: SlabColorCategoryRecord) => {
  categoryDeleteRow.value = row;
  categoryDeleteVisible.value = true;
};
const submitCategoryDelete = async () => {
  if (!categoryDeleteRow.value) return;
  const target = categoryDeleteRow.value;
  try {
    await deleteSlabColorCategory(target.id);
    await loadCategories();
    categoryDeleteVisible.value = false;
    adminFeedback.deleted(target.name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(async () => {
  await Promise.all([loadColors(), loadCategories()]);
});
</script>

<style scoped>
.admin-layout {
  min-height: 100vh;
  background: var(--td-bg-color-page);
}
.admin-shell {
  min-height: calc(100vh - 64px);
  display: flex;
  background: var(--td-bg-color-page);
}
.page {
  min-width: 0;
  flex: 1;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xxl);
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}
.filter-card,
.table-card {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}
.table-card {
  margin-top: var(--td-comp-margin-l);
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
  width: 240px;
  margin-bottom: 0;
}
.filter-actions,
.toolbar-actions,
.table-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}
.filter-actions {
  justify-content: flex-end;
}
.table-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: var(--td-comp-margin-l);
}
.table-actions {
  gap: var(--td-comp-margin-m);
}
.zdm-admin-pagination {
  margin-top: var(--td-comp-margin-l);
}
</style>
