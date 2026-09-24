<template>
  <template v-if="isMedia">
    <button
      v-if="media?.available && media.url"
      type="button"
      class="product-log-media"
      :aria-label="`查看${label}`"
      @click="emit('preview', media)"
    >
      <video
        v-if="media.mediaType === 'video'"
        class="operation-log-media-preview operation-log-media-preview--video"
        :src="media.url"
        preload="metadata"
        muted
        playsinline
      />
      <img
        v-else
        class="operation-log-media-preview operation-log-media-preview--image"
        :src="media.url"
        :alt="label"
      />
      <span v-if="media.mediaType === 'video'">点击播放视频</span>
    </button>
    <span v-else>{{ missing ? '未上传' : media?.message || '历史媒体已不可用' }}</span>
    <span v-if="media?.available && media.message">{{ media.message }}</span>
  </template>
  <slot v-else>{{ formatted }}</slot>
</template>

<script setup lang="ts">
import { computed } from 'vue';
export interface ProductLogMedia {
  available: boolean;
  url?: string;
  mediaType: string;
  message?: string;
}
const props = withDefaults(
  defineProps<{
    value?: unknown;
    label: string;
    isMedia?: boolean;
    media?: ProductLogMedia | null;
    missing?: boolean;
  }>(),
  { value: undefined, media: null, isMedia: false, missing: false },
);
const emit = defineEmits<{ preview: [media: ProductLogMedia] }>();
const formatted = computed(() => {
  if (props.value == null || props.value === '') return '—';
  return typeof props.value === 'object' ? JSON.stringify(props.value) : String(props.value);
});
</script>

<style scoped>
.product-log-media {
  display: block;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.operation-log-media-preview {
  display: block;
  width: 180px;
  height: 108px;
  max-width: 100%;
  border-radius: var(--td-radius-default);
  object-fit: cover;
  cursor: pointer;
}
.operation-log-media-preview--video {
  background: var(--td-bg-color-secondarycontainer);
}
</style>
