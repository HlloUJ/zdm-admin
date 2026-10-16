<template>
  <t-dialog
    :visible="visible"
    :header="header"
    :width="width"
    :dialog-class-name="['zdm-admin-dialog', dialogClassName].filter(Boolean).join(' ')"
    placement="center"
    :prevent-scroll-through="false"
    :confirm-btn="actionButtonProps(confirmFunction, confirmBtn)"
    :cancel-btn="cancelButtonProps(cancelBtn)"
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
import { actionButtonProps, cancelButtonProps, type ButtonFunction } from './actions/buttonFunctions';

withDefaults(
  defineProps<{
    visible: boolean;
    header: string;
    width?: string;
    dialogClassName?: string;
    confirmFunction: ButtonFunction;
    confirmBtn?: string | ButtonProps;
    cancelBtn?: string | ButtonProps | null;
  }>(),
  {
    width: '480px',
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
