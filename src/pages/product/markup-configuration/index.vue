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
            <t-breadcrumb-item>加价配置</t-breadcrumb-item>
          </t-breadcrumb>
          <t-tag theme="primary" variant="light">平台供货价规则</t-tag>
        </header>

        <section class="filter-card">
          <t-tabs v-if="showTabRail" v-model="activeType" :list="visibleTabs" />
          <t-alert
            theme="info"
            :message="pricingRuleMessage"
          />
          <t-form :data="searchForm" label-width="72px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="加价名称" name="name">
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
        </section>

        <section class="table-card">
          <div class="table-toolbar">
            <t-button v-if="canCreate" theme="primary" @click="openCreate">
              <template #icon><t-icon name="add" /></template>新增
            </t-button>
          </div>
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
            <template #markupRate="{ row }">{{ formatNumber(row.markupRate) }}%</template>
            <template #coefficient="{ row }">{{ formatNumber(1 + Number(row.markupRate) / 100, 4) }}</template>
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
      :header="editingId ? '编辑加价配置' : '新增加价配置'"
      @confirm="submitForm"
      @cancel="closeForm"
      @close="closeForm"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item label="加价名称" name="name">
          <t-input v-model="formData.name" :maxlength="20" clearable placeholder="例如：1级合伙人价格" />
        </t-form-item>
        <t-form-item v-if="activeType === 'finished'" label="加价率" name="markupRate">
          <t-input-number
            v-model="formData.markupRate"
            class="markup-rate-input"
            :min="0"
            :max="999.99"
            :decimal-places="2"
            suffix="%"
            @focus="handleMarkupRateFocus"
            @blur="handleMarkupRateBlur"
          />
        </t-form-item>
        <t-form-item v-else label="价格系数" name="priceCoefficient">
          <t-input-number
            v-model="formData.priceCoefficient"
            class="price-coefficient-input"
            :min="0"
            :max="999.99"
            :decimal-places="2"
            @focus="handlePriceCoefficientFocus"
            @blur="handlePriceCoefficientBlur"
          />
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminConfirmDialog
      v-model:visible="confirmVisible"
      :action="confirmType === 'delete' ? '删除' : confirmType === 'disable' ? '停用' : '启用'"
      object-type="加价配置"
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
import { requireCreatorOwnership } from '@/composables/useCreatorOwnershipGuard';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createFinishedMarkupConfiguration,
  deleteFinishedMarkupConfiguration,
  listFinishedMarkupConfigurations,
  reorderFinishedMarkupConfigurations,
  updateFinishedMarkupConfiguration,
  updateFinishedMarkupConfigurationStatus,
  type FinishedMarkupConfigurationRecord,
} from '@/services/finishedMarkupConfigurations';
import {
  createSlabMarkupConfiguration,
  deleteSlabMarkupConfiguration,
  listSlabMarkupConfigurations,
  reorderSlabMarkupConfigurations,
  updateSlabMarkupConfiguration,
  updateSlabMarkupConfigurationStatus,
  type SlabMarkupConfigurationRecord,
} from '@/services/slabMarkupConfigurations';

type PriceConfigurationTab = 'finished' | 'slab';
type MarkupConfigurationRecord = FinishedMarkupConfigurationRecord | SlabMarkupConfigurationRecord;

type ConfirmType = 'enable' | 'disable' | 'delete';

const tabs = [
  { label: '成品加价配置', value: 'finished' },
  { label: '大板加价配置', value: 'slab' },
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
const pricingRuleMessage = computed(() =>
  activeType.value === 'finished'
    ? '供货价 = 成本价 ×（1 + 加价率）；加价率可设为 0%，但不能小于 0%。调整加价率不会改变已发布商品的历史价格。'
    : '大板价格 = 成本价 × 价格系数；价格系数可以小于 1，但不能小于 0。调整价格系数不会改变已发布大板的现有价格。',
);

const loading = ref(false);
const tableData = ref<MarkupConfigurationRecord[]>([]);
const searchForm = reactive({ name: '', status: '' });
const appliedSearchForm = reactive({ ...searchForm });
const pagination = reactive({ current: 1, pageSize: 10 });
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(canSort.value ? [{ colKey: 'drag', title: 'dragTitle', width: 52, align: 'center' as const }] : []),
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'name', title: '加价名称', minWidth: 200, align: 'left' },
  ...(activeType.value === 'finished'
    ? [
        { colKey: 'markupRate', title: '加价率', width: 130, align: 'right' as const },
        { colKey: 'coefficient', title: '换算系数', width: 130, align: 'right' as const },
      ]
    : [{ colKey: 'priceCoefficient', title: '价格系数', width: 130, align: 'right' as const }]),
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
    const rows =
      activeType.value === 'finished' ? await listFinishedMarkupConfigurations() : await listSlabMarkupConfigurations();
    tableData.value = rows.map((item) => ({
      ...item,
      createdByName: item.createdByName ?? '-',
      createdAt: formatDateTime(item.createdAt),
    }));
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '加价配置加载失败');
  } finally {
    loading.value = false;
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
const formData = reactive<{
  name: string;
  markupRate: number | undefined;
  priceCoefficient: number | undefined;
}>({ name: '', markupRate: 0, priceCoefficient: 1 });
const formRules: Record<string, FormRule[]> = {
  name: [
    { required: true, message: '请输入加价名称', type: 'error' },
    { max: 20, message: '加价名称最多20个字', type: 'error' },
  ],
  markupRate: [{ required: true, message: '请输入加价率', type: 'error' }],
  priceCoefficient: [{ required: true, message: '请输入价格系数', type: 'error' }],
};
const openCreate = () => {
  editingId.value = null;
  Object.assign(formData, { name: '', markupRate: 0, priceCoefficient: 1 });
  formVisible.value = true;
};
const openEdit = (row: MarkupConfigurationRecord) => {
  if (!requireCreatorOwnership(row)) return;
  editingId.value = row.id;
  Object.assign(formData, {
    name: row.name,
    markupRate: 'markupRate' in row ? Number(row.markupRate) : 0,
    priceCoefficient: 'priceCoefficient' in row ? Number(row.priceCoefficient) : 1,
  });
  formVisible.value = true;
};
const closeForm = () => {
  formVisible.value = false;
  formRef.value?.clearValidate();
};
const handleMarkupRateFocus = () => {
  if (editingId.value == null) formData.markupRate = undefined;
};
const handleMarkupRateBlur = () => {
  if (formData.markupRate == null || !Number.isFinite(formData.markupRate)) formData.markupRate = 0;
};
const handlePriceCoefficientFocus = () => {
  if (editingId.value == null) formData.priceCoefficient = undefined;
};
const handlePriceCoefficientBlur = () => {
  if (formData.priceCoefficient == null || !Number.isFinite(formData.priceCoefficient)) formData.priceCoefficient = 1;
};
const sorting = ref(false);
const handleDragSort = async (context: { current: MarkupConfigurationRecord; target: MarkupConfigurationRecord }) => {
  if (!canSort.value || sorting.value) return;
  const orderedRows = tableData.value.map((item) => ({ ...item }));
  if (!requireCreatorOwnership(...orderedRows)) {
    await loadData();
    return;
  }
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
  try {
    if (activeType.value === 'finished') {
      const payload = { name, markupRate: formData.markupRate ?? 0 };
      if (editingId.value) await updateFinishedMarkupConfiguration(editingId.value, payload);
      else await createFinishedMarkupConfiguration(payload);
    } else {
      const payload = { name, priceCoefficient: formData.priceCoefficient ?? 1 };
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
  if (!requireCreatorOwnership(row)) return;
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
.table-toolbar {
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
.filter-card,
.table-card {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}
.filter-card > * + * {
  margin-top: var(--td-comp-margin-l);
}
.table-card {
  margin-top: var(--td-comp-margin-l);
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
.table-toolbar {
  min-height: 32px;
  margin-bottom: var(--td-comp-margin-l);
}
.markup-rate-input,
.price-coefficient-input {
  width: 50%;
}
</style>
