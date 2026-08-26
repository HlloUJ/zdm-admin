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
                <t-input-number
                  v-model="guideForm.priceCoefficient"
                  class="guide-coefficient-input"
                  large-number
                  :disabled="!canEditGuide"
                  :decimal-places="2"
                  theme="normal"
                  placeholder="请输入"
                  @change="handleGuideCoefficientChange"
                  @keydown="handlePriceCoefficientKeydown"
                />
              </t-form-item>
              <t-button v-if="canEditGuide" theme="primary" :loading="guideSaving" @click="saveGuidePriceSetting">
                保存指导价
              </t-button>
            </t-form>
          </div>
        </section>

        <section class="partner-card">
          <div class="partner-card-header">
            <div class="partner-card-copy">
              <strong>门店级别价格</strong>
              <span>引用门店级别管理中的启用级别，并为当前商品类型设置价格系数。</span>
            </div>
            <t-button v-if="canCreate" theme="primary" @click="openCreate">
              <template #icon><t-icon name="add" /></template>新增
            </t-button>
          </div>
          <t-form :data="searchForm" label-width="72px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="门店级别" name="name">
                  <t-input v-model="searchForm.name" clearable placeholder="请输入" />
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
          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
            <template #index="{ rowIndex }">
              {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
            </template>
            <template #priceCoefficient="{ row }">{{ formatNumber(row.priceCoefficient, 4) }}</template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEdit" theme="primary" hover="color" @click="openEdit(row)">编辑</t-link>
                <t-link v-if="canDelete" theme="danger" hover="color" @click="openConfirm(row)">删除</t-link>
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
      :header="editingId ? '编辑价格配置' : '新增价格配置'"
      @confirm="submitForm"
      @cancel="closeForm"
      @close="closeForm"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item label="门店级别" name="storeLevelId">
          <t-select
            v-model="formData.storeLevelId"
            class="price-level-select"
            :disabled="Boolean(editingId)"
            clearable
            placeholder="请选择"
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
      action="删除"
      object-type="价格配置"
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
  updateFinishedMarkupConfiguration,
  updateFinishedGuidePriceSetting,
  type FinishedMarkupConfigurationRecord,
} from '@/services/finishedMarkupConfigurations';
import {
  createSlabMarkupConfiguration,
  deleteSlabMarkupConfiguration,
  getSlabGuidePriceSetting,
  listSlabMarkupConfigurations,
  updateSlabMarkupConfiguration,
  updateSlabGuidePriceSetting,
  type SlabMarkupConfigurationRecord,
} from '@/services/slabMarkupConfigurations';
import { listStoreLevelPricingOptions, type StoreLevelRecord } from '@/services/storeLevels';

type PriceConfigurationTab = 'finished' | 'slab';
type MarkupConfigurationRecord = FinishedMarkupConfigurationRecord | SlabMarkupConfigurationRecord;

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
const canEditGuide = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.guide-price.edit`));
const canDelete = computed(() => hasPermission(loginUser.value, `${activePrefix.value}.delete`));
const pricingRuleMessage = computed(
  () =>
    `${activeType.value === 'finished' ? '成品' : '大板'}价格配置只用于新商品初始化；商品保存后使用自己的价格系数。新增价格配置会为历史商品补充对应价格。`,
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
    validator: (value) => !String(value ?? '').trim() || (isValidCoefficientFormat(value) && Number(value) > 0),
    message: '价格系数必须大于0',
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
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'name', title: '门店级别', minWidth: 200, align: 'left' },
  { colKey: 'priceCoefficient', title: '价格系数', width: 130, align: 'right' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 180, align: 'left', fixed: 'right' },
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
      activeType.value === 'finished'
        ? await Promise.all([
            listFinishedMarkupConfigurations(),
            getFinishedGuidePriceSetting(),
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
    (isValidCoefficientFormat(formData.priceCoefficient) && Number(formData.priceCoefficient) > 0)
  ) {
    formRef.value?.clearValidate(['priceCoefficient']);
  }
};
const submitForm = async () => {
  if ((await formRef.value?.validate()) !== true) return;
  if (formData.storeLevelId == null || formData.priceCoefficient == null) return;
  const name = storeLevels.value.find((level) => level.id === formData.storeLevelId)?.name ?? '门店级别';
  const payload = { storeLevelId: formData.storeLevelId, priceCoefficient: Number(formData.priceCoefficient) };
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
const confirmRow = ref<MarkupConfigurationRecord | null>(null);
const openConfirm = (row: MarkupConfigurationRecord) => {
  confirmRow.value = row;
  confirmVisible.value = true;
};
const submitConfirm = async () => {
  if (!confirmRow.value) return;
  const row = confirmRow.value;
  try {
    if (activeType.value === 'finished') await deleteFinishedMarkupConfiguration(row.id);
    else await deleteSlabMarkupConfiguration(row.id);
    await loadData();
    confirmVisible.value = false;
    adminFeedback.deleted(row.name);
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
.price-level-select,
.price-coefficient-input {
  width: 50%;
}
</style>
