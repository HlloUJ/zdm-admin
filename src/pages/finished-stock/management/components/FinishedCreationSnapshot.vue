<template>
  <t-space direction="vertical" size="large" class="creation-snapshot creation-snapshot-sections">
    <AdminSectionCard>
      <h3 class="creation-section-title">图文描述</h3>
      <t-space direction="vertical" size="large" class="creation-snapshot">
        <div v-for="group in mediaGroups" :key="group.label">
          <div class="creation-media-grid">
            <div v-for="(asset, index) in group.items" :key="asset.field" class="creation-media-card">
              <div class="creation-media-title">
                {{ group.items.length > 1 ? `${group.label}${index + 1}` : group.label }}
              </div>
              <button
                type="button"
                class="creation-media-preview"
                :disabled="!asset.resource?.available"
                :aria-label="`查看${group.label}`"
                @click="asset.resource && emit('preview', asset.resource)"
              >
                <video
                  v-if="asset.resource?.available && asset.resource.mediaType === 'video'"
                  :src="asset.resource.url"
                  preload="metadata"
                  muted
                  playsinline
                />
                <img v-else-if="asset.resource?.available" :src="asset.resource.url" :alt="group.label" />
                <span v-else>{{ asset.resource?.message || '历史媒体已不可用' }}</span>
              </button>
              <div class="creation-media-hint">
                {{
                  asset.resource?.available
                    ? asset.resource.message || (asset.resource.mediaType === 'video' ? '点击播放视频' : '点击查看大图')
                    : '暂无可预览内容'
                }}
              </div>
            </div>
          </div>
          <span v-if="!group.items.length">未上传</span>
        </div>
        <div>
          <h4 class="creation-rich-text-title">宝贝详情</h4>
          <HistoricalRichText :html="richText" :media="media" @preview="emit('preview', $event)" />
        </div>
      </t-space>
    </AdminSectionCard>
    <AdminSectionCard>
      <h3 class="creation-section-title">基础信息</h3>
      <t-descriptions bordered :column="3" class="creation-basic-top">
        <t-descriptions-item label="商品名称" :span="3">{{ text(snapshot['商品名称']) }}</t-descriptions-item>
        <t-descriptions-item label="商品分类" :span="3"
          ><t-tooltip v-if="categoryHint" :content="categoryHint"
            ><span>{{ text(snapshot['商品分类']) }}</span></t-tooltip
          ><template v-else>{{ text(snapshot['商品分类']) }}</template></t-descriptions-item
        >
      </t-descriptions>
      <h4 class="creation-attributes-heading">商品属性</h4>
      <t-descriptions bordered :column="3" class="creation-basic-attributes">
        <t-descriptions-item
          v-for="attribute in attributes"
          :key="attribute.attributeId"
          :label="attribute.attributeName"
          >{{ text(attribute.value) }}</t-descriptions-item
        >
        <t-descriptions-item label="供应商" :span="3">{{ text(snapshot['供应商']) }}</t-descriptions-item>
      </t-descriptions>
    </AdminSectionCard>
    <AdminSectionCard>
      <h3 class="creation-section-title creation-sales-title">销售信息</h3>
      <SalesLogFullscreen>
        <h4>销售规格</h4>
        <FinishedSalesLogTable :snapshot="snapshot" :other="{}" />
      </SalesLogFullscreen>
      <t-descriptions bordered :column="3" class="creation-sales-summary">
        <t-descriptions-item label="总库存">{{ text(snapshot['总库存']) }}</t-descriptions-item>
        <t-descriptions-item label="商家编码">{{ text(snapshot['商家编码']) }}</t-descriptions-item>
        <t-descriptions-item label="上架">{{
          snapshot['状态'] === 'selling'
            ? '立即上架'
            : snapshot['状态'] === 'warehouse'
              ? '暂不上架'
              : text(snapshot['状态'])
        }}</t-descriptions-item>
      </t-descriptions>
    </AdminSectionCard>
  </t-space>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import SalesLogFullscreen from './SalesLogFullscreen.vue';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';
import HistoricalRichText from './HistoricalRichText.vue';
import { AdminSectionCard } from '@/components/foundation';
import type { FinishedProductAttributeEntry } from '@/services/finishedProducts';
interface Resource {
  available: boolean;
  url?: string;
  mediaType: string;
  message?: string;
  previewOnly?: boolean;
}
interface Media {
  field: string;
  mediaId: number;
  resource?: Resource;
}
const props = defineProps<{
  snapshot: Record<string, unknown>;
  media: Media[];
  richText: string;
  categoryHint?: string;
}>();
const emit = defineEmits<{ preview: [resource: Resource] }>();
const mediaGroups = computed(() => [
  {
    label: '商品主图',
    items: props.media
      .filter((media) => /^mainImage[2-5]?$/.test(media.field))
      .sort((a, b) => a.field.localeCompare(b.field)),
  },
  { label: '商品视频', items: props.media.filter((media) => media.field === 'video') },
]);
function list<T>(field: string): T[] {
  return Array.isArray(props.snapshot[field]) ? (props.snapshot[field] as T[]) : [];
}
const attributes = computed(() => list<FinishedProductAttributeEntry>('商品属性'));
const text = (value: unknown) => (value == null || value === '' ? '未填写' : String(value));
</script>
<style scoped>
.creation-sales-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.creation-attributes-heading {
  margin: 0;
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  border-right: 1px solid var(--td-component-border);
  border-left: 1px solid var(--td-component-border);
  background-color: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-medium);
  font-weight: 400;
}
.creation-basic-top,
.creation-basic-attributes {
  margin: 0;
}
.creation-snapshot {
  width: 100%;
}
.creation-snapshot-sections {
  box-sizing: border-box;
}
.creation-snapshot-sections :deep(.zdm-admin-section-card) {
  border: 1px solid var(--td-component-border);
  box-shadow: none;
}
.creation-section-title {
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
  margin: calc(-1 * var(--zdm-admin-card-padding));
  margin-bottom: var(--zdm-admin-card-padding);
  padding: var(--td-comp-paddingTB-m) var(--zdm-admin-card-padding);
  border-bottom: 1px solid var(--td-component-border);
  border-radius: var(--zdm-admin-card-radius) var(--zdm-admin-card-radius) 0 0;
  background: var(--td-bg-color-secondarycontainer);
}
.creation-rich-text-title {
  margin: 0 0 var(--td-comp-margin-m);
}
.creation-media-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--td-comp-margin-m);
}
.creation-media-card {
  overflow: hidden;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}
.creation-media-title {
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  font-weight: 500;
}
.creation-media-preview {
  display: flex;
  width: 100%;
  aspect-ratio: 16 / 10;
  align-items: center;
  justify-content: center;
  padding: var(--td-comp-paddingTB-s);
  border: 0;
  background: var(--td-bg-color-container-hover);
  color: var(--td-text-color-placeholder);
  font: inherit;
  cursor: zoom-in;
}
.creation-media-preview:disabled {
  cursor: default;
}
.creation-media-preview:focus-visible {
  outline: 2px solid var(--td-brand-color);
  outline-offset: -2px;
}
.creation-media-hint {
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}
.creation-media-preview img,
.creation-media-preview video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.creation-rich-text {
  overflow-wrap: anywhere;
}
.creation-rich-text :deep(img),
.creation-rich-text :deep(video) {
  max-width: 100%;
}
.creation-sales-summary {
  margin-top: var(--td-comp-margin-l);
}
</style>
