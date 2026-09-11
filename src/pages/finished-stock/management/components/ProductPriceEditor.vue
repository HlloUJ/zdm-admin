<template>
  <div class="product-price-editor">
    <t-table
      row-key="key"
      :data="displayEditors"
      :columns="columns"
      :rowspan-and-colspan="specRowspanAndColspan"
      table-layout="auto"
      table-content-width="max-content"
      bordered
      hover
    >
      <template #label="{ row }">{{ row.label }}</template>
      <template v-for="(priceField, index) in priceFields" :key="priceField.key" #[priceField.key]="{ row }">
        <div>
          <div :class="{ 'price-pair': index > 0, 'with-source': index > 1 }">
            <SpecPriceInput
              v-if="index > 0"
              v-model="row.rows[index].coefficient"
              label="系数"
              placeholder="系数"
              :submitted="submitted"
              :disabled="readonly"
              @change="updateCoefficient(row, row.rows[index], false)"
              @commit="markManual(row.rows[index])"
            />
            <SpecPriceInput
              v-model="row.rows[index].price"
              label="价格"
              placeholder="价格"
              :submitted="submitted"
              :disabled="readonly"
              @change="updatePrice(row, row.rows[index], index)"
              @commit="markManual(row.rows[index])"
            />
            <PriceSourceToggle
              v-if="index > 1"
              :source="row.rows[index].priceSource"
              :available="activeConfiguration(row.rows[index])?.priceCoefficient != null"
              :readonly="readonly || saving"
              @toggle="togglePriceSource(row, row.rows[index])"
            />
          </div>
        </div>
      </template>
    </t-table>
    <AdminDialog
      v-model:visible="confirmVisible"
      header="保存价格"
      :confirm-btn="{ content: '确认保存', loading: saving }"
      @confirm="save()"
      @cancel="confirmVisible = false"
    >
      是否保存商品“{{ product.name }}”的价格？
    </AdminDialog>
  </div>
</template>
<script setup lang="ts">
import { computed, h, ref } from 'vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { AdminDialog, adminFeedback } from '@/components/foundation';
import {
  updateFinishedProduct,
  type FinishedProductPayload,
  type FinishedProductVariant,
  type FinishedProductRecord,
} from '@/services/finishedProducts';
import PriceSourceToggle from './PriceSourceToggle.vue';
import SpecPriceInput from './SpecPriceInput.vue';
import { isValidSpecPriceNumber } from '../priceValidation';
import { layeredCellSpan, orderLayeredRows } from '../layeredSpecs';
const props = defineProps<{
  productId: number;
  product: FinishedProductPayload;
  levels: { id: number; name: string; priceCoefficient?: number | null; configurationId?: number }[];
}>();
const emit = defineEmits<{ saved: [record: FinishedProductRecord, closeAfterSave: boolean] }>();
type PriceRow = {
  key: string;
  label: string;
  coefficient: string;
  price: string;
  levelId?: number;
  priceSource?: 'auto' | 'manual';
  sourceConfigurationId?: number;
};
type VariantEditor = { key: string; label: string; specValues: Record<string, string>; rows: PriceRow[] };
const readonly = computed(() => ['soldOut', 'recycle'].includes(props.product.status));
const submitted = ref(false);
const saving = ref(false);
const confirmVisible = ref(false);
const variants: (Pick<FinishedProductVariant, 'variantKey' | 'variantLabel'> & Partial<FinishedProductVariant>)[] =
  props.product.variants.length
    ? props.product.variants
    : Array.from(
        new Set([
          ...(props.product.guidePrices ?? []).map((price) => price.variantKey),
          ...(props.product.markupPrices ?? []).map((price) => price.variantKey),
        ]),
      ).map((key) => ({
        variantKey: key,
        variantLabel: props.product.guidePrices?.find((price) => price.variantKey === key)?.variantLabel || key,
      }));
if (!variants.length) variants.push({ variantKey: props.product.sku, variantLabel: props.product.name });
const levels = [...props.levels];
for (const price of props.product.markupPrices ?? []) {
  if (!levels.some((level) => level.id === price.storeLevelId))
    levels.push({ id: price.storeLevelId, name: price.storeLevelName ?? `门店级别 ${price.storeLevelId}` });
}
const editors = ref<VariantEditor[]>(
  variants.map((variant) => {
    const guide = props.product.guidePrices?.find((price) => price.variantKey === variant.variantKey);
    const prices = props.product.markupPrices?.filter((price) => price.variantKey === variant.variantKey) ?? [];
    return {
      key: variant.variantKey,
      label: variant.variantLabel || variant.variantKey,
      specValues: variant.salesAttributes ?? {},
      rows: [
        {
          key: 'cost',
          label: '成本价',
          coefficient: '1.00',
          price: String(guide?.costPrice ?? prices[0]?.costPrice ?? ''),
        },
        {
          key: 'guide',
          label: '指导价',
          coefficient: String(guide?.priceCoefficient ?? ''),
          price: String(guide?.price ?? ''),
        },
        ...levels.map((level) => {
          const price = prices.find((entry) => entry.storeLevelId === level.id);
          return {
            key: `level-${level.id}`,
            levelId: level.id,
            label: level.name,
            coefficient: String(price?.priceCoefficient ?? level.priceCoefficient ?? ''),
            price: String(price?.price ?? ''),
            priceSource: price
              ? (price.priceSource ?? 'manual')
              : level.configurationId
                ? ('auto' as const)
                : ('manual' as const),
            sourceConfigurationId: price?.sourceConfigurationId ?? (price ? undefined : level.configurationId),
          };
        }),
      ],
    };
  }),
);
const dimensions = computed(() =>
  props.product.variants[0]?.displayMode === 'layered' ? (props.product.specDimensions ?? []) : [],
);
const displayEditors = computed(() =>
  orderLayeredRows(
    editors.value.map((editor) => ({ ...editor.specValues, editor })),
    dimensions.value,
  ).map((item) => item.editor),
);
const specRowspanAndColspan = ({ rowIndex, col }: { rowIndex: number; col: { colKey?: string } }) => {
  const fieldIndex = dimensions.value.findIndex((dimension) => `spec:${dimension.key}` === col.colKey);
  return layeredCellSpan(
    displayEditors.value.map((editor) => dimensions.value.map((dimension) => editor.specValues[dimension.key] ?? '')),
    rowIndex,
    fieldIndex,
  );
};
const priceFields = computed(() => editors.value[0]?.rows ?? []);
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(dimensions.value.length
    ? dimensions.value.map((dimension) => ({
        colKey: `spec:${dimension.key}`,
        title: dimension.name,
        minWidth: 100,
        ellipsis: false,
        cell: (_h: unknown, { row }: { row: TableRowData }) => row.specValues[dimension.key] ?? '',
      }))
    : [{ colKey: 'label', title: '商品规格', minWidth: 180, ellipsis: false }]),
  ...priceFields.value.map((field, index) => ({
    colKey: field.key,
    title: () => h('span', [field.label, h('span', { class: 'required-star' }, '*')]),
    width: index === 0 ? 110 : index === 1 ? 180 : 196,
  })),
]);
const activeConfiguration = (row: PriceRow) =>
  props.levels.find((level) => level.id === row.levelId && level.configurationId);
const togglePriceSource = (variant: VariantEditor, row: PriceRow) => {
  if (readonly.value || saving.value) return;
  if (row.priceSource === 'auto') markManual(row);
  else restoreAuto(variant, row);
};
const restoreAuto = (variant: VariantEditor, row: PriceRow) => {
  const configuration = activeConfiguration(row);
  if (!configuration || configuration.priceCoefficient == null) return;
  row.coefficient = String(configuration.priceCoefficient);
  row.priceSource = 'auto';
  row.sourceConfigurationId = configuration.configurationId;
  updateCoefficient(variant, row, false);
};
const markManual = (row: PriceRow) => {
  if (row.levelId != null) {
    row.priceSource = 'manual';
    row.sourceConfigurationId = undefined;
  }
};
const updateCoefficient = (variant: VariantEditor, row: PriceRow, manual = true) => {
  if (manual) markManual(row);
  if (isValidSpecPriceNumber(variant.rows[0].price) && isValidSpecPriceNumber(row.coefficient))
    row.price = (Number(variant.rows[0].price) * Number(row.coefficient)).toFixed(2);
};
const updatePrice = (variant: VariantEditor, row: PriceRow, index: number) => {
  if (!isValidSpecPriceNumber(row.price)) return;
  if (index === 0) variant.rows.slice(1).forEach((entry) => updateCoefficient(variant, entry, false));
  else if (isValidSpecPriceNumber(variant.rows[0].price) && Number(variant.rows[0].price) > 0)
    row.coefficient = (Number(row.price) / Number(variant.rows[0].price)).toFixed(2);
};
const confirmSave = () => {
  if (readonly.value) return;
  submitted.value = true;
  const invalid = editors.value.find((variant) =>
    variant.rows.some((row) => !isValidSpecPriceNumber(row.price) || !isValidSpecPriceNumber(row.coefficient)),
  );
  if (invalid || !editors.value.length) {
    adminFeedback.warning('请完善价格信息');
    return;
  }
  confirmVisible.value = true;
};
const save = async (closeAfterSave = true) => {
  if (saving.value || readonly.value) return;
  saving.value = true;
  try {
    const payload: FinishedProductPayload = {
      ...props.product,
      guidePrice: Number(editors.value[0].rows[1].price),
      guidePrices: editors.value.map((variant) => ({
        variantKey: variant.key,
        variantLabel: variant.label,
        costPrice: Number(variant.rows[0].price),
        priceCoefficient: Number(variant.rows[1].coefficient),
        price: Number(variant.rows[1].price),
      })),
      markupPrices: editors.value.flatMap((variant) =>
        variant.rows
          .filter((row) => row.levelId != null)
          .map((row) => ({
            storeLevelId: row.levelId!,
            priceSource: row.priceSource,
            sourceConfigurationId: row.sourceConfigurationId,
            storeLevelName: row.label,
            variantKey: variant.key,
            variantLabel: variant.label,
            costPrice: Number(variant.rows[0].price),
            priceCoefficient: Number(row.coefficient),
            price: Number(row.price),
          })),
      ),
    };
    const record = await updateFinishedProduct(props.productId, payload);
    confirmVisible.value = false;
    adminFeedback.success('价格保存成功');
    emit('saved', record, closeAfterSave);
    return true;
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '价格保存失败');
    return false;
  } finally {
    saving.value = false;
  }
};
defineExpose({ confirmSave });
</script>
<style scoped>
.product-price-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  gap: var(--td-comp-margin-l);
}
.product-price-editor :deep(th),
.product-price-editor :deep(td) {
  white-space: nowrap;
}
.price-pair {
  display: grid;
  grid-template-columns: 54px minmax(72px, 1fr);
  gap: 6px;
  align-items: start;
}
.price-pair.with-source {
  grid-template-columns: 54px minmax(72px, 1fr) 24px;
}
.required-star {
  color: var(--td-error-color);
}
</style>
