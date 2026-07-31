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
          <t-tag theme="primary" variant="light">全平台唯一数据源</t-tag>
        </header>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="84px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="供应商名称" name="name">
                  <t-input v-model="searchForm.name" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="供应商类型" name="type">
                  <t-select v-model="searchForm.type" clearable placeholder="请选择">
                    <t-option
                      v-for="item in supplierTypeOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </t-select>
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
            <template #type="{ row }">
              <t-tag :class="['supplier-type-tag', row.type]" variant="light">
                {{ supplierTypeLabel(row.type) }}
              </t-tag>
            </template>
            <template #phone="{ row }">
              {{ maskPhone(row.phone) }}
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'normal' ? '正常' : '停用' }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
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

          <AdminPagination
            v-model:current="pagination.current"
            v-model:page-size="pagination.pageSize"
            :total="paginationTotal"
            :page-size-options="pageSizeOptions"
          />
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
        <t-form-item label="供应商名称" name="name" required-mark>
          <t-input v-model="formData.name" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="供应商类型" name="type" required-mark>
          <t-select v-model="formData.type" clearable placeholder="请选择">
            <t-option v-for="item in supplierTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
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
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { AdminPagination } from '@/components/foundation';
import {
  createSupplier,
  deleteSupplier,
  listSuppliers,
  updateSupplier,
  type SupplierPayload,
  type SupplierRecord,
} from '@/services/suppliers';
import { computed, onMounted, reactive, ref } from 'vue';
type SupplierType = 'slab' | 'finished' | 'accessory';
type SupplierStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface SupplierItem {
  id: number;
  name: string;
  type: SupplierType;
  contact: string;
  phone: string;
  status: SupplierStatus;
  createdAt: string;
  remark?: string;
}

interface SupplierForm {
  name: string;
  type: SupplierType | '';
  contact: string;
  phone: string;
  remark: string;
}

const supplierTypeOptions: { label: string; value: SupplierType }[] = [
  { label: '大板供应商', value: 'slab' },
  { label: '成品供应商', value: 'finished' },
  { label: '配件供应商', value: 'accessory' },
];

const supplierTypeLabel = (type: SupplierType) => supplierTypeOptions.find((item) => item.value === type)?.label ?? '';

const tableData = ref<SupplierItem[]>([]);
const loading = ref(false);

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'name', title: '供应商名称', minWidth: 220, align: 'left' },
  { colKey: 'type', title: '供应商类型', width: 140, align: 'center' },
  { colKey: 'contact', title: '联系人', width: 120, align: 'center' },
  { colKey: 'phone', title: '联系电话', width: 150, align: 'center' },
  { colKey: 'status', title: '状态', width: 100, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 200, align: 'left', fixed: 'right' },
];

const searchForm = reactive({
  name: '',
  type: '' as SupplierType | '',
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
  type: '',
  contact: '',
  phone: '',
  remark: '',
});

const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入供应商名称', type: 'error' }],
  type: [{ required: true, message: '请选择供应商类型', type: 'error' }],
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

const filteredData = computed(() => {
  const name = appliedSearchForm.name.trim();
  return tableData.value.filter((item) => {
    const nameMatched = !name || item.name.includes(name);
    const typeMatched = !appliedSearchForm.type || item.type === appliedSearchForm.type;
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
  type: record.type,
  contact: record.contactName ?? '',
  phone: record.contactPhone ?? '',
  status: normalizeStatus(record.status),
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
});

const toSupplierPayload = (status: SupplierStatus): SupplierPayload => ({
  name: formData.name.trim(),
  type: formData.type as SupplierType,
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
    MessagePlugin.error(error instanceof Error ? error.message : '供应商列表加载失败');
  } finally {
    loading.value = false;
  }
};

const handlePhoneInput = (value: string) => {
  formData.phone = value.replace(/\D/g, '').slice(0, 11);
};

const resetFormData = () => {
  formData.name = '';
  formData.type = '';
  formData.contact = '';
  formData.phone = '';
  formData.remark = '';
};

const fillFormData = (row: SupplierItem) => {
  formData.name = row.name;
  formData.type = row.type;
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
  searchForm.type = '';
  searchForm.status = '';
  pagination.pageSize = 10;
  handleSearch();
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = (row: SupplierItem) => {
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

  if (!formData.type) return;

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
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openStatusConfirm = (row: SupplierItem) => {
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${isNormal ? '停用' : '启用'}供应商【${row.name}】？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: SupplierItem) => {
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除供应商【${row.name}】？`;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const persistSupplierItem = async (item: SupplierItem) => {
  const updated = await updateSupplier(item.id, {
    name: item.name,
    type: item.type,
    contactName: item.contact,
    contactPhone: item.phone,
    qualificationStatus: 'approved',
    status: toBackendStatus(item.status),
    remark: item.remark ?? '',
  });
  const targetIndex = tableData.value.findIndex((row) => row.id === item.id);
  if (targetIndex !== -1) {
    tableData.value.splice(targetIndex, 1, toSupplierItem(updated));
  }
};

const handleConfirm = async () => {
  if (!confirmState.row) return;

  try {
    if (confirmState.type === 'delete') {
      await deleteSupplier(confirmState.row.id);
      tableData.value = tableData.value.filter((item) => item.id !== confirmState.row?.id);
      ensureCurrentPage();
    } else {
      await persistSupplierItem({
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

onMounted(loadSuppliers);
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

.supplier-type-tag.slab {
  color: #0c7a43;
  background: #e8f6ef;
}

.supplier-type-tag.finished {
  color: #ad5a00;
  background: #fff1df;
}

.supplier-type-tag.accessory {
  color: #0052d9;
  background: #e8f2ff;
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
