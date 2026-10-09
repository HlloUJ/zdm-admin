<template>
  <ProductDetail
    :product="detail"
    :attribute-names="attributeNames"
    :store-level-name="product.storeLevelName || undefined"
    operations
    pool-mode
    @preview="(media, type) => (preview = { url: media.url, kind: type })"
  />
  <AdminDialog
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
import type { StorePoolDetail } from '@/services/storeFinishedStock';

const props = defineProps<{ product: StorePoolDetail }>();
const preview = ref<{ url: string; kind: 'image' | 'video' } | null>(null);
const attributeNames = computed(() => ({
  ...Object.fromEntries([
    ...props.product.specDimensions.map((item) => [item.key, item.name]),
    ...props.product.attributes.map((item) => [`attribute_${item.attributeId}`, item.attributeName]),
  ]),
  ...props.product.attributeNames,
}));
const detail = computed(() => ({
  id: props.product.id,
  name: props.product.name,
  code: props.product.merchantCode,
  category: props.product.categoryName || '',
  stock: props.product.totalStock,
  publisherType: '',
  status: 'selling',
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
    material: sku.material ?? sku.salesAttributes?.material,
    lengthValue: sku.lengthValue ?? sku.salesAttributes?.length,
    color: sku.color ?? sku.salesAttributes?.color,
    sizeValue: sku.sizeValue ?? sku.salesAttributes?.size,
    stock: sku.stock,
  })),
  guidePrices: props.product.skus.flatMap((sku) =>
    sku.guidePrice == null ? [] : [{ skuId: sku.skuId, price: sku.guidePrice }],
  ),
  partnerPrices: props.product.skus.flatMap((sku) =>
    sku.partnerPrice == null ? [] : [{ skuId: sku.skuId, price: sku.partnerPrice }],
  ),
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
