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

          <t-table row-key="id" :data="pageData" :columns="columns" hover table-layout="fixed">
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

          <div class="custom-pagination">
            <div class="pagination-total">共 {{ paginationTotal }} 条数据</div>
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
import { computed, reactive, ref } from 'vue';
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

const supplierSeeds = [
  { name: '华南石材源头工厂', type: 'slab' as SupplierType, contact: '李建国', phone: '13821560001' },
  { name: '云山成品加工中心', type: 'finished' as SupplierType, contact: '王晓敏', phone: '13921560002' },
  { name: '东区辅材配件仓', type: 'accessory' as SupplierType, contact: '陈立', phone: '13721560003' },
  { name: '鼎石大板供应链', type: 'slab' as SupplierType, contact: '赵一鸣', phone: '13621560004' },
  { name: '新艺成品定制厂', type: 'finished' as SupplierType, contact: '周可', phone: '13521560005' },
  { name: '精工五金配件行', type: 'accessory' as SupplierType, contact: '孙宁', phone: '13421560006' },
];

const tableData = ref<SupplierItem[]>(
  Array.from({ length: 5 }, (_, index) => {
    const seed = supplierSeeds[index % supplierSeeds.length];
    const current = index + 1;
    return {
      id: current,
      name: `${seed.name}${current.toString().padStart(2, '0')}`,
      type: seed.type,
      contact: seed.contact,
      phone: seed.phone,
      status: index % 7 === 2 ? 'disabled' : 'normal',
      createdAt: `2026/07/${((index % 18) + 1).toString().padStart(2, '0')} ${String(9 + (index % 9)).padStart(2, '0')}:30`,
      remark: '平台自寻供应商',
    };
  }),
);

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

  if (dialogMode.value === 'create') {
    const nextId = Math.max(...tableData.value.map((item) => item.id), 0) + 1;
    tableData.value.unshift({
      id: nextId,
      name: formData.name.trim(),
      type: formData.type,
      contact: formData.contact.trim(),
      phone: formData.phone.trim(),
      status: 'normal',
      createdAt: '2026/07/18 10:00',
      remark: formData.remark.trim(),
    });
    pagination.current = 1;
  } else if (editingId.value) {
    const target = tableData.value.find((item) => item.id === editingId.value);
    if (target) {
      target.name = formData.name.trim();
      target.type = formData.type;
      target.contact = formData.contact.trim();
      target.phone = formData.phone.trim();
      target.remark = formData.remark.trim();
    }
  }

  closeFormDialog();
  MessagePlugin.success('操作成功');
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

const handleConfirm = () => {
  if (!confirmState.row) return;

  if (confirmState.type === 'delete') {
    tableData.value = tableData.value.filter((item) => item.id !== confirmState.row?.id);
    ensureCurrentPage();
  } else {
    confirmState.row.status = confirmState.type === 'enable' ? 'normal' : 'disabled';
  }

  closeConfirmDialog();
  MessagePlugin.success('操作成功');
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
}
</style>
