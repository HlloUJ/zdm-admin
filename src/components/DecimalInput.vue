<template>
  <component
    :is="plain ? 't-input' : 't-input-number'"
    :model-value="draft"
    :data-numeric-error="numericError(draft, decimalPlaces, allowNegative) || storageError"
    v-bind="plain ? {} : { largeNumber: true, min: allowNegative ? undefined : 0, format: () => draft }"
    :status="intermediate ? undefined : error ? 'error' : status"
    :tips="intermediate ? undefined : error || tips"
    @numeric-validate.capture="touched = true"
    @input.capture="handleInput"
    @beforeinput.capture="handleBeforeInput"
    @paste.capture="handlePaste"
    @compositionstart.capture="handleCompositionStart"
    @compositionend.capture="handleCompositionEnd"
    @change="handleChange"
    @focus="handleFocus"
    @focusin="handleNativeFocus"
    @keydown.capture="handleDecimalKeydown"
    @select.capture="rememberSelection"
    @blur="handleBlur"
  />
</template>

<script setup lang="ts" generic="T extends string | number | null | undefined">
import { computed, ref, watch } from 'vue';
import { numericError, acceptsNumericInput, normalizeNumeric, numericNumberError } from '@/utils/numericInput';

const props = withDefaults(
  defineProps<{
    modelValue?: T;
    value?: T;
    largeNumber?: boolean;
    decimalPlaces?: number;
    plain?: boolean;
    allowNegative?: boolean;
    status?: 'default' | 'success' | 'warning' | 'error';
    tips?: string;
  }>(),
  {
    modelValue: undefined,
    value: undefined,
    decimalPlaces: 2,
    plain: false,
    allowNegative: false,
    status: undefined,
    tips: undefined,
  },
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
const touched = ref(false);
const composing = ref(false);
const edited = ref(false);
const formatDraft = (value: unknown) => normalizeNumeric(value, props.decimalPlaces, props.allowNegative);
const draft = ref(formatDraft(model.value));
const storageError = computed(() =>
  props.largeNumber ? '' : numericNumberError(draft.value, props.decimalPlaces, props.allowNegative),
);
const error = computed(() =>
  !edited.value && (props.plain || !touched.value)
    ? ''
    : numericError(draft.value, props.decimalPlaces, props.allowNegative, touched.value && !focused.value) ||
      storageError.value,
);
const intermediate = computed(
  () =>
    focused.value &&
    Boolean(draft.value) &&
    !numericError(draft.value, props.decimalPlaces, props.allowNegative, false) &&
    Boolean(numericError(draft.value, props.decimalPlaces, props.allowNegative)),
);
watch([model, focused], ([value, editing]) => {
  if (!editing) draft.value = formatDraft(value);
});
const externalValue = (text: string) =>
  (props.largeNumber ||
  numericError(text, props.decimalPlaces, props.allowNegative) ||
  numericNumberError(text, props.decimalPlaces, props.allowNegative)
    ? text
    : text === ''
      ? undefined
      : Number(text)) as T;
const publish = (text: string, context: ChangeContext) => {
  edited.value = true;
  draft.value = text;
  const next = externalValue(text);
  emit('update:modelValue', next);
  emit('change', next, context);
};
const inputTarget = (event: Event) => {
  const input = event.target as HTMLInputElement | null;
  return input?.tagName === 'INPUT' && !input.disabled && !input.readOnly ? input : null;
};
const accepts = (text: string) => acceptsNumericInput(text, props.decimalPlaces, props.allowNegative);
const replacement = (input: HTMLInputElement, text: string) =>
  input.value.slice(0, input.selectionStart ?? input.value.length) +
  text +
  input.value.slice(input.selectionEnd ?? input.value.length);
type Selection = { value: string; start: number; end: number; direction: 'forward' | 'backward' | 'none' };
let selection: Selection | undefined;
const rememberSelection = (event: Event) => {
  const input = inputTarget(event);
  if (!input || composing.value) return;
  selection = {
    value: input.value,
    start: input.selectionStart ?? input.value.length,
    end: input.selectionEnd ?? input.value.length,
    direction: input.selectionDirection ?? 'none',
  };
};
const restoreDraft = (input: HTMLInputElement) => {
  const saved = selection?.value === draft.value ? selection : undefined;
  const start = saved?.start ?? Math.min(input.selectionStart ?? draft.value.length, draft.value.length);
  const end = saved?.end ?? start;
  input.value = draft.value;
  input.setSelectionRange(start, end, saved?.direction);
};
const handleBeforeInput = (event: InputEvent) => {
  rememberSelection(event);
  const input = inputTarget(event);
  if (!input || composing.value || event.isComposing || !event.inputType.startsWith('insert') || event.data == null)
    return;
  if (!accepts(replacement(input, event.data))) event.preventDefault();
};
const handlePaste = (event: ClipboardEvent) => {
  const input = inputTarget(event);
  if (!input) return;
  event.preventDefault();
  const text = (event.clipboardData?.getData('text/plain') ?? '').trim();
  if (!accepts(replacement(input, text))) return;
  input.setRangeText(text, input.selectionStart ?? 0, input.selectionEnd ?? 0, 'end');
  publish(input.value, { type: 'input', e: event });
};
const handleInput = (event: Event) => {
  const input = inputTarget(event);
  if (!input) return;
  // Let TDesign receive composing input so its composition draft stays in sync.
  if (composing.value || (event as InputEvent).isComposing) return;
  // Keep TDesign's visual component and step controls, bypass its lossy input truncation/filtering.
  event.stopImmediatePropagation();
  if (!(event as InputEvent).inputType?.startsWith('delete') && !accepts(input.value)) {
    restoreDraft(input);
    return;
  }
  publish(input.value, { type: 'input', e: event });
};
const handleCompositionStart = (event: CompositionEvent) => {
  rememberSelection(event);
  composing.value = true;
};
const handleCompositionEnd = (event: CompositionEvent) => {
  const input = inputTarget(event);
  composing.value = false;
  if (!input) return;
  if (accepts(input.value)) publish(input.value, { type: 'input', e: event });
  else restoreDraft(input);
  // Do not stop compositionend: TDesign must also reset its composition state.
};
const handleChange = (value: unknown, context: ChangeContext = {}) => {
  if (composing.value || context.e?.type === 'compositionend') return;
  if (context.type === 'props' || context.type === 'input' || context.type === 'blur' || context.type === 'enter')
    return;
  const text = String(value ?? '');
  if (accepts(text)) publish(text, context);
};
const handleFocus = (_value: unknown, context: ChangeContext = {}) => {
  if (focused.value) return;
  focused.value = true;
  emit('focus', model.value as T, context);
};
const handleNativeFocus = (event: FocusEvent) => {
  if ((event.target as HTMLElement | null)?.tagName === 'INPUT') handleFocus(undefined, { e: event });
};
const handleDecimalKeydown = (event: KeyboardEvent) => {
  rememberSelection(event);
  if (event.code !== 'NumpadDecimal' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const input = inputTarget(event);
  if (!input || input.selectionStart === null) return;
  event.preventDefault();
  if (!props.decimalPlaces || !accepts(replacement(input, '.'))) return;
  input.setRangeText('.', input.selectionStart, input.selectionEnd ?? input.selectionStart, 'end');
  publish(input.value, { type: 'input', e: event });
};
const handleBlur = (_value: unknown, context: ChangeContext = {}) => {
  composing.value = false;
  touched.value = true;
  if (!edited.value) {
    focused.value = false;
    emit('blur', model.value as T, context);
    return;
  }
  const next = formatDraft(draft.value);
  if (next !== draft.value || String(model.value ?? '') !== next) publish(next, { ...context, type: 'blur' });
  focused.value = false;
  emit('blur', externalValue(next), context);
};
</script>
