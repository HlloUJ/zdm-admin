<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb>
            <t-breadcrumb-item>租户与门店</t-breadcrumb-item>
            <t-breadcrumb-item>门店基础数据</t-breadcrumb-item>
            <t-breadcrumb-item>门店级别管理</t-breadcrumb-item>
          </t-breadcrumb>
          <t-tag theme="primary" variant="light">门店统一级别数据源</t-tag>
        </header>
        <section class="filter-card">
          <t-form :data="searchForm" label-width="84px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="级别名称" name="name"
                  ><t-input v-model="searchForm.name" clearable placeholder="请输入"
                /></t-form-item>
                <t-form-item label="状态" name="status">
                  <t-select v-model="searchForm.status" clearable placeholder="请选择">
                    <t-option label="启用" value="normal" /><t-option label="停用" value="disabled" />
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
        <section class="table-card">
          <div class="table-toolbar">
            <t-button v-if="canCreate" theme="primary" @click="openCreate"
              ><template #icon><t-icon name="add" /></template>新增</t-button
            >
          </div>
          <t-table
            row-key="id"
            :data="pageData"
            :columns="columns"
            :loading="loading"
            :drag-sort="canSort ? 'row-handler' : undefined"
            :drag-sort-options="{ animation: 200 }"
            hover
            table-layout="fixed"
            @drag-sort="handleDragSort"
          >
            <template #dragTitle><t-icon name="move" title="拖拽排序" /></template>
            <template #drag><t-icon name="move" title="拖拽排序" /></template>
            <template #index="{ rowIndex }">{{
              (pagination.current - 1) * pagination.pageSize + rowIndex + 1
            }}</template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">{{
                row.status === 'normal' ? '启用' : '停用'
              }}</t-tag>
            </template>
            <template #priceComplete="{ row }">
              <t-tag :theme="row.priceComplete ? 'success' : 'warning'" variant="light">
                {{ row.priceComplete ? '配置完整' : '价格待完善' }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEdit" theme="primary" hover="color" @click="openEdit(row)">编辑</t-link>
                <t-link
                  v-if="canToggle"
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openConfirm(row, row.status === 'normal' ? 'disable' : 'enable')"
                  >{{ row.status === 'normal' ? '停用' : '启用' }}</t-link
                >
                <t-link v-if="canDelete" theme="danger" hover="color" @click="openConfirm(row, 'delete')">删除</t-link>
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
      :header="editingId ? '编辑门店级别' : '新增门店级别'"
      @confirm="submitLevel"
      @cancel="closeForm"
      @close="closeForm"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="88px" colon>
        <t-form-item label="级别名称" name="name"
          ><t-input v-model="formData.name" clearable placeholder="请输入级别名称"
        /></t-form-item>
        <t-form-item label="备注" name="remark"
          ><t-textarea
            v-model="formData.remark"
            placeholder="请输入备注"
            :maxlength="100"
            :autosize="{ minRows: 4, maxRows: 6 }"
        /></t-form-item>
      </t-form>
    </AdminDialog>
    <AdminConfirmDialog
      v-model:visible="confirmVisible"
      :action="confirmType === 'delete' ? '删除' : confirmType === 'disable' ? '停用' : '启用'"
      object-type="门店级别"
      :object-name="confirmRow?.name"
      @confirm="submitConfirm"
      @cancel="confirmVisible = false"
      @close="confirmVisible = false"
    />
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
import {
  createStoreLevel,
  deleteStoreLevel,
  listStoreLevels,
  previewStoreLevelDelete,
  reorderStoreLevels,
  updateStoreLevel,
  updateStoreLevelStatus,
  type StoreLevelPayload,
  type StoreLevelRecord,
} from '@/services/storeLevels';

type LevelStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';
type LevelItem = Omit<StoreLevelRecord, 'status' | 'createdAt'> & { status: LevelStatus; createdAt: string };
const permissionPrefix = 'admin.tenant.store-level-management';
const loginUser = computed(() => getLoginUser());
const canCreate = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.create`));
const canEdit = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.edit`));
const canSort = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.sort`));
const canToggle = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.toggle-status`));
const canDelete = computed(() => hasPermission(loginUser.value, `${permissionPrefix}.delete`));
const loading = ref(false);
const tableData = ref<LevelItem[]>([]);
const searchForm = reactive({ name: '', status: '' });
const appliedSearchForm = reactive({ ...searchForm });
const pagination = reactive({ current: 1, pageSize: 10 });
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(canSort.value ? [{ colKey: 'drag', title: 'dragTitle', width: 52, align: 'center' as const }] : []),
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '级别名称', minWidth: 220, align: 'left' },
  { colKey: 'priceComplete', title: '价格状态', width: 130, align: 'center' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 180, align: 'left', fixed: 'right' },
]);
const filteredData = computed(() =>
  tableData.value.filter(
    (item) =>
      (!appliedSearchForm.name.trim() || item.name.includes(appliedSearchForm.name.trim())) &&
      (!appliedSearchForm.status || item.status === appliedSearchForm.status),
  ),
);
const pageData = computed(() =>
  filteredData.value.slice((pagination.current - 1) * pagination.pageSize, pagination.current * pagination.pageSize),
);
const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toLevelItem = (record: StoreLevelRecord): LevelItem => ({
  ...record,
  status: record.status === 'disabled' ? 'disabled' : 'normal',
  createdByName: record.createdByName ?? '-',
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
});
const ensureCurrentPage = () => {
  pagination.current = Math.min(
    pagination.current,
    Math.max(Math.ceil(filteredData.value.length / pagination.pageSize), 1),
  );
};
const loadLevels = async () => {
  loading.value = true;
  try {
    tableData.value = (await listStoreLevels()).map(toLevelItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '门店级别列表加载失败');
  } finally {
    loading.value = false;
  }
};
const handleSearch = () => {
  Object.assign(appliedSearchForm, searchForm);
  pagination.current = 1;
};
const handleReset = () => {
  Object.assign(searchForm, { name: '', status: '' });
  pagination.pageSize = 10;
  handleSearch();
};
const formRef = ref<FormInstanceFunctions>();
const formVisible = ref(false);
const editingId = ref<number | null>(null);
const formData = reactive({ name: '', remark: '' });
const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入级别名称', type: 'error' }],
  remark: [{ max: 100, message: '备注最多输入100个汉字', type: 'error' }],
};
const openCreate = () => {
  editingId.value = null;
  Object.assign(formData, { name: '', remark: '' });
  formVisible.value = true;
};
const openEdit = (row: LevelItem) => {
  editingId.value = row.id;
  Object.assign(formData, { name: row.name, remark: row.remark ?? '' });
  formVisible.value = true;
};
const closeForm = () => {
  formVisible.value = false;
  formRef.value?.clearValidate();
};
const sorting = ref(false);
const handleDragSort = async (context: { current: LevelItem; target: LevelItem }) => {
  if (!canSort.value || sorting.value) return;
  const orderedRows = tableData.value.map((item) => ({ ...item }));
  const currentIndex = orderedRows.findIndex((item) => item.id === context.current.id);
  const targetIndex = orderedRows.findIndex((item) => item.id === context.target.id);
  if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return;
  const [currentRow] = orderedRows.splice(currentIndex, 1);
  orderedRows.splice(targetIndex, 0, currentRow);
  sorting.value = true;
  try {
    await reorderStoreLevels(orderedRows.map((item) => item.id));
    await loadLevels();
    adminFeedback.actionSuccess({ action: '更新排序', target: context.current.name });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '排序保存失败');
    await loadLevels();
  } finally {
    sorting.value = false;
  }
};
const submitLevel = async () => {
  if ((await formRef.value?.validate()) !== true) return;
  const payload: StoreLevelPayload = { name: formData.name.trim(), status: 'enabled', remark: formData.remark.trim() };
  try {
    if (editingId.value) await updateStoreLevel(editingId.value, payload);
    else await createStoreLevel(payload);
    const target = payload.name;
    await loadLevels();
    closeForm();
    if (editingId.value) adminFeedback.actionSuccess({ action: '保存', target });
    else adminFeedback.created(target);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};
const confirmVisible = ref(false);
const confirmType = ref<ConfirmType>('disable');
const confirmRow = ref<LevelItem | null>(null);
const openConfirm = async (row: LevelItem, type: ConfirmType) => {
  if (type === 'delete') {
    try {
      await previewStoreLevelDelete(row.id);
    } catch (error) {
      adminFeedback.error(error instanceof Error ? error.message : '删除条件校验失败');
      return;
    }
  }
  confirmRow.value = row;
  confirmType.value = type;
  confirmVisible.value = true;
};
const submitConfirm = async () => {
  if (!confirmRow.value) return;
  const target = confirmRow.value;
  const targetName = target.name;
  const action = confirmType.value === 'delete' ? '删除' : confirmType.value === 'enable' ? '启用' : '停用';
  try {
    if (confirmType.value === 'delete') await deleteStoreLevel(target.id);
    else await updateStoreLevelStatus(target.id, confirmType.value === 'enable' ? 'enabled' : 'disabled');
    await loadLevels();
    confirmVisible.value = false;
    if (confirmType.value === 'delete') adminFeedback.deleted(targetName);
    else adminFeedback.actionSuccess({ action, target: targetName });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};
onMounted(loadLevels);
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
  gap: var(--td-comp-margin-m);
}
.filter-actions {
  justify-content: flex-end;
}
.table-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: var(--td-comp-margin-l);
}
.zdm-admin-pagination {
  margin-top: var(--td-comp-margin-l);
}
</style>
