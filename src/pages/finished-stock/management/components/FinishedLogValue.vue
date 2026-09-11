<template>
  <t-table
    v-if="Array.isArray(value) && value.length && typeof value[0] === 'object'"
    :data="rows"
    :columns="columns"
    row-key="_index"
    bordered
    table-layout="auto"
    table-content-width="max-content"
  />
  <span v-else>{{ display(value) }}</span>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { finishedLogStates } from '@/services/finishedOperationLogs';
const props = defineProps<{ value: unknown; fieldNames?: Record<string, string>; hiddenColumns?: string[] }>();
const names: Record<string, string> = {
  attributeId: '属性ID',
  attributeName: '属性名称',
  value: '属性值',
  variantKey: '商家编码',
  variantLabel: '商品规格',
  stock: '库存',
  displayMode: '展示方式',
  salesAttributes: '销售属性',
  key: '属性标识',
  name: '属性名称',
  values: '属性值顺序',
  storeLevelId: '价格层级ID',
  storeLevelName: '价格层级',
  priceCoefficient: '价格系数',
  costPrice: '成本价',
  price: '价格',
  priceSource: '价格来源',
  sourceConfigurationId: '来源配置ID',
  material: '材质',
  lengthValue: '长度',
  color: '颜色',
  sizeValue: '尺寸',
};
const enums: Record<string, string> = {
  ...finishedLogStates,
  auto: '跟随配置',
  manual: '手工价格',
  single: '单层展示',
  layered: '分层展示',
};
function display(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map(display).join('、') || '—';
  if (typeof value === 'object')
    return Object.entries(value)
      .map(([key, val]) => `${props.fieldNames?.[key] || names[key] || key}：${display(val)}`)
      .join('；');
  return typeof value === 'string' ? enums[value] || value : String(value);
}
const rows = computed(() =>
  Array.isArray(props.value) ? props.value.map((row, index) => ({ ...row, _index: index })) : [],
);
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const keys = [...new Set(rows.value.flatMap((row) => Object.keys(row)))].filter(
    (key) => !['_index', 'attributeId', 'key', 'storeLevelId', 'sourceConfigurationId'].includes(key),
  );
  return keys
    .filter((key) => !props.hiddenColumns?.includes(key))
    .filter((key) => rows.value.some((row) => row[key] != null && row[key] !== ''))
    .map((key) => ({
      colKey: key,
      title: props.fieldNames?.[key] || names[key] || key,
      cell: (_h, { row }) => display(row[key]),
    }));
});
</script>
