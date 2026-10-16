export const isPositiveIntegerQuantity = (value: unknown) =>
  /^\d+$/.test(String(value ?? '')) && Number.isInteger(Number(value)) && Number(value) > 0;

/** Accept only quantity digits and reject zero without substituting another quantity. */
export function preventZeroQuantity(event: InputEvent | ClipboardEvent | KeyboardEvent) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if ('key' in event) {
    const step = event.key === 'ArrowDown' ? -1 : event.key === 'ArrowUp' ? 1 : 0;
    if (step && ((!input.value.trim() && step < 0) || Number(input.value) + step === 0)) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  let start = input.selectionStart ?? input.value.length;
  let end = input.selectionEnd ?? start;
  let inserted = '';
  if ('clipboardData' in event) inserted = event.clipboardData?.getData('text/plain') ?? '';
  else if (event.inputType.startsWith('insert')) {
    const data = event.data ?? event.dataTransfer?.getData('text/plain');
    if (data == null) return;
    inserted = data;
  } else if (event.inputType.startsWith('delete')) {
    if (start === end) {
      if (event.inputType === 'deleteContentBackward') start = Math.max(0, start - 1);
      else if (event.inputType === 'deleteContentForward') end = Math.min(input.value.length, end + 1);
      else return;
    }
  } else return;
  const next = input.value.slice(0, start) + inserted + input.value.slice(end);
  if (!/^\d*$/.test(next) || (next && Number(next) === 0)) event.preventDefault();
}
