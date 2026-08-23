<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <AdminPageHeader :breadcrumbs="['租户与门店', '租户管理']" badge="权限驱动业务入口" />

        <AdminListLayout class="tenant-list-layout">
          <template #toolbar>
            <div class="list-controls">
              <t-tabs v-if="showTenantTabRail" v-model="activeTab" :list="tenantTabs" />
              <t-form :data="searchForm" label-width="84px" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <t-form-item label="租户姓名" name="tenantName">
                      <t-input v-model="searchForm.tenantName" clearable placeholder="请输入" />
                    </t-form-item>
                    <t-form-item label="联系方式" name="phone">
                      <t-input v-model="searchForm.phone" clearable placeholder="请输入" />
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
              <div v-if="activeTab === 'unarchived' && canCreateTenant" class="table-toolbar">
                <t-button theme="primary" @click="openCreateDialog">
                  <template #icon><t-icon name="add" /></template>
                  新增
                </t-button>
              </div>
            </div>
          </template>

          <template #table>
            <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
              <template #index="{ rowIndex }">
                {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
              </template>
              <template #phone="{ row }">
                {{ maskPhone(row.phone) }}
              </template>
              <template #businesses="{ row }">
                <div class="business-tags">
                  <t-tag
                    v-for="business in row.businesses"
                    :key="business"
                    :class="['business-tag', business]"
                    variant="light"
                  >
                    {{ businessLabel(business) }}
                  </t-tag>
                  <span v-if="!row.businesses.length" class="empty-business">未开通</span>
                </div>
              </template>
              <template #operation="{ row }">
                <div v-if="activeTab === 'unarchived'" class="table-actions">
                  <t-link v-if="canOpenTenantBusiness" theme="primary" hover="color" @click="openBusinessDialog(row)">
                    业务开通
                  </t-link>
                  <t-link v-if="canEditTenant" theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                  <t-link v-if="canArchiveTenant" theme="warning" hover="color" @click="openStatusConfirm(row)">
                    归档
                  </t-link>
                </div>
                <div v-else class="table-actions">
                  <t-link v-if="canRestoreTenant" theme="success" hover="color" @click="openStatusConfirm(row)">
                    恢复运营
                  </t-link>
                  <t-link v-if="canDeleteTenant" theme="danger" hover="color" @click="openPurgeDialog(row)">
                    彻底删除
                  </t-link>
                </div>
              </template>
            </t-table>
          </template>

          <template #pagination>
            <AdminPagination
              v-model:current="pagination.current"
              v-model:page-size="pagination.pageSize"
              :total="paginationTotal"
              :page-size-options="pageSizeOptions"
            />
          </template>
        </AdminListLayout>
      </main>
    </div>

    <t-dialog
      v-model:visible="formDialogVisible"
      :header="dialogMode === 'create' ? '新增' : '编辑'"
      width="560px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item label="租户姓名" name="tenantName" required-mark>
          <t-input v-model="formData.tenantName" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="联系方式" name="phone" required-mark>
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
    </t-dialog>

    <t-dialog
      v-model:visible="businessDialogVisible"
      header="业务开通"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleBusinessSubmit"
      @cancel="closeBusinessDialog"
      @close="closeBusinessDialog"
    >
      <div class="business-options">
        <t-button
          v-for="item in businessOptions"
          :key="item.value"
          :theme="businessSelection.includes(item.value) ? 'primary' : 'default'"
          :variant="businessSelection.includes(item.value) ? 'base' : 'outline'"
          class="business-option-button"
          @click="toggleBusiness(item.value)"
        >
          {{ item.label }}
        </t-button>
      </div>
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmState.type === 'archive' ? '归档' : '恢复运营'"
      object-type="租户"
      :object-name="confirmState.row?.tenantName"
      @confirm="handleConfirm"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmState.content }}
    </AdminConfirmDialog>

    <AdminDialog
      v-model:visible="purgeDialogVisible"
      header="彻底删除租户"
      width="560px"
      :confirm-btn="purgeConfirmButton"
      @confirm="handlePurge"
      @cancel="closePurgeDialog"
      @close="closePurgeDialog"
    >
      <t-alert theme="error" message="彻底删除后，租户及其独占业务数据无法恢复。请输入租户名称确认删除。" />
      <t-descriptions v-if="purgePreview" class="purge-summary" bordered :column="2">
        <t-descriptions-item label="租户名称" :span="2">{{ purgePreview.tenantName }}</t-descriptions-item>
        <t-descriptions-item label="门店">{{ purgePreview.storeCount }}</t-descriptions-item>
        <t-descriptions-item label="员工">{{ purgePreview.employeeCount }}</t-descriptions-item>
        <t-descriptions-item label="角色">{{ purgePreview.roleCount }}</t-descriptions-item>
        <t-descriptions-item label="删除独立账号">{{ purgePreview.accountDeleteCount }}</t-descriptions-item>
        <t-descriptions-item label="保留共享账号">{{ purgePreview.accountRetainCount }}</t-descriptions-item>
      </t-descriptions>
      <t-alert
        v-for="blocker in purgePreview?.blockers ?? []"
        :key="blocker"
        class="purge-blocker"
        theme="warning"
        :message="blocker"
      />
      <t-form class="purge-confirm-form" label-width="96px" colon>
        <t-form-item label="租户名称" required-mark>
          <t-input v-model="purgeConfirmationName" placeholder="请输入完整租户名称" />
        </t-form-item>
      </t-form>
    </AdminDialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPageHeader,
  AdminPagination,
} from '@/components/foundation';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import { requireCreatorOwnership } from '@/composables/useCreatorOwnershipGuard';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import {
  createTenant,
  getTenantPurgePreview,
  listTenants,
  purgeTenant,
  updateTenant,
  updateTenantBusinesses,
  updateTenantStatus,
  type TenantPayload,
  type TenantPurgePreview,
  type TenantRecord,
} from '@/services/tenants';

type BusinessType = 'cityPartner' | 'slabSupplier' | 'finishedSupplier' | 'factory';
type TenantStatus = 'normal' | 'disabled';
type TenantTab = 'unarchived' | 'archived';
type ConfirmType = 'archive' | 'restore';

interface TenantItem {
  id: number;
  tenantName: string;
  phone: string;
  businesses: BusinessType[];
  status: TenantStatus;
  createdByName: string;
  createdByAccountId?: number | null;
  createdAt: string;
  remark?: string;
}

interface TenantForm {
  tenantName: string;
  phone: string;
  remark: string;
}

const businessOptions: { label: string; value: BusinessType }[] = [
  { label: '城市合伙人', value: 'cityPartner' },
  { label: '大板供应商', value: 'slabSupplier' },
  { label: '成品供应商', value: 'finishedSupplier' },
  { label: '工厂', value: 'factory' },
];

const businessLabel = (type: BusinessType) => businessOptions.find((item) => item.value === type)?.label ?? '';

const tableData = ref<TenantItem[]>([]);
const loading = ref(false);
const currentUser = getLoginUser();
const permissionPrefix = 'admin.tenant.tenant-management';
const activeTab = ref<TenantTab>('unarchived');
const allTenantTabs: { label: string; value: TenantTab }[] = [
  { label: '运营中', value: 'unarchived' },
  { label: '已归档', value: 'archived' },
];
const { visibleTabs: tenantTabs, showTabRail: showTenantTabRail } = usePermissionTabs({
  tabs: allTenantTabs,
  activeTab,
  canAccess: (tab) => hasPermission(currentUser, `${permissionPrefix}.${tab.value}.view`),
});
const hasTenantAction = (scope: TenantTab, action: string) =>
  hasPermission(currentUser, `${permissionPrefix}.${scope}.${action}`);
const canCreateTenant = computed(() => hasTenantAction('unarchived', 'create'));
const canOpenTenantBusiness = computed(() => hasTenantAction('unarchived', 'open-business'));
const canEditTenant = computed(() => hasTenantAction('unarchived', 'edit'));
const canArchiveTenant = computed(() => hasTenantAction('unarchived', 'archive'));
const canRestoreTenant = computed(() => hasTenantAction('archived', 'restore'));
const canDeleteTenant = computed(() => hasTenantAction('archived', 'delete'));

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'tenantName', title: '租户姓名', minWidth: 150, align: 'left' },
  { colKey: 'phone', title: '联系方式', width: 150, align: 'center' },
  { colKey: 'businesses', title: '开通业务', minWidth: 260, align: 'left' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 280, align: 'left', fixed: 'right' },
];

const searchForm = reactive({
  tenantName: '',
  phone: '',
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
const formData = reactive<TenantForm>({
  tenantName: '',
  phone: '',
  remark: '',
});

const formRules: Record<string, FormRule[]> = {
  tenantName: [{ required: true, message: '请输入租户姓名', type: 'error' }],
  phone: [
    { required: true, message: '请输入联系方式', type: 'error' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入合法的11位手机号', type: 'error' },
  ],
  remark: [{ max: 100, message: '备注最多可输入100个汉字', type: 'error' }],
};

const businessDialogVisible = ref(false);
const businessEditingId = ref<number | null>(null);
const businessSelection = ref<BusinessType[]>([]);

const confirmDialogVisible = ref(false);
const confirmState = reactive<{
  content: string;
  type: ConfirmType;
  row: TenantItem | null;
}>({
  content: '',
  type: 'archive',
  row: null,
});

const purgeDialogVisible = ref(false);
const purgeTarget = ref<TenantItem | null>(null);
const purgePreview = ref<TenantPurgePreview | null>(null);
const purgeConfirmationName = ref('');
const purgeSubmitting = ref(false);
const purgeConfirmButton = computed(() => ({
  content: '确认彻底删除',
  theme: 'danger' as const,
  loading: purgeSubmitting.value,
  disabled: !purgePreview.value?.eligible || purgeConfirmationName.value !== purgePreview.value.tenantName,
}));

const filteredData = computed(() => {
  const tenantName = appliedSearchForm.tenantName.trim();
  const phone = appliedSearchForm.phone.trim();
  return tableData.value.filter((item) => {
    const nameMatched = !tenantName || item.tenantName.includes(tenantName);
    const phoneMatched = !phone || item.phone.includes(phone);
    const tabMatched = activeTab.value === 'archived' ? item.status === 'disabled' : item.status === 'normal';
    return nameMatched && phoneMatched && tabMatched;
  });
});

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredData.value.slice(start, start + pagination.pageSize);
});

const maskPhone = (phone: string) => phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');

const parseBusinessTypes = (value?: string): BusinessType[] =>
  (value?.split(',').filter(Boolean) as BusinessType[] | undefined) ?? [];

const normalizeStatus = (status: TenantRecord['status']): TenantStatus =>
  status === 'disabled' ? 'disabled' : 'normal';

const toBackendStatus = (status: TenantStatus): TenantPayload['status'] =>
  status === 'disabled' ? 'disabled' : 'enabled';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toTenantItem = (record: TenantRecord): TenantItem => ({
  id: record.id,
  tenantName: record.name,
  phone: record.contactPhone,
  businesses: parseBusinessTypes(record.businessTypes),
  status: normalizeStatus(record.status),
  createdByName: record.createdByName?.trim() || '-',
  createdByAccountId: record.createdByAccountId,
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
});

const toTenantPayload = (status: TenantStatus, businesses: BusinessType[] = []): TenantPayload => ({
  name: formData.tenantName.trim(),
  contactName: formData.tenantName.trim(),
  contactPhone: formData.phone.trim(),
  status: toBackendStatus(status),
  businessTypes: businesses.join(','),
  remark: formData.remark.trim(),
});

const loadTenants = async () => {
  loading.value = true;
  try {
    const records = await listTenants();
    tableData.value = sortByCreatedAtDesc(records).map(toTenantItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '租户列表加载失败');
  } finally {
    loading.value = false;
  }
};

const handlePhoneInput = (value: string) => {
  formData.phone = value.replace(/\D/g, '').slice(0, 11);
};

const resetFormData = () => {
  formData.tenantName = '';
  formData.phone = '';
  formData.remark = '';
};

const fillFormData = (row: TenantItem) => {
  formData.tenantName = row.tenantName;
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
  searchForm.tenantName = '';
  searchForm.phone = '';
  pagination.pageSize = 10;
  handleSearch();
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = (row: TenantItem) => {
  if (!requireCreatorOwnership(row)) return;
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

  const targetName = formData.tenantName.trim();
  const action = dialogMode.value === 'create' ? '新增' : '保存';
  try {
    if (dialogMode.value === 'create') {
      await createTenant(toTenantPayload('normal'));
      await loadTenants();
      pagination.current = 1;
    } else if (editingId.value) {
      const current = tableData.value.find((item) => item.id === editingId.value);
      await updateTenant(editingId.value, toTenantPayload(current?.status ?? 'normal', current?.businesses));
      await loadTenants();
    }

    closeFormDialog();
    if (dialogMode.value === 'create') {
      adminFeedback.created(targetName);
    } else {
      adminFeedback.actionSuccess({ action, target: targetName });
    }
  } catch (error) {
    adminFeedback.actionError({ action, target: targetName, error });
  }
};

const replaceTenantItem = (updated: TenantRecord) => {
  const targetIndex = tableData.value.findIndex((row) => row.id === updated.id);
  if (targetIndex !== -1) {
    tableData.value.splice(targetIndex, 1, toTenantItem(updated));
  }
};

const handleBusinessSubmit = async () => {
  const target = tableData.value.find((item) => item.id === businessEditingId.value);
  if (!target) return;
  const businessNames = businessSelection.value.map(businessLabel).filter(Boolean).join('、');

  try {
    const updated = await updateTenantBusinesses(target.id, businessSelection.value.join(','));
    replaceTenantItem(updated);
    closeBusinessDialog();
    adminFeedback.actionSuccess({ action: '开通', target: businessNames });
  } catch (error) {
    adminFeedback.actionError({ action: '开通', target: businessNames, error });
  }
};

const openStatusConfirm = (row: TenantItem) => {
  if (!requireCreatorOwnership(row)) return;
  const isUnarchived = row.status === 'normal';
  confirmState.type = isUnarchived ? 'archive' : 'restore';
  confirmState.row = row;
  confirmState.content = isUnarchived
    ? '归档后，该租户及其全部门店人员将立即无法登录，现有业务数据将保持不变。恢复租户后可继续使用。'
    : '恢复后，状态正常的门店和员工可重新登录并继续原有工作。原本已停用或归档的数据状态不会改变。';
  confirmDialogVisible.value = true;
};

const openPurgeDialog = async (row: TenantItem) => {
  if (!requireCreatorOwnership(row)) return;
  purgeTarget.value = row;
  purgePreview.value = null;
  purgeConfirmationName.value = '';
  try {
    purgePreview.value = await getTenantPurgePreview(row.id);
    purgeDialogVisible.value = true;
  } catch (error) {
    purgeTarget.value = null;
    adminFeedback.actionError({ action: '加载删除预检', target: row.tenantName, error });
  }
};

const closePurgeDialog = () => {
  if (purgeSubmitting.value) return;
  purgeDialogVisible.value = false;
  purgeTarget.value = null;
  purgePreview.value = null;
  purgeConfirmationName.value = '';
};

const handlePurge = async () => {
  const target = purgeTarget.value;
  if (!target || !purgePreview.value?.eligible || purgeConfirmationName.value !== target.tenantName) return;
  purgeSubmitting.value = true;
  try {
    await purgeTenant(target.id, purgeConfirmationName.value);
    tableData.value = tableData.value.filter((item) => item.id !== target.id);
    ensureCurrentPage();
    purgeSubmitting.value = false;
    closePurgeDialog();
    adminFeedback.actionSuccess({ action: '彻底删除', target: target.tenantName });
  } catch (error) {
    purgeSubmitting.value = false;
    adminFeedback.actionError({ action: '彻底删除', target: target.tenantName, error });
  }
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const handleConfirm = async () => {
  if (!confirmState.row) return;
  const target = confirmState.row;
  const action = confirmState.type === 'restore' ? '恢复运营' : '归档';

  try {
    const updated = await updateTenantStatus(target.id, confirmState.type === 'restore' ? 'enabled' : 'disabled');
    replaceTenantItem(updated);

    closeConfirmDialog();
    adminFeedback.actionSuccess({ action, target: target.tenantName });
  } catch (error) {
    adminFeedback.actionError({ action, target: target.tenantName, error });
  }
};

watch(activeTab, () => {
  pagination.current = 1;
});

onMounted(loadTenants);

const openBusinessDialog = (row: TenantItem) => {
  if (!requireCreatorOwnership(row)) return;
  businessEditingId.value = row.id;
  businessSelection.value = [...row.businesses];
  businessDialogVisible.value = true;
};

const closeBusinessDialog = () => {
  businessDialogVisible.value = false;
  businessEditingId.value = null;
  businessSelection.value = [];
};

const toggleBusiness = (business: BusinessType) => {
  if (businessSelection.value.includes(business)) {
    businessSelection.value = businessSelection.value.filter((item) => item !== business);
  } else {
    businessSelection.value = [...businessSelection.value, business];
  }
};
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

.tenant-list-layout {
  min-width: 0;
}

.tenant-list-layout :deep(.zdm-admin-list-layout__filters),
.tenant-list-layout :deep(.zdm-admin-list-layout__content) {
  min-width: 0;
}

.list-controls {
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-l);
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

.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}

.table-toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
}

.business-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-comp-margin-xs);
}

.business-tag.cityPartner {
  color: #0052d9;
  background: #e8f2ff;
}

.business-tag.slabSupplier {
  color: #0c7a43;
  background: #e8f6ef;
}

.business-tag.finishedSupplier {
  color: #ad5a00;
  background: #fff1df;
}

.business-tag.factory {
  color: #c9353f;
  background: #fff0f1;
}

.empty-business {
  color: var(--td-text-color-placeholder);
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--td-comp-margin-m);
  white-space: nowrap;
}

.business-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--td-comp-margin-m);
  padding: var(--td-comp-paddingTB-s) 0;
}

.business-option-button {
  width: 100%;
}

.purge-summary,
.purge-blocker,
.purge-confirm-form {
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

  .page {
    padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  }

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

  .business-options {
    grid-template-columns: 1fr;
  }
}
</style>
