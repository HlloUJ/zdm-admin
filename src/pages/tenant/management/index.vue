<template>
  <div class="admin-layout">
    <header class="top-nav">
      <div class="brand">
        <div class="brand-logo">装</div>
        <div>
          <div class="brand-title">装点猫</div>
          <div class="brand-subtitle">管理后台</div>
        </div>
      </div>

      <div class="top-actions">
        <t-button shape="square" variant="text" aria-label="消息通知">
          <t-icon name="notification" />
        </t-button>
        <div class="user-entry">
          <t-avatar size="small">超</t-avatar>
          <span>超级管理员</span>
        </div>
      </div>
    </header>

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>租户管理</t-breadcrumb-item>
              <t-breadcrumb-item>租户管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">权限驱动业务入口</t-tag>
        </header>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="84px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="租户姓名" name="tenantName">
                  <t-input v-model="searchForm.tenantName" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="联系方式" name="phone">
                  <t-input v-model="searchForm.phone" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="状态" name="status">
                  <t-select v-model="searchForm.status" clearable placeholder="请选择">
                    <t-option label="正常" value="normal" />
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
            <t-button theme="primary" @click="openCreateDialog">
              <template #icon><t-icon name="add" /></template>
              新增
            </t-button>
          </div>

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
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'normal' ? '正常' : '停用' }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link theme="primary" hover="color" @click="openBusinessDialog(row)">业务开通</t-link>
                <t-link theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                <t-link
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openStatusConfirm(row)"
                >
                  {{ row.status === 'normal' ? '停用' : '启用' }}
                </t-link>
                <t-link theme="danger" hover="color" @click="openDeleteConfirm(row)">删除</t-link>
              </div>
            </template>
          </t-table>

          <div class="custom-pagination">
            <div class="pagination-total">共 {{ paginationTotal }} 项数据</div>
            <div class="pagination-controls">
              <t-select
                :model-value="pagination.pageSize"
                class="page-size-select"
                size="small"
                @change="handlePageSizeChange"
              >
                <t-option v-for="item in pageSizeOptions" :key="item" :label="`${item}条/页`" :value="item" />
              </t-select>
              <t-button size="small" variant="outline" :disabled="pagination.current === 1" @click="goPrevPage"
                >上一页</t-button
              >
              <t-button
                v-for="pageNumber in pageNumbers"
                :key="pageNumber"
                size="small"
                :theme="pageNumber === pagination.current ? 'primary' : 'default'"
                :variant="pageNumber === pagination.current ? 'base' : 'outline'"
                class="page-number"
                @click="goPage(pageNumber)"
              >
                {{ pageNumber }}
              </t-button>
              <t-button size="small" variant="outline" :disabled="pagination.current === pageCount" @click="goNextPage"
                >下一页</t-button
              >
            </div>
          </div>
        </section>
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

    <t-dialog
      v-model:visible="confirmDialogVisible"
      header="系统提示"
      width="420px"
      placement="center"
      confirm-btn="确认"
      cancel-btn="取消"
      @confirm="handleConfirm"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmState.content }}
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import {
  createTenant,
  deleteTenant,
  listTenants,
  updateTenant,
  type TenantPayload,
  type TenantRecord,
} from '@/services/tenants';

type BusinessType = 'cityPartner' | 'slabSupplier' | 'finishedSupplier' | 'factory';
type TenantStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface TenantItem {
  id: number;
  tenantName: string;
  phone: string;
  businesses: BusinessType[];
  status: TenantStatus;
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

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'tenantName', title: '租户姓名', minWidth: 150, align: 'left' },
  { colKey: 'phone', title: '联系方式', width: 150, align: 'center' },
  { colKey: 'businesses', title: '开通业务', minWidth: 260, align: 'left' },
  { colKey: 'status', title: '状态', width: 100, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 280, align: 'left', fixed: 'right' },
];

const searchForm = reactive({
  tenantName: '',
  phone: '',
  status: '' as TenantStatus | '',
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
  type: 'disable',
  row: null,
});

const filteredData = computed(() => {
  const tenantName = appliedSearchForm.tenantName.trim();
  const phone = appliedSearchForm.phone.trim();
  return tableData.value.filter((item) => {
    const nameMatched = !tenantName || item.tenantName.includes(tenantName);
    const phoneMatched = !phone || item.phone.includes(phone);
    const statusMatched = !appliedSearchForm.status || item.status === appliedSearchForm.status;
    return nameMatched && phoneMatched && statusMatched;
  });
});

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageNumbers = computed(() => {
  const maxVisible = 5;
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(pagination.current - half, 1);
  const end = Math.min(start + maxVisible - 1, pageCount.value);
  start = Math.max(end - maxVisible + 1, 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});
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
    tableData.value = records.map(toTenantItem);
    ensureCurrentPage();
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '租户列表加载失败');
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
  searchForm.status = '';
  pagination.pageSize = 10;
  handleSearch();
};

const handlePageSizeChange = (value: unknown) => {
  pagination.pageSize = Number(value);
  pagination.current = 1;
};

const goPage = (pageNumber: number) => {
  pagination.current = pageNumber;
};

const goPrevPage = () => {
  if (pagination.current > 1) pagination.current -= 1;
};

const goNextPage = () => {
  if (pagination.current < pageCount.value) pagination.current += 1;
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = (row: TenantItem) => {
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
      await createTenant(toTenantPayload('normal'));
      await loadTenants();
      pagination.current = 1;
    } else if (editingId.value) {
      const current = tableData.value.find((item) => item.id === editingId.value);
      await updateTenant(editingId.value, toTenantPayload(current?.status ?? 'normal', current?.businesses));
      await loadTenants();
    }

    closeFormDialog();
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};

const persistTenantItem = async (item: TenantItem) => {
  const updated = await updateTenant(item.id, {
    name: item.tenantName,
    contactName: item.tenantName,
    contactPhone: item.phone,
    status: toBackendStatus(item.status),
    businessTypes: item.businesses.join(','),
    remark: item.remark ?? '',
  });
  const targetIndex = tableData.value.findIndex((row) => row.id === item.id);
  if (targetIndex !== -1) {
    tableData.value.splice(targetIndex, 1, toTenantItem(updated));
  }
};

const handleBusinessSubmit = async () => {
  const target = tableData.value.find((item) => item.id === businessEditingId.value);
  if (!target) return;

  try {
    await persistTenantItem({ ...target, businesses: [...businessSelection.value] });
    closeBusinessDialog();
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openStatusConfirm = (row: TenantItem) => {
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${isNormal ? '停用' : '启用'}租户【${row.tenantName}】？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: TenantItem) => {
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除租户【${row.tenantName}】？`;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const handleConfirm = async () => {
  if (!confirmState.row) return;

  try {
    if (confirmState.type === 'delete') {
      await deleteTenant(confirmState.row.id);
      tableData.value = tableData.value.filter((item) => item.id !== confirmState.row?.id);
      ensureCurrentPage();
    } else {
      await persistTenantItem({
        ...confirmState.row,
        status: confirmState.type === 'enable' ? 'normal' : 'disabled',
      });
    }

    closeConfirmDialog();
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(loadTenants);

const openBusinessDialog = (row: TenantItem) => {
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

.custom-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-top: var(--td-comp-margin-l);
}

.pagination-total {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.pagination-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s);
}

.page-size-select {
  width: 112px;
}

.page-number {
  min-width: 32px;
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

  .page-header,
  .filter-row,
  .custom-pagination {
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
