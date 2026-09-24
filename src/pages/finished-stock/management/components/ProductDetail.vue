<template>
  <t-space direction="vertical" size="large" class="product-detail">
    <t-alert v-if="operations && product.sourceUnavailable" theme="warning" :message="sourceMessage" />
    <AdminSectionCard :class="{ 'product-detail__bordered-card': operations }">
      <h3 class="product-detail__section-title" :class="{ 'product-detail__card-title': operations }">图文描述</h3>
      <div class="product-detail__media">
        <button v-for="(url, index) in images" :key="url" type="button" @click="emit('preview', { url }, 'image')">
          <img :src="url" :alt="`商品主图${index + 1}`" />
          <span>商品主图{{ index + 1 }}</span>
        </button>
        <button v-if="product.videoUrl" type="button" @click="emit('preview', { url: product.videoUrl }, 'video')">
          <video :src="product.videoUrl" preload="metadata" muted playsinline />
          <span>点击查看视频</span>
        </button>
      </div>
      <t-empty v-if="!images.length && !product.videoUrl" description="暂无图片或视频" />
      <h4 class="product-detail__subheading">宝贝详情</h4>
      <HistoricalRichText
        v-if="product.detail"
        class="product-detail__description"
        :html="description"
        :media="descriptionMedia"
        @preview="previewDescription"
      />
      <t-empty v-else description="暂无图文描述" />
    </AdminSectionCard>
    <AdminSectionCard :class="{ 'product-detail__bordered-card': operations }">
      <h3 class="product-detail__section-title" :class="{ 'product-detail__card-title': operations }">基础信息</h3>
      <template v-if="operations">
        <t-descriptions bordered :column="3" class="product-detail__basic-table">
          <t-descriptions-item label="商品名称" :span="3">{{ product.name }}</t-descriptions-item>
          <t-descriptions-item label="ID" :span="3">{{ product.id }}</t-descriptions-item>
          <t-descriptions-item label="商品分类" :span="3">{{ product.category || '未填写' }}</t-descriptions-item>
        </t-descriptions>
        <h4 class="product-detail__attributes-heading">商品属性</h4>
        <t-descriptions bordered :column="3" class="product-detail__basic-table">
          <t-descriptions-item
            v-for="attribute in product.attributes"
            :key="attribute.attributeId"
            :label="attribute.attributeName"
          >
            {{ attribute.value || '未填写' }}
          </t-descriptions-item>
          <t-descriptions-item label="供应商" :span="3">{{ product.supplier || '未填写' }}</t-descriptions-item>
        </t-descriptions>
      </template>
      <t-descriptions v-else bordered :column="2">
        <t-descriptions-item label="商品名称" :span="2">{{ product.name }}</t-descriptions-item>
        <t-descriptions-item label="ID">{{ product.id }}</t-descriptions-item>
        <t-descriptions-item label="商品分类" :span="2">{{ product.category || '未填写' }}</t-descriptions-item>
        <t-descriptions-item
          v-for="attribute in product.attributes"
          :key="attribute.attributeId"
          :label="attribute.attributeName"
        >
          {{ attribute.value || '未填写' }}
        </t-descriptions-item>
        <t-descriptions-item label="供应商" :span="2">{{ product.supplier || '未填写' }}</t-descriptions-item>
      </t-descriptions>
    </AdminSectionCard>
    <AdminSectionCard :class="{ 'product-detail__bordered-card': operations }">
      <h3 class="product-detail__section-title" :class="{ 'product-detail__card-title': operations }">销售信息</h3>
      <h4 v-if="!operations">销售规格与价格</h4>
      <component :is="operations ? SalesLogFullscreen : 'div'" :title="operations ? '销售规格与价格' : undefined">
        <t-table
          :class="{ 'product-detail__layered-table': layeredDimensions.length }"
          row-key="key"
          :data="rows"
          :columns="columns"
          :rowspan-and-colspan="span"
          :table-layout="operations ? 'auto' : 'fixed'"
          bordered
        >
          <template v-if="operations" #label="{ row }">
            <div class="product-meta">
              <div>{{ row.label }}</div>
              <div class="product-code">SKU ID：{{ row.skuId }}</div>
            </div>
          </template>
          <template v-for="key in operations ? ['cost', 'guide'] : []" :key="key" #[key]="{ row }">
            <span class="product-detail__price">{{ row[key] }}</span>
          </template>
          <template v-for="[id] in operations ? levels : []" :key="id" #[`price_${id}`]="{ row }">
            <t-space align="center" size="small" class="product-detail__price">
              <span>{{ row[`price_${id}`] }}</span>
              <PriceSourceToggle
                v-if="row.priceSources[id]"
                :source="row.priceSources[id]"
                :available="false"
                readonly
              />
            </t-space>
          </template>
        </t-table>
      </component>
      <t-descriptions class="product-detail__sales-summary" bordered :column="2">
        <t-descriptions-item label="总库存" :span="2">{{ product.stock }}</t-descriptions-item>
      </t-descriptions>
    </AdminSectionCard>
  </t-space>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { AdminSectionCard } from '@/components/foundation';
import PriceSourceToggle from './PriceSourceToggle.vue';
import SalesLogFullscreen from './SalesLogFullscreen.vue';
import HistoricalRichText from './HistoricalRichText.vue';
import DOMPurify from 'dompurify';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { layeredCellSpan, orderLayeredRows } from '../layeredSpecs';
import type {
  FinishedProductAttributeEntry,
  FinishedProductVariant,
  FinishedProductPrice,
  FinishedProductGuidePrice,
  FinishedSpecDimension,
} from '@/services/finishedProducts';
interface DetailProduct {
  id: number;
  name: string;
  code: string;
  category: string;
  supplier: string;
  stock: number;
  publisherType: string;
  status: string;
  sourceStatus?: string;
  sourceUnavailable?: boolean;
  sourceMessage?: string;
  createdByName: string;
  createdAt?: string;
  offShelfReason?: string;
  offShelfAt?: string;
  offShelfDetail?: string;
  image: string;
  mainImageUrls?: string[];
  videoUrl?: string;
  detail: string;
  attributes: FinishedProductAttributeEntry[];
  variants: FinishedProductVariant[];
  markupPrices?: FinishedProductPrice[];
  guidePrices?: FinishedProductGuidePrice[];
  specDimensions?: FinishedSpecDimension[];
}
const props = defineProps<{
  product: DetailProduct;
  attributeNames: Record<string, string>;
  operations?: boolean;
  enabledLevelIds?: number[];
}>();
const emit = defineEmits<{ preview: [media: { url: string }, type: 'image' | 'video'] }>();
const images = computed(() =>
  props.product.mainImageUrls?.length ? props.product.mainImageUrls : props.product.image ? [props.product.image] : [],
);
const description = computed(() => DOMPurify.sanitize(props.product.detail));
const descriptionMedia = computed(() => {
  const document = new DOMParser().parseFromString(description.value, 'text/html');
  return Array.from(document.querySelectorAll('img[src], video[src]')).flatMap((element) => {
    const url = element.getAttribute('src');
    return url
      ? [{ resource: { available: true, url, mediaType: element.tagName === 'VIDEO' ? 'video' : 'image' } }]
      : [];
  });
});
function previewDescription(resource: { url?: string; mediaType: string }) {
  if (resource.url) emit('preview', { url: resource.url }, resource.mediaType === 'video' ? 'video' : 'image');
}
const sourceMessage = computed(
  () => `${props.product.sourceMessage || '上游商品不可用'}，当前仅可查看资料或按权限彻底删除。`,
);
const dimensions = computed(() => props.product.specDimensions ?? []);
const layeredDimensions = computed(() =>
  props.operations && props.product.variants[0]?.displayMode === 'layered' ? dimensions.value : [],
);
const extraFields = computed(() =>
  [...new Set(props.product.variants.flatMap((row) => Object.keys(row.salesAttributes ?? {})))].filter(
    (key) => !dimensions.value.some((dimension) => dimension.key === key),
  ),
);
const levels = computed(() => [
  ...new Map(
    (props.product.markupPrices ?? [])
      .filter((price) => !props.operations || props.enabledLevelIds?.includes(price.storeLevelId))
      .map((price) => [price.storeLevelId, price.storeLevelName || `${price.storeLevelId}级价格`]),
  ).entries(),
]);
const columns = computed<PrimaryTableCol[]>(() => {
  const dimensionColumns = dimensions.value.map((dimension) => ({
    colKey: dimension.key,
    title: dimension.name,
    minWidth: 120,
  }));
  const attributeColumns = [
    { colKey: 'stock', title: '库存', minWidth: 80 },
    ...extraFields.value.map((key) => ({ colKey: key, title: props.attributeNames[key] || key, minWidth: 120 })),
  ];
  const priceColumns = [
    { colKey: 'cost', title: '成本价', minWidth: 100 },
    {
      colKey: 'guide',
      title: props.operations ? '指导价' : '指导价（系数 / 价格）',
      minWidth: props.operations ? 130 : 170,
    },
    ...levels.value.map(([id, name]) => ({
      colKey: `price_${id}`,
      title: props.operations ? name : `${name}（系数 / 价格 / 来源）`,
      minWidth: props.operations ? 150 : 230,
    })),
  ];
  const specColumn = { colKey: 'label', title: '商品规格', minWidth: props.operations ? 270 : 180 };
  if (layeredDimensions.value.length) {
    return [
      ...dimensionColumns.map((column) => ({ ...column, minWidth: 130, fixed: 'left' as const })),
      ...priceColumns,
      ...attributeColumns,
    ];
  }
  return props.operations
    ? [specColumn, ...priceColumns, ...dimensionColumns, ...attributeColumns]
    : [
        ...(dimensionColumns.length ? dimensionColumns : [specColumn]),
        { colKey: 'skuId', title: 'SKU ID', minWidth: 90 },
        ...attributeColumns,
        ...priceColumns,
      ];
});
const rows = computed(() => {
  const mappedRows = props.product.variants.map((variant, index) => {
    const guide = props.product.guidePrices?.find((price) => price.skuId === variant.id);
    const prices = props.product.markupPrices?.filter((price) => price.skuId === variant.id) ?? [];
    return {
      ...variant.salesAttributes,
      material: variant.material,
      length: variant.lengthValue,
      color: variant.color,
      size: variant.sizeValue,
      key: variant.id ?? index,
      skuId: variant.id ?? '—',
      label: variant.variantLabel,
      stock: variant.stock,
      priceSources: Object.fromEntries(
        prices.map((price) => [price.storeLevelId, price.priceSource === 'manual' ? 'manual' : 'auto']),
      ),
      cost: (props.operations ? variant.costPrice : undefined) ?? guide?.costPrice ?? prices[0]?.costPrice ?? '—',
      guide: guide ? `${guide.priceCoefficient} / ${guide.price}` : '—',
      ...Object.fromEntries(
        levels.value.map(([id]) => {
          const price = prices.find((item) => item.storeLevelId === id);
          return [
            `price_${id}`,
            price
              ? `${price.priceCoefficient} / ${price.price}${props.operations ? '' : ` / ${price.priceSource === 'manual' ? '手工价格' : '跟随配置'}`}`
              : '—',
          ];
        }),
      ),
    };
  });
  return orderLayeredRows(mappedRows, layeredDimensions.value);
});
const span = ({ rowIndex, col }: { rowIndex: number; col: PrimaryTableCol }) =>
  layeredCellSpan(
    rows.value.map((row) =>
      layeredDimensions.value.map((dimension) => String((row as TableRowData)[dimension.key] ?? '')),
    ),
    rowIndex,
    layeredDimensions.value.findIndex((dimension) => dimension.key === col.colKey),
  );
</script>

<style scoped>
.product-detail__layered-table :deep(.t-table__content) {
  contain: paint;
}
.product-detail {
  width: 100%;
}
.product-detail__section-title {
  margin: 0 0 var(--td-comp-margin-xxl);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  text-align: left;
}
.product-detail__bordered-card {
  border: 1px solid var(--td-component-border);
  box-shadow: none;
}
.product-detail__card-title {
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
  margin: calc(-1 * var(--zdm-admin-card-padding));
  margin-bottom: var(--zdm-admin-card-padding);
  padding: var(--td-comp-paddingTB-m) var(--zdm-admin-card-padding);
  border-bottom: 1px solid var(--td-component-border);
  border-radius: var(--zdm-admin-card-radius) var(--zdm-admin-card-radius) 0 0;
  background: var(--td-bg-color-secondarycontainer);
}
.product-detail__attributes-heading {
  margin: 0;
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  border-right: 1px solid var(--td-component-border);
  border-left: 1px solid var(--td-component-border);
  background-color: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-medium);
  font-weight: 400;
}
.product-detail__basic-table {
  margin: 0;
}
.product-detail__subheading {
  margin: var(--td-comp-margin-l) 0 var(--td-comp-margin-m);
}
.product-detail__sales-summary {
  margin-top: var(--td-comp-margin-l);
}
.product-detail__price {
  white-space: nowrap;
}
.product-meta {
  display: grid;
  gap: 4px;
}
.product-code {
  color: #6b7280;
  font-size: 12px;
}
.product-detail__media {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--td-comp-margin-m);
}
.product-detail__media button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-m);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
  cursor: pointer;
}
.product-detail__media img,
.product-detail__media video {
  width: 100%;
  height: 80px;
  object-fit: contain;
}
</style>
