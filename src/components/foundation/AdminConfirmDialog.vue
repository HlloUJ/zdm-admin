<template>
  <AdminDialog
    :visible="visible"
    :header="dialogTitle"
    :width="width"
    dialog-class-name="zdm-admin-confirm-dialog"
    :confirm-btn="confirmText"
    :cancel-btn="mode === 'blocked' ? null : '取消'"
    @update:visible="emit('update:visible', $event)"
    @confirm="handleConfirm"
    @cancel="emit('cancel')"
    @close="emit('close')"
    @opened="emit('opened')"
    @closed="emit('closed')"
  >
    <div class="zdm-admin-confirm-dialog__content">
      <slot>{{ dialogDescription }}</slot>
    </div>
  </AdminDialog>
</template>

<script setup lang="ts">
import type { ButtonProps } from 'tdesign-vue-next';
import { computed } from 'vue';

import AdminDialog from './AdminDialog.vue';

const props = withDefaults(
  defineProps<{
    action: string;
    description?: string;
    danger?: boolean;
    mode?: 'confirm' | 'blocked';
    objectName?: string;
    objectType?: string;
    title?: string;
    visible: boolean;
    width?: string;
  }>(),
  {
    description: '',
    danger: false,
    mode: 'confirm',
    objectName: '',
    objectType: '',
    title: '',
    width: '440px',
  },
);

const emit = defineEmits<{
  'update:visible': [value: boolean];
  cancel: [];
  close: [];
  closed: [];
  confirm: [];
  opened: [];
}>();

const targetText = computed(() => {
  const name = props.objectName ? `“${props.objectName}”` : '';
  return `${props.objectType}${name}`;
});
const dialogTitle = computed(
  () => props.title || (props.mode === 'blocked' ? `无法${props.action}` : `确认${props.action}`),
);
const confirmText = computed<ButtonProps>(() => ({
  content: props.mode === 'blocked' ? '我知道了' : `确认${props.action}`,
  theme: props.mode !== 'blocked' && (props.danger || /(删除|移除|清空)/.test(props.action)) ? 'danger' : 'primary',
}));
const dialogDescription = computed(() => {
  if (props.description) return props.description;
  return props.mode === 'blocked'
    ? `${targetText.value || '当前对象'}暂时无法${props.action}。`
    : `确认${props.action}${targetText.value}吗？`;
});

function handleConfirm() {
  if (props.mode === 'blocked') emit('update:visible', false);
  emit('confirm');
}
</script>

<style scoped>
.zdm-admin-confirm-dialog__content {
  color: var(--td-text-color-primary);
  font-size: 14px;
  line-height: 22px;
  overflow-wrap: anywhere;
}
</style>
