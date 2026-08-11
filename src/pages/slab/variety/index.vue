<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>商品基础数据中心</t-breadcrumb-item>
              <t-breadcrumb-item>大板品种管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">全平台唯一数据源</t-tag>
        </header>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="56px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="品种" name="name">
                  <t-input v-model="searchForm.name" clearable placeholder="请输入" />
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
        </section>

        <section class="table-card">
          <div class="table-toolbar">
            <t-button v-if="canCreateVariety" theme="primary" @click="openCreateDialog">
              <template #icon><t-icon name="add" /></template>
              新增
            </t-button>
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
                <t-link v-if="canEditVariety" theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                <t-link
                  v-if="canToggleVarietyStatus"
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openStatusConfirm(row)"
                >
                  {{ row.status === 'normal' ? '停用' : '启用' }}
                </t-link>
                <t-link v-if="canDeleteVariety" theme="danger" hover="color" @click="openDeleteConfirm(row)">
                  删除
                </t-link>
              </div>
            </template>
          </t-table>

          <div class="pagination-bar">
            <t-pagination
              v-model:current="pagination.current"
              v-model:page-size="pagination.pageSize"
              :total="totalCount"
              :page-size-options="pageSizeOptions"
              @change="handlePaginationChange"
            />
          </div>
        </section>
      </main>
    </div>

    <t-dialog
      v-model:visible="formDialogVisible"
      :header="dialogMode === 'create' ? '新增品种' : '编辑品种'"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="72px" colon>
        <t-form-item label="品种" name="name">
          <t-input v-model="formData.name" clearable placeholder="请输入品种" />
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
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmState.type === 'delete' ? '删除' : confirmState.type === 'disable' ? '停用' : '启用'"
      object-type="品种"
      :object-name="confirmState.row?.name"
      @confirm="handleConfirm"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmState.content }}
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { adminFeedback, AdminConfirmDialog } from '@/components/foundation';
import type { FormInstanceFunctions, FormRule, PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import {
  createSlabVariety,
  deleteSlabVariety,
  listSlabVarieties,
  updateSlabVariety,
  updateSlabVarietyStatus,
  type SlabVarietyPayload,
  type SlabVarietyRecord,
} from '@/services/slabVarieties';
import { computed, onMounted, reactive, ref } from 'vue';
type VarietyStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface VarietyItem {
  id: number;
  code: string;
  name: string;
  status: VarietyStatus;
  createdByName: string;
  createdAt: string;
  remark?: string;
}

interface VarietyForm {
  name: string;
  remark: string;
}

const tableData = ref<VarietyItem[]>([]);
const loading = ref(false);
const varietyPermissionPrefix = 'admin.product-data-center.slab-variety';
const loginUser = computed(() => getLoginUser());
const canCreateVariety = computed(() => hasPermission(loginUser.value, `${varietyPermissionPrefix}.create`));
const canEditVariety = computed(() => hasPermission(loginUser.value, `${varietyPermissionPrefix}.edit`));
const canToggleVarietyStatus = computed(() =>
  hasPermission(loginUser.value, `${varietyPermissionPrefix}.toggle-status`),
);
const canDeleteVariety = computed(() => hasPermission(loginUser.value, `${varietyPermissionPrefix}.delete`));

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '品种名称', minWidth: 220, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 180, align: 'left', fixed: 'right' },
];

const searchForm = reactive({
  name: '',
  status: '',
});
const appliedSearchForm = reactive({ ...searchForm });

const pageSizeOptions = [
  { label: '10条/页', value: 10 },
  { label: '20条/页', value: 20 },
  { label: '50条/页', value: 50 },
];

const pagination = reactive({
  current: 1,
  pageSize: 10,
});

const formRef = ref<FormInstanceFunctions>();
const formDialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const formData = reactive<VarietyForm>({
  name: '',
  remark: '',
});

const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入品种', type: 'error' }],
  remark: [{ max: 100, message: '备注最多输入100个汉字', type: 'error' }],
};

const confirmDialogVisible = ref(false);
const confirmState = reactive<{
  content: string;
  type: ConfirmType;
  row: VarietyItem | null;
}>({
  content: '',
  type: 'disable',
  row: null,
});

const filteredData = computed(() => {
  const name = appliedSearchForm.name.trim();
  return tableData.value.filter((item) => {
    const nameMatched = !name || item.name.includes(name);
    const statusMatched = !appliedSearchForm.status || item.status === appliedSearchForm.status;
    return nameMatched && statusMatched;
  });
});

const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredData.value.slice(start, start + pagination.pageSize);
});
const totalCount = computed(() => filteredData.value.length);

const normalizeStatus = (status?: SlabVarietyRecord['status']): VarietyStatus =>
  status === 'disabled' ? 'disabled' : 'normal';

const toBackendStatus = (status: VarietyStatus): SlabVarietyPayload['status'] =>
  status === 'disabled' ? 'disabled' : 'enabled';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const createCode = (name: string) => `slab-variety-${name.trim().length}-${Date.now()}`;

const toVarietyItem = (record: SlabVarietyRecord): VarietyItem => ({
  id: record.id,
  code: record.code,
  name: record.name,
  status: normalizeStatus(record.status),
  createdByName: record.createdByName ?? '-',
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
});

const toVarietyPayload = (status: VarietyStatus, code?: string): SlabVarietyPayload => ({
  name: formData.name.trim(),
  code: code ?? createCode(formData.name),
  status: toBackendStatus(status),
  remark: formData.remark.trim(),
});

const loadVarieties = async () => {
  loading.value = true;
  try {
    const records = await listSlabVarieties();
    tableData.value = records.map(toVarietyItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '品种列表加载失败');
  } finally {
    loading.value = false;
  }
};

const resetFormData = () => {
  formData.name = '';
  formData.remark = '';
};

const fillFormData = (row: VarietyItem) => {
  formData.name = row.name;
  formData.remark = row.remark ?? '';
};

const handleSearch = () => {
  Object.assign(appliedSearchForm, searchForm);
  pagination.current = 1;
};

const handleReset = () => {
  searchForm.name = '';
  searchForm.status = '';
  pagination.pageSize = 10;
  handleSearch();
};

const handlePaginationChange = (pageInfo: PageInfo) => {
  pagination.current = pageInfo.current;
  pagination.pageSize = pageInfo.pageSize;
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = (row: VarietyItem) => {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  fillFormData(row);
  formDialogVisible.value = true;
};

const closeFormDialog = () => {
  formDialogVisible.value = false;
  formRef.value?.clearValidate();
};

const handleSubmit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return;

  try {
    if (dialogMode.value === 'create') {
      await createSlabVariety(toVarietyPayload('normal'));
      await loadVarieties();
      pagination.current = 1;
    } else if (editingId.value) {
      const current = tableData.value.find((item) => item.id === editingId.value);
      await updateSlabVariety(editingId.value, toVarietyPayload(current?.status ?? 'normal', current?.code));
      await loadVarieties();
    }

    const target = formData.name.trim();
    closeFormDialog();
    if (dialogMode.value === 'create') {
      adminFeedback.created(target);
    } else {
      adminFeedback.actionSuccess({ action: '保存', target });
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openStatusConfirm = (row: VarietyItem) => {
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${isNormal ? '停用' : '启用'}品种“${row.name}”？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: VarietyItem) => {
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除品种“${row.name}”？`;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const ensureCurrentPage = () => {
  const maxPage = Math.max(Math.ceil(totalCount.value / pagination.pageSize), 1);
  if (pagination.current > maxPage) {
    pagination.current = maxPage;
  }
};

const handleConfirm = async () => {
  if (!confirmState.row) return;
  const target = confirmState.row;
  const action = confirmState.type === 'delete' ? '删除' : confirmState.type === 'enable' ? '启用' : '停用';

  try {
    if (confirmState.type === 'delete') {
      await deleteSlabVariety(target.id);
      tableData.value = tableData.value.filter((item) => item.id !== target.id);
      ensureCurrentPage();
    } else {
      const updated = await updateSlabVarietyStatus(
        target.id,
        toBackendStatus(confirmState.type === 'enable' ? 'normal' : 'disabled'),
      );
      const targetIndex = tableData.value.findIndex((item) => item.id === target.id);
      if (targetIndex !== -1) {
        tableData.value.splice(targetIndex, 1, toVarietyItem(updated));
      }
    }

    closeConfirmDialog();
    if (confirmState.type === 'delete') {
      adminFeedback.deleted(target.name);
    } else {
      adminFeedback.actionSuccess({ action, target: target.name });
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(loadVarieties);
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
  background: var(--td-bg-color-page);
}

.side-nav {
  width: 248px;
  flex-shrink: 0;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-s) 0;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-border);
}

.brand {
  width: 224px;
  height: 100%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.brand-logo {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #fff;
  background: var(--td-brand-color);
  font: var(--td-font-title-small);
}

.brand-title {
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
}

.brand-subtitle {
  margin-top: 2px;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

.top-actions {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.user-entry {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  padding: 0 var(--td-comp-paddingLR-s);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
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
  background: var(--td-bg-color-container);
  border-radius: 6px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  border: 1px solid var(--td-component-border);
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

.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}

.table-toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: var(--td-comp-margin-l);
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--td-comp-margin-m);
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--td-comp-margin-l);
}

@media (max-width: 960px) {
  .top-nav {
    height: auto;
    align-items: stretch;
    flex-direction: column;
    padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-l);
    gap: var(--td-comp-margin-s);
  }

  .brand {
    width: 100%;
    height: 40px;
  }

  .top-actions {
    width: 100%;
    justify-content: space-between;
  }

  .admin-shell {
    display: block;
    min-height: auto;
  }

  .side-nav {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--td-component-border);
  }

  .page {
    padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  }

  .page-header,
  .filter-row,
  .pagination-bar {
    align-items: flex-start;
    flex-direction: column;
  }

  .filter-fields,
  .filter-fields :deep(.t-form__item),
  .filter-actions {
    width: 100%;
  }

  .filter-actions {
    justify-content: flex-start;
  }
}
</style>
