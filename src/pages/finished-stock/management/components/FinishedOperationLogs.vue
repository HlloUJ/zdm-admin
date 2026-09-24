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
    subject-label="商品"
    keyword-placeholder="商品名称/ID"
    :status-label="state"
    :format-time="time"
    :source-label="sourceLabel"
    @filter-change="updateFilter"
    @search="search"
    @reset="reset"
    @page-change="changePage"
    @open-detail="showDetail"
  >
    <template #detail>
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
    :visible="!!preview"
    header="历史媒体"
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
        class="history-large-media" /><img v-else :src="preview.url" alt="历史图片" class="history-large-media"
    /></template>
  </AdminDialog>
</template>
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import { getLoginUser } from '@/services/auth';
import { AdminDialog, adminFeedback } from '@/components/foundation';
import ProductOperationLogTemplate from '@/components/product-logs/ProductOperationLogTemplate.vue';
import { productOperationTypeOptions, type ProductOperationLogRow } from '@/services/productOperationLog';
import {
  listFinishedOperationLogs,
  getFinishedOperationLog,
  finishedLogStates,
  type FinishedOperationLog,
} from '@/services/finishedOperationLogs';
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
const typeOptions = productOperationTypeOptions([
  'CREATE',
  'UPDATE',
  'PRICE_UPDATE',
  'SHELF',
  'OFF_SHELF',
  'RESTORE',
  'DELETE_TO_RECYCLE',
  'PURGE',
  'SOLD_OUT',
  'SOURCE_SHELF',
  'SOURCE_OFF_SHELF',
  'SOURCE_DELETE',
  'RESTORE_WAREHOUSE',
]);
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
const changes = computed<Record<string, { before: unknown; after: unknown; hint?: string }>>(() => {
  try {
    return JSON.parse(detail.value?.changeDetails || '{}');
  } catch {
    return {};
  }
});
const fullSnapshot = computed(
  () =>
    detail.value?.operationType === 'CREATE' ||
    (detail.value?.operationType === 'SOURCE_SHELF' && !!changes.value['商品ID'] && !!changes.value['销售规格']),
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
const time = (value?: string) => {
  if (!value) return '-';
  const timestamp = new Date(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  if (Number.isNaN(timestamp.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
};
</script>
<style scoped>
.operation-reason-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.history-media-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
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
