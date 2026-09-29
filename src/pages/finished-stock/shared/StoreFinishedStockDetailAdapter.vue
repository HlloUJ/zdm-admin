<template>
  <ProductDetail
    :product="detail"
    :attribute-names="attributeNames"
    :enabled-level-ids="roleIds"
    :store-status-label="statusLabel"
    operations
    store-mode
    @preview="(media, type) => (preview = { url: media.url, kind: type })"
  />
  <AdminDialog
    :visible="Boolean(preview)"
    header="商品媒体"
    width="min(960px, 94vw)"
    :footer="false"
    @close="preview = null"
    @update:visible="!$event && (preview = null)"
  >
    <img v-if="preview?.kind === 'image'" :src="preview.url" alt="商品图片" style="max-width: 100%" />
    <video v-if="preview?.kind === 'video'" :src="preview.url" controls style="max-width: 100%" />
  </AdminDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { AdminDialog } from '@/components/foundation';
import ProductDetail from '../management/components/ProductDetail.vue';
import type { StoreFinishedProduct } from '@/services/storeFinishedStock';
import type { FinishedProductPrice, FinishedProductGuidePrice } from '@/services/finishedProducts';

const props = defineProps<{ product: StoreFinishedProduct }>();
const preview = ref<{ url: string; kind: 'image' | 'video' } | null>(null);
const statusLabels: Record<string, string> = {
  warehouse: '仓库中',
  selling: '出售中',
  offShelf: '已下架',
  soldOut: '已售完',
  recycle: '回收站',
};
const statusLabel = computed(() => statusLabels[props.product.effectiveStatus]);
const attributeNames = computed(() =>
  Object.fromEntries([
    ...props.product.specDimensions.map((item) => [item.key, item.name]),
    ...props.product.attributes.map((item) => [`attribute_${item.attributeId}`, item.attributeName]),
  ]),
);
const roleIds = computed(() => [
  ...new Set(props.product.skus.flatMap((sku) => sku.rolePrices.map((role) => role.roleId))),
]);
const detail = computed(() => ({
  id: props.product.productId,
  name: props.product.name,
  code: props.product.merchantCode,
  category: props.product.categoryName || '',
  supplier: props.product.supplierName || '',
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
  markupPrices: props.product.skus.flatMap((sku): FinishedProductPrice[] =>
    sku.rolePrices.flatMap((role) =>
      role.price == null
        ? []
        : [
            {
              skuId: sku.skuId,
              storeLevelId: role.roleId,
              storeLevelName: role.roleName,
              priceCoefficient: role.coefficient,
              costPrice: sku.costPrice ?? 0,
              price: role.price,
              priceSource: role.priceSource,
            },
          ],
    ),
  ),
}));
</script>
