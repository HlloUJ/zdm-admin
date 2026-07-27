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

    <t-dialog
      v-model:visible="confirmDialogVisible"
      :header="confirmState.title"
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
import type { FormInstanceFunctions, FormRule, PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import { computed, reactive, ref } from 'vue';
type VarietyStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface VarietyItem {
  id: number;
  name: string;
  status: VarietyStatus;
  createdAt: string;
  remark?: string;
}

interface VarietyForm {
  name: string;
  remark: string;
}

const tableData = ref<VarietyItem[]>([
  {
    id: 1,
    name: '粉红佳人',
    status: 'normal',
    createdAt: '2022/05/30 14:58',
    remark: '平台统一大板品种',
  },
  {
    id: 2,
    name: '粉红佳人',
    status: 'normal',
    createdAt: '2022/05/30 14:58',
  },
  {
    id: 3,
    name: '粉红佳人',
    status: 'disabled',
    createdAt: '2022/05/30 14:58',
  },
  {
    id: 4,
    name: '粉红佳人',
    status: 'normal',
    createdAt: '2022/05/30 14:58',
  },
  {
    id: 5,
    name: '粉红佳人',
    status: 'normal',
    createdAt: '2022/05/30 14:58',
  },
]);

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '品种名称', minWidth: 220, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
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
  title: string;
  content: string;
  type: ConfirmType;
  row: VarietyItem | null;
}>({
  title: '',
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

  if (dialogMode.value === 'create') {
    const nextId = Math.max(...tableData.value.map((item) => item.id), 0) + 1;
    tableData.value.unshift({
      id: nextId,
      name: formData.name.trim(),
      status: 'normal',
      createdAt: '2022/05/30 14:58',
      remark: formData.remark.trim(),
    });
    pagination.current = 1;
  } else if (editingId.value) {
    const target = tableData.value.find((item) => item.id === editingId.value);
    if (target) {
      target.name = formData.name.trim();
      target.remark = formData.remark.trim();
    }
  }

  closeFormDialog();
  MessagePlugin.success('操作成功');
};

const openStatusConfirm = (row: VarietyItem) => {
  const isNormal = row.status === 'normal';
  confirmState.title = isNormal ? '确认停用' : '确认启用';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${isNormal ? '停用' : '启用'}品种【${row.name}】？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: VarietyItem) => {
  confirmState.title = '确认删除';
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除品种【${row.name}】？`;
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
