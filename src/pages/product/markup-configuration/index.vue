<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb>
            <t-breadcrumb-item>商品管理</t-breadcrumb-item>
            <t-breadcrumb-item>商品公共基础数据</t-breadcrumb-item>
            <t-breadcrumb-item>价格配置</t-breadcrumb-item>
          </t-breadcrumb>
          <t-tag theme="primary" variant="light">商品默认价格规则</t-tag>
        </header>

        <t-tabs v-if="showTabRail" v-model="activeType" class="configuration-tabs" :list="visibleTabs" />
        <t-alert class="pricing-alert" theme="info" :message="pricingRuleMessage" />

        <section class="guide-card">
          <div class="guide-setting-section">
            <div class="guide-setting-copy">
              <strong>指导价设置</strong>
              <span>不区分合伙人等级，仅用于新商品初始化，不影响已保存商品。</span>
            </div>
            <t-form ref="guideFormRef" class="guide-setting-form" :data="guideForm" label-width="0">
              <span><span class="required-star">*</span>价格系数</span>
              <t-form-item
                class="guide-form-item"
                name="priceCoefficient"
                :rules="priceCoefficientRules"
                :required-mark="false"
              >
                <t-input-number
                  v-model="guideForm.priceCoefficient"
                  class="guide-coefficient-input"
                  large-number
                  :disabled="!canEdit"
                  :decimal-places="2"
                  theme="normal"
                  placeholder="请输入"
                  @change="handleGuideCoefficientChange"
                  @keydown="handlePriceCoefficientKeydown"
                />
              </t-form-item>
              <t-button v-if="canEdit" theme="primary" :loading="guideSaving" @click="saveGuidePriceSetting">
                保存
              </t-button>
            </t-form>
          </div>
        </section>

        <section class="partner-card">
          <div class="partner-card-header">
            <div class="partner-card-copy">
              <strong>合伙人阶梯价</strong>
              <span>按合伙人等级维护价格系数，新增等级会为历史商品补充对应价格。</span>
            </div>
            <t-button v-if="canCreate" theme="primary" @click="openCreate">
              <template #icon><t-icon name="add" /></template>新增阶梯价
            </t-button>
          </div>
          <t-form :data="searchForm" label-width="72px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="等级名称" name="name">
                  <t-input v-model="searchForm.name" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="状态" name="status">
                  <t-select v-model="searchForm.status" clearable placeholder="请选择">
                    <t-option label="启用" value="enabled" />
                    <t-option label="停用" value="disabled" />
                  </t-select>
                </t-form-item>
              </div>
              <div class="filter-actions">
                <t-button theme="primary" @click="handleSearch">
                  <template #icon><t-icon name="search" /></template>查询
                </t-button>
                <t-button theme="default" variant="base" @click="handleReset">
                  <template #icon><t-icon name="refresh" /></template>重置
                </t-button>
              </div>
            </div>
          </t-form>
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
            <template #index="{ rowIndex }">
              {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
            </template>
            <template #priceCoefficient="{ row }">{{ formatNumber(row.priceCoefficient, 4) }}</template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'enabled' ? '启用' : '停用' }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEdit" theme="primary" hover="color" @click="openEdit(row)">编辑</t-link>
                <t-link
                  v-if="canToggle"
                  :theme="row.status === 'enabled' ? 'warning' : 'success'"
                  hover="color"
                  @click="openConfirm(row, row.status === 'enabled' ? 'disable' : 'enable')"
                >
                  {{ row.status === 'enabled' ? '停用' : '启用' }}
                </t-link>
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
      :header="editingId ? '编辑合伙人阶梯价' : '新增合伙人阶梯价'"
      @confirm="submitForm"
      @cancel="closeForm"
      @close="closeForm"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item label="等级名称" name="name">
          <t-input v-model="formData.name" :maxlength="20" clearable placeholder="例如：1级合伙人价格" />
        </t-form-item>
        <t-form-item label="价格系数" name="priceCoefficient">
          <t-input-number
            v-model="formData.priceCoefficient"
            class="price-coefficient-input"
            large-number
            :decimal-places="2"
            theme="normal"
            placeholder="请输入"
            @change="handleFormCoefficientChange"
            @keydown="handlePriceCoefficientKeydown"
          />
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminConfirmDialog
      v-model:visible="confirmVisible"
      :action="confirmType === 'delete' ? '删除' : confirmType === 'disable' ? '停用' : '启用'"
      object-type="合伙人阶梯价"
      :object-name="confirmRow?.name"
      @confirm="submitConfirm"
      @cancel="confirmVisible = false"
      @close="confirmVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { AdminConfirmDialog, AdminDialog, AdminPagination, adminFeedback } from '@/components/foundation';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createFinishedMarkupConfiguration,
  deleteFinishedMarkupConfiguration,
  getFinishedGuidePriceSetting,
  listFinishedMarkupConfigurations,
  reorderFinishedMarkupConfigurations,
  updateFinishedMarkupConfiguration,
  updateFinishedMarkupConfigurationStatus,
  updateFinishedGuidePriceSetting,
  type FinishedMarkupConfigurationRecord,
} from '@/services/finishedMarkupConfigurations';
import {
  createSlabMarkupConfiguration,
  deleteSlabMarkupConfiguration,
  getSlabGuidePriceSetting,
  listSlabMarkupConfigurations,
  reorderSlabMarkupConfigurations,
  updateSlabMarkupConfiguration,
  updateSlabMarkupConfigurationStatus,
  updateSlabGuidePriceSetting,
  type SlabMarkupConfigurationRecord,
} from '@/services/slabMarkupConfigurations';

type PriceConfigurationTab = 'finished' | 'slab';
type MarkupConfigurationRecord = FinishedMarkupConfigurationRecord | SlabMarkupConfigurationRecord;

type ConfirmType = 'enable' | 'disable' | 'delete';

const tabs = [
  { label: '成品价格配置', value: 'finished' },
  { label: '大板价格配置', value: 'slab' },
] as const;
const prefix = 'admin.product-data-center.markup-configuration';
const loginUser = computed(() => getLoginUser());
const activeType = ref<PriceConfigurationTab>('finished');
const { visibleTabs, showTabRail } = usePermissionTabs({
  tabs,
  activeTab: activeType,
  canAccess: (tab) => hasPermission(loginUser.value, `${prefix}.${tab.value}.view`),
});
const activePrefix = computed(() => `${prefix}.${activeType.value}`);
const canCreate = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.create`));
const canEdit = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.edit`));
const canSort = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.sort`));
const canToggle = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.toggle-status`));
const canDelete = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.delete`));
const pricingRuleMessage = computed(
  () =>
    `${activeType.value === 'finished' ? '成品' : '大板'}价格配置只用于新商品初始化；商品保存后使用自己的价格系数。新增阶梯价会为历史商品补充对应价格。`,
);

const loading = ref(false);
const guideSaving = ref(false);
type PriceCoefficientValue = string | number | undefined;
type PriceCoefficientChangeContext = { type?: string };
type PriceCoefficientKeydownContext = { e?: KeyboardEvent };
const handlePriceCoefficientKeydown = (_value?: unknown, context?: PriceCoefficientKeydownContext) => {
  const event = context?.e;
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return;
  const allowedKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (/^\d$/.test(event.key) || allowedKeys.includes(event.key)) return;
  if (event.key === '.') {
    const input = event.target as HTMLInputElement | null;
    const selectedText = input?.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0) ?? '';
    if (!input?.value.includes('.') || selectedText.includes('.')) return;
  }
  event.preventDefault();
};
const isValidPriceCoefficient = (value: unknown) => {
  const normalizedValue = String(value ?? '').trim();
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalizedValue) && Number(normalizedValue) >= 0;
};
const priceCoefficientRules: FormRule[] = [
  { required: true, message: '请输入价格系数', type: 'error', trigger: 'submit' },
  {
    validator: (value) => Boolean(String(value ?? '').trim()),
    message: '请输入价格系数',
    type: 'error',
    trigger: 'blur',
  },
  {
    validator: (value) => !String(value ?? '').trim() || isValidPriceCoefficient(value),
    message: '请输入正确的价格系数',
    type: 'error',
    trigger: 'blur',
  },
];
const formatPriceCoefficientInput = (value: number) => Number(value).toFixed(2);
const guideFormRef = ref<FormInstanceFunctions>();
const guideForm = reactive<{ priceCoefficient: PriceCoefficientValue }>({ priceCoefficient: undefined });
const tableData = ref<MarkupConfigurationRecord[]>([]);
const searchForm = reactive({ name: '', status: '' });
const appliedSearchForm = reactive({ ...searchForm });
const pagination = reactive({ current: 1, pageSize: 10 });
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(canSort.value ? [{ colKey: 'drag', title: 'dragTitle', width: 52, align: 'center' as const }] : []),
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'name', title: '合伙人等级', minWidth: 200, align: 'left' },
  { colKey: 'priceCoefficient', title: '价格系数', width: 130, align: 'right' },
  { colKey: 'status', title: '状态', width: 110, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 180, align: 'left', fixed: 'right' },
]);
const filteredData = computed(() => {
  const name = appliedSearchForm.name.trim();
  return tableData.value.filter(
    (item) =>
      (!name || item.name.includes(name)) && (!appliedSearchForm.status || item.status === appliedSearchForm.status),
  );
});
const pageData = computed(() =>
  filteredData.value.slice((pagination.current - 1) * pagination.pageSize, pagination.current * pagination.pageSize),
);
const formatNumber = (value: number, digits = 4) =>
  Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const formatDateTime = (value?: string) => (value ? value.replace(/-/g, '/').replace('T', ' ').slice(0, 16) : '-');
const loadData = async () => {
  loading.value = true;
  try {
    const [rows, guideSetting] =
      activeType.value === 'finished'
        ? await Promise.all([listFinishedMarkupConfigurations(), getFinishedGuidePriceSetting()])
        : await Promise.all([listSlabMarkupConfigurations(), getSlabGuidePriceSetting()]);
    tableData.value = rows.map((item) => ({
      ...item,
      createdByName: item.createdByName ?? '-',
      createdAt: formatDateTime(item.createdAt),
    }));
    guideForm.priceCoefficient =
      guideSetting?.priceCoefficient == null ? undefined : formatPriceCoefficientInput(guideSetting.priceCoefficient);
    guideFormRef.value?.clearValidate();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '加价配置加载失败');
  } finally {
    loading.value = false;
  }
};
const saveGuidePriceSetting = async () => {
  if ((await guideFormRef.value?.validate()) !== true) return;
  const coefficient = Number(guideForm.priceCoefficient);
  guideSaving.value = true;
  try {
    const setting =
      activeType.value === 'finished'
        ? await updateFinishedGuidePriceSetting(coefficient)
        : await updateSlabGuidePriceSetting(coefficient);
    guideForm.priceCoefficient = formatPriceCoefficientInput(setting.priceCoefficient);
    guideFormRef.value?.clearValidate();
    adminFeedback.actionSuccess({
      action: '保存',
      target: `${activeType.value === 'finished' ? '成品' : '大板'}指导价设置`,
    });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '指导价设置保存失败');
  } finally {
    guideSaving.value = false;
  }
};
const handleGuideCoefficientChange = (_value?: unknown, context?: PriceCoefficientChangeContext) => {
  if (context?.type === 'props') return;
  if (!String(guideForm.priceCoefficient ?? '').trim() || isValidPriceCoefficient(guideForm.priceCoefficient)) {
    guideFormRef.value?.clearValidate(['priceCoefficient']);
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
const formData = reactive<{ name: string; priceCoefficient: PriceCoefficientValue }>({
  name: '',
  priceCoefficient: undefined,
});
const formRules: Record<string, FormRule[]> = {
  name: [
    { required: true, message: '请输入等级名称', type: 'error' },
    { max: 20, message: '等级名称最多20个字', type: 'error' },
  ],
  priceCoefficient: priceCoefficientRules,
};
const openCreate = () => {
  editingId.value = null;
  Object.assign(formData, { name: '', priceCoefficient: undefined });
  formVisible.value = true;
};
const openEdit = (row: MarkupConfigurationRecord) => {
  editingId.value = row.id;
  Object.assign(formData, {
    name: row.name,
    priceCoefficient: formatPriceCoefficientInput(row.priceCoefficient),
  });
  formVisible.value = true;
};
const closeForm = () => {
  formVisible.value = false;
  formRef.value?.clearValidate();
};
const handleFormCoefficientChange = (_value?: unknown, context?: PriceCoefficientChangeContext) => {
  if (context?.type === 'props') return;
  if (!String(formData.priceCoefficient ?? '').trim() || isValidPriceCoefficient(formData.priceCoefficient)) {
    formRef.value?.clearValidate(['priceCoefficient']);
  }
};
const sorting = ref(false);
const handleDragSort = async (context: { current: MarkupConfigurationRecord; target: MarkupConfigurationRecord }) => {
  if (!canSort.value || sorting.value) return;
  const orderedRows = tableData.value.map((item) => ({ ...item }));
  const currentIndex = orderedRows.findIndex((item) => item.id === context.current.id);
  const targetIndex = orderedRows.findIndex((item) => item.id === context.target.id);
  if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return;

  const [currentRow] = orderedRows.splice(currentIndex, 1);
  orderedRows.splice(targetIndex, 0, currentRow);
  sorting.value = true;
  try {
    const orderedIds = orderedRows.map((item) => item.id);
    if (activeType.value === 'finished') await reorderFinishedMarkupConfigurations(orderedIds);
    else await reorderSlabMarkupConfigurations(orderedIds);
    await loadData();
    adminFeedback.actionSuccess({ action: '更新排序', target: context.current.name });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '排序保存失败');
    await loadData();
  } finally {
    sorting.value = false;
  }
};
const submitForm = async () => {
  if ((await formRef.value?.validate()) !== true) return;
  const name = formData.name.trim();
  if (formData.priceCoefficient == null) return;
  const payload = { name, priceCoefficient: Number(formData.priceCoefficient) };
  try {
    if (activeType.value === 'finished') {
      if (editingId.value) await updateFinishedMarkupConfiguration(editingId.value, payload);
      else await createFinishedMarkupConfiguration(payload);
    } else {
      if (editingId.value) await updateSlabMarkupConfiguration(editingId.value, payload);
      else await createSlabMarkupConfiguration(payload);
    }
    const wasEditing = Boolean(editingId.value);
    await loadData();
    closeForm();
    if (wasEditing) adminFeedback.actionSuccess({ action: '保存', target: name });
    else adminFeedback.created(name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const confirmVisible = ref(false);
const confirmType = ref<ConfirmType>('disable');
const confirmRow = ref<MarkupConfigurationRecord | null>(null);
const openConfirm = (row: MarkupConfigurationRecord, type: ConfirmType) => {
  confirmRow.value = row;
  confirmType.value = type;
  confirmVisible.value = true;
};
const submitConfirm = async () => {
  if (!confirmRow.value) return;
  const row = confirmRow.value;
  const action = confirmType.value === 'delete' ? '删除' : confirmType.value === 'enable' ? '启用' : '停用';
  try {
    const status = confirmType.value === 'enable' ? 'enabled' : 'disabled';
    if (activeType.value === 'finished') {
      if (confirmType.value === 'delete') await deleteFinishedMarkupConfiguration(row.id);
      else await updateFinishedMarkupConfigurationStatus(row.id, status);
    } else if (confirmType.value === 'delete') await deleteSlabMarkupConfiguration(row.id);
    else await updateSlabMarkupConfigurationStatus(row.id, status);
    await loadData();
    confirmVisible.value = false;
    if (confirmType.value === 'delete') adminFeedback.deleted(row.name);
    else adminFeedback.actionSuccess({ action, target: row.name });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

watch(activeType, () => {
  handleReset();
  void loadData();
});
onMounted(loadData);
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
.page-header,
.filter-row,
.filter-actions,
.table-actions,
.partner-card-header {
  display: flex;
  align-items: center;
}
.page-header,
.filter-row {
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}
.page-header {
  margin-bottom: var(--td-comp-margin-l);
}
.guide-card,
.partner-card {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}
.configuration-tabs,
.pricing-alert,
.guide-card,
.partner-card {
  margin-bottom: var(--td-comp-margin-l);
}
.partner-card > * + * {
  margin-top: var(--td-comp-margin-l);
}
.guide-setting-section,
.guide-setting-form,
.guide-setting-copy,
.partner-card-copy {
  display: flex;
}
.guide-setting-section {
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-xl);
}
.guide-setting-copy,
.partner-card-copy {
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
  color: var(--td-text-color-secondary);
}
.guide-setting-copy strong,
.partner-card-copy strong {
  color: var(--td-text-color-primary);
}
.partner-card-header {
  justify-content: space-between;
  gap: var(--td-comp-margin-xl);
}
.guide-setting-form {
  align-items: center;
  gap: var(--td-comp-margin-m);
  white-space: nowrap;
}
.required-star {
  margin-right: 2px;
  color: var(--td-error-color);
}
.guide-coefficient-input {
  width: 160px;
}
.guide-form-item {
  margin-bottom: 0;
}
.filter-fields {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-l);
}
.filter-fields :deep(.t-form__item) {
  width: 240px;
  margin-bottom: 0;
}
.filter-actions,
.table-actions {
  gap: var(--td-comp-margin-m);
}
.price-coefficient-input {
  width: 50%;
}
</style>
