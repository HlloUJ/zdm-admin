<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <AdminListLayout class="pricing-list-layout">
          <template #toolbar>
            <div class="list-controls">
              <t-tabs v-if="showTabRail" v-model="activeType" class="configuration-tabs" :list="visibleTabs" />

              <div class="guide-card">
                <div class="guide-setting-section">
                  <div class="guide-setting-copy">
                    <strong>指导价设置</strong>
                    <span>不区分门店级别，仅用于新商品初始化，不影响已保存商品。</span>
                  </div>
                  <t-form ref="guideFormRef" class="guide-setting-form" :data="guideForm" label-width="0">
                    <span><span class="required-star">*</span>价格系数</span>
                    <t-form-item
                      class="guide-form-item"
                      name="priceCoefficient"
                      :rules="guidePriceCoefficientRules"
                      :required-mark="false"
                    >
                      <DecimalInput
                        v-model="guideForm.priceCoefficient"
                        class="guide-coefficient-input"
                        large-number
                        :disabled="!canEditGuide"
                        :decimal-places="2"
                        theme="normal"
                        placeholder="请输入价格系数"
                        @change="handleGuideCoefficientChange"
                        @keydown="handlePriceCoefficientKeydown"
                      />
                    </t-form-item>
                    <t-button
                      v-if="canEditGuide"
                      :theme="buttonTheme('save')"
                      :loading="guideSaving"
                      @click="saveGuidePriceSetting"
                    >
                      {{ formConfirmationText('edit') }}
                    </t-button>
                  </t-form>
                </div>
              </div>
              <t-form class="zdm-admin-filter-form zdm-standard-query" label-width="80px" :data="searchForm" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <t-form-item label="门店级别" name="name">
                      <t-input v-model="searchForm.name" clearable placeholder="请输入门店级别" />
                    </t-form-item>
                  </div>
                  <div class="filter-actions">
                    <t-button :theme="buttonTheme('search')" @click="handleSearch">
                      <template #icon><t-icon name="search" /></template>查询
                    </t-button>
                    <t-button :theme="buttonTheme('reset')" variant="base" @click="handleReset">
                      <template #icon><t-icon name="refresh" /></template>重置
                    </t-button>
                  </div>
                </div>
              </t-form>
              <AdminListToolbar :has-actions="canCreate"
                ><t-button v-if="canCreate" :theme="buttonTheme('create')" @click="openCreate">
                  <template #icon><t-icon name="add" /></template>新增
                </t-button></AdminListToolbar
              >
            </div>
          </template>
          <template #table>
            <t-table
              row-key="id"
              :data="pageData"
              :columns="columns"
              :loading="loading"
              :class="{ 'zdm-row-sort-table': canSort }"
              :drag-sort="canSort ? 'row' : undefined"
              :drag-sort-options="{
                animation: 200,
                filter: 'a, button, input, textarea, select, .t-link, .t-select, .t-checkbox, .t-switch',
                preventOnFilter: false,
              }"
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
                  {{ row.status === 'enabled' ? '已启用' : '已停用' }}
                </t-tag>
              </template>
              <template #operation="{ row }">
                <div class="table-actions">
                  <t-link v-if="canEdit" :theme="buttonTheme('edit')" hover="color" @click="openEdit(row)">
                    编辑
                  </t-link>
                  <t-link
                    v-if="canToggleStatus"
                    :theme="buttonTheme(row.status === 'enabled' ? 'disable' : 'enable')"
                    hover="color"
                    @click="openStatusConfirm(row)"
                  >
                    {{ row.status === 'enabled' ? '停用' : '启用' }}
                  </t-link>
                  <t-link v-if="canDelete" :theme="buttonTheme('delete')" hover="color" @click="openConfirm(row)"
                    >删除</t-link
                  >
                </div>
              </template>
            </t-table>
          </template>
          <template #pagination>
            <AdminPagination
              v-model:current="pagination.current"
              v-model:page-size="pagination.pageSize"
              :total="filteredData.length"
              :page-size-options="[10, 20, 50]"
            />
          </template>
        </AdminListLayout>
      </main>
    </div>

    <AdminDialog
      v-model:visible="formVisible"
      :confirmation="formConfirmation(editingId ? 'edit' : 'create')"
      confirm-function="submit"
      dialog-class-name="zdm-admin-dialog zdm-admin-single-form"
      :header="editingId ? '编辑' : '新增'"
      width="480px"
      @confirm="submitForm"
      @cancel="closeForm"
      @close="closeForm"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="100px" colon>
        <t-form-item label="门店级别" name="storeLevelId">
          <t-select
            v-model="formData.storeLevelId"
            class="price-level-select"
            :disabled="Boolean(editingId)"
            clearable
            placeholder="请选择门店级别"
          >
            <t-option
              v-for="level in storeLevels"
              :key="level.id"
              :label="level.name"
              :value="level.id"
              :disabled="isStoreLevelConfigured(level.id)"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="价格系数" name="priceCoefficient">
          <DecimalInput
            v-model="formData.priceCoefficient"
            class="price-coefficient-input"
            large-number
            :decimal-places="2"
            theme="normal"
            placeholder="请输入价格系数"
            @change="handleFormCoefficientChange"
            @keydown="handlePriceCoefficientKeydown"
          />
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminConfirmDialog
      v-model:visible="confirmVisible"
      function="delete"
      action="删除"
      object-type="价格配置"
      :object-name="confirmRow?.name"
      @confirm="submitConfirm"
      @cancel="confirmVisible = false"
      @close="confirmVisible = false"
    />
    <AdminConfirmDialog
      v-model:visible="statusConfirmVisible"
      :function="statusConfirmRow?.status === 'enabled' ? 'disable' : 'enable'"
      :action="statusConfirmRow?.status === 'enabled' ? '停用' : '启用'"
      :object-type="`${commodityLabel}价格配置`"
      :object-name="statusConfirmRow?.name"
      @confirm="submitStatusConfirm"
      @cancel="statusConfirmVisible = false"
      @close="statusConfirmVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { formConfirmationText } from '@/components/foundation/actions/confirmation';
import { formConfirmation } from '@/components/foundation/actions/confirmation';
import { buttonTheme } from '@/components/foundation/actions/buttonFunctions';
import { rejectFormSubmission } from '@/utils/submitValidation';
import AdminListToolbar from '@/components/foundation/AdminListToolbar.vue';
import DecimalInput from '@/components/DecimalInput.vue';
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPagination,
  adminFeedback,
} from '@/components/foundation';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import * as finishedPricing from '@/services/finishedMarkupConfigurations';
import * as accessoryPricing from '@/services/accessoryMarkupConfigurations';
import { type FinishedMarkupConfigurationRecord } from '@/services/finishedMarkupConfigurations';
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
import { listStoreLevelPricingOptions, type StoreLevelRecord } from '@/services/storeLevels';

type PriceConfigurationTab = 'finished' | 'accessory' | 'slab';
type MarkupConfigurationRecord = FinishedMarkupConfigurationRecord | SlabMarkupConfigurationRecord;

const tabs = [
  { label: '成品价格配置', value: 'finished' },
  { label: '配件价格配置', value: 'accessory' },
  { label: '大板价格配置', value: 'slab' },
] as const;
const prefix = 'admin.product-data-center.markup-configuration';
const loginUser = computed(() => getLoginUser());
const activeType = ref<PriceConfigurationTab>('finished');
const commodityPricing = computed(() => (activeType.value === 'accessory' ? accessoryPricing : finishedPricing));
const commodityLabel = computed(() =>
  activeType.value === 'accessory' ? '配件' : activeType.value === 'finished' ? '成品' : '大板',
);
const { visibleTabs, showTabRail } = usePermissionTabs({
  tabs,
  activeTab: activeType,
  canAccess: (tab) => hasPermission(loginUser.value, `${prefix}.${tab.value}.view`),
});
const activePrefix = computed(() => `${prefix}.${activeType.value}`);
const canCreate = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.create`));
const canEdit = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.edit`));
const canSort = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.sort`));
const canEditGuide = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.guide-price.edit`));
const canDelete = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.delete`));
const canToggleStatus = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.toggle-status`));

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
const isValidCoefficientFormat = (value: unknown) => {
  const normalizedValue = String(value ?? '').trim();
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalizedValue);
};
const requiredCoefficientRules: FormRule[] = [
  { required: true, message: '请输入价格系数', type: 'error', trigger: 'submit' },
  {
    validator: (value) => Boolean(String(value ?? '').trim()),
    message: '请输入价格系数',
    type: 'error',
    trigger: 'blur',
  },
];
const guidePriceCoefficientRules: FormRule[] = [
  ...requiredCoefficientRules,
  {
    validator: (value) => !String(value ?? '').trim() || (isValidCoefficientFormat(value) && Number(value) >= 1),
    message: '价格系数不能小于1.00',
    type: 'error',
    trigger: 'blur',
  },
];
const configurationPriceCoefficientRules: FormRule[] = [
  ...requiredCoefficientRules,
  {
    validator: (value) => !String(value ?? '').trim() || (isValidCoefficientFormat(value) && Number(value) >= 0),
    message: '请输入正确的价格系数',
    type: 'error',
    trigger: 'blur',
  },
];
const formatPriceCoefficientInput = (value: number) => Number(value).toFixed(2);
const guideFormRef = ref<FormInstanceFunctions>();
const guideForm = reactive<{ priceCoefficient: PriceCoefficientValue }>({ priceCoefficient: undefined });
const tableData = ref<MarkupConfigurationRecord[]>([]);
const storeLevels = ref<StoreLevelRecord[]>([]);
const searchForm = reactive({ name: '' });
const appliedSearchForm = reactive({ ...searchForm });
const pagination = reactive({ current: 1, pageSize: 10 });
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(canSort.value ? [{ colKey: 'drag', title: 'dragTitle', width: 28, align: 'left' as const }] : []),
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'name', title: '门店级别', minWidth: 200, align: 'left' },
  { colKey: 'priceCoefficient', title: '价格系数', width: 130 },
  { colKey: 'status', title: '状态', width: 100 },
  { colKey: 'createdByName', title: '创建人', width: 120 },
  { colKey: 'createdAt', title: '创建时间', width: 180 },
  {
    colKey: 'operation',
    title: '操作',
    width: 156,
    align: 'left',
    fixed: 'right',
  },
]);
const filteredData = computed(() => {
  const name = appliedSearchForm.name.trim();
  return tableData.value.filter((item) => !name || item.name.includes(name));
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
    const [rows, guideSetting, levels] =
      activeType.value !== 'slab'
        ? await Promise.all([
            commodityPricing.value.listFinishedMarkupConfigurations(),
            commodityPricing.value.getFinishedGuidePriceSetting(),
            listStoreLevelPricingOptions(),
          ])
        : await Promise.all([
            listSlabMarkupConfigurations(),
            getSlabGuidePriceSetting(),
            listStoreLevelPricingOptions(),
          ]);
    tableData.value = rows.map((item) => ({
      ...item,
      createdByName: item.createdByName ?? '-',
      createdAt: formatDateTime(item.createdAt),
    }));
    storeLevels.value = levels;
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
  if ((await guideFormRef.value?.validate()) !== true) return rejectFormSubmission(guideFormRef.value);
  const coefficient = Number(guideForm.priceCoefficient);
  guideSaving.value = true;
  try {
    const setting =
      activeType.value !== 'slab'
        ? await commodityPricing.value.updateFinishedGuidePriceSetting(coefficient)
        : await updateSlabGuidePriceSetting(coefficient);
    guideForm.priceCoefficient = formatPriceCoefficientInput(setting.priceCoefficient);
    guideFormRef.value?.clearValidate();
    adminFeedback.actionSuccess({
      action: '修改',
      target: `${commodityLabel.value}指导价设置`,
    });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '指导价设置保存失败');
  } finally {
    guideSaving.value = false;
  }
};
const handleGuideCoefficientChange = (_value?: unknown, context?: PriceCoefficientChangeContext) => {
  if (context?.type === 'props') return;
  if (
    !String(guideForm.priceCoefficient ?? '').trim() ||
    (isValidCoefficientFormat(guideForm.priceCoefficient) && Number(guideForm.priceCoefficient) >= 1)
  ) {
    guideFormRef.value?.clearValidate(['priceCoefficient']);
  }
};
const handleSearch = () => {
  Object.assign(appliedSearchForm, searchForm);
  pagination.current = 1;
};
const handleReset = () => {
  Object.assign(searchForm, { name: '' });
  pagination.pageSize = 10;
  handleSearch();
};

const formRef = ref<FormInstanceFunctions>();
const formVisible = ref(false);
const editingId = ref<number | null>(null);
const formData = reactive<{ storeLevelId: number | undefined; priceCoefficient: PriceCoefficientValue }>({
  storeLevelId: undefined,
  priceCoefficient: undefined,
});
const formRules: Record<string, FormRule[]> = {
  storeLevelId: [{ required: true, message: '请选择门店级别', type: 'error' }],
  priceCoefficient: configurationPriceCoefficientRules,
};
const openCreate = () => {
  editingId.value = null;
  Object.assign(formData, { storeLevelId: undefined, priceCoefficient: undefined });
  formVisible.value = true;
};
const openEdit = (row: MarkupConfigurationRecord) => {
  editingId.value = row.id;
  Object.assign(formData, {
    storeLevelId: row.storeLevelId,
    priceCoefficient: formatPriceCoefficientInput(row.priceCoefficient),
  });
  formVisible.value = true;
};
const configuredStoreLevelIds = computed(() => new Set(tableData.value.map((item) => item.storeLevelId)));
const isStoreLevelConfigured = (storeLevelId: number) =>
  configuredStoreLevelIds.value.has(storeLevelId) && storeLevelId !== formData.storeLevelId;
const closeForm = () => {
  formVisible.value = false;
  formRef.value?.clearValidate();
};
const handleFormCoefficientChange = (_value?: unknown, context?: PriceCoefficientChangeContext) => {
  if (context?.type === 'props') return;
  if (
    !String(formData.priceCoefficient ?? '').trim() ||
    (isValidCoefficientFormat(formData.priceCoefficient) && Number(formData.priceCoefficient) >= 0)
  ) {
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
    if (activeType.value !== 'slab') await commodityPricing.value.reorderFinishedMarkupConfigurations(orderedIds);
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
  if ((await formRef.value?.validate()) !== true) return rejectFormSubmission(formRef.value);
  if (formData.storeLevelId == null || formData.priceCoefficient == null) return;
  const name = storeLevels.value.find((level) => level.id === formData.storeLevelId)?.name ?? '门店级别';
  const payload = { storeLevelId: formData.storeLevelId, priceCoefficient: Number(formData.priceCoefficient) };
  try {
    if (activeType.value !== 'slab') {
      if (editingId.value) await commodityPricing.value.updateFinishedMarkupConfiguration(editingId.value, payload);
      else await commodityPricing.value.createFinishedMarkupConfiguration(payload);
    } else {
      if (editingId.value) await updateSlabMarkupConfiguration(editingId.value, payload);
      else await createSlabMarkupConfiguration(payload);
    }
    const wasEditing = Boolean(editingId.value);
    await loadData();
    closeForm();
    if (wasEditing) adminFeedback.actionSuccess({ action: '修改', target: name });
    else adminFeedback.created(name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const confirmVisible = ref(false);
const confirmRow = ref<MarkupConfigurationRecord | null>(null);
const openConfirm = (row: MarkupConfigurationRecord) => {
  if (activeType.value === 'slab') {
    const referenceCount = (row as SlabMarkupConfigurationRecord).autoReferenceCount ?? 0;
    if (referenceCount > 0) {
      adminFeedback.warning(`该价格配置正在被${referenceCount}条大板价格使用，不能删除，请先停用`);
      return;
    }
  }
  confirmRow.value = row;
  confirmVisible.value = true;
};
const submitConfirm = async () => {
  if (!confirmRow.value) return;
  const row = confirmRow.value;
  try {
    if (activeType.value !== 'slab') await commodityPricing.value.deleteFinishedMarkupConfiguration(row.id);
    else await deleteSlabMarkupConfiguration(row.id);
    await loadData();
    confirmVisible.value = false;
    adminFeedback.deleted(row.name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const statusConfirmVisible = ref(false);
const statusConfirmRow = ref<MarkupConfigurationRecord | null>(null);
const openStatusConfirm = (row: MarkupConfigurationRecord) => {
  statusConfirmRow.value = row;
  statusConfirmVisible.value = true;
};
const submitStatusConfirm = async () => {
  if (!statusConfirmRow.value) return;
  const row = statusConfirmRow.value;
  const status = row.status === 'enabled' ? 'disabled' : 'enabled';
  try {
    if (activeType.value !== 'slab')
      await commodityPricing.value.updateFinishedMarkupConfigurationStatus(row.id, status);
    else await updateSlabMarkupConfigurationStatus(row.id, status);
    await loadData();
    statusConfirmVisible.value = false;
    adminFeedback.actionSuccess({ action: status === 'enabled' ? '启用' : '停用', target: row.name });
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '状态更新失败');
  }
};

watch(activeType, () => {
  handleReset();
  void loadData();
});
onMounted(loadData);
</script>

<style scoped>
.page-header,
.table-actions {
  display: flex;
  align-items: center;
}
.page-header {
  justify-content: space-between;
  gap: var(--td-comp-margin-xxl);
}
.guide-card {
  padding-bottom: var(--td-comp-margin-l);
  border-bottom: 1px solid var(--td-component-border);
}
.pricing-list-layout {
  grid-template-columns: minmax(0, 1fr);
}
.list-controls {
  min-width: 0;
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-xxl);
}
.guide-setting-section,
.guide-setting-form,
.guide-setting-copy {
  display: flex;
}
.guide-setting-section {
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-xl);
}
.guide-setting-copy {
  font: var(--td-font-body-medium);
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
  color: var(--td-text-color-secondary);
}
.guide-setting-copy strong {
  color: var(--td-text-color-primary);
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
.table-actions {
  gap: var(--td-comp-margin-m) var(--td-comp-margin-l);
}
.price-level-select,
.price-coefficient-input {
  width: 100%;
}
</style>
