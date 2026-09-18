<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <AdminPageHeader class="page-header">
          <t-breadcrumb max-item-width="300"><t-breadcrumb-item>供应商供货类型管理</t-breadcrumb-item></t-breadcrumb>
        </AdminPageHeader>
        <AdminListLayout>
          <template #filters>
            <t-form class="zdm-admin-filter-form" label-width="auto" :data="searchForm" colon @submit="handleSearch">
              <div class="supply-type-filter-row">
                <div class="supply-type-filter-fields">
                  <div class="supply-type-name-filter">
                    <t-form-item label="供货类型" name="name">
                      <t-input v-model="searchForm.name" clearable placeholder="请输入" />
                    </t-form-item>
                  </div>
                  <div class="supply-type-status-filter">
                    <t-form-item class="zdm-status-filter" label="状态" name="status">
                      <t-select v-model="searchForm.status" clearable placeholder="请选择">
                        <t-option label="启用" value="enabled" />
                        <t-option label="停用" value="disabled" />
                      </t-select>
                    </t-form-item>
                  </div>
                </div>
                <div class="supply-type-filter-actions">
                  <t-space>
                    <t-button theme="primary" type="submit">
                      <template #icon><t-icon name="search" /></template>查询
                    </t-button>
                    <t-button theme="default" variant="base" @click="handleReset">
                      <template #icon><t-icon name="refresh" /></template>重置
                    </t-button>
                  </t-space>
                </div>
              </div>
            </t-form>
          </template>
          <template #toolbar>
            <template v-if="can('create')">
              <t-button theme="primary" @click="openForm()"
                ><template #icon><t-icon name="add" /></template>新增</t-button
              >
            </template>
          </template>
          <template #table>
            <t-table row-key="id" :data="pageRows" :columns="columns" :loading="loading" hover table-layout="fixed">
              <template #index="{ rowIndex }">{{ (page - 1) * size + rowIndex + 1 }}</template>
              <template #createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
              <template #status="{ row }"
                ><t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">{{
                  row.status === 'enabled' ? '启用' : '停用'
                }}</t-tag></template
              >
              <template #operation="{ row }"
                ><t-space size="medium">
                  <t-link v-if="can('edit')" theme="primary" hover="color" @click="openForm(row)">编辑</t-link>
                  <t-link
                    v-if="can('toggle-status')"
                    :theme="row.status === 'enabled' ? 'warning' : 'success'"
                    hover="color"
                    @click="openStatusDialog(row)"
                    >{{ row.status === 'enabled' ? '停用' : '启用' }}</t-link
                  >
                  <t-link v-if="can('delete')" theme="danger" hover="color" @click="deleting = row">删除</t-link>
                </t-space></template
              >
            </t-table>
          </template>
          <template #pagination>
            <AdminPagination
              v-model:current="page"
              v-model:page-size="size"
              :total="filteredRows.length"
              :page-size-options="[10, 20, 50]"
            />
          </template>
        </AdminListLayout>
      </main>
    </div>
    <AdminDialog
      v-model:visible="visible"
      :header="editing ? '编辑供货类型' : '新增供货类型'"
      :confirm-btn="{ content: '提交', loading: saving }"
      @confirm="save"
    >
      <t-form
        ref="form"
        :data="draft"
        :rules="{ name: [{ required: true, message: '请输入供货类型名称', type: 'error' }] }"
        label-width="84px"
        colon
        ><t-form-item label="供货类型" name="name"
          ><t-input v-model="draft.name" clearable placeholder="请输入供货类型名称" :maxlength="80" /></t-form-item
      ></t-form>
    </AdminDialog>
    <AdminDialog
      :visible="statusDialogVisible"
      :header="`是否${statusAction}`"
      width="440px"
      :confirm-btn="{ content: `确认${statusAction}`, loading: changingStatus }"
      :cancel-btn="{ content: '取消', disabled: changingStatus }"
      @confirm="confirmStatusChange"
      @cancel="closeStatusDialog"
      @close="closeStatusDialog"
    >
      是否{{ statusAction }}供货类型“{{ statusTarget?.name }}”？
    </AdminDialog>
    <AdminDialog
      :visible="Boolean(deleting)"
      header="删除供货类型"
      :confirm-btn="{ content: '删除', theme: 'danger', loading: saving }"
      @confirm="remove"
      @cancel="deleting = undefined"
      @close="deleting = undefined"
    >
      是否删除供货类型“{{ deleting?.name }}”？
    </AdminDialog>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { FormInstanceFunctions, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminTopNav from '@/components/AdminTopNav.vue';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import { AdminDialog, AdminListLayout, AdminPageHeader, AdminPagination, adminFeedback } from '@/components/foundation';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import {
  listSupplierSupplyTypes,
  createSupplierSupplyType,
  updateSupplierSupplyType,
  updateSupplierSupplyTypeStatus,
  deleteSupplierSupplyType,
  type SupplierSupplyTypeRecord,
} from '@/services/suppliers';
const can = (action: string) => hasPermission(getLoginUser(), `admin.supplier-supply-type-management.${action}`);
const rows = ref<SupplierSupplyTypeRecord[]>([]);
const page = ref(1);
const size = ref(10);
const searchForm = reactive({ name: '', status: '' });
const appliedSearchForm = reactive({ ...searchForm });
const filteredRows = computed(() =>
  rows.value.filter(
    (row) =>
      (!appliedSearchForm.name || row.name.includes(appliedSearchForm.name)) &&
      (!appliedSearchForm.status || row.status === appliedSearchForm.status),
  ),
);
const pageRows = computed(() => filteredRows.value.slice((page.value - 1) * size.value, page.value * size.value));
const handleSearch = () => {
  Object.assign(appliedSearchForm, { name: searchForm.name.trim(), status: searchForm.status });
  page.value = 1;
};
const handleReset = () => {
  Object.assign(searchForm, { name: '', status: '' });
  handleSearch();
};
watch([() => filteredRows.value.length, size], () => {
  page.value = Math.min(page.value, Math.max(1, Math.ceil(filteredRows.value.length / size.value)));
});
const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '供货类型', minWidth: 220, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  {
    colKey: 'operation',
    title: '操作',
    width: 164,
    align: 'left',
    fixed: 'right',
  },
]);
const loading = ref(false);
const saving = ref(false);
const visible = ref(false);
const editing = ref<SupplierSupplyTypeRecord>();
const deleting = ref<SupplierSupplyTypeRecord>();
const statusTarget = ref<SupplierSupplyTypeRecord>();
const changingStatus = ref(false);
const statusDialogVisible = ref(false);
const openStatusDialog = (row: SupplierSupplyTypeRecord) => {
  statusTarget.value = { ...row };
  statusDialogVisible.value = true;
};
const statusAction = computed(() => (statusTarget.value?.status === 'enabled' ? '停用' : '启用'));
const closeStatusDialog = () => {
  if (!changingStatus.value) statusDialogVisible.value = false;
};
const form = ref<FormInstanceFunctions>();
const draft = reactive({ name: '' });
const load = async () => {
  loading.value = true;
  try {
    rows.value = await listSupplierSupplyTypes();
  } catch (error) {
    adminFeedback.actionError({ action: '加载', target: '供货类型列表', error });
  } finally {
    loading.value = false;
  }
};
const openForm = (row?: SupplierSupplyTypeRecord) => {
  editing.value = row;
  draft.name = row?.name ?? '';
  visible.value = true;
};
const save = async () => {
  if (saving.value || (await form.value?.validate()) !== true) return;
  saving.value = true;
  const target = draft.name.trim();
  const action = editing.value ? '保存' : '新增';
  try {
    const payload = { name: target };
    if (editing.value) await updateSupplierSupplyType(editing.value.id, payload);
    else await createSupplierSupplyType(payload);
    visible.value = false;
    if (action === '新增') adminFeedback.created(target);
    else adminFeedback.actionSuccess({ action, target });
    await load();
  } catch (error) {
    adminFeedback.actionError({ action, target, error });
  } finally {
    saving.value = false;
  }
};
const confirmStatusChange = async () => {
  if (!statusDialogVisible.value || !statusTarget.value || changingStatus.value) return;
  const row = statusTarget.value;
  const action = statusAction.value;
  changingStatus.value = true;
  try {
    await updateSupplierSupplyTypeStatus(row.id, row.status === 'enabled' ? 'disabled' : 'enabled');
    statusDialogVisible.value = false;
    adminFeedback.actionSuccess({ action, target: row.name });
    await load();
  } catch (error) {
    adminFeedback.actionError({ action, target: row.name, error });
  } finally {
    changingStatus.value = false;
  }
};
const remove = async () => {
  if (!deleting.value || saving.value) return;
  const target = deleting.value;
  saving.value = true;
  try {
    await deleteSupplierSupplyType(target.id);
    deleting.value = undefined;
    adminFeedback.deleted(target.name);
    await load();
  } catch (error) {
    adminFeedback.actionError({ action: '删除', target: target.name, error });
  } finally {
    saving.value = false;
  }
};
onMounted(load);
</script>

<style scoped>
.supply-type-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}

.supply-type-filter-fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-l);
}

.supply-type-name-filter {
  width: 268px;
}

.supply-type-status-filter {
  width: 240px;
}

.supply-type-filter-actions {
  margin-left: auto;
}
</style>
