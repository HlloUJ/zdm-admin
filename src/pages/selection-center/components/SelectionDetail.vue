<script setup lang="ts">
import { buttonTheme } from '@/components/foundation/actions/buttonFunctions';
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { AdminDialog } from '@/components/foundation';
import type { CenterDetail, CenterProduct } from '@/services/storeSelectionCenter';
import { centerPrice } from '@/services/storeSelectionCenter';
import { selectionSalesModel, selectionAttributes } from '../selectionDetailModel';
import HistoricalRichText from '@/pages/finished-stock/management/components/HistoricalRichText.vue';
const props = defineProps<{ detail: CenterDetail | null }>();
const emit = defineEmits<{ close: []; add: [product: CenterProduct] }>();
const mode = ref<'video' | 'gallery'>('gallery');
const index = ref(0);
const mediaPreview = ref<{ url?: string; mediaType: string } | null>(null);
const images = computed(() => props.detail?.information.imageUrls ?? []);
const video = computed(() => props.detail?.information.videoUrl);
const model = computed(() => (props.detail ? selectionSalesModel(props.detail.information) : null));
const descriptionMedia = computed(() => {
  const doc = new DOMParser().parseFromString(props.detail?.information.detail || '', 'text/html');
  return Array.from(doc.querySelectorAll('img[src],video[src]')).flatMap((el) => {
    const url = el.getAttribute('src');
    return url ? [{ resource: { available: true, url, mediaType: el.tagName === 'VIDEO' ? 'video' : 'image' } }] : [];
  });
});
const attributes = computed(() => (props.detail ? selectionAttributes(props.detail.information) : []));
let restore: (() => void) | null = null;
function unlock() {
  restore?.();
  restore = null;
}
watch(
  () => props.detail,
  (detail) => {
    if (!detail) {
      mediaPreview.value = null;
      unlock();
      return;
    }
    index.value = 0;
    mode.value = detail.information.videoUrl ? 'video' : 'gallery';
    if (restore) return;
    const root = document.documentElement,
      overflow = root.style.overflow,
      gutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = 'stable';
    root.style.overflow = 'hidden';
    restore = () => {
      root.style.overflow = overflow;
      root.style.scrollbarGutter = gutter;
    };
  },
  { flush: 'sync' },
);
onBeforeUnmount(unlock);
</script>
<template>
  <t-drawer
    header="商品详情"
    :visible="Boolean(detail)"
    size="min(1120px, 100%)"
    :footer="false"
    @close="emit('close')"
  >
    <template v-if="detail">
      <div class="detail-media-layout">
        <aside class="media-thumbnails" aria-label="商品媒体缩略图">
          <t-check-tag v-if="video" :checked="mode === 'video'" aria-label="播放商品视频" @change="mode = 'video'">
            <div class="media-thumb">
              <img v-if="detail.product.imageUrl" :src="detail.product.imageUrl" alt="视频封面" /><t-icon
                name="play-circle"
                class="thumbnail-play-icon"
              />
            </div>
          </t-check-tag>
          <t-check-tag
            v-for="(src, i) in images"
            :key="src"
            :checked="mode === 'gallery' && index === i"
            :aria-label="`查看商品图片${i + 1}`"
            @change="
              mode = 'gallery';
              index = i;
            "
          >
            <div class="media-thumb"><img :src="src" :alt="detail.product.name" /></div>
          </t-check-tag>
        </aside>
        <div class="detail-media-main">
          <div class="media-stage">
            <video
              v-if="mode === 'video' && video"
              :src="video"
              controls
              autoplay
              muted
              playsinline
              aria-label="商品视频"
            />
            <img v-else-if="images[index]" :src="images[index]" :alt="detail.product.name" />
            <t-empty v-else description="暂无商品媒体" />
          </div>
          <div v-if="video && images.length" class="media-mode-switch">
            <t-radio-group v-model="mode" variant="default-filled"
              ><t-radio-button value="video">视频</t-radio-button
              ><t-radio-button value="gallery">图集</t-radio-button></t-radio-group
            >
          </div>
        </div>
      </div>
      <div class="detail-product-summary">
        <div class="product-name">{{ detail.product.name }}</div>
        <div class="detail-price-row">
          <div class="price">¥ {{ centerPrice(detail.product) }}</div>
          <t-button
            v-if="!detail.product.soldOut && !detail.product.addedToStore && !detail.product.inSelection"
            :theme="buttonTheme('select-product')"
            :disabled="!detail.product.canAdd"
            @click="emit('add', detail.product)"
            >加入清单</t-button
          >
        </div>
        <t-tag v-if="detail.product.addedToStore" theme="primary" variant="light">已加入门店</t-tag
        ><t-tag v-else-if="detail.product.inSelection" theme="success" variant="light">已加入选品清单</t-tag
        ><t-tag v-if="detail.product.soldOut" theme="warning" variant="light">已售完</t-tag>
        <t-tag
          v-for="reason in detail.product.reasons.filter((r) => !r.includes('已加入门店') && !r.includes('已售完'))"
          :key="reason"
          theme="warning"
          variant="light"
          >{{ reason }}</t-tag
        >
      </div>
      <t-space direction="vertical" size="large" class="detail-sections"
        ><t-card title="基础信息" size="small" class="center-detail-section" :body-style="{ paddingTop: '0' }">
          <t-descriptions :column="4">
            <t-descriptions-item label="分类" :span="4">
              <div class="detail-category-path" tabindex="0" role="region" aria-label="分类路径">
                {{ detail.information.categoryName || '—' }}
              </div>
            </t-descriptions-item>
            <t-descriptions-item label="商品类型">{{
              detail.product.type === 'finished' ? '成品现货' : '配件'
            }}</t-descriptions-item>
            <t-descriptions-item label="规格数量">{{ detail.information.skus.length }}</t-descriptions-item>
            <t-descriptions-item label="可供库存">{{ detail.information.totalStock }}</t-descriptions-item>
            <t-descriptions-item v-for="field in attributes" :key="field.attributeId" :label="field.attributeName">{{
              field.value === '' || field.value == null ? '—' : field.value
            }}</t-descriptions-item>
          </t-descriptions>
        </t-card>
        <t-card
          v-if="model"
          title="销售信息"
          size="small"
          class="center-detail-section"
          :body-style="{ paddingTop: '0' }"
        >
          <t-table
            class="selection-sales-table"
            row-key="skuId"
            :data="model.rows"
            :columns="model.columns"
            table-layout="auto"
          />
        </t-card>
        <t-card v-if="detail.information.detail" title="图文描述" size="small" class="center-detail-section"
          ><HistoricalRichText
            class="selection-description"
            :html="detail.information.detail"
            :media="descriptionMedia"
            @preview="mediaPreview = $event"
        /></t-card>
      </t-space>
    </template>
  </t-drawer>
  <AdminDialog
    :visible="Boolean(mediaPreview)"
    header="商品媒体"
    :footer="false"
    :confirmation="{ kind: 'none' }"
    confirm-function="close"
    mode="modal"
    show-overlay
    close-on-overlay-click
    width="min(960px, 94vw)"
    @close="mediaPreview = null"
    @update:visible="!$event && (mediaPreview = null)"
    ><img
      v-if="mediaPreview?.mediaType === 'image'"
      :src="mediaPreview.url"
      alt="商品图片"
      class="center-description-preview" /><video
      v-else-if="mediaPreview"
      :src="mediaPreview.url"
      controls
      autoplay
      playsinline
      class="center-description-preview"
  /></AdminDialog>
</template>
<style scoped>
.center-description-preview {
  max-width: 100%;
  max-height: calc(100dvh - 160px);
}

.selection-sales-table :deep(.selection-sales-heading),
.selection-sales-table :deep(.selection-sales-cell) {
  white-space: nowrap;
}

.detail-category-path {
  max-width: 100%;
  overflow-x: auto;
  white-space: nowrap;
}

.detail-sections {
  width: 100%;
}
</style>
