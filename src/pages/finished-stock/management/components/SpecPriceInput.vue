<template>
  <t-input-number
    class="spec-price-input"
    :auto-width="false"
    :disabled="disabled"
    :model-value="modelValue"
    large-number
    :decimal-places="2"
    theme="normal"
    :placeholder="placeholder"
    :status="error ? 'error' : undefined"
    :tips="error"
    @change="handleChange"
    @focus="handleFocus"
    @blur="handleBlur"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { isValidSpecPriceNumber } from '../priceValidation';
const props = defineProps<{
  modelValue: string;
  label: string;
  placeholder: string;
  submitted: boolean;
  optional?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string]; commit: [] }>();
const touched = ref(false);
const focusValue = ref(props.modelValue);
const focused = ref(false);
watch(
  [() => props.modelValue, focused],
  ([value, isFocused]) => {
    if (isFocused || !isValidSpecPriceNumber(value)) return;
    const [integer, decimal = ''] = value.trim().split('.');
    const formatted = `${integer}.${decimal.padEnd(2, '0')}`;
    if (formatted !== value) emit('update:modelValue', formatted);
  },
  { immediate: true },
);
const handleFocus = () => {
  focused.value = true;
  focusValue.value = props.modelValue;
};
const normalizeValue = (input: string) => (input.includes('.') ? input.replace(/0+$/, '').replace(/\.$/, '') : input);
const handleBlur = () => {
  touched.value = true;
  const value = String(props.modelValue ?? '');
  const original = String(focusValue.value ?? '');
  if (
    value !== original &&
    !(
      isValidSpecPriceNumber(value) &&
      isValidSpecPriceNumber(original) &&
      normalizeValue(value) === normalizeValue(original)
    )
  )
    emit('commit');
  focused.value = false;
};
const error = computed(() => {
  if (!touched.value && !props.submitted) return '';
  if (!String(props.modelValue ?? '').trim()) return props.optional ? '' : `请输入${props.label}`;
  return isValidSpecPriceNumber(props.modelValue) ? '' : `请输入正确的${props.label}`;
});
const handleChange = (value: unknown, context: { type?: string }) => {
  if (context?.type === 'props') return;
  const text = String(value ?? '');
  const previous = String(props.modelValue ?? '');
  const normalize = (input: string) => (input.includes('.') ? input.replace(/0+$/, '').replace(/\.$/, '') : input);
  const unchanged =
    text === previous ||
    (isValidSpecPriceNumber(text) && isValidSpecPriceNumber(previous) && normalize(text) === normalize(previous));
  emit('update:modelValue', text);
  if (!unchanged) emit('change', text);
};
</script>

<style scoped>
.spec-price-input {
  display: block;
  height: auto;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.spec-price-input :deep(.t-input__tips) {
  position: static;
  overflow-wrap: anywhere;
}
</style>
