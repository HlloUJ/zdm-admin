<template>
  <t-dialog
    v-bind="$attrs"
    :visible="visible"
    :header="header"
    :dialog-class-name="
      ['zdm-admin-dialog', formLayout === 'single-column' ? 'zdm-admin-single-form' : '', dialogClassName]
        .filter(Boolean)
        .join(' ')
    "
    :confirm-btn="confirmBtn"
    placement="center"
    :prevent-scroll-through="false"
    @update:visible="emit('update:visible', $event)"
  >
    <t-space direction="vertical" size="large" :style="{ width: '100%' }">
      <t-form ref="formRef" :show-error-message="true" :data="data" :label-width="labelWidth" colon><slot /></t-form>
      <slot name="after" />
    </t-space>
  </t-dialog>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { FormProps, ButtonProps, FormInstanceFunctions } from 'tdesign-vue-next';
import { formElement } from '@/utils/submitValidation';
const formRef = ref<FormInstanceFunctions>();
defineExpose({ getFormElement: () => formElement(formRef.value) });
defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{
    visible: boolean;
    header: string;
    data: FormProps['data'];
    labelWidth?: FormProps['labelWidth'];
    dialogClassName?: string;
    formLayout?: 'single-column' | 'custom';
    confirmBtn?: string | ButtonProps;
  }>(),
  { labelWidth: '100px', confirmBtn: '提交', dialogClassName: '', formLayout: 'single-column' },
);
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();
</script>
