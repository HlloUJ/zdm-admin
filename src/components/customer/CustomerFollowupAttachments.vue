<template>
  <div>
    <t-upload
      :files="files"
      theme="file"
      multiple
      :allow-upload-duplicate-file="true"
      :max="3"
      :size-limit="{ size: 5 * 1024 * 1024, unit: 'B', message: '附件不能超过5MiB' }"
      :disabled="pending > 0"
      :use-mock-progress="false"
      :upload-all-files-in-one-request="false"
      :request-method="request"
      :trigger-button-props="{
        theme: buttonTheme('upload'),
        variant: 'outline',
        disabled: pending > 0 || files.length >= 3,
      }"
      :input-attributes="{ 'aria-label': '选择附件' }"
      tips="最多3个附件，单个不超过5MiB"
    >
      <template #file-list-display="{ files: displayed }">
        <div
          v-for="(file, index) in displayRows(displayed)"
          :key="file.mediaId ?? `${file.name}-${index}`"
          class="t-upload__single-display-text t-upload__display-text--margin customer-followup-file-row"
        >
          <t-link
            v-if="file.mediaId"
            :theme="buttonTheme('preview')"
            hover="color"
            size="small"
            class="t-upload__single-name"
            tabindex="0"
            @click="preview(file)"
            @keydown.enter.prevent="preview(file)"
            >{{ file.name }}</t-link
          >
          <span v-else class="t-upload__single-name">{{ file.name }}</span>
          <t-loading v-if="file.status === 'progress'" size="small" />
          <t-space v-else-if="file.mediaId" class="customer-followup-file-actions" align="center" size="small">
            <swap-icon
              size="0.8em"
              class="t-upload__icon-delete customer-followup-file-replace"
              role="button"
              :aria-label="`替换附件：${file.name}`"
              tabindex="0"
              @click="chooseReplacement(file, $event.e)"
              @keydown.enter.prevent="chooseReplacement(file)"
            />
            <close-icon
              class="t-upload__icon-delete"
              role="button"
              :aria-label="`删除附件：${file.name}`"
              tabindex="0"
              @click="remove(file)"
              @keydown.enter.prevent="remove(file)"
            />
          </t-space>
        </div>
      </template>
    </t-upload>
    <input
      ref="replacementInput"
      type="file"
      hidden
      aria-label="替换附件"
      @change="replaceSelected"
      @cancel="replacementIndex = undefined"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CloseIcon, SwapIcon } from 'tdesign-icons-vue-next';
import type { UploadFile, UploadProps } from 'tdesign-vue-next';
import type { AdminMediaValue } from '@/components/foundation/AdminMediaUpload.vue';
import { buttonTheme } from '@/components/foundation/actions/buttonFunctions';
import { adminFeedback } from '@/components/foundation/feedback/adminFeedback';

const props = defineProps<{
  modelValue: (AdminMediaValue | undefined)[];
  upload: (file: File, index: number) => Promise<AdminMediaValue>;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: (AdminMediaValue | undefined)[]];
  preview: [value: AdminMediaValue, index: number];
}>();
type MediaFile = UploadFile & { mediaId?: number; slotIndex?: number };
const values = ref([...props.modelValue]);
watch(
  () => props.modelValue,
  (value) => {
    values.value = [...value];
  },
);
const pending = ref(0);
const reserved = new Set<number>();
const replacementInput = ref<HTMLInputElement>();
const replacementIndex = ref<number>();
let active = true;
onBeforeUnmount(() => {
  active = false;
});
const files = computed<MediaFile[]>(() =>
  values.value.flatMap((value, slotIndex) =>
    value
      ? [
          {
            name: value.name,
            mediaId: value.mediaId,
            slotIndex,
            url: value.url ?? `#attachment-${value.mediaId}`,
            status: 'success' as const,
          },
        ]
      : [],
  ),
);
function displayRows(displayed: UploadFile[]): MediaFile[] {
  return (displayed as MediaFile[]).filter(
    (file, index, list) =>
      file.status !== 'fail' && (!file.mediaId || list.findIndex((other) => other.mediaId === file.mediaId) === index),
  );
}
function publish() {
  emit('update:modelValue', [...values.value]);
}
function indexFor(file: MediaFile) {
  return values.value.findIndex((value) => value?.mediaId === file.mediaId);
}
function preview(file: MediaFile) {
  const index = indexFor(file);
  const value = values.value[index];
  if (value) emit('preview', value, index);
}
function remove(file: MediaFile) {
  if (pending.value) return;
  const index = indexFor(file);
  if (index < 0) return;
  values.value[index] = undefined;
  publish();
}
async function uploadInto(raw: File, index: number) {
  const value = await props.upload(raw, index);
  if (active) {
    values.value[index] = value;
    publish();
    adminFeedback.actionSuccess({ action: '上传', target: raw.name });
  }
  return value;
}
const request: NonNullable<UploadProps['requestMethod']> = async (selected) => {
  const file = (Array.isArray(selected) ? selected[0] : selected) as MediaFile;
  const index = [0, 1, 2].find((slot) => !values.value[slot] && !reserved.has(slot));
  if (index === undefined || !file.raw) return { status: 'fail', error: '最多3个附件', response: {} };
  reserved.add(index);
  pending.value++;
  try {
    const value = await uploadInto(file.raw, index);
    file.mediaId = value.mediaId;
    file.slotIndex = index;
    return { status: 'success', response: { files: [{ ...file, url: value.url ?? `#attachment-${value.mediaId}` }] } };
  } catch (error) {
    if (active) adminFeedback.actionError({ action: '上传', target: file.name, error, fallback: '请稍后重试' });
    return { status: 'fail', error: error instanceof Error ? error.message : '上传失败', response: {} };
  } finally {
    reserved.delete(index);
    pending.value--;
  }
};
function chooseReplacement(file: MediaFile, event?: MouseEvent) {
  if (pending.value) return;
  const index = indexFor(file);
  if (index < 0 || !replacementInput.value) return;
  // Pointer activation must not leave keyboard focus on the icon after the picker closes.
  // Keep focus for keyboard activation so its accessible focus indication remains available.
  if (event && event.detail > 0) (event.currentTarget as SVGElement | null)?.blur();
  replacementIndex.value = index;
  replacementInput.value.value = '';
  replacementInput.value.click();
}
async function replaceSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const index = replacementIndex.value;
  replacementIndex.value = undefined;
  input.value = '';
  if (!file || index === undefined || pending.value) return;
  pending.value++;
  try {
    await uploadInto(file, index);
  } catch (error) {
    if (active) adminFeedback.actionError({ action: '上传', target: file.name, error, fallback: '请稍后重试' });
  } finally {
    pending.value--;
  }
}
</script>
