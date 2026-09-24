<template>
  <t-drawer
    :visible="visible"
    header="操作日志"
    size="min(1240px, 100vw)"
    :footer="false"
    @update:visible="emit('update:visible', $event)"
  >
    <t-space direction="vertical" size="large" style="width: 100%">
      <t-form class="zdm-admin-filter-form" label-width="auto" :data="filter" colon>
        <div class="operation-log-filters">
          <t-form-item :label="subjectLabel" class="operation-log-keyword-filter">
            <t-input
              :value="filter.keyword"
              clearable
              :placeholder="keywordPlaceholder"
              @change="emit('filter-change', 'keyword', $event)"
            />
          </t-form-item>
          <t-form-item label="操作类型">
            <t-select
              :value="filter.operationType"
              clearable
              placeholder="请选择"
              @change="emit('filter-change', 'operationType', String($event || ''))"
            >
              <t-option v-for="item in typeOptions" :key="item.value" v-bind="item" />
            </t-select>
          </t-form-item>
          <t-form-item label="操作人" class="operation-log-operator-filter">
            <t-input
              :value="filter.operatorName"
              clearable
              placeholder="请输入"
              @change="emit('filter-change', 'operatorName', $event)"
            />
          </t-form-item>
          <t-form-item label="操作时间" class="operation-log-date-filter">
            <t-date-range-picker
              :value="filter.dateRange"
              class="operation-log-date-picker"
              clearable
              allow-input
              value-type="YYYY-MM-DD"
              :placeholder="['开始日期', '结束日期']"
              @change="emit('filter-change', 'dateRange', Array.isArray($event) ? $event : [])"
            />
          </t-form-item>
          <div class="operation-log-filter-actions">
            <t-button theme="primary" @click="emit('search')"
              ><template #icon><t-icon name="search" /></template>查询</t-button
            >
            <t-button theme="default" variant="base" @click="emit('reset')"
              ><template #icon><t-icon name="refresh" /></template>重置</t-button
            >
          </div>
        </div>
      </t-form>
      <t-table row-key="id" :data="records" :columns="columns" :loading="loading" hover>
        <template #subjectName="{ row }">
          <div>{{ row.subjectName }}</div>
          <div>ID：{{ row.subjectId }}</div>
          <div v-if="row.subjectCode && subjectCodeLabel">{{ subjectCodeLabel }}：{{ row.subjectCode }}</div>
        </template>
        <template #operationType="{ row }">{{ productOperationTypeLabel(row.operationType) }}</template>
        <template #operationSummary="{ row }">{{ productOperationSummary(row) }}</template>
        <template #operatedAt="{ row }">{{ formatTime(row.operatedAt) }}</template>
        <template #operation="{ row }"
          ><t-link theme="primary" @click="emit('open-detail', row.id)">详情</t-link></template
        >
        <template #empty>暂无操作日志</template>
      </t-table>
      <AdminPagination
        :current="pagination.current"
        :page-size="pagination.pageSize"
        :total="total"
        @change="emit('page-change', $event)"
      />
    </t-space>
  </t-drawer>
  <AdminDialog
    :visible="detailVisible"
    header="操作详情"
    width="min(1240px, 94vw)"
    :cancel-btn="null"
    confirm-btn="关闭"
    @confirm="emit('update:detailVisible', false)"
    @update:visible="emit('update:detailVisible', $event)"
  >
    <t-space v-if="detail" direction="vertical" size="large" style="width: 100%">
      <t-descriptions title="操作信息" bordered :column="3">
        <t-descriptions-item :label="`${subjectLabel}名称`" :span="3">{{ detail.subjectName }}</t-descriptions-item>
        <t-descriptions-item label="操作类型">{{
          productOperationTypeLabel(detail.operationType)
        }}</t-descriptions-item>
        <t-descriptions-item label="操作人">{{ detail.operatorName }}</t-descriptions-item>
        <t-descriptions-item label="操作时间">{{ formatTime(detail.operatedAt) }}</t-descriptions-item>
        <t-descriptions-item label="操作来源">{{ sourceLabel(detail) }}</t-descriptions-item>
        <t-descriptions-item label="操作内容">{{ productOperationSummary(detail) }}</t-descriptions-item>
        <t-descriptions-item v-if="detail.beforeStatus || detail.afterStatus" label="状态变化">
          {{ statusLabel(detail.beforeStatus) }} → {{ statusLabel(detail.afterStatus) }}
        </t-descriptions-item>
      </t-descriptions>
      <slot name="detail" :detail="detail" />
      <t-descriptions
        v-if="showReason(detail) && (detail.standardReason || detail.detailReason)"
        title="操作说明"
        bordered
        :column="2"
      >
        <t-descriptions-item label="原因" :span="2">{{ detail.standardReason || '未填写' }}</t-descriptions-item>
        <t-descriptions-item label="详细说明" :span="2">{{ detail.detailReason || '未填写' }}</t-descriptions-item>
      </t-descriptions>
    </t-space>
  </AdminDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import type { PageInfo } from 'tdesign-vue-next';
import { AdminDialog, AdminPagination } from '@/components/foundation';
import {
  productLogTime,
  productOperationSummary,
  productOperationTypeLabel,
  type ProductOperationLogRow,
} from '@/services/productOperationLog';

type Filter = { keyword: string; operationType: string; operatorName: string; dateRange: string[] };
type Pagination = { current: number; pageSize: number };
const props = withDefaults(
  defineProps<{
    visible: boolean;
    detailVisible: boolean;
    records: ProductOperationLogRow[];
    detail: ProductOperationLogRow | null;
    total: number;
    loading?: boolean;
    filter: Filter;
    pagination: Pagination;
    typeOptions: { value: string; label: string }[];
    subjectLabel: string;
    keywordPlaceholder: string;
    subjectCodeLabel?: string;
    statusLabel: (value?: string | null) => string;
    formatTime?: (value?: string) => string;
    sourceLabel: (row: ProductOperationLogRow) => string;
    showReason?: (row: ProductOperationLogRow) => boolean;
  }>(),
  { loading: false, subjectCodeLabel: '', formatTime: productLogTime, showReason: () => true },
);
const emit = defineEmits<{
  'update:visible': [value: boolean];
  'update:detailVisible': [value: boolean];
  search: [];
  reset: [];
  'filter-change': [field: keyof Filter, value: string | string[]];
  'page-change': [page: PageInfo];
  'open-detail': [id: number];
}>();
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  {
    colKey: 'subjectName',
    title: `${props.subjectLabel}名称/ID${props.subjectCodeLabel ? `/${props.subjectCodeLabel}` : ''}`,
    minWidth: 220,
  },
  { colKey: 'operationType', title: '操作类型', width: 140 },
  { colKey: 'operationSummary', title: '操作内容', minWidth: 180 },
  { colKey: 'operatorName', title: '操作人', width: 120 },
  { colKey: 'operatedAt', title: '操作时间', width: 180 },
  { colKey: 'operation', title: '操作', width: 76, fixed: 'right' },
]);
</script>

<style scoped>
.operation-log-filters {
  display: grid;
  grid-template-columns: 234px minmax(150px, 210px) minmax(120px, 150px) 332px auto;
  align-items: center;
  gap: var(--td-comp-margin-m);
}
.operation-log-filters :deep(.t-form__item) {
  margin-bottom: 0;
}
.operation-log-keyword-filter {
  width: 234px;
}
.operation-log-date-filter {
  width: 332px;
}
.operation-log-date-picker {
  flex-shrink: 0;
  width: 260px;
}
.operation-log-filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}
</style>
