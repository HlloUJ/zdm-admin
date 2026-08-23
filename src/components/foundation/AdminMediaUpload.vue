<template>
  <div
    class="admin-media-upload"
    :class="{ 'is-disabled': disabled, 'is-error': Boolean(errorMessage), 'is-loading': loading }"
  >
    <span v-if="required && showTitle" class="admin-media-upload__required">*</span>
    <t-button
      v-if="modelValue && !disabled"
      class="admin-media-upload__delete"
      theme="danger"
      variant="text"
      size="small"
      @click.stop="remove"
    >
      删除
    </t-button>
    <strong v-if="showTitle">{{ title }}</strong>
    <img
      v-if="previewUrl"
      class="admin-media-upload__preview"
      :src="previewUrl"
      :alt="title"
      role="button"
      tabindex="0"
      @click.stop="emit('preview', modelValue)"
      @keydown.enter.stop="emit('preview', modelValue)"
    />
    <t-loading v-else-if="loading" size="small" />
    <t-icon v-else name="add" />
    <span>{{ modelValue?.name || label }}</span>
    <span v-if="errorMessage" class="admin-media-upload__error">{{ errorMessage }}</span>
    <input
      class="admin-media-upload__input"
      type="file"
      :accept="accept"
      :disabled="disabled || loading"
      @change="selectFile"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
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
    label?: string;
    accept?: string;
    required?: boolean;
    showTitle?: boolean;
    disabled?: boolean;
    errorMessage?: string;
    upload: (file: File) => Promise<AdminMediaValue>;
  }>(),
  {
    modelValue: undefined,
    label: '点击上传',
    accept: 'image/*',
    required: false,
    showTitle: true,
    disabled: false,
    errorMessage: '',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value?: AdminMediaValue];
  uploaded: [value: AdminMediaValue];
  removed: [value: AdminMediaValue];
  preview: [value?: AdminMediaValue];
}>();

const loading = ref(false);
const previewUrl = computed(() => props.modelValue?.coverUrl || props.modelValue?.url);

const selectFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  loading.value = true;
  try {
    const previous = props.modelValue;
    const uploaded = await props.upload(file);
    emit('update:modelValue', uploaded);
    emit('uploaded', uploaded);
    if (previous) emit('removed', previous);
    adminFeedback.actionSuccess({ action: '上传', target: props.title });
  } catch (error) {
    adminFeedback.actionError({ action: '上传', error, fallback: '请稍后重试', target: props.title });
  } finally {
    loading.value = false;
    input.value = '';
  }
};

const remove = () => {
  if (props.modelValue) emit('removed', props.modelValue);
  emit('update:modelValue', undefined);
};
</script>

<style scoped>
.admin-media-upload {
  position: relative;
  min-height: 168px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-comp-margin-s);
  border: 1px dashed var(--td-component-border);
  border-radius: var(--td-radius-medium);
  color: var(--td-text-color-secondary);
  cursor: pointer;
}

.admin-media-upload:hover:not(.is-disabled) {
  border-color: var(--td-brand-color);
}

.admin-media-upload.is-disabled {
  cursor: default;
}

.admin-media-upload.is-error {
  border-color: var(--td-error-color);
}

.admin-media-upload__required {
  position: absolute;
  top: var(--td-comp-paddingTB-s);
  left: var(--td-comp-paddingLR-s);
  color: var(--td-error-color);
}

.admin-media-upload__delete {
  position: absolute;
  top: var(--td-comp-paddingTB-xs);
  right: var(--td-comp-paddingLR-xs);
  z-index: 2;
}

.admin-media-upload__preview {
  position: relative;
  z-index: 2;
  width: 96px;
  height: 96px;
  object-fit: cover;
}

.admin-media-upload__error {
  color: var(--td-error-color);
  font: var(--td-font-body-small);
}

.admin-media-upload__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  z-index: 1;
}

.admin-media-upload__delete,
.admin-media-upload__preview {
  pointer-events: auto;
}
</style>
