<template>
  <ProductOperationLogTemplate
    v-model:visible="visibleProxy"
    v-model:detail-visible="detailVisible"
    :records="logRows"
    :detail="detailRow"
    :total="total"
    :loading="loading"
    :filter="filter"
    :pagination="pagination"
    :type-options="typeOptions"
    operation-type-popup-min-width="240px"
    subject-label="商品"
    keyword-placeholder="商品名称/ID"
    :status-label="state"
    :format-time="time"
    :source-label="sourceLabel"
    :summary-label="finishedProductOperationSummary"
    @filter-change="updateFilter"
    @search="search"
    @reset="reset"
    @page-change="changePage"
    @open-detail="showDetail"
  >
    <template #detail>
      <t-alert v-if="legacyArrivalPrices" theme="info" message="历史日志仅记录已生成的价格，未记录完整价格层级" />
      <SalesLogFullscreen v-if="initialWarehousePrice" title="入仓价格">
        <FinishedSalesLogTable :snapshot="priceLogSnapshot(changes['入仓价格'].after)" :other="{}" price-only />
      </SalesLogFullscreen>
      <FinishedCreationSnapshot
        v-if="fullSnapshot"
        :snapshot="creationSnapshot"
        :category-hint="changes['商品分类']?.hint"
        :media="allMediaRows"
        :rich-text="richText('after')"
        @preview="preview = $event"
      />
      <FinishedEditChanges
        v-else-if="Object.keys(displayChanges).length"
        :changes="displayChanges"
        :media="allMediaRows"
        :before-html="richText('before')"
        :after-html="richText('after')"
        @preview="preview = $event"
      />
    </template>
  </ProductOperationLogTemplate>
  <AdminDialog
    :confirmation="{ kind: 'none' }"
    confirm-function="close"
    :visible="!!preview"
    header="历史媒体"
    mode="modal"
    show-overlay
    close-on-overlay-click
    width="min(960px, 94vw)"
    :footer="false"
    @close="preview = null"
    @cancel="preview = null"
    @update:visible="!$event && (preview = null)"
  >
    <template v-if="preview"
      ><t-alert v-if="preview.message" :message="preview.message" /><video
        v-if="preview.mediaType === 'video'"
        :src="preview.url"
        controls
        class="history-large-media" /><img v-else :src="preview.url" alt="历史图片" style="max-width: 100%"
    /></template>
  </AdminDialog>
</template>
<script setup lang="ts">
import { useCommodityModule } from '@/composables/useCommodityModule';
const commodity = useCommodityModule();

import { computed, reactive, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import { formatProductDateTime } from '@/utils/formatProductDateTime';
import { getLoginUser } from '@/services/auth';
import { AdminDialog, adminFeedback } from '@/components/foundation';
import ProductOperationLogTemplate from '@/components/product-logs/ProductOperationLogTemplate.vue';
import {
  finishedProductOperationSummary,
  productLogFilterOptions,
  type ProductOperationLogRow,
} from '@/services/productOperationLog';
import { type FinishedOperationLog } from '@/services/finishedOperationLogs';
const { listFinishedOperationLogs, getFinishedOperationLog, finishedLogStates } = commodity.logs;
import SalesLogFullscreen from './SalesLogFullscreen.vue';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';
import { priceLogSnapshot } from '../priceLogSnapshot';
import FinishedEditChanges from './FinishedEditChanges.vue';
import FinishedCreationSnapshot from './FinishedCreationSnapshot.vue';
const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();
const visibleProxy = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
});
const filter = reactive({
  keyword: '',
  operationType: '',
  operatorName: '',
  dateRange: [] as string[],
});
const pagination = reactive({ current: 1, pageSize: 10 });
const updateFilter = (field: string, value: string | string[]) => Object.assign(filter, { [field]: value });
function changePage(page: { current: number; pageSize: number }) {
  Object.assign(pagination, page);
  void load();
}
const records = ref<FinishedOperationLog[]>([]);
const total = ref(0);
const loading = ref(false);
const detail = ref<FinishedOperationLog | null>(null);
const detailVisible = ref(false);
type Resource = { available: boolean; url?: string; mediaType: string; message?: string; previewOnly?: boolean };
type Media = { field: string; mediaId: number; resource?: Resource };
const preview = ref<Resource | null>(null);
const typeOptions = computed(() =>
  productLogFilterOptions(getLoginUser().clientCode === 'supply-chain' ? 'supply-chain' : 'admin', true),
);
const toLogRow = (row: FinishedOperationLog): ProductOperationLogRow => ({
  id: row.id,
  subjectName: row.productName,
  subjectId: row.productId,
  subjectCode: row.merchantCode,
  operationType: row.operationType,
  operationSummary: row.operationSummary,
  operatorName: row.operatorName,
  operatedAt: row.operatedAt,
  operationSource: row.operationSource,
  beforeStatus: row.beforeStatus,
  afterStatus: row.afterStatus,
  standardReason: row.standardReason,
  detailReason: row.detailReason,
});
const logRows = computed(() => records.value.map(toLogRow));
const detailRow = computed(() => detail.value && toLogRow(detail.value));
const sourceLabel = (row: ProductOperationLogRow) =>
  row.operationSource === 'MANUAL'
    ? getLoginUser().clientCode === 'supply-chain'
      ? '供应链协同系统'
      : '运营管理平台'
    : row.operationSource === 'SUPPLY_CHAIN'
      ? '供应链协同系统'
      : row.operationSource || '—';
let requestId = 0;
async function load() {
  const id = ++requestId;
  loading.value = true;
  try {
    const page = await listFinishedOperationLogs({
      keyword: filter.keyword,
      operationType: filter.operationType,
      operatorName: filter.operatorName,
      startDate: filter.dateRange[0] || '',
      endDate: filter.dateRange[1] || '',
      page: pagination.current,
      pageSize: pagination.pageSize,
    });
    if (id === requestId) {
      records.value = page.records;
      total.value = page.total;
    }
  } catch {
    if (id === requestId) adminFeedback.error('操作日志加载失败，请重试');
  } finally {
    if (id === requestId) loading.value = false;
  }
}
function search() {
  pagination.current = 1;
  void load();
}
function reset() {
  Object.assign(filter, { keyword: '', operationType: '', operatorName: '', dateRange: [] });
  pagination.current = 1;
  void load();
}
async function showDetail(id: number) {
  try {
    detail.value = await getFinishedOperationLog(id);
    detailVisible.value = true;
  } catch {
    adminFeedback.error('操作详情加载失败，请重试');
  }
}
watch(
  () => props.visible,
  (visible) => {
    if (visible) void load();
  },
);
const changes = computed<Record<string, { before: unknown; after: unknown; hint?: string; complete?: boolean }>>(() => {
  try {
    return JSON.parse(detail.value?.changeDetails || '{}');
  } catch {
    return {};
  }
});
const fullSnapshot = computed(
  () =>
    detail.value?.operationType === 'CREATE' ||
    (['SOURCE_SHELF', 'REENTRY'].includes(detail.value?.operationType || '') &&
      !!changes.value['商品ID'] &&
      !!changes.value['销售规格']),
);
const legacyArrivalPrices = computed(
  () =>
    getLoginUser().clientCode === 'admin' &&
    detail.value?.operationType === 'SOURCE_SHELF' &&
    !detail.value.beforeStatus &&
    !changes.value['层级价格']?.complete,
);
const initialWarehousePrice = computed(
  () =>
    getLoginUser().clientCode === 'admin' &&
    detail.value?.operationType === 'SOURCE_SHELF' &&
    !!changes.value['入仓价格'],
);
const displayChanges = computed(() => {
  if (initialWarehousePrice.value)
    return Object.fromEntries(
      Object.entries(changes.value).filter(([field]) => !['来源状态', '入仓价格'].includes(field)),
    );
  const operationType = detail.value?.operationType || '';
  if (['DELETE_TO_RECYCLE', 'PURGE'].includes(operationType)) return {};
  if (operationType === 'UPDATE' && getLoginUser().clientCode === 'supply-chain') {
    // detailRow still shows beforeStatus/afterStatus under 操作信息 > 状态变化.
    return Object.fromEntries(Object.entries(changes.value).filter(([field]) => field !== '状态'));
  }
  return ['SHELF', 'OFF_SHELF', 'RESTORE', 'RESTORE_WAREHOUSE'].includes(operationType)
    ? Object.fromEntries(
        Object.entries(changes.value).filter(
          ([field]) => !['状态', '下架原因', '详细说明', '下架时间'].includes(field),
        ),
      )
    : changes.value;
});
const creationSnapshot = computed(() =>
  Object.fromEntries(Object.entries(changes.value).map(([field, change]) => [field, change.after])),
);
const allMediaRows = computed(() =>
  ['before', 'after'].flatMap((side) => {
    const values = changes.value['媒体']?.[side as 'before' | 'after'];
    return (Array.isArray(values) ? (values as Media[]) : []).map((media) => ({
      ...media,
      title: `${fullSnapshot.value ? '' : side === 'before' ? '修改前 · ' : '修改后 · '}${media.field === 'video' ? '商品视频' : media.field.startsWith('detail') ? '详情媒体' : '商品主图'}`,
    }));
  }),
);
function richText(side: 'before' | 'after') {
  const html = String(changes.value['宝贝详情']?.[side] || '');
  return DOMPurify.sanitize(
    html.replace(
      /media:(\d+)/g,
      (_match, id) => allMediaRows.value.find((media) => media.mediaId === Number(id))?.resource?.url || '',
    ),
    { ADD_TAGS: ['video'], ADD_ATTR: ['controls'] },
  );
}
const state = (value?: string | null) =>
  value === 'selling' && getLoginUser().clientCode === 'supply-chain'
    ? '已上架'
    : value
      ? finishedLogStates[value] || value
      : '—';
// Finished product log APIs return UTC; store logs have their own wall-time formatter.
const time = formatProductDateTime;
</script>
<style scoped>
.operation-reason-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.history-media-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--td-comp-margin-xxl);
}
.history-media-button {
  display: block;
  width: 100%;
  height: 150px;
  padding: 0;
  border: 0;
  cursor: pointer;
  background: transparent;
}
.history-media-button img,
.history-media-button video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.history-large-media {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: auto;
}
.history-rich-text {
  overflow-wrap: anywhere;
}
.history-rich-text :deep(img),
.history-rich-text :deep(video) {
  max-width: 100%;
}
</style>
