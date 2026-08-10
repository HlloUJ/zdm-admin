<template>
  <t-dialog
    :visible="visible"
    :header="header"
    :width="width"
    :dialog-class-name="dialogClassName"
    placement="center"
    :prevent-scroll-through="false"
    :confirm-btn="confirmBtn"
    :cancel-btn="cancelBtn"
    @update:visible="emit('update:visible', $event)"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
    @close="emit('close')"
    @opened="emit('opened')"
    @closed="emit('closed')"
  >
    <slot />
  </t-dialog>
</template>

<script setup lang="ts">
import type { ButtonProps } from 'tdesign-vue-next';

withDefaults(
  defineProps<{
    visible: boolean;
    header: string;
    width?: string;
    dialogClassName?: string;
    confirmBtn?: string | ButtonProps;
    cancelBtn?: string | ButtonProps | null;
  }>(),
  {
    width: '520px',
    dialogClassName: '',
    confirmBtn: '提交',
    cancelBtn: '取消',
  },
);

const emit = defineEmits<{
  'update:visible': [value: boolean];
  confirm: [];
  cancel: [];
  close: [];
  opened: [];
  closed: [];
}>();
</script>
