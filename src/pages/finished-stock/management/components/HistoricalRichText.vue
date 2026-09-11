<template><div class="historical-rich-text" @click="openPreview" v-html="content" /></template>
<script setup lang="ts">
import { computed } from 'vue';
import DOMPurify from 'dompurify';
interface Resource {
  available: boolean;
  url?: string;
  mediaType: string;
  message?: string;
  previewOnly?: boolean;
}
const props = defineProps<{ html: string; media: { resource?: Resource }[] }>();
const emit = defineEmits<{ preview: [resource: Resource] }>();
const resources = computed(() => props.media.flatMap((item) => (item.resource ? [item.resource] : [])));
const content = computed(() => {
  const document = new DOMParser().parseFromString(
    DOMPurify.sanitize(props.html, { ADD_TAGS: ['video'], ADD_ATTR: ['controls'] }),
    'text/html',
  );
  document.querySelectorAll('img,video').forEach((element) => {
    const url = element.getAttribute('src') || '';
    const index = resources.value.findIndex((item) => item.available && item.url === url && url !== '');
    if (index < 0) {
      const placeholder = document.createElement('span');
      placeholder.textContent = '历史媒体已不可用';
      element.replaceWith(placeholder);
      return;
    }
    const resource = resources.value[index];
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.historyPreview = String(index);
    button.className = 'history-rich-preview';
    const thumbnail = document.createElement(resource.mediaType === 'video' ? 'video' : 'img');
    thumbnail.setAttribute('src', url);
    if (resource.mediaType === 'video') {
      thumbnail.setAttribute('preload', 'metadata');
      thumbnail.setAttribute('muted', '');
    } else {
      thumbnail.setAttribute('alt', '详情图片');
    }
    const label = document.createElement('span');
    label.textContent = resource.message || (resource.mediaType === 'video' ? '点击播放视频' : '点击查看大图');
    button.append(thumbnail, label);
    element.replaceWith(button);
  });
  return DOMPurify.sanitize(document.body.innerHTML, {
    ADD_TAGS: ['video'],
    ADD_ATTR: ['data-history-preview', 'preload', 'muted'],
  });
});
function openPreview(event: MouseEvent) {
  const button = (event.target as Element).closest<HTMLElement>('[data-history-preview]');
  if (!button) return;
  const resource = resources.value[Number(button.dataset.historyPreview)];
  if (resource?.available) emit('preview', resource);
}
</script>
<style scoped>
.historical-rich-text {
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-m);
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-secondarycontainer);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.historical-rich-text :deep(p),
.historical-rich-text :deep(div),
.historical-rich-text :deep(h1),
.historical-rich-text :deep(h2),
.historical-rich-text :deep(h3),
.historical-rich-text :deep(h4),
.historical-rich-text :deep(ul),
.historical-rich-text :deep(ol),
.historical-rich-text :deep(blockquote) {
  margin-block: var(--td-comp-margin-xs);
}
.historical-rich-text :deep(p:empty),
.historical-rich-text :deep(p:has(> br:only-child)) {
  margin-block: 0;
  line-height: 0.5;
}
.historical-rich-text :deep(> :first-child) {
  margin-top: 0;
}
.historical-rich-text :deep(> :last-child) {
  margin-bottom: 0;
}
.historical-rich-text :deep(.history-rich-preview) {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: var(--td-comp-margin-xs);
  max-width: 100%;
  padding: var(--td-comp-paddingTB-s);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-container);
  cursor: pointer;
  vertical-align: top;
}
.historical-rich-text :deep(.history-rich-preview img),
.historical-rich-text :deep(.history-rich-preview video) {
  width: 160px;
  height: 100px;
  object-fit: contain;
  pointer-events: none;
}
</style>
