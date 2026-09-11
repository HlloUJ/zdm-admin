<template>
  <div ref="root" class="edit-changes">
    <div v-if="totalChanges" class="change-summary">
      变更对比<t-tag theme="primary" variant="light">{{ totalChanges }} 项</t-tag>
    </div>
    <section v-for="group in groups" :key="group.title" class="change-section">
      <header class="change-section-title">
        {{ group.title }}
      </header>
      <div class="change-section-body" :class="{ 'change-section-body--media': group.title === '图文描述' }">
        <component
          :is="row.field === '销售规格' ? SalesLogFullscreen : 'article'"
          v-for="row in group.rows"
          :key="row.field"
          class="change-field"
          @resize="measureSalesScroll"
        >
          <h4>{{ row.label }}</h4>
          <FinishedAttributeChanges v-if="row.field === '商品属性'" :before="row.before" :after="row.after" />
          <div
            v-else
            class="change-pair"
            :class="{
              'change-pair--sales': row.field === '销售规格',
              'change-pair--sales-synced': row.field === '销售规格' && syncSalesEnabled,
              'change-pair--wide': row.wide,
              'change-pair--media': group.title === '图文描述',
            }"
            @scroll.capture="row.field === '销售规格' && syncSalesScroll($event)"
          >
            <template v-for="side in sides" :key="side">
              <t-icon
                v-if="side === 'after' && group.title !== '图文描述'"
                :name="row.wide ? 'arrow-down' : 'arrow-right'"
                class="change-arrow"
                aria-hidden="true"
              />
              <div
                class="change-side"
                :class="[`change-side--${side}`, { 'change-side--media': group.title === '图文描述' }]"
              >
                <div class="change-side-title">
                  {{ side === 'before' ? '修改前' : '修改后' }}
                </div>
                <template v-if="row.media">
                  <button
                    v-if="row[side]?.resource?.available"
                    class="change-media"
                    type="button"
                    :aria-label="`查看${row.label}${side === 'before' ? '修改前' : '修改后'}`"
                    @click="emit('preview', row[side].resource)"
                  >
                    <video
                      v-if="row[side].resource.mediaType === 'video'"
                      :src="row[side].resource.url"
                      preload="metadata"
                      muted
                    />
                    <img v-else :src="row[side].resource.url" :alt="row.label" />
                    <span v-if="row[side].resource.mediaType === 'video'">点击播放视频</span>
                  </button>
                  <span v-else>{{ row[side] ? row[side].resource?.message || '历史媒体已不可用' : '未上传' }}</span>
                </template>
                <div
                  v-else-if="row.field === '宝贝详情'"
                  class="change-rich-scroll"
                  tabindex="0"
                  :aria-label="`宝贝详情${side === 'before' ? '修改前' : '修改后'}`"
                >
                  <HistoricalRichText
                    :html="side === 'before' ? beforeHtml : afterHtml"
                    :media="media"
                    @preview="emit('preview', $event)"
                  />
                </div>
                <FinishedSalesLogTable
                  v-else-if="row.field === '销售规格'"
                  :snapshot="salesSnapshot(side)"
                  highlight-changes
                  :other="salesSnapshot(side === 'before' ? 'after' : 'before')"
                />
                <FinishedLogValue
                  v-else
                  :value="row[side]"
                  :field-names="attributeNames(side)"
                  :hidden-columns="['商品属性', '销售规格'].includes(row.field) ? ['status'] : []"
                />
              </div>
            </template>
            <div
              v-if="row.field === '销售规格' && syncSalesEnabled"
              v-show="salesScrollWidth > 0"
              class="sales-shared-scroll"
              tabindex="0"
              aria-label="销售规格修改前后横向滚动"
            >
              <div :style="{ width: `${salesScrollWidth}px`, height: '1px' }" />
            </div>
          </div>
        </component>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import SalesLogFullscreen from './SalesLogFullscreen.vue';
import HistoricalRichText from './HistoricalRichText.vue';
import FinishedLogValue from './FinishedLogValue.vue';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';
import FinishedAttributeChanges from './FinishedAttributeChanges.vue';
type Resource = { available: boolean; url?: string; mediaType: string; message?: string; previewOnly?: boolean };
type Media = { field: string; mediaId: number; resource?: Resource };
type Change = { before: unknown; after: unknown };
type Row = { field: string; label: string; before: any; after: any; wide: boolean; media?: boolean };
const props = defineProps<{ changes: Record<string, Change>; media: Media[]; beforeHtml: string; afterHtml: string }>();
const emit = defineEmits<{ preview: [resource: Resource] }>();
const root = ref<HTMLElement>();
const salesScrollWidth = ref(0);
const syncSalesEnabled = computed(() => {
  const dimensions = props.changes['规格维度'];
  const isLayered = (value: unknown) => Array.isArray(value) && value.length > 0;
  return isLayered(dimensions?.before) === isLayered(dimensions?.after);
});
let resizeObserver: ResizeObserver | undefined;
let salesPair: Element | null = null;
function measureSalesScroll() {
  const pair = root.value?.querySelector('.change-pair--sales') || salesPair;
  salesPair = pair || null;
  if (!pair || !syncSalesEnabled.value) {
    salesScrollWidth.value = 0;
    return;
  }
  const tables = Array.from(pair.querySelectorAll<HTMLElement>('.t-table__content'));
  const range = Math.max(0, ...tables.map((table) => table.scrollWidth - table.clientWidth));
  salesScrollWidth.value = range ? pair.clientWidth + range : 0;
}
async function observeSalesTables() {
  await nextTick();
  resizeObserver?.disconnect();
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measureSalesScroll);
    root.value
      ?.querySelectorAll('.change-pair--sales, .change-pair--sales table')
      .forEach((el) => resizeObserver?.observe(el));
  }
  measureSalesScroll();
}
onMounted(observeSalesTables);
watch(() => props.changes, observeSalesTables);
onBeforeUnmount(() => resizeObserver?.disconnect());
const scrollPositions = new WeakMap<HTMLElement, number>();
function syncSalesScroll(event: Event) {
  if (!syncSalesEnabled.value) return;
  const source = event.target;
  const pair = event.currentTarget;
  if (!(source instanceof HTMLElement) || !(pair instanceof HTMLElement)) return;
  if (!source.matches('.sales-log-table .t-table__content, .sales-shared-scroll')) return;
  const left = source.scrollLeft;
  if (scrollPositions.get(source) === left) return;
  scrollPositions.set(source, left);
  pair.querySelectorAll<HTMLElement>('.sales-log-table .t-table__content, .sales-shared-scroll').forEach((target) => {
    if (target === source || target.scrollLeft === left) return;
    target.scrollLeft = left;
    scrollPositions.set(target, target.scrollLeft);
  });
}
const sides = ['before', 'after'] as const;
function attributeNames(side: 'before' | 'after') {
  const value = props.changes['销售属性名称']?.[side];
  return value && typeof value === 'object' ? (value as Record<string, string>) : {};
}
function salesSnapshot(side: 'before' | 'after'): Record<string, unknown> {
  return Object.fromEntries(
    ['销售规格', '规格维度', '指导价', '层级价格', '销售属性名称']
      .filter((field) => props.changes[field])
      .map((field) => [field, props.changes[field][side]]),
  );
}
const groups = computed(() => {
  const mediaValues = (side: 'before' | 'after'): Media[] =>
    Array.isArray(props.changes['媒体']?.[side]) ? (props.changes['媒体'][side] as Media[]) : [];
  const before = mediaValues('before');
  const after = mediaValues('after');
  const fields = [...new Set([...before, ...after].map((item) => item.field))]
    .filter((field) => /^mainImage[2-5]?$/.test(field) || field === 'video')
    .sort();
  const imageRows: Row[] = fields.flatMap((field) => {
    const old = before.find((item) => item.field === field);
    const next = after.find((item) => item.field === field);
    return old?.mediaId === next?.mediaId
      ? []
      : [
          {
            field,
            label: field === 'video' ? '商品视频' : `商品主图${field.replace('mainImage', '') || '1'}`,
            before: old,
            after: next,
            media: true,
            wide: false,
          },
        ];
  });
  const base = ['商品名称', '商品分类', '商品属性', '供应商'];
  const sales = ['销售规格', '总库存', '商家编码', '状态', '下架原因', '详细说明', '下架时间'];
  const displayChanges: Record<string, Change> = { ...props.changes };
  if (['销售规格', '规格维度', '指导价', '层级价格'].some((field) => props.changes[field])) {
    displayChanges['销售规格'] = { before: salesSnapshot('before'), after: salesSnapshot('after') };
  }
  const row = (field: string): Row => ({
    field,
    label: field === '状态' ? '上架状态' : field === '层级价格' ? '合伙人价格' : field,
    ...displayChanges[field],
    wide: ['商品属性', '规格维度', '销售规格', '成本价', '指导价', '层级价格'].includes(field),
  });
  if (props.changes['宝贝详情']) imageRows.push(row('宝贝详情'));
  const known = new Set([...base, ...sales, '媒体', '宝贝详情', '销售属性名称', '规格维度', '指导价', '层级价格']);
  return [
    { title: '图文描述', rows: imageRows },
    { title: '基础信息', rows: base.filter((field) => props.changes[field]).map(row) },
    { title: '销售信息', rows: sales.filter((field) => displayChanges[field]).map(row) },
    ...(Object.keys(props.changes).some((field) => !known.has(field))
      ? [
          {
            title: '其他信息',
            rows: Object.keys(props.changes)
              .filter((field) => !known.has(field))
              .map(row),
          },
        ]
      : []),
  ].filter((group) => group.rows.length > 0);
});
const totalChanges = computed(() => groups.value.reduce((total, group) => total + group.rows.length, 0));
</script>
<style scoped>
.change-pair--sales-synced :deep(.t-table__content) {
  scrollbar-width: none;
}
.change-pair--sales-synced :deep(.t-table__content::-webkit-scrollbar) {
  display: none;
}
.sales-shared-scroll {
  min-width: 0;
  overflow: scroll hidden;
  height: 16px;
}

.edit-changes {
  display: grid;
  gap: var(--td-comp-margin-l);
}
.change-summary {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
}
.change-section {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
}
.change-section-title {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-m);
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
}
.change-section-body {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  display: grid;
  gap: var(--td-comp-margin-xl);
}
.change-section-body--media {
  gap: var(--td-comp-margin-l);
}
.change-field {
  min-width: 0;
}
.change-field h4 {
  margin: 0 0 var(--td-comp-margin-s);
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  font-weight: 600;
}
.change-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr);
  gap: var(--td-comp-margin-s);
}
.change-pair--media {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.change-arrow {
  place-self: center;
  color: var(--td-brand-color);
  font-size: var(--td-font-size-title-medium);
}
.change-pair--wide {
  grid-template-columns: minmax(0, 1fr);
}
.change-side {
  min-width: 0;
  min-height: 64px;
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-m);
  border-radius: var(--td-radius-default);
  color: var(--td-text-color-primary);
  overflow-wrap: anywhere;
}
.change-side--before {
  background: var(--td-bg-color-secondarycontainer);
}
.change-side--after {
  background: var(--td-brand-color-light);
}
.change-side--media {
  padding: 0;
  min-height: 0;
  background: transparent;
}
.change-side--media .change-side-title {
  margin-bottom: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}
.change-side-title {
  margin-bottom: var(--td-comp-margin-xs);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}
.change-side :deep(.historical-rich-text) {
  background: transparent;
  padding: 0;
}
.change-rich-scroll {
  height: 360px;
  max-height: 60vh;
  overflow: auto;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default);
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-m);
}
.change-rich-scroll :deep(.historical-rich-text) {
  width: 640px;
  min-width: 100%;
}
.change-media {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--td-comp-margin-s);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.change-media img,
.change-media video {
  width: 180px;
  height: 108px;
  border-radius: var(--td-radius-default);
  object-fit: contain;
}
</style>
