<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <section class="content-card">
          <t-alert theme="info" closeable>
            属性和值为全平台标准数据：分类只引用属性模板；已被商品或 SKU 使用的属性值只能停用，不能直接删除。
          </t-alert>
          <t-tabs v-model="activeTab" class="attribute-tabs" :list="tabList" @change="handleTabChange" />

          <section class="filter-card">
            <t-form
              class="zdm-admin-filter-form zdm-standard-query"
              label-width="80px"
              :data="currentState.searchForm"
              colon
            >
              <div class="filter-row">
                <div class="filter-fields">
                  <t-form-item label="属性" name="name">
                    <t-input v-model="currentState.searchForm.name" clearable placeholder="请输入属性" />
                  </t-form-item>
                  <t-form-item class="zdm-status-filter" label="状态" name="status">
                    <t-select v-model="currentState.searchForm.status" clearable placeholder="请选择状态">
                      <t-option label="正常" value="normal" />
                      <t-option label="停用" value="disabled" />
                    </t-select>
                  </t-form-item>
                </div>

                <div class="filter-actions">
                  <t-button :theme="buttonTheme('search')" @click="handleSearch">
                    <template #icon><t-icon name="search" /></template>
                    查询
                  </t-button>
                  <t-button :theme="buttonTheme('reset')" variant="base" @click="handleReset">
                    <template #icon><t-icon name="refresh" /></template>
                    重置
                  </t-button>
                </div>
              </div>
            </t-form>
          </section>

          <section class="table-card">
            <AdminListToolbar :has-actions="true"
              ><t-button :theme="buttonTheme('create')" @click="openCreateDialog">
                <template #icon><t-icon name="add" /></template>
                新增
              </t-button></AdminListToolbar
            >

            <t-table row-key="id" :data="pageData" :columns="columns" hover table-layout="fixed">
              <template #index="{ rowIndex }">
                {{ (currentState.pagination.current - 1) * currentState.pagination.pageSize + rowIndex + 1 }}
              </template>
              <template #controlType="{ row }">
                {{ row.controlType === 'select' ? '枚举 / 下拉' : valueModeLabel(row) }}
              </template>
              <template #attributeRole="{ row }">
                <t-tag :theme="attributeRoleTheme(row)" variant="light">{{ attributeRoleLabel(row) }}</t-tag>
              </template>
              <template #attributeCode="{ row }">
                {{ row.code || `${activeTab === 'goods' ? 'FS_BASE' : 'FS_SALE'}_${row.id}` }}
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
                    :theme="buttonTheme('options')"
                    hover="color"
                    @click="openOptionDialog(row)"
                  >
                    选项管理
                  </t-link>
                  <t-link
                    :theme="buttonTheme(row.status === 'normal' ? 'disable' : 'enable')"
                    hover="color"
                    @click="openStatusConfirm(row)"
                  >
                    {{ row.status === 'normal' ? '停用' : '启用' }}
                  </t-link>
                  <t-link :theme="buttonTheme('delete')" hover="color" @click="openDeleteConfirm(row)">删除</t-link>
                </div>
              </template>
            </t-table>

            <AdminPagination
              v-model:current="currentState.pagination.current"
              v-model:page-size="currentState.pagination.pageSize"
              :total="paginationTotal"
              :page-size-options="pageSizeOptions"
            />
          </section>
        </section>
      </main>
    </div>

    <t-dialog
      v-model:visible="formDialogVisible"
      dialog-class-name="zdm-admin-dialog zdm-admin-single-form"
      :header="`新增${activeTab === 'goods' ? '商品属性' : '销售属性'}`"
      width="480px"
      placement="center"
      :confirm-btn="dialogButtonProps('submit', formConfirmation('create'))"
      :cancel-btn="cancelButtonProps('取消')"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="100px" colon>
        <t-form-item label="属性" name="name" required-mark>
          <t-input v-model="formData.name" clearable placeholder="请输入属性" />
        </t-form-item>
        <t-form-item help="如：material / size" label="属性编码" name="code" required-mark>
          <t-input v-model="formData.code" clearable placeholder="请输入属性编码" />
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
            placeholder="请输入备注"
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
        <div ref="optionFormRoot" class="option-toolbar">
          <t-input
            v-model="optionCodeInput"
            :status="optionFeedback.field('code', optionCodeInput).status"
            :tips="optionFeedback.field('code', optionCodeInput).tips || '选项编码，如 polished'"
            clearable
            placeholder="请输入选项编码"
          />
          <t-input
            v-model="optionInput"
            :status="optionFeedback.field('value', optionInput).status"
            :tips="optionFeedback.field('value', optionInput).tips || '选项名称，如 亮光'"
            clearable
            placeholder="请输入选项名称"
          />
          <t-button :theme="buttonTheme('create')" @click="handleAddOption">
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
              :theme="buttonTheme(row.status === 'normal' ? 'disable' : 'enable')"
              hover="color"
              @click="handleToggleOption(row)"
            >
              {{ row.status === 'normal' ? '停用' : '启用' }}
            </t-link>
          </template>
        </t-table>

        <AdminPagination
          v-model:current="optionPagination.current"
          v-model:page-size="optionPagination.pageSize"
          :total="currentOptions.length"
          :page-size-options="optionPageSizeOptions"
        />
      </div>
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :function="buttonFunctionFor('status', confirmState.type)"
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
import { formConfirmation, dialogButtonProps } from '@/components/foundation/actions/confirmation';
import { buttonTheme, buttonFunctionFor, cancelButtonProps } from '@/components/foundation/actions/buttonFunctions';
import { rejectFormSubmission } from '@/utils/submitValidation';
import { useFormFeedback } from '@/utils/formValidation';
import AdminListToolbar from '@/components/foundation/AdminListToolbar.vue';
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import { computed, reactive, ref } from 'vue';
type TabKey = 'goods' | 'sales';
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

interface TabState {
  searchForm: {
    name: string;
    status: '' | AttributeStatus;
  };
  pagination: {
    current: number;
    pageSize: number;
  };
  tableData: AttributeItem[];
}

const tabList = [
  { label: '商品属性', value: 'goods' },
  { label: '销售属性', value: 'sales' },
];

const pageSizeOptions = [10, 20, 50];
const optionPageSizeOptions = [20, 50];
const activeTab = ref<TabKey>('goods');

const createOptions = (values: string[]) =>
  values.map((value, index) => ({
    id: index + 1,
    code: `OPT_${index + 1}`,
    value,
    status: 'normal' as AttributeStatus,
    sort: index + 1,
  }));

const tabsState = reactive<Record<TabKey, TabState>>({
  goods: {
    searchForm: {
      name: '',
      status: '',
    },
    pagination: {
      current: 1,
      pageSize: 10,
    },
    tableData: [
      {
        id: 1,
        name: '品牌',
        controlType: 'select',
        status: 'normal',
        createdAt: '2022/05/30 14:58',
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
        status: 'disabled',
        createdAt: '2022/05/30 14:58',
        options: [],
      },
      {
        id: 4,
        name: '风格',
        controlType: 'select',
        status: 'normal',
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
    ],
  },
  sales: {
    searchForm: {
      name: '',
      status: '',
    },
    pagination: {
      current: 1,
      pageSize: 10,
    },
    tableData: [
      {
        id: 1,
        name: '价格',
        controlType: 'input',
        status: 'normal',
        createdAt: '2022/05/30 14:58',
        options: [],
      },
      {
        id: 2,
        name: '数量',
        controlType: 'input',
        status: 'normal',
        createdAt: '2022/05/30 14:58',
        options: [],
      },
      {
        id: 3,
        name: '桌子形状',
        controlType: 'input',
        status: 'disabled',
        createdAt: '2022/05/30 14:58',
        options: [],
      },
      {
        id: 4,
        name: '颜色分类',
        controlType: 'select',
        status: 'normal',
        createdAt: '2022/05/30 14:58',
        options: createOptions(['白色', '灰色', '黑色']),
      },
      {
        id: 5,
        name: '尺寸',
        controlType: 'select',
        status: 'normal',
        createdAt: '2022/05/30 14:58',
        options: createOptions(['小号', '中号', '大号']),
      },
    ],
  },
});
const appliedSearchForms = reactive<Record<TabKey, TabState['searchForm']>>({
  goods: { ...tabsState.goods.searchForm },
  sales: { ...tabsState.sales.searchForm },
});

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '属性', minWidth: 140, align: 'left' },
  { colKey: 'attributeCode', title: '属性编码', minWidth: 132, align: 'left' },
  { colKey: 'attributeRole', title: '属性角色', width: 110, align: 'center' },
  { colKey: 'controlType', title: '控件类型', width: 140, align: 'center' },
  { colKey: 'valueSource', title: '值来源', minWidth: 140, align: 'left' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  {
    colKey: 'operation',
    title: '操作',
    width: 184,
    align: 'left',
    fixed: 'right',
  },
]);

const optionColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'code', title: '选项编码', minWidth: 130, align: 'left' },
  { colKey: 'value', title: '选项名称', minWidth: 160, align: 'left' },
  { colKey: 'status', title: '状态', width: 96, align: 'center' },
  { colKey: 'sort', title: '排序', width: 80, align: 'center' },
  { colKey: 'operation', title: '操作', width: 76, align: 'left' },
];

const currentState = computed(() => tabsState[activeTab.value]);
const filteredData = computed(() => {
  const appliedSearchForm = appliedSearchForms[activeTab.value];
  const name = appliedSearchForm.name.trim();
  const status = appliedSearchForm.status;
  return currentState.value.tableData.filter((item) => {
    const nameMatched = !name || item.name.includes(name);
    const statusMatched = !status || item.status === status;
    return nameMatched && statusMatched;
  });
});

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() =>
  Math.max(Math.ceil(paginationTotal.value / currentState.value.pagination.pageSize), 1),
);
const pageData = computed(() => {
  const start = (currentState.value.pagination.current - 1) * currentState.value.pagination.pageSize;
  return filteredData.value.slice(start, start + currentState.value.pagination.pageSize);
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
const optionFormRoot = ref<HTMLElement>();
const optionFeedback = useFormFeedback(optionDialogVisible);
const optionInput = ref('');
const optionCodeInput = ref('');
const optionTarget = ref<AttributeItem | null>(null);
const optionPagination = reactive({
  current: 1,
  pageSize: 20,
});
const currentOptions = computed(() => optionTarget.value?.options ?? []);
const optionPageData = computed(() => {
  const start = (optionPagination.current - 1) * optionPagination.pageSize;
  return currentOptions.value.slice(start, start + optionPagination.pageSize);
});

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

const handleTabChange = () => {
  ensureCurrentPage();
};

const handleSearch = () => {
  Object.assign(appliedSearchForms[activeTab.value], currentState.value.searchForm);
  currentState.value.pagination.current = 1;
};

const handleReset = () => {
  currentState.value.searchForm.name = '';
  currentState.value.searchForm.status = '';
  currentState.value.pagination.pageSize = 10;
  handleSearch();
};

const resetFormData = () => {
  formData.name = '';
  formData.code = '';
  formData.controlType = 'input';
  formData.remark = '';
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

  const name = formData.name.trim();
  const duplicateName = currentState.value.tableData.some((item) => item.name === name);
  if (duplicateName) {
    formRef.value?.setValidateMessage({ name: [{ type: 'error', message: '属性已存在' }] });
  }
  if (result !== true || duplicateName) return rejectFormSubmission(formRef.value);

  const nextId = Math.max(...currentState.value.tableData.map((item) => item.id), 0) + 1;
  currentState.value.tableData.unshift({
    id: nextId,
    name,
    code: formData.code.trim(),
    controlType: formData.controlType,
    status: 'normal',
    createdAt: '2022/05/30 14:58',
    remark: formData.remark.trim(),
    options: formData.controlType === 'select' ? [] : [],
  });
  currentState.value.pagination.current = 1;
  closeFormDialog();
  adminFeedback.created(name);
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
  const duplicateValue = currentOptions.value.some((item) => item.value === value);
  const duplicateCode = currentOptions.value.some((item) => item.code === code);
  if (!value || !code) {
    if (!value) optionFeedback.reject('value', optionInput.value, '请输入选项值');
    if (!code) optionFeedback.reject('code', optionCodeInput.value, '请输入选项编码');
  }

  if (duplicateValue || duplicateCode) {
    if (duplicateValue) optionFeedback.reject('value', optionInput.value, '选项名称已存在');
    if (duplicateCode) optionFeedback.reject('code', optionCodeInput.value, '选项编码已存在');
  }

  if (!value || !code || duplicateValue || duplicateCode) return rejectFormSubmission(optionFormRoot.value);

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

const attributeRoleLabel = (row: AttributeItem) => {
  if (activeTab.value === 'sales') return '销售属性';
  return row.name === '品牌' || row.name === '型号' ? '关键属性' : '普通属性';
};

const attributeRoleTheme = (row: AttributeItem) => {
  const role = attributeRoleLabel(row);
  return role === '销售属性' ? 'warning' : role === '关键属性' ? 'primary' : 'default';
};

const valueModeLabel = (row: AttributeItem) => {
  if (row.name.includes('尺寸') || row.name.includes('厚度')) return '数值 + 单位';
  return '文本输入';
};

const openStatusConfirm = (row: AttributeItem) => {
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = isNormal ? `是否停用属性“${row.name}”？` : `是否启用属性“${row.name}”？`;
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
  if (currentState.value.pagination.current > pageCount.value) {
    currentState.value.pagination.current = pageCount.value;
  }
};

const handleConfirm = () => {
  if (!confirmState.row) return;
  const target = confirmState.row;

  if (confirmState.type === 'delete') {
    if (confirmState.row.options.length) {
      closeConfirmDialog();
      adminFeedback.warning('属性已有标准选项，不能直接删除；请停用属性或先解除分类模板引用');
      return;
    }
    currentState.value.tableData = currentState.value.tableData.filter((item) => item.id !== confirmState.row?.id);
    ensureCurrentPage();
  } else {
    confirmState.row.status = confirmState.type === 'enable' ? 'normal' : 'disabled';
  }

  closeConfirmDialog();
  if (confirmState.type === 'delete') {
    adminFeedback.deleted(target.name);
  } else {
    adminFeedback.success(confirmState.type === 'enable' ? '已启用属性' : '已停用属性');
  }
};
</script>

<style scoped>
.filter-card,
.table-card {
  background: var(--td-bg-color-container);
  padding: var(--td-comp-paddingTB-xxl) var(--td-comp-paddingLR-xxl);
  border-radius: var(--td-radius-medium);
}

.content-card {
  padding: 0;
}

.attribute-tabs {
  margin-bottom: var(--td-comp-margin-xxl);
}

.filter-card,
.table-card {
  padding: var(--td-comp-paddingTB-xxl) var(--td-comp-paddingLR-xxl);
  border-radius: var(--td-radius-medium);
}

.table-card {
  margin-top: var(--td-comp-margin-xxl);
  padding: var(--td-comp-paddingTB-xxl) var(--td-comp-paddingLR-xxl);
  border-radius: var(--td-radius-medium);
}

.table-toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: var(--td-comp-margin-xxl);
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--td-comp-margin-m) var(--td-comp-margin-l);
}

.option-panel {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xxl);
}

.option-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--td-comp-margin-s);
}

@media (max-width: 960px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .option-toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
