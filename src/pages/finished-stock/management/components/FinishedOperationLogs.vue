<template>
  <t-drawer
    :visible="visible"
    header="操作日志"
    size="min(1240px, 100vw)"
    :footer="false"
    @update:visible="emit('update:visible', $event)"
  >
    <t-space direction="vertical" size="large" style="width: 100%">
      <t-form :data="filter" label-width="44px" colon>
        <div class="operation-log-filters">
          <t-form-item label="商品" class="operation-log-keyword-filter">
            <t-input v-model="filter.keyword" clearable placeholder="商品名称/ID/商家编码" />
          </t-form-item>
          <t-form-item label="操作类型" label-width="72px">
            <t-select v-model="filter.operationType" clearable placeholder="请选择">
              <t-option v-for="item in typeOptions" :key="item.value" v-bind="item" />
            </t-select>
          </t-form-item>
          <t-form-item label="操作人" label-width="60px" class="operation-log-operator-filter">
            <t-input v-model="filter.operatorName" clearable placeholder="请输入操作人" />
          </t-form-item>
          <t-form-item label="操作时间" label-width="72px" class="operation-log-date-filter">
            <t-date-range-picker
              v-model="dateRange"
              class="operation-log-date-picker"
              clearable
              allow-input
              value-type="YYYY-MM-DD"
              :placeholder="['开始日期', '结束日期']"
            />
          </t-form-item>
          <div class="operation-log-filter-actions">
            <t-button theme="primary" @click="search">
              <template #icon><t-icon name="search" /></template>
              查询
            </t-button>
            <t-button theme="default" variant="base" @click="reset">
              <template #icon><t-icon name="refresh" /></template>
              重置
            </t-button>
          </div>
        </div>
      </t-form>
      <t-table row-key="id" :data="records" :columns="columns" :loading="loading" hover>
        <template #productName="{ row }"
          ><div>{{ row.productName }}</div>
          <div>ID：{{ row.productId }}</div>
          <div>商家编码：{{ row.merchantCode || '—' }}</div></template
        >
        <template #operationType="{ row }">{{ finishedLogTypes[row.operationType] || row.operationType }}</template>
        <template #operatedAt="{ row }">{{ time(row.operatedAt) }}</template>
        <template #operation="{ row }"><t-link theme="primary" @click="showDetail(row.id)">详情</t-link></template>
        <template #empty>暂无操作日志</template>
      </t-table>
      <AdminPagination
        v-model:current="filter.page"
        v-model:page-size="filter.pageSize"
        :total="total"
        @change="load"
      />
    </t-space>
  </t-drawer>
  <AdminDialog
    v-model:visible="detailVisible"
    header="操作详情"
    width="min(1040px, 94vw)"
    :cancel-btn="null"
    confirm-btn="关闭"
    @confirm="detailVisible = false"
  >
    <t-space v-if="detail" direction="vertical" size="large" style="width: 100%">
      <t-descriptions title="操作信息" bordered :column="3">
        <t-descriptions-item label="商品名称">{{ detail.productName }}</t-descriptions-item>
        <t-descriptions-item label="商家编码">{{ detail.merchantCode || '—' }}</t-descriptions-item>
        <t-descriptions-item label="操作类型">{{ finishedLogTypes[detail.operationType] }}</t-descriptions-item>
        <t-descriptions-item label="操作人">{{ detail.operatorName }}</t-descriptions-item>
        <t-descriptions-item label="操作时间">{{ time(detail.operatedAt) }}</t-descriptions-item>
        <t-descriptions-item label="操作来源">{{
          detail.operationSource === 'MANUAL' ? '运营管理平台' : detail.operationSource
        }}</t-descriptions-item>
        <t-descriptions-item label="操作内容" :span="2">{{ detail.operationSummary }}</t-descriptions-item>
        <t-descriptions-item label="状态变化"
          >{{ state(detail.beforeStatus) }} → {{ state(detail.afterStatus) }}</t-descriptions-item
        >
      </t-descriptions>
      <FinishedCreationSnapshot
        v-if="detail.operationType === 'CREATE'"
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
      <t-descriptions v-if="detail.operationType === 'OFF_SHELF'" title="操作说明" bordered :column="2">
        <t-descriptions-item label="原因">{{ detail.standardReason || '未填写' }}</t-descriptions-item>
        <t-descriptions-item label="批次号">{{ detail.batchNo || '未填写' }}</t-descriptions-item>
        <t-descriptions-item label="详细说明" :span="2">
          <span class="operation-reason-text">{{ detail.detailReason || '未填写' }}</span>
        </t-descriptions-item>
      </t-descriptions>
    </t-space>
  </AdminDialog>
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
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { AdminDialog, AdminPagination, adminFeedback } from '@/components/foundation';
import {
  listFinishedOperationLogs,
  getFinishedOperationLog,
  finishedLogTypes,
  finishedLogStates,
  type FinishedOperationLog,
} from '@/services/finishedOperationLogs';
import FinishedEditChanges from './FinishedEditChanges.vue';
import FinishedCreationSnapshot from './FinishedCreationSnapshot.vue';
const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();
const filter = reactive({
  keyword: '',
  operationType: '',
  operatorName: '',
  startDate: '',
  endDate: '',
  page: 1,
  pageSize: 10,
});
const dateRange = ref<string[]>([]);
const records = ref<FinishedOperationLog[]>([]);
const total = ref(0);
const loading = ref(false);
const detail = ref<FinishedOperationLog | null>(null);
const detailVisible = ref(false);
type Resource = { available: boolean; url?: string; mediaType: string; message?: string; previewOnly?: boolean };
type Media = { field: string; mediaId: number; resource?: Resource };
const preview = ref<Resource | null>(null);
const typeOptions = Object.entries(finishedLogTypes).map(([value, label]) => ({ value, label }));
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'productName', title: '商品名称/ID/商家编码', minWidth: 220 },
  { colKey: 'operationType', title: '操作类型', width: 140 },
  { colKey: 'operationSummary', title: '操作内容', minWidth: 180 },
  { colKey: 'operatorName', title: '操作人', width: 120 },
  { colKey: 'operatedAt', title: '操作时间', width: 180 },
  { colKey: 'operation', title: '操作', width: 80, fixed: 'right' },
];
let requestId = 0;
async function load() {
  const id = ++requestId;
  loading.value = true;
  try {
    const page = await listFinishedOperationLogs({ ...filter });
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
  filter.page = 1;
  filter.startDate = dateRange.value?.[0] || '';
  filter.endDate = dateRange.value?.[1] || '';
  void load();
}
function reset() {
  Object.assign(filter, { keyword: '', operationType: '', operatorName: '', startDate: '', endDate: '', page: 1 });
  dateRange.value = [];
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
const displayChanges = computed(() => {
  const operationType = detail.value?.operationType || '';
  if (['DELETE_TO_RECYCLE', 'PURGE'].includes(operationType)) return {};
  return ['SHELF', 'OFF_SHELF', 'RESTORE'].includes(operationType)
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
      title: `${detail.value?.operationType === 'CREATE' ? '' : side === 'before' ? '修改前 · ' : '修改后 · '}${media.field === 'video' ? '商品视频' : media.field.startsWith('detail') ? '详情媒体' : '商品主图'}`,
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
const state = (value?: string) => (value ? finishedLogStates[value] || value : '—');
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
.operation-log-filters {
  display: grid;
  grid-template-columns: 234px minmax(150px, 180px) minmax(150px, 180px) 332px auto;
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
  width: 260px;
}

.operation-log-filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
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
