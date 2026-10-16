<template>
  <t-upload
    :key="resetKey"
    class="admin-media-upload"
    :aria-required="required || undefined"
    :class="{ 'admin-media-upload--invalid': Boolean(errorMessage) }"
    :files="files"
    theme="image"
    :accept="accept"
    :disabled="disabled"
    :max="1"
    :multiple="false"
    :allow-upload-duplicate-file="true"
    :show-image-file-name="false"
    :use-mock-progress="false"
    :request-method="requestUpload"
    :image-viewer-props="{ visible: false }"
    :locale="{ triggerUploadText: { image: title } }"
    :input-attributes="{ 'aria-label': title }"
    :status="errorMessage ? 'error' : 'default'"
    :tips="errorMessage"
    :role="modelValue ? 'button' : undefined"
    :aria-label="mediaType === 'video' ? `播放${title}` : title"
    :tabindex="modelValue ? 0 : undefined"
    @change="files = $event"
    @success="uploaded"
    @fail="uploadFailed"
    @remove="remove"
    @preview="preview"
    @click.capture="previewFilled"
    @keydown.enter="previewKey"
    @keydown.space="previewKey"
  />
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import './official/media-upload.css';
import type { RequestMethodResponse, SuccessContext, UploadFile } from 'tdesign-vue-next';
import { adminFeedback } from './feedback/adminFeedback';

export interface AdminMediaValue {
  name: string;
  mediaId?: number;
  url?: string;
  videoMediaId?: number;
  videoUrl?: string;
  coverMediaId?: number;
  coverUrl?: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: AdminMediaValue;
    title: string;
    accept?: string;
    disabled?: boolean;
    required?: boolean;
    label?: string;
    showTitle?: boolean;
    showFileName?: boolean;
    previewOnFilledClick?: boolean;
    mediaType?: 'image' | 'video';
    errorMessage?: string;
    upload: (file: File) => Promise<AdminMediaValue>;
  }>(),
  { modelValue: undefined, mediaType: 'image', accept: 'image/*', disabled: false, errorMessage: '' },
);
const emit = defineEmits<{
  'update:modelValue': [value?: AdminMediaValue];
  uploaded: [value: AdminMediaValue];
  removed: [value: AdminMediaValue];
  preview: [value?: AdminMediaValue];
}>();
const files = ref<UploadFile[]>([]);
const resetKey = ref(0);
watch(
  () => [props.modelValue, props.mediaType] as const,
  ([value, mediaType], _, onCleanup) => {
    const thumbnailUrl = value?.coverUrl || (mediaType === 'video' ? '' : value?.url);
    files.value = value ? [{ name: value.name, url: thumbnailUrl, status: 'success' }] : [];
    const videoUrl = value?.videoUrl || value?.url;
    if (!value || !videoUrl || mediaType !== 'video' || value.coverUrl) return;
    // Only the native card receives a thumbnail; model/preview/save keep the original video URL.
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    let active = true;
    const cleanup = () => {
      active = false;
      clearTimeout(timeout);
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
    const timeout = setTimeout(cleanup, 15000);
    onCleanup(cleanup);
    video.onloadeddata = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (context && active) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          files.value = [{ name: value.name, url: canvas.toDataURL('image/jpeg', 0.85), status: 'success' }];
        }
      } catch {
        // A missing thumbnail must never block the original video preview or removal.
      } finally {
        cleanup();
      }
    };
    video.onerror = cleanup;
    video.src = videoUrl;
    video.load();
  },
  { immediate: true },
);
async function requestUpload(input: UploadFile | UploadFile[]): Promise<RequestMethodResponse> {
  const file = Array.isArray(input) ? input[0] : input;
  const previous = props.modelValue;
  try {
    if (!file?.raw) throw new Error('请选择文件');
    const media = await props.upload(file.raw);
    return { status: 'success', response: { url: media.url, media, previous } };
  } catch (error) {
    adminFeedback.actionError({ action: '上传', error, fallback: '请稍后重试', target: props.title });
    return { status: 'fail', error: error instanceof Error ? error.message : '请稍后重试', response: {} };
  }
}
function uploadFailed() {
  if (!props.modelValue) files.value = [];
  resetKey.value++;
}
function uploaded(context: SuccessContext) {
  const { media, previous } = context.response as { media: AdminMediaValue; previous?: AdminMediaValue };
  emit('update:modelValue', media);
  emit('uploaded', media);
  if (previous) emit('removed', previous);
  adminFeedback.actionSuccess({ action: '上传', target: props.title });
}
function remove() {
  if (props.disabled) return;
  if (props.modelValue) emit('removed', props.modelValue);
  emit('update:modelValue', undefined);
}
function preview() {
  if (props.modelValue) emit('preview', props.modelValue);
}
function previewKey(event: KeyboardEvent) {
  if (!props.modelValue) return;
  event.preventDefault();
  preview();
}
function previewFilled(event: MouseEvent) {
  if (!props.modelValue) return;
  const target = event.target as Element;
  if (target.closest('.t-icon-delete, .t-upload__icon-delete')) return;
  event.preventDefault();
  event.stopPropagation();
  preview();
}
</script>
