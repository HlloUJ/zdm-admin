<template>
  <t-space direction="vertical" size="large" class="product-detail">
    <section>
      <h3>图片与视频</h3>
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
    </section>
    <section>
      <h3>基础信息</h3>
      <t-descriptions bordered :column="2">
        <t-descriptions-item label="商品名称" :span="2">{{ product.name }}</t-descriptions-item>
        <t-descriptions-item label="ID">{{ product.id }}</t-descriptions-item>
        <t-descriptions-item label="商家编码">{{ product.code || '未填写' }}</t-descriptions-item>
        <t-descriptions-item label="商品分类" :span="2">{{ product.category || '未填写' }}</t-descriptions-item>
        <t-descriptions-item
          v-for="attribute in product.attributes"
          :key="attribute.attributeId"
          :label="attribute.attributeName"
        >
          {{ attribute.value || '未填写' }}
        </t-descriptions-item>
      </t-descriptions>
    </section>
    <section>
      <h3>销售信息</h3>
      <t-descriptions bordered :column="2">
        <t-descriptions-item label="供应商">{{ product.supplier || '未填写' }}</t-descriptions-item>
        <t-descriptions-item label="总库存">{{ product.stock }}</t-descriptions-item>
        <t-descriptions-item label="发布方式">{{ product.publisherType }}</t-descriptions-item>
        <t-descriptions-item label="状态">{{ statusLabels[product.status] || product.status }}</t-descriptions-item>
        <t-descriptions-item label="创建人">{{ product.createdByName || '—' }}</t-descriptions-item>
        <t-descriptions-item label="创建时间">{{ product.createdAt || '—' }}</t-descriptions-item>
        <t-descriptions-item label="下架时间" :span="2">{{ product.offShelfAt || '未记录' }}</t-descriptions-item>
        <t-descriptions-item label="下架原因" :span="2">{{ product.offShelfReason || '未填写' }}</t-descriptions-item>
        <t-descriptions-item label="详细说明" :span="2">{{ product.offShelfDetail || '未填写' }}</t-descriptions-item>
      </t-descriptions>
    </section>
    <section>
      <h3>销售规格与价格</h3>
      <t-table row-key="key" :data="rows" :columns="columns" bordered />
    </section>
    <section>
      <h3>图文描述</h3>
      <div v-if="product.detail" class="product-detail__description" v-html="description" />
      <t-empty v-else description="暂无图文描述" />
    </section>
  </t-space>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import DOMPurify from 'dompurify';
import type { PrimaryTableCol } from 'tdesign-vue-next';
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
const props = defineProps<{ product: DetailProduct; attributeNames: Record<string, string> }>();
const emit = defineEmits<{ preview: [media: { url: string }, type: 'image' | 'video'] }>();
const images = computed(() =>
  props.product.mainImageUrls?.length ? props.product.mainImageUrls : props.product.image ? [props.product.image] : [],
);
const description = computed(() => DOMPurify.sanitize(props.product.detail));
const statusLabels: Record<string, string> = {
  warehouse: '仓库中',
  selling: '出售中',
  offShelf: '已下架',
  soldOut: '已售罄',
  recycle: '回收站',
};
const dimensions = computed(() => props.product.specDimensions ?? []);
const extraFields = computed(() =>
  [...new Set(props.product.variants.flatMap((row) => Object.keys(row.salesAttributes ?? {})))].filter(
    (key) => !dimensions.value.some((dimension) => dimension.key === key),
  ),
);
const levels = computed(() => [
  ...new Map(
    (props.product.markupPrices ?? []).map((price) => [
      price.storeLevelId,
      price.storeLevelName || `${price.storeLevelId}级价格`,
    ]),
  ).entries(),
]);
const columns = computed<PrimaryTableCol[]>(() => [
  ...(dimensions.value.length
    ? dimensions.value.map((dimension) => ({ colKey: dimension.key, title: dimension.name, minWidth: 120 }))
    : [{ colKey: 'label', title: '商品规格', minWidth: 180 }]),
  { colKey: 'skuId', title: 'SKU ID', minWidth: 90 },
  { colKey: 'merchantCode', title: '商家编码', minWidth: 120 },
  { colKey: 'stock', title: '库存', minWidth: 80 },
  ...extraFields.value.map((key) => ({ colKey: key, title: props.attributeNames[key] || key, minWidth: 120 })),
  { colKey: 'cost', title: '成本价', minWidth: 100 },
  { colKey: 'guide', title: '指导价（系数 / 价格）', minWidth: 170 },
  ...levels.value.map(([id, name]) => ({
    colKey: `price_${id}`,
    title: `${name}（系数 / 价格 / 来源）`,
    minWidth: 230,
  })),
]);
const rows = computed(() =>
  props.product.variants.map((variant, index) => {
    const guide = props.product.guidePrices?.find((price) => price.variantKey === variant.variantKey);
    const prices = props.product.markupPrices?.filter((price) => price.variantKey === variant.variantKey) ?? [];
    return {
      ...variant.salesAttributes,
      material: variant.material,
      length: variant.lengthValue,
      color: variant.color,
      size: variant.sizeValue,
      key: variant.id ?? index,
      skuId: variant.id ?? '—',
      label: variant.variantLabel,
      merchantCode: variant.variantKey || '未填写',
      stock: variant.stock,
      cost: guide?.costPrice ?? prices[0]?.costPrice ?? '—',
      guide: guide ? `${guide.priceCoefficient} / ${guide.price}` : '—',
      ...Object.fromEntries(
        levels.value.map(([id]) => {
          const price = prices.find((item) => item.storeLevelId === id);
          return [
            `price_${id}`,
            price
              ? `${price.priceCoefficient} / ${price.price} / ${price.priceSource === 'manual' ? '手工价格' : '跟随配置'}`
              : '—',
          ];
        }),
      ),
    };
  }),
);
</script>

<style scoped>
.product-detail {
  width: 100%;
}
.product-detail__media {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
  height: 120px;
  object-fit: contain;
}
.product-detail__description {
  overflow-wrap: anywhere;
}
.product-detail__description :deep(img),
.product-detail__description :deep(video) {
  max-width: 100%;
  height: auto;
}
</style>
