<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>供应商管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">当前组织：{{ currentOrganizationLabel }}</t-tag>
        </header>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="84px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="供应商名称" name="name">
                  <t-input v-model="searchForm.name" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="供货类型" name="supplyTypeId">
                  <t-select v-model="searchForm.supplyTypeId" filterable clearable placeholder="请选择">
                    <t-option v-for="item in supplyTypes" :key="item.id" :label="item.name" :value="item.id" />
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
            <div class="toolbar-actions">
              <t-button v-if="canCreateSupplier" theme="primary" @click="openCreateDialog">
                <template #icon><t-icon name="add" /></template>
                新增
              </t-button>
              <t-button v-if="canManageSupplyTypes" theme="default" variant="outline" @click="openSupplyTypeManagement">
                供货类型配置
              </t-button>
            </div>
          </div>

          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
            <template #index="{ rowIndex }">
              {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
            </template>
            <template #type="{ row }">
              <t-space break-line size="small">
                <t-tag v-for="item in row.supplyTypes" :key="item.id" variant="light">
                  {{ item.name }}
                </t-tag>
              </t-space>
            </template>
            <template #phone="{ row }">
              {{ maskPhone(row.phone) }}
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'normal' ? '启用' : '停用' }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEditSupplier" theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                <t-link
                  v-if="canToggleSupplierStatus"
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openStatusConfirm(row)"
                >
                  {{ row.status === 'normal' ? '停用' : '启用' }}
                </t-link>
                <t-link v-if="canDeleteSupplier" theme="danger" hover="color" @click="openDeleteConfirm(row)">
                  删除
                </t-link>
              </div>
            </template>
          </t-table>

          <AdminPagination
            v-model:current="pagination.current"
            v-model:page-size="pagination.pageSize"
            :total="paginationTotal"
            :page-size-options="pageSizeOptions"
          />
        </section>
      </main>
    </div>

    <AdminDialog
      v-model:visible="formDialogVisible"
      :header="dialogMode === 'create' ? '新增' : '编辑'"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item label="供应商名称" name="name" required-mark>
          <t-input v-model="formData.name" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="供货类型" name="supplyTypeIds" required-mark>
          <t-select v-model="formData.supplyTypeIds" multiple filterable clearable placeholder="请选择">
            <t-option
              v-for="item in selectableSupplyTypes"
              :key="item.id"
              :label="item.status === 'disabled' ? `${item.name}（已停用）` : item.name"
              :value="item.id"
              :disabled="item.status === 'disabled'"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="联系人" name="contact" required-mark>
          <t-input v-model="formData.contact" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="联系电话" name="phone" required-mark>
          <t-input v-model="formData.phone" clearable placeholder="请输入" :maxlength="11" @input="handlePhoneInput" />
        </t-form-item>
        <t-form-item label="备注" name="remark">
          <t-textarea
            v-model="formData.remark"
            placeholder="请输入"
            :maxlength="100"
            :autosize="{ minRows: 4, maxRows: 6 }"
          />
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminDialog
      v-model:visible="supplyTypeManagementVisible"
      header="供货类型配置"
      width="900px"
      confirm-btn="关闭"
      :cancel-btn="null"
      @confirm="supplyTypeManagementVisible = false"
      @close="supplyTypeManagementVisible = false"
    >
      <div class="table-toolbar">
        <t-button theme="primary" @click="openSupplyTypeForm()">
          <template #icon><t-icon name="add" /></template>
          新增供货类型
        </t-button>
      </div>
      <t-table row-key="id" :data="supplyTypes" :columns="supplyTypeColumns" table-layout="fixed">
        <template #status="{ row }">
          <t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">
            {{ row.status === 'enabled' ? '启用' : '停用' }}
          </t-tag>
        </template>
        <template #createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        <template #operation="{ row }">
          <div class="table-actions">
            <t-link theme="primary" hover="color" @click="openSupplyTypeForm(row)">编辑</t-link>
            <t-link
              :theme="row.status === 'enabled' ? 'warning' : 'success'"
              hover="color"
              @click="toggleSupplyTypeStatus(row)"
            >
              {{ row.status === 'enabled' ? '停用' : '启用' }}
            </t-link>
            <t-link theme="danger" hover="color" @click="openSupplyTypeDeleteConfirm(row)">删除</t-link>
          </div>
        </template>
      </t-table>
    </AdminDialog>

    <AdminDialog
      v-model:visible="supplyTypeFormVisible"
      :header="editingSupplyTypeId ? '编辑供货类型' : '新增供货类型'"
      @confirm="submitSupplyType"
      @cancel="closeSupplyTypeForm"
      @close="closeSupplyTypeForm"
    >
      <t-form ref="supplyTypeFormRef" :data="supplyTypeForm" :rules="supplyTypeRules" label-width="96px" colon>
        <t-form-item label="类型名称" name="name">
          <t-input v-model="supplyTypeForm.name" clearable placeholder="请输入供货类型名称" />
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminConfirmDialog
      v-model:visible="supplyTypeDeleteConfirmVisible"
      action="删除"
      object-type="供货类型"
      :object-name="pendingSupplyTypeDelete?.name"
      @confirm="confirmSupplyTypeDelete"
      @cancel="closeSupplyTypeDeleteConfirm"
      @close="closeSupplyTypeDeleteConfirm"
    >
      删除后不可恢复，确定删除该供货类型吗？
    </AdminConfirmDialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmState.type === 'delete' ? '删除' : confirmState.type === 'disable' ? '停用' : '启用'"
      object-type="供应商"
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
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminDialog, AdminPagination } from '@/components/foundation';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import {
  createSupplier,
  createSupplierSupplyType,
  deleteSupplier,
  deleteSupplierSupplyType,
  listSupplierSupplyTypes,
  listSuppliers,
  updateSupplier,
  updateSupplierSupplyType,
  updateSupplierSupplyTypeStatus,
  updateSupplierStatus,
  type SupplierPayload,
  type SupplierRecord,
  type SupplierSupplyTypePayload,
  type SupplierSupplyTypeRecord,
} from '@/services/suppliers';
import { computed, onMounted, reactive, ref } from 'vue';
type SupplierStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface SupplierItem {
  id: number;
  name: string;
  supplyTypeIds: number[];
  supplyTypes: SupplierSupplyTypeRecord[];
  contact: string;
  phone: string;
  status: SupplierStatus;
  createdByName: string;
  createdByAccountId?: number;
  createdAt: string;
  remark?: string;
}

interface SupplierForm {
  name: string;
  supplyTypeIds: number[];
  contact: string;
  phone: string;
  remark: string;
}

const tableData = ref<SupplierItem[]>([]);
const supplyTypes = ref<SupplierSupplyTypeRecord[]>([]);
const loading = ref(false);
const supplierPermissionPrefix = 'admin.supplier-management';
const loginUser = computed(() => getLoginUser());
const canCreateSupplier = computed(() => hasPermission(loginUser.value, `${supplierPermissionPrefix}.create`));
const canEditSupplier = computed(() => hasPermission(loginUser.value, `${supplierPermissionPrefix}.edit`));
const canToggleSupplierStatus = computed(() =>
  hasPermission(loginUser.value, `${supplierPermissionPrefix}.toggle-status`),
);
const canDeleteSupplier = computed(() => hasPermission(loginUser.value, `${supplierPermissionPrefix}.delete`));
const canManageSupplyTypes = computed(
  () =>
    !loginUser.value.tenantId &&
    !loginUser.value.storeId &&
    hasPermission(loginUser.value, `${supplierPermissionPrefix}.manage-supply-types`),
);
const currentOrganizationLabel = computed(
  () => loginUser.value.storeName ?? (loginUser.value.tenantId ? loginUser.value.tenantName : '运营管理平台'),
);
const selectableSupplyTypes = computed(() =>
  supplyTypes.value.filter((item) => item.status === 'enabled' || formData.supplyTypeIds.includes(item.id)),
);

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'name', title: '供应商名称', minWidth: 220, align: 'left' },
  { colKey: 'type', title: '供货类型', minWidth: 180, align: 'left' },
  { colKey: 'contact', title: '联系人', width: 120, align: 'center' },
  { colKey: 'phone', title: '联系电话', width: 150, align: 'center' },
  { colKey: 'status', title: '状态', width: 100, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 200, align: 'left', fixed: 'right' },
];
const supplyTypeColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '类型名称', minWidth: 180 },
  { colKey: 'status', title: '状态', width: 100, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 190, fixed: 'right' },
];

const searchForm = reactive({
  name: '',
  supplyTypeId: '' as number | '',
  status: '' as SupplierStatus | '',
});
const appliedSearchForm = reactive({ ...searchForm });

const pageSizeOptions = [10, 20, 50];
const pagination = reactive({
  current: 1,
  pageSize: 10,
});

const formRef = ref<FormInstanceFunctions>();
const formDialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const formData = reactive<SupplierForm>({
  name: '',
  supplyTypeIds: [],
  contact: '',
  phone: '',
  remark: '',
});

const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入供应商名称', type: 'error' }],
  supplyTypeIds: [{ required: true, message: '请选择供货类型', type: 'error' }],
  contact: [{ required: true, message: '请输入联系人', type: 'error' }],
  phone: [
    { required: true, message: '请输入联系电话', type: 'error' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入合法的11位联系电话', type: 'error' },
  ],
  remark: [{ max: 100, message: '备注最多可输入100个字符', type: 'error' }],
};

const confirmDialogVisible = ref(false);
const confirmState = reactive<{
  content: string;
  type: ConfirmType;
  row: SupplierItem | null;
}>({
  content: '',
  type: 'disable',
  row: null,
});

const supplyTypeManagementVisible = ref(false);
const supplyTypeFormVisible = ref(false);
const supplyTypeFormRef = ref<FormInstanceFunctions>();
const editingSupplyTypeId = ref<number | null>(null);
const supplyTypeForm = reactive<SupplierSupplyTypePayload>({ name: '' });
const supplyTypeRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入供货类型名称', type: 'error' }],
};
const supplyTypeDeleteConfirmVisible = ref(false);
const pendingSupplyTypeDelete = ref<SupplierSupplyTypeRecord | null>(null);

const filteredData = computed(() => {
  const name = appliedSearchForm.name.trim();
  return tableData.value.filter((item) => {
    const nameMatched = !name || item.name.includes(name);
    const typeMatched = !appliedSearchForm.supplyTypeId || item.supplyTypeIds.includes(appliedSearchForm.supplyTypeId);
    const statusMatched = !appliedSearchForm.status || item.status === appliedSearchForm.status;
    return nameMatched && typeMatched && statusMatched;
  });
});

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredData.value.slice(start, start + pagination.pageSize);
});

const maskPhone = (phone: string) => phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');

const normalizeStatus = (status?: SupplierRecord['status']): SupplierStatus =>
  status === 'disabled' ? 'disabled' : 'normal';

const toBackendStatus = (status: SupplierStatus): SupplierPayload['status'] =>
  status === 'disabled' ? 'disabled' : 'enabled';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toSupplierItem = (record: SupplierRecord): SupplierItem => ({
  id: record.id,
  name: record.name,
  supplyTypeIds: record.supplyTypeIds,
  supplyTypes: record.supplyTypes,
  contact: record.contactName ?? '',
  phone: record.contactPhone ?? '',
  status: normalizeStatus(record.status),
  createdByName: record.createdByName || '-',
  createdByAccountId: record.createdByAccountId,
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
});

const toSupplierPayload = (status: SupplierStatus): SupplierPayload => ({
  name: formData.name.trim(),
  supplyTypeIds: [...formData.supplyTypeIds],
  contactName: formData.contact.trim(),
  contactPhone: formData.phone.trim(),
  qualificationStatus: 'approved',
  status: toBackendStatus(status),
  remark: formData.remark.trim(),
});

const loadSuppliers = async () => {
  loading.value = true;
  try {
    const records = await listSuppliers();
    tableData.value = records.map(toSupplierItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '供应商列表加载失败');
  } finally {
    loading.value = false;
  }
};

const loadSupplyTypes = async () => {
  try {
    supplyTypes.value = await listSupplierSupplyTypes();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '供货类型加载失败');
  }
};

const handlePhoneInput = (value: string) => {
  formData.phone = value.replace(/\D/g, '').slice(0, 11);
};

const resetFormData = () => {
  formData.name = '';
  formData.supplyTypeIds = [];
  formData.contact = '';
  formData.phone = '';
  formData.remark = '';
};

const fillFormData = (row: SupplierItem) => {
  formData.name = row.name;
  formData.supplyTypeIds = [...row.supplyTypeIds];
  formData.contact = row.contact;
  formData.phone = row.phone;
  formData.remark = row.remark ?? '';
};

const ensureCurrentPage = () => {
  if (pagination.current > pageCount.value) {
    pagination.current = pageCount.value;
  }
};

const handleSearch = () => {
  Object.assign(appliedSearchForm, searchForm);
  pagination.current = 1;
};

const handleReset = () => {
  searchForm.name = '';
  searchForm.supplyTypeId = '';
  searchForm.status = '';
  pagination.pageSize = 10;
  handleSearch();
};

const openCreateDialog = async () => {
  await loadSupplyTypes();
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = async (row: SupplierItem) => {
  await loadSupplyTypes();
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

  if (!formData.supplyTypeIds.length) return;

  try {
    if (dialogMode.value === 'create') {
      await createSupplier(toSupplierPayload('normal'));
      await loadSuppliers();
      pagination.current = 1;
    } else if (editingId.value) {
      const current = tableData.value.find((item) => item.id === editingId.value);
      await updateSupplier(editingId.value, toSupplierPayload(current?.status ?? 'normal'));
      await loadSuppliers();
    }

    closeFormDialog();
    if (dialogMode.value === 'create') {
      adminFeedback.created(formData.name.trim());
    } else {
      adminFeedback.success('已保存供应商');
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openStatusConfirm = (row: SupplierItem) => {
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${isNormal ? '停用' : '启用'}供应商“${row.name}”？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: SupplierItem) => {
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除供应商“${row.name}”？`;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const persistSupplierStatus = async (item: SupplierItem, status: SupplierStatus) => {
  const updated = await updateSupplierStatus(item.id, toBackendStatus(status));
  const targetIndex = tableData.value.findIndex((row) => row.id === item.id);
  if (targetIndex !== -1) {
    tableData.value.splice(targetIndex, 1, toSupplierItem(updated));
  }
};

const handleConfirm = async () => {
  if (!confirmState.row) return;

  const targetName = confirmState.row.name;
  try {
    if (confirmState.type === 'delete') {
      await deleteSupplier(confirmState.row.id);
      tableData.value = tableData.value.filter((item) => item.id !== confirmState.row?.id);
      ensureCurrentPage();
    } else {
      await persistSupplierStatus(confirmState.row, confirmState.type === 'enable' ? 'normal' : 'disabled');
    }

    closeConfirmDialog();
    if (confirmState.type === 'delete') {
      adminFeedback.deleted(targetName);
    } else {
      adminFeedback.actionSuccess({
        action: confirmState.type === 'enable' ? '启用' : '停用',
        target: targetName,
      });
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openSupplyTypeManagement = async () => {
  await loadSupplyTypes();
  supplyTypeManagementVisible.value = true;
};

const openSupplyTypeForm = (row?: SupplierSupplyTypeRecord) => {
  editingSupplyTypeId.value = row?.id ?? null;
  Object.assign(supplyTypeForm, { name: row?.name ?? '' });
  supplyTypeFormVisible.value = true;
};

const closeSupplyTypeForm = () => {
  supplyTypeFormVisible.value = false;
  supplyTypeFormRef.value?.clearValidate();
};

const submitSupplyType = async () => {
  if ((await supplyTypeFormRef.value?.validate()) !== true) return;
  const payload = { name: supplyTypeForm.name.trim() };
  try {
    if (editingSupplyTypeId.value) {
      await updateSupplierSupplyType(editingSupplyTypeId.value, payload);
      adminFeedback.actionSuccess({ action: '保存', target: payload.name });
    } else {
      await createSupplierSupplyType(payload);
      adminFeedback.created(payload.name);
    }
    await loadSupplyTypes();
    closeSupplyTypeForm();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openSupplyTypeDeleteConfirm = (row: SupplierSupplyTypeRecord) => {
  if (row.referenced) {
    adminFeedback.error(`供货类型“${row.name}”已被供应商使用，无法删除`);
    return;
  }
  pendingSupplyTypeDelete.value = row;
  supplyTypeDeleteConfirmVisible.value = true;
};

const closeSupplyTypeDeleteConfirm = () => {
  supplyTypeDeleteConfirmVisible.value = false;
  pendingSupplyTypeDelete.value = null;
};

const confirmSupplyTypeDelete = async () => {
  const row = pendingSupplyTypeDelete.value;
  if (!row) return;
  try {
    await deleteSupplierSupplyType(row.id);
    await loadSupplyTypes();
    closeSupplyTypeDeleteConfirm();
    adminFeedback.deleted(row.name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '删除失败');
  }
};

const toggleSupplyTypeStatus = async (row: SupplierSupplyTypeRecord) => {
  const nextStatus = row.status === 'enabled' ? 'disabled' : 'enabled';
  try {
    await updateSupplierSupplyTypeStatus(row.id, nextStatus);
    await loadSupplyTypes();
    adminFeedback.actionSuccess({ action: nextStatus === 'enabled' ? '启用' : '停用', target: row.name });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(async () => {
  await Promise.all([loadSupplyTypes(), loadSuppliers()]);
});
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
  width: 260px;
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

.toolbar-actions {
  display: flex;
  gap: var(--td-comp-margin-s);
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--td-comp-margin-m);
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
  .filter-row {
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
