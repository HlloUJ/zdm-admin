<template>
  <t-table
    class="sales-log-table"
    row-key="rowKey"
    size="small"
    :data="rows"
    :columns="columns"
    :rowspan-and-colspan="span"
    bordered
    table-layout="auto"
    table-content-width="max-content"
  />
</template>
<script setup lang="ts">
import { computed, h } from 'vue';
import PriceSourceToggle from './PriceSourceToggle.vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { layeredCellSpan, orderLayeredRows } from '../layeredSpecs';
import type {
  FinishedSpecDimension,
  FinishedProductVariant,
  FinishedProductGuidePrice,
  FinishedProductPrice,
  FinishedProductAttributeEntry,
} from '@/services/finishedProducts';
const props = defineProps<{
  snapshot: Record<string, unknown>;
  other: Record<string, unknown>;
  highlightChanges?: boolean;
}>();
function list<T>(field: string): T[] {
  return Array.isArray(props.snapshot[field]) ? (props.snapshot[field] as T[]) : [];
}
function otherList<T>(field: string): T[] {
  return Array.isArray(props.other[field]) ? (props.other[field] as T[]) : [];
}
const attributes = computed(() => list<FinishedProductAttributeEntry>('商品属性'));
const variants = computed(() => {
  if (Array.isArray(props.snapshot['销售规格'])) return list<FinishedProductVariant>('销售规格');
  const source = [...list<FinishedProductGuidePrice>('指导价'), ...list<FinishedProductPrice>('层级价格')];
  return [
    ...new Map(
      source.map((price) => [
        price.variantKey,
        { variantKey: price.variantKey, variantLabel: price.variantLabel } as FinishedProductVariant,
      ]),
    ).values(),
  ];
});
const dimensions = computed(() =>
  variants.value[0]?.displayMode === 'layered' ? list<FinishedSpecDimension>('规格维度') : [],
);
const guidePrices = computed(() => list<FinishedProductGuidePrice>('指导价'));
const prices = computed(() => list<FinishedProductPrice>('层级价格'));
const levels = computed(() => [
  ...new Map(
    [...prices.value, ...otherList<FinishedProductPrice>('层级价格')].map((price) => [
      price.storeLevelId,
      price.storeLevelName || `价格层级${price.storeLevelId}`,
    ]),
  ).entries(),
]);
const extraFields = computed(() =>
  [
    ...new Set(
      [...variants.value, ...otherList<FinishedProductVariant>('销售规格')].flatMap((row) =>
        Object.keys(row.salesAttributes || {}),
      ),
    ),
  ].filter((key) => !dimensions.value.some((d) => d.key === key)),
);
const attributeName = (key: string) =>
  (props.snapshot['销售属性名称'] as Record<string, string> | undefined)?.[key] ||
  dimensions.value.find((item) => item.key === key)?.name ||
  attributes.value.find((item) => key === `attribute_${item.attributeId}`)?.attributeName ||
  '历史属性（名称未记录）';
const text = (value: unknown) => (value == null || value === '' ? '未记录' : String(value));
const money = (value: number | undefined) => (value == null ? '未记录' : Number(value).toFixed(2));
const priceCell = (coefficient?: number, price?: number, source?: string) =>
  h('div', [
    h('div', `系数：${money(coefficient)}`),
    h('div', { class: 'historical-price-line' }, [
      h('span', `价格：${money(price)}`),
      ...(source
        ? [h(PriceSourceToggle, { source: source === 'auto' ? 'auto' : 'manual', available: false, readonly: true })]
        : []),
    ]),
  ]);
const rows = computed(() =>
  orderLayeredRows(
    variants.value.map((variant, index) => {
      const guide = guidePrices.value.find((price) => price.variantKey === variant.variantKey);
      return {
        ...variant.salesAttributes,
        rowKey: index,
        specText: variant.variantLabel,
        cost: guide?.costPrice ?? prices.value.find((price) => price.variantKey === variant.variantKey)?.costPrice,
        guide,
        quantity: variant.stock,
        merchantCode: variant.variantKey,
        ...Object.fromEntries(
          levels.value.map(([id]) => [
            `level_${id}`,
            prices.value.find((price) => price.variantKey === variant.variantKey && price.storeLevelId === id),
          ]),
        ),
      };
    }),
    dimensions.value,
  ),
);
const baseColumns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(dimensions.value.length
    ? dimensions.value.map((d) => ({ colKey: d.key, title: d.name, width: 130, fixed: 'left' as const }))
    : [{ colKey: 'specText', title: '商品规格', width: 180, fixed: 'left' as const }]),
  { colKey: 'cost', title: '成本价', minWidth: 100, cell: (_h, { row }) => money(row.cost) },
  {
    colKey: 'guide',
    title: '指导价',
    minWidth: 150,
    cell: (_h, { row }) => priceCell(row.guide?.priceCoefficient, row.guide?.price),
  },
  ...levels.value.map(([id, name]) => ({
    colKey: `level_${id}`,
    title: name,
    minWidth: 170,
    cell: (_h: unknown, { row }: { row: TableRowData }) =>
      priceCell(row[`level_${id}`]?.priceCoefficient, row[`level_${id}`]?.price, row[`level_${id}`]?.priceSource),
  })),
  { colKey: 'quantity', title: '数量', minWidth: 80, cell: (_h, { row }) => text(row.quantity) },
  ...extraFields.value.map((key) => ({ colKey: key, title: attributeName(key), minWidth: 130 })),
  { colKey: 'merchantCode', title: '商家编码', minWidth: 130 },
]);
function comparableCell(snapshot: Record<string, unknown>, variant: FinishedProductVariant, key: string): unknown {
  const guides = (snapshot['指导价'] || []) as FinishedProductGuidePrice[];
  const partners = (snapshot['层级价格'] || []) as FinishedProductPrice[];
  const guide = guides.find((item) => item.variantKey === variant.variantKey);
  if (key === 'specText') return variant.variantLabel;
  if (key === 'merchantCode') return variant.variantKey;
  if (key === 'quantity') return variant.stock;
  if (key === 'cost')
    return guide?.costPrice ?? partners.find((item) => item.variantKey === variant.variantKey)?.costPrice;
  if (key === 'guide') return [guide?.priceCoefficient, guide?.price];
  if (key.startsWith('level_')) {
    const price = partners.find(
      (item) => item.variantKey === variant.variantKey && String(item.storeLevelId) === key.slice(6),
    );
    return [price?.priceCoefficient, price?.price, price?.priceSource];
  }
  return variant.salesAttributes?.[key];
}
function changedCell(row: TableRowData, key: string): boolean {
  if (!props.highlightChanges) return false;
  const variant = variants.value.find((item) => item.variantKey === row.merchantCode);
  if (!variant) return false;
  const candidates = otherList<FinishedProductVariant>('销售规格');
  const sameLabel = candidates.filter((item) => item.variantLabel === variant.variantLabel);
  const previous =
    candidates.find((item) => item.variantKey === variant.variantKey) ||
    (sameLabel.length === 1 ? sameLabel[0] : undefined);
  if (!previous) return true;
  return (
    JSON.stringify(comparableCell(props.snapshot, variant, key)) !==
    JSON.stringify(comparableCell(props.other, previous, key))
  );
}
const columns = computed<PrimaryTableCol<TableRowData>[]>(() =>
  baseColumns.value.map((column) => ({
    ...column,
    cell: (render, context) => {
      const content = typeof column.cell === 'function' ? column.cell(render, context) : context.row[column.colKey!];
      return h('div', { class: { 'sales-value-changed': changedCell(context.row, column.colKey!) } }, [content]);
    },
  })),
);
const span = ({ rowIndex, col }: { rowIndex: number; col: PrimaryTableCol<TableRowData> }) =>
  layeredCellSpan(
    rows.value.map((row) => dimensions.value.map((d) => String((row as TableRowData)[d.key] ?? ''))),
    rowIndex,
    dimensions.value.findIndex((d) => d.key === col.colKey),
  );
</script>
<style scoped>
.sales-log-table :deep(.sales-value-changed) {
  color: var(--td-error-color);
}
.sales-log-table :deep(.historical-price-line) {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
  white-space: nowrap;
}
.sales-log-table :deep(.historical-price-line .price-source-badge) {
  margin-top: 0;
}
.sales-log-table :deep(th),
.sales-log-table :deep(td) {
  font-size: var(--td-font-size-body-small);
}
.sales-log-table :deep(thead th) {
  background-color: var(--td-bg-color-secondarycontainer);
}
</style>
