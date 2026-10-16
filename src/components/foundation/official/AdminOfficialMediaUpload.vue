<template>
  <t-upload
    :files="files"
    theme="file-input"
    :trigger-button-props="{ theme: buttonTheme('upload') }"
    :accept="accept"
    :disabled="disabled"
    :max="1"
    :request-method="request"
    :input-attributes="{ 'aria-label': title }"
    @click="previewName"
    @remove="emit('update:modelValue', undefined)"
    @preview="emit('preview', modelValue)"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { buttonTheme } from '../actions/buttonFunctions';
import type { UploadProps } from 'tdesign-vue-next';
import type { AdminMediaValue } from '../AdminMediaUpload.vue';
import { adminFeedback } from '../feedback/adminFeedback';
defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    modelValue?: AdminMediaValue;
    title: string;
    accept?: string;
    disabled?: boolean;
    upload: (file: File) => Promise<AdminMediaValue>;
  }>(),
  { accept: '', disabled: false },
);
const emit = defineEmits<{
  'update:modelValue': [value?: AdminMediaValue];
  preview: [value?: AdminMediaValue];
}>();
const files = computed<UploadProps['files']>(() =>
  props.modelValue ? [{ name: props.modelValue.name, url: props.modelValue.url, status: 'success' }] : [],
);
const request: NonNullable<UploadProps['requestMethod']> = async (selected) => {
  const file = Array.isArray(selected) ? selected[0] : selected;
  try {
    if (!file.raw) throw new Error('请选择附件');
    const value = await props.upload(file.raw);
    emit('update:modelValue', value);
    adminFeedback.actionSuccess({ action: '上传', target: props.title });
    return { status: 'success', response: { url: value.url ?? '' } };
  } catch (error) {
    adminFeedback.actionError({ action: '上传', error, fallback: '请稍后重试', target: props.title });
    return { status: 'fail', error: error instanceof Error ? error.message : '上传失败', response: {} };
  }
};
function previewName(event: MouseEvent) {
  if (props.modelValue && event.target instanceof Element && event.target.closest('.t-upload__single-input-text'))
    emit('preview', props.modelValue);
}
</script>
