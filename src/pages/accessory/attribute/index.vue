<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>基础信息管理</t-breadcrumb-item>
              <t-breadcrumb-item>配件属性管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">全局标准属性库</t-tag>
        </header>

        <t-alert theme="info" closeable>
          属性和值为全平台标准数据：配件分类只引用属性模板；已经被商品使用的标准选项仅支持停用。
        </t-alert>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="56px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="属性" name="name">
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
            <template #controlType="{ row }">
              {{ row.controlType === 'select' ? '枚举 / 下拉' : valueModeLabel(row) }}
            </template>
            <template #attributeCode="{ row }">
              {{ row.code || `ACC_BASE_${row.id}` }}
            </template>
            <template #valueSource="{ row }">
              {{ row.controlType === 'select' ? `标准选项（${row.options.length}）` : valueModeLabel(row) }}
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'normal' ? '正常' : '停用' }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link
                  v-if="row.controlType === 'select'"
                  theme="primary"
                  hover="color"
                  @click="openOptionDialog(row)"
                >
                  选项管理
                </t-link>
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
      header="新增标准属性"
      width="560px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="88px" colon>
        <t-form-item label="属性" name="name" required-mark>
          <t-input v-model="formData.name" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="属性编码" name="code" required-mark>
          <t-input v-model="formData.code" clearable placeholder="如：material / finish" />
        </t-form-item>
        <t-form-item label="控件类型" name="controlType" required-mark>
          <t-radio-group v-model="formData.controlType">
            <t-radio value="input">文本框</t-radio>
            <t-radio value="select">下拉列表</t-radio>
          </t-radio-group>
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
      v-model:visible="optionDialogVisible"
      :header="`${optionTarget?.name ?? ''} · 标准选项`"
      width="640px"
      placement="center"
      :footer="false"
      @close="closeOptionDialog"
    >
      <div class="option-panel">
        <div class="option-toolbar">
          <t-input v-model="optionCodeInput" clearable placeholder="选项编码，如 polished" />
          <t-input v-model="optionInput" clearable placeholder="选项名称，如 亮光" />
          <t-button theme="primary" @click="handleAddOption">
            <template #icon><t-icon name="add" /></template>
            添加
          </t-button>
        </div>

        <t-table row-key="id" :data="optionPageData" :columns="optionColumns" hover table-layout="fixed">
          <template #index="{ rowIndex }">
            {{ (optionPagination.current - 1) * optionPagination.pageSize + rowIndex + 1 }}
          </template>
          <template #status="{ row }">
            <t-tag :theme="row.status === 'normal' ? 'success' : 'default'" variant="light">
              {{ row.status === 'normal' ? '启用' : '停用' }}
            </t-tag>
          </template>
          <template #operation="{ row }">
            <t-link
              :theme="row.status === 'normal' ? 'warning' : 'success'"
              hover="color"
              @click="handleToggleOption(row)"
            >
              {{ row.status === 'normal' ? '停用' : '启用' }}
            </t-link>
          </template>
        </t-table>

        <div class="option-pagination">
          <t-pagination
            v-model:current="optionPagination.current"
            v-model:page-size="optionPagination.pageSize"
            :total="currentOptions.length"
            :page-size-options="optionPageSizeOptions"
            :show-jumper="false"
            @change="handleOptionPaginationChange"
          />
        </div>
      </div>
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmState.type === 'delete' ? '删除' : confirmState.type === 'disable' ? '停用' : '启用'"
      object-type="属性"
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
import type { FormInstanceFunctions, FormRule, PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import { computed, reactive, ref } from 'vue';
type AttributeStatus = 'normal' | 'disabled';
type ControlType = 'input' | 'select';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface OptionItem {
  id: number;
  code: string;
  value: string;
  status: AttributeStatus;
  sort: number;
}

interface AttributeItem {
  id: number;
  name: string;
  code?: string;
  controlType: ControlType;
  status: AttributeStatus;
  createdAt: string;
  remark?: string;
  options: OptionItem[];
}

interface AttributeForm {
  name: string;
  code: string;
  controlType: ControlType;
  remark: string;
}

const createOptions = (values: string[]) =>
  values.map((value, index) => ({
    id: index + 1,
    code: `OPT_${index + 1}`,
    value,
    status: 'normal' as AttributeStatus,
    sort: index + 1,
  }));

const tableData = ref<AttributeItem[]>([
  {
    id: 1,
    name: '品牌',
    controlType: 'select',
    status: 'normal',
    createdAt: '2022/05/30 14:58',
    remark: '配件品牌选项',
    options: createOptions(['装点猫', '国庆奢石家居', '华中石业']),
  },
  {
    id: 2,
    name: '型号',
    controlType: 'input',
    status: 'normal',
    createdAt: '2022/05/30 14:58',
    options: [],
  },
  {
    id: 3,
    name: '尺寸(mm)',
    controlType: 'input',
    status: 'normal',
    createdAt: '2022/05/30 14:58',
    options: [],
  },
  {
    id: 4,
    name: '风格',
    controlType: 'select',
    status: 'disabled',
    createdAt: '2022/05/30 14:58',
    options: createOptions(['现代', '轻奢', '极简']),
  },
  {
    id: 5,
    name: '款式',
    controlType: 'select',
    status: 'normal',
    createdAt: '2022/05/30 14:58',
    options: createOptions(['标准款', '加厚款', '异形款']),
  },
]);

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '属性', minWidth: 160, align: 'left' },
  { colKey: 'attributeCode', title: '属性编码', minWidth: 132, align: 'left' },
  { colKey: 'controlType', title: '控件类型', width: 140, align: 'center' },
  { colKey: 'valueSource', title: '值来源', minWidth: 140, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 280, align: 'left', fixed: 'right' },
];

const optionColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'code', title: '选项编码', minWidth: 130, align: 'left' },
  { colKey: 'value', title: '选项名称', minWidth: 160, align: 'left' },
  { colKey: 'status', title: '状态', width: 96, align: 'center' },
  { colKey: 'sort', title: '排序', width: 80, align: 'center' },
  { colKey: 'operation', title: '操作', width: 96, align: 'left' },
];

const searchForm = reactive({
  name: '',
  status: '',
});
const appliedSearchForm = reactive({ ...searchForm });

const pageSizeOptions = [10, 20, 50];
const optionPageSizeOptions = [
  { label: '20条/页', value: 20 },
  { label: '50条/页', value: 50 },
];

const pagination = reactive({
  current: 1,
  pageSize: 10,
});

const optionPagination = reactive({
  current: 1,
  pageSize: 20,
});

const formRef = ref<FormInstanceFunctions>();
const formDialogVisible = ref(false);
const formData = reactive<AttributeForm>({
  name: '',
  code: '',
  controlType: 'input',
  remark: '',
});

const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入属性', type: 'error' }],
  code: [{ required: true, message: '请输入属性编码', type: 'error' }],
  controlType: [{ required: true, message: '请选择控件类型', type: 'error' }],
  remark: [{ max: 100, message: '备注最多输入100个字符', type: 'error' }],
};

const optionDialogVisible = ref(false);
const optionInput = ref('');
const optionCodeInput = ref('');
const optionTarget = ref<AttributeItem | null>(null);

const confirmDialogVisible = ref(false);
const confirmState = reactive<{
  content: string;
  type: ConfirmType;
  row: AttributeItem | null;
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

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredData.value.slice(start, start + pagination.pageSize);
});
const currentOptions = computed(() => optionTarget.value?.options ?? []);
const optionPageData = computed(() => {
  const start = (optionPagination.current - 1) * optionPagination.pageSize;
  return currentOptions.value.slice(start, start + optionPagination.pageSize);
});

const resetFormData = () => {
  formData.name = '';
  formData.code = '';
  formData.controlType = 'input';
  formData.remark = '';
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

const handleOptionPaginationChange = (pageInfo: PageInfo) => {
  optionPagination.current = pageInfo.current;
  optionPagination.pageSize = pageInfo.pageSize;
};

const openCreateDialog = () => {
  resetFormData();
  formDialogVisible.value = true;
};

const closeFormDialog = () => {
  formDialogVisible.value = false;
  formRef.value?.clearValidate();
};

const handleSubmit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return;

  const nextId = Math.max(...tableData.value.map((item) => item.id), 0) + 1;
  tableData.value.unshift({
    id: nextId,
    name: formData.name.trim(),
    code: formData.code.trim(),
    controlType: formData.controlType,
    status: 'normal',
    createdAt: '2022/05/30 14:58',
    remark: formData.remark.trim(),
    options: [],
  });

  pagination.current = 1;
  closeFormDialog();
  adminFeedback.actionSuccess({ action: '新增', target: formData.name.trim() });
};

const openOptionDialog = (row: AttributeItem) => {
  optionTarget.value = row;
  optionInput.value = '';
  optionCodeInput.value = '';
  optionPagination.current = 1;
  optionPagination.pageSize = 20;
  optionDialogVisible.value = true;
};

const closeOptionDialog = () => {
  optionDialogVisible.value = false;
  optionTarget.value = null;
  optionInput.value = '';
  optionCodeInput.value = '';
};

const handleAddOption = () => {
  const value = optionInput.value.trim();
  const code = optionCodeInput.value.trim();
  if (!value) {
    adminFeedback.warning('请输入选项值');
    return;
  }

  if (!code) {
    adminFeedback.warning('请输入选项编码');
    return;
  }

  if (currentOptions.value.some((item) => item.value === value || item.code === code)) {
    adminFeedback.warning('选项名称或编码已存在');
    return;
  }

  const nextId = Math.max(...currentOptions.value.map((item) => item.id), 0) + 1;
  optionTarget.value?.options.unshift({ id: nextId, code, value, status: 'normal', sort: 1 });
  optionInput.value = '';
  optionCodeInput.value = '';
  optionPagination.current = 1;
  adminFeedback.success('添加成功');
};

const handleToggleOption = (row: OptionItem) => {
  row.status = row.status === 'normal' ? 'disabled' : 'normal';
  adminFeedback.success(row.status === 'normal' ? '已启用标准选项' : '已停用标准选项');
};

const valueModeLabel = (row: AttributeItem) => {
  if (row.name.includes('尺寸') || row.name.includes('厚度')) return '数值 + 单位';
  return '文本输入';
};

const openStatusConfirm = (row: AttributeItem) => {
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${isNormal ? '停用' : '启用'}属性“${row.name}”？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: AttributeItem) => {
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除属性“${row.name}”？`;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const ensureCurrentPage = () => {
  if (pagination.current > pageCount.value) {
    pagination.current = pageCount.value;
  }
};

const handleConfirm = () => {
  if (!confirmState.row) return;

  if (confirmState.type === 'delete') {
    if (confirmState.row.options.length) {
      closeConfirmDialog();
      adminFeedback.warning('属性已有标准选项，不能直接删除；请停用属性或先解除分类模板引用');
      return;
    }
    tableData.value = tableData.value.filter((item) => item.id !== confirmState.row?.id);
    ensureCurrentPage();
  } else {
    confirmState.row.status = confirmState.type === 'enable' ? 'normal' : 'disabled';
  }

  closeConfirmDialog();
  adminFeedback.success(
    confirmState.type === 'delete' ? '已删除属性' : confirmState.type === 'enable' ? '已启用属性' : '已停用属性',
  );
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
  background: var(--td-brand-color);
  color: #fff;
  font-weight: 700;
}

.brand-title {
  font-size: 16px;
  line-height: 24px;
  color: var(--td-text-color-primary);
  font-weight: 600;
}

.brand-subtitle {
  font-size: 12px;
  line-height: 20px;
  color: var(--td-text-color-secondary);
}

.top-actions {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-comp-margin-l);
}

.user-entry {
  display: inline-flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  font-size: 14px;
}

.page {
  flex: 1;
  min-width: 0;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
}

.page-header {
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--td-comp-margin-l);
}

.filter-card,
.table-card {
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.filter-card {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  margin-bottom: var(--td-comp-margin-l);
}

.filter-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}

.filter-fields {
  display: flex;
  align-items: flex-start;
  gap: var(--td-comp-margin-l);
}

.filter-fields :deep(.t-form__item) {
  margin-bottom: 0;
}

.filter-fields :deep(.t-input),
.filter-fields :deep(.t-select) {
  width: 220px;
}

.filter-actions,
.table-toolbar,
.table-actions,
.option-toolbar {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.table-card {
  padding-bottom: var(--td-comp-paddingTB-l);
  overflow: hidden;
}

.table-toolbar {
  justify-content: flex-start;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-border);
}

.table-actions {
  justify-content: flex-start;
  gap: var(--td-comp-margin-m);
}

.option-panel {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-l);
}

.option-toolbar {
  align-items: stretch;
}

.option-toolbar :deep(.t-input) {
  flex: 1;
}
</style>
