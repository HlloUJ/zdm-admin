<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>商品管理</t-breadcrumb-item>
              <t-breadcrumb-item>大板基础数据</t-breadcrumb-item>
              <t-breadcrumb-item>产地管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">全平台唯一数据源</t-tag>
        </header>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="56px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="产地" name="name">
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
            <t-button v-if="canCreateOrigin" theme="primary" @click="openCreateDialog">
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
                <t-link v-if="canEditOrigin" theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                <t-link
                  v-if="canToggleOriginStatus"
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openStatusConfirm(row)"
                >
                  {{ row.status === 'normal' ? '停用' : '启用' }}
                </t-link>
                <t-link v-if="canDeleteOrigin" theme="danger" hover="color" @click="openDeleteConfirm(row)">
                  删除
                </t-link>
              </div>
            </template>
          </t-table>

          <AdminPagination
            v-model:current="pagination.current"
            v-model:page-size="pagination.pageSize"
            :total="totalCount"
            :page-size-options="pageSizeOptions"
          />
        </section>
      </main>
    </div>

    <t-dialog
      v-model:visible="formDialogVisible"
      :header="dialogMode === 'create' ? '新增产地' : '编辑产地'"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="72px" colon>
        <t-form-item label="产地" name="name">
          <t-input v-model="formData.name" clearable placeholder="请输入产地" />
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
      object-type="产地"
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
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import {
  createSlabOrigin,
  deleteSlabOrigin,
  listSlabOrigins,
  updateSlabOrigin,
  updateSlabOriginStatus,
  type SlabOriginPayload,
  type SlabOriginRecord,
} from '@/services/slabOrigins';

type OriginStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface OriginItem {
  id: number;
  name: string;
  status: OriginStatus;
  createdByName: string;
  createdAt: string;
  remark?: string;
}

const tableData = ref<OriginItem[]>([]);
const loading = ref(false);
const permissionPrefix = 'admin.product-data-center.slab-origin';
const loginUser = computed(() => getLoginUser());
const canCreateOrigin = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.create`));
const canEditOrigin = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.edit`));
const canToggleOriginStatus = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.toggle-status`));
const canDeleteOrigin = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.delete`));

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '产地名称', minWidth: 220, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 180, align: 'left', fixed: 'right' },
];

const searchForm = reactive({ name: '', status: '' });
const appliedSearchForm = reactive({ ...searchForm });
const pagination = reactive({ current: 1, pageSize: 10 });
const pageSizeOptions = [10, 20, 50];
const formRef = ref<FormInstanceFunctions>();
const formDialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const formData = reactive({ name: '', remark: '' });
const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入产地', type: 'error' }],
  remark: [{ max: 100, message: '备注最多输入100个汉字', type: 'error' }],
};

const confirmDialogVisible = ref(false);
const confirmState = reactive<{ content: string; type: ConfirmType; row: OriginItem | null }>({
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

const normalizeStatus = (status?: SlabOriginRecord['status']): OriginStatus =>
  status === 'disabled' ? 'disabled' : 'normal';
const toBackendStatus = (status: OriginStatus): SlabOriginPayload['status'] =>
  status === 'disabled' ? 'disabled' : 'enabled';
const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toOriginItem = (record: SlabOriginRecord): OriginItem => ({
  id: record.id,
  name: record.name,
  status: normalizeStatus(record.status),
  createdByName: record.createdByName ?? '-',
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
});
const toPayload = (status: OriginStatus): SlabOriginPayload => ({
  name: formData.name.trim(),
  status: toBackendStatus(status),
  remark: formData.remark.trim(),
});

const ensureCurrentPage = () => {
  const maxPage = Math.max(Math.ceil(totalCount.value / pagination.pageSize), 1);
  if (pagination.current > maxPage) pagination.current = maxPage;
};
const loadOrigins = async () => {
  loading.value = true;
  try {
    tableData.value = sortByCreatedAtDesc(await listSlabOrigins()).map(toOriginItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '产地列表加载失败');
  } finally {
    loading.value = false;
  }
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
const resetFormData = () => Object.assign(formData, { name: '', remark: '' });
const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};
const openEditDialog = (row: OriginItem) => {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  Object.assign(formData, { name: row.name, remark: row.remark ?? '' });
  formDialogVisible.value = true;
};
const closeFormDialog = () => {
  formDialogVisible.value = false;
  formRef.value?.clearValidate();
};
const handleSubmit = async () => {
  if ((await formRef.value?.validate()) !== true) return;
  try {
    if (dialogMode.value === 'create') {
      await createSlabOrigin(toPayload('normal'));
    } else if (editingId.value) {
      const current = tableData.value.find((item) => item.id === editingId.value);
      await updateSlabOrigin(editingId.value, toPayload(current?.status ?? 'normal'));
    }
    const target = formData.name.trim();
    await loadOrigins();
    closeFormDialog();
    if (dialogMode.value === 'create') adminFeedback.created(target);
    else adminFeedback.actionSuccess({ action: '保存', target });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};
const openStatusConfirm = (row: OriginItem) => {
  const enabled = row.status === 'normal';
  confirmState.type = enabled ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${enabled ? '停用' : '启用'}产地“${row.name}”？`;
  confirmDialogVisible.value = true;
};
const openDeleteConfirm = (row: OriginItem) => {
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除产地“${row.name}”？`;
  confirmDialogVisible.value = true;
};
const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};
const handleConfirm = async () => {
  if (!confirmState.row) return;
  const target = confirmState.row;
  const action = confirmState.type === 'delete' ? '删除' : confirmState.type === 'enable' ? '启用' : '停用';
  try {
    if (confirmState.type === 'delete') {
      await deleteSlabOrigin(target.id);
      tableData.value = tableData.value.filter((item) => item.id !== target.id);
      ensureCurrentPage();
    } else {
      const status = toBackendStatus(confirmState.type === 'enable' ? 'normal' : 'disabled');
      const updated = await updateSlabOriginStatus(target.id, status);
      const index = tableData.value.findIndex((item) => item.id === target.id);
      if (index !== -1) tableData.value.splice(index, 1, toOriginItem(updated));
    }
    closeConfirmDialog();
    if (confirmState.type === 'delete') adminFeedback.deleted(target.name);
    else adminFeedback.actionSuccess({ action, target: target.name });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(loadOrigins);
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
  justify-content: flex-start;
  align-items: center;
  margin-bottom: var(--td-comp-margin-l);
}
.table-actions {
  justify-content: flex-start;
  gap: var(--td-comp-margin-m);
}
.zdm-admin-pagination {
  margin-top: var(--td-comp-margin-l);
}
@media (max-width: 960px) {
  .page {
    padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  }
  .page-header,
  .filter-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .filter-fields,
  .filter-actions {
    width: 100%;
  }
  .filter-actions {
    justify-content: flex-start;
  }
}
@media (max-width: 640px) {
  .filter-fields :deep(.t-form__item) {
    width: 100%;
  }
}
</style>
