<template>
  <ProductDetail
    :product="detail"
    :editor-layout="editorLayout"
    :attribute-names="attributeNames"
    :store-level-name="product.storeLevelName || undefined"
    operations
    store-mode
    @preview="(media, type) => (preview = { url: media.url, kind: type })"
  >
    <template v-if="$slots['basic-extra']" #basic-extra><slot name="basic-extra" /></template>
    <template v-if="$slots.sales" #sales="slotProps"><slot name="sales" v-bind="slotProps" /></template>
    <template v-if="$slots.sale" #sale="slotProps"><slot name="sale" v-bind="slotProps" /></template>
  </ProductDetail>
  <AdminDialog
    confirm-function="close"
    :visible="Boolean(preview)"
    header="商品媒体"
    attach="body"
    width="min(960px, 94vw)"
    :footer="false"
    @close="preview = null"
    @update:visible="!$event && (preview = null)"
  >
    <img v-if="preview?.kind === 'image'" :src="preview.url" alt="商品图片" style="max-width: 100%" />
    <video
      v-if="preview?.kind === 'video'"
      :src="preview.url"
      controls
      autoplay
      playsinline
      aria-label="商品视频播放器"
      class="product-video-preview"
    />
  </AdminDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { AdminDialog } from '@/components/foundation';
import ProductDetail from '../management/components/ProductDetail.vue';
import type { StoreFinishedProduct } from '@/services/storeFinishedStock';
import type { FinishedProductGuidePrice } from '@/services/finishedProducts';

const props = defineProps<{ product: StoreFinishedProduct; editorLayout?: boolean }>();
const preview = ref<{ url: string; kind: 'image' | 'video' } | null>(null);
const attributeNames = computed(() => ({
  ...Object.fromEntries([
    ...props.product.specDimensions.map((item) => [item.key, item.name]),
    ...props.product.attributes.map((item) => [`attribute_${item.attributeId}`, item.attributeName]),
  ]),
  ...props.product.attributeNames,
}));
const detail = computed(() => ({
  id: props.product.productId,
  name: props.product.name,
  code: props.product.merchantCode,
  category: props.product.categoryName || '',
  stock: props.product.totalStock,
  publisherType: '',
  status: props.product.effectiveStatus,
  offShelfReason: props.product.offShelfReason,
  offShelfAt: props.product.offShelfAt,
  offShelfDetail: props.product.offShelfDetail,
  sourceUnavailable: props.product.sourceUnavailable,
  sourceMessage: props.product.sourceMessage,
  createdByName: '',
  image: props.product.imageUrl || '',
  mainImageUrls: props.product.imageUrls,
  videoUrl: props.product.videoUrl,
  detail: props.product.detail || '',
  attributes: props.product.attributes,
  specDimensions: props.product.specDimensions,
  variants: props.product.skus.map((sku) => ({
    id: sku.skuId,
    variantLabel: sku.label,
    displayMode: sku.displayMode || 'single',
    salesAttributes: sku.salesAttributes,
    material: sku.material,
    lengthValue: sku.lengthValue,
    color: sku.color,
    sizeValue: sku.sizeValue,
    stock: sku.stock,
    costPrice: sku.costPrice ?? undefined,
  })),
  guidePrices: props.product.skus.flatMap((sku): FinishedProductGuidePrice[] =>
    sku.guidePrice == null
      ? []
      : [
          {
            skuId: sku.skuId,
            price: sku.guidePrice,
            priceCoefficient: 0,
            costPrice: sku.costPrice ?? 0,
          },
        ],
  ),
  salePrices: props.product.skus.map((sku) => ({ skuId: sku.skuId, price: sku.salePrice, mode: sku.priceMode })),
}));
</script>

<style scoped>
.product-video-preview {
  display: block;
  width: min(900px, 100%);
  height: min(760px, calc(100vh - 220px));
  object-fit: contain;
}
</style>
