import { reactive, watch, type Ref } from 'vue';

/** Presentation only: callers retain every existing validation decision and trigger. */
export function fieldFeedback(invalid: unknown, message: string, help?: string) {
  return {
    class: invalid ? 't-is-error' : undefined,
    status: invalid ? ('error' as const) : undefined,
    tips: invalid ? message : help,
  };
}
export function requiredFieldFeedback(value: unknown, label: string, submitted: boolean, select = false) {
  return fieldFeedback(submitted && !String(value ?? '').trim(), `${select ? '请选择' : '请输入'}${label}`);
}

/** Attach an already detected error to its original value; editing clears that feedback. */
export function useFormFeedback(visible?: Ref<boolean>) {
  const errors = reactive<Record<string, { value: string; message: string }>>({});
  const snapshot = (value: unknown) => JSON.stringify(value) ?? 'undefined';
  const clear = () => {
    for (const key of Object.keys(errors)) delete errors[key];
  };
  if (visible) watch(visible, clear, { flush: 'sync' });
  return {
    clear,
    reject(key: string, value: unknown, message: string) {
      errors[key] = { value: snapshot(value), message };
    },
    field(key: string, value: unknown) {
      const error = errors[key];
      return fieldFeedback(error && error.value === snapshot(value), error?.message ?? '');
    },
  };
}
