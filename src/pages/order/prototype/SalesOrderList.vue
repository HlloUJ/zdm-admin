<template>
  <div class="sales-order-list">
    <AdminListPage
      :table-props="{
        rowKey: 'id',
        data: rows,
        columns: [{ colKey: 'order', title: '' }],
        showHeader: false,
        tableLayout: 'fixed',
        rowClassName: 'order-card-row',
      }"
      @page-change="emit('pageChange', $event)"
    >
      <template #topContent>
        <div class="sales-order-filter-card">
          <AdminListPage
            :tabs="tabs"
            :active-tab="activeTab"
            :filters="designFilters"
            :filter-values="filterValues"
            :table-props="{ data: [], columns: [], rowKey: 'id', showHeader: false }"
            @update:filter-values="emit('update:filterValues', $event)"
            @tab-change="emit('tabChange', $event)"
            @search="emit('search')"
            @reset="emit('reset')"
          >
            <template #filter-createdRange
              ><t-date-range-picker
                :value="dateRange"
                data-design-control="order-filter-dates"
                :placeholder="['开始日期', '结束日期']"
                clearable
                @change="changeDates"
            /></template>
          </AdminListPage>
        </div>
        <div class="sales-order-toolbar">
          <AdminListToolbar :has-actions="actions.length > 0"
            ><t-button
              v-for="action in actions"
              :key="action.id"
              :theme="buttonTheme('create')"
              @click="emit('action', action.id)"
              ><template #icon><t-icon name="add" /></template>{{ action.label }}</t-button
            ></AdminListToolbar
          >
        </div>
      </template>
      <template #order="{ row: order }">
        <article class="order-card" :data-order-id="order.id">
          <header class="order-card__header">
            <div class="order-card__identity">
              <strong
                ><span>{{ order.id }}</span></strong
              ><t-button
                :theme="buttonTheme('reset')"
                variant="text"
                shape="square"
                :aria-label="`复制订单号 ${order.id}`"
                @click="copyNumber(order.id)"
              >
                <template #icon><t-icon name="copy" /></template> </t-button
              ><t-tag theme="primary" variant="light">{{
                statuses.find((s) => s.value === order.status)?.label
              }}</t-tag>
            </div>
            <t-button
              :theme="buttonTheme('view')"
              class="order-toggle"
              variant="text"
              :aria-expanded="isExpanded(order.id)"
              @click="toggleExpansion(order.id)"
            >
              {{ isExpanded(order.id) ? '收起' : '展开'
              }}<template #suffix><t-icon :name="isExpanded(order.id) ? 'chevron-up' : 'chevron-down'" /></template>
            </t-button>
          </header>
          <div class="business-intro">
            <div class="order-meta">
              <div>
                <span class="meta-label">客户</span><strong class="customer-name">{{ order.customerName }}</strong
                ><span class="meta-phone">{{ maskPhone(order.phone) }}</span>
              </div>
              <div>
                <span class="meta-label">负责人</span><span>{{ order.ownerName }}</span>
              </div>
              <div>
                <span class="meta-label">创建人</span><span>{{ order.creator }}</span>
              </div>
              <div>
                <span class="meta-label">创建时间</span><span>{{ dateTime(order.createdAt) }}</span>
              </div>
            </div>
            <div class="order-card__actions">
              <t-button
                v-if="can('detail', order)"
                :theme="buttonTheme('view')"
                variant="outline"
                @click="emit('action', 'detail', order)"
                >详情</t-button
              >
              <t-button
                v-if="
                  ['confirmed', 'shipped'].includes(order.status) &&
                  shipmentProgress(order).pending > 0 &&
                  can('plan', order)
                "
                class="order-card__dispatch"
                :theme="buttonTheme('view')"
                @click="emit('action', 'plan', order)"
                >安排发货</t-button
              >
              <t-dropdown
                v-if="moreActions(order).length"
                :options="moreActions(order)"
                :min-column-width="240"
                :max-column-width="360"
                trigger="click"
                @click="(option: { value?: string | number }) => emit('action', String(option.value), order)"
                ><t-button :theme="buttonTheme('reset')" variant="outline"
                  >操作<template #suffix><t-icon name="chevron-down" /></template></t-button
              ></t-dropdown>
            </div>
          </div>
          <div class="metric-band" :class="{ lean: !isExpanded(order.id) }">
            <div class="order-summary__business">
              <div class="order-metric">
                <div class="order-metric__label">成交金额</div>
                <div class="money">
                  <span>¥</span><strong class="order-metric__amount">{{ decimal(pricing(order).total) }}</strong>
                </div>
              </div>
              <div class="order-metric">
                <div class="order-metric__label">收款情况</div>
                <div class="order-metric__received">已收 {{ currency(pricing(order).net) }}</div>
                <div v-if="pricing(order).outstanding" class="order-metric__outstanding">
                  待收 {{ currency(pricing(order).outstanding) }}
                </div>
                <div v-else-if="!pricing(order).refund" class="order-metric__paid">已收齐</div>
                <div v-if="pricing(order).refund" class="order-metric__outstanding">
                  待退款 {{ currency(pricing(order).refund) }}
                </div>
              </div>
              <div class="order-metric">
                <div class="order-metric__label">发货进度</div>
                <div class="shipping-value">
                  <span>已发 {{ shipmentProgress(order).shipped }} / 共 {{ orderQuantity(order) }}</span
                  ><span class="order-metric__progress-label">{{ shipmentProgress(order).label }}</span>
                </div>
                <t-progress :percentage="orderProgress(order)" :label="false" size="small" />
              </div>
              <div class="order-metric">
                <div class="order-metric__label">异常</div>
                <t-space v-if="warnings(order).length" break-line size="small"
                  ><t-tag v-for="warning in warnings(order)" :key="warning" theme="danger" variant="light">{{
                    warning === '延期' ? '有延期' : warning
                  }}</t-tag></t-space
                ><t-tag v-else theme="success" variant="light">无异常</t-tag>
              </div>
            </div>
          </div>
          <section v-if="isExpanded(order.id)" class="order-goods">
            <div
              class="order-goods__heading"
              role="button"
              tabindex="0"
              @click="toggleExpansion(order.id)"
              @keydown.enter="toggleExpansion(order.id)"
            >
              <strong>商品明细</strong><span>{{ order.lines.length }} 项</span>
            </div>
            <div class="goods-scroll" tabindex="0" aria-label="商品明细，可横向滚动">
              <t-table
                row-key="sku"
                :data="order.lines"
                :columns="goodsColumns"
                :pagination="undefined"
                table-layout="fixed"
              >
                <template #product="{ row }"
                  ><div class="order-product">
                    <span
                      v-if="productImage(order, row)"
                      class="order-product__preview"
                      role="button"
                      tabindex="0"
                      :aria-label="`查看${row.name}大图`"
                      @click="previewProduct(order, row)"
                      @keydown.enter="previewProduct(order, row)"
                      @keydown.space.prevent="previewProduct(order, row)"
                    >
                      <img class="order-product__image" :src="productImage(order, row)" :alt="row.name" /> </span
                    ><span v-else class="order-product__empty">暂无图片</span>
                    <div class="order-product__text">
                      <span class="order-product__name">{{ row.name }}</span
                      ><span class="order-product__sku">{{ row.sku }}</span>
                    </div>
                  </div></template
                >
                <template #price="{ row }">{{ currency(row.price) }}</template>
                <template #quantity="{ row }"
                  >{{ row.quantity - row.cancelled
                  }}<span v-if="row.cancelled" class="order-product__cancelled"
                    >（已取消 {{ row.cancelled }}）</span
                  ></template
                >
                <template #amount="{ row }">{{ currency(lineAmount(order, row)) }}</template>
                <template #shipment="{ row }">已发 {{ row.shipped }} / 待发 {{ remaining(row) }}</template>
              </t-table>
              <div class="scroll-hint">横向滚动查看全部商品字段</div>
            </div>
          </section>
        </article>
      </template>
    </AdminListPage>
    <AdminDialog
      v-model:visible="previewVisible"
      :confirmation="{ kind: 'none' }"
      confirm-function="close"
      :header="previewTitle"
      width="min(960px, 94vw)"
      mode="modal"
      show-overlay
      close-on-overlay-click
      :footer="false"
      @close="previewVisible = false"
    >
      <img v-if="previewVisible" :src="previewUrl" :alt="previewTitle" style="max-width: 100%" />
    </AdminDialog>
    <div class="zdm-admin-pagination">
      <t-pagination v-bind="visiblePagination" @change="emit('pageChange', $event)" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PageInfo, TableProps } from 'tdesign-vue-next';
import {
  AdminListPage,
  AdminDialog,
  adminFeedback,
  type ListAction,
  type ListFilter,
  type FilterValues,
} from '@/components/foundation';
import AdminListToolbar from '@/components/foundation/AdminListToolbar.vue';
import { buttonTheme } from '@/components/foundation/actions/buttonFunctions';
import { pricing, remaining, shipmentProgress, warnings, statuses, type Order, type Line } from './model';
import { salesActions } from './resources';
import sampleTable from './assets/product-table.png';
import sampleChair from './assets/product-chair.png';
const props = defineProps<{
  rows: Order[];
  tabs: { value: string; label: string }[];
  activeTab: string;
  filters: ListFilter[];
  filterValues: FilterValues;
  actions: ListAction[];
  can: (action: string, order?: Order) => boolean;
  expandedOrderIds: Array<string | number>;
  pagination: TableProps['pagination'];
}>();
const emit = defineEmits<{
  'update:filterValues': [value: FilterValues];
  tabChange: [value: string | number];
  search: [];
  reset: [];
  action: [action: string, order?: Order];
  pageChange: [info: PageInfo];
  expandChange: [keys: Array<string | number>];
}>();
const visiblePagination = computed(() => ({
  ...props.pagination,
  showJumper: false,
  pageSizeOptions: [3, 10, 20],
}));
const designFilters = computed<ListFilter[]>(() => [
  ...props.filters.filter((field) => !['start', 'end', 'shipment'].includes(field.key)),
  { key: 'createdRange', label: '创建时间' },
  ...props.filters.filter((field) => field.key === 'shipment'),
]);
const dateRange = computed(() =>
  props.filterValues.start && props.filterValues.end
    ? [String(props.filterValues.start), String(props.filterValues.end)]
    : [],
);
function changeDates(value: unknown) {
  const dates = Array.isArray(value) ? value : [];
  emit('update:filterValues', { ...props.filterValues, start: dates[0], end: dates[1] });
}
const maskPhone = (phone: string) => phone.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2');
const decimal = (value: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currency = (value: number) => `¥ ${decimal(value)}`;
const dateTime = (value: string) => new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16);
const isExpanded = (id: string) => props.expandedOrderIds.includes(id);
function toggleExpansion(id: string) {
  emit(
    'expandChange',
    isExpanded(id) ? props.expandedOrderIds.filter((key) => key !== id) : [...props.expandedOrderIds, id],
  );
}
async function copyNumber(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    await adminFeedback.success('订单号已复制');
  } catch {
    await adminFeedback.error('复制失败，请重试');
  }
}
const orderQuantity = (order: Order) => order.lines.reduce((sum, line) => sum + line.quantity - line.cancelled, 0);
const orderProgress = (order: Order) =>
  Math.round((shipmentProgress(order).shipped / Math.max(1, orderQuantity(order))) * 100);
const lineAmount = (order: Order, line: Line) =>
  line.cancelled === line.quantity
    ? 0
    : line.billingQuantity * line.price * (order.discountMode === 'items' ? line.discount / 100 : 1);
const isSampleProduct = (order: Order, line: Line) =>
  ['CT-001', 'CH-001'].includes(line.sku) && order.logs.some((log) => log.action === '载入示例订单');
const previewVisible = ref(false);
const previewUrl = ref('');
const previewTitle = ref('');
const productImage = (order: Order, line: Line) =>
  line.imageUrl || (isSampleProduct(order, line) ? (line.sku === 'CH-001' ? sampleChair : sampleTable) : '');
function previewProduct(order: Order, line: Line) {
  const url = productImage(order, line);
  if (!url) return;
  previewUrl.value = url;
  previewTitle.value = line.name;
  previewVisible.value = true;
}
function moreActions(order: Order) {
  const ids = ['copy'];
  if (order.status === 'pending') ids.unshift('edit', 'confirm');
  if (order.status !== 'cancelled') ids.push('receipt');
  ids.push('refund');
  if (['confirmed', 'shipped'].includes(order.status) && shipmentProgress(order).pending) ids.push('supply');
  if (!['completed', 'cancelled'].includes(order.status)) ids.push('cancel', 'terms');
  return ids
    .filter((id) => props.can(id, order))
    .map((value) => ({ value, content: salesActions.find((a) => a[0] === value)![1] }));
}
const goodsColumns = [
  { colKey: 'product', title: '商品信息', width: 320 },
  { colKey: 'specification', title: '规格', width: 180 },
  { colKey: 'price', title: '单价', width: 120 },
  { colKey: 'quantity', title: '购买数量', width: 90 },
  { colKey: 'amount', title: '金额', width: 120 },
  { colKey: 'shipment', title: '发货进度', width: 150 },
];
</script>
<style scoped>
/* Approved source: order-design-v3, scheme 1. Layout only; business handlers retained. */
:global(.admin-layout .page.sales-order-page) {
  background: var(--td-bg-color-page);
}
.sales-order-list {
  min-width: 0;
  font-family: -apple-system, BlinkMacSystemFont, var(--td-font-family);
  color: var(--td-text-color-secondary);
  container-type: inline-size;
  container-name: orders;
  max-width: 1600px;
  margin-inline: auto;
}
.sales-order-list > :deep(.zdm-official-list-page) {
  padding: 0;
  background: transparent;
}
.sales-order-list > :deep(.zdm-official-list-page > .t-table) {
  background: transparent;
}
.sales-order-list > :deep(.zdm-official-list-page > .t-table > .t-table__content > table) {
  border-collapse: separate;
  border-spacing: 0;
}
.sales-order-list :deep(.order-card-row),
.sales-order-list :deep(.order-card-row:hover) {
  background: transparent;
}
.sales-order-list :deep(.order-card-row > td) {
  padding: var(--td-comp-margin-l) 0 0;
  border: 0;
  background: transparent;
}
.sales-order-filter-card :deep(.t-table) {
  display: none;
}
.sales-order-filter-card :deep(.zdm-official-list-page__grid-filters) {
  margin-bottom: 0;
}
.sales-order-toolbar {
  margin: var(--td-comp-margin-xl) 0 0;
}
.order-card__identity strong {
  font: var(--td-font-mark-medium);
  color: var(--order-identity-color);
}
.order-card__actions {
  flex: none;
  justify-content: flex-end;
}
.goods-scroll {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  container-type: inline-size;
  container-name: goods-table;
}
.goods-scroll :deep(.t-table) {
  min-width: 980px;
}
.order-product {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-l);
}
.order-product__text {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
  min-width: 0;
}
.order-product__sku {
  font: var(--td-font-body-small);
  color: var(--td-text-color-secondary);
}
.order-product__name {
  font: var(--td-font-mark-medium);
}
.order-product__image {
  width: 88px;
  height: 64px;
  object-fit: contain;
  flex: none;
}
.order-product__preview {
  display: inline-flex;
  flex: none;
  cursor: pointer;
}
.order-product__empty,
.order-product__cancelled {
  font: var(--td-font-body-small);
  color: var(--td-text-color-secondary);
}
@container orders (max-width: 960px) {
  .order-card__header {
    gap: var(--td-comp-margin-s);
  }
}
.order-card {
  --order-identity-color: #5b75a6;

  min-width: 0;
  font-family: -apple-system, BlinkMacSystemFont, var(--td-font-family);
  color: var(--td-text-color-secondary);
  position: relative;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
}
.order-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-stroke);
}
.order-card__identity,
.order-card__actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  flex-wrap: wrap;
}
.business-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-xl);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
}
.metric-band {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-secondarycontainer);
}
.order-goods {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  min-width: 0;
  overflow-x: auto;
}
.order-goods__heading {
  display: flex;
  gap: var(--td-comp-margin-s);
  align-items: center;
  margin-bottom: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
}
.order-goods__heading strong {
  font: var(--td-font-mark-medium);
  color: var(--td-text-color-primary);
}
.order-card__header {
  border-left: 3px solid var(--order-identity-color);
  padding-left: calc(var(--td-comp-paddingLR-xl) - 3px);
}
.order-card:has(.lean) .metric-band {
  margin-bottom: var(--td-comp-margin-l);
}
.order-card .metric-band {
  margin: 0 var(--td-comp-margin-xl);
  border-radius: var(--td-radius-medium);
}
.order-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s) var(--td-comp-margin-xl);
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
}
.order-meta > div {
  display: flex;
  gap: var(--td-comp-margin-s);
  align-items: center;
  flex-wrap: wrap;
}
.meta-label,
.meta-phone {
  color: var(--td-text-color-secondary);
}
.customer-name {
  font: var(--td-font-mark-medium);
}
.order-summary__business {
  display: grid;
  grid-template-columns: 1fr 1.12fr 1.3fr 0.65fr;
  gap: var(--td-comp-margin-xl);
  align-items: start;
  color: var(--td-text-color-primary);
}
.order-metric {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--td-comp-margin-xs);
  min-width: 0;
}
.order-metric__label {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
  margin-bottom: var(--td-comp-margin-xs);
}
.money {
  display: flex;
  gap: var(--td-comp-margin-xs);
  align-items: baseline;
  white-space: nowrap;
}
.money > span {
  font: var(--td-font-mark-medium);
}
.money strong {
  font: var(--td-font-title-large);
}
.order-metric__received {
  font: var(--td-font-mark-medium);
  white-space: nowrap;
}
.order-metric__outstanding {
  color: var(--td-warning-color);
  font: var(--td-font-body-small);
}
.order-metric__paid {
  color: var(--td-success-color);
  font: var(--td-font-body-small);
}
.shipping-value {
  display: flex;
  gap: var(--td-comp-margin-s);
  align-items: center;
  flex-wrap: wrap;
}
.order-metric__progress-label {
  font: var(--td-font-body-small);
  color: var(--td-text-color-secondary);
}
.order-metric :deep(.t-progress) {
  width: 100%;
  max-width: 180px;
  margin-top: var(--td-comp-margin-xs);
}
.lean .money strong {
  font: var(--td-font-mark-medium);
}
.lean .order-metric__label {
  margin-bottom: 0;
}
@container orders (max-width:1040px) {
  .order-summary__business {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--td-comp-margin-l) var(--td-comp-margin-xl);
  }
}
.scroll-hint {
  display: none;
  padding-top: var(--td-comp-paddingTB-s);
  font: var(--td-font-body-small);
  color: var(--td-text-color-secondary);
}
@container goods-table (max-width: 979px) {
  .scroll-hint {
    display: block;
  }
}
</style>
