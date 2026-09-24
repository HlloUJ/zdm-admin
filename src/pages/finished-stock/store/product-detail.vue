<template>
  <t-space direction="vertical" size="large" style="width: 100%">
    <t-alert v-if="product.sourceUnavailable" theme="warning" :message="product.sourceMessage" />
    <AdminSectionCard>
      <h3>图文描述</h3>
      <t-space v-if="product.imageUrls?.length || product.videoUrl" size="small">
        <t-image
          v-for="(url, index) in product.imageUrls"
          :key="url"
          :src="url"
          :alt="`商品主图${index + 1}`"
          fit="cover"
          :style="{ width: '96px', height: '96px' }"
          @click="preview = { url, kind: 'image' }"
        />
        <t-button v-if="product.videoUrl" variant="outline" @click="preview = { url: product.videoUrl!, kind: 'video' }"
          >查看商品视频</t-button
        >
      </t-space>
      <t-empty v-else description="暂无图片或视频" />
      <h4>宝贝详情</h4>
      <HistoricalRichText
        v-if="product.detail"
        :html="product.detail"
        :media="descriptionMedia"
        @preview="openDescriptionPreview"
      />
      <t-empty v-else description="暂无图文描述" />
    </AdminSectionCard>
    <AdminSectionCard>
      <h3>基础信息</h3>
      <t-descriptions bordered :column="3">
        <t-descriptions-item label="商品名称" :span="3">{{ product.name }}</t-descriptions-item>
        <t-descriptions-item label="商品 ID">{{ product.productId }}</t-descriptions-item>
        <t-descriptions-item label="供应商">{{ product.supplierName || '—' }}</t-descriptions-item>
        <t-descriptions-item label="商品分类">{{ product.categoryName || '—' }}</t-descriptions-item>
        <t-descriptions-item label="本店状态">{{ statusLabel }}</t-descriptions-item>
      </t-descriptions>
      <t-descriptions v-if="product.status === 'offShelf'" bordered :column="2">
        <t-descriptions-item label="下架原因">{{ product.offShelfReason || '—' }}</t-descriptions-item>
        <t-descriptions-item label="下架时间">{{
          product.offShelfAt ? product.offShelfAt.replace('T', ' ').slice(0, 16) : '—'
        }}</t-descriptions-item>
        <t-descriptions-item label="详细说明" :span="2">{{ product.offShelfDetail || '—' }}</t-descriptions-item>
      </t-descriptions>
      <h4>商品属性</h4>
      <t-descriptions bordered :column="3">
        <t-descriptions-item
          v-for="attribute in product.attributes"
          :key="attribute.attributeId"
          :label="attribute.attributeName"
          >{{ attribute.value || '—' }}</t-descriptions-item
        >
      </t-descriptions>
    </AdminSectionCard>
    <AdminSectionCard>
      <h3>销售信息</h3>
      <t-table row-key="skuId" :data="product.skus" :columns="columns" bordered>
        <template #costPrice="{ row }">{{ money(row.costPrice) }}</template>
        <template #guidePrice="{ row }">{{ money(row.guidePrice) }}</template>
        <template #rolePrices="{ row }"
          ><div v-for="price in row.rolePrices" :key="price.roleId">
            {{ price.roleName }}：{{ money(price.price) }}（{{
              price.priceSource === 'manual' ? '手工价格' : '跟随配置'
            }}）
          </div></template
        >
      </t-table>
      <t-descriptions v-for="sku in product.skus" :key="`attributes-${sku.skuId}`" bordered :column="3">
        <t-descriptions-item label="规格" :span="3">{{ sku.label }} · SKU ID {{ sku.skuId }}</t-descriptions-item>
        <t-descriptions-item
          v-for="[key, value] in Object.entries(sku.salesAttributes || {})"
          :key="key"
          :label="attributeLabel(key)"
          >{{ value }}</t-descriptions-item
        >
        <t-descriptions-item v-if="sku.material" label="材质">{{ sku.material }}</t-descriptions-item>
        <t-descriptions-item v-if="sku.lengthValue" label="长度">{{ sku.lengthValue }}</t-descriptions-item>
        <t-descriptions-item v-if="sku.color" label="颜色">{{ sku.color }}</t-descriptions-item>
        <t-descriptions-item v-if="sku.sizeValue" label="尺寸">{{ sku.sizeValue }}</t-descriptions-item>
      </t-descriptions>
      <t-descriptions bordered :column="2"
        ><t-descriptions-item label="统一库存">{{ product.totalStock }}</t-descriptions-item></t-descriptions
      >
    </AdminSectionCard>
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
  </t-space>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { AdminDialog, AdminSectionCard } from '@/components/foundation';
import HistoricalRichText from '../management/components/HistoricalRichText.vue';
import type { StoreFinishedProduct } from '@/services/storeFinishedStock';

const props = defineProps<{ product: StoreFinishedProduct }>();
const preview = ref<{ url: string; kind: 'image' | 'video' } | null>(null);
const labels: Record<string, string> = {
  warehouse: '仓库中',
  selling: '出售中',
  offShelf: '已下架',
  soldOut: '已售完',
  recycle: '回收站',
};
const statusLabel = computed(() => labels[props.product.effectiveStatus]);
const descriptionMedia = computed(() => {
  const document = new DOMParser().parseFromString(props.product.detail || '', 'text/html');
  return Array.from(document.querySelectorAll('img[src], video[src]')).flatMap((element) => {
    const url = element.getAttribute('src');
    return url
      ? [{ resource: { available: true, url, mediaType: element.tagName === 'VIDEO' ? 'video' : 'image' } }]
      : [];
  });
});
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'label', title: '商品规格', minWidth: 170 },
  { colKey: 'skuId', title: 'SKU ID', width: 110 },
  { colKey: 'stock', title: '统一库存', width: 100 },
  { colKey: 'costPrice', title: '本店成本价', width: 120 },
  { colKey: 'guidePrice', title: '指导价', width: 120 },
  { colKey: 'rolePrices', title: '角色最低可售价', minWidth: 240 },
];
function money(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toFixed(2);
}
function attributeLabel(key: string) {
  return (
    props.product.specDimensions?.find((item) => item.key === key)?.name ||
    ({ material: '材质', length: '长度', color: '颜色', size: '尺寸' } as Record<string, string>)[key] ||
    key
  );
}
function openDescriptionPreview(resource: { url?: string; mediaType: string }) {
  if (resource.url) preview.value = { url: resource.url, kind: resource.mediaType === 'video' ? 'video' : 'image' };
}
</script>
