<template>
  <t-input-group class="zdm-admin-phone-input" separate @beforeinput.capture="beforeInput" @paste.capture="paste">
    <t-input :value="callingCode" readonly disabled placeholder="区号" aria-label="国际区号" />
    <t-input
      :value="modelValue"
      :disabled="!callingCode"
      :tips="callingCode ? undefined : '请先选择号码归属地'"
      :maxlength="80"
      type="tel"
      clearable
      aria-label="联系电话"
      placeholder="请输入联系电话"
      @change="change"
    />
  </t-input-group>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: string; callingCode: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
function beforeInput(event: InputEvent) {
  if (event.data && /[^0-9]/.test(event.data)) event.preventDefault();
}
function paste(event: ClipboardEvent) {
  if (/[^0-9]/.test(event.clipboardData?.getData('text') ?? '')) event.preventDefault();
}
function change(value: string | number, context: { e?: Event }) {
  const text = String(value);
  if (/^[0-9]*$/.test(text)) emit('update:modelValue', text);
  else if (context.e?.target instanceof HTMLInputElement) context.e.target.value = props.modelValue;
}
</script>

<style scoped>
/* Business layout only; both inputs retain their native TDesign appearance. */
.zdm-admin-phone-input {
  display: flex;
  width: 100%;
  min-width: 0;
}
.zdm-admin-phone-input :deep(.t-input__wrap:first-child) {
  width: 80px;
  flex: 0 0 80px;
}
.zdm-admin-phone-input :deep(.t-input__wrap:last-child) {
  width: 0;
  min-width: 0;
  flex: 1;
}
</style>
