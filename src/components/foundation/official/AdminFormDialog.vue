<template>
  <t-dialog
    v-bind="$attrs"
    :visible="visible"
    :header="header"
    :confirm-btn="confirmBtn"
    placement="center"
    :prevent-scroll-through="false"
    @update:visible="emit('update:visible', $event)"
  >
    <t-space direction="vertical" size="large" :style="{ width: '100%' }">
      <t-form :data="data" :label-width="labelWidth" colon><slot /></t-form>
      <slot name="after" />
    </t-space>
  </t-dialog>
</template>
<script setup lang="ts">
import type { FormProps, ButtonProps } from 'tdesign-vue-next';
defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{
    visible: boolean;
    header: string;
    data: FormProps['data'];
    labelWidth?: FormProps['labelWidth'];
    confirmBtn?: string | ButtonProps;
  }>(),
  { labelWidth: '100px', confirmBtn: '提交' },
);
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();
</script>
