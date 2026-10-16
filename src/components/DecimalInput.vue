<template>
  <t-input-number
    :model-value="draft"
    large-number
    :decimal-places="decimalPlaces"
    @change="handleChange"
    @focus="handleFocus"
    @focusin="handleNativeFocus"
    @keydown.capture="handleDecimalKeydown"
    @blur="handleBlur"
  />
</template>

<script setup lang="ts" generic="T extends string | number | null | undefined">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{ modelValue?: T; value?: T; largeNumber?: boolean; decimalPlaces?: number }>(),
  { modelValue: undefined, value: undefined, decimalPlaces: 2 },
);
type ChangeContext = { type?: string; e?: Event };
const emit = defineEmits<{
  'update:modelValue': [value: T];
  change: [value: T, context: ChangeContext];
  focus: [value: T, context: ChangeContext];
  blur: [value: T, context: ChangeContext];
}>();
const model = computed(() => (props.modelValue !== undefined ? props.modelValue : props.value));
const focused = ref(false);
const formatDraft = (value: unknown) => {
  const text = String(value ?? '');
  if (!/^-?\d+(?:\.\d*)?$/.test(text)) return text;
  const [integer, decimal = ''] = text.split('.');
  return decimal.length <= props.decimalPlaces ? `${integer}.${decimal.padEnd(props.decimalPlaces, '0')}` : text;
};
// Match the inactive display before focus; changing 0.70 to 0.7 during focus
// would reset the caret/selection before the next native edit.
const draft = ref(formatDraft(model.value));
// A linked field or parent formatter may echo a canonical value while the user
// is still entering a decimal. Keep the focused input's text and caret intact.
watch([model, focused], ([value, editing]) => {
  if (!editing) draft.value = formatDraft(value);
});
const externalValue = (text: string) => (props.largeNumber ? text : text === '' ? undefined : Number(text)) as T;
const handleChange = (value: unknown, context: ChangeContext = {}) => {
  if (context.type === 'props') return;
  const text = String(value ?? '');
  draft.value = text;
  const next = externalValue(text);
  if (!props.largeNumber && (Number.isNaN(next) || next === model.value)) return;
  emit('update:modelValue', next);
  emit('change', next, context);
};
const handleFocus = (_value: unknown, context: ChangeContext = {}) => {
  if (focused.value) return;
  focused.value = true;
  emit('focus', model.value as T, context);
};
// TDesign's imperative focus path may suppress its component focus callback
// when the pointer is hovering. Native focusin still fires for the actual input.
const handleNativeFocus = (event: FocusEvent) => {
  if ((event.target as HTMLElement | null)?.tagName === 'INPUT') handleFocus(undefined, { e: event });
};
const handleDecimalKeydown = (event: KeyboardEvent) => {
  if (event.code !== 'NumpadDecimal' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const input = event.target as HTMLInputElement | null;
  if (input?.tagName !== 'INPUT' || input.disabled || input.readOnly || input.selectionStart === null) return;
  const start = input.selectionStart;
  const end = input.selectionEnd ?? start;
  event.preventDefault();
  if (input.value.slice(0, start).includes('.') || input.value.slice(end).includes('.')) return;
  // Normalize the physical decimal key independently of the locale/NumLock key
  // value. Keep the existing input validation and price-change event path.
  const document = input.ownerDocument;
  if (document.activeElement === input && document.execCommand?.('insertText', false, '.')) return;
  input.setRangeText('.', start, end, 'end');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '.' }));
};
const handleBlur = (value: unknown, context: ChangeContext = {}) => {
  if (externalValue(String(value ?? '')) !== model.value) handleChange(value, { ...context, type: 'blur' });
  focused.value = false;
  emit('blur', model.value as T, context);
};
</script>
