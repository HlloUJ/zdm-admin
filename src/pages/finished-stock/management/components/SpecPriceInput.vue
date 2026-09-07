<template>
  <t-input-number
    class="spec-price-input"
    :auto-width="false"
    :model-value="modelValue"
    large-number
    :decimal-places="2"
    theme="normal"
    :placeholder="placeholder"
    :status="error ? 'error' : undefined"
    :tips="error"
    @change="handleChange"
    @blur="touched = true"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { isValidSpecPriceNumber } from '../priceValidation';
const props = defineProps<{ modelValue: string; label: string; placeholder: string; submitted: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>();
const touched = ref(false);
const error = computed(() => {
  if (!touched.value && !props.submitted) return '';
  if (!String(props.modelValue ?? '').trim()) return `请输入${props.label}`;
  return isValidSpecPriceNumber(props.modelValue) ? '' : `请输入正确的${props.label}`;
});
const handleChange = (value: unknown, context: { type?: string }) => {
  if (context?.type === 'props') return;
  const text = String(value ?? '');
  emit('update:modelValue', text);
  emit('change', text);
};
</script>

<style scoped>
.spec-price-input {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
</style>
